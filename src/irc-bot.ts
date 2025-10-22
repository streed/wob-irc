import * as irc from 'irc-framework';
import { BotConfig, QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';
import { MessageQueue } from './message-queue';
import { OllamaClient } from './ollama-client';

export class IRCBot {
  private client: irc.Client;
  private config: BotConfig;
  private pluginLoader: PluginLoader;
  private messageQueue: MessageQueue;
  private ollamaClient: OllamaClient;

  constructor(config: BotConfig) {
    this.config = config;
    
    // Initialize IRC client
    this.client = new irc.Client();
    
    // Initialize plugin loader
    this.pluginLoader = new PluginLoader();
    
    // Initialize Ollama client
    this.ollamaClient = new OllamaClient(
      this.config.ollama.host,
      this.config.ollama.model,
      this.config.systemPrompt || this.getDefaultSystemPrompt(),
      this.pluginLoader
    );
    
    // Initialize message queue
    this.messageQueue = new MessageQueue(
      this.config.messageDebounceMs,
      this.processQueuedMessages.bind(this)
    );
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful IRC bot assistant. You respond to messages in a concise and friendly manner. 
You have access to various tools that you can use to help users. Use these tools naturally when they would be helpful to answer questions or perform tasks.
Keep your responses brief and appropriate for IRC chat.
IMPORTANT: Do not use markdown formatting. Use plain text only - no asterisks, underscores, backticks, or other markdown syntax.`;
  }

  async start(): Promise<void> {
    // Load plugins first
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
      }
    });

    this.client.on('message', (event) => {
      // Ignore messages from ourselves
      if (event.nick === this.client.user.nick) {
        return;
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
    // Respond if the bot is directly addressed or asked a question
    const botNick = this.client.user.nick.toLowerCase();
    const messageLower = message.toLowerCase();
    
    // Respond to commands starting with !
    if (messageLower.startsWith('!')) {
      return true;
    }
    
    // Respond if the bot is directly addressed at the start (e.g., "botnick:" or "botnick,")
    const directAddressPattern = new RegExp(`^${botNick}[,:;]\\s*`, 'i');
    if (directAddressPattern.test(messageLower)) {
      return true;
    }
    
    // Respond if the message is a question directed at the bot
    // (contains bot's name and ends with a question mark)
    if (messageLower.includes(botNick) && messageLower.includes('?')) {
      return true;
    }
    
    // Respond if addressed as "bot" at the start (e.g., "bot:" or "bot,")
    if (/^bot[,:;]\s*/i.test(messageLower)) {
      return true;
    }
    
    // Respond if it's a question addressed to "bot"
    if (messageLower.includes('bot') && messageLower.includes('?')) {
      return true;
    }
    
    return false;
  }

  private async processQueuedMessages(channel: string, messages: QueuedMessage[]): Promise<void> {
    try {
      console.log(`Processing ${messages.length} message(s) for ${channel}`);
      
      // Get response from Ollama
      const response = await this.ollamaClient.processMessages(channel, messages);
      
      if (response && response.trim()) {
        // Remove markdown formatting for IRC
        const cleanedResponse = this.removeMarkdown(response);
        
        // Split long messages if needed (IRC typically has ~512 char limit)
        const lines = this.splitMessage(cleanedResponse, 400);
        
        for (const line of lines) {
          this.client.say(channel, line);
        }
      }
    } catch (error) {
      console.error('Error processing messages:', error);
      this.client.say(channel, 'Sorry, I encountered an error processing that request.');
    }
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
    
    // Quit IRC
    console.log('[IRC] Sending QUIT command...');
    this.client.quit('Shutting down');
    
    // Give time for quit message to send
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('[IRC] Shutdown complete');
    process.exit(0);
  }
}
