import { QueuedMessage } from './types';

export class MessageQueue {
  private queue: Map<string, QueuedMessage[]> = new Map();
  private debounceMs: number;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private processCallback: (channel: string, messages: QueuedMessage[]) => Promise<void>;

  constructor(
    debounceMs: number,
    processCallback: (channel: string, messages: QueuedMessage[]) => Promise<void>
  ) {
    this.debounceMs = debounceMs;
    this.processCallback = processCallback;
  }

  addMessage(channel: string, nick: string, message: string): void {
    const queuedMessage: QueuedMessage = {
      channel,
      nick,
      message,
      timestamp: Date.now(),
    };

    // Get or create queue for this channel
    if (!this.queue.has(channel)) {
      this.queue.set(channel, []);
    }
    
    const channelQueue = this.queue.get(channel);
    if (channelQueue) {
      channelQueue.push(queuedMessage);
    }

    // Clear existing timer for this channel
    const existingTimer = this.timers.get(channel);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer to process messages after debounce period
    const timer = setTimeout(() => {
      this.processQueue(channel);
    }, this.debounceMs);

    this.timers.set(channel, timer);
  }

  private async processQueue(channel: string): Promise<void> {
    const messages = this.queue.get(channel);
    
    if (!messages || messages.length === 0) {
      return;
    }

    // Clear the queue for this channel
    this.queue.set(channel, []);
    this.timers.delete(channel);

    try {
      await this.processCallback(channel, messages);
    } catch (error) {
      console.error(`Error processing queue for ${channel}:`, error);
    }
  }

  // Force process all queues immediately (useful for shutdown)
  async flushAll(): Promise<void> {
    const channels = Array.from(this.queue.keys());
    
    for (const channel of channels) {
      const timer = this.timers.get(channel);
      if (timer) {
        clearTimeout(timer);
      }
      await this.processQueue(channel);
    }
  }
}
