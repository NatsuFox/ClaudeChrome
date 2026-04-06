import type { AgentLaunchConfig, AgentStartupOptions } from '../shared/types';

export class ConfigPanel {
  private overlay: HTMLElement;
  private closeBtn: HTMLElement;
  private saveBtn: HTMLElement;
  private resetBtn: HTMLElement;
  private tabs: NodeListOf<HTMLElement>;
  private tabContents: NodeListOf<HTMLElement>;

  private claudeLaunchArgs: HTMLInputElement;
  private claudeWorkingDir: HTMLInputElement;
  private claudePromptMode: HTMLSelectElement;
  private claudeCustomPrompt: HTMLTextAreaElement;
  private claudeCustomPromptField: HTMLElement;

  private codexLaunchArgs: HTMLInputElement;
  private codexWorkingDir: HTMLInputElement;
  private codexPromptMode: HTMLSelectElement;
  private codexCustomPrompt: HTMLTextAreaElement;
  private codexCustomPromptField: HTMLElement;

  private onSaveCallback: ((config: AgentLaunchConfig) => void) | null = null;

  constructor() {
    this.overlay = document.getElementById('config-panel-overlay')!;
    this.closeBtn = document.getElementById('config-close')!;
    this.saveBtn = document.getElementById('config-save')!;
    this.resetBtn = document.getElementById('config-reset')!;
    this.tabs = document.querySelectorAll('.config-tab');
    this.tabContents = document.querySelectorAll('.config-tab-content');

    this.claudeLaunchArgs = document.getElementById('claude-launch-args') as HTMLInputElement;
    this.claudeWorkingDir = document.getElementById('claude-working-dir') as HTMLInputElement;
    this.claudePromptMode = document.getElementById('claude-prompt-mode') as HTMLSelectElement;
    this.claudeCustomPrompt = document.getElementById('claude-custom-prompt') as HTMLTextAreaElement;
    this.claudeCustomPromptField = document.getElementById('claude-custom-prompt-field')!;

    this.codexLaunchArgs = document.getElementById('codex-launch-args') as HTMLInputElement;
    this.codexWorkingDir = document.getElementById('codex-working-dir') as HTMLInputElement;
    this.codexPromptMode = document.getElementById('codex-prompt-mode') as HTMLSelectElement;
    this.codexCustomPrompt = document.getElementById('codex-custom-prompt') as HTMLTextAreaElement;
    this.codexCustomPromptField = document.getElementById('codex-custom-prompt-field')!;

    this.bindEvents();
  }

  private bindEvents(): void {
    this.closeBtn.addEventListener('click', () => this.hide());
    this.saveBtn.addEventListener('click', () => this.save());
    this.resetBtn.addEventListener('click', () => this.reset());

    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) {
        this.hide();
      }
    });

    this.tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const targetTab = tab.getAttribute('data-tab');
        this.switchTab(targetTab!);
      });
    });

    this.claudePromptMode.addEventListener('change', () => {
      this.toggleCustomPromptField('claude');
    });

    this.codexPromptMode.addEventListener('change', () => {
      this.toggleCustomPromptField('codex');
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

  private toggleCustomPromptField(agent: 'claude' | 'codex'): void {
    const mode = agent === 'claude' ? this.claudePromptMode.value : this.codexPromptMode.value;
    const field = agent === 'claude' ? this.claudeCustomPromptField : this.codexCustomPromptField;
    field.style.display = mode === 'custom' ? 'block' : 'none';
  }

  public show(config: AgentLaunchConfig): void {
    this.loadConfig(config);
    this.overlay.style.display = 'flex';
  }

  public hide(): void {
    this.overlay.style.display = 'none';
  }

  public onSave(callback: (config: AgentLaunchConfig) => void): void {
    this.onSaveCallback = callback;
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

  private save(): void {
    const config = this.getConfig();
    if (this.onSaveCallback) {
      this.onSaveCallback(config);
    }
    this.hide();
  }

  private reset(): void {
    const defaultConfig: AgentLaunchConfig = {
      claude: {
        launchArgs: '',
        workingDirectory: '',
        systemPromptMode: 'default',
        customSystemPrompt: '',
      },
      codex: {
        launchArgs: '-a never -s workspace-write',
        workingDirectory: '',
        systemPromptMode: 'default',
        customSystemPrompt: '',
      },
    };

    this.loadConfig(defaultConfig);
  }
}
