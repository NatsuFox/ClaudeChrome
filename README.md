# ClaudeChrome

<p align="center">
  <img src="assets/logo-transparent.png" alt="ClaudeChrome logo" width="180" />
</p>

ClaudeChrome is a browser-native framework for bringing agent intelligence into Chrome instead of leaving the agent outside the page you are actually working on.

Today it embeds Claude, Codex, and shell workflows directly into Chrome; over time it is meant to support more mainstream browsers as well. The important idea is broader than web debugging: ClaudeChrome keeps the agent attached to the live page so it can crawl sites, execute JavaScript, mimic native styles from existing websites, ingest content into knowledge systems, and sustain longer interactive workflows without forcing manual context transfer back into a separate terminal.

## Demo gallery

The README uses the smaller `readme_mp4` recordings for inline playback, arranged as a six-demo gallery. Each entry keeps its quick-view GIF and HD promo MP4 alongside the embedded version.

<table>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 1 · 2048</strong><br>
      This demo focuses on the tool's capacity for continuous, complex interactions with visual elements in a gaming environment. It shows that ClaudeChrome can remain inside a long-running stateful loop instead of stopping at one-shot page reads.<br><br>
      <video src="assets/demo/readme_mp4/demo%202048_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%202048.gif">demo 2048.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%202048_promo.mp4">demo 2048_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 2 · Amazon</strong><br>
      This demo primarily showcases ClaudeChrome's web crawling capabilities, including its interaction ability to handle page transitions and scrolling on a real commercial page.<br><br>
      <video src="assets/demo/readme_mp4/demo%20amazon_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20amazon.gif">demo amazon.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20amazon_promo.mp4">demo amazon_promo.mp4</a>
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 3 · LinuxDo</strong><br>
      This demo is tailored for the LinuxDo forum. It illustrates how ClaudeChrome can crawl forum content and execute JavaScript commands according to user instructions while remaining grounded in the active thread.<br><br>
      <video src="assets/demo/readme_mp4/demo%20linuxdo_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20linuxdo.gif">demo linuxdo.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20linuxdo_promo.mp4">demo linuxdo_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 4 · OpenClaw</strong><br>
      This demo highlights ClaudeChrome's browser extension capabilities. It can mimic existing websites to design similar styles natively, which is much more convenient and accurate than traditional methods like manually copying stylesheets.<br><br>
      <video src="assets/demo/readme_mp4/demo%20openclaw_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20openclaw.gif">demo openclaw.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20openclaw_promo.mp4">demo openclaw_promo.mp4</a>
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <strong>Demo 5 · Tapestry & Text Selection</strong><br>
      This demo focuses on integration with our earlier Tapestry project: it ingests page content directly into the knowledge base without calling Tapestry's built-in crawlers, and it also demonstrates actions driven by selected text on the page.<br><br>
      <video src="assets/demo/readme_mp4/demo%20tapestry%20%26%20texts%20selection_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20tapestry%20%26%20texts%20selection.gif">demo tapestry &amp; texts selection.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20tapestry%20%26%20texts%20selection_promo.mp4">demo tapestry &amp; texts selection_promo.mp4</a>
    </td>
    <td valign="top" width="50%">
      <strong>Demo 6 · V2EX</strong><br>
      This second forum-focused demo complements the LinuxDo example. It shows ClaudeChrome crawling V2EX content and executing JavaScript commands on the page in response to user instructions.<br><br>
      <video src="assets/demo/readme_mp4/demo%20v2ex_readme.mp4" controls autoplay muted loop playsinline preload="metadata" width="100%"></video><br>
      Quick view GIF: <a href="assets/demo/gif/demo%20v2ex.gif">demo v2ex.gif</a><br>
      HD promo MP4: <a href="assets/demo/promo_mp4/demo%20v2ex_promo.mp4">demo v2ex_promo.mp4</a>
    </td>
  </tr>
</table>

## What ClaudeChrome is for

ClaudeChrome is built for people who already work with browsers as part of their daily development, debugging, research, and verification flow.

It helps close the gap between two worlds that are usually disconnected:

- the browser, where the real product behavior happens
- the coding agent, where reasoning, debugging, and execution happen

The project exists to make that loop faster, more practical, and more reliable.

## Practical value

ClaudeChrome is designed to make browser-aware work feel direct instead of awkward.

With ClaudeChrome, you can:

- keep an agent next to the page you are inspecting instead of constantly context-switching
- work against the live tab you are actually viewing rather than describing it from memory
- move faster from “something looks wrong” to “here is the exact issue and next action”
- reduce manual copy-paste between the browser, terminal, and notes
- keep browser-assisted development local and close to your real workflow

The core promise is simple: the agent should understand the page you are working with, not a secondhand summary of it.

## What you can do with it

ClaudeChrome is meant to support practical, everyday browser work such as:

- debugging a broken UI while the agent stays attached to the exact tab in question
- reviewing what a page is showing before making code or content changes
- checking live page text, console behavior, and browser-side state while investigating issues
- keeping multiple task-focused panes open for different pages, environments, or workflows
- using the browser as part of the working environment rather than as a separate tool you have to describe manually

This makes the project especially useful when the browser is not just a place to view output, but part of the real runtime.

## Who it is for

ClaudeChrome is aimed at people who get real value from a browser-aware coding agent.

Typical users include:

- frontend engineers debugging real pages and flows
- full-stack developers tracing issues across UI and application behavior
- QA and product-minded builders who want faster investigation loops
- solo builders who live in the browser and want an assistant that stays close to the work
- researchers, tinkerers, and power users who want a more capable browser-side workflow

If your work often begins with “look at this tab” or “something on this page is wrong,” ClaudeChrome is built for you.

## Why it feels different

Most coding agents still treat the browser like a distant target. ClaudeChrome is built around the idea that the browser should be part of the working surface itself.

That changes the experience in a few important ways:

- the agent stays close to the live page instead of working from detached descriptions
- the browser becomes an active workspace, not just a thing you switch back to
- multiple panes and workspaces make it easier to separate tasks without losing context
- the overall workflow feels more like working beside the page than operating a remote tool

The result is a more grounded, more usable assistant for browser-heavy work.

## Example scenarios

### Debugging a product page

You are looking at a page that behaves incorrectly. Instead of explaining the issue from scratch, you keep the agent attached to that page and work through the problem while both of you are looking at the same thing.

### Verifying a flow before changing code

You want to confirm what a page currently does before editing anything. ClaudeChrome keeps the investigation tied to the live browser state so decisions are based on the actual product, not assumptions.

### Running parallel browser-aware tasks

You want one pane focused on a customer-facing page, another on an admin flow, and another on a general-purpose shell. ClaudeChrome makes that style of working feel natural rather than improvised.

## Project direction

ClaudeChrome is focused on one practical outcome: making local coding agents genuinely useful in browser-first workflows.

The project is not trying to be a generic browser extension with AI branding. It is trying to become a serious working surface for people who need their agent to stay connected to the page, the task, and the real runtime context.

## Status

ClaudeChrome is under active development and already demonstrates the core product direction clearly:

- a browser-side working surface for local agents
- session-aware page attachment
- practical browser-aware workflows
- a stronger loop between observation, reasoning, and action

The project is moving toward a more capable, more polished browser-native agent experience, but the central value proposition is already visible today.

## In one sentence

ClaudeChrome is for people who want their coding agent to work with the browser they are actually using, not around it.
