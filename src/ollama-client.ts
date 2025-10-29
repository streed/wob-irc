import { Ollama } from 'ollama';
import { QueuedMessage } from './types';
import { PluginLoader } from './plugin-loader';
import { sanitizeUnicode } from './unicode-sanitizer';

export class OllamaClient {
  private ollama: Ollama;
  private model: string;
  private systemPrompt: string;
  private pluginLoader?: PluginLoader;
  private conversationHistory: Map<string, any[]> = new Map();
  private maxHistoryLength: number = 20;
  private maxToolCallRounds: number = 10;
  private chaosMode?: { enabled: boolean; probability: number };
  private messageHistory?: any;
  private maxContextTokens: number = 4096;
  private disableThinking: boolean = false;
  // Upper bounds for safety when recording into history
  private readonly USER_MSG_MAX_CHARS = 1500;
  private readonly TOOL_OUT_MAX_CHARS = 3000;

  constructor(
    host: string,
    model: string,
    systemPrompt: string,
    maxToolCallRounds?: number,
    chaosMode?: { enabled: boolean; probability: number },
    messageHistory?: any,
    maxContextTokens?: number,
    disableThinking?: boolean
  ) {
    this.ollama = new Ollama({ host });
    this.model = model;
    this.systemPrompt = systemPrompt;
    this.maxToolCallRounds = maxToolCallRounds || 10;
    this.chaosMode = chaosMode;
    this.messageHistory = messageHistory;
    this.maxContextTokens = maxContextTokens || 4096;
    this.disableThinking = !!disableThinking;
  }

  /**
   * Summarize a long assistant response to fit within a character limit,
   * preserving key information and mimicking the original tone.
   */
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

      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          {
            role: 'user',
            content: `Summarize the following assistant response to <= ${maxChars} characters while keeping the same tone and preserving key information.\n\n---\n${text}`,
          },
        ],
        tools: undefined,
        options: this.getChatOptions(),
      });

      const content = (response?.message?.content || '').trim();
      // Log raw summarization output from the LLM for debugging
      try {
        console.log(`[Ollama] Summarization raw output (${content.length} chars): ${content}`);
      } catch (_) {
        // best-effort logging only
      }
      // Best-effort hard limit enforcement if the model overruns
      if (content.length > maxChars) {
        return content.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return content;
    } catch (err) {
      console.error('Error during summarization:', err);
      // Fallback: hard truncate with ellipsis
      if (text.length > maxChars) {
        return text.slice(0, maxChars - 1).trimEnd() + '…';
      }
      return text;
    }
  }

  /**
   * Set the PluginLoader to use for tool execution
   */
  setPluginLoader(pluginLoader: PluginLoader): void {
    this.pluginLoader = pluginLoader;
  }

  async processMessages(channel: string, messages: QueuedMessage[]): Promise<string> {
    // Get conversation history for this channel
    let history = this.conversationHistory.get(channel) || [];
    
    // Add system prompt if this is the first message
    if (history.length === 0) {
      history.push({
        role: 'system',
        content: this.systemPrompt,
      });
    }

    // Add a compact per-turn context snippet (time/channel and optional chaos snippets)
    const turnContext = this.buildTurnContextSnippet(channel);
    if (turnContext) {
      history.push({ role: 'system', content: turnContext });
    }

    // Add the new user messages as conversational turns (skip empties, de-dupe within this batch)
    const seenBatch = new Set<string>();
    for (const msg of messages) {
      const userText = String(msg.message || '').trim();
      if (!userText) continue; // Skip empty user messages
      if (seenBatch.has(userText)) continue; // De-duplicate identical lines in this batch
      seenBatch.add(userText);
      const cleaned = sanitizeUnicode(userText);
      const capped = this.capForHistory(cleaned, this.USER_MSG_MAX_CHARS, /*annotate*/ false);
      history.push({
        role: 'user',
        content: `[${msg.nick}] ${capped}`,
      });
    }

    // Get tools from plugins
    const tools = this.pluginLoader ? this.pluginLoader.getToolsForOllama() : [];

    try {
      // Prepare a compacted copy of the history that fits within token limit
      let requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      requestHistory = this.pruneEmptyMessages(requestHistory);
      // Log the user/assistant turns being sent
      this.logRequestHistory('Initial request', requestHistory);

      let response = await this.chatWithResilience(requestHistory, tools.length > 0 ? tools : undefined, 'Initial request');

      // Support inline tool-calls embedded in text content (fallback formats)
      if ((!response.message.tool_calls || response.message.tool_calls.length === 0) && response?.message?.content) {
        const inlineToolCalls = this.parseInlineToolCalls(String(response.message.content || ''));
        if (inlineToolCalls.length > 0) {
          response.message.tool_calls = inlineToolCalls as any;
          response.message.content = '';
          console.log(`[Ollama] Detected inline tool calls: ${inlineToolCalls.map((c:any)=>c.function.name).join(', ')}`);
        }
      }

      // Log the initial raw assistant response (including when it contains tool calls)
      try {
        const toolCount = response?.message?.tool_calls?.length || 0;
        console.log(`[Ollama] Initial LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
      } catch (_) {
        // best-effort logging only
      }

      // Handle tool calls in a loop with a maximum number of rounds
      let toolCallRound = 0;
      const toolUsageHistory: string[] = []; // Track tool usage to detect loops
      let maxRoundsExceeded = false;
      
      while (response.message.tool_calls && response.message.tool_calls.length > 0) {
        toolCallRound++;
        
        // Check if we've exceeded the maximum number of rounds
        if (toolCallRound > this.maxToolCallRounds) {
          console.warn(`[Ollama] Maximum tool call rounds (${this.maxToolCallRounds}) exceeded. Stopping tool execution.`);
          maxRoundsExceeded = true;
          break;
        }
        
        // Track tool usage and detect loops
        const currentToolCalls = response.message.tool_calls
          .map((tc: any) => tc.function.name)
          .sort()
          .join(',');
        
        // Check if we're repeating the same tool pattern
        if (toolUsageHistory.length >= 2) {
          const lastPattern = toolUsageHistory[toolUsageHistory.length - 1];
          const secondLastPattern = toolUsageHistory[toolUsageHistory.length - 2];
          
          if (currentToolCalls === lastPattern && currentToolCalls === secondLastPattern) {
            console.warn(`[Ollama] Detected tool usage loop. Same tool(s) called 3 times in a row: ${currentToolCalls}`);
            maxRoundsExceeded = true;
            break;
          }
        }
        
        toolUsageHistory.push(currentToolCalls);
        
        // Log the current round
        console.log(`[Ollama] Tool call round ${toolCallRound}: ${response.message.tool_calls.length} tool(s) to execute`);
        
        // Warn when approaching the limit
        if (toolCallRound >= this.maxToolCallRounds - 2) {
          console.warn(`[Ollama] Approaching maximum tool call rounds (${toolCallRound}/${this.maxToolCallRounds})`);
        }

        // Add assistant's response with tool calls to history
        history.push(response.message);

        // Execute each tool call
        for (const toolCall of response.message.tool_calls) {
          if (!this.pluginLoader) {
            throw new Error('PluginLoader not set but tool calls were received');
          }
          // Handle both stringified and object arguments from tool calls
          let parsedArgs: Record<string, any> = {};
          try {
            const rawArgs = toolCall.function.arguments;
            parsedArgs = typeof rawArgs === 'string' ? JSON.parse(rawArgs || '{}') : (rawArgs || {});
          } catch (e) {
            console.warn('[Ollama] Failed to parse tool arguments, passing raw value');
            // Fallback: pass through as-is; plugin may handle strings if needed
            parsedArgs = (toolCall.function as any).arguments as any;
          }

        const toolResult = await this.pluginLoader.executeToolCall(
            toolCall.function.name,
            parsedArgs
          );

          // Add tool response to history
          const toolOut = this.capForHistory(String(toolResult ?? ''), this.TOOL_OUT_MAX_CHARS, /*annotate*/ true);
          history.push({
            role: 'tool',
            content: toolOut,
          });
        }

        // Prepare compacted history again for next round
        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        requestHistory = this.pruneEmptyMessages(requestHistory);
        this.logRequestHistory(`Tool round ${toolCallRound} request`, requestHistory);

        // Get next response from the model
        response = await this.chatWithResilience(requestHistory, tools.length > 0 ? tools : undefined, `Tool round ${toolCallRound}`);

        // Detect inline tool calls in follow-up content as well
        if ((!response.message.tool_calls || response.message.tool_calls.length === 0) && response?.message?.content) {
          const inlineToolCalls = this.parseInlineToolCalls(String(response.message.content || ''));
          if (inlineToolCalls.length > 0) {
            response.message.tool_calls = inlineToolCalls as any;
            response.message.content = '';
            console.log(`[Ollama] Detected inline tool calls (follow-up): ${inlineToolCalls.map((c:any)=>c.function.name).join(', ')}`);
          }
        }

        // Log follow-up raw assistant response
        try {
          const toolCount = response?.message?.tool_calls?.length || 0;
          console.log(`[Ollama] Follow-up LLM response (raw, tools=${toolCount}): ${response?.message?.content || ''}`);
        } catch (_) {
          // best-effort logging only
        }
      }
      
      // If we exceeded max rounds or detected a loop, force a final response without tools
      if (maxRoundsExceeded) {
        console.log(`[Ollama] Requesting final response from LLM after breaking tool call loop`);
        
        // Add assistant's last response (with tool calls) to history
        history.push(response.message);
        
        // Add a user message to prompt for a summary
        history.push({
          role: 'user',
          content: 'Please provide a response based on the information gathered from the tools.',
        });
        
        // Get final response without allowing more tool calls
        requestHistory = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
        requestHistory = this.pruneEmptyMessages(requestHistory);
        this.logRequestHistory('Forced final request', requestHistory);
        response = await this.chatWithResilience(requestHistory, undefined, 'Forced final');

        // Log the forced final raw assistant response
        try {
          console.log(`[Ollama] Forced final LLM response (raw): ${response?.message?.content || ''}`);
        } catch (_) {
          // best-effort logging only
        }
      }
      
      // Log completion
      if (toolCallRound > 0) {
        console.log(`[Ollama] Completed ${toolCallRound} tool call round(s)`);
      }

      // Log the final raw content prior to filtering
      try {
        console.log(`[Ollama] Final assistant message (raw): ${response?.message?.content || ''}`);
      } catch (_) {
        // best-effort logging only
      }

      // Filter out <think> blocks and sanitize Unicode before returning
      const filtered = this.filterThinkBlocks(String(response.message.content || ''));

      // Log the filtered content actually used for output
      try {
        console.log(`[Ollama] Final assistant message (filtered): ${filtered}`);
      } catch (_) {
        // best-effort logging only
      }

      // Important: do NOT add the raw assistant response to history here.
      // We only want to remember what was actually sent to IRC (post-cleaning/summary),
      // which the caller will record via recordAssistantOutput().

      // Still prune earlier assistant tool-call messages to keep history tidy
      history = this.pruneAssistantToolMessages(history);

      // Compact history using token limit (and fallback to max message count)
      history = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
      if (history.length > this.maxHistoryLength) {
        const systemMsg = history[0];
        const recentMessages = history.slice(-this.maxHistoryLength + 1);
        history = [systemMsg, ...recentMessages];
      }

      // Update conversation history without the final assistant message
      this.conversationHistory.set(channel, history);

      return sanitizeUnicode(filtered);
    } catch (error) {
      console.error('Error calling Ollama:', error);
      try {
        const msg = String((error as any)?.error || (error as any)?.message || error);
        if (msg.includes('Invalid tool usage: mismatch between tool calls and tool results')) {
          console.warn('[Ollama] Clearing conversation history due to invalid tool usage mismatch');
          this.clearHistory(channel);
        }
      } catch (_) {}
      throw error;
    }
  }

  /**
   * Parse inline tool call formats embedded in assistant text output.
   * Supported pattern example:
   *   <callsfxnwarm> getweather:0<|toolcallargumentbegin|>{"query":"Leavenworth, WA"}<|toolcallend|>
   */
  private parseInlineToolCalls(text: string): Array<{ function: { name: string; arguments: any } }> {
    const calls: Array<{ function: { name: string; arguments: any } }> = [];
    if (!text) return calls;

    try {
      const regex = /<callsfxn\w*>\s*([a-zA-Z0-9_\-]+)(?::\d+)?\s*<\|toolcallargumentbegin\|>([\s\S]*?)<\|toolcallend\|>/g;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const name = (match[1] || '').trim();
        const rawArgs = (match[2] || '').trim();
        let parsed: any = {};
        try {
          parsed = rawArgs ? JSON.parse(rawArgs) : {};
        } catch (_) {
          // If JSON parse fails, try to salvage by extracting {...}
          const jsonLike = rawArgs.slice(rawArgs.indexOf('{'), rawArgs.lastIndexOf('}') + 1);
          try { parsed = JSON.parse(jsonLike); } catch (_) { parsed = {}; }
        }
        calls.push({ function: { name, arguments: parsed } });
      }
    } catch (_) {
      // ignore parsing errors
    }
    return calls;
  }

  /**
   * Wrapper around ollama.chat with defensive retries for common server failures
   * such as 500s that return non-JSON bodies (e.g., "Internal Server Error").
   * Strategy:
   *  - Attempt 1: send as-is
   *  - On failure: retry once with tools disabled and a tighter token budget
   */
  private async chatWithResilience(messages: any[], tools: any[] | undefined, label: string): Promise<any> {
    try {
      // First attempt
      let res = await this.ollama.chat({ model: this.model, messages, tools, options: this.getChatOptions() });
      this.logRawResponse(label, res);
      const content = String(res?.message?.content || '').trim();
      const toolCalls = (res?.message?.tool_calls || []).length;
      if (!content && toolCalls === 0) {
        console.warn(`[Ollama] ${label} returned empty content; retrying with explicit answer instruction`);
        const nudged = [...messages, { role: 'system', content: 'Return only the final answer in plain text (no reasoning). If the question needs tools you do not have, answer briefly with what you know.' }];
        const reduced = await this.trimHistoryToTokenLimit(nudged, Math.floor(this.maxContextTokens * 0.7));
        res = await this.ollama.chat({ model: this.model, messages: reduced, tools: undefined, options: this.getChatOptions() });
        this.logRawResponse(`${label} retry-empty`, res);
      }
      return res;
    } catch (err: any) {
      const errMsg = String(err?.error || err?.message || err);
      const status = (err as any)?.status_code;
      console.warn(`[Ollama] ${label} failed (status=${status || 'unknown'}): ${errMsg}`);
      this.logRawError(label, err);

      // Retry once: disable tools and shrink context further to avoid server issues
      try {
        const reduced = await this.trimHistoryToTokenLimit(messages, Math.floor(this.maxContextTokens * 0.7));
        console.log(`[Ollama] Retrying ${label} with tools disabled and reduced context`);
        const retryRes = await this.ollama.chat({ model: this.model, messages: reduced, tools: undefined, options: this.getChatOptions() });
        this.logRawResponse(`${label} retry`, retryRes);
        return retryRes;
      } catch (err2: any) {
        const err2Msg = String(err2?.error || err2?.message || err2);
        const status2 = (err2 as any)?.status_code;
        console.error(`[Ollama] Retry for ${label} failed (status=${status2 || 'unknown'}): ${err2Msg}`);
        this.logRawError(`${label} retry`, err2);
        throw err2;
      }
    }
  }

  // Compose chat options to influence model behavior (e.g., disable thinking)
  private getChatOptions(): Record<string, any> | undefined {
    if (!this.disableThinking) return undefined;
    // Stop sequences to prevent chain-of-thought tags from being emitted
    const stop = ['<think>', '<thinking>', '<reasoning>'];
    return { stop } as any;
  }

  // Debug helpers for raw logging (size-limited)
  private logRawResponse(label: string, payload: any): void {
    try {
      const json = JSON.stringify(payload);
      const max = 8000;
      const out = json.length > max ? json.slice(0, max) + '…' : json;
      console.log(`[Ollama][RAW ${label}] ${out}`);
    } catch (_) {
      try { console.log(`[Ollama][RAW ${label}] (unserializable)`); } catch (_) {}
    }
  }

  private logRawError(label: string, err: any): void {
    try {
      const json = JSON.stringify({
        status_code: (err as any)?.status_code,
        error: (err as any)?.error || String((err as any)?.message || err),
      });
      console.log(`[Ollama][RAW-ERROR ${label}] ${json}`);
    } catch (_) {
      try { console.log(`[Ollama][RAW-ERROR ${label}] ${String(err)}`); } catch (_) {}
    }
  }

  // Remove messages with empty/whitespace content, but keep assistant tool-call messages and tool results
  private pruneEmptyMessages(messages: any[]): any[] {
    return (messages || []).filter(m => {
      const role = m?.role;
      const hasToolCalls = Array.isArray((m as any)?.tool_calls) && (m as any).tool_calls.length > 0;
      const content = String(m?.content ?? '').trim();
      if (role === 'assistant' && hasToolCalls) return true; // preserve assistant tool-call intents
      if (role === 'tool') return true; // preserve tool outputs
      if (role === 'system') return content.length > 0; // keep non-empty system messages
      // For user/assistant without tool calls: require non-empty content
      return content.length > 0;
    });
  }

  // Approximate token estimation utilities and history trimming
  private estimateTokens(text: string): number {
    if (!text) return 0;
    // Rough heuristic: ~4 chars/token
    return Math.ceil(text.length / 4);
  }

  /**
   * Compact conversation history to fit within a token budget while preserving relevance.
   * Strategy:
   * - Always keep the original system prompt.
   * - Keep recent turns intact up to ~60% of the token budget (or at least a few messages).
   * - Summarize the older portion into a concise system-context message capturing key facts/decisions.
   * - Fall back to hard trimming if still above budget.
   */
  private async compactHistoryToTokenLimit(messages: any[], maxTokens: number): Promise<any[]> {
    if (!messages || messages.length === 0) return [];
    if (messages.length === 1) return messages;

    const system = messages[0];
    const rest = messages.slice(1);

    // Reserve headroom so we don't hit the hard cap; start summarizing as we approach the limit
    const reserveFraction = 0.1; // keep ~10% for model response and safety
    const effectiveMax = Math.max(256, Math.floor(maxTokens * (1 - reserveFraction)));

    // Quick path: if already within budget, no changes
    const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (totalTokens <= effectiveMax) return messages;

    // Reserve ~60% of budget for most recent context; always keep at least last 6 messages if possible
    const budgetForRecent = Math.max(Math.floor(effectiveMax * 0.6), 1);
    const minRecentCount = 6;

    // Accumulate recent messages from the end under the recent budget
    const recent: any[] = [];
    let recentTokens = this.estimateMessageTokens(system);
    for (let i = rest.length - 1; i >= 0; i--) {
      const msg = rest[i];
      const cost = this.estimateMessageTokens(msg);
      // Always allow at least minRecentCount even if exceeding budgetForRecent slightly
      const forceKeep = recent.length < minRecentCount;
      if (!forceKeep && recentTokens + cost > budgetForRecent) break;
      recent.push(msg);
      recentTokens += cost;
    }
    recent.reverse();

    // Older portion to summarize
    const olderCount = rest.length - recent.length;
    const older = olderCount > 0 ? rest.slice(0, olderCount) : [];

    // If there's nothing older, fallback to regular trimming by budget
    if (older.length === 0) {
      return this.trimHistoryToTokenLimit(messages, effectiveMax);
    }

    // Build a compact transcript for older messages (cap each line to avoid huge prompts)
    const line = (m: any): string => {
      const role = m?.role || 'unknown';
      const raw = String(m?.content || '');
      const capped = raw.length > 600 ? raw.slice(0, 600) + '…' : raw;
      return `${role}: ${capped}`;
    };
    const transcript = older.map(line).join('\n');

    // Ask the model to summarize older context into a short, plain-text memory
    let summaryContent = '';
    try {
      const summarizerSystem = [
        'You are an assistant compressing earlier conversation context for an IRC bot.',
        'Return only a compact memory in plain text (no preface, no labels).',
        'Include: key facts, constraints, decisions, numbers, names; user intents and outcomes.',
        'Avoid quotes, lists, or markdown. Use 1–2 concise sentences.',
      ].join('\n');

      const response = await this.ollama.chat({
        model: this.model,
        messages: [
          { role: 'system', content: summarizerSystem },
          { role: 'user', content: `Summarize this earlier context:\n\n${transcript}` },
        ],
        options: this.getChatOptions(),
      });
      summaryContent = String(response?.message?.content || '').trim();
      if (!summaryContent) {
        // Fallback to simple truncation of the transcript
        summaryContent = this.truncate(transcript, 600);
      }
    } catch (e) {
      // Fallback: minimal truncation if summarization fails
      summaryContent = this.truncate(transcript, 600);
    }

    const summaryMsg = {
      role: 'system',
      content: `Conversation summary so far: ${summaryContent}`,
    };

    // Compose: system + summary + recent; then enforce final budget strictly
    let composed = [system, summaryMsg, ...recent];
    const composedTokens = composed.reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
    if (composedTokens <= effectiveMax) return composed;

    // If still too large, shrink the summary first using character-bound summarizer
    try {
      // Shrink the summary aggressively to regain budget
      const targetChars = 220;
      const shrunk = await this.summarizeText(summaryMsg.content, targetChars);
      composed = [system, { role: 'system', content: shrunk }, ...recent];
    } catch (_) {
      // ignore; proceed to hard trim
    }

    // Final hard trim as a guard
    return this.trimHistoryToTokenLimit(composed, effectiveMax);
  }

  private estimateMessageTokens(msg: any): number {
    // Include small overhead per message
    const overhead = 4;
    return overhead + this.estimateTokens(msg?.content || '');
  }

  private trimHistoryToTokenLimit(messages: any[], maxTokens: number): any[] {
    if (!messages || messages.length === 0) return [];
    const system = messages[0];
    const rest = messages.slice(1);

    // Accumulate from the end (most recent first) until we hit the budget
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
    const toolAssistantIdxs: number[] = [];
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i];
      if (m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0) {
        toolAssistantIdxs.push(i);
      }
    }
    if (toolAssistantIdxs.length <= 1) {
      return messages;
    }
    const lastKeepIdx = toolAssistantIdxs[toolAssistantIdxs.length - 1];
    const pruned: any[] = [];
    for (let i = 0; i < rest.length; i++) {
      const m = rest[i];
      const isToolAssistant = toolAssistantIdxs.includes(i);
      if (!isToolAssistant || i === lastKeepIdx) {
        pruned.push(m);
      }
    }
    return [system, ...pruned];
  }

  private truncate(text: string, max: number): string {
    if (!text) return '';
    if (text.length <= max) return text;
    return text.slice(0, max - 1).trimEnd() + '…';
  }

  private logRequestHistory(label: string, messages: any[]): void {
    try {
      const totalTokens = (messages || []).reduce((sum, m) => sum + this.estimateMessageTokens(m), 0);
      const ua = (messages || []).filter(m => m.role === 'user' || m.role === 'assistant');
      console.log(`[Ollama] ${label}: sending ${messages.length} message(s), ~${totalTokens} tokens (UA turns: ${ua.length})`);
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
    } catch (_) {
      // best-effort logging only
    }
  }

  private buildTurnContextSnippet(channel: string): string {
    try {
      const now = new Date();
      const iso = now.toISOString();
      const parts: string[] = [];
      parts.push(`Context: ${iso} UTC; channel: ${channel}`);
      
      if (this.chaosMode?.enabled && this.messageHistory) {
        try {
          // Include chaos snippets based on probability guard (default 10%)
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
      return parts.join(' \n ');
    } catch (_) {
      return '';
    }
  }

  private filterThinkBlocks(text: string): string {
    // Defensive guard: handle undefined/null
    if (!text) return '';
    let result = String(text);
    // Remove <think>...</think> and common variants
    const tagPatterns = [
      /<think>[\s\S]*?<\/think>/gis,
      /<thinking>[\s\S]*?<\/thinking>/gis,
      /<reasoning>[\s\S]*?<\/reasoning>/gis,
    ];
    for (const re of tagPatterns) {
      result = result.replace(re, '');
    }
    // Also remove any trailing orphaned closing tags and preceding content
    result = result.replace(/[\s\S]*?<\/(think|thinking|reasoning)>/gis, '');
    return result.trim();
  }

  clearHistory(channel?: string): void {
    if (channel) {
      this.conversationHistory.delete(channel);
    } else {
      this.conversationHistory.clear();
    }
  }

  /**
   * Record the assistant output that was actually sent to IRC into the
   * conversation history as context for future turns. This ensures we do not
   * store hidden reasoning or markdown-heavy content, only the final output.
   */
  async recordAssistantOutput(channel: string, content: string): Promise<void> {
    const trimmed = String(content || '').trim();
    if (!trimmed) return; // Do not record empty assistant messages
    // Ensure a history exists (with system prompt) for this channel
    let history = this.conversationHistory.get(channel) || [];
    if (history.length === 0) {
      history.push({ role: 'system', content: this.systemPrompt });
    }

    // Skip if identical to the last assistant output to avoid repetition
    for (let i = history.length - 1; i >= 0; i--) {
      const m = history[i];
      if (m?.role === 'assistant') {
        if (String(m.content || '').trim() === trimmed) {
          this.conversationHistory.set(channel, history);
          return;
        }
        break;
      }
    }

    history.push({ role: 'assistant', content: trimmed });

    // Compact to token and length limits to keep memory efficient
    history = await this.compactHistoryToTokenLimit(history, this.maxContextTokens);
    if (history.length > this.maxHistoryLength) {
      const systemMsg = history[0];
      const recentMessages = history.slice(-this.maxHistoryLength + 1);
      history = [systemMsg, ...recentMessages];
    }

    this.conversationHistory.set(channel, history);
  }

  // Cap long texts recorded in history; optionally annotate truncation for tools
  private capForHistory(text: string, max: number, annotate: boolean): string {
    const raw = String(text || '');
    if (raw.length <= max) return raw;
    if (!annotate) return this.truncate(raw, max);
    const budget = Math.max(30, max - 14); // leave room for marker
    return this.truncate(raw, budget) + ' [truncated]';
  }
}
