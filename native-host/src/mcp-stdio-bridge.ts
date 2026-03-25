#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';

const SOCKET_PATH = process.env.CLAUDECHROME_STORE_SOCKET || '/tmp/claudechrome/store.sock';
const SESSION_ID = process.env.CLAUDECHROME_SESSION_ID;

function queryStore(tool: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error('Timeout'));
    }, 5000);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const client = net.createConnection(SOCKET_PATH, () => {
      const msg = JSON.stringify({ sessionId: SESSION_ID, tool, params });
      client.end(msg + '\n');
    });

    let data = '';
    client.on('data', (chunk) => { data += chunk.toString(); });
    client.on('end', () => {
      finish(() => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve({ error: 'Failed to parse response' });
        }
      });
    });
    client.on('error', (err) => {
      finish(() => {
        reject(new Error(`Store connection failed: ${err.message}`));
      });
    });
  });
}

async function main() {
  if (!SESSION_ID) {
    throw new Error('Missing CLAUDECHROME_SESSION_ID');
  }

  const server = new McpServer({
    name: 'claudechrome-browser',
    version: '0.1.0',
  });

  server.tool(
    'browser__get_requests',
    'List captured HTTP requests from the browser tab bound to this session',
    {
      url_pattern: z.string().optional().describe('Regex to filter URLs'),
      method: z.string().optional().describe('HTTP method filter'),
      status_range: z.string().optional().describe('Status range like "200-299"'),
      include_bodies: z.boolean().optional().describe('Include request/response bodies'),
    },
    async (params) => {
      const result = await queryStore('get_requests', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__get_request_detail',
    'Get full details of a captured HTTP request from the browser tab bound to this session',
    { request_id: z.string().describe('Request ID from get_requests') },
    async (params) => {
      const result = await queryStore('get_request_detail', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__search_responses',
    'Search response bodies by regex pattern in the browser tab bound to this session',
    {
      body_pattern: z.string().describe('Regex to search response bodies'),
      content_type: z.string().optional().describe('Filter by content type'),
    },
    async (params) => {
      const result = await queryStore('search_responses', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__get_console_logs',
    'Get captured browser console output from the browser tab bound to this session',
    {
      level: z.string().optional().describe('Filter by level'),
      limit: z.number().optional().describe('Max entries (default 100)'),
      pattern: z.string().optional().describe('Regex to filter messages'),
    },
    async (params) => {
      const result = await queryStore('get_console_logs', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__get_page_info',
    'Get current page identity and direct-capture summary for the browser tab bound to this session',
    {},
    async () => {
      const result = await queryStore('get_page_info', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__get_page_text',
    'Get visible page text captured directly from the live DOM in the browser tab bound to this session',
    {
      max_chars: z.number().optional().describe('Maximum number of characters to return (default 40000)'),
    },
    async (params) => {
      const result = await queryStore('get_page_text', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__get_page_html',
    'Get live page HTML captured directly from the browser tab bound to this session',
    {
      max_chars: z.number().optional().describe('Maximum number of characters to return (default 40000)'),
    },
    async (params) => {
      const result = await queryStore('get_page_html', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__status',
    'Get host, transport, collector, and session health for the browser tab bound to this session',
    {},
    async () => {
      const result = await queryStore('get_status', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__binding_status',
    'Get the current tab binding and page context status for this session',
    {},
    async () => {
      const result = await queryStore('get_binding_status', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__capabilities',
    'List which browser MCP tool families are currently available for this session',
    {},
    async () => {
      const result = await queryStore('get_capabilities', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__capture_stats',
    'Get capture counts, timestamps, and related browser context statistics for this session',
    {},
    async () => {
      const result = await queryStore('get_capture_stats', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__explain_unavailable',
    'Explain why a browser tool or capability is unavailable for this session',
    {
      target: z.string().describe('Tool name or capability family to explain'),
    },
    async (params) => {
      const result = await queryStore('explain_unavailable', params);
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  server.tool(
    'browser__self_check',
    'Run a diagnostic self-check for the browser context bound to this session',
    {},
    async () => {
      const result = await queryStore('self_check', {});
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP bridge error: ${err.message}\n`);
  process.exit(1);
});
