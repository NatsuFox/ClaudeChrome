#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import * as net from 'node:net';

const SOCKET_PATH = process.env.CLAUDECHROME_STORE_SOCKET || '/tmp/claudechrome/store.sock';
const SESSION_ID = process.env.CLAUDECHROME_SESSION_ID;

function sendCommand(command: string, params: Record<string, unknown>, timeoutMs?: number): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      client.destroy();
      reject(new Error('Timeout'));
    }, (timeoutMs ?? 20000) + 2000);

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      fn();
    };

    const client = net.createConnection(SOCKET_PATH, () => {
      const msg = JSON.stringify({ kind: 'command', sessionId: SESSION_ID, command, params, timeoutMs });
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

  server.tool(
    'browser__screenshot',
    'Take a screenshot of the browser tab bound to this session',
    {
      format: z.enum(['png', 'jpeg']).optional().describe('Image format (default: png)'),
      quality: z.number().optional().describe('JPEG quality 0-100 (default: 90)'),
    },
    async (params) => {
      const result = await sendCommand('screenshot', params);
      if (result.error) return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      return { content: [{ type: 'image', data: result.result.dataUrl.replace(/^data:[^;]+;base64,/, ''), mimeType: result.result.format === 'jpeg' ? 'image/jpeg' : 'image/png' }] };
    }
  );

  server.tool(
    'browser__navigate',
    'Navigate the browser tab bound to this session to a URL',
    {
      url: z.string().describe('URL to navigate to'),
      wait_for_load: z.boolean().optional().describe('Wait for page load to complete (default: true)'),
    },
    async (params) => {
      const result = await sendCommand('navigate', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__reload',
    'Reload the browser tab bound to this session',
    {
      bypass_cache: z.boolean().optional().describe('Bypass the browser cache (default: false)'),
    },
    async (params) => {
      const result = await sendCommand('reload', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__get_page_content',
    'Get the live page content (URL, title, visible text, optionally HTML) from the browser tab bound to this session',
    {
      include_html: z.boolean().optional().describe('Include raw HTML (default: false)'),
      max_chars: z.number().optional().describe('Max characters to return (default: 200000)'),
    },
    async (params) => {
      const result = await sendCommand('get_page_content', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__find_elements',
    'Find DOM elements by CSS selector in the browser tab bound to this session',
    {
      selector: z.string().describe('CSS selector'),
      limit: z.number().optional().describe('Max elements to return (default: 50)'),
    },
    async (params) => {
      const result = await sendCommand('find_elements', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__evaluate_js',
    'Evaluate a JavaScript expression in the browser tab bound to this session and return the result',
    {
      expression: z.string().describe('JavaScript expression to evaluate'),
    },
    async (params) => {
      const result = await sendCommand('evaluate_js', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__click',
    'Click an element in the browser tab bound to this session',
    {
      selector: z.string().optional().describe('CSS selector of the element to click'),
      x: z.number().optional().describe('X coordinate (if no selector)'),
      y: z.number().optional().describe('Y coordinate (if no selector)'),
    },
    async (params) => {
      const result = await sendCommand('click', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__type',
    'Type text into an input element in the browser tab bound to this session',
    {
      selector: z.string().describe('CSS selector of the input element'),
      text: z.string().describe('Text to type'),
      clear: z.boolean().optional().describe('Clear the field before typing (default: false)'),
    },
    async (params) => {
      const result = await sendCommand('type', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__scroll',
    'Scroll the page or an element in the browser tab bound to this session',
    {
      selector: z.string().optional().describe('CSS selector to scroll into view'),
      x: z.number().optional().describe('Horizontal scroll position'),
      y: z.number().optional().describe('Vertical scroll position'),
      behavior: z.enum(['instant', 'smooth']).optional().describe('Scroll behavior (default: instant)'),
    },
    async (params) => {
      const result = await sendCommand('scroll', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__wait_for',
    'Wait for a condition to be met in the browser tab bound to this session',
    {
      condition: z.enum(['load', 'url', 'title', 'selector']).describe('Condition type to wait for'),
      value: z.string().optional().describe('Expected value (for url/title/selector conditions)'),
      timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 10000)'),
    },
    async (params) => {
      const result = await sendCommand('wait_for', params, (params.timeout_ms as number | undefined));
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__get_cookies',
    'Get cookies from the browser tab bound to this session',
    {
      url: z.string().optional().describe('Filter cookies by URL'),
      name: z.string().optional().describe('Filter cookies by name'),
      domain: z.string().optional().describe('Filter cookies by domain'),
    },
    async (params) => {
      const result = await sendCommand('get_cookies', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  server.tool(
    'browser__get_storage',
    'Get localStorage or sessionStorage values from the browser tab bound to this session',
    {
      storage_type: z.enum(['local', 'session', 'both']).optional().describe('Which storage to read (default: both)'),
      keys: z.array(z.string()).optional().describe('Specific keys to retrieve (default: all)'),
    },
    async (params) => {
      const result = await sendCommand('get_storage', params);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    }
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MCP bridge error: ${err.message}\n`);
  process.exit(1);
});
