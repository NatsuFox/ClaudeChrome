import type { AgentChatMessage, AgentChatRequestMessage, AgentChatToolTrace, AgentChatUpdateMessage } from '../shared/types';
import type { ChatAgentType, PanelLanguage } from './state';
import { AgentChatBuffer } from './agent-chat-state';

type ChatLabels = {
  empty: (agent: string) => string;
  inputPlaceholder: (agent: string) => string;
  send: string;
  stop: string;
  reasoning: string;
  output: string;
  tools: string;
  input: string;
  assistant: (agent: string) => string;
  user: string;
  system: string;
  browserTool: string;
  functionTool: string;
  mcpTool: string;
  webSearch: string;
  running: string;
  completed: string;
  pending: string;
  failed: string;
  noOutput: string;
  copied: string;
  copy: string;
  errorPrefix: string;
};

const LABELS: Record<PanelLanguage, ChatLabels> = {
  zh: {
    empty: (agent) => `直接向内置 ${agent} 发送消息`,
    inputPlaceholder: (agent) => `询问当前页面、请求分析，或让 ${agent} 调用浏览器工具...`,
    send: '发送',
    stop: '停止',
    reasoning: '推理摘要',
    output: '输出',
    tools: '工具',
    input: '输入',
    assistant: (agent) => agent,
    user: '你',
    system: '系统',
    browserTool: '浏览器工具',
    functionTool: '函数工具',
    mcpTool: 'MCP 工具',
    webSearch: '网页搜索',
    running: '运行中',
    completed: '完成',
    pending: '等待中',
    failed: '失败',
    noOutput: '等待模型输出...',
    copied: '已复制',
    copy: '复制',
    errorPrefix: '错误',
  },
  en: {
    empty: (agent) => `Send a message to built-in ${agent}`,
    inputPlaceholder: (agent) => `Ask about the current page, request analysis, or let ${agent} use browser tools...`,
    send: 'Send',
    stop: 'Stop',
    reasoning: 'Reasoning',
    output: 'Output',
    tools: 'Tools',
    input: 'Input',
    assistant: (agent) => agent,
    user: 'You',
    system: 'System',
    browserTool: 'Browser tool',
    functionTool: 'Function tool',
    mcpTool: 'MCP tool',
    webSearch: 'Web search',
    running: 'Running',
    completed: 'Completed',
    pending: 'Pending',
    failed: 'Failed',
    noOutput: 'Waiting for model output...',
    copied: 'Copied',
    copy: 'Copy',
    errorPrefix: 'Error',
  },
};

type ChatEventOptions = {
  kind: string;
  icon: string;
  label: string;
  summary?: string;
  status?: string;
  defaultOpen?: boolean;
  children: HTMLElement[];
  extraClass?: string;
};

const CHAT_ICONS = {
  assistant: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19 7.6v8.8l-7 4.1-7-4.1V7.6l7-4.1Z"></path><path d="M8.4 10.1 12 8l3.6 2.1"></path><path d="M8.4 13.9 12 16l3.6-2.1"></path></svg>',
  user: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z"></path><path d="M5 20a7 7 0 0 1 14 0"></path></svg>',
  system: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4z"></path><path d="M8 10h8"></path><path d="M8 14h5"></path></svg>',
  reasoning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3.8a4 4 0 0 0-3 6.7 4 4 0 0 0 1.4 7.7"></path><path d="M15 3.8a4 4 0 0 1 3 6.7 4 4 0 0 1-1.4 7.7"></path><path d="M9 4v16"></path><path d="M15 4v16"></path><path d="M9 9h6"></path><path d="M9 15h6"></path></svg>',
  output: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v10H8l-3 3V6Z"></path><path d="M8 10h8"></path><path d="M8 13h5"></path></svg>',
  tool: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-3-3 2.6-2.6Z"></path></svg>',
  browser: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8"></circle><path d="M4 12h16"></path><path d="M12 4a12 12 0 0 1 0 16"></path><path d="M12 4a12 12 0 0 0 0 16"></path></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="5.5"></circle><path d="m15 15 4 4"></path><path d="M8.5 10.5h4"></path></svg>',
  mcp: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4v5"></path><path d="M16 4v5"></path><path d="M7 9h10v4a5 5 0 0 1-10 0V9Z"></path><path d="M12 18v3"></path></svg>',
  chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"></path></svg>',
  send: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12 20 4l-5 16-3-7-8-1Z"></path><path d="m12 13 8-9"></path></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8H8z"></path></svg>',
  copy: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h10v12H8z"></path><path d="M6 16H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>',
} as const;

const TERMINAL_HISTORY_MESSAGE_ID = 'local-cli-terminal-history';
const TERMINAL_OUTPUT_LIMIT = 20000;

export class AgentChatView {
  readonly root: HTMLDivElement;

  private readonly buffer = new AgentChatBuffer();
  private readonly transcript: HTMLDivElement;
  private readonly empty: HTMLDivElement;
  private readonly form: HTMLFormElement;
  private readonly textarea: HTMLTextAreaElement;
  private readonly sendButton: HTMLButtonElement;
  private readonly cancelButton: HTMLButtonElement;
  private language: PanelLanguage = 'zh';
  private agentType: ChatAgentType;
  private readonly sessionId: string;
  private currentRequestId: string | null = null;
  private sendHandler: ((message: AgentChatRequestMessage) => void) | null = null;
  private cancelHandler: ((requestId: string | null) => void) | null = null;

  constructor(sessionId: string, language: PanelLanguage, agentType: ChatAgentType = 'codex') {
    this.sessionId = sessionId;
    this.language = language;
    this.agentType = agentType;

    this.root = document.createElement('div');
    this.root.className = 'agent-chat-surface';

    this.transcript = document.createElement('div');
    this.transcript.className = 'agent-chat-transcript';

    this.empty = document.createElement('div');
    this.empty.className = 'agent-chat-empty';

    this.form = document.createElement('form');
    this.form.className = 'agent-chat-composer';

    this.textarea = document.createElement('textarea');
    this.textarea.className = 'agent-chat-input';
    this.textarea.rows = 2;

    this.sendButton = document.createElement('button');
    this.sendButton.type = 'submit';
    this.sendButton.className = 'agent-chat-send';

    this.cancelButton = document.createElement('button');
    this.cancelButton.type = 'button';
    this.cancelButton.className = 'agent-chat-cancel';
    this.cancelButton.hidden = true;

    this.form.appendChild(this.textarea);
    this.form.appendChild(this.cancelButton);
    this.form.appendChild(this.sendButton);
    this.root.appendChild(this.transcript);
    this.root.appendChild(this.form);

    this.form.addEventListener('submit', (event) => {
      event.preventDefault();
      this.submit();
    });

    this.cancelButton.addEventListener('click', () => {
      this.cancelHandler?.(this.currentRequestId);
    });

    this.textarea.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.submit();
      }
    });

    this.renderAll();
  }

  mount(container: HTMLElement): void {
    if (this.root.parentElement !== container) {
      container.replaceChildren(this.root);
    }
  }

  onSend(handler: (message: AgentChatRequestMessage) => void): void {
    this.sendHandler = handler;
  }

  onCancel(handler: (requestId: string | null) => void): void {
    this.cancelHandler = handler;
  }

  applyMessage(message: AgentChatUpdateMessage): void {
    const updated = this.buffer.apply(message);
    if (updated.role === 'assistant') {
      if (updated.status === 'streaming' || updated.status === 'pending') {
        this.currentRequestId = updated.id;
      } else if (this.currentRequestId === updated.id) {
        this.currentRequestId = null;
      }
    }
    this.renderAll();
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  applyTerminalOutput(output: string, options: { reset?: boolean } = {}): void {
    const normalized = stripAnsi(output).replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (options.reset) {
      this.buffer.remove(TERMINAL_HISTORY_MESSAGE_ID);
    }
    if (!normalized.trim()) {
      return;
    }
    const existing = this.buffer.get(TERMINAL_HISTORY_MESSAGE_ID);
    const previous = existing?.content || '';
    const content = (previous + normalized).slice(-TERMINAL_OUTPUT_LIMIT);
    this.buffer.apply({
      type: 'agent_chat_update',
      sessionId: this.sessionId,
      message: {
        id: TERMINAL_HISTORY_MESSAGE_ID,
        role: 'system',
        content,
        createdAt: existing?.createdAt || Date.now(),
        status: 'completed',
      },
    });
    this.renderAll();
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  clear(): void {
    this.buffer.clear();
    this.currentRequestId = null;
    this.renderAll();
  }

  dispose(): void {
    this.root.remove();
    this.clear();
  }

  setLanguage(language: PanelLanguage): void {
    if (this.language === language) return;
    this.language = language;
    this.renderAll();
  }

  setAgentType(agentType: ChatAgentType): void {
    if (this.agentType === agentType) return;
    this.agentType = agentType;
    this.renderAll();
  }

  focus(): void {
    this.textarea.focus();
  }

  private submit(): void {
    const input = this.textarea.value.trim();
    if (!input || this.currentRequestId) {
      return;
    }

    const requestId = crypto.randomUUID();
    this.currentRequestId = requestId;
    this.sendHandler?.({
      type: 'agent_chat_request',
      sessionId: this.sessionId,
      requestId,
      input,
    });
    this.textarea.value = '';
    this.renderAll();
  }

  private renderAll(): void {
    const labels = LABELS[this.language];
    this.textarea.placeholder = labels.inputPlaceholder(this.agentName());
    setButtonIcon(this.sendButton, CHAT_ICONS.send, labels.send);
    setButtonIcon(this.cancelButton, CHAT_ICONS.stop, labels.stop);
    this.cancelButton.hidden = !this.currentRequestId;
    this.sendButton.disabled = Boolean(this.currentRequestId);
    this.textarea.disabled = Boolean(this.currentRequestId);

    const messages = this.buffer.getAll();
    this.transcript.replaceChildren();
    if (messages.length === 0) {
      this.empty.textContent = labels.empty(this.agentName());
      this.transcript.appendChild(this.empty);
      return;
    }

    this.transcript.append(...messages.map((message) => this.renderMessage(message, labels)));
  }

  private renderMessage(message: AgentChatMessage, labels: ChatLabels): HTMLElement {
    const item = document.createElement('article');
    item.className = `agent-chat-message agent-chat-${message.role}`;
    item.dataset.status = message.status;

    item.appendChild(this.renderMessageHeader(message, labels));

    const events: HTMLElement[] = [];
    if (message.error) {
      const body = document.createElement('div');
      body.className = 'agent-chat-message-body';
      body.dataset.kind = 'error';
      body.textContent = `${labels.errorPrefix}: ${message.error}`;
      item.appendChild(body);
    } else if (message.role === 'assistant') {
      events.push(this.renderAssistantOutput(message, labels));
    } else {
      const body = document.createElement('div');
      body.className = 'agent-chat-message-body';
      if (message.content) {
        body.append(...renderMarkdownLite(message.content));
      } else {
        body.textContent = message.status === 'pending' ? '...' : '';
      }
      item.appendChild(body);
    }

    if (message.reasoning) {
      events.push(this.renderReasoning(message, labels));
    }

    if (message.tools?.length) {
      const tools = document.createElement('div');
      tools.className = 'agent-chat-events agent-chat-tools';
      const heading = document.createElement('div');
      heading.className = 'agent-chat-tools-heading';
      heading.textContent = labels.tools;
      tools.appendChild(heading);
      message.tools.forEach((tool) => tools.appendChild(this.renderTool(tool, labels)));
      events.push(tools);
    }

    if (events.length) {
      const eventStack = document.createElement('div');
      eventStack.className = 'agent-chat-event-stack';
      eventStack.append(...events);
      item.appendChild(eventStack);
    }

    if (message.role === 'assistant' && message.content && message.status === 'completed') {
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'agent-chat-copy';
      setButtonIcon(copy, CHAT_ICONS.copy, labels.copy);
      copy.addEventListener('click', async () => {
        await navigator.clipboard?.writeText(message.content);
        setButtonIcon(copy, CHAT_ICONS.copy, labels.copied);
        window.setTimeout(() => {
          setButtonIcon(copy, CHAT_ICONS.copy, labels.copy);
        }, 1000);
      });
      item.appendChild(copy);
    }

    return item;
  }

  private renderMessageHeader(message: AgentChatMessage, labels: ChatLabels): HTMLElement {
    const header = document.createElement('div');
    header.className = 'agent-chat-message-header';

    const icon = document.createElement('span');
    icon.className = 'agent-chat-message-icon';
    icon.innerHTML = message.role === 'user'
      ? CHAT_ICONS.user
      : message.role === 'system'
        ? CHAT_ICONS.system
        : CHAT_ICONS.assistant;

    const name = document.createElement('span');
    name.className = 'agent-chat-message-name';
    name.textContent = message.role === 'user'
      ? labels.user
      : message.role === 'system'
        ? labels.system
        : labels.assistant(this.agentName());

    const meta = document.createElement('span');
    meta.className = 'agent-chat-message-meta';
    meta.textContent = `${formatStatus(message.status, labels)} · ${formatTime(message.createdAt)}`;

    header.appendChild(icon);
    header.appendChild(name);
    header.appendChild(meta);
    return header;
  }

  private renderAssistantOutput(message: AgentChatMessage, labels: ChatLabels): HTMLElement {
    const content = document.createElement('div');
    content.className = 'agent-chat-output-content';
    if (message.content) {
      content.append(...renderMarkdownLite(message.content));
    } else {
      content.className += ' is-placeholder';
      content.textContent = labels.noOutput;
    }

    return this.renderEventItem({
      kind: 'output',
      icon: CHAT_ICONS.output,
      label: labels.output,
      summary: message.content ? summarizeText(message.content, 72) : labels.noOutput,
      status: formatStatus(message.status, labels),
      defaultOpen: Boolean(message.content) || message.status === 'pending' || message.status === 'streaming',
      children: [content],
      extraClass: 'agent-chat-output',
    });
  }

  private renderReasoning(message: AgentChatMessage, labels: ChatLabels): HTMLElement {
    const content = document.createElement('div');
    content.className = 'agent-chat-reasoning-content';
    content.append(...renderMarkdownLite(message.reasoning || ''));
    return this.renderEventItem({
      kind: 'reasoning',
      icon: CHAT_ICONS.reasoning,
      label: labels.reasoning,
      summary: summarizeText(message.reasoning || '', 72),
      status: formatStatus(message.status, labels),
      defaultOpen: message.status === 'pending' || message.status === 'streaming',
      children: [content],
      extraClass: 'agent-chat-reasoning',
    });
  }

  private renderTool(tool: AgentChatToolTrace, labels: ChatLabels): HTMLElement {
    const kind = normalizeToolKind(tool);
    const blocks: HTMLElement[] = [];
    if (tool.input !== undefined) {
      blocks.push(this.renderToolBlock(labels.input, renderToolInput(tool.name, tool.input)));
    }

    if (tool.outputPreview) {
      blocks.push(this.renderToolBlock(labels.output, prettyValue(tool.outputPreview)));
    }

    if (tool.error) {
      blocks.push(this.renderToolBlock(labels.errorPrefix, tool.error, true));
    }

    if (blocks.length === 0) {
      blocks.push(this.renderToolBlock(labels.output, tool.status === 'running' ? labels.running : labels.noOutput));
    }

    const event = this.renderEventItem({
      kind,
      icon: toolIcon(kind),
      label: tool.name,
      summary: summarizeTool(tool),
      status: formatToolStatus(tool.status, labels),
      defaultOpen: tool.status === 'running' || tool.status === 'error',
      children: blocks,
      extraClass: 'agent-chat-tool',
    });
    event.dataset.status = tool.status;
    event.dataset.kind = kind;
    return event;
  }

  private renderEventItem(options: ChatEventOptions): HTMLElement {
    const details = document.createElement('details') as HTMLDetailsElement;
    details.className = `agent-chat-event ${options.extraClass || ''}`.trim();
    details.dataset.kind = options.kind;
    details.open = Boolean(options.defaultOpen);

    const summary = document.createElement('summary');
    summary.className = 'agent-chat-event-header';

    const icon = document.createElement('span');
    icon.className = 'agent-chat-event-icon';
    icon.innerHTML = options.icon;

    const label = document.createElement('span');
    label.className = 'agent-chat-event-label';
    label.textContent = options.label;

    const compact = document.createElement('span');
    compact.className = 'agent-chat-event-summary';
    compact.textContent = options.summary || '';

    const status = document.createElement('span');
    status.className = 'agent-chat-event-status';
    status.textContent = options.status || '';

    const chevron = document.createElement('span');
    chevron.className = 'agent-chat-event-chevron';
    chevron.innerHTML = CHAT_ICONS.chevron;

    summary.appendChild(icon);
    summary.appendChild(label);
    summary.appendChild(compact);
    summary.appendChild(status);
    summary.appendChild(chevron);
    details.appendChild(summary);

    const content = document.createElement('div');
    content.className = 'agent-chat-event-content';
    content.append(...options.children);
    details.appendChild(content);
    return details;
  }

  private renderToolBlock(label: string, value: string, error = false): HTMLElement {
    const block = document.createElement('div');
    block.className = `agent-chat-tool-block${error ? ' error' : ''}`;
    const caption = document.createElement('span');
    caption.className = 'agent-chat-tool-block-label';
    caption.textContent = label;
    const content = document.createElement('code');
    content.textContent = value;
    block.appendChild(caption);
    block.appendChild(content);
    return block;
  }

  private agentName(): string {
    return this.agentType === 'claude' ? 'Claude' : 'Codex';
  }
}

function normalizeToolKind(tool: AgentChatToolTrace): string {
  if (tool.kind) return tool.kind;
  if (tool.name === 'web_search') return 'web_search';
  if (tool.name.startsWith('browser__')) return 'browser_tool';
  return 'function';
}

function toolIcon(kind: string): string {
  switch (kind) {
    case 'web_search': return CHAT_ICONS.search;
    case 'browser_tool': return CHAT_ICONS.browser;
    case 'mcp_tool': return CHAT_ICONS.mcp;
    default: return CHAT_ICONS.tool;
  }
}

function setButtonIcon(button: HTMLButtonElement, icon: string, label: string): void {
  button.innerHTML = icon;
  const accessibleLabel = document.createElement('span');
  accessibleLabel.className = 'visually-hidden';
  accessibleLabel.textContent = label;
  button.appendChild(accessibleLabel);
  button.title = label;
  button.setAttribute('aria-label', label);
}

function formatStatus(status: AgentChatMessage['status'], labels: ChatLabels): string {
  switch (status) {
    case 'completed': return labels.completed;
    case 'error': return labels.failed;
    case 'streaming': return labels.running;
    default: return labels.pending;
  }
}

function formatToolStatus(status: AgentChatToolTrace['status'], labels: ChatLabels): string {
  switch (status) {
    case 'completed': return labels.completed;
    case 'error': return labels.failed;
    case 'running': return labels.running;
    default: return labels.pending;
  }
}

function formatTime(createdAt: number): string {
  if (!Number.isFinite(createdAt) || createdAt <= 0) {
    return '';
  }
  return new Date(createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function summarizeTool(tool: AgentChatToolTrace): string {
  const input = normalizeRecord(tool.input);
  if (tool.kind === 'web_search' || tool.name === 'web_search') {
    const query = input?.query;
    return typeof query === 'string' ? summarizeText(query, 58) : 'Search web';
  }
  if (tool.name.startsWith('browser__')) {
    const shortName = tool.name.replace(/^browser__/, '').replace(/_/g, ' ');
    const target = firstString(input, ['url', 'selector', 'text', 'query', 'tab_id', 'window_scope']);
    return target ? `${shortName} - ${summarizeText(target, 46)}` : shortName;
  }
  switch (tool.name) {
    case 'Bash':
      return summarizeText(String(input?.description || input?.command || tool.name), 58);
    case 'Read':
      return summarizeText(String(input?.file_path || tool.name), 58);
    case 'Edit':
    case 'Write':
      return summarizeText(String(input?.file_path || input?.notebook_path || tool.name), 58);
    default: {
      const value = firstString(input, ['name', 'path', 'file', 'query', 'command', 'url']);
      return value ? summarizeText(value, 58) : tool.name;
    }
  }
}

function renderToolInput(toolName: string, value: unknown): string {
  const input = normalizeRecord(value);
  if (!input) return prettyValue(value);
  if (toolName === 'Bash' && typeof input.command === 'string') {
    return [input.description, input.command].filter(Boolean).join('\n');
  }
  if ((toolName === 'Read' || toolName === 'Edit' || toolName === 'Write') && typeof input.file_path === 'string') {
    return prettyValue(input);
  }
  return prettyValue(input);
}

function prettyValue(value: unknown): string {
  const text = typeof value === 'string' ? maybePrettyJson(value) : JSON.stringify(value, null, 2);
  if (!text) {
    return '';
  }
  return text.length > 1800 ? `${text.slice(0, 1800)}...` : text;
}

function maybePrettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

function normalizeRecord(value: unknown): Record<string, unknown> | null {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function firstString(input: Record<string, unknown> | null, keys: string[]): string | null {
  if (!input) return null;
  for (const key of keys) {
    const value = input[key];
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number') return String(value);
  }
  return null;
}

function stripAnsi(value: string): string {
  return value.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
}

function summarizeText(value: string, maxLength: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 3))}...` : text;
}

function renderMarkdownLite(text: string): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  const codeFence = /```([^\n`]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = codeFence.exec(text)) !== null) {
    nodes.push(...renderTextBlocks(text.slice(lastIndex, match.index)));
    nodes.push(renderCodeBlock(match[2], match[1]?.trim()));
    lastIndex = match.index + match[0].length;
  }
  nodes.push(...renderTextBlocks(text.slice(lastIndex)));
  return nodes.length ? nodes : [renderParagraph(text)];
}

function renderTextBlocks(text: string): HTMLElement[] {
  return text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((line) => /^\s*[-*]\s+/.test(line))) {
        const list = document.createElement('ul');
        list.className = 'agent-chat-markdown-list';
        lines.forEach((line) => {
          const item = document.createElement('li');
          item.textContent = line.replace(/^\s*[-*]\s+/, '');
          list.appendChild(item);
        });
        return list;
      }
      return renderParagraph(block);
    });
}

function renderParagraph(text: string): HTMLElement {
  const paragraph = document.createElement('p');
  paragraph.className = 'agent-chat-markdown-paragraph';
  paragraph.textContent = text;
  return paragraph;
}

function renderCodeBlock(codeText: string, language?: string): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'agent-chat-code-viewer';
  if (language) {
    const header = document.createElement('div');
    header.className = 'agent-chat-code-header';
    header.textContent = language;
    wrapper.appendChild(header);
  }
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  code.textContent = codeText.replace(/\n$/, '');
  pre.appendChild(code);
  wrapper.appendChild(pre);
  return wrapper;
}
