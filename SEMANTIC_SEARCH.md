# Semantic Search Feature

## Overview

The wob-irc bot now includes semantic search capabilities for message history using SQLite with the sqlite-vec extension and Ollama embeddings. This allows the bot to find messages based on meaning and context, not just exact keyword matches.

## How It Works

1. **Message Storage**: Every message sent in a channel is automatically stored in a SQLite database
2. **Embedding Generation**: Each message is converted to a 768-dimensional vector embedding using Ollama's `nomic-embed-text` model
3. **Vector Search**: When performing a semantic search, the query is also converted to an embedding, and sqlite-vec finds the most similar messages using L2 distance

## Prerequisites

To use semantic search, you need:

1. **Ollama installed and running**: The bot needs to connect to Ollama to generate embeddings
2. **nomic-embed-text model**: Pull the embedding model:
   ```bash
   ollama pull nomic-embed-text
   ```

## Configuration

### Enable/Disable Semantic Search

In `.env`:
```env
# Enable database-backed history with semantic search (default: true)
MESSAGE_HISTORY_USE_DB=true

# Specify embedding model (default: nomic-embed-text)
OLLAMA_EMBEDDING_MODEL=nomic-embed-text
```

Or in `config.json`:
```json
{
  "messageHistory": {
    "useDatabase": true
  },
  "ollama": {
    "embeddingModel": "nomic-embed-text"
  }
}
```

### Disabling Semantic Search

Set to false to disable semantic search and use in-memory storage:
```env
MESSAGE_HISTORY_USE_DB=false
```

This will use in-memory storage without embeddings (faster but no semantic search).

## Usage Examples

### Semantic Search
Find messages by meaning, not exact keywords:

```
<user> bot, find discussions about machine learning
<bot> Semantically similar messages for "machine learning" in #channel:
      [2:30 PM] <alice> I love artificial intelligence and neural networks (relevance: 0.85)
      [2:45 PM] <bob> Has anyone worked with deep learning models? (relevance: 0.78)
      [3:10 PM] <charlie> AI is really advancing quickly (relevance: 0.72)
```

```
<user> bot, what were people saying about API design?
<bot> [Shows messages about REST, endpoints, HTTP, etc. even if "API design" wasn't mentioned]
```

```
<user> bot, find troubleshooting discussions
<bot> [Shows messages about errors, debugging, fixing issues, etc.]
```

### Keyword Search (Still Available)
For exact text matching:

```
<user> bot, search for Python
<bot> Messages containing "Python" in #channel:
      [1:15 PM] <alice> Anyone know Python?
      [1:20 PM] <bob> I use Python for scripting
```

## Performance Considerations

### Embedding Generation

- **Asynchronous**: Embeddings are generated in the background and don't block IRC message processing
- **Error Handling**: If embedding generation fails, the message is still stored (just without semantic search capability)
- **Resource Usage**: Embedding generation requires Ollama to be running and uses some CPU/memory

### Database

- **Persistent**: Messages and embeddings are stored in `message-history.db` by default (location configurable via `MESSAGE_HISTORY_DB_PATH`)
- **Size**: Each message with embedding takes ~3KB of space
- **Performance**: SQLite with sqlite-vec is very efficient, even with thousands of messages
- **Cleanup**: Old messages are automatically deleted when channel history exceeds the limit (default: 1000 messages)

## Comparison: Semantic vs Keyword Search

| Feature | Semantic Search | Keyword Search |
|---------|----------------|----------------|
| Query | "machine learning discussions" | "machine learning" |
| Matches | Similar concepts (AI, neural networks, etc.) | Exact text only |
| Flexibility | High - understands context | Low - exact match |
| Speed | Slightly slower (needs embedding) | Very fast |
| Use Case | Conceptual queries | Known keywords |
| Requires | Ollama + embedding model | Nothing extra |

## Tips for Best Results

1. **Use Semantic Search For**:
   - Conceptual queries ("discussions about...", "problems with...")
   - Finding related topics
   - When you don't know exact keywords
   - Understanding conversation themes

2. **Use Keyword Search For**:
   - Known exact terms or phrases
   - User names or specific words
   - Very fast lookups
   - When you want exact matches only

3. **Optimize Performance**:
   - Keep Ollama running for faster embedding generation
   - Adjust `MESSAGE_HISTORY_MAX` to limit database size
   - Use keyword search when exact matches are sufficient

## Technical Details

- **Embedding Model**: nomic-embed-text (768 dimensions)
- **Vector Database**: sqlite-vec extension
- **Distance Metric**: L2 (Euclidean distance)
- **Relevance Score**: `1 / (1 + distance)` (0-1 scale, higher is more relevant)
- **Database Schema**: 
  - `messages` table: channel, nick, message, timestamp
  - `vec_messages` virtual table: message_id, embedding (768-dimensional float vector)

## Troubleshooting

### "Semantic search is not available" Error

This means the bot is using in-memory storage. Check:
1. `MESSAGE_HISTORY_USE_DB` is set to `true`
2. SQLite and sqlite-vec dependencies are installed
3. Bot was restarted after configuration changes

### Embeddings Not Generated

If semantic search returns no results:
1. Check Ollama is running: `curl http://localhost:11434/api/version`
2. Verify embedding model is pulled: `ollama list | grep nomic-embed-text`
3. Check bot logs for embedding generation errors

### Database Issues

If you get database errors:
1. Check write permissions for `message-history.db`
2. Ensure enough disk space is available
3. Try deleting the database file and restarting the bot

## Migration from In-Memory Storage

If you previously used in-memory storage:
1. Set `MESSAGE_HISTORY_USE_DB=true`
2. Restart the bot
3. Previous in-memory history will be lost (expected)
4. New messages will be stored in the database going forward
