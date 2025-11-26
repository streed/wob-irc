// Example Ollama search plugin for the IRC bot
// This plugin uses Ollama's web search API to search the web and returns summarized results
//
// REQUIREMENTS:
// - An Ollama account (sign up at https://ollama.com/signup)
// - An API key (create at https://ollama.com/settings/keys)
// - Set OLLAMA_API_KEY environment variable with your API key

const { Ollama } = require("ollama");

const plugin = {
  name: "ollama-search",
  description: "Search the web via Ollama and return a brief summary. Use for current or external information; prefer concise, source-backed results.",
  tools: [
    {
      name: "web_search",
      description:
        "Search the web for information on a topic and return a concise summary of the top result. Use this when users ask questions that require current information from the internet. If possible please provide a timestamp or date that we should base the search on time wise.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              'Search query text. Be specific about the topic and timeframe if relevant (e.g., "AI news Oct 2025", "weather in Paris today").',
          },
          max_results: {
            type: "number",
            description:
              "Maximum results to retrieve. Default 1; allowed range 1–10.",
          },
        },
        required: ["query"],
      },
    },
  ],
  execute: async (toolName, parameters) => {
    if (toolName === "web_search") {
      const query = parameters.query;
      const max_results = Math.min(parameters.max_results || 1, 10); // Cap at 10 per API limits

      // Check for API key
      const apiKey = process.env.OLLAMA_API_KEY;
      if (!apiKey) {
        return "Error: OLLAMA_API_KEY environment variable not set. Get your API key at https://ollama.com/settings/keys";
      }

      try {
        // Initialize Ollama client for web search
        // Web search requires using ollama.com cloud service
        const ollama = new Ollama({
          host: "https://ollama.com",
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        });

        // Perform web search using Ollama's webSearch API
        const searchResponse = await ollama.webSearch({
          query: query,
          max_results: max_results,
        });

        if (!searchResponse.results || searchResponse.results.length === 0) {
          return `No results found for: ${query}`;
        }

        // Get the top result
        const topResult = searchResponse.results[0];
        const content = topResult.content;

        // IRC typically has ~400 char limit as used in the bot
        const ircLimit = 350; // Leave some buffer

        // If content is already short enough for IRC, return it
        if (content.length <= ircLimit) {
          return `Search result for "${query}": ${content}`;
        }

        // Content is too long, truncate with ellipsis
        // Note: We could use a local Ollama model to summarize, but that would
        // require a separate connection to the local Ollama instance
        const truncated = content.substring(0, ircLimit - 30);
        const lastSpace = truncated.lastIndexOf(" ");
        const finalContent = truncated.substring(
          0,
          lastSpace > 0 ? lastSpace : truncated.length,
        );

        return `Search result for "${query}": ${finalContent}...`;
      } catch (error) {
        console.error("[ollama-search] Error performing search:", error);

        // Provide helpful error messages
        if (error.message && error.message.includes("401")) {
          return "Error: Invalid API key. Check your OLLAMA_API_KEY or create one at https://ollama.com/settings/keys";
        }

        return `Error performing search: ${error.message}`;
      }
    }

    throw new Error(`Unknown tool: ${toolName}`);
  },
};

module.exports = plugin;
