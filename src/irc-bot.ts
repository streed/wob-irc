import * as irc from 'irc-framework';
import { BotConfig, QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';
import { MessageQueue } from './message-queue';
import { OllamaClient } from './ollama-client';

export class IRCBot {
  private client: irc.Client;
  private config: BotConfig;
  private pluginLoader: PluginLoader;
  private messageQueue: MessageQueue;
  private ollamaClient: OllamaClient;

  constructor(config: BotConfig) {
    this.config = config;
    
    // Initialize IRC client
    this.client = new irc.Client();
    
    // Initialize plugin loader
    this.pluginLoader = new PluginLoader();
    
    // Initialize Ollama client
    this.ollamaClient = new OllamaClient(
      this.config.ollama.host,
      this.config.ollama.model,
      this.config.systemPrompt || this.getDefaultSystemPrompt(),
      this.pluginLoader
    );
    
    // Initialize message queue
    this.messageQueue = new MessageQueue(
      this.config.messageDebounceMs,
      this.processQueuedMessages.bind(this)
    );
  }

  private getDefaultSystemPrompt(): string {
    return `You are a helpful IRC bot assistant. You respond to messages in a concise and friendly manner. 
You have access to various tools that you can use to help users. Use these tools naturally when they would be helpful to answer questions or perform tasks.
Keep your responses brief and appropriate for IRC chat.`;
  }

  async start(): Promise<void> {
    // Load plugins first
    await this.pluginLoader.loadPlugins();
    
    // Setup IRC client
    this.client.connect({
      host: this.config.irc.host,
      port: this.config.irc.port,
      nick: this.config.irc.nick,
      username: this.config.irc.username || this.config.irc.nick,
      gecos: this.config.irc.realname || 'Ollama IRC Bot',
      tls: this.config.irc.tls || false,
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.client.on('registered', () => {
      console.log('Connected to IRC server');
      
      // Join channels
      for (const channel of this.config.irc.channels) {
        console.log(`Joining channel: ${channel}`);
        this.client.join(channel);
      }
    });

    this.client.on('message', (event) => {
      // Ignore messages from ourselves
      if (event.nick === this.client.user.nick) {
        return;
      }

      // Only respond to channel messages or direct messages
      if (event.target === this.client.user.nick || this.shouldRespond(event.message)) {
        console.log(`[${event.target}] <${event.nick}> ${event.message}`);
        
        // Add message to queue
        this.messageQueue.addMessage(
          event.target,
          event.nick,
          event.message
        );
      }
    });

    this.client.on('close', () => {
      console.log('Connection closed');
    });

    this.client.on('error', (error) => {
      console.error('IRC error:', error);
    });

    // Handle graceful shutdown
    process.on('SIGINT', async () => {
      await this.shutdown();
    });

    process.on('SIGTERM', async () => {
      await this.shutdown();
    });
  }

  private shouldRespond(message: string): boolean {
    // Respond if the bot is mentioned
    const botNick = this.client.user.nick.toLowerCase();
    const messageLower = message.toLowerCase();
    
    return (
      messageLower.includes(botNick) ||
      messageLower.startsWith('!') ||
      messageLower.includes('bot')
    );
  }

  private async processQueuedMessages(channel: string, messages: QueuedMessage[]): Promise<void> {
    try {
      console.log(`Processing ${messages.length} message(s) for ${channel}`);
      
      // Get response from Ollama
      const response = await this.ollamaClient.processMessages(channel, messages);
      
      if (response && response.trim()) {
        // Split long messages if needed (IRC typically has ~512 char limit)
        const lines = this.splitMessage(response, 400);
        
        for (const line of lines) {
          this.client.say(channel, line);
        }
      }
    } catch (error) {
      console.error('Error processing messages:', error);
      this.client.say(channel, 'Sorry, I encountered an error processing that request.');
    }
  }

  private splitMessage(message: string, maxLength: number): string[] {
    const lines: string[] = [];
    const paragraphs = message.split('\n');
    
    for (const paragraph of paragraphs) {
      if (paragraph.length <= maxLength) {
        lines.push(paragraph);
      } else {
        // Split long paragraphs at word boundaries
        const words = paragraph.split(' ');
        let currentLine = '';
        
        for (const word of words) {
          if ((currentLine + ' ' + word).length <= maxLength) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) {
              lines.push(currentLine);
            }
            currentLine = word;
          }
        }
        
        if (currentLine) {
          lines.push(currentLine);
        }
      }
    }
    
    return lines;
  }

  async shutdown(): Promise<void> {
    console.log('Shutting down bot...');
    
    // Flush any pending messages
    await this.messageQueue.flushAll();
    
    // Quit IRC
    this.client.quit('Shutting down');
    
    // Give time for quit message to send
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    process.exit(0);
  }
}
