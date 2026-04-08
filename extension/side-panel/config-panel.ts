import type { AgentLaunchConfig, AgentStartupOptions, LaunchConfigAgentType } from '../shared/types';
import {
  clearLaunchConfigAgent,
  cloneLaunchConfig,
  createDefaultLaunchConfig,
} from './state';

export interface ConfigPanelContext {
  scope: 'defaults' | 'pane';
  title: string;
  description: string;
  saveLabel: string;
  resetLabel: string;
  agentType?: LaunchConfigAgentType;
  paneId?: string;
  previewTab?: {
    tabId: number;
    title?: string;
    url?: string;
  } | null;
}

export class ConfigPanel {
  private overlay: HTMLElement;
  private titleEl: HTMLElement;
  private descriptionEl: HTMLElement;
  private closeBtn: HTMLElement;
  private saveBtn: HTMLButtonElement;
  private resetBtn: HTMLButtonElement;
  private tabs: NodeListOf<HTMLElement>;
  private tabContents: NodeListOf<HTMLElement>;

  private claudeSection: HTMLElement;
  private codexSection: HTMLElement;
  private claudeDebugSection: HTMLElement;
  private codexDebugSection: HTMLElement;

  private claudeLaunchArgs: HTMLInputElement;
  private claudeWorkingDir: HTMLInputElement;
  private claudePromptMode: HTMLSelectElement;
  private claudeCustomPrompt: HTMLTextAreaElement;
  private claudeCustomPromptField: HTMLElement;
  private claudePromptTransport: HTMLElement;
  private claudePromptPreview: HTMLElement;

  private codexLaunchArgs: HTMLInputElement;
  private codexWorkingDir: HTMLInputElement;
  private codexPromptMode: HTMLSelectElement;
  private codexCustomPrompt: HTMLTextAreaElement;
  private codexCustomPromptField: HTMLElement;
  private codexPromptTransport: HTMLElement;
  private codexPromptPreview: HTMLElement;

  private currentContext: ConfigPanelContext = {
    scope: 'defaults',
    title: '默认启动设置',
    description: '',
    saveLabel: '保存',
    resetLabel: '重置为默认',
  };

  private resetConfig: AgentLaunchConfig = createDefaultLaunchConfig();
  private onSaveCallback: ((config: AgentLaunchConfig, context: ConfigPanelContext) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('config-panel-overlay')!;
    this.titleEl = document.getElementById('config-title')!;
    this.descriptionEl = document.getElementById('config-description')!;
    this.closeBtn = document.getElementById('config-close')!;
    this.saveBtn = document.getElementById('config-save') as HTMLButtonElement;
    this.resetBtn = document.getElementById('config-reset') as HTMLButtonElement;
    this.tabs = document.querySelectorAll('.config-tab');
    this.tabContents = document.querySelectorAll('.config-tab-content');

    this.claudeSection = document.getElementById('claude-config-section')!;
    this.codexSection = document.getElementById('codex-config-section')!;
    this.claudeDebugSection = document.getElementById('claude-debug-section')!;
    this.codexDebugSection = document.getElementById('codex-debug-section')!;

    this.claudeLaunchArgs = document.getElementById('claude-launch-args') as HTMLInputElement;
    this.claudeWorkingDir = document.getElementById('claude-working-dir') as HTMLInputElement;
    this.claudePromptMode = document.getElementById('claude-prompt-mode') as HTMLSelectElement;
    this.claudeCustomPrompt = document.getElementById('claude-custom-prompt') as HTMLTextAreaElement;
    this.claudeCustomPromptField = document.getElementById('claude-custom-prompt-field')!;
    this.claudePromptTransport = document.getElementById('claude-prompt-transport')!;
    this.claudePromptPreview = document.getElementById('claude-prompt-preview')!;

    this.codexLaunchArgs = document.getElementById('codex-launch-args') as HTMLInputElement;
    this.codexWorkingDir = document.getElementById('codex-working-dir') as HTMLInputElement;
    this.codexPromptMode = document.getElementById('codex-prompt-mode') as HTMLSelectElement;
    this.codexCustomPrompt = document.getElementById('codex-custom-prompt') as HTMLTextAreaElement;
    this.codexCustomPromptField = document.getElementById('codex-custom-prompt-field')!;
    this.codexPromptTransport = document.getElementById('codex-prompt-transport')!;
    this.codexPromptPreview = document.getElementById('codex-prompt-preview')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.closeBtn.addEventListener('click', () => this.hide());
    this.saveBtn.addEventListener('click', () => this.save());
    this.resetBtn.addEventListener('click', () => this.reset());

    this.overlay.addEventListener('click', (event) => {
      if (event.target === this.overlay) {
        this.hide();
      }
    });

    this.overlay.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.hide();
      }
    });

    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        if (targetTab) {
          this.switchTab(targetTab);
        }
      });
    });

    this.claudePromptMode.addEventListener('change', () => {
      this.toggleCustomPromptField('claude');
      this.updatePromptPreview('claude');
    });
    this.codexPromptMode.addEventListener('change', () => {
      this.toggleCustomPromptField('codex');
      this.updatePromptPreview('codex');
    });

    this.claudeCustomPrompt.addEventListener('input', () => this.updatePromptPreview('claude'));
    this.codexCustomPrompt.addEventListener('input', () => this.updatePromptPreview('codex'));
  }

  public show(config: AgentLaunchConfig, context: ConfigPanelContext): void {
    this.currentContext = context;
    this.resetConfig = context.scope === 'defaults'
      ? createDefaultLaunchConfig()
      : clearLaunchConfigAgent(cloneLaunchConfig(config), context.agentType!);

    this.applyContext();
    this.loadConfig(config);
    this.switchTab('defaults');
    this.overlay.style.display = 'flex';
    this.overlay.setAttribute('aria-hidden', 'false');
    this.saveBtn.focus();
  }

  public hide(): void {
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  public onSave(callback: (config: AgentLaunchConfig, context: ConfigPanelContext) => void): void {
    this.onSaveCallback = callback;
  }

  private applyContext(): void {
    this.titleEl.textContent = this.currentContext.title;
    this.descriptionEl.textContent = this.currentContext.description;
    this.descriptionEl.style.display = this.currentContext.description ? 'block' : 'none';
    this.saveBtn.textContent = this.currentContext.saveLabel;
    this.resetBtn.textContent = this.currentContext.resetLabel;

    const singleAgent = this.currentContext.scope === 'pane' ? this.currentContext.agentType ?? null : null;
    this.setSectionVisibility(this.claudeSection, !singleAgent || singleAgent === 'claude');
    this.setSectionVisibility(this.codexSection, !singleAgent || singleAgent === 'codex');
    this.setSectionVisibility(this.claudeDebugSection, !singleAgent || singleAgent === 'claude');
    this.setSectionVisibility(this.codexDebugSection, !singleAgent || singleAgent === 'codex');
  }

  private setSectionVisibility(element: HTMLElement, visible: boolean): void {
    element.style.display = visible ? '' : 'none';
  }

  private switchTab(tabName: string): void {
    this.tabs.forEach((tab) => {
      tab.classList.toggle('active', tab.getAttribute('data-tab') === tabName);
    });

    this.tabContents.forEach((content) => {
      const isTarget = content.id === `tab-${tabName}`;
      content.style.display = isTarget ? 'block' : 'none';
    });
  }

  private toggleCustomPromptField(agent: LaunchConfigAgentType): void {
    const mode = agent === 'claude' ? this.claudePromptMode.value : this.codexPromptMode.value;
    const field = agent === 'claude' ? this.claudeCustomPromptField : this.codexCustomPromptField;
    field.style.display = mode === 'custom' ? 'block' : 'none';
  }

  private loadConfig(config: AgentLaunchConfig): void {
    this.claudeLaunchArgs.value = config.claude.launchArgs;
    this.claudeWorkingDir.value = config.claude.workingDirectory;
    this.claudePromptMode.value = config.claude.systemPromptMode;
    this.claudeCustomPrompt.value = config.claude.customSystemPrompt;
    this.toggleCustomPromptField('claude');

    this.codexLaunchArgs.value = config.codex.launchArgs;
    this.codexWorkingDir.value = config.codex.workingDirectory;
    this.codexPromptMode.value = config.codex.systemPromptMode;
    this.codexCustomPrompt.value = config.codex.customSystemPrompt;
    this.toggleCustomPromptField('codex');

    this.updatePromptPreview('claude');
    this.updatePromptPreview('codex');
  }

  private getConfig(): AgentLaunchConfig {
    return {
      claude: {
        launchArgs: this.claudeLaunchArgs.value.trim(),
        workingDirectory: this.claudeWorkingDir.value.trim(),
        systemPromptMode: this.claudePromptMode.value as AgentStartupOptions['systemPromptMode'],
        customSystemPrompt: this.claudeCustomPrompt.value.trim(),
      },
      codex: {
        launchArgs: this.codexLaunchArgs.value.trim(),
        workingDirectory: this.codexWorkingDir.value.trim(),
        systemPromptMode: this.codexPromptMode.value as AgentStartupOptions['systemPromptMode'],
        customSystemPrompt: this.codexCustomPrompt.value.trim(),
      },
    };
  }

  private updatePromptPreview(agent: LaunchConfigAgentType): void {
    const startup = this.getConfig()[agent];
    const transportEl = agent === 'claude' ? this.claudePromptTransport : this.codexPromptTransport;
    const previewEl = agent === 'claude' ? this.claudePromptPreview : this.codexPromptPreview;
    const promptText = this.buildPromptPreview(agent, startup);

    if (startup.systemPromptMode === 'none') {
      transportEl.textContent = agent === 'claude'
        ? 'Claude 不会追加任何 ClaudeChrome 浏览器环境系统提示。'
        : 'Codex 不会注入任何 ClaudeChrome 启动上下文。';
      previewEl.textContent = '已禁用浏览器环境提示注入。';
      return;
    }

    transportEl.textContent = agent === 'claude'
      ? 'Claude 会通过 --append-system-prompt 注入以下浏览器环境提示。'
      : 'Codex CLI 没有独立的 system prompt 参数，ClaudeChrome 会把以下内容作为启动时的首条上下文指令传入。';
    previewEl.textContent = promptText;
  }

  private buildPromptPreview(agent: LaunchConfigAgentType, startup: AgentStartupOptions): string {
    const previewTab = this.currentContext.previewTab;
    const lines = [
      'You are running inside ClaudeChrome, a browser-attached agent session.',
      'Use the `claudechrome-browser` MCP server as the source of truth for live browser state.',
      'When the user says "this page", "the current tab", or similar, treat it as the tab bound to this session unless they explicitly specify another tab.',
      'Prefer browser tools and live page inspection over static assumptions.',
      previewTab ? 'Current tab in this preview:' : 'Current bound tab at launch:',
      `- tabId: ${previewTab?.tabId ?? '<launch-time tab id>'}`,
      `- title: ${previewTab?.title || '<launch-time tab title>'}`,
      `- url: ${previewTab?.url || '<launch-time tab url>'}`,
    ];

    if (startup.systemPromptMode === 'custom' && startup.customSystemPrompt.trim()) {
      lines.push('', 'Additional custom startup instructions:', startup.customSystemPrompt.trim());
    }

    return lines.join('\n');
  }

  private save(): void {
    const config = this.getConfig();
    if (this.onSaveCallback) {
      this.onSaveCallback(config, this.currentContext);
    }
    this.hide();
  }

  private reset(): void {
    this.loadConfig(this.resetConfig);
  }
}
