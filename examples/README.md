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

### calculator-plugin.js
Evaluate mathematical expressions and perform calculations.

**Tools:**
- `calculate` - Evaluate math expressions with support for basic arithmetic, trigonometry, and common functions

**Example:**
```
<user> bot, calculate 2 + 2 * 3
<bot> 2 + 2 * 3 = 8

<user> bot, what's the square root of 144?
<bot> sqrt(144) = 12
```

### color-converter-plugin.js
Convert between different color formats (HEX, RGB, HSL).

**Tools:**
- `convert_color` - Convert colors between HEX, RGB, and HSL formats

**Example:**
```
<user> bot, convert #FF5733 to RGB
<bot> #FF5733 → rgb(255, 87, 51)

<user> bot, convert rgb(255,87,51) to HSL
<bot> rgb(255,87,51) → hsl(11, 100%, 60%)
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
<bot> 100 celsius = 212.0000 fahrenheit
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

### uuid-generator-plugin.js
Generate UUIDs (Universally Unique Identifiers).

**Tools:**
- `generate_uuid` - Generate UUID v4 (random)

**Example:**
```
<user> bot, generate a UUID
<bot> UUID v4: 0d149f62-410a-4315-9607-c27484772812

<user> bot, generate 3 UUIDs
<bot> Generated 3 UUID v4:
1. 030ef728-63c1-4535-b687-7c02102e7c7b
2. 26bca478-f6e7-4e5d-ab93-3c4399b19d7a
3. 79f20ce6-ded4-4c9c-9cb3-c300b5202d17
```

### password-generator-plugin.js
Generate secure random passwords.

**Tools:**
- `generate_password` - Generate password with customizable length and character types

**Example:**
```
<user> bot, generate a password
<bot> Generated password (16 chars, uppercase+lowercase+numbers+symbols):
}Gxl#P6f],{8a!2@

<user> bot, generate a 12 character password without symbols
<bot> Generated password (12 chars, uppercase+lowercase+numbers):
6UJOMTnXe1g6
```

## Information Plugins

### ip-lookup-plugin.js
Look up information about an IP address.

**Tools:**
- `lookup_ip` - Get location, ISP, and other details for an IP address

**Example:**
```
<user> bot, lookup IP 8.8.8.8
<bot> IP: 8.8.8.8 | Location: Mountain View, California, United States | ISP: Google LLC
```

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
