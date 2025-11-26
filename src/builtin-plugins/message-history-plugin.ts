// Built-in plugin for querying message history
import { Plugin } from "../types";
import { MessageHistoryDB } from "../message-history-db";

export function createMessageHistoryPlugin(
  messageHistory: MessageHistoryDB,
): Plugin {
  return {
    name: "message-history",
    description: "Fast, bounded tools for retrieving IRC message history and activity stats. Prefer these for any context-related questions.",
    tools: [
      {
        name: 'get_recent_messages',
        description: 'Get the last N messages from a channel. Use for "what were we discussing?" or to ground context. Keep N small (default≈20).',
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            limit: {
              type: 'number',
              description: 'Recent message count to retrieve (default: 20, max: 100). Choose the smallest that answers the question.',
            },
          },
          required: ["channel"],
        },
      },
      {
        name: 'get_user_messages',
        description: 'Get recent messages from a specific user in a channel. Use for "what did [nick] say?" Keep results bounded.',
        parameters: {
          type: "object",
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
              description: 'Number of messages to retrieve (default: 20, max: 100). Choose the smallest useful amount.',
            },
          },
          required: ["channel", "nick"],
        },
      },
      {
        name: 'search_messages',
        description: 'Find messages containing exact keywords or phrases. Use for locating specific words; prefer small limits and precise terms.',
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            search_text: {
              type: 'string',
              description: 'Exact text/keyword to search (partial-word matches allowed). Use quotes for phrases.',
            },
            limit: {
              type: 'number',
              description: 'Max matches to retrieve (default: 20, max: 100). Keep small to reduce noise.',
            },
          },
          required: ["channel", "search_text"],
        },
      },
      {
        name: 'semantic_search_messages',
        description: 'Find messages by meaning (embeddings). Use when keyword search fails. Prefer small limits (default≈10).',
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            query: {
              type: 'string',
              description: 'Natural-language query describing what you\'re looking for (e.g., "ML discussions", "help with bugs").',
            },
            limit: {
              type: 'number',
              description: 'Number of similar messages to retrieve (default: 10, max: 50). Keep small to stay focused.',
            },
          },
          required: ["channel", "query"],
        },
      },
      {
        name: 'get_channel_stats',
        description: 'Channel activity stats: message count and active users. Use for "how active is this channel?" or "who talks here?"',
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
          },
          required: ["channel"],
        },
      },
      {
        name: 'get_user_stats',
        description: 'User activity stats in a channel: message count and share. Use for "how active is [nick]?"',
        parameters: {
          type: "object",
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
          required: ["channel", "nick"],
        },
      },
      {
        name: 'get_daily_summaries',
        description: 'Historical daily activity summaries (message and user counts). Use for activity history (“what happened yesterday?”).',
        parameters: {
          type: "object",
          properties: {
            channel: {
              type: 'string',
              description: 'The IRC channel name (e.g., "#test")',
            },
            limit: {
              type: 'number',
              description: 'Number of days to retrieve (default: 7, max: 30). Keep small to stay relevant.',
            },
          },
          required: ["channel"],
        },
      },
    ],
    execute: async (
      toolName: string,
      parameters: Record<string, any>,
    ): Promise<string> => {
      const { channel, nick, search_text, query, limit } = parameters;
      const maxLimit = 100;
      const defaultLimit = 20;
      const effectiveLimit = Math.min(limit || defaultLimit, maxLimit);

      switch (toolName) {
        case "get_recent_messages": {
          const messages = messageHistory.getMessages(channel, effectiveLimit);

          if (messages.length === 0) {
            return `No messages found in ${channel}.`;
          }

          const formatted = messages
            .map((msg) => {
              const date = new Date(Number(msg.timestamp));
              const timeStr = date.toLocaleTimeString();
              return `[${timeStr}] <${msg.nick}> ${msg.message}`;
            })
            .join("\n");

          return `Recent messages in ${channel} (${messages.length} message${messages.length === 1 ? "" : "s"}):\n${formatted}`;
        }

        case "get_user_messages": {
          const messages = messageHistory.getMessagesByUser(
            channel,
            nick,
            effectiveLimit,
          );

          if (messages.length === 0) {
            return `No messages found from user "${nick}" in ${channel}.`;
          }

          const formatted = messages
            .map((msg) => {
              const date = new Date(Number(msg.timestamp));
              const timeStr = date.toLocaleTimeString();
              return `[${timeStr}] ${msg.message}`;
            })
            .join("\n");

          return `Messages from ${nick} in ${channel} (${messages.length} message${messages.length === 1 ? "" : "s"}):\n${formatted}`;
        }

        case "search_messages": {
          const messages = messageHistory.searchMessages(
            channel,
            search_text,
            effectiveLimit,
          );

          if (messages.length === 0) {
            return `No messages found containing "${search_text}" in ${channel}.`;
          }

          const formatted = messages
            .map((msg) => {
              const date = new Date(Number(msg.timestamp));
              const timeStr = date.toLocaleTimeString();
              return `[${timeStr}] <${msg.nick}> ${msg.message}`;
            })
            .join("\n");

          return `Messages containing "${search_text}" in ${channel} (${messages.length} match${messages.length === 1 ? "" : "es"}):\n${formatted}`;
        }

        case "semantic_search_messages": {
          const semanticMaxLimit = 50;
          const semanticDefaultLimit = 10;
          const semanticLimit = Math.min(
            limit || semanticDefaultLimit,
            semanticMaxLimit,
          );

          const results = await messageHistory.semanticSearch(
            channel,
            query,
            semanticLimit,
          );

          if (results.length === 0) {
            return `No semantically similar messages found for "${query}" in ${channel}.`;
          }

          const formatted = results
            .map((result) => {
              const date = new Date(Number(result.timestamp));
              const timeStr = date.toLocaleTimeString();
              const relevanceScore = (1 / (1 + result.distance)).toFixed(2); // Convert distance to relevance (0-1)
              return `[${timeStr}] <${result.nick}> ${result.message} (relevance: ${relevanceScore})`;
            })
            .join("\n");

          return `Semantically similar messages for "${query}" in ${channel} (${results.length} result${results.length === 1 ? "" : "s"}):\n${formatted}`;
        }

        case "get_channel_stats": {
          const totalMessages = messageHistory.getMessageCount(channel);
          const users = messageHistory.getChannelUsers(channel);

          if (totalMessages === 0) {
            return `No message history available for ${channel}.`;
          }

          const userList = users.slice(0, 10).join(", ");
          const moreUsers =
            users.length > 10 ? ` and ${users.length - 10} more` : "";

          return `${totalMessages} messages, ${users.length} users: ${userList}${moreUsers}`;
        }

        case "get_user_stats": {
          const userMessageCount = messageHistory.getUserMessageCount(
            channel,
            nick,
          );
          const totalMessages = messageHistory.getMessageCount(channel);

          if (totalMessages === 0) {
            return `No message history available for ${channel}.`;
          }

          if (userMessageCount === 0) {
            return `User "${nick}" has no messages in the history for ${channel}.`;
          }

          const percentage = ((userMessageCount / totalMessages) * 100).toFixed(
            1,
          );

          return `${nick}: ${userMessageCount} messages (${percentage}%)`;
        }

        case "get_daily_summaries": {
          const summaryMaxLimit = 30;
          const summaryDefaultLimit = 7;
          const summaryLimit = Math.min(
            limit || summaryDefaultLimit,
            summaryMaxLimit,
          );

          const summaries = messageHistory.getDailySummaries(
            channel,
            summaryLimit,
          );

          if (summaries.length === 0) {
            return `No daily summaries available for ${channel}.`;
          }

          const formatted = summaries
            .map((summary) => {
              const userList = summary.users.slice(0, 5).join(", ");
              const moreUsers =
                summary.users.length > 5
                  ? ` and ${summary.users.length - 5} more`
                  : "";
              return `${summary.date}: ${summary.message_count} messages by ${summary.user_count} users (${userList}${moreUsers})`;
            })
            .join("\n");

          return formatted;
        }

        default:
          throw new Error(`Unknown tool: ${toolName}`);
      }
    },
  };
}
