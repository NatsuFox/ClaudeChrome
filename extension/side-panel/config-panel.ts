import type { AgentLaunchConfig, AgentStartupOptions, LaunchConfigAgentType } from '../shared/types';
import {
  clearLaunchConfigAgent,
  cloneLaunchConfig,
  createDefaultLaunchConfig,
  type PanelLanguage,
} from './state';

export interface ConfigPanelContext {
  scope: 'defaults' | 'pane';
  agentType?: LaunchConfigAgentType;
  paneId?: string;
  previewTab?: {
    tabId: number;
    title?: string;
    url?: string;
  } | null;
}

type ConfigPanelTranslations = {
  closeTitle: string;
  defaultsTitle: string;
  defaultsDescription: string;
  defaultsSaveLabel: string;
  defaultsResetLabel: string;
  paneTitle: string;
  paneDescription: string;
  paneSaveLabel: string;
  paneResetLabel: string;
  tabDefaults: string;
  tabPromptDebug: string;
  claudeDefaultsHeading: string;
  codexDefaultsHeading: string;
  launchArgsLabel: string;
  workingDirLabel: string;
  promptModeLabel: string;
  promptModeDefault: string;
  promptModeCustom: string;
  promptModeNone: string;
  customPromptLabel: string;
  claudeLaunchArgsPlaceholder: string;
  codexLaunchArgsPlaceholder: string;
  workingDirPlaceholder: string;
  workingDirHint: string;
  claudePromptHint: string;
  codexPromptHint: string;
  customPromptPlaceholder: string;
  claudePreviewHeading: string;
  codexPreviewHeading: string;
  claudePromptDisabledTransport: string;
  codexPromptDisabledTransport: string;
  promptInjectionDisabled: string;
  claudePromptTransport: string;
  codexPromptTransport: string;
};

const translations: Record<PanelLanguage, ConfigPanelTranslations> = {
  zh: {
    closeTitle: '关闭',
    defaultsTitle: '默认启动设置',
    defaultsDescription: '在这里配置 Claude 与 Codex 的全局默认启动参数、工作目录，以及浏览器环境提示注入策略。',
    defaultsSaveLabel: '保存默认设置',
    defaultsResetLabel: '恢复产品默认',
    paneTitle: '{agent} 面板设置',
    paneDescription: '这里可以覆盖该面板自己的启动参数、工作目录和浏览器环境提示。点击重置可恢复为继承全局默认。',
    paneSaveLabel: '保存面板设置',
    paneResetLabel: '恢复全局默认',
    tabDefaults: '启动设置',
    tabPromptDebug: '提示注入调试',
    claudeDefaultsHeading: 'Claude 默认配置',
    codexDefaultsHeading: 'Codex 默认配置',
    launchArgsLabel: '启动参数',
    workingDirLabel: '工作目录',
    promptModeLabel: '浏览器环境提示模式',
    promptModeDefault: '默认浏览器上下文',
    promptModeCustom: '默认上下文 + 自定义追加',
    promptModeNone: '禁用注入',
    customPromptLabel: '自定义追加提示',
    claudeLaunchArgsPlaceholder: '例如: -m opus',
    codexLaunchArgsPlaceholder: '例如: -a never -s workspace-write',
    workingDirPlaceholder: '留空则使用当前会话工作区',
    workingDirHint: '支持绝对路径，或相对于当前 ClaudeChrome 启动目录的相对路径',
    claudePromptHint: '默认会注入 ClaudeChrome 的浏览器绑定信息；自定义模式会在其后追加你的提示',
    codexPromptHint: 'Codex 没有独立的 system prompt 参数，ClaudeChrome 会把该上下文作为启动时的首条上下文指令传入',
    customPromptPlaceholder: '输入需要追加到默认浏览器上下文后的额外提示...',
    claudePreviewHeading: 'Claude 注入预览',
    codexPreviewHeading: 'Codex 注入预览',
    claudePromptDisabledTransport: 'Claude 不会追加任何 ClaudeChrome 浏览器环境系统提示。',
    codexPromptDisabledTransport: 'Codex 不会注入任何 ClaudeChrome 启动上下文。',
    promptInjectionDisabled: '已禁用浏览器环境提示注入。',
    claudePromptTransport: 'Claude 会通过 --append-system-prompt 注入以下浏览器环境提示。',
    codexPromptTransport: 'Codex CLI 没有独立的 system prompt 参数，ClaudeChrome 会把以下内容作为启动时的首条上下文指令传入。',
  },
  en: {
    closeTitle: 'Close',
    defaultsTitle: 'Default startup settings',
    defaultsDescription: 'Configure the global default launch args, working directories, and browser-context prompt behavior for Claude and Codex panes here.',
    defaultsSaveLabel: 'Save default settings',
    defaultsResetLabel: 'Restore product defaults',
    paneTitle: '{agent} pane settings',
    paneDescription: 'Override launch args, working directory, and browser-context prompt behavior for this pane. Reset to inherit the global defaults again.',
    paneSaveLabel: 'Save pane settings',
    paneResetLabel: 'Restore global defaults',
    tabDefaults: 'Startup settings',
    tabPromptDebug: 'Prompt injection debug',
    claudeDefaultsHeading: 'Claude default settings',
    codexDefaultsHeading: 'Codex default settings',
    launchArgsLabel: 'Launch args',
    workingDirLabel: 'Working directory',
    promptModeLabel: 'Browser context prompt mode',
    promptModeDefault: 'Default browser context',
    promptModeCustom: 'Default context + custom addition',
    promptModeNone: 'Disable injection',
    customPromptLabel: 'Custom appended prompt',
    claudeLaunchArgsPlaceholder: 'For example: -m opus',
    codexLaunchArgsPlaceholder: 'For example: -a never -s workspace-write',
    workingDirPlaceholder: 'Leave empty to use the current session workspace',
    workingDirHint: 'Supports absolute paths, or paths relative to the ClaudeChrome launch directory',
    claudePromptHint: 'ClaudeChrome injects browser-binding context by default; custom mode appends your prompt after it',
    codexPromptHint: 'Codex has no separate system prompt flag, so ClaudeChrome sends this context as the first startup instruction',
    customPromptPlaceholder: 'Enter extra instructions to append after the default browser context...',
    claudePreviewHeading: 'Claude injection preview',
    codexPreviewHeading: 'Codex injection preview',
    claudePromptDisabledTransport: 'Claude will not append any ClaudeChrome browser-context system prompt.',
    codexPromptDisabledTransport: 'Codex will not inject any ClaudeChrome startup context.',
    promptInjectionDisabled: 'Browser-context prompt injection is disabled.',
    claudePromptTransport: 'Claude will inject the following browser-context prompt via --append-system-prompt.',
    codexPromptTransport: 'Codex CLI has no separate system prompt flag, so ClaudeChrome sends the following content as the first startup instruction.',
  },
};

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
}

function agentLabel(agentType: LaunchConfigAgentType): string {
  return agentType === 'codex' ? 'Codex' : 'Claude';
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

  private language: PanelLanguage = 'zh';
  private currentContext: ConfigPanelContext = { scope: 'defaults' };
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
    this.applyLocale();
    this.applyContext();
  }

  public setLanguage(language: PanelLanguage): void {
    this.language = language;
    this.applyLocale();
    this.applyContext();
    this.updatePromptPreview('claude');
    this.updatePromptPreview('codex');
  }

  private locale(): ConfigPanelTranslations {
    return translations[this.language];
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

    this.applyLocale();
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

  private applyLocale(): void {
    const t = this.locale();

    this.closeBtn.setAttribute('title', t.closeTitle);
    this.closeBtn.setAttribute('aria-label', t.closeTitle);

    this.setText('.config-tab[data-tab="defaults"]', t.tabDefaults);
    this.setText('.config-tab[data-tab="prompt-debug"]', t.tabPromptDebug);

    this.setText('#claude-config-section h3', t.claudeDefaultsHeading);
    this.setText('#codex-config-section h3', t.codexDefaultsHeading);
    this.setText('#claude-debug-section h3', t.claudePreviewHeading);
    this.setText('#codex-debug-section h3', t.codexPreviewHeading);

    this.setText('label[for="claude-launch-args"]', t.launchArgsLabel);
    this.setText('label[for="codex-launch-args"]', t.launchArgsLabel);
    this.setText('label[for="claude-working-dir"]', t.workingDirLabel);
    this.setText('label[for="codex-working-dir"]', t.workingDirLabel);
    this.setText('label[for="claude-prompt-mode"]', t.promptModeLabel);
    this.setText('label[for="codex-prompt-mode"]', t.promptModeLabel);
    this.setText('label[for="claude-custom-prompt"]', t.customPromptLabel);
    this.setText('label[for="codex-custom-prompt"]', t.customPromptLabel);

    this.claudeLaunchArgs.placeholder = t.claudeLaunchArgsPlaceholder;
    this.codexLaunchArgs.placeholder = t.codexLaunchArgsPlaceholder;
    this.claudeWorkingDir.placeholder = t.workingDirPlaceholder;
    this.codexWorkingDir.placeholder = t.workingDirPlaceholder;
    this.claudeCustomPrompt.placeholder = t.customPromptPlaceholder;
    this.codexCustomPrompt.placeholder = t.customPromptPlaceholder;

    this.setHint(
      this.claudeLaunchArgs,
      this.language === 'zh' ? 'Claude 面板的默认 CLI 启动参数' : 'Default CLI launch args for Claude panes',
    );
    this.setHint(
      this.codexLaunchArgs,
      this.language === 'zh' ? 'Codex 面板的默认 CLI 启动参数' : 'Default CLI launch args for Codex panes',
    );
    this.setHint(this.claudeWorkingDir, t.workingDirHint);
    this.setHint(this.codexWorkingDir, t.workingDirHint);
    this.setHint(this.claudePromptMode, t.claudePromptHint);
    this.setHint(this.codexPromptMode, t.codexPromptHint);

    this.setSelectOptions(this.claudePromptMode, [t.promptModeDefault, t.promptModeCustom, t.promptModeNone]);
    this.setSelectOptions(this.codexPromptMode, [t.promptModeDefault, t.promptModeCustom, t.promptModeNone]);
  }

  private applyContext(): void {
    const t = this.locale();
    if (this.currentContext.scope === 'defaults') {
      this.titleEl.textContent = t.defaultsTitle;
      this.descriptionEl.textContent = t.defaultsDescription;
      this.saveBtn.textContent = t.defaultsSaveLabel;
      this.resetBtn.textContent = t.defaultsResetLabel;
    } else {
      const agent = agentLabel(this.currentContext.agentType ?? 'claude');
      this.titleEl.textContent = formatMessage(t.paneTitle, { agent });
      this.descriptionEl.textContent = t.paneDescription;
      this.saveBtn.textContent = t.paneSaveLabel;
      this.resetBtn.textContent = t.paneResetLabel;
    }

    this.descriptionEl.style.display = this.descriptionEl.textContent ? 'block' : 'none';

    const singleAgent = this.currentContext.scope === 'pane' ? this.currentContext.agentType ?? null : null;
    this.setSectionVisibility(this.claudeSection, !singleAgent || singleAgent === 'claude');
    this.setSectionVisibility(this.codexSection, !singleAgent || singleAgent === 'codex');
    this.setSectionVisibility(this.claudeDebugSection, !singleAgent || singleAgent === 'claude');
    this.setSectionVisibility(this.codexDebugSection, !singleAgent || singleAgent === 'codex');
  }

  private setSectionVisibility(element: HTMLElement, visible: boolean): void {
    element.style.display = visible ? '' : 'none';
  }

  private setText(selector: string, text: string): void {
    const element = this.overlay.querySelector<HTMLElement>(selector);
    if (element) {
      element.textContent = text;
    }
  }

  private setHint(control: HTMLElement, text: string): void {
    const hint = control.parentElement?.querySelector<HTMLElement>('.config-hint');
    if (hint) {
      hint.textContent = text;
    }
  }

  private setSelectOptions(select: HTMLSelectElement, labels: [string, string, string] | string[]): void {
    labels.forEach((label, index) => {
      if (select.options[index]) {
        select.options[index].textContent = label;
      }
    });
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
    const t = this.locale();
    const startup = this.getConfig()[agent];
    const transportEl = agent === 'claude' ? this.claudePromptTransport : this.codexPromptTransport;
    const previewEl = agent === 'claude' ? this.claudePromptPreview : this.codexPromptPreview;
    const promptText = this.buildPromptPreview(startup);

    if (startup.systemPromptMode === 'none') {
      transportEl.textContent = agent === 'claude'
        ? t.claudePromptDisabledTransport
        : t.codexPromptDisabledTransport;
      previewEl.textContent = t.promptInjectionDisabled;
      return;
    }

    transportEl.textContent = agent === 'claude'
      ? t.claudePromptTransport
      : t.codexPromptTransport;
    previewEl.textContent = promptText;
  }

  private buildPromptPreview(startup: AgentStartupOptions): string {
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
