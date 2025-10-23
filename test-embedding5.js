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

// Try both modes
console.log('=== Test with safeIntegers=false (default) ===');
db.defaultSafeIntegers(false);
const result1 = db.prepare('INSERT INTO messages (message) VALUES (?)').run('Test message 1');
console.log('messageId:', result1.lastInsertRowid, 'Type:', typeof result1.lastInsertRowid);

const embedding = new Float32Array(768).fill(0.5);
try {
  const stmt = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');
  stmt.run(result1.lastInsertRowid, Buffer.from(embedding.buffer));
  console.log('SUCCESS');
} catch (err) {
  console.log('ERROR:', err.message);
}

console.log('\n=== Test with safeIntegers=true ===');
db.defaultSafeIntegers(true);
const result2 = db.prepare('INSERT INTO messages (message) VALUES (?)').run('Test message 2');
console.log('messageId:', result2.lastInsertRowid, 'Type:', typeof result2.lastInsertRowid);

try {
  const stmt = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');
  stmt.run(result2.lastInsertRowid, Buffer.from(embedding.buffer));
  console.log('SUCCESS');
} catch (err) {
  console.log('ERROR:', err.message);
}

console.log('\n=== Test prepared statement with safeIntegers ===');
const stmt = db.prepare('INSERT INTO vec_messages (message_id, embedding) VALUES (?, ?)');
stmt.safeIntegers(false); // Disable safeIntegers for this statement
const result3 = db.prepare('INSERT INTO messages (message) VALUES (?)').run('Test message 3');
console.log('messageId:', result3.lastInsertRowid, 'Type:', typeof result3.lastInsertRowid);

try {
  stmt.run(result3.lastInsertRowid, Buffer.from(embedding.buffer));
  console.log('SUCCESS with statement-level safeIntegers=false');
} catch (err) {
  console.log('ERROR:', err.message);
}

db.close();
