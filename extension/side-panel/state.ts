import type { AgentLaunchConfig, AgentType } from '../shared/types';

export type PanelTheme = 'dark' | 'light';

export interface WorkspaceTab {
  workspaceId: string;
  title: string;
  hint: string;
  accentColor: string;
  paneIds: string[];
}

export interface PaneLayout {
  paneId: string;
  workspaceId: string;
  sessionId: string;
  title: string;
  sizeRatio: number;
  agentType: AgentType;
  bindingTabId: number | null;
  launchOverrides: AgentLaunchConfig;
}

export interface PersistedPanelState {
  activeWorkspaceId: string;
  workspaces: WorkspaceTab[];
  panes: PaneLayout[];
  launchDefaults: AgentLaunchConfig;
  theme: PanelTheme;
  wsPort: string;
  railWidth: number;
  railCollapsed: boolean;
  panelCollapsed: boolean;
}

const ACCENT_COLORS = ['#7aa2f7', '#9ece6a', '#e0af68', '#f7768e', '#7dcfff', '#bb9af7'];
const DEFAULT_RAIL_WIDTH = 152;
const DEFAULT_CODEX_LAUNCH_ARGS = '-a never -s danger-full-access';

function createEmptyLaunchConfig(): AgentLaunchConfig {
  return {
    claude: '',
    codex: DEFAULT_CODEX_LAUNCH_ARGS,
  };
}

function colorForIndex(index: number): string {
  return ACCENT_COLORS[index % ACCENT_COLORS.length];
}

function workspaceTitle(index: number): string {
  return `工作区 ${index + 1}`;
}

function paneTitle(agentType: AgentType, index: number): string {
  const label = agentType === 'codex'
    ? 'Codex'
    : agentType === 'shell'
      ? '终端'
      : 'Claude';
  return `${label} ${index + 1}`;
}

function localizeLegacyWorkspaceTitle(title: string): string {
  const normalMatch = /^Workspace (\d+)$/.exec(title);
  if (normalMatch) {
    return `工作区 ${normalMatch[1]}`;
  }

  const recoveredMatch = /^Recovered (\d+)$/.exec(title);
  if (recoveredMatch) {
    return `恢复工作区 ${recoveredMatch[1]}`;
  }

  return title;
}

function localizeLegacyWorkspaceHint(hint: string): string {
  if (hint === 'Focused browser tab binding') {
    return '关联当前标签页';
  }
  if (hint === 'Recovered from host') {
    return '从主机恢复';
  }
  return hint;
}

function localizeLegacyPaneTitle(title: string): string {
  const match = /^(Claude|Codex|Shell) (\d+)$/.exec(title);
  if (!match) {
    return title;
  }

  const label = match[1] === 'Shell' ? '终端' : match[1];
  return `${label} ${match[2]}`;
}

export function createWorkspace(index: number): WorkspaceTab {
  return {
    workspaceId: crypto.randomUUID(),
    title: workspaceTitle(index),
    hint: '关联当前标签页',
    accentColor: colorForIndex(index),
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
    bindingTabId: null,
    launchOverrides: createEmptyLaunchConfig(),
  };
}

export function createDefaultState(wsPort: string): PersistedPanelState {
  const workspace = createWorkspace(0);
  const pane = createPane(workspace.workspaceId, 'claude', 0);
  workspace.paneIds.push(pane.paneId);
  return {
    activeWorkspaceId: workspace.workspaceId,
    workspaces: [workspace],
    panes: [pane],
    launchDefaults: createEmptyLaunchConfig(),
    theme: 'dark',
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
      paneIds: [...workspace.paneIds],
    })),
    panes: state.panes.map((pane) => ({
      ...pane,
      title: localizeLegacyPaneTitle(pane.title),
      launchOverrides: {
        ...createEmptyLaunchConfig(),
        ...(pane.launchOverrides || {}),
      },
    })),
    launchDefaults: {
      ...createEmptyLaunchConfig(),
      ...(state.launchDefaults || {}),
    },
    theme: state.theme === 'light' ? 'light' : 'dark',
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
