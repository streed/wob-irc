import { PluginLoader } from '../plugin-loader';
import { QueuedMessage } from '../types';
import { sanitizeUnicode } from '../unicode-sanitizer';

export type LLMTool = any; // Using OpenAI/Groq-compatible tool schema

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  // OpenAI/Groq-style function tool calls on assistant messages
  tool_calls?: Array<{ id?: string; type?: 'function'; function: { name: string; arguments: any } }>;
  // OpenAI/Groq requires tool message to include the tool_call_id linking back to assistant.tool_calls[i].id
  tool_call_id?: string;
}

export interface LLMChatResponse {
  message: LLMChatMessage;
}

export abstract class BaseLLMClient {
  protected model: string;
  protected systemPrompt: string;
  protected pluginLoader?: PluginLoader;
  protected conversationHistory: Map<string, any[]> = new Map();
  protected maxHistoryLength: number = 20;
  protected maxToolCallRounds: number = 10;
  protected chaosMode?: { enabled: boolean; probability: number };
  protected messageHistory?: any;
  protected maxContextTokens: number = 4096;
  protected disableThinking: boolean = false;
  protected readonly USER_MSG_MAX_CHARS = 1500;
  protected readonly TOOL_OUT_MAX_CHARS = 3000;
  protected readonly providerTag: string;

  constructor(
    providerTag: string,
    model: string,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any,
    maxContextTokens?: number,
    disableThinking?: boolean
  ) {
    this.providerTag = providerTag;
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxToolCallRounds = maxToolCallRounds || 10;
    this.chaosMode = chaosMode;
    this.messageHistory = messageHistory;
    this.maxContextTokens = maxContextTokens || 4096;
    this.disableThinking = !!disableThinking;
  }

  setPluginLoader(pluginLoader: PluginLoader): void {
    this.pluginLoader = pluginLoader;
  }

  async summarizeText(text: string, maxChars: number = 400): Promise<string> {
    try {
      const system = [
        'You are an assistant summarizer for an IRC bot.',
        'Goal: Rewrite the given assistant response to fit within the character limit while preserving key information and keeping the same tone and voice.',
        'Output strictly the final answer only — no reasoning, no preface, no meta commentary.',
        'Constraints:',
        `- Max ${maxChars} characters`,
        '- Plain text only (no markdown, lists, or code fences)',
        '- Prefer one succinct paragraph; if very dense, it may contain natural sentence breaks',
      ].join('\n');

      const response = await this.sendChat([
        { role: 'system', content: system },
        {
          role: 'user',
          content: `Summarize the following assistant response to <= ${maxChars} characters while keeping the same tone and preserving key information.\n\n---\n${text}`,
        },
      ]);

      const content = (response?.message?.content || '').trim();
      try {
        console.log(`[${this.providerTag}] Summarization raw output (${content.length} chars): ${content}`);
      } catch (_) {}
      if (content.length > maxChars) {
        return content.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return content;
    } catch (err) {
      console.error('Error during summarization:', err);
      if (text.length > maxChars) {
        return text.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return text;
    }
  }

  async processMessages(channel: string, messages: QueuedMessage[]): Promise<string> {
    // Get or initialize conversation history for this channel
    let history = this.conversationHistory.get(channel) || [];
    
    // Initialize with system prompt if new conversation
    if (history.length === 0) {
      history.push({ role: 'system', content: this.systemPrompt });
    }

    // Add context snippet (timestamp, channel, chaos mode snippets if enabled)
    const turnContext = this.buildTurnContextSnippet(channel);
    if (turnContext) {
      history.push({ role: 'system', content: turnContext });
    }

    // Add current messages
    const seenBatch = new Set<string>();
    for (const msg of messages) {
      const userText = String(msg.message || '').trim();
      if (!userText) continue;
      if (seenBatch.has(userText)) continue;
      seenBatch.add(userText);
      const cleaned = sanitizeUnicode(userText);
      const capped = this.capForHistory(cleaned, this.USER_MSG_MAX_CHARS, false);
      history.push({ role: 'user', content: `[${msg.nick}] ${capped}` });
    }

    const tools = this.pluginLoader ? this.pluginLoader.getToolsForOllama() : [];

    try {
      let requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      requestHistory = this.pruneEmptyMessages(requestHistory);
      this.logRequestHistory('Initial request', requestHistory);

      let response = await this.chatWithResilience(requestHistory, tools.length > 0 ? tools : undefined, 'Initial request');

      if ((!response.message.tool_calls || response.message.tool_calls.length === 0) && response?.message?.content) {
        const inlineToolCalls = this.parseInlineToolCalls(String(response.message.content || ''));
        if (inlineToolCalls.length > 0) {
          response.message.tool_calls = inlineToolCalls as any;
          response.message.content = '';
          console.log(`[${this.providerTag}] Detected inline tool calls: ${inlineToolCalls.map((c:any)=>c.function.name).join(', ')}`);
        }
      }
      // Ensure tool call IDs exist for providers that require linking (e.g., Groq/OpenAI)
      if (response?.message?.tool_calls && response.message.tool_calls.length > 0) {
        this.ensureToolCallIds(response.message);
      }

      try {
        const toolCount = response?.message?.tool_calls?.length || 0;
        console.log(`[${this.providerTag}] Initial LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
      } catch (_) {}

      let toolCallRound = 0;
      const toolUsageHistory: string[] = [];
      let maxRoundsExceeded = false;

      while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        toolCallRound++;
        if (toolCallRound > this.maxToolCallRounds) {
          console.warn(`[${this.providerTag}] Maximum tool call rounds (${this.maxToolCallRounds}) exceeded. Stopping tool execution.`);
          maxRoundsExceeded = true;
          break;
        }
        const currentToolCalls = response.message.tool_calls
          .map((tc: any) => tc.function.name)
          .sort()
          .join(',');

        if (toolUsageHistory.length >= 2) {
          const lastPattern = toolUsageHistory[toolUsageHistory.length - 1];
          const secondLastPattern = toolUsageHistory[toolUsageHistory.length - 2];
          if (currentToolCalls === lastPattern && currentToolCalls === secondLastPattern) {
            console.warn(`[${this.providerTag}] Detected tool usage loop. Same tool(s) called 3 times in a row: ${currentToolCalls}`);
            maxRoundsExceeded = true;
            break;
          }
        }
        toolUsageHistory.push(currentToolCalls);

        console.log(`[${this.providerTag}] Tool call round ${toolCallRound}: ${response.message.tool_calls.length} tool(s) to execute`);
        if (toolCallRound >= this.maxToolCallRounds - 2) {
          console.warn(`[${this.providerTag}] Approaching maximum tool call rounds (${toolCallRound}/${this.maxToolCallRounds})`);
        }

        history.push(response.message);

        for (let idx = 0; idx < response.message.tool_calls.length; idx++) {
          const toolCall = response.message.tool_calls[idx] as any;
          if (!this.pluginLoader) {
            throw new Error('PluginLoader not set but tool calls were received');
          }
          let parsedArgs: Record<string, any> = {};
          try {
            const rawArgs = toolCall.function.arguments;
            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {});
          } catch (e) {
            console.warn(`[${this.providerTag}] Failed to parse tool arguments, passing raw value`);
            parsedArgs = (toolCall.function as any).arguments as any;
          }

          const toolResult = await this.pluginLoader.executeToolCall(
            toolCall.function.name,
            parsedArgs
          );

          const toolOut = this.capForHistory(String(toolResult ?? ''), this.TOOL_OUT_MAX_CHARS, true);
          const tool_call_id = typeof toolCall?.id === 'string' && toolCall.id ? toolCall.id : `call_${idx}`;
          history.push({ role: 'tool', content: toolOut, tool_call_id });
        }

        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        requestHistory = this.pruneEmptyMessages(requestHistory);
        this.logRequestHistory(`Tool round ${toolCallRound} request`, requestHistory);
        response = await this.chatWithResilience(requestHistory, tools.length > 0 ? tools : undefined, `Tool round ${toolCallRound}`);

        if ((!response.message.tool_calls || response.message.tool_calls.length === 0) && response?.message?.content) {
          const inlineToolCalls = this.parseInlineToolCalls(String(response.message.content || ''));
          if (inlineToolCalls.length > 0) {
            response.message.tool_calls = inlineToolCalls as any;
            response.message.content = '';
            console.log(`[${this.providerTag}] Detected inline tool calls (follow-up): ${inlineToolCalls.map((c:any)=>c.function.name).join(', ')}`);
          }
        }
        if (response?.message?.tool_calls && response.message.tool_calls.length > 0) {
          this.ensureToolCallIds(response.message);
        }

        try {
          const toolCount = response?.message?.tool_calls?.length || 0;
          console.log(`[${this.providerTag}] Follow-up LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
        } catch (_) {}
      }

      if (maxRoundsExceeded) {
        console.log(`[${this.providerTag}] Requesting final response from LLM after breaking tool call loop`);
        history.push(response.message);
        history.push({ role: 'user', content: 'Please provide a response based on the information gathered from the tools.' });
        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        requestHistory = this.pruneEmptyMessages(requestHistory);
        this.logRequestHistory('Forced final request', requestHistory);
        response = await this.chatWithResilience(requestHistory, undefined, 'Forced final');
        try { console.log(`[${this.providerTag}] Forced final LLM response (raw): ${response?.message?.content || ''}`); } catch (_) {}
      }

      if (toolCallRound > 0) {
        console.log(`[${this.providerTag}] Completed ${toolCallRound} tool call round(s)`);
      }

      try { console.log(`[${this.providerTag}] Final assistant message (raw): ${response?.message?.content || ''}`); } catch (_) {}

      const filtered = this.filterThinkBlocks(String(response.message.content || ''));
      try { console.log(`[${this.providerTag}] Final assistant message (filtered): ${filtered}`); } catch (_) {}

      // Clean up history before saving:
      // 1. Remove all assistant messages with tool_calls (keep only final output)
      // 2. Remove all tool messages (they're ephemeral)
      // 3. Keep user messages and system messages
      history = this.pruneAssistantToolMessages(history);
      
      // Add the final assistant response (content only, no tool calls)
      if (filtered && filtered.trim()) {
        history.push({ role: 'assistant', content: filtered });
      }
      
      // Compact and save the cleaned history
      history = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      if (history.length > this.maxHistoryLength) {
        const systemMsg = history[0];
        const recentMessages = history.slice(-this.maxHistoryLength + 1);
        history = [systemMsg, ...recentMessages];
      }
      this.conversationHistory.set(channel, history);
      
      return sanitizeUnicode(filtered);
    } catch (error) {
      console.error(`Error calling ${this.providerTag}:`, error);
      try {
        const msg = String((error as any)?.error || (error as any)?.message || error);
        if (msg.includes('Invalid tool usage: mismatch between tool calls and tool results')) {
          console.warn(`[${this.providerTag}] Clearing conversation history due to invalid tool usage mismatch`);
          this.clearHistory(channel);
        }
      } catch (_) {}
      throw error;
    }
  }

  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }

  async recordAssistantOutput(channel: string, content: string): Promise<void> {
    // Record the assistant's final output (not tool calls or thinking)
    const trimmed = String(content || '').trim();
    if (!trimmed) return;
    
    let history = this.conversationHistory.get(channel) || [];
    if (history.length === 0) {
      history.push({ role: 'system', content: this.systemPrompt });
    }
    
    // Check if this exact content was already added (avoid duplicates)
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m?.role === 'assistant') {
        if (String(m.content || '').trim() === trimmed) {
          // Already recorded, no need to add again
          this.conversationHistory.set(channel, history);
          return;
        }
        break;
      }
    }
    
    // Add the assistant's response
    history.push({ role: 'assistant', content: trimmed });

    // Compact and maintain size limits
    history = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
    if (history.length > this.maxHistoryLength) {
      const systemMsg = history[0];
      const recentMessages = history.slice(-this.maxHistoryLength + 1);
      history = [systemMsg, ...recentMessages];
    }
    this.conversationHistory.set(channel, history);
  }

  protected getChatOptions(): Record<string, any> | undefined {
    if (!this.disableThinking) return undefined;
    const stop = ['<think>', '<thinking>', '<reasoning>'];
    return { stop } as any;
  }

  private pruneEmptyMessages(messages: any[]): any[] {
    return (messages || []).filter(m => {
      const role = m?.role;
      const hasToolCalls = Array.isArray((m as any)?.tool_calls) && (m as any).tool_calls.length > 0;
      const content = String(m?.content ?? '').trim();
      if (role === 'assistant' && hasToolCalls) return true;
      if (role === 'tool') return true;
      if (role === 'system') return content.length > 0;
      return content.length > 0;
    });
  }

  private estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(text.length / 4);
  }

  private async compactHistoryToTokenLimit(messages: any[], maxTokens: number): Promise<any[]> {
    if (!messages || messages.length === 0) return [];
    if (messages.length === 1) return messages;

    const system = messages[0];
    const rest = messages.slice(1);
    const reserveFraction = 0.1;
    const effectiveMax = Math.max(256, Math.floor(maxTokens * (1 - reserveFraction)));
    const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (totalTokens <= effectiveMax) return messages;

    const budgetForRecent = Math.max(Math.floor(effectiveMax * 0.6), 1);
    const minRecentCount = 6;

    const recent: any[] = [];
    let recentTokens = this.estimateMessageTokens(system);
    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const cost = this.estimateMessageTokens(msg);
      const forceKeep = recent.length < minRecentCount;
      if (!forceKeep && recentTokens + cost > budgetForRecent) break;
      recent.push(msg);
      recentTokens += cost;
    }
    recent.reverse();

    const olderCount = rest.length - recent.length;
    const older = olderCount > 0 ? rest.slice(0, olderCount) : [];
    if (older.length === 0) {
      return this.trimHistoryToTokenLimit(messages, effectiveMax);
    }

    const line = (m: any): string => {
      const role = m?.role || 'unknown';
      const raw = String(m?.content || '');
      const capped = raw.length > 600 ? raw.slice(0, 600) + '…' : raw;
      return `${role}: ${capped}`;
    };
    const transcript = older.map(line).join('\n');

    let summaryContent = '';
    try {
      const summarizerSystem = [
        'You are an assistant compressing earlier conversation context for an IRC bot.',
        'Return only a compact memory in plain text (no preface, no labels).',
        'Include: key facts, constraints, decisions, numbers, names; user intents and outcomes.',
        'Avoid quotes, lists, or markdown. Use 1–2 concise sentences.',
      ].join('\n');

      const response = await this.sendChat([
        { role: 'system', content: summarizerSystem },
        { role: 'user', content: `Summarize this earlier context:\n\n${transcript}` },
      ]);
      summaryContent = String(response?.message?.content || '').trim();
      if (!summaryContent) {
        summaryContent = this.truncate(transcript, 600);
      }
    } catch (e) {
      summaryContent = this.truncate(transcript, 600);
    }

    const summaryMsg = { role: 'system', content: `Conversation summary so far: ${summaryContent}` };
    let composed = [system, summaryMsg, ...recent];
    const composedTokens = composed.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (composedTokens <= effectiveMax) return composed;

    try {
      const targetChars = 220;
      const shrunk = await this.summarizeText(summaryMsg.content, targetChars);
      composed = [system, { role: 'system', content: shrunk }, ...recent];
    } catch (_) {}

    return this.trimHistoryToTokenLimit(composed, effectiveMax);
  }

  private estimateMessageTokens(msg: any): number {
    const overhead = 4;
    return overhead + this.estimateTokens(msg?.content || '');
  }

  private trimHistoryToTokenLimit(messages: any[], maxTokens: number): any[] {
    if (!messages || messages.length === 0) return [];
    const system = messages[0];
    const rest = messages.slice(1);

    const selected: any[] = [];
    let total = this.estimateMessageTokens(system);
    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const cost = this.estimateMessageTokens(msg);
      if (total + cost > maxTokens) break;
      selected.push(msg);
      total += cost;
    }
    selected.reverse();
    return [system, ...selected];
  }

  private pruneAssistantToolMessages(messages: any[]): any[] {
    if (!messages || messages.length === 0) return messages;
    const system = messages[0];
    const rest = messages.slice(1);
    // Remove:
    // 1. ALL assistant messages that contain tool_calls 
    // 2. ALL tool messages (they're ephemeral and only for current round)
    const pruned = rest.filter((m: any) => {
      // Remove assistant messages with tool calls
      if (m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        return false;
      }
      // Remove tool messages
      if (m?.role === 'tool') {
        return false;
      }
      return true;
    });
    return [system, ...pruned];
  }

  protected truncate(text: string, max: number): string {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + '…';
  }

  protected logRequestHistory(label: string, messages: any[]): void {
    try {
      const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
      const ua = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
      console.log(`[${this.providerTag}] ${label}: sending ${messages.length} message(s), ~${totalTokens} tokens (UA turns: ${ua.length})`);
      const lines = ua.map((m, i) => {
        const base = this.truncate(String(m.content || ''), 500);
        const toolInfo = (m.role === 'assistant' && Array.isArray((m as any).tool_calls))
          ? ` [tool_calls=${(m as any).tool_calls.length}]`
          : '';
        return `  [${i}] ${m.role}${toolInfo}: ${base}`;
      });
      if (lines.length > 0) {
        console.log(lines.join('\n'));
      } else {
        console.log('  (no user/assistant turns; likely system/tool-only)');
      }
    } catch (_) {}
  }

  protected buildTurnContextSnippet(channel: string): string {
    try {
      const now = new Date();
      
      // Format date as mm-dd-yyyy for better temporal awareness
      const month = String(now.getMonth() + 1).padStart(2, '0');
      const day = String(now.getDate()).padStart(2, '0');
      const year = now.getFullYear();
      const formattedDate = `${month}-${day}-${year}`;
      
      // Also include time for more precise context
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${hours}:${minutes}`;
      
      const parts: string[] = [];
      parts.push(`Current date: ${formattedDate} (mm-dd-yyyy), Time: ${timeStr} UTC, Channel: ${channel}`);
      
      if (this.chaosMode?.enabled && this.messageHistory) {
        try {
          const p = typeof this.chaosMode.probability === 'number' ? this.chaosMode.probability : 0.1;
          const roll = Math.random();
          if (roll < p) {
            const randomMessages = this.messageHistory.getRandomMessages(channel, 3) || [];
            if (randomMessages.length > 0) {
              const snippets = randomMessages
                .map((m: any) => `[${m.nick}] ${String(m.message || '').slice(0, 120)}`)
                .join(' | ');
              parts.push(`Chaos snippets: ${snippets}`);
            }
          }
        } catch (err) {
          console.error('Error getting chaos snippets:', err);
        }
      }
      return parts.join('\n');
    } catch (_) {
      return '';
    }
  }

  protected filterThinkBlocks(text: string): string {
    if (!text) return '';
    let result = String(text);
    const tagPatterns = [
      /<think>[\s\S]*?<\/think>/gis,
      /<thinking>[\s\S]*?<\/thinking>/gis,
      /<reasoning>[\s\S]*?<\/reasoning>/gis,
    ];
    for (const re of tagPatterns) {
      result = result.replace(re, '');
    }
    result = result.replace(/[\s\S]*?<\/(think|thinking|reasoning)>/gis, '');
    return result.trim();
  }

  protected capForHistory(text: string, max: number, annotate: boolean): string {
    const raw = String(text || '');
    if (raw.length <= max) return raw;
    if (!annotate) return this.truncate(raw, max);
    const budget = Math.max(30, max - 14);
    return this.truncate(raw, budget) + ' [truncated]';
  }

  protected parseInlineToolCalls(text: string): Array<{ function: { name: string; arguments: any } }> {
    const calls: Array<{ function: { name: string; arguments: any } }> = [];
    if (!text) return calls;
    try {
      const regex = /<callsfxn\w*>\s*([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|toolcallargumentbegin\|>([\s\S]*?)<\|toolcallend\|>/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const name = (match[1] || '').trim();
        const rawArgs = (match[2] || '').trim();
        let parsed: any = {};
        try { parsed = rawArgs ? JSON.parse(rawArgs) : {}; } catch (_) {
          const jsonLike = rawArgs.slice(rawArgs.indexOf('{'), rawArgs.lastIndexOf('}') + 1);
          try { parsed = JSON.parse(jsonLike); } catch (_) { parsed = {}; }
        }
        calls.push({ function: { name, arguments: parsed } });
      }
    } catch (_) {}
    return calls;
  }

  // Ensure assistant message tool_calls have stable ids for tool result linking
  protected ensureToolCallIds(assistantMessage: LLMChatMessage): void {
    if (!assistantMessage || !Array.isArray(assistantMessage.tool_calls)) return;
    assistantMessage.tool_calls = assistantMessage.tool_calls.map((tc: any, i: number) => {
      const id = typeof tc?.id === 'string' && tc.id ? tc.id : `call_${i}`;
      return { id, type: tc?.type || 'function', function: tc?.function };
    });
  }

  protected async chatWithResilience(messages: any[], tools: any[] | undefined, label: string): Promise<LLMChatResponse> {
    try {
      let res = await this.sendChat(messages, tools);
      this.logRawResponse(label, res);
      const content = String(res?.message?.content || '').trim();
      const toolCalls = (res?.message?.tool_calls || []).length;
      if (!content && toolCalls === 0) {
        console.warn(`[${this.providerTag}] ${label} returned empty content; retrying with explicit answer instruction`);
        const nudged = [...messages, { role: 'system', content: 'Return only the final answer in plain text (no reasoning). Do not call any tools or functions. If the question needs tools you do not have, answer briefly with what you know.' }];
        const reduced = await this.trimHistoryToTokenLimit(nudged, Math.floor(this.maxContextTokens * 0.7));
        res = await this.sendChat(reduced, undefined);
        this.logRawResponse(`${label} retry-empty`, res);
      }
      return res;
    } catch (err: any) {
      const errMsg = String(err?.error || err?.message || err);
      console.warn(`[${this.providerTag}] ${label} failed: ${errMsg}`);
      this.logRawError(label, err);
      try {
        // Add explicit instruction to not use tools in the retry
        const retryMessages = [
          ...messages,
          { role: 'system', content: 'You MUST NOT call any tools or functions. Provide a direct text response only. If you need information from tools, explain what you would need instead of trying to call them.' }
        ];
        const reduced = await this.trimHistoryToTokenLimit(retryMessages, Math.floor(this.maxContextTokens * 0.7));
        console.log(`[${this.providerTag}] Retrying ${label} with explicit no-tools instruction and reduced context`);
        const retryRes = await this.sendChat(reduced, undefined);
        this.logRawResponse(`${label} retry`, retryRes);
        return retryRes;
      } catch (err2: any) {
        const err2Msg = String(err2?.error || err2?.message || err2);
        console.error(`[${this.providerTag}] Retry for ${label} failed: ${err2Msg}`);
        this.logRawError(`${label} retry`, err2);
        throw err2;
      }
    }
  }

  protected logRawResponse(label: string, payload: any): void {
    try {
      const json = JSON.stringify(payload);
      const max = 8000;
      const out = json.length > max ? json.slice(0, max) + '…' : json;
      console.log(`[${this.providerTag}][RAW ${label}] ${out}`);
    } catch (_) {
      try { console.log(`[${this.providerTag}][RAW ${label}] (unserializable)`); } catch (_) {}
    }
  }

  protected logRawError(label: string, err: any): void {
    try {
      const json = JSON.stringify({ error: (err as any)?.error || String((err as any)?.message || err) });
      console.log(`[${this.providerTag}][RAW-ERROR ${label}] ${json}`);
    } catch (_) {
      try { console.log(`[${this.providerTag}][RAW-ERROR ${label}] ${String(err)}`); } catch (_) {}
    }
  }

  protected abstract sendChat(messages: LLMChatMessage[], tools?: LLMTool[] | undefined): Promise<LLMChatResponse>;
}
