import { IRCBot } from './irc-bot';
import { loadConfig } from './config';

async function main() {
  console.log('Starting Ollama IRC Bot...');
  console.log('='.repeat(50));
  
  try {
    const config = loadConfig();
    
    console.log('Configuration loaded:');
    console.log(`  IRC Server: ${config.irc.host}:${config.irc.port}`);
    console.log(`  IRC Nick: ${config.irc.nick}`);
    console.log(`  IRC Channels: ${config.irc.channels.join(', ')}`);
    console.log(`  IRC TLS: ${config.irc.tls || false}`);
    console.log(`  LLM Provider: ${config.llm.provider}`);
    
    if (config.llm.provider === 'ollama' && config.llm.ollama) {
      console.log(`  Ollama Host: ${config.llm.ollama.host}`);
      console.log(`  Ollama Model: ${config.llm.ollama.model}`);
    } else if (config.llm.provider === 'runpod' && config.llm.runpod) {
      console.log(`  Runpod Endpoint ID: ${config.llm.runpod.endpointId}`);
    }
    
    console.log(`  Message Debounce: ${config.messageDebounceMs}ms`);
    
    if (process.env.IRC_DEBUG === 'true') {
      console.log('  IRC Debug Mode: ENABLED (verbose logging)');
    }
    console.log('='.repeat(50));
    
    const bot = new IRCBot(config);
    await bot.start();
    
    console.log('Bot initialization completed!');
    console.log('Waiting for IRC server connection...');
    console.log('(If connection hangs, check firewall, network, or server availability)');
  } catch (error) {
    console.error('Failed to start bot:', error);
    console.error('Stack trace:', (error as Error).stack);
    process.exit(1);
  }
}

main();
