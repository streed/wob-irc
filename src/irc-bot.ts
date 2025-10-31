import * as irc from 'irc-framework';
import { BotConfig, QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';
import { MessageQueue } from './message-queue';
import { BaseLLMClient } from './llm/base-llm';
import { OllamaLLM } from './llm/ollama-llm';
import { GroqLLM } from './llm/groq-llm';
import { MessageHistoryDB } from './message-history-db';
import { createMessageHistoryPlugin } from './builtin-plugins/message-history-plugin';

export class IRCBot {
  private client: irc.Client;
  private config: BotConfig;
  private pluginLoader: PluginLoader;
  private messageQueue: MessageQueue;
  private llmClient: BaseLLMClient;
  private messageHistory: MessageHistoryDB;
  private joinedChannels: Set<string> = new Set();

  constructor(config: BotConfig) {
    this.config = config;
    
    // Initialize IRC client
    this.client = new irc.Client();
    
    // Initialize message history with database (always)
    console.log('Using database-backed message history with 30-day retention and daily summaries');
    this.messageHistory = new MessageHistoryDB(
      this.config.ollama.host,
      this.config.ollama.embeddingModel || 'nomic-embed-text:v1.5',
      this.config.messageHistory?.dbPath
    );
    
    // Initialize LLM client (Ollama or Groq)
    const provider = this.config.llmProvider || 'ollama';
    if (provider === 'groq') {
      const apiKey = this.config.groq?.apiKey || process.env.GROQ_API_KEY || '';
      if (!apiKey) {
        console.warn('[Config] GROQ_API_KEY not set; falling back to Ollama provider');
        this.llmClient = new OllamaLLM(
          this.config.ollama.host,
          this.config.ollama.model,
          this.config.systemPrompt || this.getDefaultSystemPrompt(),
          this.config.ollama.maxToolCallRounds,
          this.config.chaosMode,
          this.messageHistory,
          this.config.ollama.maxContextTokens,
          this.config.ollama.disableThinking === true,
        );
      } else {
        this.llmClient = new GroqLLM(
          apiKey,
          this.config.groq?.model || process.env.GROQ_MODEL || 'llama-3.1-70b-versatile',
          this.config.systemPrompt || this.getDefaultSystemPrompt(),
          {
            baseUrl: this.config.groq?.baseUrl || process.env.GROQ_BASE_URL,
            maxToolCallRounds: this.config.ollama.maxToolCallRounds,
            chaosMode: this.config.chaosMode,
            messageHistory: this.messageHistory,
            maxContextTokens: this.config.ollama.maxContextTokens,
            disableThinking: this.config.ollama.disableThinking === true,
          },
        );
      }
    } else {
      this.llmClient = new OllamaLLM(
        this.config.ollama.host,
        this.config.ollama.model,
        this.config.systemPrompt || this.getDefaultSystemPrompt(),
        this.config.ollama.maxToolCallRounds,
        this.config.chaosMode,
        this.messageHistory,
        this.config.ollama.maxContextTokens,
        this.config.ollama.disableThinking === true,
      );
    }
    
    // Initialize plugin loader
    this.pluginLoader = new PluginLoader();
    
    // Set the plugin loader in the LLM client for tool execution
    this.llmClient.setPluginLoader(this.pluginLoader);
    
    // Initialize message queue
    this.messageQueue = new MessageQueue(
      this.config.messageDebounceMs,
      this.processQueuedMessages.bind(this)
    );
  }

  private getDefaultSystemPrompt(): string {
    return `You are an IRC assistant. Be concise, correct, and tool-smart.

Output:
- Plain text only (no markdown, code fences, or special formatting)
- Final answer only — never include chain-of-thought, steps, or meta; no <think> tags
- Prefer one short line (≤400 chars). If that cannot convey a complete answer, you may send up to 3 lines (each ≤400 chars), prioritizing the highest-signal facts
- If key info is missing, ask one crisp clarifying question (single line)

Tool policy:
- Use tools when they improve reliability (math, conversions, definitions, channel history); otherwise answer directly
- Choose the minimal tool(s) needed; avoid redundant calls; do not loop on the same tool
- Fill required parameters; use sensible defaults (e.g., limit≈20) and cap large outputs
- After a tool response, synthesize a brief answer; do not paste long raw results
- If a question is about recent chat context, first try message-history tools

Message history tools (how to choose):
- get_recent_messages: Last N lines; use for “what were we discussing?”
- get_user_messages: Lines from one user
- search_messages: Exact keywords/phrases
- semantic_search_messages: Conceptual/meaning similarity when keywords fail
- get_channel_stats / get_user_stats: Activity summaries
- get_daily_summaries: Historical day-level rollups

Style:
- Friendly, neutral tone; no filler or hedging
- Do not fabricate URLs or facts; if uncertain, say so briefly
- Keep answers crisp for IRC; no lists unless explicitly asked`;
  }

  async start(): Promise<void> {
    // Register built-in plugins
    await this.pluginLoader.registerBuiltinPlugin(createMessageHistoryPlugin(this.messageHistory));
    
    // Load plugins
    await this.pluginLoader.loadPlugins();
    
    // Setup event handlers first, before connecting
    this.setupEventHandlers();
    
    // Setup IRC client
    console.log('Attempting to connect to IRC server...');
    console.log(`  Host: ${this.config.irc.host}`);
    console.log(`  Port: ${this.config.irc.port}`);
    console.log(`  Nick: ${this.config.irc.nick}`);
    console.log(`  Username: ${this.config.irc.username || this.config.irc.nick}`);
    console.log(`  TLS: ${this.config.irc.tls || false}`);
    console.log(`  Channels to join: ${this.config.irc.channels.join(', ')}`);
    
    this.client.connect({
      host: this.config.irc.host,
      port: this.config.irc.port,
      nick: this.config.irc.nick,
      username: this.config.irc.username || this.config.irc.nick,
      gecos: this.config.irc.realname || 'Ollama IRC Bot',
      tls: this.config.irc.tls || false,
    });
    
    console.log('Connection initiated, waiting for server response...');
  }

  private setupEventHandlers(): void {
    // Connection lifecycle events
    this.client.on('connecting', () => {
      console.log('[IRC] Connecting to server...');
    });

    this.client.on('connected', () => {
      console.log('[IRC] TCP connection established, performing registration...');
    });

    this.client.on('registered', () => {
      console.log('[IRC] Successfully registered with server');
      console.log(`[IRC] Connected as: ${this.client.user.nick}`);
      
      // Join channels
      for (const channel of this.config.irc.channels) {
        console.log(`[IRC] Joining channel: ${channel}`);
        this.client.join(channel);
      }
    });

    this.client.on('join', (event: any) => {
      if (event.nick === this.client.user.nick) {
        console.log(`[IRC] Successfully joined channel: ${event.channel}`);
        this.joinedChannels.add(event.channel);
      }
    });

    this.client.on('part', (event: any) => {
      if (event.nick === this.client.user.nick) {
        console.log(`[IRC] Left channel: ${event.channel}`);
        this.joinedChannels.delete(event.channel);
      }
    });

    this.client.on('kick', (event: any) => {
      if (event.kicked === this.client.user.nick) {
        console.log(`[IRC] Kicked from channel: ${event.channel}`);
        this.joinedChannels.delete(event.channel);
      }
    });

    this.client.on('message', (event) => {
      // Ignore messages from ourselves
      if (event.nick === this.client.user.nick) {
        return;
      }

      // Track messages in history only if they're from channels we've joined
      // Use the channel name if it's a channel, otherwise use the target
      const channel = event.target;
      
      // Only store messages from joined channels
      if (this.joinedChannels.has(channel)) {
        // Handle both sync (MessageHistory) and async (MessageHistoryDB) addMessage
        const result = this.messageHistory.addMessage(channel, event.nick, event.message);
        if (result instanceof Promise) {
          result.catch(err => {
            console.error('Error adding message to history:', err);
          });
        }
      }

      // Only respond to channel messages or direct messages
      if (event.target === this.client.user.nick || this.shouldRespond(event.message)) {
        console.log(`[${event.target}] <${event.nick}> ${event.message}`);
        
        // Add message to queue
        this.messageQueue.addMessage(
          event.target,
          event.nick,
          event.message
        );
      }
    });

    this.client.on('close', () => {
      console.log('[IRC] Connection closed');
    });

    this.client.on('socket close', () => {
      console.log('[IRC] Socket closed');
    });

    this.client.on('socket error', (error: Error) => {
      console.error('[IRC] Socket error:', error.message);
      if ((error as any).code) {
        console.error('[IRC] Error code:', (error as any).code);
      }
    });

    this.client.on('error', (error) => {
      console.error('[IRC] Error:', error);
    });

    this.client.on('raw', (event: any) => {
      // Log all raw IRC messages for debugging (can be verbose)
      if (process.env.IRC_DEBUG === 'true') {
        console.log('[IRC] RAW:', event.line);
      }
    });

    this.client.on('debug', (message: string) => {
      if (process.env.IRC_DEBUG === 'true') {
        console.log('[IRC] DEBUG:', message);
      }
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await this.shutdown();
    });

    process.on('SIGTERM', async () => {
      await this.shutdown();
    });
  }

  private shouldRespond(message: string): boolean {
    // Respond if the bot is mentioned
    const botNick = this.client.user.nick.toLowerCase();
    const messageLower = message.toLowerCase();
    
    // Check for explicit triggers
    const explicitTrigger = (
      messageLower.includes(botNick) ||
      messageLower.startsWith('!') ||
      messageLower.includes('bot')
    );
    
    // Check for chaos mode random response
    if (!explicitTrigger && this.config.chaosMode?.enabled) {
      const randomValue = Math.random();
      if (randomValue < this.config.chaosMode.probability) {
        console.log(`[Chaos Mode] Random response triggered! (${(randomValue * 100).toFixed(2)}% < ${(this.config.chaosMode.probability * 100).toFixed(0)}%)`);
        return true;
      }
    }
    
    return explicitTrigger;
  }

  private async processQueuedMessages(channel: string, messages: QueuedMessage[]): Promise<void> {
    try {
      console.log(`Processing ${messages.length} message(s) for ${channel}`);
      
      // Get response from LLM provider
      const response = await this.llmClient.processMessages(channel, messages);
      
      if (response && response.trim()) {
        // Remove markdown formatting for IRC
        let cleanedResponse = this.removeMarkdown(response).trim();
        // Remove any explicit reasoning/thought preambles — send answer only
        cleanedResponse = this.removeReasoningPreambles(cleanedResponse);

        // If nothing remains after cleaning, don't send or record
        if (!cleanedResponse || cleanedResponse.trim().length === 0) {
          try { console.log(`[IRC] Skipping empty response after cleaning for ${channel}`); } catch (_) {}
          return;
        }

        // Log the cleaned response that will be used for sending
        try {
          console.log(`[IRC] Cleaned LLM response for ${channel} (${cleanedResponse.length} chars): ${cleanedResponse}`);
        } catch (_) {
          // best-effort logging only
        }

        let finalSentText = '';
        // If response fits within one IRC message, send single line; else allow up to 3 lines
        if (cleanedResponse.length <= 400 && cleanedResponse.split('\n').length <= 1) {
          try { console.log(`[IRC->${channel}] ${cleanedResponse}`); } catch (_) {}
          this.client.say(channel, cleanedResponse);
          finalSentText = cleanedResponse;
          // Record assistant message into channel history DB (best-effort)
          try {
            const p = this.messageHistory.addMessage(channel, this.client.user.nick, cleanedResponse);
            if (p instanceof Promise) { p.catch((e: any) => console.error('Error recording assistant message:', e)); }
          } catch (e) { /* ignore */ }
        } else {
          console.log(`[IRC] Summarizing for multi-line output (<=3 lines) for ${channel}`);
          // Summarize to ~3 messages worth of characters
          const summary = await this.llmClient.summarizeText(cleanedResponse, 1200);
          const lines = this.splitMessage(summary, 400).slice(0, 3);
          try { console.log(`[IRC] Sending ${lines.length} line(s) to ${channel} (multi-line mode)`); } catch (_) {}
          for (const line of lines) {
            const out = line.trim();
            if (!out) continue;
            try { console.log(`[IRC->${channel}] ${out}`); } catch (_) {}
            this.client.say(channel, out);
            // Record each line into channel history DB (best-effort)
            try {
              const p = this.messageHistory.addMessage(channel, this.client.user.nick, out);
              if (p instanceof Promise) { p.catch((e: any) => console.error('Error recording assistant message:', e)); }
            } catch (e) { /* ignore */ }
          }
          finalSentText = lines.join('\n');
        }

        // Record only what we actually sent to IRC into the LLM's history,
        // excluding any hidden reasoning or markdown that wasn't sent.
        if (finalSentText) {
          await this.llmClient.recordAssistantOutput(channel, finalSentText);
        }
      }
    } catch (error) {
      console.error('Error processing messages:', error);
      this.client.say(channel, 'Sorry, I encountered an error processing that request.');
    }
  }

  // Remove obvious reasoning/chain-of-thought preambles and meta statements
  private removeReasoningPreambles(text: string): string {
    if (!text) return '';
    // Strip common prefaces indicating reasoning
    const patterns = [
      /^(?:thoughts?|thinking|reasoning|analysis|plan|approach|steps?|explanation)\s*[:\-]/gim,
      /^(?:let'?s\s+think|let me think|i will|here'?s how|i (?:am|was) going to)\b[\s\S]*?\n/gim,
      /^step\s*\d+[:\.\-]/gim,
    ];
    let result = text;
    for (const re of patterns) {
      result = result.replace(re, '');
    }
    // Remove standalone labels like "Final answer:" and similar
    result = result.replace(/^\s*(final\s+answer|answer)\s*[:\-]\s*/gim, '');
    // Collapse excessive blank lines
    result = result.replace(/\n{3,}/g, '\n\n');
    return result.trim();
  }

  private removeMarkdown(text: string): string {
    // Remove markdown formatting for IRC output
    let cleaned = text;
    
    // Remove code blocks first (before inline code) (```code```)
    cleaned = cleaned.replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1');
    
    // Remove bold (**text** or __text__)
    cleaned = cleaned.replace(/\*\*(.+?)\*\*/g, '$1');
    cleaned = cleaned.replace(/__(.+?)__/g, '$1');
    
    // Remove italic (*text* or _text_)
    cleaned = cleaned.replace(/\*(.+?)\*/g, '$1');
    cleaned = cleaned.replace(/_(.+?)_/g, '$1');
    
    // Remove inline code (`code`) - only match content without newlines
    cleaned = cleaned.replace(/`([^`\n]+)`/g, '$1');
    
    // Remove strikethrough (~~text~~)
    cleaned = cleaned.replace(/~~(.+?)~~/g, '$1');
    
    // Remove links [text](url) -> text (url)
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)');
    
    // Remove headers (# text)
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');
    
    // Remove blockquotes (> text)
    cleaned = cleaned.replace(/^>\s+/gm, '');
    
    // Remove horizontal rules
    cleaned = cleaned.replace(/^[-*_]{3,}$/gm, '');
    
    // Remove list markers but keep content
    cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
    cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');
    
    return cleaned;
  }

  private splitMessage(message: string, maxLength: number): string[] {
    const lines: string[] = [];
    const paragraphs = message.split('\n');
    
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxLength) {
        lines.push(paragraph);
      } else {
        // Split long paragraphs at word boundaries
        const words = paragraph.split(' ');
        let currentLine = '';
        
        for (const word of words) {
          if ((currentLine + ' ' + word).length <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) {
              lines.push(currentLine);
            }
            currentLine = word;
          }
        }
        
        if (currentLine) {
          lines.push(currentLine);
        }
      }
    }
    
    return lines;
  }

  async shutdown(): Promise<void> {
    console.log('[IRC] Shutting down bot...');
    
    // Flush any pending messages
    console.log('[IRC] Flushing pending messages...');
    await this.messageQueue.flushAll();
    
    // Close database
    console.log('[IRC] Closing message history database...');
    this.messageHistory.close();
    
    // Quit IRC
    console.log('[IRC] Sending QUIT command...');
    this.client.quit('Shutting down');
    
    // Give time for quit message to send
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[IRC] Shutdown complete');
    process.exit(0);
  }
}
