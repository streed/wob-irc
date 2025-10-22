// Message history tracker for IRC channels
// Stores up to 1000 messages per channel

export interface HistoricalMessage {
  channel: string;
  nick: string;
  message: string;
  timestamp: number;
}

export class MessageHistory {
  private history: Map<string, HistoricalMessage[]> = new Map();
  private maxMessagesPerChannel: number = 1000;

  constructor(maxMessagesPerChannel?: number) {
    if (maxMessagesPerChannel !== undefined) {
      this.maxMessagesPerChannel = maxMessagesPerChannel;
    }
  }

  /**
   * Add a message to the history for a specific channel
   */
  addMessage(channel: string, nick: string, message: string): void {
    if (!this.history.has(channel)) {
      this.history.set(channel, []);
    }

    const channelHistory = this.history.get(channel)!;
    
    channelHistory.push({
      channel,
      nick,
      message,
      timestamp: Date.now(),
    });

    // Trim to max size (keep most recent messages)
    if (channelHistory.length > this.maxMessagesPerChannel) {
      channelHistory.shift(); // Remove oldest message
    }
  }

  /**
   * Get all messages for a channel
   */
  getMessages(channel: string, limit?: number): HistoricalMessage[] {
    const channelHistory = this.history.get(channel) || [];
    
    if (limit !== undefined && limit > 0) {
      return channelHistory.slice(-limit);
    }
    
    return [...channelHistory];
  }

  /**
   * Get messages from a specific user in a channel
   */
  getMessagesByUser(channel: string, nick: string, limit?: number): HistoricalMessage[] {
    const channelHistory = this.history.get(channel) || [];
    const filtered = channelHistory.filter(msg => 
      msg.nick.toLowerCase() === nick.toLowerCase()
    );
    
    if (limit !== undefined && limit > 0) {
      return filtered.slice(-limit);
    }
    
    return filtered;
  }

  /**
   * Search messages in a channel containing specific text
   */
  searchMessages(channel: string, searchText: string, limit?: number): HistoricalMessage[] {
    const channelHistory = this.history.get(channel) || [];
    const lowerSearch = searchText.toLowerCase();
    
    const filtered = channelHistory.filter(msg =>
      msg.message.toLowerCase().includes(lowerSearch)
    );
    
    if (limit !== undefined && limit > 0) {
      return filtered.slice(-limit);
    }
    
    return filtered;
  }

  /**
   * Get messages within a time range
   */
  getMessagesByTimeRange(
    channel: string,
    startTime: number,
    endTime: number
  ): HistoricalMessage[] {
    const channelHistory = this.history.get(channel) || [];
    
    return channelHistory.filter(msg =>
      msg.timestamp >= startTime && msg.timestamp <= endTime
    );
  }

  /**
   * Get message count for a channel
   */
  getMessageCount(channel: string): number {
    return (this.history.get(channel) || []).length;
  }

  /**
   * Get count of messages by a specific user in a channel
   */
  getUserMessageCount(channel: string, nick: string): number {
    const channelHistory = this.history.get(channel) || [];
    return channelHistory.filter(msg => 
      msg.nick.toLowerCase() === nick.toLowerCase()
    ).length;
  }

  /**
   * Get list of unique users who have sent messages in a channel
   */
  getChannelUsers(channel: string): string[] {
    const channelHistory = this.history.get(channel) || [];
    const users = new Set<string>();
    
    for (const msg of channelHistory) {
      users.add(msg.nick);
    }
    
    return Array.from(users).sort();
  }

  /**
   * Clear history for a specific channel
   */
  clearChannel(channel: string): void {
    this.history.delete(channel);
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.history.clear();
  }
}
