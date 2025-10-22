# wob-irc

An intelligent IRC bot powered by Ollama AI with a flexible plugin system for extending functionality.

## Features

- 🤖 **AI-Powered Responses**: Integrates with Ollama for natural language processing
- 🔌 **Plugin System**: Easily extend functionality with custom TypeScript/JavaScript plugins
- 🛠️ **Tool Calling**: Plugins become available as tools that the AI can use naturally
- ⏱️ **Message Debouncing**: Intelligent message queue system for efficient processing
- 💬 **Context Awareness**: Maintains conversation history per channel
- 🔧 **Configurable**: Flexible configuration via environment variables or JSON file

## Prerequisites

- Node.js 18+ 
- [Ollama](https://ollama.ai/) installed and running
- An IRC server to connect to

## Installation

1. Clone the repository:
```bash
git clone https://github.com/streed/wob-irc.git
cd wob-irc
```

2. Install dependencies:
```bash
npm install
```

3. Build the project:
```bash
npm run build
```

## Configuration

You can configure the bot using either environment variables or a `config.json` file.

### Using Environment Variables

Copy the example `.env` file:
```bash
cp .env.example .env
```

Edit `.env` with your settings:
```env
IRC_HOST=irc.libera.chat
IRC_PORT=6667
IRC_NICK=ollama-bot
IRC_CHANNELS=#test,#mychannel
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
MESSAGE_DEBOUNCE_MS=2000
IRC_DEBUG=false  # Set to true for verbose IRC protocol logging
```

### Using config.json

Alternatively, copy the example config:
```bash
cp config.json.example config.json
```

Edit `config.json` with your settings.

## Running the Bot

### Development Mode
```bash
npm run dev
```

### Production Mode
```bash
npm run build
npm start
```

## Creating Plugins

Plugins are TypeScript or JavaScript files placed in the `plugins/` directory. Each plugin exports an object with the following structure:

```javascript
const plugin = {
  name: 'my-plugin',
  description: 'Description of what the plugin does',
  tools: [
    {
      name: 'my_tool',
      description: 'What this tool does',
      parameters: {
        type: 'object',
        properties: {
          param1: {
            type: 'string',
            description: 'Description of parameter',
          },
        },
        required: ['param1'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'my_tool') {
      // Implement tool logic here
      return 'Result of the tool execution';
    }
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
```

### Example Plugins

See the `examples/` directory for sample plugins:
- `weather-plugin.js` - Get weather information (mock data)
- `time-plugin.js` - Get current time in different timezones
- `ollama-search-plugin.js` - Search the web using Ollama's cloud API (requires API key)

To use example plugins, copy them to the `plugins/` directory:
```bash
cp examples/weather-plugin.js plugins/
cp examples/time-plugin.js plugins/
cp examples/ollama-search-plugin.js plugins/  # Requires OLLAMA_API_KEY env variable
```

**Note**: The `ollama-search-plugin.js` requires an Ollama cloud API key. Get one at https://ollama.com/settings/keys and set it as the `OLLAMA_API_KEY` environment variable.

## How It Works

1. **Message Collection**: When users mention the bot or send direct messages, messages are added to a debounced queue
2. **Queue Processing**: After the debounce period (default 2 seconds), queued messages are processed together
3. **AI Processing**: Messages are sent to Ollama with context and available tools
4. **Tool Execution**: If the AI decides to use a tool, the plugin's execute function is called
5. **Response**: The AI's response (potentially enriched with tool results) is sent back to IRC

## Bot Interaction

The bot responds to:
- Direct messages to the bot
- Messages mentioning the bot's nickname
- Messages starting with `!`
- Messages containing the word "bot"

Example interactions:
```
<user> ollama-bot: what's the weather in London?
<ollama-bot> Weather in London: Partly Cloudy, 22°C, Humidity: 65%, Wind: 15 km/h

<user> what time is it in Tokyo?
<ollama-bot> Current time in Asia/Tokyo: 1/22/2025, 2:11:43 AM

<user> bot, search for latest news on artificial intelligence
<ollama-bot> Search result for "latest news on artificial intelligence": [summarized top result from web search]
```

## Message Debouncing

The bot implements a message queue system that debounces incoming messages. This allows:
- Multiple messages to be processed together for better context
- More efficient use of the AI model
- Reduced API calls to Ollama
- Natural conversation flow

The debounce time can be adjusted via `MESSAGE_DEBOUNCE_MS` configuration.

## Troubleshooting

### IRC Connection Issues

If the bot is not connecting to the IRC server, you can enable debug logging to get more information:

1. Set the `IRC_DEBUG` environment variable to `true`:
   ```bash
   export IRC_DEBUG=true
   npm start
   ```

2. Check the console output for detailed connection information:
   - **Connection parameters**: Host, port, nick, TLS settings
   - **Connection lifecycle**: `[IRC] Connecting to server...`, `[IRC] TCP connection established...`
   - **Registration status**: `[IRC] Successfully registered with server`
   - **Socket errors**: Look for `[IRC] Socket error:` messages with error codes
   - **Raw IRC protocol**: When debug mode is enabled, all IRC protocol messages are logged

3. Common issues and solutions:
   - **Connection hangs**: Check firewall settings, ensure the IRC server is accessible
   - **Socket errors (ECONNREFUSED)**: IRC server is not running or wrong host/port
   - **Socket errors (ETIMEDOUT)**: Network timeout, check connectivity or try a different server
   - **TLS errors**: If using TLS, ensure `IRC_TLS=true` and port is correct (usually 6697)
   - **Nick in use**: The configured nickname is already taken, try a different one

### Debug Mode Output

When `IRC_DEBUG=true`, you'll see additional verbose logging including:
- All raw IRC protocol messages (`RAW:` prefix)
- Internal library debug messages (`DEBUG:` prefix)
- Detailed socket-level events

**Note**: Debug mode produces very verbose output and should only be used for troubleshooting.

## Architecture

```
src/
├── index.ts           # Entry point
├── config.ts          # Configuration loader
├── types.ts           # TypeScript type definitions
├── irc-bot.ts         # Main IRC bot logic
├── ollama-client.ts   # Ollama API integration
├── message-queue.ts   # Message debouncing queue
└── plugin-loader.ts   # Plugin system implementation

plugins/               # User plugins go here
examples/              # Example plugins
```

## License

ISC