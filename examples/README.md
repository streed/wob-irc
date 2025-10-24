# Example Plugins for wob-irc

This directory contains example plugins that demonstrate the plugin system and provide useful functionality.

## Utility Plugins

### base64-plugin.js
Encode and decode text using base64 encoding.

**Tools:**
- `base64_encode` - Encode text to base64
- `base64_decode` - Decode base64 to text

**Example:**
```
<user> bot, encode "hello world" in base64
<bot> Base64 encoded: aGVsbG8gd29ybGQ=

<user> bot, decode "aGVsbG8gd29ybGQ="
<bot> Base64 decoded: hello world
```

### hash-plugin.js
Generate cryptographic hashes for text.

**Tools:**
- `generate_hash` - Generate MD5, SHA1, SHA256, or SHA512 hash

**Example:**
```
<user> bot, what's the SHA256 hash of "test"?
<bot> SHA256 hash: 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

### unit-converter-plugin.js
Convert between common units of measurement.

**Tools:**
- `convert_unit` - Convert temperature, length, weight, and volume units

**Supported conversions:**
- Temperature: Celsius, Fahrenheit, Kelvin
- Length: Meters, Feet, Miles, Kilometers
- Weight: Kilograms, Pounds, Ounces, Grams
- Volume: Liters, Gallons, Milliliters

**Example:**
```
<user> bot, convert 100 celsius to fahrenheit
<bot> 100 celsius = 212 fahrenheit
```

### url-shortener-plugin.js
Shorten long URLs using TinyURL.

**Tools:**
- `shorten_url` - Shorten a URL

**Example:**
```
<user> bot, shorten https://www.example.com/very/long/url
<bot> Shortened URL: https://tinyurl.com/abc123 → https://www.example.com/very/long/url
```

## Information Plugins

### weather-plugin.js
Get weather information and forecasts using the wttr.in API.

**Tools:**
- `get_weather` - Get current weather and 3-day forecast

**Example:**
```
<user> bot, what's the weather in London?
<bot> Weather for "London": [weather data with temperature, conditions, wind]
```

### time-plugin.js
Get current time in different timezones.

**Tools:**
- `get_current_time` - Get current time (optional timezone parameter)

**Example:**
```
<user> bot, what time is it in Tokyo?
<bot> Current time in Asia/Tokyo: [current time]
```

### currency-plugin.js
Convert between currencies using current exchange rates (exchangerate.host API).

**Tools:**
- `convert_currency` - Convert amount from one currency to another

**Example:**
```
<user> bot, convert 100 USD to EUR
<bot> 100 USD = 92.50 EUR (rate: 0.925000)
```

### dictionary-plugin.js
Look up word definitions, pronunciations, and examples using the Free Dictionary API.

**Tools:**
- `define_word` - Get definition, pronunciation, and example usage

**Example:**
```
<user> bot, what does serendipity mean?
<bot> "serendipity" /ˌserənˈdɪpɪti/ (noun): the occurrence of events by chance in a happy or beneficial way
```

## AI-Enhanced Plugins

### ollama-search-plugin.js
Search the web using Ollama's cloud API.

**Requirements:** OLLAMA_API_KEY environment variable

**Tools:**
- `web_search` - Search the web and return summarized results

### ollama-fetch-plugin.js
Fetch and extract content from URLs using Ollama's cloud API.

**Requirements:** OLLAMA_API_KEY environment variable

**Tools:**
- `fetch_url` - Fetch and extract content from a URL

## Installation

To use any of these plugins, copy them to the `plugins/` directory:

```bash
# Copy individual plugins
cp examples/base64-plugin.js plugins/
cp examples/hash-plugin.js plugins/
cp examples/unit-converter-plugin.js plugins/
cp examples/url-shortener-plugin.js plugins/
cp examples/weather-plugin.js plugins/
cp examples/time-plugin.js plugins/
cp examples/currency-plugin.js plugins/
cp examples/dictionary-plugin.js plugins/

# Or copy all plugins at once
cp examples/*-plugin.js plugins/
```

For plugins requiring API keys (ollama-search-plugin.js, ollama-fetch-plugin.js), make sure to set the required environment variables before starting the bot.

## Creating Your Own Plugins

See the [PLUGIN_GUIDE.md](../PLUGIN_GUIDE.md) for detailed instructions on creating custom plugins.
