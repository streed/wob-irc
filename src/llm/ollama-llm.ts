import { Ollama } from 'ollama';
import { BaseLLMClient, LLMChatMessage, LLMChatResponse, LLMTool } from './base-llm';

export class OllamaLLM extends BaseLLMClient {
  private ollama: Ollama;

  constructor(
    host: string,
    model: string,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any,
    maxContextTokens?: number,
    disableThinking?: boolean
  ) {
    super(
      'Ollama',
      model,
      systemPrompt,
      maxToolCallRounds,
      chaosMode,
      messageHistory,
      maxContextTokens,
      disableThinking,
    );
    this.ollama = new Ollama({ host });
  }

  protected async sendChat(messages: LLMChatMessage[], tools?: LLMTool[] | undefined): Promise<LLMChatResponse> {
    const res: any = await (this.ollama as any).chat({
      model: this.model,
      messages,
      tools,
      options: this.getChatOptions(),
      stream: false,
    } as any);

    const msg = res?.message || {};
    const content: string = String(msg?.content || '');
    const tool_calls = Array.isArray(msg?.tool_calls) ? msg.tool_calls : [];
    return { message: { role: 'assistant', content, tool_calls } };
  }
}
