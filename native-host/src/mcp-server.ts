import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ContextStore } from './context-store.js';

export function createMcpServer(_store: ContextStore): McpServer {
  const server = new McpServer({
    name: 'claudechrome-browser',
    version: '0.1.0',
  });

  const notAvailable = (name: string) => ({
    content: [{ type: 'text' as const, text: `${name} is unavailable in direct mode. Use the session-aware mcp-stdio-bridge instead.` }],
  });

  server.tool(
    'browser__get_requests',
    'List captured HTTP requests from the browser',
    {
      url_pattern: z.string().optional(),
      method: z.string().optional(),
      status_range: z.string().optional(),
      include_bodies: z.boolean().optional(),
    },
    async () => notAvailable('browser__get_requests')
  );

  server.tool(
    'browser__get_request_detail',
    'Get full details of a captured HTTP request',
    { request_id: z.string() },
    async () => notAvailable('browser__get_request_detail')
  );

  server.tool(
    'browser__search_responses',
    'Search response bodies by regex pattern',
    {
      body_pattern: z.string(),
      content_type: z.string().optional(),
    },
    async () => notAvailable('browser__search_responses')
  );

  server.tool(
    'browser__get_console_logs',
    'Get captured browser console output',
    {
      level: z.string().optional(),
      limit: z.number().optional(),
      pattern: z.string().optional(),
    },
    async () => notAvailable('browser__get_console_logs')
  );

  server.tool(
    'browser__get_page_info',
    'Get current page URL, title, and metadata',
    {},
    async () => notAvailable('browser__get_page_info')
  );

  return server;
}
