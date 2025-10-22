# API to Plugin Conversion Guide

This guide explains how to convert an API specification into a plugin format that the wob-irc bot understands.

## Example Conversion

Let's convert a weather API specification to a bot plugin.

### Original API Specification Format

```json
{
  "name": "weather",
  "description": "Returns current weather conditions and 3-day forecast. Provides temperature (°F), condition (sunny/cloudy/rainy), wind speed/direction, and precipitation. Works with city names, landmarks, airports, or coordinates.",
  "endpoint": "https://wttr.in/{query}?T&u&format=4",
  "method": "GET",
  "parameters": {
    "query": {
      "type": "string",
      "description": "Location query: city name ('London'), landmark ('~Eiffel Tower'), airport code ('LAX'), area code ('90210'), or lat,long coordinates ('34.05,-118.24'). No spaces in coordinates.",
      "required": true
    }
  },
  "path_params": ["query"],
  "response_format": "text",
  "expected_status": ["2xx", "3xx"],
  "error_status": ["5xx", "401", "403"],
  "acceptable_status": ["400"]
}
```

### Converted Plugin Format

```javascript
const plugin = {
  name: 'weather',
  description: 'Returns current weather conditions and 3-day forecast. Provides temperature (°F), condition (sunny/cloudy/rainy), wind speed/direction, and precipitation. Works with city names, landmarks, airports, or coordinates.',
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather conditions and 3-day forecast for any location. Returns temperature in Fahrenheit, weather condition, wind speed/direction, and precipitation information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "Location query: city name ('London'), landmark ('~Eiffel Tower'), airport code ('LAX'), area code ('90210'), or lat,long coordinates ('34.05,-118.24'). No spaces in coordinates.",
          },
        },
        required: ['query'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'get_weather') {
      const query = parameters.query;
      
      try {
        // Construct URL from endpoint specification
        const url = `https://wttr.in/${encodeURIComponent(query)}?T&u&format=4`;
        
        // Make HTTP request (using fetch)
        const response = await fetch(url);
        
        // Handle error status codes (5xx, 401, 403)
        if (response.status >= 500) {
          return `Error: Weather service is currently unavailable (status ${response.status})`;
        }
        
        if (response.status === 401 || response.status === 403) {
          return `Error: Unauthorized access to weather service (status ${response.status})`;
        }
        
        // Handle acceptable status (400)
        if (response.status === 400) {
          const text = await response.text();
          return `Weather data for "${query}": ${text.trim() || 'Invalid location format'}`;
        }
        
        // Handle expected status (2xx, 3xx)
        if (response.ok || (response.status >= 300 && response.status < 400)) {
          const text = await response.text();
          
          if (!text || text.trim().length === 0) {
            return `No weather data available for: ${query}`;
          }
          
          return `Weather for "${query}":\n${text.trim()}`;
        }
        
        return `Error: Unexpected response from weather service (status ${response.status})`;
        
      } catch (error) {
        console.error('[weather] Error fetching weather data:', error);
        return `Error fetching weather data: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
```

## Conversion Mapping

### 1. Plugin Metadata
- **API**: `name` → **Plugin**: `name` (directly mapped)
- **API**: `description` → **Plugin**: `description` (directly mapped)

### 2. Tool Definition
- **API**: Single API endpoint → **Plugin**: One tool in `tools` array
- **API**: `name` + function → **Plugin**: `name` with prefix like `get_` or action verb
- **API**: `description` → **Plugin**: Enhanced tool `description` with usage details

### 3. Parameters
- **API**: `parameters` object → **Plugin**: `tools[0].parameters.properties` object
- **API**: `parameters[name].type` → **Plugin**: `properties[name].type`
- **API**: `parameters[name].description` → **Plugin**: `properties[name].description`
- **API**: `parameters[name].required: true` → **Plugin**: Add to `required` array

### 4. HTTP Request Implementation
- **API**: `endpoint` → **Plugin**: Construct URL in `execute` function
- **API**: `path_params` → **Plugin**: Use `encodeURIComponent()` to safely insert params
- **API**: `method` → **Plugin**: Use appropriate fetch method (GET/POST/etc.)

### 5. Response Handling
- **API**: `response_format` → **Plugin**: Parse response appropriately (`.text()`, `.json()`, etc.)
- **API**: `expected_status` → **Plugin**: Handle with `response.ok` or specific status checks
- **API**: `error_status` → **Plugin**: Handle with specific status checks and error messages
- **API**: `acceptable_status` → **Plugin**: Handle as special cases (not errors, but not typical success)

## Key Differences

1. **Structure**: API specs are data descriptions; plugins are executable code
2. **Flexibility**: Plugins can add custom logic, error handling, and data formatting
3. **Tool Naming**: Plugin tools often have action-oriented names (e.g., `get_weather` vs `weather`)
4. **Error Handling**: Plugins provide user-friendly error messages
5. **Response Processing**: Plugins can format/truncate responses for IRC compatibility

## Best Practices

1. **Encode URL Parameters**: Always use `encodeURIComponent()` for path/query parameters
2. **Comprehensive Error Handling**: Handle all specified status codes appropriately
3. **User-Friendly Messages**: Convert technical errors to readable messages
4. **IRC-Appropriate Responses**: Keep responses concise (IRC has message length limits)
5. **Logging**: Use `console.error()` for debugging information
6. **Validation**: Validate parameters before making API calls

## Testing Your Conversion

After converting an API spec to a plugin:

1. **Structure Test**: Verify the plugin has all required fields
   ```javascript
   console.log('Has name:', !!plugin.name);
   console.log('Has tools:', Array.isArray(plugin.tools));
   console.log('Has execute:', typeof plugin.execute === 'function');
   ```

2. **Parameter Test**: Verify parameters are correctly defined
   ```javascript
   const tool = plugin.tools[0];
   console.log('Tool name:', tool.name);
   console.log('Parameters:', Object.keys(tool.parameters.properties));
   console.log('Required:', tool.parameters.required);
   ```

3. **Execution Test**: Test with sample parameters
   ```javascript
   plugin.execute('tool_name', { param: 'value' })
     .then(result => console.log('Result:', result))
     .catch(err => console.error('Error:', err));
   ```

4. **Integration Test**: Load the plugin using PluginLoader and verify it's recognized

## Example: See `examples/weather-plugin.js`

The weather plugin in the examples directory demonstrates this conversion pattern with a real working implementation.
