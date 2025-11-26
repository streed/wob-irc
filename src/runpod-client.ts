import { QueuedMessage } from './types';
import { sanitizeUnicode } from './unicode-sanitizer';
import { LLMClient } from './llm-client';

export interface RunpodServerlessConfig {
  apiKey: string;
  endpointId: string;
}

export class RunpodClient extends LLMClient {
  private apiKey: string;
  private endpointId: string;
  private baseUrl: string;

  constructor(
    config: RunpodServerlessConfig,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any
  ) {
    super(systemPrompt, maxToolCallRounds, chaosMode, messageHistory);
    this.apiKey = config.apiKey;
    this.endpointId = config.endpointId;
    this.baseUrl = `https://api.runpod.ai/v2/${this.endpointId}`;
  }

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

      const response = await this.runInference({
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const optimized = response.trim();
      
      // If optimization failed or returned empty, fall back to original
      if (!optimized || optimized.length === 0) {
        console.warn('[Runpod] Description optimization returned empty, using original');
        return originalDescription;
      }

      return optimized;
    } catch (error) {
      console.error('[Runpod] Error optimizing description, using original:', error);
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
      let response = await this.runInference({
        messages: history,
        tools: tools.length > 0 ? tools : undefined,
      });

      // Handle tool calls in a loop with a maximum number of rounds
      let toolCallRound = 0;
      const toolUsageHistory: string[] = [];
      let maxRoundsExceeded = false;
      let responseMessage: any = { role: 'assistant', content: response };
      
      // Parse tool calls from response if they exist
      let toolCalls = this.extractToolCalls(response);
      
      while (toolCalls && toolCalls.length > 0) {
        toolCallRound++;
        
        // Check if we've exceeded the maximum number of rounds
        if (toolCallRound > this.maxToolCallRounds) {
          console.warn(`[Runpod] Maximum tool call rounds (${this.maxToolCallRounds}) exceeded. Stopping tool execution.`);
          maxRoundsExceeded = true;
          break;
        }
        
        // Track tool usage and detect loops
        const currentToolCalls = toolCalls
          .map(tc => tc.function.name)
          .sort()
          .join(',');
        
        // Check if we're repeating the same tool pattern
        if (toolUsageHistory.length >= 2) {
          const lastPattern = toolUsageHistory[toolUsageHistory.length - 1];
          const secondLastPattern = toolUsageHistory[toolUsageHistory.length - 2];
          
          if (currentToolCalls === lastPattern && currentToolCalls === secondLastPattern) {
            console.warn(`[Runpod] Detected tool usage loop. Same tool(s) called 3 times in a row: ${currentToolCalls}`);
            maxRoundsExceeded = true;
            break;
          }
        }
        
        toolUsageHistory.push(currentToolCalls);
        
        // Log the current round
        console.log(`[Runpod] Tool call round ${toolCallRound}: ${toolCalls.length} tool(s) to execute`);
        
        // Warn when approaching the limit
        if (toolCallRound >= this.maxToolCallRounds - 2) {
          console.warn(`[Runpod] Approaching maximum tool call rounds (${toolCallRound}/${this.maxToolCallRounds})`);
        }

        // Add assistant's response with tool calls to history
        responseMessage.tool_calls = toolCalls;
        history.push(responseMessage);

        // Execute each tool call
        for (const toolCall of toolCalls) {
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
        response = await this.runInference({
          messages: history,
          tools: tools.length > 0 ? tools : undefined,
        });
        
        responseMessage = { role: 'assistant', content: response };
        toolCalls = this.extractToolCalls(response);
      }
      
      // If we exceeded max rounds or detected a loop, force a final response without tools
      if (maxRoundsExceeded) {
        console.log(`[Runpod] Requesting final response from LLM after breaking tool call loop`);
        
        // Add assistant's last response (with tool calls) to history
        history.push(responseMessage);
        
        // Add a user message to prompt for a summary
        history.push({
          role: 'user',
          content: 'Please provide a response based on the information gathered from the tools.',
        });
        
        // Get final response without allowing more tool calls
        response = await this.runInference({
          messages: history,
          tools: undefined,
        });
        responseMessage = { role: 'assistant', content: response };
      }
      
      // Log completion
      if (toolCallRound > 0) {
        console.log(`[Runpod] Completed ${toolCallRound} tool call round(s)`);
      }

      // Add final assistant response to history
      history.push(responseMessage);

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
      const filtered = this.filterThinkBlocks(responseMessage.content);
      return sanitizeUnicode(filtered);
    } catch (error) {
      console.error('Error calling Runpod:', error);
      throw error;
    }
  }

  /**
   * Run inference on the Runpod serverless endpoint
   */
  private async runInference(payload: any): Promise<string> {
    const response = await fetch(`${this.baseUrl}/run`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ input: payload }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Runpod API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const result = await response.json() as any;
    
    // Runpod returns results in different formats depending on whether the job is complete
    if (result.status === 'IN_PROGRESS' || result.status === 'IN_QUEUE') {
      // If the job is async, we need to poll for results
      return await this.pollForResult(result.id);
    } else if (result.status === 'COMPLETED') {
      return this.extractResponse(result.output);
    } else {
      throw new Error(`Unexpected Runpod status: ${result.status}`);
    }
  }

  /**
   * Poll for async job results
   */
  private async pollForResult(jobId: string, maxAttempts: number = 60, delayMs: number = 1000): Promise<string> {
    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      
      const response = await fetch(`${this.baseUrl}/status/${jobId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Error polling Runpod job: ${response.status} ${response.statusText}`);
      }

      const result = await response.json() as any;
      
      if (result.status === 'COMPLETED') {
        return this.extractResponse(result.output);
      } else if (result.status === 'FAILED') {
        throw new Error(`Runpod job failed: ${JSON.stringify(result.error)}`);
      }
      
      // Continue polling if IN_PROGRESS or IN_QUEUE
    }
    
    throw new Error(`Runpod job timed out after ${maxAttempts * delayMs / 1000} seconds`);
  }

  /**
   * Extract the response text from Runpod output
   */
  private extractResponse(output: any): string {
    // The output format may vary depending on how the endpoint is configured
    // Common formats include:
    // - { message: { content: "..." } }
    // - { choices: [{ message: { content: "..." } }] }
    // - "response text"
    
    if (typeof output === 'string') {
      return output;
    }
    
    if (output.message?.content) {
      return output.message.content;
    }
    
    if (output.choices && output.choices.length > 0 && output.choices[0].message?.content) {
      return output.choices[0].message.content;
    }
    
    if (output.content) {
      return output.content;
    }
    
    // If we can't extract a proper response, return the JSON stringified version
    console.warn('[Runpod] Unexpected output format, returning stringified:', output);
    return JSON.stringify(output);
  }

  /**
   * Extract tool calls from the response
   * This assumes the Runpod endpoint returns tool calls in OpenAI format
   */
  private extractToolCalls(response: string): any[] | null {
    // Try to parse as JSON first in case the response contains tool calls
    try {
      const parsed = JSON.parse(response);
      if (parsed.tool_calls && Array.isArray(parsed.tool_calls)) {
        return parsed.tool_calls;
      }
    } catch (e) {
      // Not JSON, continue
    }
    
    return null;
  }
}
