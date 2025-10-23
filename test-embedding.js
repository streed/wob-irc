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

console.log('lastInsertRowid:', result.lastInsertRowid);
console.log('Type:', typeof result.lastInsertRowid);

// Try to insert embedding
const embedding = new Float32Array(768).fill(0.5);
const insertEmbedding = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');

try {
  // This might fail if lastInsertRowid is bigint
  insertEmbedding.run(result.lastInsertRowid, Buffer.from(embedding.buffer));
  console.log('SUCCESS: Embedding inserted');
} catch (err) {
  console.log('ERROR:', err.message);
  
  // Try with Number() conversion
  try {
    insertEmbedding.run(Number(result.lastInsertRowid), Buffer.from(embedding.buffer));
    console.log('SUCCESS with Number() conversion: Embedding inserted');
  } catch (err2) {
    console.log('ERROR even with Number():', err2.message);
  }
}

db.close();
