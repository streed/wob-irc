# wob-irc

An intelligent IRC bot powered by LLM AI (Ollama or Runpod) with a flexible plugin system for extending functionality.

## Features

- 🤖 **AI-Powered Responses**: Integrates with Ollama or Runpod serverless endpoints for natural language processing
- 🔌 **Plugin System**: Easily extend functionality with custom TypeScript/JavaScript plugins
- 🛠️ **Tool Calling**: Plugins become available as tools that the AI can use naturally
- 🧠 **Smart Description Optimization**: Automatically optimizes plugin descriptions at load time for the specific LLM model being used
- ⏱️ **Message Debouncing**: Intelligent message queue system for efficient processing
- 💬 **Context Awareness**: Maintains conversation history per channel
- 📜 **Message History**: SQLite-backed persistent storage with vector embeddings
- 🔍 **Semantic Search**: Find messages by meaning, not just keywords, using Ollama embeddings
- 🗄️ **Persistent Storage**: Message history survives bot restarts
- 🔧 **Configurable**: Flexible configuration via environment variables or JSON file
- ☁️ **Flexible LLM Providers**: Use either local Ollama or cloud-based Runpod serverless endpoints

## Prerequisites

- Node.js 18+ 
- **For Ollama**: [Ollama](https://ollama.ai/) installed and running locally
- **For Runpod**: A Runpod account with a serverless endpoint (see [Runpod Serverless](https://www.runpod.io/serverless-gpu))
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

### Using Ollama (Local)

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

# LLM Provider
LLM_PROVIDER=ollama

# Ollama Configuration
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_EMBEDDING_MODEL=nomic-embed-text  # Model for semantic search

MESSAGE_DEBOUNCE_MS=2000
IRC_DEBUG=false  # Set to true for verbose IRC protocol logging
```

**Note**: The bot uses SQLite with vector embeddings for semantic search and keeps messages for 30 days with daily summaries. This requires the `nomic-embed-text` model. Pull it with:
```bash
ollama pull nomic-embed-text
```

### Using Runpod Serverless (Cloud)

For Runpod configuration, edit `.env`:
```env
IRC_HOST=irc.libera.chat
IRC_PORT=6667
IRC_NICK=ollama-bot
IRC_CHANNELS=#test,#mychannel

# LLM Provider
LLM_PROVIDER=runpod

# Runpod Configuration
RUNPOD_API_KEY=your-api-key-here
RUNPOD_ENDPOINT_ID=your-endpoint-id-here

MESSAGE_DEBOUNCE_MS=2000
```

To use Runpod:
1. Create an account at [Runpod.io](https://www.runpod.io/)
2. Set up a serverless endpoint with your preferred LLM model
3. Get your API key from the Runpod dashboard
4. Copy your endpoint ID from your serverless endpoint settings

**Note**: When using Runpod, message history and semantic search features will use a local Ollama instance for embeddings. If you don't have Ollama installed, these features will be limited.

**For detailed Runpod setup instructions, see [RUNPOD_GUIDE.md](RUNPOD_GUIDE.md).**

### Using config.json

Alternatively, copy the example config:
```bash
# For Ollama
cp config.json.example config.json

# For Runpod
cp config.json.runpod.example config.json
```

Edit `config.json` with your settings.

**Ollama config.json example:**
```json
{
  "llm": {
    "provider": "ollama",
    "ollama": {
      "host": "http://localhost:11434",
      "model": "llama3.2",
      "embeddingModel": "nomic-embed-text"
    },
    "maxToolCallRounds": 10
  }
}
```

**Runpod config.json example:**
```json
{
  "llm": {
    "provider": "runpod",
    "runpod": {
      "apiKey": "YOUR_RUNPOD_API_KEY",
      "endpointId": "YOUR_RUNPOD_ENDPOINT_ID"
    },
    "maxToolCallRounds": 10
  }
}
```

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

**Utility Plugins:**
- `base64-plugin.js` - Encode and decode text in base64 format
- `calculator-plugin.js` - Evaluate mathematical expressions and perform calculations
- `color-converter-plugin.js` - Convert between color formats (HEX, RGB, HSL)
- `hash-plugin.js` - Generate cryptographic hashes (MD5, SHA1, SHA256, SHA512)
- `password-generator-plugin.js` - Generate secure random passwords
- `unit-converter-plugin.js` - Convert between units (temperature, length, weight, volume)
- `url-shortener-plugin.js` - Shorten long URLs using TinyURL
- `uuid-generator-plugin.js` - Generate UUIDs (v4)

**Information Plugins:**
- `currency-plugin.js` - Convert between currencies with current exchange rates
- `dictionary-plugin.js` - Look up word definitions, pronunciations, and examples
- `ip-lookup-plugin.js` - Look up IP address information (location, ISP, etc.)
- `time-plugin.js` - Get current time in different timezones
- `weather-plugin.js` - Get weather information and forecasts using wttr.in API

**Entertainment Plugins:**
- `battle-plugin.js` - Create epic 3-round battles between randomly generated characters with context-based names and random weapons

**AI-Enhanced Plugins (require API key):**
- `ollama-search-plugin.js` - Search the web using Ollama's cloud API
- `ollama-fetch-plugin.js` - Fetch content from specific URLs using Ollama's cloud API

To use example plugins, copy them to the `plugins/` directory:
```bash
# Utility plugins (no API key required)
cp examples/base64-plugin.js plugins/
cp examples/calculator-plugin.js plugins/
cp examples/color-converter-plugin.js plugins/
cp examples/hash-plugin.js plugins/
cp examples/password-generator-plugin.js plugins/
cp examples/unit-converter-plugin.js plugins/
cp examples/url-shortener-plugin.js plugins/
cp examples/uuid-generator-plugin.js plugins/

# Information plugins (no API key required)
cp examples/currency-plugin.js plugins/
cp examples/dictionary-plugin.js plugins/
cp examples/ip-lookup-plugin.js plugins/
cp examples/time-plugin.js plugins/
cp examples/weather-plugin.js plugins/

# Entertainment plugins (no API key required)
cp examples/battle-plugin.js plugins/

# AI-enhanced plugins (require OLLAMA_API_KEY env variable)
cp examples/ollama-search-plugin.js plugins/
cp examples/ollama-fetch-plugin.js plugins/
```

**Note**: The `ollama-search-plugin.js` and `ollama-fetch-plugin.js` require an Ollama cloud API key. Get one at https://ollama.com/settings/keys and set it as the `OLLAMA_API_KEY` environment variable.

## How It Works

1. **Plugin Loading**: At startup, plugins are loaded from the `plugins/` directory
2. **Description Optimization**: Each plugin's descriptions (plugin, tools, and parameters) are automatically optimized by the LLM for better tool calling performance. This tailors the descriptions to the specific model being used (e.g., llama3.2, qwen2.5, etc.)
3. **Message Collection**: When users mention the bot or send direct messages, messages are added to a debounced queue
4. **Queue Processing**: After the debounce period (default 2 seconds), queued messages are processed together
5. **AI Processing**: Messages are sent to Ollama with context and available tools (using optimized descriptions)
6. **Tool Execution**: If the AI decides to use a tool, the plugin's execute function is called
7. **Response**: The AI's response (potentially enriched with tool results) is sent back to IRC

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

<user> bot, what's the definition of serendipity?
<ollama-bot> "serendipity" /ˌserənˈdɪpɪti/ (noun): the occurrence of events by chance in a happy or beneficial way | Example: "a fortunate stroke of serendipity"

<user> bot, convert 100 USD to EUR
<ollama-bot> 100 USD = 92.50 EUR (rate: 0.925000)

<user> bot, encode "hello world" in base64
<ollama-bot> Base64 encoded: aGVsbG8gd29ybGQ=

<user> bot, calculate 2 + 2 * 3
<ollama-bot> 2 + 2 * 3 = 8

<user> bot, what's the square root of 144?
<ollama-bot> sqrt(144) = 12

<user> bot, what's the SHA256 hash of "test"?
<ollama-bot> SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08

<user> bot, convert #FF5733 to RGB
<ollama-bot> #FF5733 → rgb(255, 87, 51)

<user> bot, generate a UUID
<ollama-bot> UUID v4: 0d149f62-410a-4315-9607-c27484772812

<user> bot, generate a password
<ollama-bot> Generated password (16 chars, uppercase+lowercase+numbers+symbols):
}Gxl#P6f],{8a!2@

<user> bot, convert 100 celsius to fahrenheit
<ollama-bot> 100 celsius = 212.0000 fahrenheit

<user> bot, lookup IP 8.8.8.8
<ollama-bot> IP: 8.8.8.8 | Location: Mountain View, California, United States | ISP: Google LLC

<user> bot, shorten this URL: https://www.example.com/very/long/url/path/to/resource
<ollama-bot> Shortened URL: https://tinyurl.com/abc123 → https://www.example.com/very/long/url/path/to/resource

<user> bot, start a battle!
<ollama-bot> ⚔️  BATTLE ROYALE ⚔️
Dragon Slayer wielding a legendary sword VS Thunder Knight wielding enchanted arrows!

=== ROUND 1 ===
Dragon Slayer attacks with a legendary sword for 22 damage!
Thunder Knight: 78 HP remaining
Thunder Knight counterattacks with enchanted arrows for 15 damage!
Dragon Slayer: 85 HP remaining

=== ROUND 2 ===
Dragon Slayer attacks with a legendary sword for 28 damage!
Thunder Knight: 50 HP remaining
Thunder Knight counterattacks with enchanted arrows for 31 damage!
Dragon Slayer: 54 HP remaining

=== ROUND 3 ===
Dragon Slayer attacks with a legendary sword for 33 damage!
Thunder Knight: 17 HP remaining
Thunder Knight counterattacks with enchanted arrows for 19 damage!
Dragon Slayer: 35 HP remaining

⏰ TIME'S UP! Dragon Slayer wins with 35 HP remaining!

<user> bot, search for latest news on artificial intelligence
<ollama-bot> Search result for "latest news on artificial intelligence": [summarized top result from web search]

<user> bot, fetch content from https://example.com/article
<ollama-bot> "Article Title" from https://example.com/article: [extracted content from the page]
```

## Message History

The bot includes a powerful message history feature that automatically tracks all messages in each channel using SQLite with vector embeddings. This enables both traditional keyword search and semantic search capabilities.

### Storage

- **Persistent Storage**: Messages are stored in a SQLite database (`message-history.db`) that persists across bot restarts
- **Vector Embeddings**: Each message is embedded using Ollama's `nomic-embed-text` model for semantic search
- **30-Day Retention**: Messages are kept for 30 days, after which they are automatically cleaned up
- **Daily Summaries**: Each day's messages are summarized into a daily summary table for historical queries
- **Automatic**: All messages are tracked in the background without user interaction

### Available Message History Tools

The bot can use these tools naturally when answering questions:

- **get_recent_messages**: Retrieve recent messages from the channel
- **get_user_messages**: Get messages from a specific user
- **search_messages**: Search for messages containing specific text (keyword search)
- **semantic_search_messages**: Search for messages by meaning/concept (semantic search)
- **get_channel_stats**: Get statistics about channel activity
- **get_user_stats**: Get message statistics for a specific user
- **get_daily_summaries**: Get daily summaries of channel activity for past days

### Example Queries

**Basic Queries:**
```
<user> bot, what were the recent messages?
<bot> [Shows recent messages with timestamps]

<user> bot, what did alice say earlier?
<bot> [Shows messages from alice]

<user> bot, when was Python mentioned?
<bot> [Shows messages containing "Python"]
```

**Semantic Search Examples:**
```
<user> bot, find discussions about machine learning
<bot> [Shows messages semantically related to ML, even without those exact words]

<user> bot, what were we talking about related to API design?
<bot> [Finds relevant conversations about APIs]

<user> bot, when did someone ask about troubleshooting?
<bot> [Finds help requests and problem-solving discussions]
```

**Statistics:**
```
<user> bot, show channel statistics
<bot> [Shows total messages, active users, etc.]

<user> bot, how many messages has bob sent?
<bot> [Shows bob's message count and activity percentage]

<user> bot, show daily summaries
<bot> [Shows daily activity summaries for the past week]
```

### Semantic Search vs Keyword Search

- **Keyword Search** (`search_messages`): Exact text matching, fast, good for finding specific words or phrases
- **Semantic Search** (`semantic_search_messages`): Meaning-based matching, finds conceptually similar messages even with different wording

### Configuration

To customize the database location:
```env
MESSAGE_HISTORY_DB_PATH=/path/to/custom-location.db
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