---
type: prompt
title: "Responsive Design Audit with MCP Playwright"
slug: responsive-design-audit-with-playwright
shortDescription: "Drive Claude Code with MCP Playwright to inspect every breakpoint and make the layout as polished on mobile as it is on desktop."
author: atwellpub
status: published
visibility: public
categories: ["design", "responsive"]
tags: ["mcp", "playwright", "responsive", "css"]
targets: ["Claude Code"]
exampleOutput: "Claude Code opens each viewport with MCP Playwright, screenshots and inspects every major section, identifies overflow, cramped spacing, and broken grids, then makes targeted responsive CSS changes and re-verifies, with before and after observations for a mobile, tablet, and desktop viewport."
publishedAt: 2026-06-08
---

Use MCP Playwright to visually inspect the site across responsive breakpoints and improve the layout so every major section feels as polished on mobile as it does on desktop.

Test against these viewport sizes:

* 375 × 667, iPhone SE
* 390 × 844, iPhone 12/13/14 Pro
* 430 × 932, iPhone 14/15 Pro Max
* 360 × 740, Galaxy S8+
* 412 × 915, Pixel 7
* 768 × 1024, iPad Mini
* 1024 × 1366, iPad Pro
* 1280 × 720, desktop 720p
* 1920 × 1080, desktop 1080p
* 2560 × 1440, desktop 1440p

For each viewport:

1. Open the page with MCP Playwright.
2. Capture screenshots of the full page.
3. Inspect each major section individually.
4. Compare mobile, tablet, and desktop presentation.
5. Identify text overflow, cramped spacing, broken grids, awkward wrapping, clipped content, deformed cards, misaligned buttons, and sections that lose visual hierarchy.

Responsive design rules:

* The core principle: as the viewport narrows, SCALE the existing layout down to keep its shape. Reduce font sizes, gaps, padding, margins, icon sizes, avatar sizes, and line heights proportionally so a section keeps the same structure it has on desktop, only smaller. Do not jump to a different layout while a scaled version still works.
* Preserve the desktop design language as much as possible.
* Hold the desktop structure down to 650px. Above 650px, a multi-column row, a sidebar next to content, or an inline card must stay in that shape with its elements shrunk to fit, not reflowed into a stack. A title that wraps one word per line, a row that overflows, or a column crushed to nothing means you have not shrunk the competing elements enough yet.
* When something does not fit, shrink the competing elements first (smaller avatar, smaller meta text, tighter gaps, and dropping secondary metadata such as a date) before you reflow the layout.
* Only below 650px should you switch to a mobile-native format: single-column cards, stacked CTAs, a collapsed or top-mounted sidebar, reduced metadata, horizontally scrollable groups, simplified grids, compact accordions, or reordered content.
* Maintain strong hierarchy between headings, body text, CTAs, cards, and supporting copy at every size.
* Do not hide important content unless there is a strong UX reason.
* Do not shrink text below readable mobile sizes.

Implementation expectations:

* Make targeted CSS/layout changes.
* Prefer responsive CSS using `clamp()`, `min()`, `max()`, CSS grid, flex wrapping, and breakpoint-specific rules.
* Keep design tokens consistent where they already exist.
* Avoid broad rewrites unless the section is structurally unsalvageable on mobile.
* After edits, rerun MCP Playwright screenshots at the same viewport sizes.
* Confirm that every major section looks intentional, balanced, readable, and usable across mobile, tablet, and desktop.

Final deliverable:

* Summarize the responsive issues found.
* List the changes made.
* Note any sections that still need design input.
* Include before/after observations for the smallest mobile viewport, one tablet viewport, and one desktop viewport.
