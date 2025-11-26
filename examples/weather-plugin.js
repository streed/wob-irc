// Weather plugin for the IRC bot
// Uses wttr.in API to fetch current weather conditions and 3-day forecast
// Returns temperature (°F), condition (sunny/cloudy/rainy), wind speed/direction, and precipitation

const plugin = {
  name: 'weather',
  description: 'Get current weather and 3-day forecast. Use when asked about weather for a location; accepts city/landmark/airport/coordinates; return a concise summary.',
  tools: [
    {
      name: 'get_weather',
      description: 'Get current weather conditions and 3-day forecast for any location. Returns temperature in Fahrenheit, weather condition, wind speed/direction, and precipitation information.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: "Location query. Accepts city ('London'), landmark ('~Eiffel Tower'), airport code ('LAX'), area code ('90210'), or 'lat,lon' coordinates without spaces (e.g., '34.05,-118.24').",
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
        // Construct the wttr.in API URL
        // T = no terminal sequences (plain text)
        // u = use US units (Fahrenheit)
        // format=4 = compact format with current + 3-day forecast
        const url = `https://wttr.in/${encodeURIComponent(query)}?T&u&format=4`;
        
        // Fetch weather data
        const response = await fetch(url);
        
        // Handle different status codes
        if (response.status >= 500) {
          return `Error: Weather service is currently unavailable (status ${response.status})`;
        }
        
        if (response.status === 401 || response.status === 403) {
          return `Error: Unauthorized access to weather service (status ${response.status})`;
        }
        
        if (response.status === 400) {
          // 400 is acceptable per spec - might be invalid location format
          const text = await response.text();
          return `Weather data for "${query}": ${text.trim() || 'Invalid location format'}`;
        }
        
        // Success for 2xx and 3xx
        if (response.ok || (response.status >= 300 && response.status < 400)) {
          const text = await response.text();
          
          if (!text || text.trim().length === 0) {
            return `No weather data available for: ${query}`;
          }
          
          // Return the weather data - wttr.in format=4 already provides a compact format
          return `Weather for "${query}":\n${text.trim()}`;
        }
        
        // Any other status code
        return `Error: Unexpected response from weather service (status ${response.status})`;
        
      } catch (error) {
        console.error('[weather] Error fetching weather data:', error);
        
        // Provide helpful error messages
        if (error.message && error.message.includes('fetch')) {
          return `Error: Unable to connect to weather service. Please try again later.`;
        }
        
        return `Error fetching weather data: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
