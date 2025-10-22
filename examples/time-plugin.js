// Example time plugin for the IRC bot
// Provides current time and timezone conversion functionality

const plugin = {
  name: 'time',
  description: 'Get current time and perform timezone conversions',
  tools: [
    {
      name: 'get_current_time',
      description: 'Get the current time',
      parameters: {
        type: 'object',
        properties: {
          timezone: {
            type: 'string',
            description: 'Optional timezone (e.g., "America/New_York", "Europe/London", "Asia/Tokyo")',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'get_current_time') {
      const timezone = parameters.timezone;
      
      const now = new Date();
      
      if (timezone) {
        try {
          const timeStr = now.toLocaleString('en-US', { timeZone: timezone });
          return `Current time in ${timezone}: ${timeStr}`;
        } catch (error) {
          return `Error: Invalid timezone "${timezone}"`;
        }
      } else {
        return `Current time (UTC): ${now.toUTCString()}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
