// Simple test to reproduce the issue
const Database = require('better-sqlite3');
const sqliteVec = require('sqlite-vec');

const db = new Database(':memory:');
sqliteVec.load(db);

// Create the same schema
db.exec(`
  CREATE TABLE messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    message TEXT NOT NULL
  );

  CREATE VIRTUAL TABLE vec_messages USING vec0(
    message_id INTEGER PRIMARY KEY,
    embedding FLOAT[768]
  );
`);

// Insert a message
const insertMessage = db.prepare('INSERT INTO messages (message) VALUES (?)');
const result = insertMessage.run('Test message');
const messageId = result.lastInsertRowid;

console.log('messageId:', messageId, 'Type:', typeof messageId);

// Try to insert embedding with different approaches
const embedding = new Float32Array(768).fill(0.5);

// Approach 1: With column names and variable
try {
  const stmt = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');
  stmt.run(messageId, Buffer.from(embedding.buffer));
  console.log('SUCCESS with column names and variable');
} catch (err) {
  console.log('ERROR with column names and variable:', err.message);
}

// Approach 2: Without column names (relying on column order)
try {
  const stmt = db.prepare('INSERT INTO vec_messages VALUES (?, ?)');
  stmt.run(messageId + 1, Buffer.from(embedding.buffer));
  console.log('SUCCESS without column names');
} catch (err) {
  console.log('ERROR without column names:', err.message);
}

// Approach 3: Swap parameter order - embedding first, then ID
try {
  const stmt = db.prepare('INSERT INTO vec_messages (embedding, message_id) VALUES (?, ?)');
  stmt.run(Buffer.from(embedding.buffer), messageId + 2);
  console.log('SUCCESS with swapped parameter order');
} catch (err) {
  console.log('ERROR with swapped parameter order:', err.message);
}

db.close();
