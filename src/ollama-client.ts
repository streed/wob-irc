import { Ollama } from 'ollama';
import { QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';
import { sanitizeUnicode } from './unicode-sanitizer';

export class OllamaClient {
  private ollama: Ollama;
  private model: string;
  private systemPrompt: string;
  private pluginLoader?: PluginLoader;
  private conversationHistory: Map<string, any[]> = new Map();
  private maxHistoryLength: number = 20;
  private maxToolCallRounds: number = 10;
  private chaosMode?: { enabled: boolean; probability: number };
  private messageHistory?: any;
  private maxContextTokens: number = 4096;

  constructor(
    host: string,
    model: string,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any,
    maxContextTokens?: number
  ) {
    this.ollama = new Ollama({ host });
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxToolCallRounds = maxToolCallRounds || 10;
    this.chaosMode = chaosMode;
    this.messageHistory = messageHistory;
    this.maxContextTokens = maxContextTokens || 4096;
  }

  /**
   * Summarize a long assistant response to fit within a character limit,
   * preserving key information and mimicking the original tone.
   */
  async summarizeText(text: string, maxChars: number = 400): Promise<string> {
    try {
      const system = [
        'You are an assistant summarizer for an IRC bot.',
        'Goal: Rewrite the given assistant response to fit within the character limit while preserving all key information and keeping the same tone and voice.',
        'Constraints:',
        `- Max ${maxChars} characters`,
        '- One short paragraph, plain text only',
        '- No lists, no markdown, no code fences',
      ].join('\n');

      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Summarize the following assistant response to <= ${maxChars} characters while keeping the same tone and preserving key information.\n\n---\n${text}`,
          },
        ],
        tools: undefined,
      });

      const content = (response?.message?.content || '').trim();
      // Log raw summarization output from the LLM for debugging
      try {
        console.log(`[Ollama] Summarization raw output (${content.length} chars): ${content}`);
      } catch (_) {
        // best-effort logging only
      }
      // Best-effort hard limit enforcement if the model overruns
      if (content.length > maxChars) {
        return content.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return content;
    } catch (err) {
      console.error('Error during summarization:', err);
      // Fallback: hard truncate with ellipsis
      if (text.length > maxChars) {
        return text.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return text;
    }
  }

  /**
   * Set the PluginLoader to use for tool execution
   */
  setPluginLoader(pluginLoader: PluginLoader): void {
    this.pluginLoader = pluginLoader;
  }

  async processMessages(channel: string, messages: QueuedMessage[]): Promise<string> {
    // Get conversation history for this channel
    let history = this.conversationHistory.get(channel) || [];
    
    // Add system prompt if this is the first message
    if (history.length === 0) {
      history.push({
        role: 'system',
        content: this.systemPrompt,
      });
    }

    // Add a compact per-turn context snippet (time/channel and optional chaos snippets)
    const turnContext = this.buildTurnContextSnippet(channel);
    if (turnContext) {
      history.push({ role: 'system', content: turnContext });
    }

    // Add the new user messages as conversational turns
    for (const msg of messages) {
      history.push({
        role: 'user',
        content: `[${msg.nick}] ${msg.message}`,
      });
    }

    // Get tools from plugins
    const tools = this.pluginLoader ? this.pluginLoader.getToolsForOllama() : [];

    try {
      // Prepare a compacted copy of the history that fits within token limit
      let requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      // Log the user/assistant turns being sent
      this.logRequestHistory('Initial request', requestHistory);

      let response = await this.ollama.chat({
        model: this.model,
        messages: requestHistory,
        tools: tools.length > 0 ? tools : undefined,
      });

      // Log the initial raw assistant response (including when it contains tool calls)
      try {
        const toolCount = response?.message?.tool_calls?.length || 0;
        console.log(`[Ollama] Initial LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
      } catch (_) {
        // best-effort logging only
      }

      // Handle tool calls in a loop with a maximum number of rounds
      let toolCallRound = 0;
      const toolUsageHistory: string[] = []; // Track tool usage to detect loops
      let maxRoundsExceeded = false;
      
      while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        toolCallRound++;
        
        // Check if we've exceeded the maximum number of rounds
        if (toolCallRound > this.maxToolCallRounds) {
          console.warn(`[Ollama] Maximum tool call rounds (${this.maxToolCallRounds}) exceeded. Stopping tool execution.`);
          maxRoundsExceeded = true;
          break;
        }
        
        // Track tool usage and detect loops
        const currentToolCalls = response.message.tool_calls
          .map(tc => tc.function.name)
          .sort()
          .join(',');
        
        // Check if we're repeating the same tool pattern
        if (toolUsageHistory.length >= 2) {
          const lastPattern = toolUsageHistory[toolUsageHistory.length - 1];
          const secondLastPattern = toolUsageHistory[toolUsageHistory.length - 2];
          
          if (currentToolCalls === lastPattern && currentToolCalls === secondLastPattern) {
            console.warn(`[Ollama] Detected tool usage loop. Same tool(s) called 3 times in a row: ${currentToolCalls}`);
            maxRoundsExceeded = true;
            break;
          }
        }
        
        toolUsageHistory.push(currentToolCalls);
        
        // Log the current round
        console.log(`[Ollama] Tool call round ${toolCallRound}: ${response.message.tool_calls.length} tool(s) to execute`);
        
        // Warn when approaching the limit
        if (toolCallRound >= this.maxToolCallRounds - 2) {
          console.warn(`[Ollama] Approaching maximum tool call rounds (${toolCallRound}/${this.maxToolCallRounds})`);
        }

        // Add assistant's response with tool calls to history
        history.push(response.message);

        // Execute each tool call
        for (const toolCall of response.message.tool_calls) {
          if (!this.pluginLoader) {
            throw new Error('PluginLoader not set but tool calls were received');
          }
          // Handle both stringified and object arguments from tool calls
          let parsedArgs: Record<string, any> = {};
          try {
            const rawArgs = toolCall.function.arguments;
            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {});
          } catch (e) {
            console.warn('[Ollama] Failed to parse tool arguments, passing raw value');
            // Fallback: pass through as-is; plugin may handle strings if needed
            parsedArgs = (toolCall.function as any).arguments as any;
          }

          const toolResult = await this.pluginLoader.executeToolCall(
            toolCall.function.name,
            parsedArgs
          );

          // Add tool response to history
          history.push({
            role: 'tool',
            content: toolResult,
          });
        }

        // Prepare compacted history again for next round
        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        this.logRequestHistory(`Tool round ${toolCallRound} request`, requestHistory);

        // Get next response from the model
        response = await this.ollama.chat({
          model: this.model,
          messages: requestHistory,
          tools: tools.length > 0 ? tools : undefined,
        });

        // Log follow-up raw assistant response
        try {
          const toolCount = response?.message?.tool_calls?.length || 0;
          console.log(`[Ollama] Follow-up LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
        } catch (_) {
          // best-effort logging only
        }
      }
      
      // If we exceeded max rounds or detected a loop, force a final response without tools
      if (maxRoundsExceeded) {
        console.log(`[Ollama] Requesting final response from LLM after breaking tool call loop`);
        
        // Add assistant's last response (with tool calls) to history
        history.push(response.message);
        
        // Add a user message to prompt for a summary
        history.push({
          role: 'user',
          content: 'Please provide a response based on the information gathered from the tools.',
        });
        
        // Get final response without allowing more tool calls
        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        this.logRequestHistory('Forced final request', requestHistory);
        response = await this.ollama.chat({
          model: this.model,
          messages: requestHistory,
          tools: undefined, // Don't allow more tool calls
        });

        // Log the forced final raw assistant response
        try {
          console.log(`[Ollama] Forced final LLM response (raw): ${response?.message?.content || ''}`);
        } catch (_) {
          // best-effort logging only
        }
      }
      
      // Log completion
      if (toolCallRound > 0) {
        console.log(`[Ollama] Completed ${toolCallRound} tool call round(s)`);
      }

      // Add final assistant response to history
      history.push(response.message);

      // Prune assistant tool-call messages to keep only the last one
      history = this.pruneAssistantToolMessages(history);

      // Compact history using token limit (and fallback to max message count)
      history = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      if (history.length > this.maxHistoryLength) {
        const systemMsg = history[0];
        const recentMessages = history.slice(-this.maxHistoryLength + 1);
        history = [systemMsg, ...recentMessages];
      }

      // Update conversation history
      this.conversationHistory.set(channel, history);

      // Log the final raw content prior to filtering
      try {
        console.log(`[Ollama] Final assistant message (raw): ${response?.message?.content || ''}`);
      } catch (_) {
        // best-effort logging only
      }

      // Filter out <think> blocks and sanitize Unicode before returning
      const filtered = this.filterThinkBlocks(response.message.content);

      // Log the filtered content actually used for output
      try {
        console.log(`[Ollama] Final assistant message (filtered): ${filtered}`);
      } catch (_) {
        // best-effort logging only
      }
      return sanitizeUnicode(filtered);
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw error;
    }
  }

  // Approximate token estimation utilities and history trimming
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough heuristic: ~4 chars/token
    return Math.ceil(text.length / 4);
  }

  /**
   * Compact conversation history to fit within a token budget while preserving relevance.
   * Strategy:
   * - Always keep the original system prompt.
   * - Keep recent turns intact up to ~60% of the token budget (or at least a few messages).
   * - Summarize the older portion into a concise system-context message capturing key facts/decisions.
   * - Fall back to hard trimming if still above budget.
   */
  private async compactHistoryToTokenLimit(messages: any[], maxTokens: number): Promise<any[]> {
    if (!messages || messages.length === 0) return [];
    if (messages.length === 1) return messages;

    const system = messages[0];
    const rest = messages.slice(1);

    // Quick path: if already within budget, no changes
    const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (totalTokens <= maxTokens) return messages;

    // Reserve ~60% of budget for most recent context; always keep at least last 6 messages if possible
    const budgetForRecent = Math.max(Math.floor(maxTokens * 0.6), 1);
    const minRecentCount = 6;

    // Accumulate recent messages from the end under the recent budget
    const recent: any[] = [];
    let recentTokens = this.estimateMessageTokens(system);
    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const cost = this.estimateMessageTokens(msg);
      // Always allow at least minRecentCount even if exceeding budgetForRecent slightly
      const forceKeep = recent.length < minRecentCount;
      if (!forceKeep && recentTokens + cost > budgetForRecent) break;
      recent.push(msg);
      recentTokens += cost;
    }
    recent.reverse();

    // Older portion to summarize
    const olderCount = rest.length - recent.length;
    const older = olderCount > 0 ? rest.slice(0, olderCount) : [];

    // If there's nothing older, fallback to regular trimming by budget
    if (older.length === 0) {
      return this.trimHistoryToTokenLimit(messages, maxTokens);
    }

    // Build a compact transcript for older messages (cap each line to avoid huge prompts)
    const line = (m: any): string => {
      const role = m?.role || 'unknown';
      const raw = String(m?.content || '');
      const capped = raw.length > 600 ? raw.slice(0, 600) + '…' : raw;
      return `${role}: ${capped}`;
    };
    const transcript = older.map(line).join('\n');

    // Ask the model to summarize older context into a short, plain-text memory
    let summaryContent = '';
    try {
      const summarizerSystem = [
        'You are an assistant compressing earlier conversation context for an IRC bot.',
        'Summarize the transcript into a short, plain-text memory that preserves:',
        '- Key facts, constraints, decisions, numbers, and names',
        '- User intents, tasks in progress, and important outcomes',
        '- Avoid quotes, lists, or markdown; use 1–2 concise sentences',
      ].join('\n');

      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: summarizerSystem },
          { role: 'user', content: `Summarize this earlier context:\n\n${transcript}` },
        ],
      });
      summaryContent = String(response?.message?.content || '').trim();
      if (!summaryContent) {
        // Fallback to simple truncation of the transcript
        summaryContent = this.truncate(transcript, 600);
      }
    } catch (e) {
      // Fallback: minimal truncation if summarization fails
      summaryContent = this.truncate(transcript, 600);
    }

    const summaryMsg = {
      role: 'system',
      content: `Conversation summary so far: ${summaryContent}`,
    };

    // Compose: system + summary + recent; then enforce final budget strictly
    let composed = [system, summaryMsg, ...recent];
    const composedTokens = composed.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (composedTokens <= maxTokens) return composed;

    // If still too large, shrink the summary first using character-bound summarizer
    try {
      const targetChars = 300;
      const shrunk = await this.summarizeText(summaryMsg.content, targetChars);
      composed = [system, { role: 'system', content: shrunk }, ...recent];
    } catch (_) {
      // ignore; proceed to hard trim
    }

    // Final hard trim as a guard
    return this.trimHistoryToTokenLimit(composed, maxTokens);
  }

  private estimateMessageTokens(msg: any): number {
    // Include small overhead per message
    const overhead = 4;
    return overhead + this.estimateTokens(msg?.content || '');
  }

  private trimHistoryToTokenLimit(messages: any[], maxTokens: number): any[] {
    if (!messages || messages.length === 0) return [];
    const system = messages[0];
    const rest = messages.slice(1);

    // Accumulate from the end (most recent first) until we hit the budget
    const selected: any[] = [];
    let total = this.estimateMessageTokens(system);
    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const cost = this.estimateMessageTokens(msg);
      if (total + cost > maxTokens) break;
      selected.push(msg);
      total += cost;
    }
    selected.reverse();
    return [system, ...selected];
  }

  private pruneAssistantToolMessages(messages: any[]): any[] {
    if (!messages || messages.length === 0) return messages;
    const system = messages[0];
    const rest = messages.slice(1);
    const toolAssistantIdxs: number[] = [];
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i];
      if (m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        toolAssistantIdxs.push(i);
      }
    }
    if (toolAssistantIdxs.length <= 1) {
      return messages;
    }
    const lastKeepIdx = toolAssistantIdxs[toolAssistantIdxs.length - 1];
    const pruned: any[] = [];
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i];
      const isToolAssistant = toolAssistantIdxs.includes(i);
      if (!isToolAssistant || i === lastKeepIdx) {
        pruned.push(m);
      }
    }
    return [system, ...pruned];
  }

  private truncate(text: string, max: number): string {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + '…';
  }

  private logRequestHistory(label: string, messages: any[]): void {
    try {
      const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
      const ua = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
      console.log(`[Ollama] ${label}: sending ${messages.length} message(s), ~${totalTokens} tokens (UA turns: ${ua.length})`);
      const lines = ua.map((m, i) => `  [${i}] ${m.role}: ${this.truncate(String(m.content || ''), 500)}`);
      if (lines.length > 0) {
        console.log(lines.join('\n'));
      } else {
        console.log('  (no user/assistant turns; likely system/tool-only)');
      }
    } catch (_) {
      // best-effort logging only
    }
  }

  private buildTurnContextSnippet(channel: string): string {
    try {
      const now = new Date();
      const iso = now.toISOString();
      const parts: string[] = [];
      parts.push(`Context: ${iso} UTC; channel: ${channel}`);
      
      if (this.chaosMode?.enabled && this.messageHistory) {
        try {
          // Include chaos snippets based on probability guard (default 10%)
          const p = typeof this.chaosMode.probability === 'number' ? this.chaosMode.probability : 0.1;
          const roll = Math.random();
          if (roll < p) {
            const randomMessages = this.messageHistory.getRandomMessages(channel, 3) || [];
            if (randomMessages.length > 0) {
              const snippets = randomMessages
                .map((m: any) => `[${m.nick}] ${String(m.message || '').slice(0, 120)}`)
                .join(' | ');
              parts.push(`Chaos snippets: ${snippets}`);
            }
          }
        } catch (err) {
          console.error('Error getting chaos snippets:', err);
        }
      }
      return parts.join(' \n ');
    } catch (_) {
      return '';
    }
  }

  private filterThinkBlocks(text: string): string {
    // Remove <think>...</think> blocks from the response
    // Use regex to match <think> blocks that may span multiple lines
    let result = text.replace(/<think>.*?<\/think>/gis, '');
    
    // Also remove any remaining </think> tags and content before them
    // that might not have an opening tag
    result = result.replace(/.*?<\/think>/gis, '');
    
    return result.trim();
  }

  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }
}
