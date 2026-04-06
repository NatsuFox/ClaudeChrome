export type BrowserContextTemplateId = 'session_identity' | 'tool_routing' | 'multitab_contract' | 'fallback_policy';
export type BrowserContextPresetId = 'compact' | 'tool_first' | 'multitab_safe';

export interface BrowserContextTargetInfo {
  bindingTabId: number;
  boundTabTitle?: string;
  boundTabUrl?: string;
}

interface BrowserContextPreset {
  id: BrowserContextPresetId;
  systemPromptTemplates: BrowserContextTemplateId[];
  channels: Array<'launch_prompt' | 'session_notice' | 'mcp_session_context'>;
  description: string;
}

const PRESETS: Record<BrowserContextPresetId, BrowserContextPreset> = {
  compact: {
    id: 'compact',
    systemPromptTemplates: ['session_identity', 'tool_routing'],
    channels: ['launch_prompt', 'mcp_session_context'],
    description: 'Compact browser-attached session guidance.',
  },
  tool_first: {
    id: 'tool_first',
    systemPromptTemplates: ['session_identity', 'tool_routing', 'fallback_policy'],
    channels: ['launch_prompt', 'session_notice', 'mcp_session_context'],
    description: 'Tool-routing-first browser guidance.',
  },
  multitab_safe: {
    id: 'multitab_safe',
    systemPromptTemplates: ['session_identity', 'tool_routing', 'multitab_contract', 'fallback_policy'],
    channels: ['launch_prompt', 'session_notice', 'mcp_session_context'],
    description: 'Structured browser guidance with explicit multi-tab safety rules.',
  },
};

const DEFAULT_PRESET_ID: BrowserContextPresetId = 'multitab_safe';

function truncate(value: string | undefined, maxLength = 200): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.length <= maxLength) {
    return trimmed;
  }
  return `${trimmed.slice(0, maxLength - 1)}…`;
}

export function resolveBrowserContextPreset(preferred?: string): BrowserContextPreset {
  const raw = (preferred || process.env.CLAUDECHROME_BROWSER_CONTEXT_PRESET || DEFAULT_PRESET_ID).trim();
  return PRESETS[raw as BrowserContextPresetId] || PRESETS[DEFAULT_PRESET_ID];
}

export function summarizeBoundTabLabel(target: BrowserContextTargetInfo): string {
  const title = truncate(target.boundTabTitle, 120);
  const url = truncate(target.boundTabUrl, 120);
  const label = title || url;
  if (!label) {
    return `tab #${target.bindingTabId}`;
  }
  return `tab #${target.bindingTabId} (${label})`;
}

export function buildBrowserContextContractDescriptor(target: BrowserContextTargetInfo, preferredPreset?: string) {
  const preset = resolveBrowserContextPreset(preferredPreset);
  return {
    presetId: preset.id,
    presetDescription: preset.description,
    channels: [...preset.channels],
    systemPromptTemplates: [...preset.systemPromptTemplates],
    sessionMode: 'browser_attached',
    targetingModel: 'session_default_tab_with_per_call_override',
    sessionDefaultTabId: target.bindingTabId,
    targetMayChange: true,
    currentTargetKind: 'tab',
    perCallTabId: {
      supported: true,
      defaultBehavior: 'fall back to the session default tab when tab_id is omitted',
      responseField: 'resolved_tab_id',
    },
    crossTabPolicy: {
      reads: 'easy',
      writes: 'explicit',
      rule: 'Cross-tab reads can use an explicit tab_id override. Cross-tab writes must use an explicit tab_id.',
    },
    controls: {
      activateTabTool: 'browser__activate_tab',
      bindTabTool: 'browser__bind_tab',
      listTabsTool: 'browser__list_tabs',
      bindingStatusTool: 'browser__binding_status',
      sessionContextTool: 'browser__session_context',
    },
  };
}

export function buildBrowserSessionGuidance(target: BrowserContextTargetInfo, requireAck = false, preferredPreset?: string): string {
  const preset = resolveBrowserContextPreset(preferredPreset);
  const contract = buildBrowserContextContractDescriptor(target, preset.id);
  const lines: string[] = [
    'ClaudeChrome browser-attached session contract:',
    `- session_mode: ${contract.sessionMode}`,
    `- targeting_model: ${contract.targetingModel}`,
    `- session_default_tab: tab #${target.bindingTabId}`,
  ];

  const title = truncate(target.boundTabTitle);
  const url = truncate(target.boundTabUrl);
  if (title) {
    lines.push(`- session_default_tab_title: ${title}`);
  }
  if (url) {
    lines.push(`- session_default_tab_url: ${url}`);
  }

  for (const template of preset.systemPromptTemplates) {
    switch (template) {
      case 'session_identity':
        lines.push('- this is a browser-attached session, not a detached local browser automation session');
        lines.push('- references like "this page", "here", and "the current tab" resolve against the session default tab unless an explicit tab_id is provided');
        break;
      case 'tool_routing':
        lines.push('- use claudechrome-browser MCP tools first for page content, DOM, browser requests, console output, cookies, storage, screenshots, and page actions');
        lines.push('- prefer browser__session_context, browser__binding_status, or browser__get_page_content when the task depends on current browser context');
        lines.push('- prefer browser__find_elements, browser__click, browser__type, browser__scroll, and browser__wait_for for live DOM interaction');
        break;
      case 'multitab_contract':
        lines.push('- the session keeps a default tab, but most browser tools support explicit tab_id overrides');
        lines.push('- if tab_id is omitted, the tool should fall back to the session default tab');
        lines.push('- use browser__list_tabs to inspect or choose other tabs, browser__activate_tab for focus-sensitive work, and browser__bind_tab only when you want to change the session default tab');
        lines.push('- cross-tab reads can be easy; cross-tab writes must be explicit');
        lines.push('- the session default tab may change during the session via rebind, so re-check browser__session_context or browser__binding_status after target changes');
        break;
      case 'fallback_policy':
        lines.push('- every tab-scoped tool response should be interpreted using resolved_tab_id');
        lines.push('- before falling back to generic web fetches or external/headless browser tools, check browser__capabilities or browser__explain_unavailable');
        lines.push('- avoid external/headless browser tools when ClaudeChrome browser MCP tools can satisfy the task');
        lines.push('- do not make code or filesystem changes until the user asks');
        break;
    }
  }

  if (requireAck) {
    lines.push('- reply with one short readiness note and then wait for the next user instruction');
  }

  return lines.join('\n');
}

export function buildBrowserSessionNotice(target: BrowserContextTargetInfo, preferredPreset?: string): string {
  const preset = resolveBrowserContextPreset(preferredPreset);
  const contract = buildBrowserContextContractDescriptor(target, preset.id);
  return `Browser-attached session active on ${summarizeBoundTabLabel(target)}. Preset=${contract.presetId}. Default tab fallback is enabled, explicit tab_id overrides are supported, and cross-tab writes must be explicit.`;
}

export function buildBrowserRetargetNotice(target: BrowserContextTargetInfo, preferredPreset?: string): string {
  const preset = resolveBrowserContextPreset(preferredPreset);
  const contract = buildBrowserContextContractDescriptor(target, preset.id);
  return `Browser target updated to ${summarizeBoundTabLabel(target)}. Preset=${contract.presetId}. Re-check browser__session_context or browser__binding_status before page-specific actions, and use explicit tab_id for cross-tab writes.`;
}
