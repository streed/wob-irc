import { QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';

/**
 * Abstract base class for LLM clients.
 * Providers like Ollama and Runpod should implement this interface.
 */
export abstract class LLMClient {
  protected pluginLoader?: PluginLoader;
  protected conversationHistory: Map<string, any[]> = new Map();
  protected maxHistoryLength: number = 20;
  protected systemPrompt: string;
  protected maxToolCallRounds: number;
  protected chaosMode?: { enabled: boolean; probability: number };
  protected messageHistory?: any;

  constructor(
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any
  ) {
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
   * Process messages and return a response from the LLM
   */
  abstract processMessages(channel: string, messages: QueuedMessage[]): Promise<string>;

  /**
   * Optimize a description using the LLM for better tool calling performance.
   */
  abstract optimizeDescription(originalDescription: string, context: string): Promise<string>;

  /**
   * Clear conversation history for a channel
   */
  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }

  /**
   * Build context from queued messages
   */
  protected buildContext(channel: string, messages: QueuedMessage[]): string {
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

  protected formatTimeAgo(seconds: number): string {
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

  protected filterThinkBlocks(text: string): string {
    // Remove <think>...</think> blocks from the response
    // Use regex to match <think> blocks that may span multiple lines
    let result = text.replace(/<think>.*?<\/think>/gis, '');
    
    // Also remove any remaining </think> tags and content before them
    // that might not have an opening tag
    result = result.replace(/.*?<\/think>/gis, '');
    
    return result.trim();
  }
}
