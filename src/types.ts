// Core types for the IRC bot

export interface PluginTool {
  name: string;
  description: string;
  optimizedDescription?: string; // LLM-optimized description for the current model
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      optimizedDescription?: string; // LLM-optimized description for the current model
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface Plugin {
  name: string;
  description: string;
  optimizedDescription?: string; // LLM-optimized description for the current model
  tools: PluginTool[];
  execute: (toolName: string, parameters: Record<string, any>) => Promise<string>;
}

export interface BotConfig {
  irc: {
    host: string;
    port: number;
    nick: string;
    username?: string;
    realname?: string;
    channels: string[];
    tls?: boolean;
  };
  llm: {
    provider: 'ollama' | 'runpod';
    // Ollama configuration
    ollama?: {
      host: string;
      model: string;
      embeddingModel?: string;
    };
    // Runpod configuration
    runpod?: {
      apiKey: string;
      endpointId: string;
    };
    maxToolCallRounds?: number;
  };
  messageDebounceMs: number;
  systemPrompt?: string;
  messageHistory?: {
    dbPath?: string;
  };
  chaosMode?: {
    enabled: boolean;
    probability: number; // 0.0 to 1.0, chance to randomly respond
  };
}

export interface QueuedMessage {
  channel: string;
  nick: string;
  message: string;
  timestamp: number;
}
