import { ChunkAssembler } from '../shared/chunker';
import type {
  ActivateTabResultMessage,
  AgentLaunchConfig,
  AgentStartupOptions,
  AgentType,
  AgentChatCancelMessage,
  AgentChatRequestMessage,
  AgentChatUpdateMessage,
  CollapseSidePanelResultMessage,
  GetCurrentWindowActiveTabResultMessage,
  LaunchConfigAgentType,
  SessionBindTabMessage,
  SessionCreateMessage,
  SessionInputMessage,
  SessionOutputMessage,
  SessionResizeMessage,
  SessionRestartMessage,
  PanelStateFileLoadResultMessage,
  SessionSnapshot,
  SessionSnapshotMessage,
  StatusMessage,
  WorkingDirectoryValidateResultMessage,
  WorkingDirectoryValidationCode,
} from '../shared/types';
import {
  cloneLaunchConfig,
  createDefaultState,
  createOverrideLaunchConfig,
  createPane,
  createStartupOptions,
  createWorkspace,
  DEFAULT_CODEX_LAUNCH_ARGS,
  defaultAgentViewMode,
  defaultAgentViewModeForState,
  ensureValidState,
  getPane,
  getPanesForWorkspace,
  getWorkspace,
  hasExplicitStartupOptions,
  normalizeWorkspacePaneRatios,
  removePane,
  removeWorkspace,
  normalizeAgentViewMode,
  normalizePanelPageId,
  startupOptionsEqual,
  type AgentViewMode,
  type ChatAgentType,
  type PaneLayout,
  type PanelPageId,
  type PanelLanguage,
  type PanelTheme,
  type PersistedPanelState,
} from './state';
import { decodeBase64ToBytes, encodeUtf8ToBase64 } from '../shared/base64';
import { TerminalView } from './terminal-view';
import { AgentChatView } from './agent-chat-view';
import { ConfigPanel } from './config-panel';
import { formatPanelMessage, getPanelLocale, type PanelLocaleText } from './lexicon';

const DEFAULT_WS_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = '9999';
const PANEL_STATE_STORAGE_KEY = 'panelStateV2';
const WS_PORT_STORAGE_KEY = 'wsPort';
const CAPTURE_SETTINGS_STORAGE_KEY = 'ccCaptureSettings';
const MAX_PANES_PER_WORKSPACE = 6;
const MIN_PANE_RATIO = 0.14;
const MIN_RAIL_WIDTH = 178;
const MAX_RAIL_WIDTH = 320;
const RAIL_AUTO_COLLAPSE_WIDTH = 56;
const PANEL_AUTO_COLLAPSE_WIDTH = 72;
const PANEL_AUTO_COLLAPSE_ARM_WIDTH = 144;
const PANEL_STATE_FILE_LOAD_TIMEOUT_MS = 3000;

const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const focusedBinding = document.getElementById('focused-binding')!;
const activityBar = document.getElementById('activity-bar')!;
const pageStage = document.getElementById('page-stage')!;
const workspacePage = document.getElementById('workspace-page')!;
const settingsPage = document.getElementById('settings-page')!;
const pluginsPage = document.getElementById('plugins-page')!;
const workspaceStage = document.getElementById('workspace-stage')!;
const workspaceRailResizer = document.getElementById('workspace-rail-resizer')!;
const workspaceRail = document.getElementById('workspace-rail')!;
const workspaceRailEdgeToggle = document.getElementById('workspace-rail-edge-toggle') as HTMLButtonElement;
const portInput = document.getElementById('ws-port') as HTMLInputElement;
const btnApplyPort = document.getElementById('btn-apply-port')!;
const btnReconnect = document.getElementById('btn-reconnect')!;
const btnLaunchDefaults = document.getElementById('btn-launch-defaults')!;
const btnToggleBodyCapture = document.getElementById('btn-toggle-body-capture') as HTMLButtonElement;
const btnAddShellPane = document.getElementById('btn-add-shell-pane')!;
const btnAddClaudePane = document.getElementById('btn-add-claude-pane')!;
const btnAddCodexPane = document.getElementById('btn-add-codex-pane')!;
const btnLanguageToggle = document.getElementById('btn-language-toggle') as HTMLButtonElement;
const btnThemeToggle = document.getElementById('btn-theme-toggle') as HTMLButtonElement;
const btnTogglePanel = document.getElementById('btn-toggle-panel') as HTMLButtonElement;
const toolbarBrandLogo = document.querySelector<HTMLImageElement>('.toolbar-brand-logo');
const toolbarBrandName = document.querySelector<HTMLElement>('.toolbar-brand-name');

const chunkAssembler = new ChunkAssembler();
const terminalViews = new Map<string, TerminalView>();
const agentChatViews = new Map<string, AgentChatView>();
const sessionSnapshots = new Map<string, SessionSnapshot>();
const terminalOutputDecoders = new Map<string, TextDecoder>();
const pendingSessionCreates = new Set<string>();
const pendingWorkingDirectoryValidations = new Map<string, PendingWorkingDirectoryValidation>();
const pendingPanelStateFileLoads = new Map<string, PendingPanelStateFileLoad>();
const configPanel = new ConfigPanel();

const ICONS = {
  shell: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 8 4 4-4 4"></path><path d="M12 17h6"></path></svg>',
  claude: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5 19.5 8v8L12 20.5 4.5 16V8L12 3.5Z"></path><path d="M12 8v8"></path><path d="m8 10.2 4-2.2 4 2.2"></path><path d="m8 13.8 4 2.2 4-2.2"></path></svg>',
  codex: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 9 4.5 12 8 15"></path><path d="m16 9 3.5 3-3.5 3"></path><path d="m13.5 6-3 12"></path></svg>',
  panelClose: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M16 5v14"></path><path d="m9 9-3 3 3 3"></path></svg>',
  reconnect: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"></path><path d="M4 18v-5h5"></path><path d="M18.2 9A7 7 0 0 0 6.4 6.7L4 9"></path><path d="M5.8 15A7 7 0 0 0 17.6 17.3L20 15"></path></svg>',
  apply: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5 10 17 19 7"></path></svg>',
  debug: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8h8v8a4 4 0 0 1-8 0V8Z"></path><path d="M9 4h6"></path><path d="M12 4v4"></path><path d="M4 13h4"></path><path d="M16 13h4"></path><path d="M6 20l2-2"></path><path d="m18 20-2-2"></path></svg>',
  settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.03.03a2.1 2.1 0 0 1-2.97 2.97l-.03-.03a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21.3a2.1 2.1 0 0 1-4.2 0v-.05a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.03.03a2.1 2.1 0 0 1-2.97-2.97l.03-.03A1.8 1.8 0 0 0 3.8 15a1.8 1.8 0 0 0-1.66-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.05A1.8 1.8 0 0 0 3.8 8.6a1.8 1.8 0 0 0-.36-1.98l-.03-.03a2.1 2.1 0 1 1 2.97-2.97l.03.03a1.8 1.8 0 0 0 1.98.36 1.8 1.8 0 0 0 1.1-1.66V2.3a2.1 2.1 0 0 1 4.2 0v.05a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.03-.03a2.1 2.1 0 1 1 2.97 2.97l-.03.03a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.66 1.1h.05a2.1 2.1 0 0 1 0 4.2h-.05A1.8 1.8 0 0 0 19.4 15Z"></path></svg>',
  palette: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4a8 8 0 0 0 0 16h1.3a1.7 1.7 0 0 0 1.2-2.9l-.2-.2a1.7 1.7 0 0 1 1.2-2.9H17a3 3 0 0 0 3-3c0-3.9-3.6-7-8-7Z"></path><path d="M7.8 11h.01"></path><path d="M10.2 7.8h.01"></path><path d="M14 8h.01"></path></svg>',
  language: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h9"></path><path d="M9 3v2"></path><path d="M5.5 17.5 11 7"></path><path d="M4 9h8"></path><path d="M13 19l3.5-8 3.5 8"></path><path d="M14.5 16h4"></path></svg>',
  workspace: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="M8 5v14"></path><path d="m15 9 3 3-3 3"></path></svg>',
  add: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
  rename: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3Z"></path><path d="m14 8 3 3"></path></svg>',
  collapse: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4v16"></path><path d="m14 8-4 4 4 4"></path><path d="M5 12h5"></path></svg>',
  tab: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v14H5z"></path><path d="m10 9 5 3-5 3V9Z"></path></svg>',
  bind: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.1 0l1.4-1.4a5 5 0 0 0-7.1-7.1L10.6 5.3"></path><path d="M14 11a5 5 0 0 0-7.1 0l-1.4 1.4a5 5 0 1 0 7.1 7.1l.8-.8"></path></svg>',
  restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6v5h-5"></path><path d="M18.5 15.5A7 7 0 1 1 19.8 9"></path></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"></path><path d="M18 6 6 18"></path></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 6h14v10H8l-3 3V6Z"></path><path d="M8 10h8"></path><path d="M8 13h5"></path></svg>',
  terminal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v14H4z"></path><path d="m8 9 3 3-3 3"></path><path d="M13 15h4"></path></svg>',
} as const;

function setIconButton(button: HTMLElement, icon: string, label: string, className?: string): void {
  button.innerHTML = icon;
  const accessibleLabel = document.createElement('span');
  accessibleLabel.className = 'visually-hidden';
  accessibleLabel.textContent = label;
  button.appendChild(accessibleLabel);
  button.setAttribute('aria-label', label);
  button.title = label;
  if (className) {
    button.classList.add(className);
  }
}

function setIconTextButton(button: HTMLElement, icon: string, text: string): void {
  button.classList.add('icon-text-button');
  button.innerHTML = icon;
  const label = document.createElement('span');
  label.className = 'icon-text-button-label';
  label.textContent = text;
  button.appendChild(label);
}

type LocalizableStatusSource = 'custom' | 'connection';
type WorkingDirectoryValidationResult = {
  code: WorkingDirectoryValidationCode;
  normalizedPath?: string;
  message?: string;
};

type PendingWorkingDirectoryValidation = {
  resolve: (result: WorkingDirectoryValidationResult) => void;
  timer: ReturnType<typeof setTimeout>;
};

type PendingPanelStateFileLoad = {
  resolve: (result: { found: boolean; state?: unknown; path?: string; error?: string }) => void;
  timer: ReturnType<typeof setTimeout>;
};

let panelState = createDefaultState(DEFAULT_WS_PORT);
let activePaneId: string | null = null;
let ws: WebSocket | null = null;
let lastViewportWidth = window.innerWidth;
type CaptureSettings = {
  captureResponseBodies: boolean;
};

let panelAutoCollapseArmed = window.innerWidth >= PANEL_AUTO_COLLAPSE_ARM_WIDTH;
let panelCloseInFlight = false;
let connectionStatusState: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let connectionStatusUrl: string | null = null;
let captureSettings: CaptureSettings = { captureResponseBodies: false };
let loadedPersistedPanelState = false;
let hadStoredPanelState = false;

type PanelPageDefinition = {
  id: PanelPageId;
  label: keyof PanelLocaleText;
  icon: string;
};

const PANEL_PAGES: PanelPageDefinition[] = [
  {
    id: 'workspace',
    label: 'activityWorkspace',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="7" height="7" rx="1.5"></rect><rect x="14" y="4" width="7" height="7" rx="1.5"></rect><rect x="3" y="15" width="7" height="5" rx="1.5"></rect><rect x="14" y="15" width="7" height="5" rx="1.5"></rect></svg>',
  },
  {
    id: 'settings',
    label: 'activitySettings',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"></path><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.03.03a2.1 2.1 0 0 1-2.97 2.97l-.03-.03a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21.3a2.1 2.1 0 0 1-4.2 0v-.05a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.03.03a2.1 2.1 0 0 1-2.97-2.97l.03-.03A1.8 1.8 0 0 0 3.8 15a1.8 1.8 0 0 0-1.66-1.1H2.1a2.1 2.1 0 0 1 0-4.2h.05A1.8 1.8 0 0 0 3.8 8.6a1.8 1.8 0 0 0-.36-1.98l-.03-.03a2.1 2.1 0 1 1 2.97-2.97l.03.03a1.8 1.8 0 0 0 1.98.36 1.8 1.8 0 0 0 1.1-1.66V2.3a2.1 2.1 0 0 1 4.2 0v.05a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.03-.03a2.1 2.1 0 1 1 2.97 2.97l-.03.03a1.8 1.8 0 0 0-.36 1.98 1.8 1.8 0 0 0 1.66 1.1h.05a2.1 2.1 0 0 1 0 4.2h-.05A1.8 1.8 0 0 0 19.4 15Z"></path></svg>',
  },
  {
    id: 'plugins',
    label: 'activityPlugins',
    icon: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 3v4"></path><path d="M16 3v4"></path><path d="M7 7h10v5a5 5 0 0 1-10 0V7Z"></path><path d="M12 17v4"></path><path d="M9 21h6"></path></svg>',
  },
];

function currentTranslations(): PanelLocaleText {
  return getPanelLocale(panelState.language);
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return formatPanelMessage(template, values);
}

function agentLabel(agentType: AgentType): string {
  const t = currentTranslations();
  switch (agentType) {
    case 'codex':
      return t.agentLabelCodex;
    case 'shell':
      return t.agentLabelShell;
    default:
      return t.agentLabelClaude;
  }
}

function connectionStateLabel(state: 'connected' | 'disconnected' | 'connecting' | 'error'): string {
  const t = currentTranslations();
  switch (state) {
    case 'connected':
      return t.statusConnected;
    case 'connecting':
      return t.statusConnecting;
    case 'error':
      return t.statusError;
    default:
      return t.statusDisconnected;
  }
}

function launchConfigAgentType(agentType: AgentType): LaunchConfigAgentType | null {
  if (agentType === 'claude' || agentType === 'codex') {
    return agentType;
  }
  return null;
}

function supportsBuiltInChat(agentType: AgentType): boolean {
  return agentType === 'claude' || agentType === 'codex';
}

function agentTypeForSession(sessionId: string): AgentType | undefined {
  return sessionSnapshots.get(sessionId)?.agentType
    ?? panelState.panes.find((pane) => pane.sessionId === sessionId)?.agentType;
}

function decodeSessionOutputText(sessionId: string, data: string, reset = false): string {
  try {
    if (reset) {
      terminalOutputDecoders.delete(sessionId);
    }
    let decoder = terminalOutputDecoders.get(sessionId);
    if (!decoder) {
      decoder = new TextDecoder();
      terminalOutputDecoders.set(sessionId, decoder);
    }
    return decoder.decode(decodeBase64ToBytes(data), { stream: true });
  } catch {
    return '';
  }
}

function getDefaultViewMode(agentType: AgentType): AgentViewMode {
  if (agentType === 'claude') {
    return panelState.claudeDefaultViewMode;
  }
  if (agentType === 'codex') {
    return panelState.codexDefaultViewMode;
  }
  return 'terminal';
}

function setDefaultViewMode(agentType: AgentType, mode: AgentViewMode): void {
  if (agentType === 'claude') {
    panelState.claudeDefaultViewMode = mode;
  } else if (agentType === 'codex') {
    panelState.codexDefaultViewMode = mode;
  }
}

function paneUsesStartupOverrides(pane: PaneLayout, launchAgent: LaunchConfigAgentType): boolean {
  return hasExplicitStartupOptions(pane.launchOverrides[launchAgent]);
}

function getEffectiveStartupOptions(
  pane: PaneLayout,
  agentType: AgentType = pane.agentType,
): AgentStartupOptions | null {
  if (agentType === 'shell') {
    return {
      ...createStartupOptions(),
      workingDirectory: panelState.shellWorkingDirectory.trim(),
    };
  }

  const launchAgent = launchConfigAgentType(agentType);
  if (!launchAgent) {
    return null;
  }

  if (paneUsesStartupOverrides(pane, launchAgent)) {
    return { ...pane.launchOverrides[launchAgent] };
  }

  const defaults = panelState.launchDefaults[launchAgent];
  return {
    ...defaults,
    launchArgs: defaults.launchArgs.trim() || (launchAgent === 'codex' ? DEFAULT_CODEX_LAUNCH_ARGS : ''),
  };
}

function normalizeTheme(theme: unknown): PanelTheme {
  return theme === 'light' ? 'light' : 'dark';
}

function normalizeLanguage(language: unknown): PanelLanguage {
  return language === 'en' ? 'en' : 'zh';
}


function themeLabel(theme: PanelTheme): string {
  const t = currentTranslations();
  return theme === 'light' ? t.themeLightLabel : t.themeDarkLabel;
}

function languageLabel(language: PanelLanguage): string {
  const t = currentTranslations();
  return language === 'zh' ? t.languageLabelZh : t.languageLabelEn;
}

function localizeWorkspaceTitle(title: string): string {
  const t = currentTranslations();
  const workspaceMatch = /^(?:工作区|Workspace) (\d+)$/.exec(title);
  if (workspaceMatch) {
    return formatMessage(t.workspaceTitle, { index: workspaceMatch[1] });
  }

  const restoredMatch = /^(?:恢复工作区|Restored Workspace) (\d+)$/.exec(title);
  if (restoredMatch) {
    return formatMessage(t.restoredWorkspaceTitle, { index: restoredMatch[1] });
  }

  return title;
}

function localizeWorkspaceHint(hint: string): string {
  const t = currentTranslations();
  if (
    hint === '关联当前标签页' ||
    hint === 'Focused browser tab binding' ||
    hint === 'Linked to current tab'
  ) {
    return t.workspaceHintFocusedTab;
  }
  if (hint === '从主机恢复' || hint === 'Recovered from host') {
    return t.workspaceHintRecovered;
  }
  return hint;
}

function localizePaneTitle(title: string): string {
  const match = /^(Claude|Codex|终端|Shell) (\d+)$/.exec(title);
  if (!match) {
    return title;
  }

  const agentType: AgentType = match[1] === 'Claude'
    ? 'claude'
    : match[1] === 'Codex'
      ? 'codex'
      : 'shell';
  return `${agentLabel(agentType)} ${match[2]}`;
}

function localizeStatusMessage(
  state: 'connected' | 'disconnected' | 'connecting' | 'error',
  source: LocalizableStatusSource,
  customMessage?: string,
): string {
  if (source === 'custom' && customMessage) {
    return customMessage;
  }

  const t = currentTranslations();
  switch (state) {
    case 'connecting':
      return connectionStatusUrl ? formatMessage(t.statusConnectingTo, { url: connectionStatusUrl }) : t.statusConnecting;
    case 'connected':
      return connectionStatusUrl ? formatMessage(t.statusConnectedTo, { url: connectionStatusUrl }) : t.statusConnected;
    case 'error':
      return connectionStatusUrl ? formatMessage(t.errorCannotConnectTo, { url: connectionStatusUrl }) : t.statusError;
    default:
      return t.statusDisconnected;
  }
}

function updateUILanguage(): void {
  const t = currentTranslations();
  document.title = t.metaTitle;
  document.documentElement.lang = panelState.language;
  if (toolbarBrandLogo) {
    toolbarBrandLogo.alt = t.brandLogoAlt;
  }
  if (toolbarBrandName) {
    toolbarBrandName.textContent = t.brandName;
  }

  const statusSource = (statusText.dataset.statusSource as LocalizableStatusSource | undefined) || 'custom';
  if (statusSource === 'connection') {
    statusText.textContent = localizeStatusMessage(connectionStatusState, statusSource);
  }

  if (focusedBinding.textContent === '未选中面板' || focusedBinding.textContent === 'No Pane Selected') {
    focusedBinding.textContent = t.noFocusedPane;
  }

  const portLabel = document.getElementById('ws-port-label');
  if (portLabel) portLabel.textContent = t.portLabel;

  setIconButton(btnApplyPort, ICONS.apply, t.applyPortTitle);
  setIconButton(btnReconnect, ICONS.reconnect, t.reconnectTitle);
  btnLaunchDefaults.textContent = t.settingsOpenDefaults;
  btnLaunchDefaults.title = t.launchDefaultsTitle;
  setIconButton(btnAddShellPane, ICONS.shell, t.addShellTitle);
  setIconButton(btnAddClaudePane, ICONS.claude, t.addClaudeTitle);
  setIconButton(btnAddCodexPane, ICONS.codex, t.addCodexTitle);
  setIconButton(btnTogglePanel, ICONS.panelClose, t.closePanelTitle);

  const workspaceToggle = document.getElementById('workspace-rail-edge-toggle');
  if (workspaceToggle) {
    setIconButton(
      workspaceToggle,
      ICONS.workspace,
      panelState.railCollapsed ? t.workspaceCollapsedTitle : t.workspaceExpandedTitle,
    );
  }

  configPanel.setLanguage(panelState.language);
}

function updateThemeToggleButton(): void {
  const t = currentTranslations();
  const currentTheme = panelState.theme;
  const themeText = themeLabel(currentTheme);
  setIconTextButton(btnThemeToggle, ICONS.palette, themeText);
  btnThemeToggle.title = formatMessage(t.currentThemeTitle, { theme: themeText });
  btnThemeToggle.setAttribute('aria-label', btnThemeToggle.title);
}

function applyTheme(): void {
  const theme = normalizeTheme(panelState.theme);
  panelState.theme = theme;
  document.documentElement.classList.toggle('theme-light', theme === 'light');
  document.documentElement.classList.toggle('theme-dark', theme === 'dark');
  document.documentElement.style.colorScheme = theme;
  updateThemeToggleButton();
  terminalViews.forEach((view) => view.setTheme(theme));
}

async function setTheme(theme: PanelTheme): Promise<void> {
  const nextTheme = normalizeTheme(theme);
  if (panelState.theme === nextTheme) {
    applyTheme();
    return;
  }

  panelState.theme = nextTheme;
  applyTheme();
  await saveState();
}

function toggleTheme(): void {
  void setTheme(panelState.theme === 'light' ? 'dark' : 'light');
}

function updateLanguageToggleButton(): void {
  const t = currentTranslations();
  const currentLanguage = panelState.language;
  const languageText = languageLabel(currentLanguage);
  setIconTextButton(btnLanguageToggle, ICONS.language, languageText);
  btnLanguageToggle.title = formatMessage(t.currentLanguageTitle, { language: languageText });
  btnLanguageToggle.setAttribute('aria-label', btnLanguageToggle.title);
}

async function setLanguage(language: PanelLanguage): Promise<void> {
  if (panelState.language === language) {
    render();
    return;
  }

  panelState.language = language;
  render();
  await saveState();
}

function toggleLanguage(): void {
  void setLanguage(panelState.language === 'zh' ? 'en' : 'zh');
}

function normalizeCaptureSettings(value: unknown): CaptureSettings {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<CaptureSettings>;
    return {
      captureResponseBodies: candidate.captureResponseBodies === true,
    };
  }
  return { captureResponseBodies: false };
}

function updateCaptureToggleButton(): void {
  const t = currentTranslations();
  const enabled = captureSettings.captureResponseBodies;
  setIconTextButton(btnToggleBodyCapture, ICONS.debug, enabled ? t.captureToggleOn : t.captureToggleOff);
  btnToggleBodyCapture.title = enabled
    ? t.captureEnabledTitle
    : t.captureDisabledTitle;
  btnToggleBodyCapture.setAttribute('aria-label', btnToggleBodyCapture.title);
  btnToggleBodyCapture.setAttribute('aria-pressed', String(enabled));
  btnToggleBodyCapture.classList.toggle('capture-enabled', enabled);
}

function setActivePage(pageId: PanelPageId): void {
  const normalized = normalizePanelPageId(pageId);
  if (panelState.activePageId === normalized) {
    return;
  }
  panelState.activePageId = normalized;
  void saveState();
  render();
}

function applyActivePageState(): void {
  panelState.activePageId = normalizePanelPageId(panelState.activePageId);
  document.body.classList.toggle('page-workspace', panelState.activePageId === 'workspace');
  workspacePage.classList.toggle('active', panelState.activePageId === 'workspace');
  settingsPage.classList.toggle('active', panelState.activePageId === 'settings');
  pluginsPage.classList.toggle('active', panelState.activePageId === 'plugins');
}

function renderActivityBar(): void {
  const t = currentTranslations();
  activityBar.replaceChildren();
  PANEL_PAGES.forEach((page) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `activity-button${panelState.activePageId === page.id ? ' active' : ''}`;
    button.title = t[page.label] as string;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-current', panelState.activePageId === page.id ? 'page' : 'false');
      button.innerHTML = page.icon;
      const tooltip = document.createElement('span');
      tooltip.className = 'visually-hidden';
      tooltip.textContent = button.title;
      button.appendChild(tooltip);
      button.addEventListener('click', () => setActivePage(page.id));
    activityBar.appendChild(button);
  });
}

function appendSubpageText(parent: HTMLElement, tagName: keyof HTMLElementTagNameMap, className: string, text: string): HTMLElement {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  parent.appendChild(element);
  return element;
}

function appendSettingsCard(grid: HTMLElement, title: string, body: string): HTMLElement {
  const card = document.createElement('section');
  card.className = 'subpage-card settings-card';
  appendSubpageText(card, 'h3', 'subpage-card-title', title);
  appendSubpageText(card, 'p', 'subpage-card-body', body);
  grid.appendChild(card);
  return card;
}

function appendControlRow(parent: HTMLElement, className = 'settings-control-row'): HTMLElement {
  const row = document.createElement('div');
  row.className = className;
  parent.appendChild(row);
  return row;
}

function createAgentDefaultModeToggle(agentType: 'claude' | 'codex'): HTMLButtonElement {
  const t = currentTranslations();
  const mode = getDefaultViewMode(agentType);
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'settings-agent-mode-toggle';
  button.textContent = `${agentLabel(agentType)} · ${mode === 'chat' ? t.agentViewBuiltIn : t.agentViewTerminal}`;
  button.title = mode === 'chat'
    ? formatMessage(t.agentModeTerminalTitle, { agent: agentLabel(agentType) })
    : formatMessage(t.agentModeBuiltInTitle, { agent: agentLabel(agentType) });
  button.setAttribute('aria-pressed', String(mode === 'chat'));
  button.addEventListener('click', () => {
    setDefaultViewMode(agentType, mode === 'chat' ? 'terminal' : 'chat');
    void saveState();
    render();
  });
  return button;
}

function renderSettingsPage(): void {
  const t = currentTranslations();
  settingsPage.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'subpage-shell settings-subpage';

  const header = document.createElement('div');
  header.className = 'subpage-header';
  const heading = document.createElement('div');
  appendSubpageText(heading, 'h2', 'subpage-title', t.settingsPageTitle);
  appendSubpageText(heading, 'p', 'subpage-description', t.settingsPageDescription);
  header.appendChild(heading);
  shell.appendChild(header);

  const grid = document.createElement('div');
  grid.className = 'subpage-grid';

  const agents = appendSettingsCard(grid, t.settingsAgentTitle, t.settingsAgentBody);
  const agentActions = appendControlRow(agents, 'settings-wide-control-row');
  btnLaunchDefaults.textContent = t.settingsOpenDefaults;
  btnLaunchDefaults.title = t.launchDefaultsTitle;
  agentActions.appendChild(btnLaunchDefaults);
  agentActions.appendChild(createAgentDefaultModeToggle('claude'));
  agentActions.appendChild(createAgentDefaultModeToggle('codex'));

  const appearance = appendSettingsCard(grid, t.settingsAppearanceTitle, t.settingsAppearanceBody);
  const appearanceActions = appendControlRow(appearance, 'settings-wide-control-row');
  appearanceActions.appendChild(btnToggleBodyCapture);
  appearanceActions.appendChild(btnLanguageToggle);
  appearanceActions.appendChild(btnThemeToggle);

  shell.appendChild(grid);
  settingsPage.appendChild(shell);
}

function renderPluginsPage(): void {
  const t = currentTranslations();
  pluginsPage.replaceChildren();

  const shell = document.createElement('div');
  shell.className = 'subpage-shell plugins-subpage';
  const header = document.createElement('div');
  header.className = 'subpage-header';
  const heading = document.createElement('div');
  appendSubpageText(heading, 'h2', 'subpage-title', t.pluginsPageTitle);
  appendSubpageText(heading, 'p', 'subpage-description', t.pluginsPageDescription);
  header.appendChild(heading);
  shell.appendChild(header);

  const placeholder = document.createElement('section');
  placeholder.className = 'subpage-card';
  appendSubpageText(placeholder, 'h3', 'subpage-card-title', t.pluginsPagePlaceholderTitle);
  appendSubpageText(placeholder, 'p', 'subpage-card-body', t.pluginsPagePlaceholderBody);
  shell.appendChild(placeholder);
  pluginsPage.appendChild(shell);
}

async function saveCaptureSettings(): Promise<void> {
  await storageSet({
    [CAPTURE_SETTINGS_STORAGE_KEY]: captureSettings,
  });
}

async function setCaptureResponseBodies(enabled: boolean): Promise<void> {
  if (captureSettings.captureResponseBodies === enabled) {
    updateCaptureToggleButton();
    return;
  }

  captureSettings = { captureResponseBodies: enabled };
  updateCaptureToggleButton();
  await saveCaptureSettings();
  const t = currentTranslations();
  setStatus(isWsOpen() ? 'connected' : 'disconnected', enabled ? t.captureEnabledStatus : t.captureDisabledStatus);
}

function toggleCaptureResponseBodies(): void {
  void setCaptureResponseBodies(!captureSettings.captureResponseBodies);
}

function setStatus(
  state: 'connected' | 'disconnected' | 'connecting' | 'error',
  message?: string,
  source: LocalizableStatusSource = 'custom',
): void {
  statusIndicator.className = state === 'error' ? 'disconnected' : state;
  statusText.dataset.statusSource = source;
  statusText.textContent = localizeStatusMessage(state, source, message || connectionStateLabel(state));
}

function setConnectionStatus(state: 'connected' | 'disconnected' | 'connecting' | 'error', url: string | null = null): void {
  connectionStatusState = state;
  connectionStatusUrl = url;
  setStatus(state, undefined, 'connection');
}

function normalizePort(raw: string): string | null {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    return null;
  }
  return String(value);
}

function getConfiguredWsUrl(): string | null {
  const port = normalizePort(portInput.value);
  return port ? `ws://${DEFAULT_WS_HOST}:${port}` : null;
}

function isWsOpen(): boolean {
  return Boolean(ws && ws.readyState === WebSocket.OPEN);
}

function clampRailWidth(width: number): number {
  return Math.max(MIN_RAIL_WIDTH, Math.min(MAX_RAIL_WIDTH, Math.round(width)));
}

function applyRailWidth(): void {
  document.documentElement.style.setProperty('--rail-width', `${clampRailWidth(panelState.railWidth)}px`);
}

function applyLayoutState(): void {
  const t = currentTranslations();
  applyActivePageState();
  document.body.classList.remove('panel-collapsed');
  document.body.classList.toggle('rail-collapsed', panelState.railCollapsed);

  setIconButton(btnTogglePanel, ICONS.panelClose, t.closePanelTitle);

  setIconButton(
    workspaceRailEdgeToggle,
    ICONS.workspace,
    panelState.railCollapsed ? t.workspaceCollapsedTitle : t.workspaceExpandedTitle,
  );
  workspaceRailEdgeToggle.setAttribute('aria-expanded', String(!panelState.railCollapsed));
}

function storageGet<T extends Record<string, unknown>>(defaults: T): Promise<T> {
  return new Promise((resolve) => {
    chrome.storage.local.get(defaults, (items) => resolve(items as T));
  });
}

function storageSet(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(items, () => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve();
    });
  });
}

function runtimeMessage<T>(message: object): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) {
        reject(new Error(error.message));
        return;
      }
      resolve(response as T);
    });
  });
}

function notifyPanelOpened(): void {
  chrome.runtime.sendMessage({ type: 'panel_opened' }, () => void chrome.runtime.lastError);
}

function notifyPanelClosed(): void {
  chrome.runtime.sendMessage({ type: 'panel_closed' }, () => void chrome.runtime.lastError);
}

function handlePanelUnload(): void {
  notifyPanelClosed();
}

function updateActivePaneSelection(): void {
  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  activePaneId = activeWorkspace?.paneIds[0] || panelState.panes[0]?.paneId || null;
}

function applyPersistedPanelState(nextState: PersistedPanelState): void {
  panelState = ensureValidState(nextState, portInput.value);
  panelState.theme = normalizeTheme(panelState.theme);
  panelState.language = normalizeLanguage(panelState.language);
  panelState.wsPort = portInput.value;
  panelState.railWidth = clampRailWidth(panelState.railWidth);
  panelState.panelCollapsed = false;
  updateActivePaneSelection();
}

async function loadState(): Promise<void> {
  const stored = await storageGet<Record<string, unknown | null>>({
    [PANEL_STATE_STORAGE_KEY]: null,
    [WS_PORT_STORAGE_KEY]: DEFAULT_WS_PORT,
    [CAPTURE_SETTINGS_STORAGE_KEY]: { captureResponseBodies: false },
  });

  const legacyPort = String(stored[WS_PORT_STORAGE_KEY] ?? DEFAULT_WS_PORT);
  const legacyTheme = localStorage.getItem('ccTheme');
  portInput.value = normalizePort(legacyPort) ?? DEFAULT_WS_PORT;

  const rawState = stored[PANEL_STATE_STORAGE_KEY] as PersistedPanelState | null;
  hadStoredPanelState = Boolean(rawState);
  loadedPersistedPanelState = false;
  applyPersistedPanelState(rawState ? rawState : createDefaultState(portInput.value));
  panelState.theme = normalizeTheme(rawState?.theme ?? legacyTheme ?? panelState.theme);
  panelState.language = normalizeLanguage(rawState?.language ?? panelState.language);
  captureSettings = normalizeCaptureSettings(stored[CAPTURE_SETTINGS_STORAGE_KEY]);
}

async function saveState(options: { syncToHost?: boolean; updateTimestamp?: boolean } = {}): Promise<void> {
  const { syncToHost = isWsOpen(), updateTimestamp = true } = options;
  panelState.wsPort = portInput.value;
  panelState.railWidth = clampRailWidth(panelState.railWidth);
  if (updateTimestamp) {
    panelState.updatedAt = Date.now();
  }
  await storageSet({
    [PANEL_STATE_STORAGE_KEY]: panelState,
    [WS_PORT_STORAGE_KEY]: panelState.wsPort,
  });
  if (syncToHost && isWsOpen()) {
    sendToHost({ type: 'panel_state_file_save', state: panelState });
  }
}

function getOrCreateTerminalView(sessionId: string, agentType?: AgentType): TerminalView {
  let view = terminalViews.get(sessionId);
  if (!view) {
    view = new TerminalView(panelState.theme);
    view.onData((data) => {
      const message: SessionInputMessage = {
        type: 'session_input',
        sessionId,
        data: encodeUtf8ToBase64(data),
      };
      sendToHost(message);
    });
    terminalViews.set(sessionId, view);
  } else {
    view.setTheme(panelState.theme);
  }
  if (agentType) {
    view.setAgentType(agentType);
  }
  return view;
}

function chatAgentType(agentType: AgentType | undefined): ChatAgentType {
  return agentType === 'claude' ? 'claude' : 'codex';
}

function getOrCreateAgentChatView(sessionId: string, agentType?: AgentType): AgentChatView {
  let view = agentChatViews.get(sessionId);
  if (!view) {
    view = new AgentChatView(sessionId, panelState.language, chatAgentType(agentType));
    view.onSend((message: AgentChatRequestMessage) => {
      sendToHost(message);
    });
    view.onCancel((requestId) => {
      const message: AgentChatCancelMessage = {
        type: 'agent_chat_cancel',
        sessionId,
        requestId: requestId ?? undefined,
      };
      sendToHost(message);
    });
    agentChatViews.set(sessionId, view);
  }
  view.setLanguage(panelState.language);
  view.setAgentType(chatAgentType(agentType));
  return view;
}

function disposeTerminalView(sessionId: string): void {
  const view = terminalViews.get(sessionId);
  if (!view) return;
  view.dispose();
  terminalViews.delete(sessionId);
}

function disposeAgentChatView(sessionId: string): void {
  const view = agentChatViews.get(sessionId);
  if (!view) return;
  view.dispose();
  agentChatViews.delete(sessionId);
}

function sendToHost(message: object): void {
  if (!isWsOpen()) return;
  ws!.send(JSON.stringify(message));
}

function clearPendingWorkingDirectoryValidations(): void {
  pendingWorkingDirectoryValidations.forEach((pending) => {
    clearTimeout(pending.timer);
    pending.resolve({
      code: 'unavailable',
      message: 'Cannot validate the path because the ClaudeChrome host is not connected.',
    });
  });
  pendingWorkingDirectoryValidations.clear();
}

function clearPendingPanelStateFileLoads(): void {
  pendingPanelStateFileLoads.forEach((pending) => {
    clearTimeout(pending.timer);
    pending.resolve({ found: false, error: 'unavailable' });
  });
  pendingPanelStateFileLoads.clear();
}

function requestPanelStateFileLoad(): Promise<{ found: boolean; state?: unknown; path?: string; error?: string }> {
  if (!isWsOpen()) {
    return Promise.resolve({ found: false, error: 'unavailable' });
  }

  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingPanelStateFileLoads.delete(id);
      resolve({ found: false, error: 'timeout' });
    }, PANEL_STATE_FILE_LOAD_TIMEOUT_MS);
    pendingPanelStateFileLoads.set(id, { resolve, timer });
    sendToHost({ type: 'panel_state_file_load_request', id });
  });
}

async function restorePanelStateFromLocalFile(): Promise<void> {
  if (loadedPersistedPanelState || !isWsOpen()) {
    sendToHost({ type: 'session_list_request' });
    return;
  }

  loadedPersistedPanelState = true;
  const result = await requestPanelStateFileLoad();
  if (result.found && result.state) {
    try {
      const restoredState = ensureValidState(result.state as PersistedPanelState, portInput.value);
      const currentUpdatedAt = typeof panelState.updatedAt === 'number' ? panelState.updatedAt : 0;
      const restoredUpdatedAt = typeof restoredState.updatedAt === 'number' ? restoredState.updatedAt : 0;
      if (!hadStoredPanelState || restoredUpdatedAt > currentUpdatedAt) {
        applyPersistedPanelState(restoredState);
        hadStoredPanelState = true;
        await saveState({ syncToHost: false, updateTimestamp: false });
        render();
      }
    } catch (error) {
      console.warn('[ClaudeChrome] Failed to restore panel state from local file', error);
    }
  }

  sendToHost({ type: 'session_list_request' });
}

function validateWorkingDirectoryWithHost(pathValue: string): Promise<WorkingDirectoryValidationResult> {
  const trimmed = pathValue.trim();
  if (!trimmed) {
    return Promise.resolve({ code: 'empty' });
  }
  if (!isWsOpen()) {
    return Promise.resolve({
      code: 'unavailable',
      message: 'Cannot validate the path because the ClaudeChrome host is not connected.',
    });
  }

  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      pendingWorkingDirectoryValidations.delete(id);
      resolve({
        code: 'unavailable',
        message: 'Path validation timed out while waiting for the ClaudeChrome host.',
      });
    }, 3000);
    pendingWorkingDirectoryValidations.set(id, { resolve, timer });
    sendToHost({ type: 'working_directory_validate', id, pathValue });
  });
}

configPanel.setWorkingDirectoryValidator(validateWorkingDirectoryWithHost);

function resetConnection(): void {
  const current = ws;
  ws = null;
  if (current) current.close();
  chunkAssembler.clear();
  clearPendingWorkingDirectoryValidations();
  clearPendingPanelStateFileLoads();
}

function connect(): void {
  const t = currentTranslations();
  const wsUrl = getConfiguredWsUrl();
  if (!wsUrl) {
    setStatus('error', t.errorInvalidPortInteger);
    return;
  }

  setConnectionStatus('connecting', wsUrl);
  try {
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      setConnectionStatus('connected', wsUrl);
      void restorePanelStateFromLocalFile();
    };

    socket.onmessage = (event) => {
      if (ws !== socket) return;
      let message: any;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === 'chunk') {
        const assembled = chunkAssembler.addChunk(message);
        if (assembled) {
          handleHostMessage(JSON.parse(assembled));
        }
        return;
      }
      handleHostMessage(message);
    };

    socket.onclose = () => {
      if (ws !== socket) return;
      ws = null;
      clearPendingWorkingDirectoryValidations();
      clearPendingPanelStateFileLoads();
      setConnectionStatus('disconnected');
      render();
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      clearPendingWorkingDirectoryValidations();
      clearPendingPanelStateFileLoads();
      setConnectionStatus('error', wsUrl);
    };
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
    ws = null;
  }
}

function handleHostMessage(message: SessionOutputMessage | AgentChatUpdateMessage | SessionSnapshotMessage | StatusMessage | any): void {
  switch (message.type) {
    case 'session_output': {
      const agentType = agentTypeForSession(message.sessionId);
      const view = getOrCreateTerminalView(message.sessionId, agentType);
      if (message.reset) {
        view.clear();
      }
      view.writeBase64(message.data);
      if (agentType && supportsBuiltInChat(agentType)) {
        getOrCreateAgentChatView(message.sessionId, agentType).applyTerminalOutput(
          decodeSessionOutputText(message.sessionId, message.data, Boolean(message.reset)),
          { reset: Boolean(message.reset) },
        );
      }
      break;
    }
    case 'agent_chat_update': {
      getOrCreateAgentChatView(message.sessionId, sessionSnapshots.get(message.sessionId)?.agentType).applyMessage(message as AgentChatUpdateMessage);
      break;
    }
    case 'session_snapshot': {
      applySessionSnapshot(message.sessions);
      break;
    }
    case 'session_closed': {
      removePaneForSession(message.sessionId, false);
      break;
    }
    case 'status': {
      const next = message as StatusMessage;
      if (next.message === 'Connected to ClaudeChrome host') {
        setConnectionStatus(next.status);
      } else {
        setStatus(next.status, next.message);
      }
      break;
    }
    case 'working_directory_validate_result': {
      const next = message as WorkingDirectoryValidateResultMessage;
      const pending = pendingWorkingDirectoryValidations.get(next.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingWorkingDirectoryValidations.delete(next.id);
        pending.resolve({
          code: next.code,
          normalizedPath: next.normalizedPath,
          message: next.message,
        });
      }
      break;
    }
    case 'panel_state_file_load_result': {
      const next = message as PanelStateFileLoadResultMessage;
      const pending = pendingPanelStateFileLoads.get(next.id);
      if (pending) {
        clearTimeout(pending.timer);
        pendingPanelStateFileLoads.delete(next.id);
        pending.resolve({
          found: next.found,
          state: next.state,
          path: next.path,
          error: next.error,
        });
      }
      break;
    }
    case 'browser_command':
      chrome.runtime.sendMessage(message, () => void chrome.runtime.lastError);
      break;
    default:
      break;
  }
}

function applySessionSnapshot(snapshots: SessionSnapshot[]): void {
  sessionSnapshots.clear();
  snapshots.forEach((snapshot) => {
    sessionSnapshots.set(snapshot.sessionId, snapshot);
    const pane = panelState.panes.find((entry) => entry.sessionId === snapshot.sessionId);
    if (pane) {
      pane.agentType = snapshot.agentType;
      pane.agentViewMode = normalizeAgentViewMode(snapshot.agentType, snapshot.mode ?? pane.agentViewMode);
      pane.bindingTabId = snapshot.binding.tabId;
      getOrCreateTerminalView(pane.sessionId, snapshot.agentType);
      if (!pane.title) {
        pane.title = snapshot.title;
      }
    }
  });

  snapshots
    .filter((snapshot) => snapshot.status === 'exited')
    .forEach((snapshot) => {
      removePaneForSession(snapshot.sessionId, true);
    });

  const knownSessionIds = new Set(panelState.panes.map((pane) => pane.sessionId));
  const unknownSnapshots = snapshots.filter((snapshot) => snapshot.status !== 'exited' && !knownSessionIds.has(snapshot.sessionId));
  if (unknownSnapshots.length > 0) {
    const t = currentTranslations();
    const workspace = createWorkspace(panelState.workspaces.length, unknownSnapshots[0]?.agentType ?? 'claude');
    workspace.title = formatMessage(t.restoredWorkspaceTitle, { index: panelState.workspaces.length + 1 });
    workspace.hint = t.workspaceHintRecovered;

    unknownSnapshots.forEach((snapshot, index) => {
      const pane = createPaneForWorkspace(workspace.workspaceId, snapshot.agentType, index);
      pane.sessionId = snapshot.sessionId;
      pane.title = snapshot.title;
      pane.agentViewMode = normalizeAgentViewMode(snapshot.agentType, snapshot.mode);
      pane.bindingTabId = snapshot.binding.tabId;
      panelState.panes.push(pane);
      workspace.paneIds.push(pane.paneId);
    });

    panelState.workspaces.push(workspace);
    normalizeWorkspacePaneRatios(panelState, workspace.workspaceId);
    if (!panelState.activeWorkspaceId) {
      panelState.activeWorkspaceId = workspace.workspaceId;
      activePaneId = workspace.paneIds[0] || null;
    }
  }

  void saveState();
  render();
  ensurePaneSessions();
}

function buildBindingLabel(pane: PaneLayout): string {
  const t = currentTranslations();
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (snapshot?.boundTab) {
    const tab = snapshot.boundTab;
    const label = tab.title || tab.url || `${t.tabPrefix}${tab.tabId}`;
    return `${label} · #${tab.tabId}`;
  }
  if (pane.bindingTabId != null) {
    return `${t.tabPrefix}${pane.bindingTabId}`;
  }
  return t.notBoundYet;
}

function buildStatusLabel(pane: PaneLayout): { text: string; className: string } {
  const t = currentTranslations();
  if (pendingSessionCreates.has(pane.sessionId)) {
    return { text: t.statusStarting, className: 'starting' };
  }
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (!snapshot) {
    return { text: isWsOpen() ? t.statusWaitingStart : t.statusWaitingConnection, className: 'disconnected' };
  }
  if (snapshot.status === 'starting') {
    return { text: t.statusStarting, className: snapshot.status };
  }
  if (snapshot.status === 'connected') {
    return { text: t.statusConnected, className: snapshot.status };
  }
  if (snapshot.status === 'tab_unavailable') {
    return { text: t.statusTabUnavailable, className: snapshot.status };
  }
  if (snapshot.status === 'exited') {
    return { text: t.statusExited, className: snapshot.status };
  }
  return {
    text: snapshot.statusMessage || t.statusError,
    className: snapshot.status,
  };
}

function updateFocusedBindingChip(): void {
  const t = currentTranslations();
  const pane = activePaneId ? getPane(panelState, activePaneId) : undefined;
  if (!pane) {
    focusedBinding.textContent = t.noFocusedPane;
    return;
  }
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (snapshot?.boundTab) {
    focusedBinding.textContent = `${agentLabel(snapshot.agentType)} → ${snapshot.boundTab.title || snapshot.boundTab.url || `${t.tabPrefix}${snapshot.boundTab.tabId}`}`;
    return;
  }
  focusedBinding.textContent = `${agentLabel(pane.agentType)} → ${buildBindingLabel(pane)}`;
}

function focusedTerminalSessionId(): string | null {
  const activeElement = document.activeElement as HTMLElement | null;
  if (!activeElement) {
    return null;
  }
  for (const [sessionId, view] of terminalViews) {
    if (view.root.contains(activeElement)) {
      return sessionId;
    }
  }
  return null;
}

function focusedChatSessionId(): string | null {
  const activeElement = document.activeElement as HTMLElement | null;
  if (!activeElement) {
    return null;
  }
  for (const [sessionId, view] of agentChatViews) {
    if (view.root.contains(activeElement)) {
      return sessionId;
    }
  }
  return null;
}

function focusTerminalSession(sessionId: string): void {
  requestAnimationFrame(() => {
    terminalViews.get(sessionId)?.focus();
  });
}

function focusChatSession(sessionId: string): void {
  requestAnimationFrame(() => {
    agentChatViews.get(sessionId)?.focus();
  });
}

function normalizePaneViewMode(pane: PaneLayout): AgentViewMode {
  pane.agentViewMode = normalizeAgentViewMode(pane.agentType, pane.agentViewMode);
  return pane.agentViewMode;
}

function togglePaneViewMode(pane: PaneLayout): void {
  if (!supportsBuiltInChat(pane.agentType)) {
    pane.agentViewMode = 'terminal';
    return;
  }

  pane.agentViewMode = normalizePaneViewMode(pane) === 'chat' ? 'terminal' : 'chat';
  void saveState();
  if (sessionSnapshots.has(pane.sessionId)) {
    sendToHost({
      type: 'session_set_mode',
      sessionId: pane.sessionId,
      mode: pane.agentViewMode,
    });
  }
  render();
}

function createPaneForWorkspace(workspaceId: string, agentType: AgentType, index: number): PaneLayout {
  const pane = createPane(workspaceId, agentType, index);
  pane.agentViewMode = defaultAgentViewModeForState(panelState, agentType);
  return pane;
}

function syncActivePaneUi(): void {
  workspaceStage.querySelectorAll<HTMLElement>('.pane[data-pane-id]').forEach((element) => {
    element.classList.toggle('focused', element.dataset.paneId === activePaneId);
  });
  updateFocusedBindingChip();
}

function focusPane(paneId: string, shouldFocusTerminal = true): void {
  const pane = getPane(panelState, paneId);
  if (!pane) {
    return;
  }
  if (activePaneId === paneId) {
    if (shouldFocusTerminal) {
      focusPaneInput(pane);
    }
    return;
  }
  activePaneId = paneId;
  syncActivePaneUi();
  if (shouldFocusTerminal) {
    focusPaneInput(pane);
  }
}

function focusPaneInput(pane: PaneLayout): void {
  if (normalizePaneViewMode(pane) === 'chat') {
    focusChatSession(pane.sessionId);
    return;
  }
  focusTerminalSession(pane.sessionId);
}

function ensureActiveWorkspace() {
  let workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (workspace) {
    return workspace;
  }

  workspace = createWorkspace(panelState.workspaces.length, 'claude');
  panelState.workspaces.push(workspace);
  panelState.activeWorkspaceId = workspace.workspaceId;
  return workspace;
}

const workspaceColorInput = document.createElement('input');
workspaceColorInput.type = 'color';
workspaceColorInput.tabIndex = -1;
workspaceColorInput.setAttribute('aria-hidden', 'true');
workspaceColorInput.style.position = 'fixed';
workspaceColorInput.style.opacity = '0';
workspaceColorInput.style.pointerEvents = 'none';
workspaceColorInput.style.inlineSize = '1px';
workspaceColorInput.style.blockSize = '1px';
workspaceColorInput.style.inset = '-10px auto auto -10px';
document.body.appendChild(workspaceColorInput);

let workspaceColorTargetId: string | null = null;

workspaceColorInput.addEventListener('input', () => {
  if (!workspaceColorTargetId) {
    return;
  }
  const workspace = getWorkspace(panelState, workspaceColorTargetId);
  if (!workspace) {
    return;
  }
  workspace.accentColor = workspaceColorInput.value;
  void saveState();
  render();
});

workspaceColorInput.addEventListener('change', () => {
  workspaceColorTargetId = null;
});

function restartPaneSession(pane: PaneLayout, agentType: AgentType = pane.agentType): void {
  const t = currentTranslations();
  const view = getOrCreateTerminalView(pane.sessionId, agentType);
  const startupOptions = getEffectiveStartupOptions(pane, agentType);
  view.writeln(`\x1b[33m[ClaudeChrome] ${t.restartingAgent.replace('{agent}', agentLabel(agentType))}\x1b[0m`);
  if (supportsBuiltInChat(agentType) && normalizePaneViewMode(pane) === 'chat') {
    getOrCreateAgentChatView(pane.sessionId, agentType).clear();
  }
  sendToHost({
    type: 'session_restart',
    sessionId: pane.sessionId,
    agentType,
    mode: normalizeAgentViewMode(agentType, pane.agentViewMode),
    launchArgs: startupOptions?.launchArgs,
    startupOptions: startupOptions ?? undefined,
  });
}

async function editLaunchDefaults(): Promise<void> {
  let previewTab: GetCurrentWindowActiveTabResultMessage['tab'] | null = null;
  try {
    previewTab = await requestCurrentActiveTab();
  } catch {
    previewTab = null;
  }

  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId) ?? null;
  configPanel.show(cloneLaunchConfig(panelState.launchDefaults), {
    scope: 'defaults',
    previewTab,
    workspaceId: activeWorkspace?.workspaceId,
    workspaceTitle: activeWorkspace?.title,
    workspaceDefaultAgentType: activeWorkspace?.defaultAgentType,
    shellWorkingDirectory: panelState.shellWorkingDirectory,
  });
}

function buildPaneConfig(pane: PaneLayout, launchAgent: LaunchConfigAgentType): AgentLaunchConfig {
  const config = createOverrideLaunchConfig();
  const effective = getEffectiveStartupOptions(pane, launchAgent);
  if (effective) {
    config[launchAgent] = { ...effective };
  }
  return config;
}

async function editPaneStartupOptions(pane: PaneLayout): Promise<void> {
  const t = currentTranslations();
  const launchAgent = launchConfigAgentType(pane.agentType);
  if (!launchAgent) {
    setStatus('error', t.errorOnlyStartupSettings);
    return;
  }

  let previewTab = sessionSnapshots.get(pane.sessionId)?.boundTab ?? null;
  if (!previewTab) {
    const fallbackPreviewTab = pane.bindingTabId != null
      ? {
        tabId: pane.bindingTabId,
        windowId: null,
        title: '',
        url: '',
        available: false,
        lastSeenAt: Date.now(),
      }
      : null;
    try {
      previewTab = fallbackPreviewTab ?? await requestCurrentActiveTab();
    } catch {
      previewTab = fallbackPreviewTab;
    }
  }

  configPanel.show(buildPaneConfig(pane, launchAgent), {
    scope: 'pane',
    paneId: pane.paneId,
    agentType: launchAgent,
    previewTab,
  });
}

function renameActiveWorkspace(): void {
  const t = currentTranslations();
  const workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!workspace) {
    return;
  }

  const nextTitle = window.prompt(t.promptWorkspaceName, localizeWorkspaceTitle(workspace.title));
  if (nextTitle === null) {
    return;
  }

  const trimmed = nextTitle.trim();
  if (!trimmed) {
    setStatus('error', t.errorEmptyWorkspaceName);
    return;
  }

  workspace.title = trimmed;
  void saveState();
  render();
}

function editActiveWorkspaceColor(): void {
  const workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!workspace) {
    return;
  }

  workspaceColorTargetId = workspace.workspaceId;
  workspaceColorInput.value = workspace.accentColor;
  workspaceColorInput.click();
}

async function requestCurrentActiveTab(): Promise<GetCurrentWindowActiveTabResultMessage['tab']> {
  const response = await runtimeMessage<GetCurrentWindowActiveTabResultMessage>({ type: 'get_current_window_active_tab' });
  if (response.error) {
    throw new Error(response.error);
  }
  return response.tab;
}

async function activateBoundTab(tabId: number): Promise<void> {
  const response = await runtimeMessage<ActivateTabResultMessage>({ type: 'activate_tab', tabId });
  if (response.error) {
    throw new Error(response.error);
  }
}

async function ensurePaneSession(pane: PaneLayout): Promise<void> {
  if (!isWsOpen() || sessionSnapshots.has(pane.sessionId) || pendingSessionCreates.has(pane.sessionId)) {
    return;
  }

  pendingSessionCreates.add(pane.sessionId);
  render();

  try {
    const bindingTab = pane.bindingTabId != null
      ? { tabId: pane.bindingTabId }
      : await requestCurrentActiveTab();

    if (!bindingTab?.tabId) {
      const t = currentTranslations();
      throw new Error(t.errorNoActiveTabToBind);
    }

    pane.bindingTabId = bindingTab.tabId;
    const view = getOrCreateTerminalView(pane.sessionId, pane.agentType);
    const size = view.getSize();
    const startupOptions = getEffectiveStartupOptions(pane);
    const mode = normalizePaneViewMode(pane);
    const createMessage: SessionCreateMessage = {
      type: 'session_create',
      sessionId: pane.sessionId,
      agentType: pane.agentType,
      mode,
      title: pane.title,
      binding: {
        kind: 'tab',
        tabId: bindingTab.tabId,
      },
      cols: Math.max(size.cols, 80),
      rows: Math.max(size.rows, 24),
      launchArgs: startupOptions?.launchArgs,
      startupOptions: startupOptions ?? undefined,
    };
    sendToHost(createMessage);
    await saveState();
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
  } finally {
    pendingSessionCreates.delete(pane.sessionId);
    render();
  }
}

function ensurePaneSessions(): void {
  if (!isWsOpen()) return;
  panelState.panes.forEach((pane) => {
    void ensurePaneSession(pane);
  });
}

function fitVisibleTerminals(): void {
  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!activeWorkspace) return;
  activeWorkspace.paneIds.forEach((paneId) => {
    const pane = getPane(panelState, paneId);
    if (!pane) return;
    terminalViews.get(pane.sessionId)?.fit();
    const size = terminalViews.get(pane.sessionId)?.getSize();
    if (size && sessionSnapshots.has(pane.sessionId)) {
      const resizeMessage: SessionResizeMessage = {
        type: 'session_resize',
        sessionId: pane.sessionId,
        cols: size.cols,
        rows: size.rows,
      };
      sendToHost(resizeMessage);
    }
  });
}

function scheduleFit(): void {
  requestAnimationFrame(() => {
    fitVisibleTerminals();
    updateFocusedBindingChip();
  });
}

async function closeBrowserSidePanel(): Promise<void> {
  if (panelCloseInFlight) {
    return;
  }

  panelCloseInFlight = true;
  try {
    const t = currentTranslations();
    const response = await runtimeMessage<CollapseSidePanelResultMessage>({ type: 'collapse_side_panel' });
    if (!response.ok) {
      throw new Error(response.error || t.errorClosePanelFailed);
    }
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
  } finally {
    panelCloseInFlight = false;
    panelAutoCollapseArmed = false;
    lastViewportWidth = window.innerWidth;
  }
}

function setRailCollapsed(collapsed: boolean): void {
  if (panelState.railCollapsed === collapsed) {
    return;
  }
  panelState.railCollapsed = collapsed;
  void saveState();
  render();
}

function toggleRailCollapsed(): void {
  setRailCollapsed(!panelState.railCollapsed);
}

function attachSplitterHandlers(splitter: HTMLDivElement, workspaceId: string, topPaneId: string, bottomPaneId: string): void {
  splitter.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const topPane = getPane(panelState, topPaneId);
    const bottomPane = getPane(panelState, bottomPaneId);
    const workspace = getWorkspace(panelState, workspaceId);
    if (!topPane || !bottomPane || !workspace) return;

    const startY = event.clientY;
    const startTop = topPane.sizeRatio;
    const startBottom = bottomPane.sizeRatio;
    const stack = splitter.parentElement as HTMLElement | null;
    if (!stack) return;
    const totalHeight = stack.getBoundingClientRect().height;
    if (!totalHeight) return;

    const onMove = (moveEvent: PointerEvent) => {
      const deltaRatio = (moveEvent.clientY - startY) / totalHeight;
      const nextTop = Math.max(MIN_PANE_RATIO, Math.min(startTop + deltaRatio, startTop + startBottom - MIN_PANE_RATIO));
      const nextBottom = startTop + startBottom - nextTop;
      topPane.sizeRatio = nextTop;
      bottomPane.sizeRatio = nextBottom;
      normalizeWorkspacePaneRatios(panelState, workspaceId);
      const paneElements = Array.from(stack.querySelectorAll<HTMLElement>('.pane'));
      const panes = getPanesForWorkspace(panelState, workspaceId);
      paneElements.forEach((element, index) => {
        const pane = panes[index];
        if (pane) {
          element.style.flex = `${pane.sizeRatio} 1 0%`;
        }
      });
      scheduleFit();
    };

    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      void saveState();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function attachRailResizeHandler(): void {
  workspaceRailResizer.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    workspaceRailResizer.setPointerCapture(event.pointerId);
    document.body.classList.add('rail-resizing');
    const startX = event.clientX;
    const startWidth = panelState.railWidth;
    let nextWidth = startWidth;
    let collapsedByDrag = false;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      nextWidth = Math.max(0, Math.round(startWidth + delta));

      if (nextWidth <= RAIL_AUTO_COLLAPSE_WIDTH) {
        collapsedByDrag = true;
        if (!panelState.railCollapsed) {
          panelState.railCollapsed = true;
          applyLayoutState();
          scheduleFit();
        }
        return;
      }

      collapsedByDrag = false;
      if (panelState.railCollapsed) {
        panelState.railCollapsed = false;
        applyLayoutState();
      }

      panelState.railWidth = clampRailWidth(nextWidth);
      applyRailWidth();
    };

    const onUp = () => {
      document.body.classList.remove('rail-resizing');
      workspaceRailResizer.releasePointerCapture(event.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);

      if (collapsedByDrag) {
        panelState.railCollapsed = true;
      } else {
        panelState.railCollapsed = false;
        panelState.railWidth = clampRailWidth(nextWidth);
      }

      void saveState();
      scheduleFit();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function handleViewportResize(): void {
  const nextWidth = window.innerWidth;
  const shrinking = nextWidth < lastViewportWidth;

  if (nextWidth >= PANEL_AUTO_COLLAPSE_ARM_WIDTH) {
    panelAutoCollapseArmed = true;
  }

  lastViewportWidth = nextWidth;

  if (!panelCloseInFlight && panelAutoCollapseArmed && shrinking && nextWidth <= PANEL_AUTO_COLLAPSE_WIDTH) {
    void closeBrowserSidePanel();
    return;
  }

  scheduleFit();
}

function renderWorkspaceRail(): void {
  const t = currentTranslations();
  workspaceRail.replaceChildren();

  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  const header = document.createElement('div');
  header.className = 'workspace-rail-header';

  const title = document.createElement('span');
  title.className = 'workspace-rail-title';
  title.textContent = t.workspaceListTitle;

  const actions = document.createElement('div');
  actions.className = 'workspace-rail-header-actions';

  const addButton = document.createElement('button');
  addButton.className = 'workspace-rail-button';
  addButton.type = 'button';
  setIconButton(addButton, ICONS.add, t.addWorkspaceTitle);
  addButton.addEventListener('click', () => {
    addWorkspace();
  });

  const renameButton = document.createElement('button');
  renameButton.className = 'workspace-rail-button';
  renameButton.type = 'button';
  setIconButton(renameButton, ICONS.rename, t.renameWorkspaceTitle);
  renameButton.disabled = !activeWorkspace;
  renameButton.addEventListener('click', () => {
    renameActiveWorkspace();
  });

  const colorButton = document.createElement('button');
  colorButton.className = 'workspace-rail-button workspace-rail-color';
  colorButton.type = 'button';
  setIconButton(colorButton, ICONS.palette, t.colorWorkspaceTitle);
  colorButton.disabled = !activeWorkspace;
  colorButton.style.setProperty('--workspace-accent', activeWorkspace?.accentColor || 'transparent');
  colorButton.addEventListener('click', () => {
    editActiveWorkspaceColor();
  });

  const collapseButton = document.createElement('button');
  collapseButton.className = 'workspace-rail-button workspace-rail-collapse';
  collapseButton.type = 'button';
  setIconButton(collapseButton, ICONS.collapse, t.collapseWorkspaceTitle);
  collapseButton.addEventListener('click', () => {
    setRailCollapsed(true);
  });

  actions.appendChild(addButton);
  actions.appendChild(renameButton);
  actions.appendChild(colorButton);
  actions.appendChild(collapseButton);

  header.appendChild(title);
  header.appendChild(actions);
  workspaceRail.appendChild(header);

  panelState.workspaces.forEach((workspace) => {
    const button = document.createElement('button');
    button.className = `workspace-tab${workspace.workspaceId === panelState.activeWorkspaceId ? ' active' : ''}`;
    button.style.borderLeftColor = workspace.accentColor;
    button.innerHTML = `
      <span class="workspace-tab-title">${localizeWorkspaceTitle(workspace.title)}</span>
      <span class="workspace-tab-hint">${localizeWorkspaceHint(workspace.hint)}</span>
      <span class="workspace-tab-count">${workspace.paneIds.length}${t.paneCountSuffix}</span>
    `;
    button.addEventListener('click', () => {
      panelState.activeWorkspaceId = workspace.workspaceId;
      activePaneId = workspace.paneIds[0] || null;
      void saveState();
      render();
    });
    workspaceRail.appendChild(button);
  });
}

function renderWorkspaceStage(): void {
  const t = currentTranslations();
  workspaceStage.replaceChildren();
  const workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!workspace) {
    const empty = document.createElement('div');
    empty.className = 'empty-stage';
    empty.textContent = t.noWorkspaceAvailable;
    workspaceStage.appendChild(empty);
    return;
  }

  const workspaceEl = document.createElement('div');
  workspaceEl.className = 'workspace active';
  const stack = document.createElement('div');
  stack.className = 'pane-stack';
  workspaceEl.appendChild(stack);

  const panes = getPanesForWorkspace(panelState, workspace.workspaceId);
  panes.forEach((pane, index) => {
    const paneEl = document.createElement('section');
    paneEl.dataset.paneId = pane.paneId;
    paneEl.className = `pane${pane.paneId === activePaneId ? ' focused' : ''}`;
    paneEl.style.flex = `${pane.sizeRatio} 1 0%`;
    paneEl.style.setProperty('--pane-accent', workspace.accentColor);
    paneEl.addEventListener('pointerdown', () => {
      if (activePaneId !== pane.paneId) {
        focusPane(pane.paneId, false);
      }
    });

    const header = document.createElement('div');
    header.className = 'pane-header';

    const main = document.createElement('div');
    main.className = 'pane-header-main';

    const badge = document.createElement('span');
    badge.className = `agent-badge ${pane.agentType}`;
    badge.textContent = agentLabel(pane.agentType);

    const select = document.createElement('select');
    select.className = 'pane-agent-select';
    select.innerHTML = `
      <option value="shell">${agentLabel('shell')}</option>
      <option value="claude">${agentLabel('claude')}</option>
      <option value="codex">${agentLabel('codex')}</option>
    `;
    select.value = pane.agentType;
    select.addEventListener('change', () => {
      const nextAgent = select.value as AgentType;
      if (nextAgent === pane.agentType) return;
      if (!window.confirm(t.confirmSwitchAgent.replace('{agent}', agentLabel(nextAgent)))) {
        select.value = pane.agentType;
        return;
      }
      pane.agentType = nextAgent;
      pane.agentViewMode = defaultAgentViewModeForState(panelState, nextAgent);
      getOrCreateTerminalView(pane.sessionId, nextAgent).clear();
      agentChatViews.get(pane.sessionId)?.clear();
      restartPaneSession(pane, nextAgent);
      void saveState();
      render();
    });

    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = localizePaneTitle(pane.title);

    main.appendChild(badge);
    main.appendChild(select);
    main.appendChild(title);

    const actions = document.createElement('div');
    actions.className = 'pane-header-actions';

    const binding = document.createElement('span');
    binding.className = 'pane-binding';
    binding.textContent = buildBindingLabel(pane);

    const status = document.createElement('span');
    const statusLabel = buildStatusLabel(pane);
    status.className = `pane-status ${statusLabel.className}`;
    status.textContent = statusLabel.text;

    const btnGo = document.createElement('button');
    btnGo.className = 'pane-icon-button';
    setIconButton(btnGo, ICONS.tab, t.switchToTabTitle);
    btnGo.disabled = pane.bindingTabId == null;
    btnGo.addEventListener('click', async (event) => {
      event.stopPropagation();
      if (pane.bindingTabId == null) return;
      try {
        await activateBoundTab(pane.bindingTabId);
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));
      }
    });

    const btnBind = document.createElement('button');
    btnBind.className = 'pane-icon-button';
    setIconButton(btnBind, ICONS.bind, t.bindCurrentTabTitle);
    btnBind.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const target = await requestCurrentActiveTab();
        if (!target) {
          throw new Error(t.noActiveTab);
        }
        const currentLabel = buildBindingLabel(pane);
        const nextLabel = target.title || target.url || `${t.tabPrefix}${target.tabId}`;
        if (!window.confirm(t.confirmRebind.replace('{current}', currentLabel).replace('{next}', nextLabel))) {
          return;
        }
        pane.bindingTabId = target.tabId;
        const bindMessage: SessionBindTabMessage = {
          type: 'session_bind_tab',
          sessionId: pane.sessionId,
          tabId: target.tabId,
        };
        sendToHost(bindMessage);
        getOrCreateTerminalView(pane.sessionId, pane.agentType).writeln(`\x1b[36m[ClaudeChrome] ${t.boundToTab}${nextLabel}\x1b[0m`);
        await saveState();
        render();
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));
      }
    });

    const launchAgent = launchConfigAgentType(pane.agentType);
    let btnArgs: HTMLButtonElement | null = null;
    if (launchAgent) {
      const hasPaneOverrides = paneUsesStartupOverrides(pane, launchAgent);
      btnArgs = document.createElement('button');
      btnArgs.className = `pane-icon-button${hasPaneOverrides ? ' has-pane-overrides' : ''}`;
      setIconButton(btnArgs, ICONS.settings, hasPaneOverrides
        ? t.settingsCustomTitle.replace('{agent}', agentLabel(pane.agentType))
        : t.settingsDefaultTitle.replace('{agent}', agentLabel(pane.agentType)));
      btnArgs.addEventListener('click', (event) => {
        event.stopPropagation();
        editPaneStartupOptions(pane);
      });
    }

    const btnRestart = document.createElement('button');
    btnRestart.className = 'pane-icon-button';
    setIconButton(btnRestart, ICONS.restart, t.restartButton);
    btnRestart.addEventListener('click', (event) => {
      event.stopPropagation();
      restartPaneSession(pane);
    });

    const btnClose = document.createElement('button');
    btnClose.className = 'pane-icon-button pane-close-button';
    setIconButton(btnClose, ICONS.close, t.closeButton);
    btnClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closePane(pane.paneId);
    });

    actions.appendChild(binding);
    actions.appendChild(status);

    if (supportsBuiltInChat(pane.agentType)) {
      normalizePaneViewMode(pane);
      const btnViewMode = document.createElement('button');
      btnViewMode.className = 'pane-view-toggle';
      btnViewMode.type = 'button';
      setIconButton(
        btnViewMode,
        pane.agentViewMode === 'chat' ? ICONS.chat : ICONS.terminal,
        pane.agentViewMode === 'chat'
          ? formatMessage(t.agentModeTerminalTitle, { agent: agentLabel(pane.agentType) })
          : formatMessage(t.agentModeBuiltInTitle, { agent: agentLabel(pane.agentType) }),
      );
      btnViewMode.setAttribute('aria-pressed', String(pane.agentViewMode === 'chat'));
      btnViewMode.addEventListener('click', (event) => {
        event.stopPropagation();
        togglePaneViewMode(pane);
      });
      actions.appendChild(btnViewMode);
    } else {
      pane.agentViewMode = 'terminal';
    }

    actions.appendChild(btnGo);
    actions.appendChild(btnBind);
    if (btnArgs) {
      actions.appendChild(btnArgs);
    }
    actions.appendChild(btnRestart);
    actions.appendChild(btnClose);

    header.appendChild(main);
    header.appendChild(actions);

    const body = document.createElement('div');
    body.className = 'pane-body';

    const view = getOrCreateTerminalView(pane.sessionId, pane.agentType);
    if (pane.agentViewMode === 'chat' && supportsBuiltInChat(pane.agentType)) {
      body.classList.add('pane-body-chat');
      getOrCreateAgentChatView(pane.sessionId, pane.agentType).mount(body);
    } else {
      view.mount(body);
    }

    paneEl.appendChild(header);
    paneEl.appendChild(body);
    stack.appendChild(paneEl);

    if (index < panes.length - 1) {
      const splitter = document.createElement('div');
      splitter.className = 'pane-splitter';
      attachSplitterHandlers(splitter, workspace.workspaceId, pane.paneId, panes[index + 1].paneId);
      stack.appendChild(splitter);
    }
  });

  workspaceStage.appendChild(workspaceEl);
}

function render(): void {
  const sessionIdToRefocus = focusedTerminalSessionId();
  const chatSessionIdToRefocus = focusedChatSessionId();
  applyTheme();
  updateLanguageToggleButton();
  updateUILanguage();
  updateCaptureToggleButton();
  applyRailWidth();
  applyLayoutState();
  renderActivityBar();
  renderSettingsPage();
  renderPluginsPage();
  renderWorkspaceRail();
  renderWorkspaceStage();
  updateFocusedBindingChip();
  scheduleFit();
  if (sessionIdToRefocus) {
    focusTerminalSession(sessionIdToRefocus);
  } else if (chatSessionIdToRefocus) {
    focusChatSession(chatSessionIdToRefocus);
  }
}

function removePaneForSession(sessionId: string, notifyHost: boolean): void {
  const pane = panelState.panes.find((entry) => entry.sessionId === sessionId);
  if (!pane) {
    return;
  }

  const workspace = getWorkspace(panelState, pane.workspaceId);

  if (notifyHost) {
    sendToHost({ type: 'session_close', sessionId: pane.sessionId });
  }

  disposeTerminalView(pane.sessionId);
  disposeAgentChatView(pane.sessionId);
  pendingSessionCreates.delete(pane.sessionId);
  sessionSnapshots.delete(pane.sessionId);

  removePane(panelState, pane.paneId);
  if (workspace && workspace.paneIds.length === 0) {
    removeWorkspace(panelState, workspace.workspaceId);
  }

  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId) || panelState.workspaces[0];
  panelState.activeWorkspaceId = activeWorkspace?.workspaceId || '';
  activePaneId = activeWorkspace?.paneIds[0] || null;
  void saveState();
  render();
}

function closePane(paneId: string): void {
  const pane = getPane(panelState, paneId);
  if (!pane) return;
  removePaneForSession(pane.sessionId, true);
}

function addPane(agentType: AgentType): void {
  const t = currentTranslations();
  const workspace = ensureActiveWorkspace();
  if (workspace.paneIds.length >= MAX_PANES_PER_WORKSPACE) {
    setStatus('error', t.errorMaxPanesReached.replace('{max}', String(MAX_PANES_PER_WORKSPACE)));
    return;
  }

  const pane = createPaneForWorkspace(workspace.workspaceId, agentType, workspace.paneIds.length);
  workspace.paneIds.push(pane.paneId);
  panelState.panes.push(pane);
  normalizeWorkspacePaneRatios(panelState, workspace.workspaceId);
  activePaneId = pane.paneId;
  void saveState();
  render();
  void ensurePaneSession(pane);
}

function addWorkspace(): void {
  const sourceWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  const workspace = createWorkspace(panelState.workspaces.length, sourceWorkspace?.defaultAgentType ?? 'claude');
  const pane = createPaneForWorkspace(workspace.workspaceId, workspace.defaultAgentType, 0);
  workspace.paneIds.push(pane.paneId);
  panelState.workspaces.push(workspace);
  panelState.panes.push(pane);
  panelState.activeWorkspaceId = workspace.workspaceId;
  activePaneId = pane.paneId;
  void saveState();
  render();
  void ensurePaneSession(pane);
}

btnReconnect.addEventListener('click', () => {
  resetConnection();
  connect();
});

btnApplyPort.addEventListener('click', async () => {
  const t = currentTranslations();
  const port = normalizePort(portInput.value);
  if (!port) {
    setStatus('error', t.errorInvalidPortInteger);
    return;
  }

  portInput.value = port;
  panelState.wsPort = port;
  await saveState();
  resetConnection();
  connect();
});

portInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    btnApplyPort.click();
  }
});

btnLaunchDefaults.addEventListener('click', () => {
  void editLaunchDefaults();
});

configPanel.onSave((config, context, workspaceDefaultAgentType, shellWorkingDirectory) => {
  const t = currentTranslations();
  if (context.scope === 'defaults') {
    panelState.launchDefaults = cloneLaunchConfig(config);
    panelState.shellWorkingDirectory = shellWorkingDirectory ?? '';

    if (context.workspaceId && workspaceDefaultAgentType) {
      const workspace = getWorkspace(panelState, context.workspaceId);
      if (workspace) {
        workspace.defaultAgentType = workspaceDefaultAgentType;
      }
    }

    void saveState();
    render();
    setStatus(isWsOpen() ? 'connected' : 'disconnected', t.configDefaultsSavedStatus);
    return;
  }

  const pane = context.paneId ? getPane(panelState, context.paneId) : undefined;
  const launchAgent = context.agentType;
  if (!pane || !launchAgent) {
    return;
  }

  const nextOptions = config[launchAgent];
  pane.launchOverrides[launchAgent] = startupOptionsEqual(nextOptions, panelState.launchDefaults[launchAgent])
    ? createStartupOptions()
    : { ...nextOptions };

  void saveState();
  render();
  setStatus(isWsOpen() ? 'connected' : 'disconnected', t.configPaneSavedStatus);
});

btnToggleBodyCapture.addEventListener('click', () => {
  toggleCaptureResponseBodies();
});

btnAddShellPane.addEventListener('click', () => {
  addPane('shell');
});

btnAddClaudePane.addEventListener('click', () => {
  addPane('claude');
});

btnAddCodexPane.addEventListener('click', () => {
  addPane('codex');
});

btnLanguageToggle.addEventListener('click', () => {
  toggleLanguage();
});

btnThemeToggle.addEventListener('click', () => {
  toggleTheme();
});

btnTogglePanel.addEventListener('click', () => {
  void closeBrowserSidePanel();
});

workspaceRailEdgeToggle.addEventListener('click', () => {
  toggleRailCollapsed();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'context_update') {
    sendToHost(message);
  }
  if (message.type === 'browser_command_result') {
    sendToHost(message);
  }
});

chrome.storage.onChanged?.addListener((changes, areaName) => {
  if (areaName !== 'local' || !changes[CAPTURE_SETTINGS_STORAGE_KEY]) {
    return;
  }
  captureSettings = normalizeCaptureSettings(changes[CAPTURE_SETTINGS_STORAGE_KEY].newValue);
  updateCaptureToggleButton();
});

window.addEventListener('resize', handleViewportResize);
window.addEventListener('beforeunload', handlePanelUnload);
window.addEventListener('pagehide', handlePanelUnload);

attachRailResizeHandler();

void (async () => {
  await loadState();
  render();
  notifyPanelOpened();
  connect();
})();
