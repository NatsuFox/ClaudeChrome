# ClaudeChrome

ClaudeChrome brings local coding agents into the browser itself.

It runs Claude, Codex, or a plain shell inside a Chrome side panel, binds each session to a live browser tab, and injects browser-native context into that session through a local MCP bridge. Instead of copying URLs, DOM text, request payloads, console logs, or cookies back and forth by hand, the agent can work against the tab it is attached to.

> Status: active development. The multi-pane side panel, session binding, browser context capture, and native host bridge are implemented. The higher-agency browser control surface is present in the repo and under active iteration.

## Visual tour

This README intentionally reserves space for screenshots, diagrams, and terminal demos.

### Product visuals

Reserved slots:

- Hero image showing the side panel with multiple panes and a live tab binding
- Annotated UI screenshot focused on workspace switching, pane status, and `Rebind` / `Go` controls
- Polished architecture diagram that complements the ASCII diagram later in this README

Suggested asset paths:

- `assets/readme/hero.png`
- `assets/readme/panel-overview.png`
- `assets/readme/architecture.png`

### Terminal recordings

ClaudeChrome is a strong fit for short terminal walkthroughs recorded with `asciinema` and stored as `.cast` files.

Recommended demo slots:

- `assets/readme/casts/01-setup.cast` - first-time setup and extension load
- `assets/readme/casts/02-start-host.cast` - starting the native host and opening the side panel
- `assets/readme/casts/03-pane-workflow.cast` - creating a pane, binding a tab, and switching context
- `assets/readme/casts/04-browser-tools.cast` - running browser-aware agent commands

Recommended README presentation:

- add a poster image or SVG preview for each recording
- link that preview to the `.cast` file or a published asciinema playback page
- keep the `.cast` source alongside the repo so demos stay versioned with the codebase

## Why ClaudeChrome exists

Terminal-first coding agents are powerful, but they are usually blind to what is happening inside the browser:

- What tab is the user actually looking at?
- What requests fired?
- What did the page render?
- What is in the console?
- What is in localStorage, sessionStorage, or cookies?

ClaudeChrome closes that gap with a local architecture:

- A Chrome extension captures browser context from the active tab.
- A native host manages long-lived agent sessions and PTYs.
- A session-scoped MCP bridge exposes browser tools directly to Claude and Codex.
- The side panel becomes a real working surface with multiple tab-bound agent panes.

The result is a tighter loop for debugging, reverse engineering, automation, web app QA, and browser-assisted development.

## Highlights

- Run `Claude`, `Codex`, or `Shell` panes directly inside the Chrome side panel.
- Organize work into multiple workspaces and multiple panes per workspace.
- Bind each pane to a specific browser tab and switch or rebind when needed.
- Capture page identity, visible text, HTML, network traffic, console logs, and tab state.
- Feed that context into a session-local MCP server so the agent sees the browser tab it is actually attached to.
- Support bidirectional browser commands through the native host bridge.
- Keep everything local: browser extension, WebSocket transport, native host, IPC socket, and agent processes all run on the developer machine.

## What is in the repo today

ClaudeChrome is built as two cooperating local components:

1. A Manifest V3 Chrome extension:
   - side panel UI
   - service worker
   - content/page scripts
   - browser context capture
2. A Node.js native host:
   - PTY-backed session manager
   - local WebSocket server for the extension UI
   - IPC store socket for session-aware queries
   - MCP stdio bridge injected into Claude and Codex sessions

### Browser context tools

The native host exposes session-aware inspection tools such as:

- `browser__get_requests`
- `browser__get_request_detail`
- `browser__search_responses`
- `browser__get_console_logs`
- `browser__get_page_info`
- `browser__get_page_text`
- `browser__get_page_html`
- `browser__status`
- `browser__binding_status`
- `browser__capabilities`
- `browser__capture_stats`
- `browser__explain_unavailable`
- `browser__self_check`

These tools operate on the tab bound to the current session rather than on some global browser state.

### Browser command bridge

The repo also includes a browser command bridge and tests covering commands such as:

- `browser__screenshot`
- `browser__navigate`
- `browser__reload`
- `browser__get_page_content`
- `browser__find_elements`
- `browser__evaluate_js`
- `browser__click`
- `browser__type`
- `browser__scroll`
- `browser__wait_for`
- `browser__get_cookies`
- `browser__get_storage`

In other words, ClaudeChrome is not just reading the browser. It is structured to support session-bound browser interaction as well.

## Architecture

```text
+---------------------------+         +-----------------------------------+
| Chrome Tab                |         | Chrome Side Panel                 |
| - DOM                     |         | - Multi-workspace UI              |
| - Network                 |         | - Terminal panes                  |
| - Console                 |         | - Pane <-> tab binding controls   |
+-------------+-------------+         +----------------+------------------+
              |                                            |
              | content scripts / service worker           | WebSocket
              v                                            v
+-----------------------------------------------------------------------+
| Chrome Extension                                                       |
| - captures page info, requests, console, tab state                    |
| - forwards context updates                                             |
| - receives browser_command messages                                    |
+-------------------------------+---------------------------------------+
                                |
                                | ws://127.0.0.1:9999 by default
                                v
+-----------------------------------------------------------------------+
| Native Host                                                            |
| - session manager                                                      |
| - PTY bridge                                                           |
| - runtime state + context store                                        |
| - IPC socket for session-scoped queries                                |
+-------------------+-----------------------------+----------------------+
                    |                             |
                    | PTY                         | stdio MCP bridge
                    v                             v
         +--------------------+        +-------------------------------+
         | claude / codex     |        | claudechrome-browser MCP      |
         | / bash --login     |        | session-aware browser tools   |
         +--------------------+        +-------------------------------+
```

## Quick start

### Prerequisites

- Google Chrome with Developer Mode enabled in `chrome://extensions`
- Node.js and npm
- `bash` available on the local machine
- `claude` on `PATH` if you want Claude panes
- `codex` on `PATH` if you want Codex panes

Notes:

- The native host install script currently writes Native Messaging manifests to Google Chrome locations. Chromium-family browsers may require manual path adjustments.
- Shell panes do not require Claude or Codex to be installed.

### 1. Install dependencies and build

```bash
npm run setup
npm run build
```

What this does:

- installs root dependencies
- installs native-host dependencies
- builds the native host
- builds the extension into `dist/`

### 2. Load the extension

Open `chrome://extensions`, enable `Developer mode`, then choose `Load unpacked` and select:

```text
dist/
```

Copy the generated extension ID. You will need it for the Native Messaging manifest.

### 3. Register the native host

```bash
npm run install:host
```

This writes a Native Messaging manifest for:

- macOS: `~/Library/Application Support/Google/Chrome/NativeMessagingHosts`
- Linux: `~/.config/google-chrome/NativeMessagingHosts`
- Windows: `~/AppData/Local/Google/Chrome/User Data/NativeMessagingHosts`

The manifest is named:

```text
com.anthropic.claudechrome.json
```

### 4. Add your extension ID to `allowed_origins`

Edit the generated manifest and add your extension origin:

```json
{
  "allowed_origins": [
    "chrome-extension://<YOUR_EXTENSION_ID>/"
  ]
}
```

Without this, Chrome will not allow the extension to talk to the native host.

### 5. Start the native host

```bash
cd native-host
npm run start
```

By default the host listens on:

```text
ws://127.0.0.1:9999
```

### 6. Open ClaudeChrome

- Click the ClaudeChrome extension action.
- The side panel opens.
- Create a workspace or add panes.
- Start a `Claude`, `Codex`, or `Shell` pane.
- The pane binds to the active browser tab.
- Use `Rebind` to attach a pane to a different active tab.
- Use `Go` to focus the bound browser tab again.

## Developer workflow

### Core scripts

From the repo root:

```bash
npm run build
npm run dev
npm run build:host
npm run install:host
npm run package
npm run test
```

What they do:

- `npm run build` builds the extension bundle with webpack
- `npm run dev` runs the extension bundle in webpack watch mode
- `npm run build:host` builds the native host TypeScript project
- `npm run install:host` runs the Native Messaging host installer
- `npm run package` builds both extension and native host
- `npm run test` builds both targets and runs the command bridge tests

Helper shell scripts are also included under `scripts/`.

### Useful environment variables

The native host supports:

- `CLAUDECHROME_WS_HOST` - WebSocket bind host, default `127.0.0.1`
- `CLAUDECHROME_WS_PORT` - WebSocket port, default `9999`
- `CLAUDECHROME_CWD` - working directory for launched agent sessions, default project root

Internal bridge variables are wired automatically per session:

- `CLAUDECHROME_STORE_SOCKET`
- `CLAUDECHROME_SESSION_ID`

## How a session works

Each pane is a long-lived PTY-backed session:

1. The side panel creates or restores a pane.
2. The native host launches `claude`, `codex`, or `bash --login`.
3. If that PTY process exits, the pane closes instead of falling back to a shell.
4. The pane is bound to one browser tab.
5. Browser context for that tab is captured and stored locally.
6. Claude and Codex receive a session-scoped MCP server configuration.
7. MCP queries resolve against the bound tab only.
8. Optional browser commands are routed back through the extension to the browser tab.

This session-bound design matters. It avoids the usual "which tab am I looking at?" confusion that makes browser automation brittle.

## Repository layout

```text
.
├── extension/
│   ├── manifest.json
│   ├── service-worker.ts
│   ├── side-panel/
│   └── shared/
├── native-host/
│   ├── src/
│   └── package.json
├── scripts/
├── webpack.config.js
├── tsconfig.json
└── package.json
```

## Security and trust model

ClaudeChrome is intentionally powerful. Treat it like a local developer tool, not a consumer browser extension.

- The extension requests broad browser access, including tabs, scripting, cookies, web requests, storage, and `<all_urls>`.
- The native host launches local processes and exposes browser context to those processes.
- Claude and Codex panes inherit access to the browser tab they are bound to through the local MCP bridge.
- The host is designed for local development on a machine you control.

Recommended practice:

- use a dedicated browser profile for development
- do not install ClaudeChrome into a shared or untrusted profile
- be deliberate about which tabs you bind to an agent session

## Current limitations

- Packaging is still developer-oriented. Setup is straightforward, but not yet one-click.
- The install script is Chrome-first and may need manual adjustment for Chromium variants.
- `claude` or `codex` started manually from a `Shell` pane do not inherit the session-aware browser bridge; use dedicated Claude or Codex panes when tab linkage matters.
- The project is evolving quickly, so the browser action surface is still being tightened and expanded.
- There is no published release or compatibility matrix yet.

## Troubleshooting

### The side panel says `Disconnected`

Check that:

- `native-host` is running
- the panel port matches the host port
- the host is listening on `127.0.0.1` or the configured override

### Claude or Codex panes do not start

Check that:

- `claude` or `codex` is installed
- the executable is available in a login shell `PATH`
- `bash --login` can see the same CLI you expect ClaudeChrome to launch

### Native Messaging does not connect

Check that:

- the generated manifest exists
- `allowed_origins` contains your exact extension ID origin
- the manifest `path` points to the built host wrapper/script

### The agent has no useful browser context

Check that:

- the pane is bound to the tab you intended
- the page has finished loading
- the extension has permission to operate on that URL

## Where this project can go

ClaudeChrome already has the right foundation for:

- browser-native debugging agents
- QA copilots that inspect real network and console state
- agent-assisted reverse engineering of web apps
- session-bound browser automation with human supervision
- research workflows where the browser is part of the runtime, not just a target

If you want a local coding agent to work with the browser as a first-class environment, this is the shape of the system.
