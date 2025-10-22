import { Ollama } from 'ollama';
import { QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';

export class OllamaClient {
  private ollama: Ollama;
  private model: string;
  private systemPrompt: string;
  private pluginLoader: PluginLoader;
  private conversationHistory: Map<string, any[]> = new Map();
  private maxHistoryLength: number = 20;
  private maxToolCallRounds: number = 10;

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
    // Build context from queued messages
    const context = this.buildContext(messages);
    
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

      // Handle tool calls in a loop with a maximum number of rounds
      let toolCallRound = 0;
      while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        toolCallRound++;
        
        // Check if we've exceeded the maximum number of rounds
        if (toolCallRound > this.maxToolCallRounds) {
          console.warn(`[Ollama] Maximum tool call rounds (${this.maxToolCallRounds}) exceeded. Stopping tool execution.`);
          break;
        }
        
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

      // Filter out <think> blocks before returning
      return this.filterThinkBlocks(response.message.content);
    } catch (error) {
      console.error('Error calling Ollama:', error);
      throw error;
    }
  }

  private buildContext(messages: QueuedMessage[]): string {
    const lines: string[] = [];
    
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

  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }
}
