# Quick Start Guide

Get your IRC bot up and running in 5 minutes!

## Prerequisites

1. **Install Ollama** (if not already installed):
   ```bash
   # macOS
   brew install ollama
   
   # Linux
   curl -fsSL https://ollama.com/install.sh | sh
   ```

2. **Pull a model**:
   ```bash
   ollama pull llama3.2
   ```

3. **Start Ollama**:
   ```bash
   ollama serve
   ```

## Installation

1. Clone and setup:
   ```bash
   git clone https://github.com/streed/wob-irc.git
   cd wob-irc
   npm install
   npm run build
   ```

2. Create your configuration:
   ```bash
   cp .env.example .env
   ```

3. Edit `.env` with your IRC server details:
   ```env
   IRC_HOST=irc.libera.chat
   IRC_PORT=6667
   IRC_NICK=my-ollama-bot
   IRC_CHANNELS=#test
   OLLAMA_MODEL=llama3.2
   ```

## Running

Start the bot:
```bash
npm start
```

Or for development with auto-reload:
```bash
npm run dev
```

## First Steps

1. **Connect to your IRC server** using any IRC client
2. **Join the same channel** as your bot (e.g., #test)
3. **Mention the bot** in a message:
   ```
   my-ollama-bot: hello!
   ```
4. **Watch it respond!**

## Adding Plugins

1. Copy example plugins:
   ```bash
   cp examples/weather-plugin.js plugins/
   cp examples/time-plugin.js plugins/
   ```

2. Restart the bot (it loads plugins on startup)

3. Try asking:
   ```
   bot, what's the weather in London?
   bot, what time is it in Tokyo?
   ```

## Troubleshooting

### Bot doesn't respond
- Make sure you're mentioning the bot's nickname
- Try sending a direct message to the bot
- Check the console logs for errors

### "Connection refused" error
- Make sure Ollama is running (`ollama serve`)
- Check that the Ollama host is correct in your config
- Try `curl http://localhost:11434` to verify Ollama is accessible

### Plugin not loading
- Check the console for error messages during startup
- Verify the plugin file has correct syntax
- Make sure the plugin is in the `plugins/` directory

### IRC connection fails
- Verify the IRC server address and port
- Check if the nickname is already in use
- Try enabling TLS if the server requires it (`IRC_TLS=true`)

## Next Steps

- Read [PLUGIN_GUIDE.md](PLUGIN_GUIDE.md) to create your own plugins
- Customize the system prompt in `.env` to change the bot's personality
- Adjust `MESSAGE_DEBOUNCE_MS` for different response timing

## Example Interactions

```
<you> bot, hello!
<bot> Hello! How can I help you today?

<you> what's the weather like in Tokyo?
<bot> Weather in Tokyo: Partly Cloudy, 22°C, Humidity: 65%, Wind: 15 km/h

<you> and what time is it there?
<bot> Current time in Asia/Tokyo: 10/22/2025, 2:21:00 AM
```

Enjoy your AI-powered IRC bot! 🤖
