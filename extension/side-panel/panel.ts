import { ChunkAssembler } from '../shared/chunker';
import type {
  ActivateTabResultMessage,
  AgentLaunchConfig,
  AgentType,
  CollapseSidePanelResultMessage,
  GetCurrentWindowActiveTabResultMessage,
  LaunchConfigAgentType,
  SessionBindTabMessage,
  SessionCreateMessage,
  SessionInputMessage,
  SessionOutputMessage,
  SessionResizeMessage,
  SessionRestartMessage,
  SessionSnapshot,
  SessionSnapshotMessage,
  StatusMessage,
} from '../shared/types';
import {
  createDefaultState,
  createPane,
  createWorkspace,
  ensureValidState,
  getPane,
  getPanesForWorkspace,
  getWorkspace,
  normalizeWorkspacePaneRatios,
  removePane,
  removeWorkspace,
  type PaneLayout,
  type PanelLanguage,
  type PanelTheme,
  type PersistedPanelState,
} from './state';
import { encodeUtf8ToBase64 } from '../shared/base64';
import { TerminalView } from './terminal-view';

const DEFAULT_WS_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = '9999';
const PANEL_STATE_STORAGE_KEY = 'panelStateV2';
const WS_PORT_STORAGE_KEY = 'wsPort';
const MAX_PANES_PER_WORKSPACE = 6;
const MIN_PANE_RATIO = 0.14;
const MIN_RAIL_WIDTH = 96;
const MAX_RAIL_WIDTH = 320;
const RAIL_AUTO_COLLAPSE_WIDTH = 56;
const PANEL_AUTO_COLLAPSE_WIDTH = 72;
const PANEL_AUTO_COLLAPSE_ARM_WIDTH = 144;
const DEFAULT_CODEX_LAUNCH_ARGS = '-a never -s workspace-write';

const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const focusedBinding = document.getElementById('focused-binding')!;
const workspaceStage = document.getElementById('workspace-stage')!;
const workspaceRailResizer = document.getElementById('workspace-rail-resizer')!;
const workspaceRail = document.getElementById('workspace-rail')!;
const workspaceRailEdgeToggle = document.getElementById('workspace-rail-edge-toggle') as HTMLButtonElement;
const portInput = document.getElementById('ws-port') as HTMLInputElement;
const btnApplyPort = document.getElementById('btn-apply-port')!;
const btnReconnect = document.getElementById('btn-reconnect')!;
const btnLaunchDefaults = document.getElementById('btn-launch-defaults')!;
const btnAddShellPane = document.getElementById('btn-add-shell-pane')!;
const btnAddClaudePane = document.getElementById('btn-add-claude-pane')!;
const btnAddCodexPane = document.getElementById('btn-add-codex-pane')!;
const btnLanguageToggle = document.getElementById('btn-language-toggle') as HTMLButtonElement;
const btnThemeToggle = document.getElementById('btn-theme-toggle') as HTMLButtonElement;
const btnTogglePanel = document.getElementById('btn-toggle-panel') as HTMLButtonElement;

const chunkAssembler = new ChunkAssembler();
const terminalViews = new Map<string, TerminalView>();
const sessionSnapshots = new Map<string, SessionSnapshot>();
const pendingSessionCreates = new Set<string>();

type LocalizableStatusSource = 'custom' | 'connection';

let panelState = createDefaultState(DEFAULT_WS_PORT);
let activePaneId: string | null = null;
let ws: WebSocket | null = null;
let lastViewportWidth = window.innerWidth;
let panelAutoCollapseArmed = window.innerWidth >= PANEL_AUTO_COLLAPSE_ARM_WIDTH;
let panelCloseInFlight = false;
let connectionStatusState: 'connected' | 'disconnected' | 'connecting' | 'error' = 'disconnected';
let connectionStatusUrl: string | null = null;

function emptyLaunchConfig(): AgentLaunchConfig {
  return {
    claude: '',
    codex: DEFAULT_CODEX_LAUNCH_ARGS,
  };
}

function agentLabel(agentType: AgentType): string {
  const t = translations[panelState.language];
  switch (agentType) {
    case 'codex':
      return 'Codex';
    case 'shell':
      return t.shellLabel;
    default:
      return 'Claude';
  }
}

function connectionStateLabel(state: 'connected' | 'disconnected' | 'connecting' | 'error'): string {
  const t = translations[panelState.language];
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

function getEffectiveLaunchArgs(pane: PaneLayout, agentType: AgentType = pane.agentType): string | undefined {
  const launchAgent = launchConfigAgentType(agentType);
  if (!launchAgent) {
    return undefined;
  }

  const override = pane.launchOverrides[launchAgent].trim();
  if (override) {
    return override;
  }

  const fallback = panelState.launchDefaults[launchAgent].trim();
  if (fallback) {
    return fallback;
  }

  if (launchAgent === 'codex') {
    return DEFAULT_CODEX_LAUNCH_ARGS;
  }

  return undefined;
}

function normalizeTheme(theme: unknown): PanelTheme {
  return theme === 'light' ? 'light' : 'dark';
}

function normalizeLanguage(language: unknown): PanelLanguage {
  return language === 'en' ? 'en' : 'zh';
}

const translations = {
  zh: {
    statusDisconnected: '未连接',
    statusConnecting: '连接中',
    statusConnected: '已连接',
    statusError: '连接错误',
    noFocusedPane: '未选中面板',
    portLabel: '端口',
    applyButton: '应用',
    reconnectButton: '↻',
    launchDefaultsButton: '默认启动项',
    addShellButton: '+ 终端',
    addClaudeButton: '+ Claude',
    addCodexButton: '+ Codex',
    closePanelButton: '关闭侧边栏',
    workspaceToggle: '工作区',
    launchDefaultsTitle: '设置 Claude 和 Codex 面板的默认启动选项',
    addShellTitle: '在当前工作区中添加一个终端面板',
    addClaudeTitle: '在当前工作区中添加一个 Claude 面板',
    addCodexTitle: '在当前工作区中添加一个 Codex 面板',
    applyPortTitle: '保存端口并重新连接',
    reconnectTitle: '重新连接',
    closePanelTitle: '关闭当前窗口的侧边栏',
    workspaceToggleTitle: '展开工作区列表',
    workspaceListTitle: '工作区列表',
    addWorkspaceButton: '+ 工作区',
    addWorkspaceTitle: '新建工作区',
    renameButton: '重命名',
    renameWorkspaceTitle: '重命名当前工作区',
    colorButton: '颜色',
    colorWorkspaceTitle: '更改当前工作区主题色',
    collapseButton: '收起',
    collapseWorkspaceTitle: '收起工作区列表',
    paneCountSuffix: ' 个面板',
    noWorkspaceAvailable: '没有可用工作区',
    shellOption: '终端',
    switchToTab: '切换',
    switchToTabTitle: '切换到已绑定标签页',
    bindCurrentTab: '绑定当前页',
    bindCurrentTabTitle: '将此面板绑定到当前活动标签页',
    launchArgsButton: '启动项',
    launchArgsButtonCustom: '启动项*',
    launchArgsCustomTitle: '此面板使用了单独的 {agent} 启动设置。',
    launchArgsDefaultTitle: '此面板正在使用默认的 {agent} 启动设置。',
    restartButton: '重启',
    closeButton: '关闭',
    confirmSwitchAgent: '要切换为 {agent} 并立即重启吗？',
    noActiveTab: '当前没有活动标签页。',
    tabPrefix: '标签页 ',
    confirmRebind: '要将此面板从"{current}"改绑到"{next}"吗？',
    boundToTab: '已绑定到 ',
    notBoundYet: '尚未绑定标签页',
    statusStarting: '正在启动...',
    statusWaitingStart: '等待启动',
    statusWaitingConnection: '等待连接',
    shellLabel: '终端',
    workspaceCollapsed: '工作区',
    workspaceExpanded: '收起',
    workspaceCollapsedTitle: '展开工作区列表',
    workspaceExpandedTitle: '收起工作区列表',
    restoredWorkspacePrefix: '恢复工作区 ',
    restartingAgent: '正在重启 {agent}',
    currentThemeTitle: '当前主题：{theme}',
    currentLanguageTitle: '当前语言：{language}',
    themeLightLabel: '浅色',
    themeDarkLabel: '深色',
    languageLabelZh: '中文',
    languageLabelEn: 'English',
    workspaceTitle: '工作区 {index}',
    restoredWorkspaceTitle: '恢复工作区 {index}',
    workspaceHintFocusedTab: '关联当前标签页',
    workspaceHintRecovered: '从主机恢复',
    unsetLaunchArgs: '未设置',
    promptClaudeLaunchArgs: '请输入 Claude 面板的默认启动选项。',
    promptCodexLaunchArgs: '请输入 Codex 面板的默认启动选项。',
    errorOnlyClaudeCodex: '只有 Claude 和 Codex 面板支持启动选项。',
    promptPaneLaunchArgs: '{agent} 面板启动选项\n留空则使用默认设置。\n当前默认：{default}',
    confirmRestartPane: '要立即重启该{agent}面板以应用新设置吗？',
    promptWorkspaceName: '工作区名称',
    errorEmptyWorkspaceName: '工作区名称不能为空。',
    errorNoActiveTabToBind: '当前没有可绑定的活动标签页。',
    errorClosePanelFailed: '关闭侧边栏失败。',
    errorMaxPanesReached: '单个工作区最多只能有 {max} 个面板。',
    errorInvalidPort: '请输入 1 到 65535 之间的端口号。',
    errorInvalidPortInteger: '请输入 1 到 65535 之间的整数端口号。',
    statusConnectingTo: '正在连接到 {url}...',
    statusConnectedTo: '已连接到 {url}',
    errorCannotConnectTo: '无法连接到 {url}',
    statusExited: '已结束',
    statusTabUnavailable: '当前绑定的标签页不可用',
  },
  en: {
    statusDisconnected: 'Disconnected',
    statusConnecting: 'Connecting',
    statusConnected: 'Connected',
    statusError: 'Connection Error',
    noFocusedPane: 'No Pane Selected',
    portLabel: 'Port',
    applyButton: 'Apply',
    reconnectButton: '↻',
    launchDefaultsButton: 'Launch Defaults',
    addShellButton: '+ Shell',
    addClaudeButton: '+ Claude',
    addCodexButton: '+ Codex',
    closePanelButton: 'Close Panel',
    workspaceToggle: 'Workspaces',
    launchDefaultsTitle: 'Set default launch options for Claude and Codex panes',
    addShellTitle: 'Add a terminal pane to the current workspace',
    addClaudeTitle: 'Add a Claude pane to the current workspace',
    addCodexTitle: 'Add a Codex pane to the current workspace',
    applyPortTitle: 'Save port and reconnect',
    reconnectTitle: 'Reconnect',
    closePanelTitle: 'Close the sidebar for the current window',
    workspaceToggleTitle: 'Expand workspace list',
    workspaceListTitle: 'Workspace List',
    addWorkspaceButton: '+ Workspace',
    addWorkspaceTitle: 'Create new workspace',
    renameButton: 'Rename',
    renameWorkspaceTitle: 'Rename current workspace',
    colorButton: 'Color',
    colorWorkspaceTitle: 'Change workspace theme color',
    collapseButton: 'Collapse',
    collapseWorkspaceTitle: 'Collapse workspace list',
    paneCountSuffix: ' panes',
    noWorkspaceAvailable: 'No workspace available',
    shellOption: 'Shell',
    switchToTab: 'Switch',
    switchToTabTitle: 'Switch to bound tab',
    bindCurrentTab: 'Bind Tab',
    bindCurrentTabTitle: 'Bind this pane to current active tab',
    launchArgsButton: 'Launch Args',
    launchArgsButtonCustom: 'Launch Args*',
    launchArgsCustomTitle: 'This pane uses custom {agent} launch settings.',
    launchArgsDefaultTitle: 'This pane uses default {agent} launch settings.',
    restartButton: 'Restart',
    closeButton: 'Close',
    confirmSwitchAgent: 'Switch to {agent} and restart immediately?',
    noActiveTab: 'No active tab.',
    tabPrefix: 'Tab ',
    confirmRebind: 'Rebind this pane from "{current}" to "{next}"?',
    boundToTab: 'Bound to ',
    notBoundYet: 'Not bound to any tab',
    statusStarting: 'Starting...',
    statusWaitingStart: 'Waiting to start',
    statusWaitingConnection: 'Waiting for connection',
    shellLabel: 'Shell',
    workspaceCollapsed: 'Workspaces',
    workspaceExpanded: 'Collapse',
    workspaceCollapsedTitle: 'Expand workspace list',
    workspaceExpandedTitle: 'Collapse workspace list',
    restoredWorkspacePrefix: 'Restored Workspace ',
    restartingAgent: 'Restarting {agent}',
    currentThemeTitle: 'Current theme: {theme}',
    currentLanguageTitle: 'Current language: {language}',
    themeLightLabel: 'Light',
    themeDarkLabel: 'Dark',
    languageLabelZh: '中文',
    languageLabelEn: 'English',
    workspaceTitle: 'Workspace {index}',
    restoredWorkspaceTitle: 'Restored Workspace {index}',
    workspaceHintFocusedTab: 'Focused browser tab binding',
    workspaceHintRecovered: 'Recovered from host',
    unsetLaunchArgs: 'Not set',
    promptClaudeLaunchArgs: 'Enter default launch options for Claude panes.',
    promptCodexLaunchArgs: 'Enter default launch options for Codex panes.',
    errorOnlyClaudeCodex: 'Only Claude and Codex panes support launch options.',
    promptPaneLaunchArgs: '{agent} pane launch options\nLeave empty to use defaults.\nCurrent default: {default}',
    confirmRestartPane: 'Restart this {agent} pane now to apply new settings?',
    promptWorkspaceName: 'Workspace name',
    errorEmptyWorkspaceName: 'Workspace name cannot be empty.',
    errorNoActiveTabToBind: 'No active tab available to bind.',
    errorClosePanelFailed: 'Failed to close side panel.',
    errorMaxPanesReached: 'A workspace can have at most {max} panes.',
    errorInvalidPort: 'Enter a port between 1 and 65535.',
    errorInvalidPortInteger: 'Enter an integer port between 1 and 65535.',
    statusConnectingTo: 'Connecting to {url}...',
    statusConnectedTo: 'Connected to {url}',
    errorCannotConnectTo: 'Could not connect to {url}',
    statusExited: 'Exited',
    statusTabUnavailable: 'Bound tab unavailable',
  },
};

type TranslationSet = typeof translations.zh;

function currentTranslations(): TranslationSet {
  return translations[panelState.language];
}

function formatMessage(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (result, [key, value]) => result.replaceAll(`{${key}}`, String(value)),
    template,
  );
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
  if (hint === '关联当前标签页' || hint === 'Focused browser tab binding') {
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
  const statusSource = (statusText.dataset.statusSource as LocalizableStatusSource | undefined) || 'custom';
  if (statusSource === 'connection') {
    statusText.textContent = localizeStatusMessage(connectionStatusState, statusSource);
  }

  // Update focused binding text
  if (focusedBinding.textContent === '未选中面板' || focusedBinding.textContent === 'No Pane Selected') {
    focusedBinding.textContent = t.noFocusedPane;
  }

  // Update port label
  const portLabel = document.getElementById('ws-port-label');
  if (portLabel) portLabel.textContent = t.portLabel;

  // Update buttons
  btnApplyPort.textContent = t.applyButton;
  btnApplyPort.title = t.applyPortTitle;
  btnReconnect.title = t.reconnectTitle;
  btnLaunchDefaults.textContent = t.launchDefaultsButton;
  btnLaunchDefaults.title = t.launchDefaultsTitle;
  btnAddShellPane.textContent = t.addShellButton;
  btnAddShellPane.title = t.addShellTitle;
  btnAddClaudePane.textContent = t.addClaudeButton;
  btnAddClaudePane.title = t.addClaudeTitle;
  btnAddCodexPane.textContent = t.addCodexButton;
  btnAddCodexPane.title = t.addCodexTitle;
  btnTogglePanel.textContent = t.closePanelButton;
  btnTogglePanel.title = t.closePanelTitle;

  const workspaceToggle = document.getElementById('workspace-rail-edge-toggle');
  if (workspaceToggle) {
    workspaceToggle.textContent = panelState.railCollapsed ? t.workspaceCollapsed : t.workspaceExpanded;
    workspaceToggle.title = panelState.railCollapsed ? t.workspaceCollapsedTitle : t.workspaceExpandedTitle;
  }
}

function updateThemeToggleButton(): void {
  const t = currentTranslations();
  const currentTheme = panelState.theme;
  const themeText = themeLabel(currentTheme);
  btnThemeToggle.textContent = themeText;
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
  btnLanguageToggle.textContent = languageText;
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
  document.body.classList.remove('panel-collapsed');
  document.body.classList.toggle('rail-collapsed', panelState.railCollapsed);

  btnTogglePanel.textContent = t.closePanelButton;
  btnTogglePanel.title = t.closePanelTitle;

  workspaceRailEdgeToggle.textContent = panelState.railCollapsed ? t.workspaceCollapsed : t.workspaceExpanded;
  workspaceRailEdgeToggle.title = panelState.railCollapsed
    ? t.workspaceCollapsedTitle
    : t.workspaceExpandedTitle;
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

async function loadState(): Promise<void> {
  const stored = await storageGet<Record<string, unknown | null>>({
    [PANEL_STATE_STORAGE_KEY]: null,
    [WS_PORT_STORAGE_KEY]: DEFAULT_WS_PORT,
  });

  const legacyPort = String(stored[WS_PORT_STORAGE_KEY] ?? DEFAULT_WS_PORT);
  const legacyTheme = localStorage.getItem('ccTheme');
  portInput.value = normalizePort(legacyPort) ?? DEFAULT_WS_PORT;

  const rawState = stored[PANEL_STATE_STORAGE_KEY] as PersistedPanelState | null;
  panelState = rawState ? ensureValidState(rawState, portInput.value) : createDefaultState(portInput.value);
  panelState.launchDefaults = {
    ...emptyLaunchConfig(),
    ...panelState.launchDefaults,
  };
  panelState.panes.forEach((pane) => {
    pane.launchOverrides = {
      ...emptyLaunchConfig(),
      ...pane.launchOverrides,
    };
  });
  panelState.theme = normalizeTheme(rawState?.theme ?? legacyTheme ?? panelState.theme);
  panelState.language = normalizeLanguage(rawState?.language ?? panelState.language);
  panelState.wsPort = portInput.value;
  panelState.railWidth = clampRailWidth(panelState.railWidth);
  panelState.panelCollapsed = false;

  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  activePaneId = activeWorkspace?.paneIds[0] || panelState.panes[0]?.paneId || null;
}

async function saveState(): Promise<void> {
  panelState.wsPort = portInput.value;
  panelState.railWidth = clampRailWidth(panelState.railWidth);
  await storageSet({
    [PANEL_STATE_STORAGE_KEY]: panelState,
    [WS_PORT_STORAGE_KEY]: panelState.wsPort,
  });
}

function getOrCreateTerminalView(sessionId: string): TerminalView {
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
  return view;
}

function disposeTerminalView(sessionId: string): void {
  const view = terminalViews.get(sessionId);
  if (!view) return;
  view.dispose();
  terminalViews.delete(sessionId);
}

function sendToHost(message: object): void {
  if (!isWsOpen()) return;
  ws!.send(JSON.stringify(message));
}

function resetConnection(): void {
  const current = ws;
  ws = null;
  if (current) current.close();
  chunkAssembler.clear();
}

function connect(): void {
  const t = currentTranslations();
  const wsUrl = getConfiguredWsUrl();
  if (!wsUrl) {
    setStatus('error', t.errorInvalidPort);
    return;
  }

  setConnectionStatus('connecting', wsUrl);
  try {
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      setConnectionStatus('connected', wsUrl);
      sendToHost({ type: 'session_list_request' });
      ensurePaneSessions();
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
      setConnectionStatus('disconnected');
      render();
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      setConnectionStatus('error', wsUrl);
    };
  } catch (error) {
    setStatus('error', error instanceof Error ? error.message : String(error));
    ws = null;
  }
}

function handleHostMessage(message: SessionOutputMessage | SessionSnapshotMessage | StatusMessage | any): void {
  switch (message.type) {
    case 'session_output': {
      const view = getOrCreateTerminalView(message.sessionId);
      view.writeBase64(message.data);
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
      pane.bindingTabId = snapshot.binding.tabId;
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
    const t = translations[panelState.language];
    const workspace = createWorkspace(panelState.workspaces.length);
    workspace.title = `${t.restoredWorkspacePrefix}${panelState.workspaces.length + 1}`;
    workspace.hint = t.workspaceHintRecovered;

    unknownSnapshots.forEach((snapshot, index) => {
      const pane = createPane(workspace.workspaceId, snapshot.agentType, index);
      pane.sessionId = snapshot.sessionId;
      pane.title = snapshot.title;
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
  const t = translations[panelState.language];
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
  const t = translations[panelState.language];
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
  const t = translations[panelState.language];
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

function focusTerminalSession(sessionId: string): void {
  requestAnimationFrame(() => {
    terminalViews.get(sessionId)?.focus();
  });
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
      focusTerminalSession(pane.sessionId);
    }
    return;
  }
  activePaneId = paneId;
  syncActivePaneUi();
  if (shouldFocusTerminal) {
    focusTerminalSession(pane.sessionId);
  }
}

function ensureActiveWorkspace() {
  let workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (workspace) {
    return workspace;
  }

  workspace = createWorkspace(panelState.workspaces.length);
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
  const t = translations[panelState.language];
  const view = getOrCreateTerminalView(pane.sessionId);
  view.writeln(`\x1b[33m[ClaudeChrome] ${t.restartingAgent.replace('{agent}', agentLabel(agentType))}\x1b[0m`);
  sendToHost({
    type: 'session_restart',
    sessionId: pane.sessionId,
    agentType,
    launchArgs: getEffectiveLaunchArgs(pane, agentType),
  });
}

function editLaunchDefaults(): void {
  const t = translations[panelState.language];
  const nextClaude = window.prompt(t.promptClaudeLaunchArgs, panelState.launchDefaults.claude);
  if (nextClaude === null) {
    return;
  }
  const nextCodex = window.prompt(t.promptCodexLaunchArgs, panelState.launchDefaults.codex);
  if (nextCodex === null) {
    return;
  }

  panelState.launchDefaults.claude = nextClaude.trim();
  panelState.launchDefaults.codex = nextCodex.trim();
  void saveState();
  render();
}

function editPaneLaunchArgs(pane: PaneLayout): void {
  const t = translations[panelState.language];
  const launchAgent = launchConfigAgentType(pane.agentType);
  if (!launchAgent) {
    setStatus('error', t.errorOnlyClaudeCodex);
    return;
  }

  const defaultArgs = panelState.launchDefaults[launchAgent].trim() || t.unsetLaunchArgs;
  const nextValue = window.prompt(
    t.promptPaneLaunchArgs.replace('{agent}', agentLabel(pane.agentType)).replace('{default}', defaultArgs),
    pane.launchOverrides[launchAgent],
  );
  if (nextValue === null) {
    return;
  }

  pane.launchOverrides[launchAgent] = nextValue.trim();
  void saveState();
  render();

  if (sessionSnapshots.has(pane.sessionId) && window.confirm(t.confirmRestartPane.replace('{agent}', agentLabel(pane.agentType)))) {
    restartPaneSession(pane);
  }
}

function renameActiveWorkspace(): void {
  const t = translations[panelState.language];
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
      const t = translations[panelState.language];
      throw new Error(t.errorNoActiveTabToBind);
    }

    pane.bindingTabId = bindingTab.tabId;
    const view = getOrCreateTerminalView(pane.sessionId);
    const size = view.getSize();
    const createMessage: SessionCreateMessage = {
      type: 'session_create',
      sessionId: pane.sessionId,
      agentType: pane.agentType,
      title: pane.title,
      binding: {
        kind: 'tab',
        tabId: bindingTab.tabId,
      },
      cols: Math.max(size.cols, 80),
      rows: Math.max(size.rows, 24),
      launchArgs: getEffectiveLaunchArgs(pane),
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
    const t = translations[panelState.language];
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
  const t = translations[panelState.language];
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
  addButton.textContent = t.addWorkspaceButton;
  addButton.title = t.addWorkspaceTitle;
  addButton.addEventListener('click', () => {
    addWorkspace();
  });

  const renameButton = document.createElement('button');
  renameButton.className = 'workspace-rail-button';
  renameButton.type = 'button';
  renameButton.textContent = t.renameButton;
  renameButton.title = t.renameWorkspaceTitle;
  renameButton.disabled = !activeWorkspace;
  renameButton.addEventListener('click', () => {
    renameActiveWorkspace();
  });

  const colorButton = document.createElement('button');
  colorButton.className = 'workspace-rail-button workspace-rail-color';
  colorButton.type = 'button';
  colorButton.textContent = t.colorButton;
  colorButton.title = t.colorWorkspaceTitle;
  colorButton.disabled = !activeWorkspace;
  colorButton.style.setProperty('--workspace-accent', activeWorkspace?.accentColor || 'transparent');
  colorButton.addEventListener('click', () => {
    editActiveWorkspaceColor();
  });

  const collapseButton = document.createElement('button');
  collapseButton.className = 'workspace-rail-button workspace-rail-collapse';
  collapseButton.type = 'button';
  collapseButton.textContent = t.collapseButton;
  collapseButton.title = t.collapseWorkspaceTitle;
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
  const t = translations[panelState.language];
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
    badge.className = 'agent-badge';
    badge.textContent = agentLabel(pane.agentType);

    const select = document.createElement('select');
    select.className = 'pane-agent-select';
    select.innerHTML = `
      <option value="shell">${t.shellOption}</option>
      <option value="claude">Claude</option>
      <option value="codex">Codex</option>
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
      getOrCreateTerminalView(pane.sessionId).clear();
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
    btnGo.textContent = t.switchToTab;
    btnGo.title = t.switchToTabTitle;
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
    btnBind.className = 'focus-only';
    btnBind.textContent = t.bindCurrentTab;
    btnBind.title = t.bindCurrentTabTitle;
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
        getOrCreateTerminalView(pane.sessionId).writeln(`\x1b[36m[ClaudeChrome] ${t.boundToTab}${nextLabel}\x1b[0m`);
        await saveState();
        render();
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));
      }
    });

    const launchAgent = launchConfigAgentType(pane.agentType);
    let btnArgs: HTMLButtonElement | null = null;
    if (launchAgent) {
      btnArgs = document.createElement('button');
      btnArgs.textContent = pane.launchOverrides[launchAgent].trim() ? t.launchArgsButtonCustom : t.launchArgsButton;
      btnArgs.title = pane.launchOverrides[launchAgent].trim()
        ? t.launchArgsCustomTitle.replace('{agent}', agentLabel(pane.agentType))
        : t.launchArgsDefaultTitle.replace('{agent}', agentLabel(pane.agentType));
      btnArgs.addEventListener('click', (event) => {
        event.stopPropagation();
        editPaneLaunchArgs(pane);
      });
    }

    const btnRestart = document.createElement('button');
    btnRestart.textContent = t.restartButton;
    btnRestart.addEventListener('click', (event) => {
      event.stopPropagation();
      restartPaneSession(pane);
    });

    const btnClose = document.createElement('button');
    btnClose.textContent = t.closeButton;
    btnClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closePane(pane.paneId);
    });

    actions.appendChild(binding);
    actions.appendChild(status);
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

    const view = getOrCreateTerminalView(pane.sessionId);
    view.mount(body);

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
  applyTheme();
  updateLanguageToggleButton();
  updateUILanguage();
  applyRailWidth();
  applyLayoutState();
  renderWorkspaceRail();
  renderWorkspaceStage();
  updateFocusedBindingChip();
  scheduleFit();
  if (sessionIdToRefocus) {
    focusTerminalSession(sessionIdToRefocus);
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
  const t = translations[panelState.language];
  const workspace = ensureActiveWorkspace();
  if (workspace.paneIds.length >= MAX_PANES_PER_WORKSPACE) {
    setStatus('error', t.errorMaxPanesReached.replace('{max}', String(MAX_PANES_PER_WORKSPACE)));
    return;
  }

  const pane = createPane(workspace.workspaceId, agentType, workspace.paneIds.length);
  workspace.paneIds.push(pane.paneId);
  panelState.panes.push(pane);
  normalizeWorkspacePaneRatios(panelState, workspace.workspaceId);
  activePaneId = pane.paneId;
  void saveState();
  render();
  void ensurePaneSession(pane);
}

function addWorkspace(): void {
  const workspace = createWorkspace(panelState.workspaces.length);
  const pane = createPane(workspace.workspaceId, 'claude', 0);
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
  editLaunchDefaults();
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

window.addEventListener('resize', handleViewportResize);
window.addEventListener('pagehide', notifyPanelClosed);

attachRailResizeHandler();

void (async () => {
  await loadState();
  render();
  notifyPanelOpened();
  connect();
})();
