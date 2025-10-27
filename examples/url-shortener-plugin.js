// URL Shortener plugin for the IRC bot
// Uses TinyURL API to shorten long URLs for easier sharing in IRC

const plugin = {
  name: 'url-shortener',
  description: 'Shorten long URLs using TinyURL. Use for sharing long links; require http(s) URLs; return the shortened URL only.',
  tools: [
    {
      name: 'shorten_url',
      description: 'Shorten a long URL using TinyURL service. Returns a shorter URL that redirects to the original.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'Long URL to shorten. Must start with http:// or https:// and be a valid absolute URL.',
          },
        },
        required: ['url'],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === 'shorten_url') {
      const url = parameters.url;
      
      // Validate URL format
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        return 'Error: URL must start with http:// or https://';
      }
      
      try {
        // Use TinyURL API (no API key required)
        const apiUrl = `https://tinyurl.com/api-create.php?url=${encodeURIComponent(url)}`;
        
        const response = await fetch(apiUrl);
        
        if (!response.ok) {
          return `Error: Failed to shorten URL (status ${response.status})`;
        }
        
        const shortUrl = await response.text();
        
        if (!shortUrl || shortUrl.trim().length === 0) {
          return 'Error: Received empty response from URL shortener';
        }
        
        // Check if the response is actually a URL
        if (!shortUrl.startsWith('http')) {
          return `Error: Invalid response from URL shortener: ${shortUrl}`;
        }
        
        return `Shortened URL: ${shortUrl.trim()} → ${url}`;
        
      } catch (error) {
        console.error('[url-shortener] Error shortening URL:', error);
        return `Error shortening URL: ${error.message}`;
      }
    }
    
    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
