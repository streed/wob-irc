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
  private maxMessagesPerChannel: number = 1000;
  private dbPath: string;

  constructor(
    ollamaHost: string,
    embeddingModel: string = 'nomic-embed-text:v1.5',
    maxMessagesPerChannel?: number,
    dbPath?: string
  ) {
    if (maxMessagesPerChannel !== undefined) {
      this.maxMessagesPerChannel = maxMessagesPerChannel;
    }

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

      // Trim old messages if needed
      this.trimChannel(channel);
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
   * Trim old messages from a channel to maintain max size
   */
  private trimChannel(channel: string): void {
    const count = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE channel = ?')
      .get(channel) as { count: number };

    if (count.count > this.maxMessagesPerChannel) {
      const toDelete = count.count - this.maxMessagesPerChannel;
      
      // Get IDs of oldest messages to delete
      const oldestIds = this.db.prepare(`
        SELECT id FROM messages
        WHERE channel = ?
        ORDER BY timestamp ASC
        LIMIT ?
      `).all(channel, toDelete) as { id: number | bigint }[];

      if (oldestIds.length > 0) {
        const ids = oldestIds.map(row => row.id);
        
        // Delete from vec_messages first (foreign key constraint)
        const placeholders = ids.map(() => '?').join(',');
        this.db.prepare(`DELETE FROM vec_messages WHERE message_id IN (${placeholders})`).run(...ids);
        
        // Delete from messages
        this.db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`).run(...ids);
      }
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
  }

  /**
   * Close the database connection
   */
  close(): void {
    this.db.close();
  }
}
