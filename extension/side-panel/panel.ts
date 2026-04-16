import { ChunkAssembler } from '../shared/chunker';
import type {
  ActivateTabResultMessage,
  AgentLaunchConfig,
  AgentStartupOptions,
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
  ensureValidState,
  getPane,
  getPanesForWorkspace,
  getWorkspace,
  hasExplicitStartupOptions,
  normalizeWorkspacePaneRatios,
  removePane,
  removeWorkspace,
  startupOptionsEqual,
  type PaneLayout,
  type PanelLanguage,
  type PanelTheme,
  type PersistedPanelState,
} from './state';
import { encodeUtf8ToBase64 } from '../shared/base64';
import { TerminalView } from './terminal-view';
import { ConfigPanel } from './config-panel';
import { formatPanelMessage, getPanelLocale, type PanelLocaleText } from './lexicon';

const DEFAULT_WS_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = '9999';
const PANEL_STATE_STORAGE_KEY = 'panelStateV2';
const WS_PORT_STORAGE_KEY = 'wsPort';
const CAPTURE_SETTINGS_STORAGE_KEY = 'ccCaptureSettings';
const MAX_PANES_PER_WORKSPACE = 6;
const MIN_PANE_RATIO = 0.14;
const MIN_RAIL_WIDTH = 96;
const MAX_RAIL_WIDTH = 320;
const RAIL_AUTO_COLLAPSE_WIDTH = 56;
const PANEL_AUTO_COLLAPSE_WIDTH = 72;
const PANEL_AUTO_COLLAPSE_ARM_WIDTH = 144;
const PANEL_STATE_FILE_LOAD_TIMEOUT_MS = 3000;

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
const sessionSnapshots = new Map<string, SessionSnapshot>();
const pendingSessionCreates = new Set<string>();
const pendingWorkingDirectoryValidations = new Map<string, PendingWorkingDirectoryValidation>();
const pendingPanelStateFileLoads = new Map<string, PendingPanelStateFileLoad>();
const configPanel = new ConfigPanel();

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

  btnApplyPort.textContent = t.applyButton;
  btnApplyPort.title = t.applyPortTitle;
  btnApplyPort.setAttribute('aria-label', t.applyPortTitle);
  btnReconnect.textContent = t.reconnectButton;
  btnReconnect.title = t.reconnectTitle;
  btnReconnect.setAttribute('aria-label', t.reconnectTitle);
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

  configPanel.setLanguage(panelState.language);
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
  btnToggleBodyCapture.textContent = enabled ? t.captureToggleOn : t.captureToggleOff;
  btnToggleBodyCapture.title = enabled
    ? t.captureEnabledTitle
    : t.captureDisabledTitle;
  btnToggleBodyCapture.setAttribute('aria-label', btnToggleBodyCapture.title);
  btnToggleBodyCapture.setAttribute('aria-pressed', String(enabled));
  btnToggleBodyCapture.classList.toggle('capture-enabled', enabled);
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

function handleHostMessage(message: SessionOutputMessage | SessionSnapshotMessage | StatusMessage | any): void {
  switch (message.type) {
    case 'session_output': {
      const view = getOrCreateTerminalView(message.sessionId, sessionSnapshots.get(message.sessionId)?.agentType);
      if (message.reset) {
        view.clear();
      }
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
  sendToHost({
    type: 'session_restart',
    sessionId: pane.sessionId,
    agentType,
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
    badge.className = 'agent-badge';
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
      getOrCreateTerminalView(pane.sessionId, nextAgent).clear();
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
      btnArgs.textContent = hasPaneOverrides ? t.settingsButtonCustom : t.settingsButton;
      btnArgs.title = hasPaneOverrides
        ? t.settingsCustomTitle.replace('{agent}', agentLabel(pane.agentType))
        : t.settingsDefaultTitle.replace('{agent}', agentLabel(pane.agentType));
      btnArgs.addEventListener('click', (event) => {
        event.stopPropagation();
        editPaneStartupOptions(pane);
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

    const view = getOrCreateTerminalView(pane.sessionId, pane.agentType);
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
  updateCaptureToggleButton();
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
  const t = currentTranslations();
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
  const sourceWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  const workspace = createWorkspace(panelState.workspaces.length, sourceWorkspace?.defaultAgentType ?? 'claude');
  const pane = createPane(workspace.workspaceId, workspace.defaultAgentType, 0);
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
