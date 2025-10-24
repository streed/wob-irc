// Hash generator plugin for the IRC bot
// Generates various cryptographic hashes (MD5, SHA1, SHA256, SHA512) for input text

const crypto = require('crypto');

const plugin = {
  name: 'hash',
  description: 'Generate cryptographic hashes (MD5, SHA1, SHA256, SHA512) for text. Useful for verifying data integrity or generating checksums.',
  tools: [
    {
      name: 'generate_hash',
      description: 'Generate a cryptographic hash of the provided text using the specified algorithm',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to hash',
          },
          algorithm: {
            type: 'string',
            description: 'The hash algorithm to use',
            enum: ['md5', 'sha1', 'sha256', 'sha512'],
          },
        },
        required: ['text', 'algorithm'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'generate_hash') {
      const { text, algorithm } = parameters;
      
      // Validate algorithm
      const validAlgorithms = ['md5', 'sha1', 'sha256', 'sha512'];
      if (!validAlgorithms.includes(algorithm.toLowerCase())) {
        return `Error: Invalid algorithm. Must be one of: ${validAlgorithms.join(', ')}`;
      }
      
      try {
        const hash = crypto
          .createHash(algorithm.toLowerCase())
          .update(text, 'utf-8')
          .digest('hex');
        
        return `${algorithm.toUpperCase()} hash: ${hash}`;
      } catch (error) {
        console.error('[hash] Error generating hash:', error);
        return `Error generating ${algorithm} hash: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
