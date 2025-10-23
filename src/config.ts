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
    return JSON.parse(configData);
  }

  // Fall back to environment variables
  console.log('Loading configuration from environment variables');
  
  const config: BotConfig = {
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
    },
    messageDebounceMs: parseInt(process.env.MESSAGE_DEBOUNCE_MS || '2000'),
    systemPrompt: process.env.SYSTEM_PROMPT,
    messageHistory: {
      useDatabase: process.env.MESSAGE_HISTORY_USE_DB !== 'false', // Default to true
      dbPath: process.env.MESSAGE_HISTORY_DB_PATH,
      maxMessages: process.env.MESSAGE_HISTORY_MAX 
        ? parseInt(process.env.MESSAGE_HISTORY_MAX) 
        : undefined,
    },
  };

  return config;
}
