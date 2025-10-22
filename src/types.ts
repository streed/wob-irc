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
  ollama: {
    host: string;
    model: string;
    maxToolCallRounds?: number;
  };
  messageDebounceMs: number;
  systemPrompt?: string;
}

export interface QueuedMessage {
  channel: string;
  nick: string;
  message: string;
  timestamp: number;
}
