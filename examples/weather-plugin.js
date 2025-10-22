// Example weather plugin for the IRC bot
// This is a demonstration plugin that would normally call a real weather API

const plugin = {
  name: 'weather',
  description: 'Get weather information for a location',
  tools: [
    {
      name: 'get_weather',
      description: 'Get the current weather for a specific location',
      parameters: {
        type: 'object',
        properties: {
          location: {
            type: 'string',
            description: 'The city or location to get weather for (e.g., "London", "New York")',
          },
          units: {
            type: 'string',
            description: 'Temperature units',
            enum: ['celsius', 'fahrenheit'],
          },
        },
        required: ['location'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'get_weather') {
      const location = parameters.location;
      const units = parameters.units || 'celsius';
      
      // This is mock data - in a real plugin, you would call a weather API
      const mockWeather = {
        temperature: units === 'celsius' ? 22 : 72,
        condition: 'Partly Cloudy',
        humidity: 65,
        windSpeed: 15,
      };
      
      const tempUnit = units === 'celsius' ? '°C' : '°F';
      const windUnit = units === 'celsius' ? 'km/h' : 'mph';
      
      return `Weather in ${location}: ${mockWeather.condition}, ${mockWeather.temperature}${tempUnit}, ` +
             `Humidity: ${mockWeather.humidity}%, Wind: ${mockWeather.windSpeed} ${windUnit}`;
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
