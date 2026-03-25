import { ChunkAssembler } from '../shared/chunker';
import type {
  ActivateTabResultMessage,
  AgentType,
  GetCurrentWindowActiveTabResultMessage,
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
  type PersistedPanelState,
} from './state';
import { TerminalView } from './terminal-view';

const DEFAULT_WS_HOST = '127.0.0.1';
const DEFAULT_WS_PORT = '9999';
const PANEL_STATE_STORAGE_KEY = 'panelStateV2';
const WS_PORT_STORAGE_KEY = 'wsPort';
const MAX_PANES_PER_WORKSPACE = 6;
const MIN_PANE_RATIO = 0.14;
const MIN_RAIL_WIDTH = 120;
const MAX_RAIL_WIDTH = 320;

const statusIndicator = document.getElementById('status-indicator')!;
const statusText = document.getElementById('status-text')!;
const focusedBinding = document.getElementById('focused-binding')!;
const workspaceStage = document.getElementById('workspace-stage')!;
const workspaceRailResizer = document.getElementById('workspace-rail-resizer')!;
const workspaceRail = document.getElementById('workspace-rail')!;
const panelEdgeToggle = document.getElementById('panel-edge-toggle') as HTMLButtonElement;
const workspaceRailEdgeToggle = document.getElementById('workspace-rail-edge-toggle') as HTMLButtonElement;
const portInput = document.getElementById('ws-port') as HTMLInputElement;
const btnApplyPort = document.getElementById('btn-apply-port')!;
const btnReconnect = document.getElementById('btn-reconnect')!;
const btnNewWorkspace = document.getElementById('btn-new-workspace')!;
const btnAddShellPane = document.getElementById('btn-add-shell-pane')!;
const btnAddClaudePane = document.getElementById('btn-add-claude-pane')!;
const btnAddCodexPane = document.getElementById('btn-add-codex-pane')!;
const btnTogglePanel = document.getElementById('btn-toggle-panel') as HTMLButtonElement;

const chunkAssembler = new ChunkAssembler();
const terminalViews = new Map<string, TerminalView>();
const sessionSnapshots = new Map<string, SessionSnapshot>();
const pendingSessionCreates = new Set<string>();

let panelState = createDefaultState(DEFAULT_WS_PORT);
let activePaneId: string | null = null;
let ws: WebSocket | null = null;

function agentLabel(agentType: AgentType): string {
  switch (agentType) {
    case 'codex':
      return 'Codex';
    case 'shell':
      return 'Shell';
    default:
      return 'Claude';
  }
}

function setStatus(state: 'connected' | 'disconnected' | 'connecting' | 'error', message?: string): void {
  statusIndicator.className = state === 'error' ? 'disconnected' : state;
  statusText.textContent = message || state.charAt(0).toUpperCase() + state.slice(1);
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
  document.body.classList.toggle('panel-collapsed', panelState.panelCollapsed);
  document.body.classList.toggle('rail-collapsed', panelState.railCollapsed);

  btnTogglePanel.textContent = panelState.panelCollapsed ? 'Open Panel' : 'Fold Panel';
  btnTogglePanel.title = panelState.panelCollapsed
    ? 'Expand ClaudeChrome back into view'
    : 'Fold this panel to the browser edge';
  btnTogglePanel.setAttribute('aria-pressed', String(panelState.panelCollapsed));

  panelEdgeToggle.textContent = panelState.panelCollapsed ? 'Open' : 'Fold';
  panelEdgeToggle.title = panelState.panelCollapsed
    ? 'Expand ClaudeChrome back into view'
    : 'Fold this panel to the browser edge';
  panelEdgeToggle.setAttribute('aria-expanded', String(!panelState.panelCollapsed));

  workspaceRailEdgeToggle.textContent = panelState.railCollapsed ? 'Tabs' : 'Hide';
  workspaceRailEdgeToggle.title = panelState.railCollapsed
    ? 'Expand the workspace sidebar'
    : 'Collapse the workspace sidebar';
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

async function loadState(): Promise<void> {
  const stored = await storageGet<Record<string, unknown | null>>({
    [PANEL_STATE_STORAGE_KEY]: null,
    [WS_PORT_STORAGE_KEY]: DEFAULT_WS_PORT,
  });

  const legacyPort = String(stored[WS_PORT_STORAGE_KEY] ?? DEFAULT_WS_PORT);
  portInput.value = normalizePort(legacyPort) ?? DEFAULT_WS_PORT;

  const rawState = stored[PANEL_STATE_STORAGE_KEY] as PersistedPanelState | null;
  panelState = rawState ? ensureValidState(rawState, portInput.value) : createDefaultState(portInput.value);
  panelState.wsPort = portInput.value;
  panelState.railWidth = clampRailWidth(panelState.railWidth);

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
    view = new TerminalView();
    view.onData((data) => {
      const message: SessionInputMessage = {
        type: 'session_input',
        sessionId,
        data: btoa(data),
      };
      sendToHost(message);
    });
    terminalViews.set(sessionId, view);
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
  const wsUrl = getConfiguredWsUrl();
  if (!wsUrl) {
    setStatus('error', 'Port must be 1-65535');
    return;
  }

  setStatus('connecting', `Connecting to ${wsUrl}...`);
  try {
    const socket = new WebSocket(wsUrl);
    ws = socket;

    socket.onopen = () => {
      if (ws !== socket) return;
      setStatus('connected', `Connected: ${wsUrl}`);
      chrome.runtime.sendMessage({ type: 'panel_opened' }, () => void chrome.runtime.lastError);
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
      setStatus('disconnected', 'Disconnected');
      render();
    };

    socket.onerror = () => {
      if (ws !== socket) return;
      setStatus('error', `Cannot connect to ${wsUrl}`);
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
    case 'status': {
      const next = message as StatusMessage;
      setStatus(next.status, next.message);
      break;
    }
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

  const knownSessionIds = new Set(panelState.panes.map((pane) => pane.sessionId));
  const unknownSnapshots = snapshots.filter((snapshot) => !knownSessionIds.has(snapshot.sessionId));
  if (unknownSnapshots.length > 0) {
    const workspace = createWorkspace(panelState.workspaces.length);
    workspace.title = `Recovered ${panelState.workspaces.length + 1}`;
    workspace.hint = 'Recovered from host';

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
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (snapshot?.boundTab) {
    const tab = snapshot.boundTab;
    const label = tab.title || tab.url || `Tab ${tab.tabId}`;
    return `${label} · #${tab.tabId}`;
  }
  if (pane.bindingTabId != null) {
    return `Tab ${pane.bindingTabId}`;
  }
  return 'No bound tab';
}

function buildStatusLabel(pane: PaneLayout): { text: string; className: string } {
  if (pendingSessionCreates.has(pane.sessionId)) {
    return { text: 'Starting session...', className: 'starting' };
  }
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (!snapshot) {
    return { text: isWsOpen() ? 'Pending session' : 'Waiting for host', className: 'disconnected' };
  }
  return {
    text: snapshot.statusMessage || snapshot.status.replace(/_/g, ' '),
    className: snapshot.status,
  };
}

function updateFocusedBindingChip(): void {
  const pane = activePaneId ? getPane(panelState, activePaneId) : undefined;
  if (!pane) {
    focusedBinding.textContent = 'No focused pane';
    return;
  }
  const snapshot = sessionSnapshots.get(pane.sessionId);
  if (snapshot?.boundTab) {
    focusedBinding.textContent = `${agentLabel(snapshot.agentType)} -> ${snapshot.boundTab.title || snapshot.boundTab.url || `Tab ${snapshot.boundTab.tabId}`}`;
    return;
  }
  focusedBinding.textContent = `${agentLabel(pane.agentType)} -> ${buildBindingLabel(pane)}`;
}

function focusPane(paneId: string, shouldFocusTerminal = true): void {
  activePaneId = paneId;
  render();
  if (shouldFocusTerminal) {
    const pane = getPane(panelState, paneId);
    if (pane) {
      requestAnimationFrame(() => {
        terminalViews.get(pane.sessionId)?.focus();
      });
    }
  }
}

function activeWorkspaceOrThrow() {
  const workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!workspace) {
    throw new Error('No active workspace');
  }
  return workspace;
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
      throw new Error('No active browser tab available for binding.');
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
    if (!panelState.panelCollapsed) {
      fitVisibleTerminals();
    }
    updateFocusedBindingChip();
  });
}

function setPanelCollapsed(collapsed: boolean): void {
  if (panelState.panelCollapsed === collapsed) {
    return;
  }
  panelState.panelCollapsed = collapsed;
  void saveState();
  render();
}

function togglePanelCollapsed(): void {
  setPanelCollapsed(!panelState.panelCollapsed);
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
    document.body.classList.add('rail-resizing');
    const startX = event.clientX;
    const startWidth = panelState.railWidth;

    const onMove = (moveEvent: PointerEvent) => {
      const delta = startX - moveEvent.clientX;
      panelState.railWidth = clampRailWidth(startWidth + delta);
      applyRailWidth();
    };

    const onUp = () => {
      document.body.classList.remove('rail-resizing');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      void saveState();
      scheduleFit();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });
}

function renderWorkspaceRail(): void {
  workspaceRail.replaceChildren();

  const header = document.createElement('div');
  header.className = 'workspace-rail-header';

  const title = document.createElement('span');
  title.className = 'workspace-rail-title';
  title.textContent = 'Workspaces';

  const collapseButton = document.createElement('button');
  collapseButton.className = 'workspace-rail-collapse';
  collapseButton.type = 'button';
  collapseButton.textContent = 'Hide';
  collapseButton.title = 'Collapse the workspace sidebar';
  collapseButton.addEventListener('click', () => {
    setRailCollapsed(true);
  });

  header.appendChild(title);
  header.appendChild(collapseButton);
  workspaceRail.appendChild(header);

  panelState.workspaces.forEach((workspace) => {
    const button = document.createElement('button');
    button.className = `workspace-tab${workspace.workspaceId === panelState.activeWorkspaceId ? ' active' : ''}`;
    button.style.borderLeftColor = workspace.accentColor;
    button.innerHTML = `
      <span class="workspace-tab-title">${workspace.title}</span>
      <span class="workspace-tab-hint">${workspace.hint}</span>
      <span class="workspace-tab-count">${workspace.paneIds.length} pane${workspace.paneIds.length === 1 ? '' : 's'}</span>
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
  workspaceStage.replaceChildren();
  const workspace = getWorkspace(panelState, panelState.activeWorkspaceId);
  if (!workspace) {
    const empty = document.createElement('div');
    empty.className = 'empty-stage';
    empty.textContent = 'No workspace available';
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
      <option value="shell">Shell</option>
      <option value="claude">Claude</option>
      <option value="codex">Codex</option>
    `;
    select.value = pane.agentType;
    select.addEventListener('change', () => {
      const nextAgent = select.value as AgentType;
      if (nextAgent === pane.agentType) return;
      if (!window.confirm(`Restart this pane as ${agentLabel(nextAgent)}?`)) {
        select.value = pane.agentType;
        return;
      }
      pane.agentType = nextAgent;
      const restartMessage: SessionRestartMessage = {
        type: 'session_restart',
        sessionId: pane.sessionId,
        agentType: nextAgent,
      };
      const view = getOrCreateTerminalView(pane.sessionId);
      view.clear();
      view.writeln(`\x1b[33m[ClaudeChrome] Restarting as ${agentLabel(nextAgent)}\x1b[0m`);
      sendToHost(restartMessage);
      void saveState();
      render();
    });

    const title = document.createElement('span');
    title.className = 'pane-title';
    title.textContent = pane.title;

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
    btnGo.textContent = 'Go';
    btnGo.title = 'Activate the bound browser tab';
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
    btnBind.textContent = 'Rebind';
    btnBind.title = 'Bind this pane to the currently active browser tab';
    btnBind.addEventListener('click', async (event) => {
      event.stopPropagation();
      try {
        const target = await requestCurrentActiveTab();
        if (!target) {
          throw new Error('No active browser tab available.');
        }
        const currentLabel = buildBindingLabel(pane);
        const nextLabel = target.title || target.url || `Tab ${target.tabId}`;
        if (!window.confirm(`Rebind this terminal from ${currentLabel} to ${nextLabel}?`)) {
          return;
        }
        pane.bindingTabId = target.tabId;
        const bindMessage: SessionBindTabMessage = {
          type: 'session_bind_tab',
          sessionId: pane.sessionId,
          tabId: target.tabId,
        };
        sendToHost(bindMessage);
        getOrCreateTerminalView(pane.sessionId).writeln(`\x1b[36m[ClaudeChrome] Bound to ${nextLabel}\x1b[0m`);
        await saveState();
        render();
      } catch (error) {
        setStatus('error', error instanceof Error ? error.message : String(error));
      }
    });

    const btnRestart = document.createElement('button');
    btnRestart.textContent = 'Restart';
    btnRestart.addEventListener('click', (event) => {
      event.stopPropagation();
      const view = getOrCreateTerminalView(pane.sessionId);
      view.writeln(`\x1b[33m[ClaudeChrome] Restarting ${agentLabel(pane.agentType)}\x1b[0m`);
      sendToHost({ type: 'session_restart', sessionId: pane.sessionId });
    });

    const btnClose = document.createElement('button');
    btnClose.textContent = 'Close';
    btnClose.disabled = panelState.panes.length <= 1;
    btnClose.addEventListener('click', (event) => {
      event.stopPropagation();
      closePane(pane.paneId);
    });

    actions.appendChild(binding);
    actions.appendChild(status);
    actions.appendChild(btnGo);
    actions.appendChild(btnBind);
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
  applyRailWidth();
  applyLayoutState();
  renderWorkspaceRail();
  renderWorkspaceStage();
  updateFocusedBindingChip();
  scheduleFit();
}

function closePane(paneId: string): void {
  if (panelState.panes.length <= 1) {
    return;
  }

  const pane = getPane(panelState, paneId);
  if (!pane) return;
  const workspace = getWorkspace(panelState, pane.workspaceId);
  if (!workspace) return;

  sendToHost({ type: 'session_close', sessionId: pane.sessionId });
  disposeTerminalView(pane.sessionId);
  sessionSnapshots.delete(pane.sessionId);

  removePane(panelState, paneId);
  if (workspace.paneIds.length === 0) {
    removeWorkspace(panelState, workspace.workspaceId);
  }

  const activeWorkspace = getWorkspace(panelState, panelState.activeWorkspaceId) || panelState.workspaces[0];
  panelState.activeWorkspaceId = activeWorkspace.workspaceId;
  activePaneId = activeWorkspace.paneIds[0] || null;
  void saveState();
  render();
}

function addPane(agentType: AgentType): void {
  const workspace = activeWorkspaceOrThrow();
  if (workspace.paneIds.length >= MAX_PANES_PER_WORKSPACE) {
    setStatus('error', `Workspace pane limit is ${MAX_PANES_PER_WORKSPACE}.`);
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
  const port = normalizePort(portInput.value);
  if (!port) {
    setStatus('error', 'Port must be an integer between 1 and 65535.');
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

btnNewWorkspace.addEventListener('click', () => {
  addWorkspace();
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

btnTogglePanel.addEventListener('click', () => {
  togglePanelCollapsed();
});

panelEdgeToggle.addEventListener('click', () => {
  setPanelCollapsed(false);
});

workspaceRailEdgeToggle.addEventListener('click', () => {
  toggleRailCollapsed();
});

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'context_update') {
    sendToHost(message);
  }
});

window.addEventListener('resize', () => {
  scheduleFit();
});

attachRailResizeHandler();

void (async () => {
  await loadState();
  render();
  connect();
})();
