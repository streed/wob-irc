// Dictionary plugin for the IRC bot
// Looks up word definitions using the Free Dictionary API (no API key required)

const plugin = {
  name: 'dictionary',
  description: 'Fetch English word definitions, pronunciation, and examples. Use when asked to define/explain a word; handle not-found cases clearly.',
  tools: [
    {
      name: 'define_word',
      description: 'Get the definition, pronunciation, and example usage of an English word',
      parameters: {
        type: 'object',
        properties: {
          word: {
            type: 'string',
            description: "English word to define. Letters, hyphens, apostrophes only (e.g., don't, mother-in-law).",
          },
        },
        required: ['word'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'define_word') {
      const word = parameters.word.toLowerCase().trim();
      
      // Validate word (should not be empty and contain only letters, hyphens, or apostrophes)
      if (!word || word.length === 0) {
        return 'Error: Word cannot be empty';
      }
      
      if (!/^[a-zA-Z'-]+$/.test(word)) {
        return 'Error: Word should contain only letters, hyphens, or apostrophes';
      }
      
      try {
        // Use Free Dictionary API (no API key required)
        const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
        
        const response = await fetch(url);
        
        if (response.status === 404) {
          return `No definition found for "${word}". Check spelling or try a different word.`;
        }
        
        if (!response.ok) {
          return `Error: Failed to fetch definition (status ${response.status})`;
        }
        
        const data = await response.json();
        
        if (!Array.isArray(data) || data.length === 0) {
          return `No definition found for "${word}"`;
        }
        
        // Get the first entry
        const entry = data[0];
        const meanings = entry.meanings;
        
        if (!meanings || meanings.length === 0) {
          return `No definitions available for "${word}"`;
        }
        
        // Get the first meaning and definition
        const firstMeaning = meanings[0];
        const partOfSpeech = firstMeaning.partOfSpeech || 'unknown';
        const definitions = firstMeaning.definitions;
        
        if (!definitions || definitions.length === 0) {
          return `No definitions available for "${word}"`;
        }
        
        const firstDef = definitions[0];
        const definition = firstDef.definition;
        const example = firstDef.example;
        
        // Build the response
        let result = `"${word}" (${partOfSpeech}): ${definition}`;
        
        if (example) {
          result += ` | Example: "${example}"`;
        }
        
        // Add pronunciation if available
        const phonetic = entry.phonetic || (entry.phonetics && entry.phonetics[0]?.text);
        if (phonetic) {
          result = `"${word}" ${phonetic} (${partOfSpeech}): ${definition}`;
          if (example) {
            result += ` | Example: "${example}"`;
          }
        }
        
        // If there are multiple meanings, mention it
        if (meanings.length > 1) {
          result += ` [+${meanings.length - 1} more meaning(s)]`;
        }
        
        return result;
        
      } catch (error) {
        console.error('[dictionary] Error looking up word:', error);
        return `Error looking up word: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
