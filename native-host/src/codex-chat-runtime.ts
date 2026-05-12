import * as fs from 'node:fs';
import * as path from 'node:path';
import type { AgentStartupOptions, AgentType } from './agent-runtime.js';
import { ContextStore } from './context-store.js';
import {
  resolveClaudeChatSettings,
  resolveCodexChatSettings,
  type ResolvedClaudeChatSettings,
  type ResolvedCodexChatSettings,
} from './local-agent-config.js';

type ChatStatus = 'pending' | 'streaming' | 'completed' | 'error';
type ToolStatus = 'pending' | 'running' | 'completed' | 'error';

type ChatToolTrace = {
  id: string;
  kind?: 'browser_tool' | 'web_search' | 'function' | 'mcp_tool';
  name: string;
  status: ToolStatus;
  input?: unknown;
  outputPreview?: string;
  error?: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: number;
  status: ChatStatus;
  reasoning?: string;
  error?: string;
  tools?: ChatToolTrace[];
};

type DispatchBrowserCommand = (
  sessionId: string,
  tabId: number,
  command: string,
  params: Record<string, unknown>,
  timeoutMs?: number,
) => Promise<unknown>;

export type CodexChatRuntimeOptions = {
  sessionId: string;
  agentType?: AgentType;
  runtimeDir: string;
  contextStore: ContextStore;
  getBindingTabId: () => number | null;
  getWorkingDirectory: () => string;
  getStartupOptions: () => AgentStartupOptions;
  dispatchBrowserCommand: DispatchBrowserCommand;
  broadcast: (message: object) => void;
  logEvent?: (event: string, details: Record<string, unknown>) => void;
};

type OpenAIResponse = {
  id?: string;
  output_text?: string;
  output?: Array<Record<string, unknown>>;
  error?: { message?: string };
};

type ClaudeMessageResponse = {
  id?: string;
  content?: Array<Record<string, unknown>>;
  error?: { message?: string };
};

type ResponseStreamState = {
  response: OpenAIResponse;
  text: string;
  reasoning: string;
  functionArguments: Map<string, { id: string; callId: string; name: string; argumentsText: string }>;
};

type FunctionCall = {
  id: string;
  callId: string;
  name: string;
  argumentsText: string;
};

const MAX_HISTORY_MESSAGES = 24;
const MAX_TOOL_LOOPS = 6;
const DEFAULT_CLAUDE_MAX_TOKENS = 4096;

export class CodexChatRuntime {
  private readonly options: CodexChatRuntimeOptions;
  private readonly historyPath: string;
  private readonly messages = new Map<string, ChatMessage>();
  private currentAbort: AbortController | null = null;

  constructor(options: CodexChatRuntimeOptions) {
    this.options = options;
    const sessionDir = path.join(options.runtimeDir, 'sessions', options.sessionId);
    fs.mkdirSync(sessionDir, { recursive: true });
    this.historyPath = path.join(sessionDir, `${this.agentType()}-chat-history.jsonl`);
    this.loadHistory();
  }

  handleRequest(requestId: string, input: string): void {
    void this.runRequest(requestId, input);
  }

  cancel(requestId?: string): void {
    if (!this.currentAbort) {
      return;
    }
    this.currentAbort.abort();
    this.currentAbort = null;
    if (requestId) {
      const message = this.messages.get(requestId);
      if (message) {
        this.emitMessage({
          ...message,
          status: 'error',
          error: 'Cancelled',
        });
      }
    }
  }

  replay(send: (message: object) => void): void {
    const messages = Array.from(this.messages.values()).sort((a, b) => a.createdAt - b.createdAt);
    let reset = true;
    for (const message of messages) {
      send({
        type: 'agent_chat_update',
        sessionId: this.options.sessionId,
        message,
        replay: true,
        reset,
      });
      reset = false;
    }
  }

  dispose(): void {
    this.cancel();
  }

  private async runRequest(requestId: string, input: string): Promise<void> {
    const trimmed = input.trim();
    if (!trimmed) {
      return;
    }

    if (this.currentAbort) {
      this.emitMessage({
        id: requestId,
        role: 'assistant',
        content: '',
        createdAt: Date.now(),
        status: 'error',
        error: `Another ${this.displayName()} chat request is already running.`,
      });
      return;
    }

    const userMessage: ChatMessage = {
      id: `${requestId}-user`,
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
      status: 'completed',
    };
    const assistantMessage: ChatMessage = {
      id: requestId,
      role: 'assistant',
      content: '',
      createdAt: Date.now() + 1,
      status: 'pending',
      tools: [],
    };
    this.emitMessage(userMessage);
    this.emitMessage(assistantMessage);

    const settings = this.resolveSettings();
    if (!settings.apiKey) {
      const envKeys = this.agentType() === 'claude'
        ? 'ANTHROPIC_API_KEY / CLAUDECHROME_ANTHROPIC_API_KEY'
        : 'OPENAI_API_KEY / CLAUDECHROME_OPENAI_API_KEY';
      const localConfig = this.agentType() === 'claude'
        ? '~/.claude/settings.json'
        : '~/.codex/config.toml or ~/.codex/auth.json';
      this.emitMessage({
        ...assistantMessage,
        status: 'error',
        error: `Missing ${this.displayName()} API key. Configure it in launch defaults, set ${envKeys} for the native host, or configure your local ${localConfig}.`,
      });
      return;
    }

    const abort = new AbortController();
    this.currentAbort = abort;

    try {
      if (this.agentType() === 'claude') {
        await this.runClaudeRequest(assistantMessage, settings as ResolvedClaudeChatSettings, abort);
        return;
      }

      let previousResponseId: string | undefined;
      let nextInput: unknown = this.buildConversationInput();
      let finalMessage = assistantMessage;

      for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
        const response = await this.createResponse(settings as ResolvedCodexChatSettings, nextInput, previousResponseId, abort.signal);
        if (response.error?.message) {
          throw new Error(response.error.message);
        }
        previousResponseId = response.id;

        const reasoning = extractReasoning(response);
        const webTools = extractWebSearchTraces(response);
        const functionCalls = extractFunctionCalls(response);
        const text = extractOutputText(response);
        finalMessage = {
          ...finalMessage,
          status: functionCalls.length > 0 ? 'streaming' : 'completed',
          content: text || finalMessage.content,
          reasoning: reasoning || finalMessage.reasoning,
          tools: [...(finalMessage.tools ?? []), ...webTools],
        };
        this.emitMessage(finalMessage);

        if (functionCalls.length === 0) {
          this.currentAbort = null;
          this.emitMessage({ ...finalMessage, status: 'completed' });
          return;
        }

      const outputs = [];
      for (const call of functionCalls) {
          const trace = await this.runToolCall(finalMessage, call);
          finalMessage = trace.nextMessage;
          outputs.push({
            type: 'function_call_output',
            call_id: call.callId,
            output: JSON.stringify(trace.output),
          });
        }

        nextInput = outputs;
      }

      throw new Error('Codex chat exceeded the maximum browser-tool loop count.');
    } catch (error) {
      const message = this.messages.get(requestId) ?? assistantMessage;
      this.emitMessage({
        ...message,
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
      this.options.logEvent?.('agent_chat_error', {
        sessionId: this.options.sessionId,
        agentType: this.agentType(),
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.currentAbort === abort) {
        this.currentAbort = null;
      }
    }
  }

  private agentType(): 'claude' | 'codex' {
    return this.options.agentType === 'claude' ? 'claude' : 'codex';
  }

  private displayName(): string {
    return this.agentType() === 'claude' ? 'Claude' : 'Codex';
  }

  private resolveSettings(): ResolvedClaudeChatSettings | ResolvedCodexChatSettings {
    const input = {
      startupOptions: this.options.getStartupOptions(),
      cwd: this.options.getWorkingDirectory(),
    };
    return this.agentType() === 'claude'
      ? resolveClaudeChatSettings(input)
      : resolveCodexChatSettings(input);
  }

  private async runClaudeRequest(
    assistantMessage: ChatMessage,
    settings: ResolvedClaudeChatSettings,
    abort: AbortController,
  ): Promise<void> {
    const messages: Array<Record<string, unknown>> = this.buildConversationInput();
    let finalMessage = assistantMessage;

    for (let loop = 0; loop < MAX_TOOL_LOOPS; loop += 1) {
      const response = await this.createClaudeMessage(settings, messages, abort.signal);
      if (response.error?.message) {
        throw new Error(response.error.message);
      }

      const functionCalls = extractClaudeToolUses(response);
      finalMessage = {
        ...finalMessage,
        status: functionCalls.length > 0 ? 'streaming' : 'completed',
        content: extractClaudeText(response) || finalMessage.content,
        reasoning: extractClaudeReasoning(response) || finalMessage.reasoning,
      };
      this.emitMessage(finalMessage);

      if (functionCalls.length === 0) {
        this.currentAbort = null;
        this.emitMessage({ ...finalMessage, status: 'completed' });
        return;
      }

      messages.push({ role: 'assistant', content: response.content ?? [] });
      const toolResults = [];
      for (const call of functionCalls) {
        const trace = await this.runToolCall(finalMessage, call);
        finalMessage = trace.nextMessage;
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.callId,
          content: compactJson(trace.output),
          is_error: !trace.ok,
        });
      }
      messages.push({ role: 'user', content: toolResults });
    }

    throw new Error('Claude chat exceeded the maximum browser-tool loop count.');
  }

  private async runToolCall(
    finalMessage: ChatMessage,
    call: FunctionCall,
  ): Promise<{ nextMessage: ChatMessage; output: unknown; ok: boolean }> {
    const toolTrace: ChatToolTrace = {
      id: call.callId,
      kind: call.name.startsWith('browser__') ? 'browser_tool' : 'function',
      name: call.name,
      status: 'running',
      input: parseToolArguments(call.argumentsText),
    };
    let nextMessage = {
      ...finalMessage,
      tools: [...(finalMessage.tools ?? []), toolTrace],
    };
    this.emitMessage(nextMessage);

    const result = await this.executeToolCall(call);
    const completedTrace: ChatToolTrace = {
      ...toolTrace,
      status: result.ok ? 'completed' : 'error',
      outputPreview: compactJson(result.output),
      error: result.ok ? undefined : String(result.output),
    };
    nextMessage = {
      ...nextMessage,
      tools: (nextMessage.tools ?? []).map((entry) => entry.id === toolTrace.id ? completedTrace : entry),
    };
    this.emitMessage(nextMessage);
    return { nextMessage, output: result.output, ok: result.ok };
  }

  private async createResponse(
    settings: ResolvedCodexChatSettings,
    input: unknown,
    previousResponseId: string | undefined,
    signal: AbortSignal,
  ): Promise<OpenAIResponse> {
    const body: Record<string, unknown> = {
      model: settings.model,
      input,
      instructions: this.buildInstructions(settings),
      tools: buildResponseTools(),
      include: ['web_search_call.action.sources'],
      parallel_tool_calls: false,
      store: true,
      stream: process.env.CLAUDECHROME_CODEX_STREAM === '0' ? false : true,
    };
    if (previousResponseId) {
      body.previous_response_id = previousResponseId;
    }

    const response = await fetch(`${settings.apiBaseUrl}/responses`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${settings.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    const text = await response.text();
    let parsed: OpenAIResponse;
    try {
      parsed = text
        ? body.stream === true
          ? parseResponsesStream(text)
          : JSON.parse(text)
        : {};
    } catch {
      parsed = { error: { message: text || `OpenAI Responses API returned HTTP ${response.status}` } };
    }
    if (!response.ok) {
      throw new Error(parsed.error?.message || `OpenAI Responses API returned HTTP ${response.status}`);
    }
    return parsed;
  }

  private async createClaudeMessage(
    settings: ResolvedClaudeChatSettings,
    messages: Array<Record<string, unknown>>,
    signal: AbortSignal,
  ): Promise<ClaudeMessageResponse> {
    const body: Record<string, unknown> = {
      model: settings.model,
      max_tokens: Number.parseInt(process.env.CLAUDECHROME_CLAUDE_MAX_TOKENS || '', 10) || DEFAULT_CLAUDE_MAX_TOKENS,
      system: this.buildInstructions(settings),
      messages,
      tools: buildClaudeTools(),
    };

    const response = await fetch(`${settings.apiBaseUrl}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': settings.apiKey,
        'anthropic-version': process.env.CLAUDECHROME_ANTHROPIC_VERSION || '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal,
    });

    const text = await response.text();
    let parsed: ClaudeMessageResponse;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = { error: { message: text || `Anthropic Messages API returned HTTP ${response.status}` } };
    }
    if (!response.ok) {
      throw new Error(parsed.error?.message || `Anthropic Messages API returned HTTP ${response.status}`);
    }
    return parsed;
  }

  private buildConversationInput(): Array<{ role: 'user' | 'assistant'; content: string }> {
    return Array.from(this.messages.values())
      .sort((a, b) => a.createdAt - b.createdAt)
      .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => (
        (message.role === 'user' || message.role === 'assistant')
        && Boolean(message.content.trim())
        && message.status !== 'pending'
        && message.status !== 'streaming'
      ))
      .slice(-MAX_HISTORY_MESSAGES)
      .map((message) => ({
        role: message.role,
        content: message.content,
      }));
  }

  private buildInstructions(settings: ResolvedCodexChatSettings | ResolvedClaudeChatSettings): string {
    const startup = this.options.getStartupOptions();
    const tabId = this.options.getBindingTabId();
    const tab = tabId == null ? null : this.options.contextStore.getTab(tabId);
    const displayName = this.displayName();
    const lines = [
      `You are ${displayName} running inside ClaudeChrome as a built-in browser-attached chat agent.`,
      'Prefer the provided browser_* function tools for live page state. When the user says "this page" or "current tab", use the bound tab unless they explicitly name a different target.',
      ...(this.agentType() === 'codex' ? ['When current web knowledge is required, use the built-in web search tool.'] : []),
      'Keep answers concise and implementation-oriented.',
      'Current bound tab:',
      `- tabId: ${tabId ?? '<unknown>'}`,
      `- title: ${tab?.title || '<not available yet>'}`,
      `- url: ${tab?.url || '<not available yet>'}`,
    ];

    if (startup.systemPromptMode === 'none') {
      return lines.slice(0, 1).join('\n');
    }
    if (startup.systemPromptMode === 'custom' && startup.customSystemPrompt.trim()) {
      lines.push('', 'Additional custom startup instructions:', startup.customSystemPrompt.trim());
    }
    if (settings.localInstructionContext.trim()) {
      lines.push('', settings.localInstructionContext.trim());
    }
    return lines.join('\n');
  }

  private async executeToolCall(call: FunctionCall): Promise<{ ok: boolean; output: unknown }> {
    const args = parseToolArguments(call.argumentsText);
    try {
      return { ok: true, output: await this.executeBrowserTool(call.name, args) };
    } catch (error) {
      return { ok: false, output: error instanceof Error ? error.message : String(error) };
    }
  }

  private async executeBrowserTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tabId = this.options.getBindingTabId();
    if (tabId == null) {
      throw new Error(`No tab binding for session ${this.options.sessionId}`);
    }

    switch (name) {
      case 'browser__session_context':
        return this.sessionContext(tabId);
      case 'browser__get_page_info':
        return this.options.contextStore.getPageInfo(tabId) ?? { ok: false, error: 'No page info captured yet.' };
      case 'browser__get_page_text':
        return this.getPageText(tabId, args);
      case 'browser__get_page_html':
        return this.getPageHtml(tabId, args);
      default:
        return this.options.dispatchBrowserCommand(
          this.options.sessionId,
          tabId,
          name.replace(/^browser__/, ''),
          args,
          typeof args.timeout_ms === 'number' ? args.timeout_ms : undefined,
        );
    }
  }

  private sessionContext(tabId: number): unknown {
    const tab = this.options.contextStore.getTab(tabId);
    const pageInfo = this.options.contextStore.getPageInfo(tabId);
    const stats = this.options.contextStore.getCaptureStats(tabId);
    return {
      ok: true,
      binding: { tabId },
      tab,
      pageInfo: pageInfo
        ? {
          url: pageInfo.url,
          title: pageInfo.title,
          visibleTextChars: pageInfo.visibleText?.length ?? 0,
          htmlChars: pageInfo.html?.length ?? 0,
          lastSeenAt: pageInfo.lastSeenAt,
        }
        : null,
      stats,
      suggestedNextTools: ['browser__get_page_text', 'browser__find_elements', 'browser__screenshot'],
    };
  }

  private async getPageText(tabId: number, args: Record<string, unknown>): Promise<unknown> {
    const maxChars = typeof args.max_chars === 'number' ? args.max_chars : 40000;
    const pageInfo = this.options.contextStore.getPageInfo(tabId);
    if (pageInfo?.visibleText) {
      return {
        ok: true,
        url: pageInfo.url,
        title: pageInfo.title,
        text: pageInfo.visibleText.slice(0, maxChars),
        truncated: pageInfo.visibleText.length > maxChars,
      };
    }
    return this.options.dispatchBrowserCommand(this.options.sessionId, tabId, 'get_page_content', {
      include_html: false,
      max_chars: maxChars,
    });
  }

  private async getPageHtml(tabId: number, args: Record<string, unknown>): Promise<unknown> {
    const maxChars = typeof args.max_chars === 'number' ? args.max_chars : 40000;
    const pageInfo = this.options.contextStore.getPageInfo(tabId);
    if (pageInfo?.html) {
      return {
        ok: true,
        url: pageInfo.url,
        title: pageInfo.title,
        html: pageInfo.html.slice(0, maxChars),
        truncated: pageInfo.html.length > maxChars,
      };
    }
    return this.options.dispatchBrowserCommand(this.options.sessionId, tabId, 'get_page_content', {
      include_html: true,
      max_chars: maxChars,
    });
  }

  private emitMessage(message: ChatMessage): void {
    this.messages.set(message.id, message);
    fs.appendFileSync(this.historyPath, `${JSON.stringify(message)}\n`, 'utf8');
    this.options.broadcast({
      type: 'agent_chat_update',
      sessionId: this.options.sessionId,
      message,
    });
  }

  private loadHistory(): void {
    if (!fs.existsSync(this.historyPath)) {
      return;
    }
    for (const line of fs.readFileSync(this.historyPath, 'utf8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      try {
        const message = JSON.parse(trimmed) as ChatMessage;
        if (message?.id && message.role && typeof message.content === 'string') {
          this.messages.set(message.id, message);
        }
      } catch {
        continue;
      }
    }
  }
}

function buildResponseTools(): Array<Record<string, unknown>> {
  const tools = buildBrowserFunctionTools();

  if (process.env.CLAUDECHROME_CODEX_WEB_SEARCH !== '0') {
    tools.push({ type: 'web_search' });
  }
  return tools;
}

function buildClaudeTools(): Array<Record<string, unknown>> {
  return buildBrowserFunctionTools().map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }));
}

function buildBrowserFunctionTools(): Array<Record<string, unknown>> {
  return [
    functionTool('browser__session_context', 'Get the bound browser tab context and suggested next tools.', {}),
    functionTool('browser__get_page_info', 'Get current page URL, title, metadata, and capture summary.', {}),
    functionTool('browser__get_page_text', 'Get visible text from the current bound page.', {
      max_chars: { type: 'number' },
    }),
    functionTool('browser__get_page_html', 'Get HTML from the current bound page.', {
      max_chars: { type: 'number' },
    }),
    functionTool('browser__get_page_content', 'Ask the browser for current page content.', {
      include_html: { type: 'boolean' },
      max_chars: { type: 'number' },
    }),
    functionTool('browser__find_elements', 'Find elements in the current page by CSS selector.', {
      selector: { type: 'string' },
    }, ['selector']),
    functionTool('browser__evaluate_js', 'Evaluate JavaScript in the current page when direct inspection is needed.', {
      expression: { type: 'string' },
    }, ['expression']),
    functionTool('browser__screenshot', 'Capture a screenshot of the current page.', {
      format: { type: 'string', enum: ['png', 'jpeg'] },
    }),
    functionTool('browser__click', 'Click an element by selector or coordinates.', {
      selector: { type: 'string' },
      x: { type: 'number' },
      y: { type: 'number' },
    }),
    functionTool('browser__type', 'Type text into an element matched by selector.', {
      selector: { type: 'string' },
      text: { type: 'string' },
    }, ['selector', 'text']),
    functionTool('browser__scroll', 'Scroll the current page or an element.', {
      x: { type: 'number' },
      y: { type: 'number' },
      selector: { type: 'string' },
    }),
    functionTool('browser__wait_for', 'Wait for a page condition.', {
      condition: { type: 'string' },
      selector: { type: 'string' },
      timeout_ms: { type: 'number' },
    }, ['condition']),
    functionTool('browser__navigate', 'Navigate the bound tab to a URL.', {
      url: { type: 'string' },
    }, ['url']),
    functionTool('browser__reload', 'Reload the bound tab.', {}),
    functionTool('browser__get_cookies', 'Get cookies for the current bound page.', {}),
    functionTool('browser__get_storage', 'Get localStorage and/or sessionStorage for the current bound page.', {
      storage_type: { type: 'string', enum: ['local', 'session', 'both'] },
    }),
    functionTool('browser__get_selection', 'Get the current selected text in the bound page.', {}),
  ];
}

function functionTool(name: string, description: string, properties: Record<string, unknown>, required: string[] = []): Record<string, unknown> {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties,
      required,
      additionalProperties: false,
    },
  };
}

export function parseResponsesStreamForTest(text: string): OpenAIResponse {
  return parseResponsesStream(text);
}

function parseResponsesStream(text: string): OpenAIResponse {
  const state: ResponseStreamState = {
    response: { output: [] },
    text: '',
    reasoning: '',
    functionArguments: new Map(),
  };

  for (const event of parseServerSentEvents(text)) {
    applyResponsesStreamEvent(state, event);
  }

  if (state.text) {
    state.response.output_text = state.text;
    state.response.output = [
      ...(state.response.output ?? []),
      {
        type: 'message',
        content: [{ type: 'output_text', text: state.text }],
      },
    ];
  }

  if (state.reasoning) {
    state.response.output = [
      ...(state.response.output ?? []),
      {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: state.reasoning }],
      },
    ];
  }

  if (state.functionArguments.size > 0) {
    state.response.output = [
      ...(state.response.output ?? []),
      ...Array.from(state.functionArguments.values()).map((call) => ({
        type: 'function_call',
        id: call.id,
        call_id: call.callId,
        name: call.name,
        arguments: call.argumentsText,
      })),
    ];
  }

  return state.response;
}

function parseServerSentEvents(text: string): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = [];
  for (const frame of text.split(/\r?\n\r?\n/)) {
    const dataLines = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trimStart());
    if (dataLines.length === 0) {
      continue;
    }
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const parsed = JSON.parse(data);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      continue;
    }
  }
  if (events.length === 0) {
    try {
      const parsed = JSON.parse(text);
      if (parsed && typeof parsed === 'object') {
        events.push(parsed as Record<string, unknown>);
      }
    } catch {
      // Non-JSON response bodies are handled by createResponse error wrapping.
    }
  }
  return events;
}

function applyResponsesStreamEvent(state: ResponseStreamState, event: Record<string, unknown>): void {
  const type = String(event.type ?? '');
  if (type === 'response.created' && event.response && typeof event.response === 'object') {
    const response = event.response as OpenAIResponse;
    state.response.id = response.id ?? state.response.id;
    return;
  }
  if (type === 'response.completed' && event.response && typeof event.response === 'object') {
    const response = event.response as OpenAIResponse;
    state.response = {
      ...state.response,
      ...response,
      output: response.output ?? state.response.output,
      output_text: response.output_text ?? state.response.output_text,
    };
    return;
  }
  if (type === 'response.failed' || type === 'response.incomplete') {
    const response = event.response as OpenAIResponse | undefined;
    state.response.error = response?.error ?? { message: String(event.error || event.message || type) };
    return;
  }
  if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {
    state.text += String(event.delta ?? '');
    return;
  }
  if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning.delta') {
    state.reasoning += String(event.delta ?? '');
    return;
  }
  if (type === 'response.output_item.done' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    if (item.type === 'message') {
      const itemText = extractOutputText({ output: [item] });
      if (itemText && !state.text.includes(itemText)) {
        state.text += `${state.text ? '\n' : ''}${itemText}`;
      }
    }
    if (item.type === 'reasoning') {
      const itemReasoning = extractReasoning({ output: [item] });
      if (itemReasoning && !state.reasoning.includes(itemReasoning)) {
        state.reasoning += `${state.reasoning ? '\n' : ''}${itemReasoning}`;
      }
    }
    state.response.output = [...(state.response.output ?? []), item];
    if (item.type === 'function_call') {
      const callId = String(item.call_id ?? item.id ?? crypto.randomUUID());
      state.functionArguments.delete(callId);
    }
    return;
  }
  if (type === 'response.output_item.added' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    if (item.type === 'function_call') {
      upsertFunctionCall(state, item, event);
    }
    return;
  }
  if (type === 'response.function_call_arguments.delta' || type === 'response.function_call_arguments.done') {
    const callId = String(event.call_id ?? event.item_id ?? event.output_index ?? crypto.randomUUID());
    const existing = getFunctionCallDraft(state, callId, event.item_id);
    existing.argumentsText = type.endsWith('.done') && typeof event.arguments === 'string'
      ? event.arguments
      : `${existing.argumentsText}${String(event.delta ?? '')}`;
    if (event.name) {
      existing.name = String(event.name);
    }
    if (existing.name) {
      state.functionArguments.set(callId, existing);
    }
  }
}

function upsertFunctionCall(state: ResponseStreamState, item: Record<string, unknown>, event: Record<string, unknown>): void {
  const callId = String(item.call_id ?? event.call_id ?? item.id ?? event.item_id ?? event.output_index ?? crypto.randomUUID());
  const existing = getFunctionCallDraft(state, callId, item.id ?? event.item_id);
  existing.id = String(item.id ?? existing.id);
  existing.callId = callId;
  if (typeof item.name === 'string') {
    existing.name = item.name;
  }
  if (typeof item.arguments === 'string') {
    existing.argumentsText = item.arguments;
  }
  if (existing.name) {
    state.functionArguments.set(callId, existing);
  }
}

function getFunctionCallDraft(state: ResponseStreamState, callId: string, itemId: unknown): FunctionCall {
  const byCallId = state.functionArguments.get(callId);
  if (byCallId) {
    return byCallId;
  }
  if (typeof itemId === 'string') {
    const byItemId = state.functionArguments.get(itemId);
    if (byItemId) {
      state.functionArguments.delete(itemId);
      state.functionArguments.set(callId, byItemId);
      byItemId.callId = callId;
      return byItemId;
    }
  }
  return {
    id: String(itemId ?? callId),
    callId,
    name: '',
    argumentsText: '',
  };
}

function extractOutputText(response: OpenAIResponse): string {
  if (typeof response.output_text === 'string') {
    return response.output_text;
  }
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'message' || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content as Array<Record<string, unknown>>) {
      const text = typeof content.text === 'string'
        ? content.text
        : typeof content.output_text === 'string'
          ? content.output_text
          : '';
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractReasoning(response: OpenAIResponse): string {
  const parts: string[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'reasoning') {
      continue;
    }
    if (typeof item.content === 'string') {
      parts.push(item.content);
    }
    if (!Array.isArray(item.summary)) {
      continue;
    }
    for (const summary of item.summary as Array<Record<string, unknown>>) {
      if (typeof summary.text === 'string') {
        parts.push(summary.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractFunctionCalls(response: OpenAIResponse): FunctionCall[] {
  const calls: FunctionCall[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'function_call') {
      continue;
    }
    calls.push({
      id: String(item.id ?? item.call_id ?? crypto.randomUUID()),
      callId: String(item.call_id ?? item.id ?? crypto.randomUUID()),
      name: String(item.name ?? ''),
      argumentsText: typeof item.arguments === 'string' ? item.arguments : '{}',
    });
  }
  return calls.filter((call) => call.name);
}

function extractWebSearchTraces(response: OpenAIResponse): ChatToolTrace[] {
  const traces: ChatToolTrace[] = [];
  for (const item of response.output ?? []) {
    if (item.type !== 'web_search_call') {
      continue;
    }
    traces.push({
      id: String(item.id ?? crypto.randomUUID()),
      kind: 'web_search',
      name: 'web_search',
      status: item.status === 'failed' ? 'error' : 'completed',
      input: item.action,
      outputPreview: compactJson(item.action),
    });
  }
  return traces;
}

function extractClaudeText(response: ClaudeMessageResponse): string {
  const parts: string[] = [];
  for (const item of response.content ?? []) {
    if (item.type === 'text' && typeof item.text === 'string') {
      parts.push(item.text);
    }
  }
  return parts.join('\n').trim();
}

function extractClaudeReasoning(response: ClaudeMessageResponse): string {
  const parts: string[] = [];
  for (const item of response.content ?? []) {
    if ((item.type === 'thinking' || item.type === 'redacted_thinking') && typeof item.thinking === 'string') {
      parts.push(item.thinking);
    }
  }
  return parts.join('\n').trim();
}

function extractClaudeToolUses(response: ClaudeMessageResponse): FunctionCall[] {
  const calls: FunctionCall[] = [];
  for (const item of response.content ?? []) {
    if (item.type !== 'tool_use') {
      continue;
    }
    calls.push({
      id: String(item.id ?? crypto.randomUUID()),
      callId: String(item.id ?? crypto.randomUUID()),
      name: String(item.name ?? ''),
      argumentsText: JSON.stringify(item.input && typeof item.input === 'object' ? item.input : {}),
    });
  }
  return calls.filter((call) => call.name);
}

function parseToolArguments(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function compactJson(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  if (!text) {
    return '';
  }
  return text.length > 500 ? `${text.slice(0, 500)}...` : text;
}
