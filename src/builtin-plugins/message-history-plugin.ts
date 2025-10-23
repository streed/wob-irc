// Built-in plugin for querying message history
import { Plugin } from '../types';
import { MessageHistoryDB } from '../message-history-db';

export function createMessageHistoryPlugin(messageHistory: MessageHistoryDB): Plugin {
  return {
    name: 'message-history',
    description: 'Query and search through channel message history',
    tools: [
      {
        name: 'get_recent_messages',
        description: 'Get recent messages from the current channel. Useful for reviewing what was said recently.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to get messages from',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of recent messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel'],
        },
      },
      {
        name: 'get_user_messages',
        description: 'Get messages from a specific user in the channel. Useful for seeing what a particular person said.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to search in',
            },
            nick: {
              type: 'string',
              description: 'The nickname/handle of the user to filter by',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel', 'nick'],
        },
      },
      {
        name: 'search_messages',
        description: 'Search for messages containing specific text in the channel history. Useful for finding when something was mentioned (keyword search).',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to search in',
            },
            search_text: {
              type: 'string',
              description: 'The text to search for in messages',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of matching messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel', 'search_text'],
        },
      },
      {
        name: 'semantic_search_messages',
        description: 'Search for messages using semantic similarity (meaning-based search). Better than keyword search for finding related concepts, similar topics, or answering questions about past conversations.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to search in',
            },
            query: {
              type: 'string',
              description: 'The semantic query to search for (e.g., "discussions about AI", "when did we talk about the weather?")',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of matching messages to retrieve (default: 10, max: 50)',
            },
          },
          required: ['channel', 'query'],
        },
      },
      {
        name: 'get_channel_stats',
        description: 'Get statistics about the channel message history, including total messages and active users.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to get statistics for',
            },
          },
          required: ['channel'],
        },
      },
      {
        name: 'get_user_stats',
        description: 'Get message statistics for a specific user in the channel.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to check',
            },
            nick: {
              type: 'string',
              description: 'The nickname/handle of the user',
            },
          },
          required: ['channel', 'nick'],
        },
      },
      {
        name: 'get_daily_summaries',
        description: 'Get daily summaries of channel activity for past days. Shows message counts, user counts, and active users per day.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The channel to get summaries for',
            },
            limit: {
              type: 'number',
              description: 'Maximum number of daily summaries to retrieve (default: 7, max: 30)',
            },
          },
          required: ['channel'],
        },
      },
    ],
    execute: async (toolName: string, parameters: Record<string, any>): Promise<string> => {
      const { channel, nick, search_text, query, limit } = parameters;
      const maxLimit = 100;
      const defaultLimit = 20;
      const effectiveLimit = Math.min(limit || defaultLimit, maxLimit);

      switch (toolName) {
        case 'get_recent_messages': {
          const messages = messageHistory.getMessages(channel, effectiveLimit);
          
          if (messages.length === 0) {
            return `No messages found in ${channel}.`;
          }

          const formatted = messages.map(msg => {
            const date = new Date(msg.timestamp);
            const timeStr = date.toLocaleTimeString();
            return `[${timeStr}] <${msg.nick}> ${msg.message}`;
          }).join('\n');

          return `Recent messages in ${channel} (${messages.length} message${messages.length === 1 ? '' : 's'}):\n${formatted}`;
        }

        case 'get_user_messages': {
          const messages = messageHistory.getMessagesByUser(channel, nick, effectiveLimit);
          
          if (messages.length === 0) {
            return `No messages found from user "${nick}" in ${channel}.`;
          }

          const formatted = messages.map(msg => {
            const date = new Date(msg.timestamp);
            const timeStr = date.toLocaleTimeString();
            return `[${timeStr}] ${msg.message}`;
          }).join('\n');

          return `Messages from ${nick} in ${channel} (${messages.length} message${messages.length === 1 ? '' : 's'}):\n${formatted}`;
        }

        case 'search_messages': {
          const messages = messageHistory.searchMessages(channel, search_text, effectiveLimit);
          
          if (messages.length === 0) {
            return `No messages found containing "${search_text}" in ${channel}.`;
          }

          const formatted = messages.map(msg => {
            const date = new Date(msg.timestamp);
            const timeStr = date.toLocaleTimeString();
            return `[${timeStr}] <${msg.nick}> ${msg.message}`;
          }).join('\n');

          return `Messages containing "${search_text}" in ${channel} (${messages.length} match${messages.length === 1 ? '' : 'es'}):\n${formatted}`;
        }

        case 'semantic_search_messages': {
          const semanticMaxLimit = 50;
          const semanticDefaultLimit = 10;
          const semanticLimit = Math.min(limit || semanticDefaultLimit, semanticMaxLimit);
          
          const results = await messageHistory.semanticSearch(channel, query, semanticLimit);
          
          if (results.length === 0) {
            return `No semantically similar messages found for "${query}" in ${channel}.`;
          }

          const formatted = results.map((result) => {
            const date = new Date(result.timestamp);
            const timeStr = date.toLocaleTimeString();
            const relevanceScore = (1 / (1 + result.distance)).toFixed(2); // Convert distance to relevance (0-1)
            return `[${timeStr}] <${result.nick}> ${result.message} (relevance: ${relevanceScore})`;
          }).join('\n');

          return `Semantically similar messages for "${query}" in ${channel} (${results.length} result${results.length === 1 ? '' : 's'}):\n${formatted}`;
        }

        case 'get_channel_stats': {
          const totalMessages = messageHistory.getMessageCount(channel);
          const users = messageHistory.getChannelUsers(channel);
          
          if (totalMessages === 0) {
            return `No message history available for ${channel}.`;
          }

          const userList = users.slice(0, 10).join(', ');
          const moreUsers = users.length > 10 ? ` and ${users.length - 10} more` : '';

          return `Channel statistics for ${channel}:
- Total messages in history: ${totalMessages}
- Unique users: ${users.length}
- Active users: ${userList}${moreUsers}`;
        }

        case 'get_user_stats': {
          const userMessageCount = messageHistory.getUserMessageCount(channel, nick);
          const totalMessages = messageHistory.getMessageCount(channel);
          
          if (totalMessages === 0) {
            return `No message history available for ${channel}.`;
          }

          if (userMessageCount === 0) {
            return `User "${nick}" has no messages in the history for ${channel}.`;
          }

          const percentage = ((userMessageCount / totalMessages) * 100).toFixed(1);

          return `Statistics for ${nick} in ${channel}:
- Messages: ${userMessageCount}
- Percentage of channel activity: ${percentage}%
- Channel total: ${totalMessages} messages`;
        }

        case 'get_daily_summaries': {
          const summaryMaxLimit = 30;
          const summaryDefaultLimit = 7;
          const summaryLimit = Math.min(limit || summaryDefaultLimit, summaryMaxLimit);
          
          const summaries = messageHistory.getDailySummaries(channel, summaryLimit);
          
          if (summaries.length === 0) {
            return `No daily summaries available for ${channel}.`;
          }

          const formatted = summaries.map(summary => {
            const userList = summary.users.slice(0, 5).join(', ');
            const moreUsers = summary.users.length > 5 ? ` and ${summary.users.length - 5} more` : '';
            return `${summary.date}: ${summary.message_count} messages from ${summary.user_count} users (${userList}${moreUsers})`;
          }).join('\n');

          return `Daily summaries for ${channel} (last ${summaries.length} day${summaries.length === 1 ? '' : 's'}):\n${formatted}`;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    },
  };
}
