// Example Ollama fetch plugin for the IRC bot
// This plugin uses Ollama's web fetch API to fetch content from a specific URL
// 
// REQUIREMENTS:
// - An Ollama account (sign up at https://ollama.com/signup)
// - An API key (create at https://ollama.com/settings/keys)
// - Set OLLAMA_API_KEY environment variable with your API key

const { Ollama } = require('ollama');

const plugin = {
  name: 'ollama-fetch',
  description: 'Fetch content from a specific URL using Ollama',
  tools: [
    {
      name: 'web_fetch',
      description: 'Fetch and extract content from a specific web page URL. Use this when users ask about content from a specific website or URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The full URL to fetch content from (e.g., "https://example.com/article")',
          },
        },
        required: ['url'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'web_fetch') {
      const url = parameters.url;
      
      // Check for API key
      const apiKey = process.env.OLLAMA_API_KEY;
      if (!apiKey) {
        return 'Error: OLLAMA_API_KEY environment variable not set. Get your API key at https://ollama.com/settings/keys';
      }
      
      try {
        // Initialize Ollama client for web fetch
        // Web fetch requires using ollama.com cloud service
        const ollama = new Ollama({
          host: 'https://ollama.com',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });
        
        // Perform web fetch using Ollama's webFetch API
        const fetchResponse = await ollama.webFetch({
          url: url,
        });
        
        if (!fetchResponse.content) {
          return `No content found at: ${url}`;
        }
        
        const title = fetchResponse.title || 'Untitled';
        const content = fetchResponse.content;
        const links = fetchResponse.links || [];
        
        // Build response with title and content
        let response = `"${title}" from ${fetchResponse.url}:\n${content}`;
        
        // If content is too long, use Ollama to summarize it
        // IRC typically has ~400 char limit as used in the bot
        const ircLimit = 350; // Leave some buffer
        
        if (response.length > ircLimit) {
          try {
            // Get the system prompt from environment or use default
            const systemPrompt = process.env.SYSTEM_PROMPT || 'You are a helpful IRC bot assistant. You respond to messages in a concise and friendly manner. Keep your responses brief and appropriate for IRC chat.';
            
            // Initialize local Ollama instance for summarization
            // Note: This is separate from the cloud Ollama instance used for web fetch above
            // The local instance is used for chat/summarization capabilities
            const localOllama = new Ollama({
              host: process.env.OLLAMA_HOST || 'http://localhost:11434',
            });
            
            // Ask Ollama to summarize in the voice of the system prompt
            const summaryResponse = await localOllama.chat({
              model: process.env.OLLAMA_MODEL || 'llama3.2',
              messages: [
                {
                  role: 'system',
                  content: systemPrompt,
                },
                {
                  role: 'user',
                  content: `Please summarize the following content in under ${ircLimit} characters, maintaining the style and voice from your system prompt. Include the title and URL reference.\n\nTitle: "${title}"\nURL: ${fetchResponse.url}\nContent: ${content}`,
                },
              ],
            });
            
            const summary = summaryResponse.message.content.trim();
            
            // Add info about available links if any
            const linkInfo = links.length > 0 ? ` (${links.length} links found)` : '';
            
            return `${summary}${linkInfo}`;
          } catch (summaryError) {
            console.error('[ollama-fetch] Error summarizing content:', summaryError);
            // Fallback to truncation if summarization fails
            const truncated = response.substring(0, ircLimit - 30);
            const lastSpace = truncated.lastIndexOf(' ');
            const finalResponse = truncated.substring(0, lastSpace > 0 ? lastSpace : truncated.length);
            const linkInfo = links.length > 0 ? ` (${links.length} links found)` : '';
            return `${finalResponse}...${linkInfo}`;
          }
        }
        
        return response;
      } catch (error) {
        console.error('[ollama-fetch] Error fetching URL:', error);
        
        // Provide helpful error messages
        if (error.message && error.message.includes('401')) {
          return 'Error: Invalid API key. Check your OLLAMA_API_KEY or create one at https://ollama.com/settings/keys';
        }
        
        if (error.message && error.message.includes('404')) {
          return `Error: URL not found or not accessible: ${url}`;
        }
        
        return `Error fetching URL: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
