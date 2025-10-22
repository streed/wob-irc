// Example Ollama search plugin for the IRC bot
// This plugin uses Ollama's web search API to search the web and returns summarized results

const { Ollama } = require('ollama');

const plugin = {
  name: 'ollama-search',
  description: 'Search the web using Ollama and return summarized results',
  tools: [
    {
      name: 'web_search',
      description: 'Search the web for information on a topic and return a concise summary of the top result. Use this when users ask questions that require current information from the internet.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'The search query to look up on the web (e.g., "latest news on AI", "weather in Paris")',
          },
          maxResults: {
            type: 'number',
            description: 'Maximum number of search results to retrieve (default: 1)',
          },
        },
        required: ['query'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'web_search') {
      const query = parameters.query;
      const maxResults = parameters.maxResults || 1;
      
      try {
        // Initialize Ollama client
        // Use the same host as configured in the bot's environment
        const ollamaHost = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const ollama = new Ollama({ host: ollamaHost });
        
        // Perform web search using Ollama's webSearch API
        const searchResponse = await ollama.webSearch({
          query: query,
          maxResults: maxResults,
        });
        
        if (!searchResponse.results || searchResponse.results.length === 0) {
          return `No results found for: ${query}`;
        }
        
        // Get the top result
        const topResult = searchResponse.results[0];
        const content = topResult.content;
        
        // If content is already short enough for IRC, return it
        // IRC typically has ~400 char limit as used in the bot
        const ircLimit = 350; // Leave some buffer
        
        if (content.length <= ircLimit) {
          return `Search result for "${query}": ${content}`;
        }
        
        // Summarize the content using Ollama to fit within IRC limits
        const model = process.env.OLLAMA_MODEL || 'llama3.2';
        const summaryResponse = await ollama.chat({
          model: model,
          messages: [
            {
              role: 'system',
              content: `You are a helpful assistant that summarizes web search results. Provide a concise summary in ${ircLimit} characters or less. Focus on the most important information. Do not use markdown or special formatting.`,
            },
            {
              role: 'user',
              content: `Summarize this search result for "${query}":\n\n${content}`,
            },
          ],
        });
        
        const summary = summaryResponse.message.content.trim();
        
        // Ensure the summary fits within IRC limits
        if (summary.length <= ircLimit) {
          return `Search result for "${query}": ${summary}`;
        } else {
          // Truncate if still too long
          return `Search result for "${query}": ${summary.substring(0, ircLimit - 3)}...`;
        }
      } catch (error) {
        console.error('[ollama-search] Error performing search:', error);
        return `Error performing search: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
