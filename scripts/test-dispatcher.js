#!/usr/bin/env node
// Unit test for extension/command-dispatcher.ts
// Compiles the dispatcher to a temp CommonJS module, mocks global.chrome,
// and exercises every command without a real browser.
'use strict';

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const ROOT       = path.resolve(__dirname, '..');
const SRC        = path.resolve(ROOT, 'extension/command-dispatcher.ts');
const OUTDIR     = path.resolve(os.tmpdir(), 'claudechrome-test-dispatcher');
const COMPILED   = path.resolve(OUTDIR, 'command-dispatcher.js');
const TSCONFIG   = path.resolve(ROOT, 'tsconfig.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
let passed = 0, failed = 0;

function pass(label) {
  console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  passed++;
}
function fail(label, detail = '') {
  console.error(`  \x1b[31m✗\x1b[0m ${label}${detail ? ': ' + detail : ''}`);
  failed++;
}
function assert(cond, label, detail = '') {
  cond ? pass(label) : fail(label, detail);
}
async function assertOk(promise, label) {
  try {
    const r = await promise;
    pass(`${label} — resolved`);
    return r;
  } catch (e) {
    fail(`${label} — resolved`, e.message);
    return null;
  }
}
async function assertRejects(promise, label, msgFragment = '') {
  try {
    await promise;
    fail(`${label} — expected rejection`);
  } catch (e) {
    const ok = !msgFragment || e.message.includes(msgFragment);
    assert(ok, `${label} — rejected with "${e.message.slice(0, 60)}"`);
  }
}

function isUnserializable(value) {
  if (value === undefined) return true;
  if (typeof value === 'function' || typeof value === 'symbol') return true;
  if (Array.isArray(value)) return value.some(isUnserializable);
  if (value && typeof value === 'object') return Object.values(value).some(isUnserializable);
  return false;
}

// ---------------------------------------------------------------------------
// Step 1: Compile command-dispatcher.ts to CommonJS
// ---------------------------------------------------------------------------
console.log('\n\x1b[1mClaudeChrome — command-dispatcher.ts Unit Tests\x1b[0m');
console.log('='.repeat(52));
console.log('\n[1] Compiling command-dispatcher.ts...');

fs.mkdirSync(OUTDIR, { recursive: true });

try {
  execSync(
    `npx tsc --module commonjs --moduleResolution node \
      --target es2020 --outDir "${OUTDIR}" \
      --skipLibCheck --esModuleInterop \
      --strict false \
      "${SRC}"`,
    { cwd: ROOT, stdio: 'pipe' }
  );
  pass('Compilation succeeded');
} catch (e) {
  fail('Compilation failed', e.stdout?.toString() || e.message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Step 2: Set up chrome global mock
// ---------------------------------------------------------------------------
console.log('\n[2] Setting up chrome API mocks...');

// Canned results for each command:
const TAB = { id: 42, windowId: 1, url: 'https://example.com', title: 'Example', status: 'complete', favIconUrl: '', active: true, pinned: false, audible: false, discarded: false };
const WINDOW_TABS = [
  TAB,
  { id: 43, windowId: 1, url: 'https://example.org', title: 'Example Org', status: 'complete', favIconUrl: '', active: false, pinned: true, audible: false, discarded: false },
  { id: 44, windowId: 2, url: 'https://example.net', title: 'Example Net', status: 'loading', favIconUrl: '', active: true, pinned: false, audible: true, discarded: false },
];
const COOKIE = { name: 'session', value: 'abc', domain: 'example.com', path: '/', secure: true, httpOnly: true, sameSite: 'Strict', session: false, expirationDate: 9999999999 };

global.chrome = {
  tabs: {
    get: (tabId, cb) => cb ? cb(TAB) : Promise.resolve(TAB),
    query: (queryInfo, cb) => {
      let tabs = WINDOW_TABS;
      if (queryInfo?.lastFocusedWindow) tabs = tabs.filter((tab) => tab.windowId === 1);
      if (queryInfo?.active) tabs = tabs.filter((tab) => tab.active);
      if (cb) cb(tabs); else return Promise.resolve(tabs);
    },
    update: (tabId, props, cb) => {
      // For navigate: simulate status complete after update
      const updated = { ...TAB, url: props.url || TAB.url, status: 'complete' };
      if (cb) cb(updated); else return Promise.resolve(updated);
    },
    reload: (tabId, opts, cb) => { if (cb) cb(); else return Promise.resolve(); },
    captureVisibleTab: (windowId, opts) => Promise.resolve('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='),
  },
  scripting: {
    executeScript: ({ func, args }) => {
      const badIndex = (args || []).findIndex(isUnserializable);
      if (badIndex !== -1) {
        return Promise.reject(new Error(
          `Error at parameter 'injection': Error at property 'args': Error at index ${badIndex}: Value is unserializable.`
        ));
      }
      // Execute the function with the given args in-process (no real DOM)
      try {
        // Provide minimal DOM stubs
        const fakeDoc = {
          title: 'Example Domain',
          location: { href: 'https://example.com' },
          body: { innerText: 'Example Domain\nThis domain is for use in illustrative examples.' },
          documentElement: { outerHTML: '<html><body>Example</body></html>' },
          querySelectorAll: (sel) => [{
            tagName: 'H1', id: '', innerText: 'Example Domain',
            getBoundingClientRect: () => ({ toJSON: () => ({ x:0,y:0,width:800,height:40 }) }),
          }],
          querySelector: (sel) => ({
            tagName: 'INPUT', id: '', innerText: '',
            getBoundingClientRect: () => ({ toJSON: () => ({ x:0,y:0,width:200,height:30 }) }),
            click() {}, focus() {},
            value: '',
            dispatchEvent() {},
            scrollIntoView() {},
          }),
          elementFromPoint: (x, y) => ({
            click() {},
            getBoundingClientRect: () => ({ toJSON: () => ({ x,y,width:10,height:10 }) }),
          }),
          scripts: [],
        };
        const fakeWindow = {
          location: { href: 'https://example.com' },
          scrollTo() {},
        };
        const fakeLS = { getItem: (k) => k === 'theme' ? 'dark' : null };
        const fakeLS2 = { getItem: (k) => k === 'draft' ? 'hello' : null };

        // Patch global references the compiled func uses
        const origDocument = global.document;
        const origWindow   = global.window;
        const origLocation = global.location;
        const origLS       = global.localStorage;
        const origSS       = global.sessionStorage;
        global.document      = fakeDoc;
        global.window        = fakeWindow;
        global.location      = fakeDoc.location;
        global.localStorage  = fakeLS;
        global.sessionStorage = fakeLS2;
        // eval is needed by evaluate_js
        // Patch eval so (0, eval)(expr) works in Node.js CJS context
        global.eval = new Proxy(global.eval, {
          apply(_target, _thisArg, argList) {
            // eslint-disable-next-line no-new-func
            try { return Function('return (' + argList[0] + ')')(); } catch(e) { throw e; }
          }
        });

        let result;
        try {
          result = func(...(args || []));
        } finally {
          global.document      = origDocument;
          global.window        = origWindow;
          global.location      = origLocation;
          global.localStorage  = origLS;
          global.sessionStorage = origSS;
        }
        return Promise.resolve([{ result }]);
      } catch (e) {
        return Promise.resolve([{ result: { result: null, error: String(e) } }]);
      }
    },
  },
  cookies: {
    getAll: (details) => Promise.resolve([COOKIE]),
  },
  runtime: {
    lastError: null,
  },
};

pass('chrome global mock installed');

// ---------------------------------------------------------------------------
// Step 3: Load the compiled dispatcher
// ---------------------------------------------------------------------------
console.log('\n[3] Loading compiled dispatcher...');
const { dispatchCommand } = require(COMPILED);
assert(typeof dispatchCommand === 'function', 'dispatchCommand is exported and is a function');

// ---------------------------------------------------------------------------
// Step 4: Test each command
// ---------------------------------------------------------------------------
console.log('\n[4] Testing command coverage...');

async function runTests() {
  // screenshot
  {
    const r = await assertOk(dispatchCommand('screenshot', 42, { format: 'png' }), 'screenshot');
    assert(r?.dataUrl?.startsWith('data:image/png;base64,'), 'screenshot returns valid dataUrl');
    assert(r?.format === 'png', 'screenshot format=png');
  }

  // navigate
  {
    // tabs.get needs to return complete status for navigate to resolve
    global.chrome.tabs.get = (tabId, cb) => {
      if (cb) cb({ ...TAB, status: 'complete' });
      else return Promise.resolve({ ...TAB, status: 'complete' });
    };
    const r = await assertOk(dispatchCommand('navigate', 42, { url: 'https://example.com', wait_for_load: true }), 'navigate');
    assert(typeof r?.url === 'string', 'navigate returns url');
    assert(r?.status === 'complete', 'navigate status=complete');
  }

  // reload
  {
    global.chrome.tabs.reload = (tabId, opts) => Promise.resolve();
    // tabs.get mock already returns complete
    const r = await assertOk(dispatchCommand('reload', 42, {}), 'reload');
    assert(r?.status === 'complete', 'reload status=complete');
  }

  // list_tabs
  {
    const r = await assertOk(dispatchCommand('list_tabs', 42, {}), 'list_tabs');
    assert(Array.isArray(r?.tabs), 'list_tabs returns tabs array');
    assert(r?.count === 2, `list_tabs returns last-focused window tab count (${r?.count})`);
    assert(r?.tabs?.[0]?.tabId === 42, 'list_tabs includes the primary tab');

    const activeOnly = await assertOk(
      dispatchCommand('list_tabs', 42, { window_scope: 'all', active_only: true }),
      'list_tabs active_only'
    );
    assert(activeOnly?.count === 2, `list_tabs active_only returns one active tab per window (${activeOnly?.count})`);
    assert(activeOnly?.tabs?.every((tab) => tab.active === true), 'list_tabs active_only filters to active tabs');
  }

  // get_page_content
  {
    const r = await assertOk(dispatchCommand('get_page_content', 42, {}), 'get_page_content');
    assert(typeof r?.url === 'string', 'get_page_content has url');
    assert(typeof r?.title === 'string', 'get_page_content has title');
    assert(typeof r?.text === 'string', 'get_page_content has text');
  }

  // find_elements
  {
    const r = await assertOk(dispatchCommand('find_elements', 42, { selector: 'h1' }), 'find_elements');
    assert(Array.isArray(r?.elements), 'find_elements returns elements array');
    assert(r.elements.length > 0, 'find_elements returns at least 1 element');
    assert(typeof r.elements[0].tag === 'string', 'element has tag');
  }

  // evaluate_js
  {
    const r = await assertOk(dispatchCommand('evaluate_js', 42, { expression: '1 + 1' }), 'evaluate_js');
    assert(r?.result === 2, `evaluate_js: 1+1=${r?.result}`);
  }

  // evaluate_js error case
  {
    const r = await assertOk(dispatchCommand('evaluate_js', 42, { expression: 'throw new Error("test")' }), 'evaluate_js error case');
    assert(typeof r?.error === 'string', 'evaluate_js captures thrown error');
  }

  // click by selector
  {
    const r = await assertOk(dispatchCommand('click', 42, { selector: '#btn' }), 'click (selector)');
    assert(r?.clicked === true, 'click returns clicked=true');
  }

  // click by coordinates
  {
    const r = await assertOk(dispatchCommand('click', 42, { x: 10, y: 20 }), 'click (coordinates)');
    assert(r?.clicked === true, 'click (coordinates) returns clicked=true');
  }

  // type
  {
    const r = await assertOk(dispatchCommand('type', 42, { selector: 'input', text: 'hello', clear: true }), 'type');
    assert(r?.typed === true, 'type returns typed=true');
  }

  // scroll (window scroll)
  {
    const r = await assertOk(dispatchCommand('scroll', 42, { x: 0, y: 300, behavior: 'smooth' }), 'scroll (window)');
    assert(r?.scrolled === true, 'scroll returns scrolled=true');
  }

  // scroll (element scrollIntoView)
  {
    const r = await assertOk(dispatchCommand('scroll', 42, { selector: 'h1' }), 'scroll (element)');
    assert(r?.scrolled === true, 'scroll (element) returns scrolled=true');
  }

  // wait_for load
  {
    const r = await assertOk(dispatchCommand('wait_for', 42, { condition: 'load', timeout_ms: 3000 }), 'wait_for (load)');
    assert(r?.satisfied === true, 'wait_for load returns satisfied=true');
  }

  // wait_for url match
  {
    const r = await assertOk(dispatchCommand('wait_for', 42, { condition: 'url', value: 'example', timeout_ms: 3000 }), 'wait_for (url)');
    assert(r?.satisfied === true, 'wait_for url returns satisfied=true');
  }

  // get_cookies
  {
    const r = await assertOk(dispatchCommand('get_cookies', 42, {}), 'get_cookies');
    assert(Array.isArray(r?.cookies), 'get_cookies returns array');
    assert(r.cookies[0]?.name === 'session', 'get_cookies returns expected cookie');
  }

  // get_storage
  {
    const r = await assertOk(dispatchCommand('get_storage', 42, { storage_type: 'both' }), 'get_storage');
    assert(typeof r?.localStorage === 'object', 'get_storage returns localStorage object');
    assert(typeof r?.sessionStorage === 'object', 'get_storage returns sessionStorage object');
  }

  // unknown command
  await assertRejects(
    dispatchCommand('does_not_exist', 42, {}),
    'unknown command',
    'Unknown browser command'
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n' + '='.repeat(52));
  console.log(`Results: \x1b[32m${passed} passed\x1b[0m, \x1b[31m${failed} failed\x1b[0m`);
  console.log('='.repeat(52) + '\n');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch((e) => {
  console.error('\nFatal error:', e.message);
  process.exit(1);
});