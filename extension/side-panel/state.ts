import type { AgentLaunchConfig, AgentStartupOptions, AgentType, LaunchConfigAgentType } from '../shared/types';
import { DEFAULT_PANEL_LANGUAGE, formatPanelMessage, getDefaultPanelLocale } from './lexicon';

export type PanelTheme = 'dark' | 'light';
export type PanelLanguage = 'zh' | 'en';
export type AgentViewMode = 'chat' | 'terminal';
export type ChatAgentType = 'claude' | 'codex';
export type PanelPageId = 'workspace' | 'settings' | 'plugins';

export interface WorkspaceTab {
  workspaceId: string;
  title: string;
  hint: string;
  accentColor: string;
  defaultAgentType: AgentType;
  paneIds: string[];
}

export interface PaneLayout {
  paneId: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  sizeRatio: number;
  agentType: AgentType;
  agentViewMode: AgentViewMode;
  bindingTabId: number | null;
  launchOverrides: AgentLaunchConfig;
}

export interface PersistedPanelState {
  activeWorkspaceId: string;
  workspaces: WorkspaceTab[];
  panes: PaneLayout[];
  launchDefaults: AgentLaunchConfig;
  activePageId: PanelPageId;
  claudeDefaultViewMode: AgentViewMode;
  codexDefaultViewMode: AgentViewMode;
  shellWorkingDirectory: string;
  updatedAt: number;
  theme: PanelTheme;
  language: PanelLanguage;
  wsPort: string;
  railWidth: number;
  railCollapsed: boolean;
  panelCollapsed: boolean;
}

const ACCENT_COLORS = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#bb9af7'];
const DEFAULT_RAIL_WIDTH = 196;
export const DEFAULT_CODEX_LAUNCH_ARGS = '-a never -s workspace-write';

const defaultPanelText = getDefaultPanelLocale();

export function createStartupOptions(initialLaunchArgs = ''): AgentStartupOptions {
  return {
    launchArgs: initialLaunchArgs,
    workingDirectory: '',
    systemPromptMode: 'default',
    customSystemPrompt: '',
    apiBaseUrl: '',
    apiKey: '',
    model: '',
  };
}

export function createDefaultLaunchConfig(): AgentLaunchConfig {
  return {
    claude: createStartupOptions(),
    codex: createStartupOptions(DEFAULT_CODEX_LAUNCH_ARGS),
  };
}

export function createOverrideLaunchConfig(): AgentLaunchConfig {
  return {
    claude: createStartupOptions(),
    codex: createStartupOptions(),
  };
}

export function cloneStartupOptions(options: AgentStartupOptions): AgentStartupOptions {
  return {
    launchArgs: options.launchArgs,
    workingDirectory: options.workingDirectory,
    systemPromptMode: options.systemPromptMode,
    customSystemPrompt: options.customSystemPrompt,
    apiBaseUrl: options.apiBaseUrl ?? '',
    apiKey: options.apiKey ?? '',
    model: options.model ?? '',
  };
}

export function cloneLaunchConfig(config: AgentLaunchConfig): AgentLaunchConfig {
  return {
    claude: cloneStartupOptions(config.claude),
    codex: cloneStartupOptions(config.codex),
  };
}

export function hasExplicitStartupOptions(options: AgentStartupOptions): boolean {
  return Boolean(
    options.launchArgs.trim()
    || options.workingDirectory.trim()
    || options.systemPromptMode !== 'default'
    || options.customSystemPrompt.trim()
    || options.apiBaseUrl?.trim()
    || options.apiKey?.trim()
    || options.model?.trim(),
  );
}

export function startupOptionsEqual(left: AgentStartupOptions, right: AgentStartupOptions): boolean {
  return left.launchArgs.trim() === right.launchArgs.trim()
    && left.workingDirectory.trim() === right.workingDirectory.trim()
    && left.systemPromptMode === right.systemPromptMode
    && left.customSystemPrompt.trim() === right.customSystemPrompt.trim()
    && (left.apiBaseUrl ?? '').trim() === (right.apiBaseUrl ?? '').trim()
    && (left.apiKey ?? '').trim() === (right.apiKey ?? '').trim()
    && (left.model ?? '').trim() === (right.model ?? '').trim();
}

export function clearLaunchConfigAgent(config: AgentLaunchConfig, agentType: LaunchConfigAgentType): AgentLaunchConfig {
  const next = cloneLaunchConfig(config);
  next[agentType] = createStartupOptions();
  return next;
}

function colorForIndex(index: number): string {
  return ACCENT_COLORS[index % ACCENT_COLORS.length];
}

function workspaceTitle(index: number): string {
  return formatPanelMessage(defaultPanelText.workspaceTitle, { index: index + 1 });
}

function paneTitle(agentType: AgentType, index: number): string {
  const label = agentType === 'codex'
    ? defaultPanelText.agentLabelCodex
    : agentType === 'shell'
      ? defaultPanelText.agentLabelShell
      : defaultPanelText.agentLabelClaude;
  return `${label} ${index + 1}`;
}

function normalizeWorkspaceDefaultAgentType(value: unknown): AgentType {
  if (value === 'codex' || value === 'shell') {
    return value;
  }
  return 'claude';
}

function localizeLegacyWorkspaceTitle(title: string): string {
  const normalMatch = /^Workspace (\d+)$/.exec(title);
  if (normalMatch) {
    return formatPanelMessage(defaultPanelText.workspaceTitle, { index: normalMatch[1] });
  }

  const recoveredMatch = /^Recovered (\d+)$/.exec(title);
  if (recoveredMatch) {
    return formatPanelMessage(defaultPanelText.restoredWorkspaceTitle, { index: recoveredMatch[1] });
  }

  return title;
}

function localizeLegacyWorkspaceHint(hint: string): string {
  if (hint === 'Focused browser tab binding' || hint === 'Linked to current tab') {
    return defaultPanelText.workspaceHintFocusedTab;
  }
  if (hint === 'Recovered from host') {
    return defaultPanelText.workspaceHintRecovered;
  }
  return hint;
}

function localizeLegacyPaneTitle(title: string): string {
  const match = /^(Claude|Codex|Shell) (\d+)$/.exec(title);
  if (!match) {
    return title;
  }

  const label = match[1] === 'Shell'
    ? defaultPanelText.agentLabelShell
    : match[1] === 'Codex'
      ? defaultPanelText.agentLabelCodex
      : defaultPanelText.agentLabelClaude;
  return `${label} ${match[2]}`;
}

export function createWorkspace(index: number, defaultAgentType: AgentType = 'claude'): WorkspaceTab {
  return {
    workspaceId: crypto.randomUUID(),
    title: workspaceTitle(index),
    hint: defaultPanelText.workspaceHintFocusedTab,
    accentColor: colorForIndex(index),
    defaultAgentType,
    paneIds: [],
  };
}

export function createPane(workspaceId: string, agentType: AgentType, index: number): PaneLayout {
  return {
    paneId: crypto.randomUUID(),
    workspaceId,
    sessionId: crypto.randomUUID(),
    title: paneTitle(agentType, index),
    sizeRatio: 1,
    agentType,
    agentViewMode: defaultAgentViewMode(agentType),
    bindingTabId: null,
    launchOverrides: createOverrideLaunchConfig(),
  };
}

export function defaultAgentViewMode(agentType: AgentType): AgentViewMode {
  return agentType === 'claude' || agentType === 'codex' ? 'chat' : 'terminal';
}

export function defaultAgentViewModeForState(state: Pick<PersistedPanelState, 'claudeDefaultViewMode' | 'codexDefaultViewMode'>, agentType: AgentType): AgentViewMode {
  if (agentType === 'claude') {
    return normalizeAgentViewMode('claude', state.claudeDefaultViewMode);
  }
  return agentType === 'codex' ? normalizeAgentViewMode('codex', state.codexDefaultViewMode) : 'terminal';
}

export function normalizeAgentViewMode(agentType: AgentType, value: unknown): AgentViewMode {
  if (agentType !== 'claude' && agentType !== 'codex') {
    return 'terminal';
  }
  return value === 'terminal' ? 'terminal' : 'chat';
}

export function normalizePanelPageId(value: unknown): PanelPageId {
  if (value === 'settings' || value === 'plugins') {
    return value;
  }
  return 'workspace';
}

export function createDefaultState(wsPort: string): PersistedPanelState {
  const workspace = createWorkspace(0);
  const pane = createPane(workspace.workspaceId, workspace.defaultAgentType, 0);
  workspace.paneIds.push(pane.paneId);
  return {
    activeWorkspaceId: workspace.workspaceId,
    workspaces: [workspace],
    panes: [pane],
    launchDefaults: createDefaultLaunchConfig(),
    activePageId: 'workspace',
    claudeDefaultViewMode: 'chat',
    codexDefaultViewMode: 'chat',
    shellWorkingDirectory: '',
    updatedAt: 0,
    theme: 'dark',
    language: DEFAULT_PANEL_LANGUAGE as PanelLanguage,
    wsPort,
    railWidth: DEFAULT_RAIL_WIDTH,
    railCollapsed: false,
    panelCollapsed: false,
  };
}

export function getWorkspace(state: PersistedPanelState, workspaceId: string): WorkspaceTab | undefined {
  return state.workspaces.find((workspace) => workspace.workspaceId === workspaceId);
}

export function getPane(state: PersistedPanelState, paneId: string): PaneLayout | undefined {
  return state.panes.find((pane) => pane.paneId === paneId);
}

export function getPanesForWorkspace(state: PersistedPanelState, workspaceId: string): PaneLayout[] {
  const workspace = getWorkspace(state, workspaceId);
  if (!workspace) return [];
  const paneById = new Map(state.panes.map((pane) => [pane.paneId, pane]));
  return workspace.paneIds.map((paneId) => paneById.get(paneId)).filter((pane): pane is PaneLayout => Boolean(pane));
}

export function normalizeWorkspacePaneRatios(state: PersistedPanelState, workspaceId: string): void {
  const panes = getPanesForWorkspace(state, workspaceId);
  if (panes.length === 0) return;

  const total = panes.reduce((sum, pane) => sum + (pane.sizeRatio > 0 ? pane.sizeRatio : 0), 0);
  if (total <= 0) {
    const ratio = 1 / panes.length;
    panes.forEach((pane) => {
      pane.sizeRatio = ratio;
    });
    return;
  }

  panes.forEach((pane) => {
    pane.sizeRatio = pane.sizeRatio / total;
  });
}

export function removePane(state: PersistedPanelState, paneId: string): void {
  const pane = getPane(state, paneId);
  if (!pane) return;
  const workspace = getWorkspace(state, pane.workspaceId);
  if (workspace) {
    workspace.paneIds = workspace.paneIds.filter((id) => id !== paneId);
  }
  state.panes = state.panes.filter((entry) => entry.paneId !== paneId);
  if (workspace && workspace.paneIds.length > 0) {
    normalizeWorkspacePaneRatios(state, workspace.workspaceId);
  }
}

export function removeWorkspace(state: PersistedPanelState, workspaceId: string): void {
  const workspace = getWorkspace(state, workspaceId);
  if (!workspace) return;
  const paneIds = new Set(workspace.paneIds);
  state.workspaces = state.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
  state.panes = state.panes.filter((pane) => !paneIds.has(pane.paneId));
  if (state.activeWorkspaceId === workspaceId) {
    state.activeWorkspaceId = state.workspaces[0]?.workspaceId || '';
  }
}

export function ensureValidState(state: PersistedPanelState, fallbackPort: string): PersistedPanelState {
  const nextState: PersistedPanelState = {
    activeWorkspaceId: state.activeWorkspaceId,
    workspaces: state.workspaces.map((workspace) => ({
      ...workspace,
      title: localizeLegacyWorkspaceTitle(workspace.title),
      hint: localizeLegacyWorkspaceHint(workspace.hint),
      defaultAgentType: normalizeWorkspaceDefaultAgentType((workspace as any).defaultAgentType),
      paneIds: [...workspace.paneIds],
    })),
    panes: state.panes.map((pane) => ({
      ...pane,
      title: localizeLegacyPaneTitle(pane.title),
      agentViewMode: normalizeAgentViewMode(pane.agentType, (pane as any).agentViewMode),
      launchOverrides: migrateLaunchConfig(pane.launchOverrides, 'overrides'),
    })),
    launchDefaults: migrateLaunchConfig(state.launchDefaults, 'defaults'),
    activePageId: normalizePanelPageId((state as any).activePageId),
    claudeDefaultViewMode: normalizeAgentViewMode('claude', (state as any).claudeDefaultViewMode),
    codexDefaultViewMode: normalizeAgentViewMode('codex', (state as any).codexDefaultViewMode),
    shellWorkingDirectory: typeof (state as any).shellWorkingDirectory === 'string'
      ? (state as any).shellWorkingDirectory
      : '',
    updatedAt: typeof (state as any).updatedAt === 'number'
      ? (state as any).updatedAt
      : 0,
    theme: state.theme === 'light' ? 'light' : 'dark',
    language: (state as any).language === 'en'
      ? 'en'
      : DEFAULT_PANEL_LANGUAGE as PanelLanguage,
    wsPort: state.wsPort || fallbackPort,
    railWidth: typeof state.railWidth === 'number' ? state.railWidth : DEFAULT_RAIL_WIDTH,
    railCollapsed: typeof state.railCollapsed === 'boolean' ? state.railCollapsed : false,
    panelCollapsed: typeof state.panelCollapsed === 'boolean' ? state.panelCollapsed : false,
  };

  nextState.workspaces = nextState.workspaces.filter((workspace) => workspace.paneIds.length > 0);
  nextState.panes = nextState.panes.filter((pane) => nextState.workspaces.some((workspace) => workspace.workspaceId === pane.workspaceId));

  if (nextState.workspaces.length === 0 && nextState.panes.length === 0) {
    nextState.activeWorkspaceId = '';
    return nextState;
  }

  if (nextState.workspaces.length === 0 || nextState.panes.length === 0) {
    return createDefaultState(fallbackPort);
  }

  if (!nextState.workspaces.some((workspace) => workspace.workspaceId === nextState.activeWorkspaceId)) {
    nextState.activeWorkspaceId = nextState.workspaces[0].workspaceId;
  }

  nextState.workspaces.forEach((workspace) => normalizeWorkspacePaneRatios(nextState, workspace.workspaceId));
  return nextState;
}

function migrateLaunchConfig(config: any, kind: 'defaults' | 'overrides'): AgentLaunchConfig {
  const base = kind === 'defaults' ? createDefaultLaunchConfig() : createOverrideLaunchConfig();

  if (!config) {
    return base;
  }

  if (typeof config.claude === 'string') {
    base.claude.launchArgs = config.claude;
  } else if (config.claude && typeof config.claude === 'object') {
    base.claude = { ...base.claude, ...config.claude };
  }

  if (typeof config.codex === 'string') {
    base.codex.launchArgs = config.codex;
  } else if (config.codex && typeof config.codex === 'object') {
    base.codex = { ...base.codex, ...config.codex };
  }

  base.claude.apiBaseUrl = typeof base.claude.apiBaseUrl === 'string' ? base.claude.apiBaseUrl : '';
  base.claude.apiKey = typeof base.claude.apiKey === 'string' ? base.claude.apiKey : '';
  base.claude.model = typeof base.claude.model === 'string' ? base.claude.model : '';
  base.codex.apiBaseUrl = typeof base.codex.apiBaseUrl === 'string' ? base.codex.apiBaseUrl : '';
  base.codex.apiKey = typeof base.codex.apiKey === 'string' ? base.codex.apiKey : '';
  base.codex.model = typeof base.codex.model === 'string' ? base.codex.model : '';

  return base;
}
