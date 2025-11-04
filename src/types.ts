// Core types for the IRC bot

export interface PluginTool {
  name: string;
  description: string;
  parameters: {
    type: string;
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required?: string[];
  };
}

export interface Plugin {
  name: string;
  description: string;
  tools: PluginTool[];
  execute: (
    toolName: string,
    parameters: Record<string, any>,
    ctx?: PluginExecutionContext
  ) => Promise<string>;
}

// Context passed to plugins during tool execution to enable real-time updates
export interface PluginExecutionContext {
  // The IRC channel where the current tool call originates (LLM conversation channel)
  channel: string;
  // Send a message to any IRC channel (plugins can stream progress)
  say: (channel: string, message: string) => Promise<void>;
  // The IRC nick of the user who triggered this tool call (actor)
  actorNick?: string;
}

export interface BotConfig {
  llmProvider?: 'ollama' | 'groq';
  irc: {
    host: string;
    port: number;
    nick: string;
    username?: string;
    realname?: string;
    channels: string[];
    tls?: boolean;
  };
  ollama: {
    host: string;
    model: string;
    maxToolCallRounds?: number;
    embeddingModel?: string;
    maxContextTokens?: number; // Cap for chat context tokens
    disableThinking?: boolean; // When true, prevent models from emitting <think>/reasoning content
  };
  groq?: {
    apiKey?: string;
    baseUrl?: string;
    model?: string;
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
