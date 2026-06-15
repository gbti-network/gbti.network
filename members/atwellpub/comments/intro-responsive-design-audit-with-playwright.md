---
type: comment
id: intro-responsive-design-audit-with-playwright
author: atwellpub
targetType: prompt
targetSlug: responsive-design-audit-with-playwright
status: published
visibility: public
authorNote: true
createdAt: 2026-06-08
---

I wrote this prompt because responsive polish is the kind of work that is tedious to do by hand and easy to skip. Pairing Claude Code with MCP Playwright lets the agent actually open each breakpoint, see what is broken, fix it with targeted CSS, and then re-check its own work. Point it at a page, let it sweep the viewport sizes, and read the before and after notes it gives you.

The one habit I care about most: as the screen gets narrower, the layout should SHRINK to keep its shape, not jump straight to a stacked mobile version. Hold the desktop structure down to 650px by scaling the elements (fonts, gaps, padding, avatars, icons) so a row stays a row and a sidebar stays a sidebar, just smaller. If a title is wrapping one word per line or a column is crushed, that is the signal to shrink the elements competing for the space, not to reflow. Save the mobile-native shapes (single column, stacked, collapsed sidebar) for below 650px. It will not be perfect, but it keeps the design feeling intentional instead of falling apart in the middle widths.
