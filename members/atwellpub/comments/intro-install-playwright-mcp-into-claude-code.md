---
type: comment
id: intro-install-playwright-mcp-into-claude-code
author: atwellpub
targetType: prompt
targetSlug: install-playwright-mcp-into-claude-code
status: published
visibility: public
authorNote: true
createdAt: 2026-06-09
---

I wrote this because the responsive-audit prompt is only useful once Claude Code can actually see a browser, and the setup trips people up more than it should. The whole thing is one entry in `~/.claude.json`, a relaunch, and a quick sanity check, but the gotchas (the headed window is normal, the close tool disconnects the MCP, the first navigate downloads Chromium) are easy to misread as failures. Run this once, confirm the evaluate returns a page title, and you are ready to point the audit prompt at a real page.
