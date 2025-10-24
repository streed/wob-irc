# Plugin Development Guide

This guide explains how to create plugins for the wob-irc bot.

## Plugin Structure

A plugin is a JavaScript or TypeScript module that exports an object with the following properties:

```typescript
interface Plugin {
  name: string;                    // Unique plugin identifier
  description: string;             // What the plugin does
  tools: PluginTool[];            // Array of tools this plugin provides
  execute: (toolName: string, parameters: Record<string, any>) => Promise<string>;
}
```

## Plugin Components

### 1. Basic Information

```javascript
const plugin = {
  name: 'my-plugin',              // Must be unique across all plugins
  description: 'Does something useful',  // Used by AI to understand when to use this plugin
  // ... rest of plugin
};
```

### 2. Tools Definition

Tools are the functions your plugin provides. They follow the OpenAI function calling format:

```javascript
tools: [
  {
    name: 'tool_name',           // Tool identifier (use snake_case)
    description: 'What this tool does',  // Be descriptive - helps AI know when to use it
    parameters: {
      type: 'object',
      properties: {
        param_name: {
          type: 'string',        // string, number, boolean, array, object
          description: 'What this parameter is for',
          enum: ['option1', 'option2'],  // Optional: restrict to specific values
        },
      },
      required: ['param_name'],  // List required parameters
    },
  },
]
```

### 3. Execute Function

This function is called when the AI decides to use one of your tools:

```javascript
execute: async (toolName, parameters) => {
  if (toolName === 'tool_name') {
    // Access parameters
    const value = parameters.param_name;
    
    // Do your logic here
    // Can be async, make API calls, etc.
    
    // Return a string result
    return 'Result to send back to the AI';
  }
  
  throw new Error(`Unknown tool: ${toolName}`);
}
```

## Complete Example: Calculator Plugin

```javascript
const plugin = {
  name: 'calculator',
  description: 'Perform basic arithmetic operations',
  tools: [
    {
      name: 'calculate',
      description: 'Calculate the result of a mathematical expression',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'The mathematical operation to perform',
            enum: ['add', 'subtract', 'multiply', 'divide'],
          },
          a: {
            type: 'number',
            description: 'First number',
          },
          b: {
            type: 'number',
            description: 'Second number',
          },
        },
        required: ['operation', 'a', 'b'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'calculate') {
      const { operation, a, b } = parameters;
      
      let result;
      switch (operation) {
        case 'add':
          result = a + b;
          break;
        case 'subtract':
          result = a - b;
          break;
        case 'multiply':
          result = a * b;
          break;
        case 'divide':
          if (b === 0) {
            return 'Error: Cannot divide by zero';
          }
          result = a / b;
          break;
        default:
          return `Error: Unknown operation ${operation}`;
      }
      
      return `${a} ${operation} ${b} = ${result}`;
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
```

## TypeScript Plugins

For TypeScript plugins, create a `.ts` file:

```typescript
import { Plugin, PluginTool } from '../src/types';

const plugin: Plugin = {
  name: 'typescript-plugin',
  description: 'A plugin written in TypeScript',
  tools: [
    {
      name: 'example_tool',
      description: 'An example tool',
      parameters: {
        type: 'object',
        properties: {
          message: {
            type: 'string',
            description: 'A message to process',
          },
        },
        required: ['message'],
      },
    },
  ],
  execute: async (toolName: string, parameters: Record<string, any>): Promise<string> => {
    if (toolName === 'example_tool') {
      return `You said: ${parameters.message}`;
    }
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

export default plugin;
```

## Best Practices

1. **Descriptive Names**: Use clear, descriptive names for tools and parameters
2. **Good Descriptions**: Write detailed descriptions - they help the AI understand when to use your tool
3. **Error Handling**: Always handle errors gracefully and return user-friendly messages
4. **Validation**: Validate parameters before using them
5. **Async Operations**: Use async/await for any I/O operations
6. **Single Responsibility**: Each tool should do one thing well
7. **Return Strings**: Always return string results that are meaningful to users

## Testing Your Plugin

1. Copy your plugin to the `plugins/` directory
2. Start the bot with `npm run dev`
3. Check the console for plugin loading messages
4. Test in IRC by asking the bot to use your plugin's functionality

Example:
```
<you> bot, can you calculate 15 + 27?
<bot> 15 add 27 = 42
```

## Common Patterns

### Making API Calls

```javascript
execute: async (toolName, parameters) => {
  if (toolName === 'fetch_data') {
    try {
      const response = await fetch(`https://api.example.com/data/${parameters.id}`);
      const data = await response.json();
      return JSON.stringify(data);
    } catch (error) {
      return `Error fetching data: ${error.message}`;
    }
  }
}
```

### Multiple Tools in One Plugin

```javascript
const plugin = {
  name: 'multi-tool',
  description: 'Plugin with multiple tools',
  tools: [
    {
      name: 'tool_one',
      // ...
    },
    {
      name: 'tool_two',
      // ...
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'tool_one') {
      return 'Result from tool one';
    }
    if (toolName === 'tool_two') {
      return 'Result from tool two';
    }
    throw new Error(`Unknown tool: ${toolName}`);
  },
};
```

### Using External Libraries

```javascript
// At the top of your plugin file
const axios = require('axios');
const moment = require('moment');

const plugin = {
  // ... use libraries in your execute function
};
```

Note: Make sure to install any external libraries with `npm install` in the project root.

## Debugging

Add console.log statements in your execute function to debug:

```javascript
execute: async (toolName, parameters) => {
  console.log(`[my-plugin] Tool called: ${toolName}`);
  console.log(`[my-plugin] Parameters:`, parameters);
  
  // ... your logic
  
  const result = '...';
  console.log(`[my-plugin] Returning:`, result);
  return result;
}
```

## Plugin Ideas

**Already Implemented** (see `examples/` directory):
- ✓ **Base64 Encoder/Decoder**: Encode and decode base64 text (`base64-plugin.js`)
- ✓ **Calculator**: Evaluate mathematical expressions (`calculator-plugin.js`)
- ✓ **Color Converter**: Convert between HEX, RGB, HSL formats (`color-converter-plugin.js`)
- ✓ **Currency Converter**: Convert between currencies (`currency-plugin.js`)
- ✓ **Dictionary**: Look up word definitions (`dictionary-plugin.js`)
- ✓ **Hash Generator**: Generate MD5, SHA1, SHA256, SHA512 hashes (`hash-plugin.js`)
- ✓ **IP Lookup**: Get IP address information (`ip-lookup-plugin.js`)
- ✓ **Password Generator**: Generate secure random passwords (`password-generator-plugin.js`)
- ✓ **Time/Timezone**: Get time in different timezones (`time-plugin.js`)
- ✓ **Unit Converter**: Convert temperature, length, weight, volume (`unit-converter-plugin.js`)
- ✓ **URL Shortener**: Shorten URLs using TinyURL (`url-shortener-plugin.js`)
- ✓ **UUID Generator**: Generate UUIDs v4 (`uuid-generator-plugin.js`)
- ✓ **Weather**: Get weather forecasts (`weather-plugin.js`)
- ✓ **Web Search**: Search the web using Ollama API (`ollama-search-plugin.js`)

**Additional Ideas**:
- **GitHub**: Query GitHub repositories, issues, PRs
- **Database**: Query a database and return results
- **File Operations**: Read/write files (use with caution!)
- **System Info**: Get system information (CPU, memory, etc.)
- **Translation**: Translate text between languages
- **Image Generation**: Generate or manipulate images
- **Code Execution**: Execute code safely in a sandbox
- **Reminders**: Set and manage reminders
- **Cryptocurrency**: Get crypto prices and market data
- **RSS Feed**: Monitor and read RSS feeds
- **QR Code**: Generate QR codes for text/URLs

Remember: Plugins have full access to the system, so be careful with what they do!
