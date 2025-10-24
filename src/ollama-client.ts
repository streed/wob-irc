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

  constructor(
    host: string,
    model: string,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any
  ) {
    this.ollama = new Ollama({ host });
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxToolCallRounds = maxToolCallRounds || 10;
    this.chaosMode = chaosMode;
    this.messageHistory = messageHistory;
  }

  /**
   * Set the PluginLoader to use for tool execution
   */
  setPluginLoader(pluginLoader: PluginLoader): void {
    this.pluginLoader = pluginLoader;
  }

  /**
   * Optimize a description using the LLM for better tool calling performance.
   * Takes a generic description and makes it more specific and actionable for the current model.
   */
  async optimizeDescription(originalDescription: string, context: string): Promise<string> {
    try {
      const prompt = `You are optimizing tool descriptions for an LLM to use effectively. 
Your task is to take a generic description and make it more clear, specific, and actionable for an LLM that will use this tool.

Context: ${context}

Original description: "${originalDescription}"

Provide an optimized description that:
1. Is clear and unambiguous about what the tool/parameter does
2. Specifies exactly when the tool/parameter should be used
3. Includes any important constraints or requirements
4. Uses precise language that an LLM can easily understand
5. Is concise (preferably 1-2 sentences, max 3)

Return ONLY the optimized description, nothing else.`;

      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const optimized = response.message.content.trim();
      
      // If optimization failed or returned empty, fall back to original
      if (!optimized || optimized.length === 0) {
        console.warn('[Ollama] Description optimization returned empty, using original');
        return originalDescription;
      }

      return optimized;
    } catch (error) {
      console.error('[Ollama] Error optimizing description, using original:', error);
      return originalDescription;
    }
  }

  async processMessages(channel: string, messages: QueuedMessage[]): Promise<string> {
    // Build context from queued messages
    const context = this.buildContext(channel, messages);
    
    // Get conversation history for this channel
    let history = this.conversationHistory.get(channel) || [];
    
    // Add system prompt if this is the first message
    if (history.length === 0) {
      history.push({
        role: 'system',
        content: this.systemPrompt,
      });
    }

    // Add the new user messages
    history.push({
      role: 'user',
      content: context,
    });

    // Get tools from plugins
    const tools = this.pluginLoader ? this.pluginLoader.getToolsForOllama() : [];

    try {
      let response = await this.ollama.chat({
        model: this.model,
        messages: history,
        tools: tools.length > 0 ? tools : undefined,
      });

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
          const toolResult = await this.pluginLoader.executeToolCall(
            toolCall.function.name,
            toolCall.function.arguments
          );

          // Add tool response to history
          history.push({
            role: 'tool',
            content: toolResult,
          });
        }

        // Get next response from the model
        response = await this.ollama.chat({
          model: this.model,
          messages: history,
          tools: tools.length > 0 ? tools : undefined,
        });
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
        response = await this.ollama.chat({
          model: this.model,
          messages: history,
          tools: undefined, // Don't allow more tool calls
        });
      }
      
      // Log completion
      if (toolCallRound > 0) {
        console.log(`[Ollama] Completed ${toolCallRound} tool call round(s)`);
      }

      // Add final assistant response to history
      history.push(response.message);

      // Trim history if it gets too long
      if (history.length > this.maxHistoryLength) {
        // Keep system prompt and recent messages
        const systemMsg = history[0];
        const recentMessages = history.slice(-this.maxHistoryLength + 1);
        history = [systemMsg, ...recentMessages];
      }

      // Update conversation history
      this.conversationHistory.set(channel, history);

      // Filter out <think> blocks and sanitize Unicode before returning
      const filtered = this.filterThinkBlocks(response.message.content);
      return sanitizeUnicode(filtered);
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw error;
    }
  }

  private buildContext(channel: string, messages: QueuedMessage[]): string {
    const lines: string[] = [];
    const now = new Date();
    
    // Add comprehensive temporal context
    const dayOfWeek = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
    const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });
    const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'UTC' });
    
    lines.push(`Current date and time (UTC): ${dayOfWeek}, ${dateStr} at ${timeStr}`);
    lines.push(`ISO timestamp: ${now.toISOString()}`);
    
    // Add channel context
    lines.push(`Current channel: ${channel}`);
    lines.push('');
    
    // In chaos mode, add random historical messages for unpredictable responses
    if (this.chaosMode?.enabled && this.messageHistory) {
      try {
        const randomMessages = this.messageHistory.getRandomMessages(channel, 5);
        if (randomMessages.length > 0) {
          lines.push('Random historical messages for context:');
          for (const msg of randomMessages) {
            const date = new Date(msg.timestamp);
            const timeStr = date.toLocaleTimeString();
            lines.push(`[${timeStr}] <${msg.nick}> ${msg.message}`);
          }
          lines.push('');
        }
      } catch (error) {
        // Silently ignore errors getting random messages
        console.error('Error getting random messages for chaos mode:', error);
      }
    }
    
    // Add messages with relative timestamps
    lines.push('Recent messages:');
    for (const msg of messages) {
      const messageAge = now.getTime() - msg.timestamp;
      const secondsAgo = Math.floor(messageAge / 1000);
      const timeAgo = this.formatTimeAgo(secondsAgo);
      lines.push(`[${msg.nick}] (${timeAgo}): ${msg.message}`);
    }
    
    return lines.join('\n');
  }

  private formatTimeAgo(seconds: number): string {
    if (seconds < 5) {
      return 'just now';
    } else if (seconds < 60) {
      return `${seconds}s ago`;
    } else if (seconds < 3600) {
      const minutes = Math.floor(seconds / 60);
      return `${minutes}m ago`;
    } else if (seconds < 86400) {
      const hours = Math.floor(seconds / 3600);
      return `${hours}h ago`;
    } else {
      const days = Math.floor(seconds / 86400);
      return `${days}d ago`;
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
