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
        description: 'Retrieve the most recent messages from the channel. USE THIS when users ask "what was just said?", "what are we talking about?", "show recent messages", or to understand current conversation context.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            limit: {
              type: 'number',
              description: 'Number of recent messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel'],
        },
      },
      {
        name: 'get_user_messages',
        description: 'Get all messages from a specific user. USE THIS when users ask "what did [username] say?", "show messages from [username]", or "has [username] talked about X?".',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            nick: {
              type: 'string',
              description: 'The exact username/nickname to search for',
            },
            limit: {
              type: 'number',
              description: 'Number of messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel', 'nick'],
        },
      },
      {
        name: 'search_messages',
        description: 'Find messages containing exact keywords or phrases. USE THIS for questions like "when was [word] mentioned?", "find messages with [keyword]", or "search for [exact phrase]". Best for finding specific words.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            search_text: {
              type: 'string',
              description: 'The exact text/keyword to search for (will match partial words)',
            },
            limit: {
              type: 'number',
              description: 'Number of matching messages to retrieve (default: 20, max: 100)',
            },
          },
          required: ['channel', 'search_text'],
        },
      },
      {
        name: 'semantic_search_messages',
        description: 'Find messages by meaning and context, not just keywords. USE THIS for questions like "what did we discuss about [topic]?", "find conversations related to [concept]", or "when did someone ask about [subject]?". Finds conceptually similar messages even with different wording.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            query: {
              type: 'string',
              description: 'Natural language query describing what you\'re looking for (e.g., "machine learning discussions", "help with bugs")',
            },
            limit: {
              type: 'number',
              description: 'Number of similar messages to retrieve (default: 10, max: 50)',
            },
          },
          required: ['channel', 'query'],
        },
      },
      {
        name: 'get_channel_stats',
        description: 'Show channel activity statistics including total message count and list of active users. USE THIS when asked "how active is this channel?", "show channel stats", or "who talks here?".',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
          },
          required: ['channel'],
        },
      },
      {
        name: 'get_user_stats',
        description: 'Show how many messages a specific user has sent and their activity percentage. USE THIS when asked "how active is [username]?", "how many messages has [username] sent?", or "show [username] stats".',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            nick: {
              type: 'string',
              description: 'The username/nickname to get statistics for',
            },
          },
          required: ['channel', 'nick'],
        },
      },
      {
        name: 'get_daily_summaries',
        description: 'View historical daily activity summaries showing message and user counts per day. USE THIS when asked "show activity history", "what happened yesterday?", "show daily summaries", or to review past activity patterns.',
        parameters: {
          type: 'object',
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            limit: {
              type: 'number',
              description: 'Number of days to retrieve (default: 7, max: 30)',
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

          return `${totalMessages} messages, ${users.length} users: ${userList}${moreUsers}`;
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

          return `${nick}: ${userMessageCount} messages (${percentage}%)`;
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
            return `${summary.date}: ${summary.message_count} messages by ${summary.user_count} users (${userList}${moreUsers})`;
          }).join('\n');

          return formatted;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    },
  };
}
