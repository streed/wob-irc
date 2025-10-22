# Ollama Search Plugin Example

This example plugin demonstrates how to integrate Ollama's web search API with the IRC bot to provide real-time web search capabilities.

## Features

- **Web Search**: Uses Ollama's `webSearch()` API to search the internet
- **Automatic Summarization**: Summarizes search results using Ollama's chat API to fit within IRC message limits (400 characters)
- **Configurable Results**: Can retrieve multiple search results (defaults to 1)
- **Error Handling**: Gracefully handles API errors and returns user-friendly messages

## How It Works

1. User asks a question in IRC that requires web search
2. The AI detects the need for current information and calls the `web_search` tool
3. The plugin uses Ollama's `webSearch()` API to search the web
4. If the result is too long for IRC, it uses Ollama's chat API to summarize it
5. The summarized result is returned to IRC, fitting within the 400 character limit

## Usage

### Installation

Copy the plugin to your `plugins/` directory:

```bash
cp examples/ollama-search-plugin.js plugins/
```

### Configuration

The plugin uses environment variables from your bot configuration:
- `OLLAMA_HOST` - Ollama server URL (default: `http://localhost:11434`)
- `OLLAMA_MODEL` - Model to use for summarization (default: `llama3.2`)

### Example Interactions

```
<user> bot, what are the latest developments in quantum computing?
<bot> Search result for "latest developments in quantum computing": [AI returns summarized top search result]

<user> search for weather forecast for tomorrow
<bot> Search result for "weather forecast for tomorrow": [AI returns summarized weather information]

<user> !search SpaceX latest launch
<bot> Search result for "SpaceX latest launch": [AI returns summarized launch information]
```

## Technical Details

### API Integration

The plugin uses two Ollama APIs:

1. **webSearch()** - Performs web search
   ```javascript
   const searchResponse = await ollama.webSearch({
     query: query,
     maxResults: 1,
   });
   ```

2. **chat()** - Summarizes results
   ```javascript
   const summaryResponse = await ollama.chat({
     model: model,
     messages: [
       { role: 'system', content: '...' },
       { role: 'user', content: '...' },
     ],
   });
   ```

### IRC Text Limit

The plugin ensures all responses fit within IRC's message limits:
- Maximum IRC message length: ~512 bytes
- Plugin target: 350 characters (leaves buffer for metadata)
- Long results are automatically summarized
- Very long summaries are truncated with "..."

## Requirements

- Ollama server must be running and accessible
- The Ollama version must support the `webSearch()` API
- Network access for web searches

## Error Handling

The plugin handles several error scenarios:
- No search results found
- Network/API errors
- Invalid timezone strings
- Ollama server unavailable

All errors are caught and returned as user-friendly messages to IRC.

## Development Notes

This is an example plugin demonstrating:
- External API integration (Ollama webSearch)
- Result summarization and formatting
- Character limit handling for IRC
- Error handling and user feedback
- Async/await patterns

Feel free to modify and extend this plugin for your needs!
