import type {
  AgentLaunchConfig,
  AgentStartupOptions,
  AgentType,
  LaunchConfigAgentType,
  WorkingDirectoryValidationCode,
} from '../shared/types';
import {
  clearLaunchConfigAgent,
  cloneLaunchConfig,
  createDefaultLaunchConfig,
  type PanelLanguage,
} from './state';
import { formatPanelMessage, getPanelLocale, type PanelLocaleText } from './lexicon';
import { isValidConfiguredWorkingDirectory } from './working-directory';

export interface ConfigPanelContext {
  scope: 'defaults' | 'pane';
  agentType?: LaunchConfigAgentType;
  paneId?: string;
  workspaceId?: string;
  workspaceTitle?: string;
  workspaceDefaultAgentType?: AgentType;
  shellWorkingDirectory?: string;
  previewTab?: {
    tabId: number;
    title?: string;
    url?: string;
  } | null;
}

export interface WorkingDirectoryValidationResult {
  code: WorkingDirectoryValidationCode;
  normalizedPath?: string;
  message?: string;
}

function agentLabel(agentType: LaunchConfigAgentType, locale: PanelLocaleText): string {
  return agentType === 'codex' ? locale.agentLabelCodex : locale.agentLabelClaude;
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

  private workspaceSection: HTMLElement;
  private shellSection: HTMLElement;
  private claudeSection: HTMLElement;
  private codexSection: HTMLElement;
  private claudeDebugSection: HTMLElement;
  private codexDebugSection: HTMLElement;

  private shellWorkingDir: HTMLInputElement;
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
  private workspaceDefaultAgent: HTMLSelectElement;

  private language: PanelLanguage = 'zh';
  private currentContext: ConfigPanelContext = { scope: 'defaults' };
  private resetConfig: AgentLaunchConfig = createDefaultLaunchConfig();
  private resetWorkspaceDefaultAgentType: AgentType = 'claude';
  private resetShellWorkingDirectory = '';
  private onSaveCallback: ((
    config: AgentLaunchConfig,
    context: ConfigPanelContext,
    workspaceDefaultAgentType: AgentType | null,
    shellWorkingDirectory: string | null,
  ) => void) | null = null;
  private workingDirectoryValidator: ((pathValue: string) => Promise<WorkingDirectoryValidationResult>) | null = null;
  private workingDirectoryValidationRunId = 0;

  constructor() {
    this.overlay = document.getElementById('config-panel-overlay')!;
    this.titleEl = document.getElementById('config-title')!;
    this.descriptionEl = document.getElementById('config-description')!;
    this.closeBtn = document.getElementById('config-close')!;
    this.saveBtn = document.getElementById('config-save') as HTMLButtonElement;
    this.resetBtn = document.getElementById('config-reset') as HTMLButtonElement;
    this.tabs = document.querySelectorAll('.config-tab');
    this.tabContents = document.querySelectorAll('.config-tab-content');

    this.workspaceSection = document.getElementById('workspace-config-section')!;
    this.shellSection = document.getElementById('shell-config-section')!;
    this.claudeSection = document.getElementById('claude-config-section')!;
    this.codexSection = document.getElementById('codex-config-section')!;
    this.claudeDebugSection = document.getElementById('claude-debug-section')!;
    this.codexDebugSection = document.getElementById('codex-debug-section')!;

    this.shellWorkingDir = document.getElementById('shell-working-dir') as HTMLInputElement;
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
    this.workspaceDefaultAgent = document.getElementById('workspace-default-agent') as HTMLSelectElement;

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
    void this.updateWorkingDirectoryValidation();
  }

  public setWorkingDirectoryValidator(
    validator: ((pathValue: string) => Promise<WorkingDirectoryValidationResult>) | null,
  ): void {
    this.workingDirectoryValidator = validator;
    void this.updateWorkingDirectoryValidation();
  }

  private locale(): PanelLocaleText {
    return getPanelLocale(this.language);
  }

  private bindEvents(): void {
    this.closeBtn.addEventListener('click', () => this.hide());
    this.saveBtn.addEventListener('click', () => { void this.save(); });
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

    [this.shellWorkingDir, this.claudeWorkingDir, this.codexWorkingDir].forEach((input) => {
      input.addEventListener('input', () => { void this.updateWorkingDirectoryValidation(); });
      input.addEventListener('blur', () => { void this.updateWorkingDirectoryValidation(); });
    });
  }

  public show(config: AgentLaunchConfig, context: ConfigPanelContext): void {
    this.currentContext = context;
    this.resetConfig = context.scope === 'defaults'
      ? createDefaultLaunchConfig()
      : clearLaunchConfigAgent(cloneLaunchConfig(config), context.agentType!);
    this.resetWorkspaceDefaultAgentType = context.workspaceDefaultAgentType ?? 'claude';
    this.resetShellWorkingDirectory = '';

    this.applyLocale();
    this.applyContext();
    this.loadConfig(config);
    this.switchTab('defaults');
    this.overlay.style.display = 'flex';
    this.overlay.setAttribute('aria-hidden', 'false');
    void this.updateWorkingDirectoryValidation();
    this.saveBtn.focus();
  }

  public hide(): void {
    this.overlay.style.display = 'none';
    this.overlay.setAttribute('aria-hidden', 'true');
  }

  public onSave(callback: (
    config: AgentLaunchConfig,
    context: ConfigPanelContext,
    workspaceDefaultAgentType: AgentType | null,
    shellWorkingDirectory: string | null,
  ) => void): void {
    this.onSaveCallback = callback;
  }

  private applyLocale(): void {
    const t = this.locale();

    this.closeBtn.setAttribute('title', t.configCloseTitle);
    this.closeBtn.setAttribute('aria-label', t.configCloseTitle);

    this.setText('.config-tab[data-tab="defaults"]', t.configTabDefaults);
    this.setText('.config-tab[data-tab="prompt-debug"]', t.configTabPromptDebug);

    this.setText('#workspace-config-heading', t.configWorkspaceSectionHeading);
    this.setText('#shell-config-heading', t.configShellDefaultsHeading);
    this.setText('#claude-config-section h3', t.configClaudeDefaultsHeading);
    this.setText('#codex-config-section h3', t.configCodexDefaultsHeading);
    this.setText('#claude-debug-section h3', t.configClaudePreviewHeading);
    this.setText('#codex-debug-section h3', t.configCodexPreviewHeading);

    this.setText('label[for="workspace-default-agent"]', t.configWorkspaceDefaultAgentLabel);
    this.setText('label[for="shell-working-dir"]', t.configWorkingDirLabel);
    this.setText('label[for="claude-launch-args"]', t.configLaunchArgsLabel);
    this.setText('label[for="codex-launch-args"]', t.configLaunchArgsLabel);
    this.setText('label[for="claude-working-dir"]', t.configWorkingDirLabel);
    this.setText('label[for="codex-working-dir"]', t.configWorkingDirLabel);
    this.setText('label[for="claude-prompt-mode"]', t.configPromptModeLabel);
    this.setText('label[for="codex-prompt-mode"]', t.configPromptModeLabel);
    this.setText('label[for="claude-custom-prompt"]', t.configCustomPromptLabel);
    this.setText('label[for="codex-custom-prompt"]', t.configCustomPromptLabel);

    this.claudeLaunchArgs.placeholder = t.configClaudeLaunchArgsPlaceholder;
    this.codexLaunchArgs.placeholder = t.configCodexLaunchArgsPlaceholder;
    this.shellWorkingDir.placeholder = t.configWorkingDirPlaceholder;
    this.claudeWorkingDir.placeholder = t.configWorkingDirPlaceholder;
    this.codexWorkingDir.placeholder = t.configWorkingDirPlaceholder;
    this.claudeCustomPrompt.placeholder = t.configCustomPromptPlaceholder;
    this.codexCustomPrompt.placeholder = t.configCustomPromptPlaceholder;

    this.setHint(this.workspaceDefaultAgent, t.configWorkspaceDefaultAgentHint);
    this.setHint(this.shellWorkingDir, t.configShellWorkingDirHint);
    this.setHint(this.claudeLaunchArgs, t.configClaudeLaunchArgsHint);
    this.setHint(this.codexLaunchArgs, t.configCodexLaunchArgsHint);
    this.setHint(this.claudeWorkingDir, t.configWorkingDirHint);
    this.setHint(this.codexWorkingDir, t.configWorkingDirHint);
    this.setHint(this.claudePromptMode, t.configClaudePromptHint);
    this.setHint(this.codexPromptMode, t.configCodexPromptHint);

    this.setSelectOptions(this.workspaceDefaultAgent, [t.agentLabelClaude, t.agentLabelCodex, t.agentLabelShell]);
    this.setSelectOptions(this.claudePromptMode, [t.configPromptModeDefault, t.configPromptModeCustom, t.configPromptModeNone]);
    this.setSelectOptions(this.codexPromptMode, [t.configPromptModeDefault, t.configPromptModeCustom, t.configPromptModeNone]);
  }

  private applyContext(): void {
    const t = this.locale();
    if (this.currentContext.scope === 'defaults') {
      this.titleEl.textContent = t.configDefaultsTitle;
      this.descriptionEl.textContent = t.configDefaultsDescription;
      this.saveBtn.textContent = t.configDefaultsSaveLabel;
      this.resetBtn.textContent = t.configDefaultsResetLabel;
    } else {
      const agent = agentLabel(this.currentContext.agentType ?? 'claude', t);
      this.titleEl.textContent = formatPanelMessage(t.configPaneTitle, { agent });
      this.descriptionEl.textContent = t.configPaneDescription;
      this.saveBtn.textContent = t.configPaneSaveLabel;
      this.resetBtn.textContent = t.configPaneResetLabel;
    }

    this.descriptionEl.style.display = this.descriptionEl.textContent ? 'block' : 'none';

    const singleAgent = this.currentContext.scope === 'pane' ? this.currentContext.agentType ?? null : null;
    this.setSectionVisibility(this.workspaceSection, this.currentContext.scope === 'defaults' && Boolean(this.currentContext.workspaceId));
    this.setSectionVisibility(this.shellSection, this.currentContext.scope === 'defaults');
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
      hint.classList.remove('config-hint-error');
    }
  }

  private validationMessageForCode(code: WorkingDirectoryValidationCode, t: PanelLocaleText): string {
    switch (code) {
      case 'invalid_syntax':
        return t.configWorkingDirErrorRelative;
      case 'not_found':
        return t.configWorkingDirErrorMissing;
      case 'not_directory':
        return t.configWorkingDirErrorNotDirectory;
      case 'permission_denied':
      case 'unknown_error':
      case 'unavailable':
        return t.configWorkingDirErrorUnavailable;
      default:
        return '';
    }
  }

  private validationMessageForResult(result: WorkingDirectoryValidationResult, t: PanelLocaleText): string {
    const baseMessage = this.validationMessageForCode(result.code, t);
    const hostMessage = result.message?.trim() || '';
    if (hostMessage && baseMessage && hostMessage !== baseMessage) {
      return `${baseMessage}\n${hostMessage}`;
    }
    return hostMessage || baseMessage;
  }

  private applyWorkingDirectoryValidationState(
    input: HTMLInputElement,
    invalidMessage: string,
    hintText: string,
  ): void {
    const hint = input.parentElement?.querySelector<HTMLElement>('.config-hint');
    input.setCustomValidity(invalidMessage);
    input.setAttribute('aria-invalid', String(Boolean(invalidMessage)));
    if (hint) {
      hint.textContent = hintText;
      hint.classList.toggle('config-hint-error', Boolean(invalidMessage));
    }
  }

  private workingDirectoryInputs(): HTMLInputElement[] {
    const inputs = [this.claudeWorkingDir, this.codexWorkingDir];
    if (this.currentContext.scope === 'defaults') {
      inputs.unshift(this.shellWorkingDir);
    }
    return inputs;
  }

  private async updateWorkingDirectoryValidation(): Promise<boolean> {
    const validationRunId = ++this.workingDirectoryValidationRunId;
    const t = this.locale();
    let valid = true;

    for (const input of this.workingDirectoryInputs()) {
      const pathValue = input.value.trim();
      const emptyHint = input === this.shellWorkingDir ? t.configShellWorkingDirHint : t.configWorkingDirHint;
      if (!pathValue) {
        this.applyWorkingDirectoryValidationState(input, '', emptyHint);
        continue;
      }

      if (!isValidConfiguredWorkingDirectory(pathValue)) {
        this.applyWorkingDirectoryValidationState(input, t.configWorkingDirErrorRelative, t.configWorkingDirErrorRelative);
        valid = false;
        continue;
      }

      if (!this.workingDirectoryValidator) {
        this.applyWorkingDirectoryValidationState(input, t.configWorkingDirErrorUnavailable, t.configWorkingDirErrorUnavailable);
        valid = false;
        continue;
      }

      this.applyWorkingDirectoryValidationState(input, '', t.configWorkingDirChecking);
      this.saveBtn.disabled = true;

      let result: WorkingDirectoryValidationResult;
      try {
        result = await this.workingDirectoryValidator(pathValue);
      } catch {
        result = { code: 'unavailable' };
      }

      if (validationRunId !== this.workingDirectoryValidationRunId) {
        return false;
      }

      const invalidMessage = this.validationMessageForResult(result, t);
      this.applyWorkingDirectoryValidationState(input, invalidMessage, invalidMessage || emptyHint);
      valid = valid && !invalidMessage;
    }

    if (validationRunId === this.workingDirectoryValidationRunId) {
      this.saveBtn.disabled = !valid;
    }
    return valid;
  }

  private focusFirstInvalidWorkingDirectory(): void {
    const invalidInput = this.workingDirectoryInputs().find((input) => Boolean(input.validationMessage));
    if (!invalidInput) {
      return;
    }
    invalidInput.focus();
    invalidInput.reportValidity();
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
    this.workspaceDefaultAgent.value = this.currentContext.workspaceDefaultAgentType ?? 'claude';
    this.shellWorkingDir.value = this.currentContext.shellWorkingDirectory ?? '';

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
    void this.updateWorkingDirectoryValidation();
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
        ? t.configClaudePromptDisabledTransport
        : t.configCodexPromptDisabledTransport;
      previewEl.textContent = t.configPromptInjectionDisabled;
      return;
    }

    transportEl.textContent = agent === 'claude'
      ? t.configClaudePromptTransport
      : t.configCodexPromptTransport;
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

  private async save(): Promise<void> {
    if (!await this.updateWorkingDirectoryValidation()) {
      this.focusFirstInvalidWorkingDirectory();
      return;
    }

    const config = this.getConfig();
    if (this.onSaveCallback) {
      const workspaceDefaultAgentType = this.currentContext.scope === 'defaults' && this.currentContext.workspaceId
        ? this.workspaceDefaultAgent.value as AgentType
        : null;
      const shellWorkingDirectory = this.currentContext.scope === 'defaults'
        ? this.shellWorkingDir.value.trim()
        : null;
      this.onSaveCallback(config, this.currentContext, workspaceDefaultAgentType, shellWorkingDirectory);
    }
    this.hide();
  }

  private reset(): void {
    this.loadConfig(this.resetConfig);
    this.workspaceDefaultAgent.value = this.resetWorkspaceDefaultAgentType;
    this.shellWorkingDir.value = this.resetShellWorkingDirectory;
    void this.updateWorkingDirectoryValidation();
  }
}
