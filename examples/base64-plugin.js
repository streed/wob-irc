// Base64 encoder/decoder plugin for the IRC bot
// Provides base64 encoding and decoding functionality - a common utility for IRC users

const plugin = {
  name: 'base64',
  description: 'Encode and decode text using base64 encoding. Useful for encoding/decoding data in IRC.',
  tools: [
    {
      name: 'base64_encode',
      description: 'Encode text to base64 format',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to encode',
          },
        },
        required: ['text'],
      },
    },
    {
      name: 'base64_decode',
      description: 'Decode base64 encoded text back to plain text',
      parameters: {
        type: 'object',
        properties: {
          encoded: {
            type: 'string',
            description: 'The base64 encoded text to decode',
          },
        },
        required: ['encoded'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'base64_encode') {
      const text = parameters.text;
      
      try {
        const encoded = Buffer.from(text, 'utf-8').toString('base64');
        return `Base64 encoded: ${encoded}`;
      } catch (error) {
        console.error('[base64] Error encoding:', error);
        return `Error encoding to base64: ${error.message}`;
      }
    }
    
    if (toolName === 'base64_decode') {
      const encoded = parameters.encoded;
      
      try {
        const decoded = Buffer.from(encoded, 'base64').toString('utf-8');
        return `Base64 decoded: ${decoded}`;
      } catch (error) {
        console.error('[base64] Error decoding:', error);
        return `Error decoding from base64: ${error.message}. Make sure the input is valid base64.`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
