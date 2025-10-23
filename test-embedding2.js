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

// Try to insert embedding with different approaches
const embedding = new Float32Array(768).fill(0.5);

// Approach 1: Try with just the ID as integer literal
try {
  const insertEmbedding1 = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (1, ?)');
  insertEmbedding1.run(Buffer.from(embedding.buffer));
  console.log('SUCCESS with literal 1: Embedding inserted');
} catch (err) {
  console.log('ERROR with literal 1:', err.message);
}

// Approach 2: Try without explicit column names
try {
  const insertEmbedding2 = db.prepare('INSERT INTO vec_messages VALUES (?, ?)');
  insertEmbedding2.run(2, Buffer.from(embedding.buffer));
  console.log('SUCCESS without column names: Embedding inserted');
} catch (err) {
  console.log('ERROR without column names:', err.message);
}

// Approach 3: Check what's actually in the table
const rows = db.prepare('SELECT * FROM vec_messages').all();
console.log('Rows in vec_messages:', rows);

db.close();
