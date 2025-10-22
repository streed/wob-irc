# Ollama Search Plugin Example

This example plugin demonstrates how to integrate Ollama's web search API with the IRC bot to provide real-time web search capabilities.

**⚠️ Important**: This plugin uses Ollama's cloud-based web search service, which requires an Ollama account and API key.

## Features

- **Web Search**: Uses Ollama's `webSearch()` cloud API to search the internet
- **Automatic Truncation**: Truncates search results to fit within IRC message limits (400 characters)
- **Configurable Results**: Can retrieve multiple search results (defaults to 1, max 10)
- **Error Handling**: Gracefully handles API errors and returns user-friendly messages

## Prerequisites

1. **Ollama Account**: Sign up at https://ollama.com/signup
2. **API Key**: Create an API key at https://ollama.com/settings/keys
3. **Environment Variable**: Set `OLLAMA_API_KEY` with your API key

## How It Works

1. User asks a question in IRC that requires web search
2. The AI detects the need for current information and calls the `web_search` tool
3. The plugin connects to Ollama's cloud service (ollama.com) using your API key
4. Ollama's `webSearch()` API performs the web search
5. The result is truncated to fit within IRC's 400 character limit
6. The formatted result is returned to IRC

## Usage

### Installation

Copy the plugin to your `plugins/` directory:

```bash
cp examples/ollama-search-plugin.js plugins/
```

### Configuration

The plugin requires the following environment variable:
- `OLLAMA_API_KEY` - Your Ollama cloud API key (required)

To set it up:
```bash
export OLLAMA_API_KEY=your_api_key_here
```

Or add it to your `.env` file:
```
OLLAMA_API_KEY=your_api_key_here
```

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

The plugin uses Ollama's cloud-based `webSearch()` API:

```javascript
// Initialize Ollama client with cloud host
const ollama = new Ollama({
  host: 'https://ollama.com',
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
});

// Perform web search
const searchResponse = await ollama.webSearch({
  query: query,
  max_results: 1, // max 10
});
```

The `webSearch()` API returns results with a `content` field containing the search result text.

### IRC Text Limit

The plugin ensures all responses fit within IRC's message limits:
- Maximum IRC message length: ~512 bytes
- Plugin target: 350 characters (leaves buffer for metadata)
- Long results are automatically truncated at word boundaries
- Truncated results end with "..."

## Requirements

- Ollama account (sign up at https://ollama.com/signup)
- API key from https://ollama.com/settings/keys
- `OLLAMA_API_KEY` environment variable set
- Network access to ollama.com
- ollama-js package version 0.6.0 or higher

## Error Handling

The plugin handles several error scenarios:
- No search results found
- Network/API errors
- Ollama server unavailable

All errors are caught and returned as user-friendly messages to IRC.

## Development Notes

This is an example plugin demonstrating:
- External API integration with Ollama's cloud service
- Authenticated API requests using Bearer tokens
- Result truncation and formatting for IRC
- Error handling and user feedback
- Async/await patterns

### Alternative Approaches

If you prefer not to use Ollama's cloud service, you could:
1. Integrate with other search APIs (Google, Bing, DuckDuckGo, etc.)
2. Use a local web scraping solution
3. Implement your own search indexing system

Feel free to modify and extend this plugin for your needs!
