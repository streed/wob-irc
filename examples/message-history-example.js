// This is an example to show the built-in message-history plugin usage
// The message history plugin is automatically loaded and doesn't need to be 
// copied to the plugins/ directory - it's built into the bot.
//
// The bot will automatically track all messages in channels (up to 1000 per channel)
// and users can query this history using natural language.
//
// Example queries you can ask the bot:
// 
// 1. "What were the recent messages in this channel?"
//    - The bot will use the get_recent_messages tool
//
// 2. "What did john say earlier?"
//    - The bot will use the get_user_messages tool
//
// 3. "When was Python mentioned in the chat?"
//    - The bot will use the search_messages tool
//
// 4. "Show me channel statistics"
//    - The bot will use the get_channel_stats tool
//
// 5. "How many messages has alice sent?"
//    - The bot will use the get_user_stats tool
//
// Available tools:
// - get_recent_messages: Get recent messages from the channel (limit: 20-100)
// - get_user_messages: Get messages from a specific user
// - search_messages: Search for messages containing specific text
// - get_channel_stats: Get statistics about channel activity
// - get_user_stats: Get message statistics for a specific user
//
// The bot's AI will automatically choose which tool to use based on 
// your question, and can even combine multiple tools if needed.

console.log('The message-history plugin is built-in and always available!');
console.log('No need to copy this file to plugins/ - just ask the bot natural language questions about chat history.');

// This example file is for documentation purposes only
module.exports = {
  name: 'example-message-history-usage',
  description: 'This is just an example showing how to use the built-in message-history plugin',
  tools: [],
  execute: async () => {
    return 'This is just an example file. The message-history plugin is built-in!';
  }
};
