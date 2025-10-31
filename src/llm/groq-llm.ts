import Groq from 'groq-sdk';
import { BaseLLMClient, LLMChatMessage, LLMChatResponse, LLMTool } from './base-llm';

export class GroqLLM extends BaseLLMClient {
  private client: Groq;

  constructor(
    apiKey: string,
    model: string,
    systemPrompt: string,
    options?: {
      baseUrl?: string;
      maxToolCallRounds?: number;
      chaosMode?: { enabled: boolean; probability: number };
      messageHistory?: any;
      maxContextTokens?: number;
      disableThinking?: boolean;
    }
  ) {
    super(
      'Groq',
      model,
      systemPrompt,
      options?.maxToolCallRounds,
      options?.chaosMode,
      options?.messageHistory,
      options?.maxContextTokens,
      options?.disableThinking,
    );
    
    // Initialize Groq client with SDK
    this.client = new Groq({
      apiKey,
      baseURL: options?.baseUrl,
    });
  }

  protected async sendChat(messages: LLMChatMessage[], tools?: LLMTool[] | undefined): Promise<LLMChatResponse> {
    try {
      // Prepare tools in Groq format - filter out any tools without valid names
      const mappedTools = tools?.map((t: any) => {
        const fn = (t && t.function) ? t.function : {};
        const name = fn?.name || t?.name;
        
        // Skip tools without a valid name
        if (!name || typeof name !== 'string' || name.trim() === '') {
          console.warn(`[${this.providerTag}] Skipping tool without valid name:`, t);
          return null;
        }
        
        return {
          type: 'function' as const,
          function: {
            name: name.trim(),
            description: fn?.description || '',
            parameters: fn?.parameters || {},
          },
        };
      }).filter(Boolean); // Remove null entries

      // Prepare request parameters - using 'any' for now since Groq SDK types are complex
      const requestParams: any = {
        model: this.model,
        messages: messages,
        stream: false,
      };

      // Add tools if provided
      if (mappedTools && mappedTools.length > 0) {
        // Log tools for debugging
        console.log(`[${this.providerTag}] Sending ${mappedTools.length} tools to API:`, 
          mappedTools.map(t => t?.function?.name || 'unknown').join(', '));
        requestParams.tools = mappedTools;
        requestParams.tool_choice = 'auto';
      } else {
        // When no tools or tools are undefined, explicitly tell Groq not to use tools
        // This prevents "Tool choice is none, but model called a tool" errors
        requestParams.tool_choice = 'none';
      }

      // Add stop sequences if configured
      const chatOpts = this.getChatOptions();
      if (chatOpts?.stop) {
        requestParams.stop = chatOpts.stop;
      }

      // Make the API call using the SDK
      const completion = await this.client.chat.completions.create(requestParams);

      // Extract the response
      const choice = completion.choices?.[0]?.message;
      if (!choice) {
        throw new Error('No response from Groq API');
      }

      const content = String(choice.content || '');
      const tool_calls = Array.isArray(choice.tool_calls) ? choice.tool_calls : [];

      return {
        message: {
          role: 'assistant',
          content,
          tool_calls,
        },
      };
    } catch (error) {
      // Handle Groq SDK errors
      if (error instanceof Groq.APIError) {
        throw new Error(`Groq API error ${error.status}: ${error.message}`);
      }
      throw error;
    }
  }
}
