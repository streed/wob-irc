// Message history tracker for IRC channels using SQLite and sqlite-vec
// Stores messages with vector embeddings for semantic search

import Database from 'better-sqlite3';
import * as sqliteVec from 'sqlite-vec';
import * as path from 'path';
import * as fs from 'fs';
import { Ollama } from 'ollama';

export interface HistoricalMessage {
  channel: string;
  nick: string;
  message: string;
  timestamp: number;
  embedding?: number[];
}

export interface SemanticSearchResult {
  channel: string;
  nick: string;
  message: string;
  timestamp: number;
  distance: number;
}

export class MessageHistoryDB {
  private db: Database.Database;
  private ollama: Ollama;
  private embeddingModel: string;
  private dbPath: string;
  private retentionDays: number = 30; // Keep messages for 30 days

  constructor(
    ollamaHost: string,
    embeddingModel: string = 'nomic-embed-text:v1.5',
    dbPath?: string
  ) {
    // Set database path
    this.dbPath = dbPath || path.join(process.cwd(), 'message-history.db');
    
    // Ensure directory exists
    const dbDir = path.dirname(this.dbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }

    // Initialize SQLite database
    this.db = new Database(this.dbPath);
    
    // Enable safe integers mode to ensure lastInsertRowid returns bigint
    // This is required for sqlite-vec which expects INTEGER (not REAL) for primary keys
    this.db.defaultSafeIntegers(true);
    
    // Load sqlite-vec extension
    sqliteVec.load(this.db);

    // Initialize Ollama client for embeddings
    this.ollama = new Ollama({ host: ollamaHost });
    this.embeddingModel = embeddingModel;

    // Initialize database schema
    this.initializeSchema();
  }

  private initializeSchema(): void {
    // Create messages table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        nick TEXT NOT NULL,
        message TEXT NOT NULL,
        timestamp INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
      CREATE INDEX IF NOT EXISTS idx_messages_nick ON messages(channel, nick);
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(channel, timestamp);
    `);

    // Create vector table for embeddings using sqlite-vec
    // nomic-embed-text produces 768-dimensional embeddings
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS vec_messages USING vec0(
        message_id INTEGER PRIMARY KEY,
        embedding FLOAT[768]
      );
    `);

    // Create daily summary table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS daily_summaries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        date TEXT NOT NULL,
        message_count INTEGER NOT NULL,
        user_count INTEGER NOT NULL,
        users TEXT NOT NULL,
        summary TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE(channel, date)
      );

      CREATE INDEX IF NOT EXISTS idx_daily_summaries_channel ON daily_summaries(channel);
      CREATE INDEX IF NOT EXISTS idx_daily_summaries_date ON daily_summaries(date);
    `);
  }

  /**
   * Generate embedding for a message using Ollama
   */
  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      const response = await this.ollama.embeddings({
        model: this.embeddingModel,
        prompt: text,
      });
      return response.embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw error;
    }
  }

  /**
   * Add a message to the history for a specific channel
   */
  async addMessage(channel: string, nick: string, message: string): Promise<void> {
    try {
      // Insert message into messages table
      const insertMessage = this.db.prepare(`
        INSERT INTO messages (channel, nick, message, timestamp)
        VALUES (?, ?, ?, ?)
      `);
      
      const result = insertMessage.run(channel, nick, message, Date.now());
      const messageId = result.lastInsertRowid as bigint;

      // Generate and store embedding asynchronously
      // We don't await this to avoid blocking IRC message processing
      this.generateAndStoreEmbedding(messageId, message).catch(err => {
        console.error(`Failed to generate embedding for message ${messageId}:`, err);
      });

      // Clean up old messages (older than 30 days) periodically
      // We do this asynchronously to avoid blocking
      this.cleanupOldMessages().catch(err => {
        console.error('Failed to cleanup old messages:', err);
      });
    } catch (error) {
      console.error('Error adding message to database:', error);
      throw error;
    }
  }

  /**
   * Generate and store embedding for a message (async)
   */
  private async generateAndStoreEmbedding(messageId: number | bigint, message: string): Promise<void> {
    try {
      const embedding = await this.generateEmbedding(message);
      
      // Store embedding in vec_messages table
      const insertEmbedding = this.db.prepare(`
        INSERT INTO vec_messages (message_id, embedding)
        VALUES (?, ?)
      `);
      
      // Convert embedding array to the format expected by sqlite-vec
      const embeddingBlob = new Float32Array(embedding);
      insertEmbedding.run(messageId, Buffer.from(embeddingBlob.buffer));
    } catch (error) {
      console.error('Error storing embedding:', error);
      // Don't throw - embedding generation is optional
    }
  }

  /**
   * Clean up messages older than retention period (30 days)
   * and create daily summaries for complete days
   */
  private async cleanupOldMessages(): Promise<void> {
    try {
      // Calculate cutoff timestamp (30 days ago)
      const retentionMs = this.retentionDays * 24 * 60 * 60 * 1000;
      const cutoffTimestamp = Date.now() - retentionMs;

      // Get messages to delete (older than 30 days)
      const oldMessages = this.db.prepare(`
        SELECT id FROM messages
        WHERE timestamp < ?
      `).all(cutoffTimestamp) as { id: number | bigint }[];

      if (oldMessages.length > 0) {
        console.log(`Cleaning up ${oldMessages.length} messages older than ${this.retentionDays} days`);
        
        const ids = oldMessages.map(row => row.id);
        const placeholders = ids.map(() => '?').join(',');
        
        // Delete from vec_messages first (foreign key constraint)
        this.db.prepare(`DELETE FROM vec_messages WHERE message_id IN (${placeholders})`).run(...ids);
        
        // Delete from messages
        this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
      }

      // Summarize completed days (yesterday and before)
      await this.summarizeCompletedDays();
    } catch (error) {
      console.error('Error during cleanup:', error);
      // Don't throw - cleanup failures shouldn't stop message processing
    }
  }

  /**
   * Summarize messages from completed days (not today)
   */
  private async summarizeCompletedDays(): Promise<void> {
    try {
      // Get the start of today
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();

      // Find channels and dates that need summarization
      const needSummary = this.db.prepare(`
        SELECT DISTINCT 
          channel,
          date(timestamp / 1000, 'unixepoch', 'localtime') as date
        FROM messages
        WHERE timestamp < ?
        AND (channel, date(timestamp / 1000, 'unixepoch', 'localtime')) NOT IN (
          SELECT channel, date FROM daily_summaries
        )
        ORDER BY date
      `).all(todayStart) as { channel: string; date: string }[];

      for (const { channel, date } of needSummary) {
        await this.createDailySummary(channel, date);
      }
    } catch (error) {
      console.error('Error summarizing completed days:', error);
    }
  }

  /**
   * Create a daily summary for a specific channel and date
   */
  private async createDailySummary(channel: string, date: string): Promise<void> {
    try {
      // Parse date string (YYYY-MM-DD format)
      const [year, month, day] = date.split('-').map(Number);
      const dayStart = new Date(year, month - 1, day).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1;

      // Get messages for this day
      const messages = this.db.prepare(`
        SELECT nick, message, timestamp
        FROM messages
        WHERE channel = ? AND timestamp >= ? AND timestamp < ?
        ORDER BY timestamp ASC
      `).all(channel, dayStart, dayEnd) as { nick: string; message: string; timestamp: number }[];

      if (messages.length === 0) {
        return;
      }

      // Calculate statistics
      const userSet = new Set(messages.map(m => m.nick));
      const users = Array.from(userSet);

      // Insert summary
      this.db.prepare(`
        INSERT OR REPLACE INTO daily_summaries 
        (channel, date, message_count, user_count, users, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        channel,
        date,
        messages.length,
        users.length,
        JSON.stringify(users),
        Date.now()
      );

      console.log(`Created daily summary for ${channel} on ${date}: ${messages.length} messages from ${users.length} users`);
    } catch (error) {
      console.error(`Error creating daily summary for ${channel} on ${date}:`, error);
    }
  }

  /**
   * Get all messages for a channel
   */
  getMessages(channel: string, limit?: number): HistoricalMessage[] {
    const query = limit
      ? this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ?
          ORDER BY timestamp DESC
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ?
          ORDER BY timestamp DESC
        `);

    const results = limit ? query.all(channel, limit) : query.all(channel);
    return (results as HistoricalMessage[]).reverse();
  }

  /**
   * Get messages from a specific user in a channel
   */
  getMessagesByUser(channel: string, nick: string, limit?: number): HistoricalMessage[] {
    const query = limit
      ? this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ? AND nick LIKE ?
          ORDER BY timestamp DESC
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ? AND nick LIKE ?
          ORDER BY timestamp DESC
        `);

    const results = limit 
      ? query.all(channel, nick, limit) 
      : query.all(channel, nick);
    return (results as HistoricalMessage[]).reverse();
  }

  /**
   * Search messages in a channel containing specific text (keyword search)
   */
  searchMessages(channel: string, searchText: string, limit?: number): HistoricalMessage[] {
    const query = limit
      ? this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ? AND message LIKE ?
          ORDER BY timestamp DESC
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT channel, nick, message, timestamp
          FROM messages
          WHERE channel = ? AND message LIKE ?
          ORDER BY timestamp DESC
        `);

    const searchPattern = `%${searchText}%`;
    const results = limit 
      ? query.all(channel, searchPattern, limit) 
      : query.all(channel, searchPattern);
    return (results as HistoricalMessage[]).reverse();
  }

  /**
   * Semantic search using vector embeddings
   */
  async semanticSearch(
    channel: string,
    query: string,
    limit: number = 10
  ): Promise<SemanticSearchResult[]> {
    try {
      // Generate embedding for the query
      const queryEmbedding = await this.generateEmbedding(query);
      
      // Convert to buffer for sqlite-vec
      const embeddingBlob = new Float32Array(queryEmbedding);
      const embeddingBuffer = Buffer.from(embeddingBlob.buffer);

      // Search for similar messages using sqlite-vec
      // vec_distance_L2 calculates L2 distance between vectors
      const searchQuery = this.db.prepare(`
        SELECT 
          m.channel,
          m.nick,
          m.message,
          m.timestamp,
          vec_distance_L2(v.embedding, ?) as distance
        FROM vec_messages v
        JOIN messages m ON v.message_id = m.id
        WHERE m.channel = ?
        ORDER BY distance ASC
        LIMIT ?
      `);

      const results = searchQuery.all(embeddingBuffer, channel, limit);
      return results as SemanticSearchResult[];
    } catch (error) {
      console.error('Error performing semantic search:', error);
      // Fall back to empty results on error
      return [];
    }
  }

  /**
   * Get messages within a time range
   */
  getMessagesByTimeRange(
    channel: string,
    startTime: number,
    endTime: number
  ): HistoricalMessage[] {
    const query = this.db.prepare(`
      SELECT channel, nick, message, timestamp
      FROM messages
      WHERE channel = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    return query.all(channel, startTime, endTime) as HistoricalMessage[];
  }

  /**
   * Get message count for a channel
   */
  getMessageCount(channel: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM messages
      WHERE channel = ?
    `).get(channel) as { count: number };

    return result.count;
  }

  /**
   * Get count of messages by a specific user in a channel
   */
  getUserMessageCount(channel: string, nick: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count
      FROM messages
      WHERE channel = ? AND nick LIKE ?
    `).get(channel, nick) as { count: number };

    return result.count;
  }

  /**
   * Get list of unique users who have sent messages in a channel
   */
  getChannelUsers(channel: string): string[] {
    const results = this.db.prepare(`
      SELECT DISTINCT nick
      FROM messages
      WHERE channel = ?
      ORDER BY nick
    `).all(channel) as { nick: string }[];

    return results.map(r => r.nick);
  }

  /**
   * Clear history for a specific channel
   */
  clearChannel(channel: string): void {
    // Get message IDs for the channel
    const messageIds = this.db.prepare(`
      SELECT id FROM messages WHERE channel = ?
    `).all(channel) as { id: number | bigint }[];

    if (messageIds.length > 0) {
      const ids = messageIds.map(row => row.id);
      const placeholders = ids.map(() => '?').join(',');
      
      // Delete from vec_messages first
      this.db.prepare(`DELETE FROM vec_messages WHERE message_id IN (${placeholders})`).run(...ids);
      
      // Delete from messages
      this.db.prepare(`DELETE FROM messages WHERE channel = ?`).run(channel);
    }
  }

  /**
   * Clear all history
   */
  clearAll(): void {
    this.db.exec('DELETE FROM vec_messages');
    this.db.exec('DELETE FROM messages');
    this.db.exec('DELETE FROM daily_summaries');
  }

  /**
   * Get daily summaries for a channel
   */
  getDailySummaries(channel: string, limit?: number): Array<{
    channel: string;
    date: string;
    message_count: number;
    user_count: number;
    users: string[];
    created_at: number;
  }> {
    const query = limit
      ? this.db.prepare(`
          SELECT channel, date, message_count, user_count, users, created_at
          FROM daily_summaries
          WHERE channel = ?
          ORDER BY date DESC
          LIMIT ?
        `)
      : this.db.prepare(`
          SELECT channel, date, message_count, user_count, users, created_at
          FROM daily_summaries
          WHERE channel = ?
          ORDER BY date DESC
        `);

    const results = limit ? query.all(channel, limit) : query.all(channel);
    
    return (results as any[]).map(row => ({
      channel: row.channel,
      date: row.date,
      message_count: row.message_count,
      user_count: row.user_count,
      users: JSON.parse(row.users),
      created_at: row.created_at,
    }));
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
