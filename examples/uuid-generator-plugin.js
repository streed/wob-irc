// UUID generator plugin for the IRC bot
// Generate UUIDs (Universally Unique Identifiers) in various versions

const crypto = require('crypto');

const plugin = {
  name: 'uuid-generator',
  description: 'Generate UUID v4 identifiers. Use when asked for a random unique ID/UUID; output a single UUID by default (support count up to 10).',
  tools: [
    {
      name: 'generate_uuid',
      description: 'Generate a UUID. Supports v4 (random) by default.',
      parameters: {
        type: 'object',
        properties: {
          version: {
            type: 'string',
            description: 'UUID version to generate. Only v4 is supported.',
            enum: ['v4'],
          },
          count: {
            type: 'number',
            description: 'Number of UUIDs to generate. Default 1; allowed range 1–10.',
          },
        },
        required: [],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'generate_uuid') {
      const version = parameters.version || 'v4';
      const count = Math.min(Math.max(parameters.count || 1, 1), 10);
      
      if (version !== 'v4') {
        return 'Error: Only UUID v4 (random) is currently supported';
      }
      
      try {
        const uuids = [];
        
        for (let i = 0; i < count; i++) {
          // Generate UUID v4 using crypto.randomBytes
          const bytes = crypto.randomBytes(16);
          
          // Set version (4) and variant bits according to RFC 4122
          bytes[6] = (bytes[6] & 0x0f) | 0x40; // Version 4
          bytes[8] = (bytes[8] & 0x3f) | 0x80; // Variant 10
          
          // Convert to UUID string format
          const uuid = [
            bytes.slice(0, 4).toString('hex'),
            bytes.slice(4, 6).toString('hex'),
            bytes.slice(6, 8).toString('hex'),
            bytes.slice(8, 10).toString('hex'),
            bytes.slice(10, 16).toString('hex'),
          ].join('-');
          
          uuids.push(uuid);
        }
        
        if (count === 1) {
          return `UUID v4: ${uuids[0]}`;
        } else {
          return `Generated ${count} UUID v4:\n${uuids.map((u, i) => `${i + 1}. ${u}`).join('\n')}`;
        }
        
      } catch (error) {
        console.error('[uuid-generator] Error generating UUID:', error);
        return `Error generating UUID: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
