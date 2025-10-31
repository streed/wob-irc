import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';
import { BotConfig } from './types';

dotenv.config();

export function loadConfig(): BotConfig {
  // Try to load from config.json first
  const configPath = path.join(process.cwd(), 'config.json');
  
  if (fs.existsSync(configPath)) {
    console.log('Loading configuration from config.json');
    const configData = fs.readFileSync(configPath, 'utf-8');
    const cfg = JSON.parse(configData) as BotConfig;

    // Allow environment variables to override provider and Groq settings
    if (process.env.LLM_PROVIDER) {
      (cfg as any).llmProvider = process.env.LLM_PROVIDER as any;
    }
    // Ensure groq section exists if any GROQ_* env is provided
    if (process.env.GROQ_API_KEY || process.env.GROQ_MODEL || process.env.GROQ_BASE_URL) {
      (cfg as any).groq = (cfg as any).groq || {};
      if (process.env.GROQ_API_KEY) (cfg as any).groq.apiKey = process.env.GROQ_API_KEY;
      if (process.env.GROQ_MODEL) (cfg as any).groq.model = process.env.GROQ_MODEL;
      if (process.env.GROQ_BASE_URL) (cfg as any).groq.baseUrl = process.env.GROQ_BASE_URL;
    }
    return cfg;
  }

  // Fall back to environment variables
  console.log('Loading configuration from environment variables');
  
  const config: BotConfig = {
    llmProvider: (process.env.LLM_PROVIDER as any) || 'ollama',
    irc: {
      host: process.env.IRC_HOST || 'irc.libera.chat',
      port: parseInt(process.env.IRC_PORT || '6667'),
      nick: process.env.IRC_NICK || 'ollama-bot',
      username: process.env.IRC_USERNAME,
      realname: process.env.IRC_REALNAME,
      channels: (process.env.IRC_CHANNELS || '#test').split(',').map(c => c.trim()),
      tls: process.env.IRC_TLS === 'true',
    },
    ollama: {
      host: process.env.OLLAMA_HOST || 'http://localhost:11434',
      model: process.env.OLLAMA_MODEL || 'llama3.2',
      maxToolCallRounds: process.env.MAX_TOOL_CALL_ROUNDS 
        ? parseInt(process.env.MAX_TOOL_CALL_ROUNDS) 
        : undefined,
      embeddingModel: process.env.OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text:v1.5',
      maxContextTokens: process.env.MAX_CONTEXT_TOKENS
        ? parseInt(process.env.MAX_CONTEXT_TOKENS)
        : 4096,
      disableThinking: process.env.DISABLE_THINKING === 'true',
    },
    groq: {
      apiKey: process.env.GROQ_API_KEY,
      baseUrl: process.env.GROQ_BASE_URL,
      model: process.env.GROQ_MODEL,
    },
    messageDebounceMs: parseInt(process.env.MESSAGE_DEBOUNCE_MS || '2000'),
    systemPrompt: process.env.SYSTEM_PROMPT,
    messageHistory: {
      dbPath: process.env.MESSAGE_HISTORY_DB_PATH,
    },
    chaosMode: process.env.CHAOS_MODE_ENABLED === 'true' ? {
      enabled: true,
      probability: parseFloat(process.env.CHAOS_MODE_PROBABILITY || '0.1'),
    } : undefined,
  };

  return config;
}
