import { IRCBot } from './irc-bot';
import { loadConfig } from './config';

async function main() {
  console.log('Starting Ollama IRC Bot...');
  
  try {
    const config = loadConfig();
    
    console.log('Configuration:');
    console.log(`  IRC Server: ${config.irc.host}:${config.irc.port}`);
    console.log(`  IRC Nick: ${config.irc.nick}`);
    console.log(`  IRC Channels: ${config.irc.channels.join(', ')}`);
    console.log(`  Ollama Host: ${config.ollama.host}`);
    console.log(`  Ollama Model: ${config.ollama.model}`);
    console.log(`  Message Debounce: ${config.messageDebounceMs}ms`);
    
    const bot = new IRCBot(config);
    await bot.start();
    
    console.log('Bot started successfully!');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

main();
