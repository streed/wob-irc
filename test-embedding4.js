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

// Try to insert with safeIntegers mode
db.defaultSafeIntegers(true);
const insertMessage = db.prepare('INSERT INTO messages (message) VALUES (?)');
const result = insertMessage.run('Test message');
const messageId = result.lastInsertRowid;

console.log('messageId:', messageId, 'Type:', typeof messageId);
console.log('Is bigint?', typeof messageId === 'bigint');

// Try to insert embedding
const embedding = new Float32Array(768).fill(0.5);

// With safeIntegers and bigint
try {
  const stmt = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');
  stmt.run(messageId, Buffer.from(embedding.buffer));
  console.log('SUCCESS with safeIntegers=true');
} catch (err) {
  console.log('ERROR with safeIntegers=true:', err.message);
  
  // Try converting to Number
  try {
    stmt.run(Number(messageId), Buffer.from(embedding.buffer));
    console.log('SUCCESS after Number() conversion');
  } catch (err2) {
    console.log('ERROR after Number() conversion:', err2.message);
  }
}

db.close();
