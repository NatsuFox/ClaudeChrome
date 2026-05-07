export const IMPLEMENTED_SESSION_TOOLS = [
  'browser__get_requests',
  'browser__get_request_detail',
  'browser__search_responses',
  'browser__get_console_logs',
  'browser__get_page_info',
  'browser__get_page_text',
  'browser__get_page_html',
  'browser__list_tabs',
  'browser__status',
  'browser__session_context',
  'browser__binding_status',
  'browser__capabilities',
  'browser__capture_policy',
  'browser__capture_stats',
  'browser__explain_unavailable',
  'browser__self_check',
  'browser__screenshot',
  'browser__navigate',
  'browser__reload',
  'browser__get_page_content',
  'browser__find_elements',
  'browser__evaluate_js',
  'browser__click',
  'browser__type',
  'browser__scroll',
  'browser__wait_for',
  'browser__get_cookies',
  'browser__get_storage',
  'browser__get_selection',
  'browser__set_element_text',
  'browser__set_element_html',
  'browser__set_element_style',
  'browser__add_element_class',
  'browser__remove_element_class',
  'browser__get_computed_style',
  'browser__get_element_properties',
  'browser__highlight_element',
] as const;

export type ImplementedSessionTool = (typeof IMPLEMENTED_SESSION_TOOLS)[number];

const BROWSER_TOOL_PREFIX = 'browser__';

export function codexMcpToolName(toolName: string): string {
  return toolName.startsWith(BROWSER_TOOL_PREFIX)
    ? toolName.slice(BROWSER_TOOL_PREFIX.length)
    : toolName;
}

export function legacyMcpToolName(toolName: string): string {
  return toolName.startsWith(BROWSER_TOOL_PREFIX)
    ? toolName
    : `${BROWSER_TOOL_PREFIX}${toolName}`;
}
