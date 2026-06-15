---
type: prompt
title: "Install the Playwright MCP Server into Claude Code"
slug: install-playwright-mcp-into-claude-code
shortDescription: "Wire the Playwright MCP server into Claude Code so the agent can drive Chromium, snapshot the DOM, read the console, and screenshot pages from inside a live session."
author: atwellpub
status: published
visibility: public
categories: ["ai", "mcp"]
tags: ["mcp", "playwright", "claude-code", "chromium", "browser-automation"]
targets: ["Claude Code"]
exampleOutput: "Claude Code edits ~/.claude.json to add a stdio playwright MCP server, relaunches, loads the mcp__playwright__browser_* tool schemas, and confirms the wiring with a one-shot navigate, wait, and evaluate against a public page that returns the document title and heading."
publishedAt: 2026-06-09
---

# Prompt: Install the Playwright MCP server into Claude Code

You are installing the **Claude Code Playwright MCP** so you can drive Chromium from inside this Claude Code session. After install, you will have `mcp__playwright__browser_*` tools available — `navigate`, `snapshot`, `evaluate`, `take_screenshot`, `console_messages`, `network_requests`, `tabs`, `wait_for`, `close`, and the rest of the browser family.

You do **not** need to run `npx playwright install chromium` separately. The MCP server downloads Chromium on first launch.

## Do this

1. **Open `~/.claude.json`** in an editor. If the file does not exist, create it containing an empty JSON object (`{}`) first. This file is the user-level Claude Code config; it is shared across all your Claude Code projects.

2. **Add a `mcpServers.playwright` entry.** If `mcpServers` already exists, add the `playwright` key alongside any existing entries — do not replace the whole block. The merged config should look like this:

   ```json
   {
     "mcpServers": {
       "playwright": {
         "type": "stdio",
         "command": "npx",
         "args": ["@playwright/mcp@latest"],
         "env": {}
       }
     }
   }
   ```

3. **Save the file.** Quit Claude Code completely and relaunch it. On the next launch the MCP server connects automatically via stdio.

4. **Verify the tools are present.** In the new Claude Code session, the `mcp__playwright__browser_*` tools should appear in the deferred-tool list. Load schemas with a `ToolSearch` call like `select:mcp__playwright__browser_navigate,mcp__playwright__browser_snapshot,mcp__playwright__browser_evaluate` before you call them.

5. **First navigation triggers the one-time Chromium download** handled by the MCP server itself. A Chromium window opens on the host. The browser stays headed by default; that visible window is normal and confirms the session is live. There is no documented headless flag.

## Things to know

**Mid-session reconnect.** If the Playwright tools disappear during a session — for example after you call `mcp__playwright__browser_close`, which disconnects the MCP — run `/mcp` from the Claude Code prompt to reconnect. The deferred-tool list refreshes.

**Browser lifecycle.** The MCP browser dies when Claude Code closes. It is the right tool for interactive instrumentation sessions inside a live Claude Code window, not for unattended overnight runs. For multi-hour automation that needs to survive a Claude Code restart, use a standalone Playwright Node script or a curl-based watcher instead.

**Per-project allowlist.** Individual projects may pre-approve a subset of these tools in their `.claude/settings.json` (typically `browser_navigate`, `browser_snapshot`, `browser_wait_for`). Other tools (screenshots, console reads, network requests, evaluate) will prompt for permission per call unless you extend the allowlist for the session.

## Sanity check after install

Once the tools load, run a one-shot check against any public page to confirm the MCP can drive Chromium and read DOM state:

```
mcp__playwright__browser_navigate { url: "https://example.com" }
mcp__playwright__browser_wait_for { time: 3 }
mcp__playwright__browser_evaluate { function: "() => ({ title: document.title, h1: document.querySelector('h1')?.textContent })" }
```

If the eval returns the page title and heading, the MCP is wired up and you are ready to instrument.
