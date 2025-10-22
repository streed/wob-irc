import { Ollama } from 'ollama';
import { QueuedMessage, ChannelContext } from './types';
import { PluginLoader } from './plugin-loader';

export class OllamaClient {
  private ollama: Ollama;
  private model: string;
  private systemPrompt: string;
  private pluginLoader: PluginLoader;
  private conversationHistory: Map<string, any[]> = new Map();
  private maxHistoryLength: number = 20;
  private channelContext: Map<string, ChannelContext> = new Map();

  constructor(
    host: string,
    model: string,
    systemPrompt: string,
    pluginLoader: PluginLoader
  ) {
    this.ollama = new Ollama({ host });
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.pluginLoader = pluginLoader;
  }

  async processMessages(channel: string, messages: QueuedMessage[]): Promise<string> {
    // Build context from queued messages including channel context
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
    const tools = this.pluginLoader.getToolsForOllama();

    try {
      let response = await this.ollama.chat({
        model: this.model,
        messages: history,
        tools: tools.length > 0 ? tools : undefined,
      });

      // Handle tool calls in a loop
      while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        // Add assistant's response with tool calls to history
        history.push(response.message);

        // Execute each tool call
        for (const toolCall of response.message.tool_calls) {
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

      // Filter out <think> blocks before returning
      return this.filterThinkBlocks(response.message.content);
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw error;
    }
  }

  private buildContext(channel: string, messages: QueuedMessage[]): string {
    const lines: string[] = [];
    
    // Get channel context (nicks and message buffer)
    const context = this.channelContext.get(channel);
    
    if (context) {
      // Add channel users list
      if (context.nicks && context.nicks.length > 0) {
        lines.push(`Channel users: ${context.nicks.join(', ')}`);
        lines.push('');
      }
      
      // Add recent message buffer for context
      if (context.messageBuffer && context.messageBuffer.length > 0) {
        lines.push('Recent messages:');
        for (const msg of context.messageBuffer) {
          lines.push(`[${msg.nick}]: ${msg.message}`);
        }
        lines.push('');
      }
    }
    
    // Add current messages
    lines.push('Current messages:');
    for (const msg of messages) {
      lines.push(`[${msg.nick}]: ${msg.message}`);
    }
    
    return lines.join('\n');
  }

  private filterThinkBlocks(text: string): string {
    // Remove <think>...</think> blocks from the response
    // Use regex to match <think> blocks that may span multiple lines
    return text.replace(/<think>.*?<\/think>/gis, '').trim();
  }

  updateChannelNicks(channel: string, nicks: string[]): void {
    const context = this.channelContext.get(channel) || { nicks: [], messageBuffer: [] };
    context.nicks = nicks;
    this.channelContext.set(channel, context);
  }

  addToMessageBuffer(channel: string, nick: string, message: string, maxBufferSize: number): void {
    const context = this.channelContext.get(channel) || { nicks: [], messageBuffer: [] };
    
    // Add new message to buffer
    context.messageBuffer.push({
      nick,
      message,
      timestamp: Date.now(),
    });
    
    // Trim buffer if it exceeds max size
    if (context.messageBuffer.length > maxBufferSize) {
      context.messageBuffer = context.messageBuffer.slice(-maxBufferSize);
    }
    
    this.channelContext.set(channel, context);
  }

  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }
}
