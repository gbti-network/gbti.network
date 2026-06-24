---
title: Responsive Design Audit with MCP Playwright
slug: responsive-design-audit-with-playwright
shortDescription: >-
  Drive Claude Code with MCP Playwright to inspect every breakpoint and make the layout as polished
  on mobile as it is on desktop.
categories:
  - design
  - responsive
tags:
  - mcp
  - playwright
  - responsive
  - css
targets:
  - Claude Code
exampleOutput: >-
  Claude Code opens each viewport with MCP Playwright, screenshots and inspects every major section,
  identifies overflow, cramped spacing, and broken grids, then makes targeted responsive CSS changes
  and re-verifies, with before and after observations for a mobile, tablet, and desktop viewport.
status: published
visibility: public
publishedAt: '2026-06-08'
type: prompt
author: atwellpub
---

Use MCP Playwright to visually inspect the site across desktop browser widths, tablet widths, and real mobile device viewports. Improve the layout so every major section feels polished, intentional, readable, and usable across each context.

The goal is not to apply one responsive rule to every narrow viewport. Treat desktop browser narrowing and confirmed mobile devices differently.

Core responsive strategy:

Desktop browser resizing should preserve the desktop design shape for as long as it remains usable. As desktop viewport width narrows, compress the existing layout first by reducing font sizes, gaps, padding, margins, icon sizes, avatar sizes, card spacing, media sizes, and line heights. Avoid jumping to a mobile layout just because the width is smaller.

Confirmed mobile device viewports should be treated as mobile experiences. On mobile, solve layout issues through mobile-native restructuring when appropriate: two columns may become one, sidebars may move above or below content, secondary metadata may be hidden or condensed, button groups may stack, dense card grids may simplify, and complex sections may become accordions, carousels, horizontal scroll regions, or reordered content.

Viewport test matrix:

Mobile device viewports:

* 320 x 568, small mobile
* 360 x 740, Galaxy S8+
* 375 x 667, iPhone SE
* 390 x 844, iPhone 12/13/14
* 393 x 852, iPhone 14/15 Pro
* 412 x 915, Pixel 7
* 430 x 932, iPhone 14/15 Pro Max

Tablet viewports:

* 600 x 960, small tablet portrait
* 768 x 1024, iPad Mini portrait
* 810 x 1080, iPad portrait
* 1024 x 768, tablet landscape
* 1024 x 1366, iPad Pro portrait
* 1366 x 1024, iPad Pro landscape

Desktop browser widths:

* 600 x 900, narrow desktop browser
* 650 x 900, desktop compression threshold
* 768 x 900, narrow desktop/tablet boundary
* 1024 x 768, small desktop
* 1280 x 720, desktop 720p
* 1366 x 768, common laptop
* 1440 x 900, laptop/desktop
* 1536 x 864, large laptop
* 1920 x 1080, desktop 1080p
* 2560 x 1440, desktop 1440p

For each viewport:

1. Open the page with MCP Playwright.
2. Capture a full-page screenshot.
3. Inspect each major section individually.
4. Compare mobile, tablet, narrow desktop, and full desktop presentation.
5. Identify text overflow, cramped spacing, broken grids, awkward wrapping, clipped content, deformed cards, misaligned buttons, uneven card heights, weak hierarchy, poor touch targets, and sections that no longer feel visually balanced.
6. Note whether the issue should be solved by compression, restructuring, simplification, or hiding expendable content.

Desktop browser compression rules:

* For desktop browser widths down to approximately 600px, preserve the desktop structure wherever possible.
* Do not automatically stack multi-column rows, sidebar layouts, media/text pairs, pricing cards, feature rows, or inline cards above 600px.
* First shrink competing elements: headings, supporting text, avatar sizes, icons, gaps, card padding, media dimensions, CTA spacing, and metadata.
* Use proportional scaling with `clamp()`, `min()`, `max()`, fluid spacing variables, CSS grid, and flexible sizing.
* A desktop section should feel like the same section at smaller scale, not a different design.
* If a title wraps one word per line, a row overflows, a card becomes crushed, or buttons collide, reduce surrounding pressure before changing structure.
* Only restructure desktop-browser layouts when compression creates unreadable text, unusable controls, or obviously broken visual hierarchy.

Mobile device adaptation rules:

* Treat confirmed mobile viewports as mobile-native experiences, not miniature desktop layouts.
* Prioritize readability, thumb-friendly interaction, clear hierarchy, and strong vertical rhythm.
* Convert two-column and multi-column layouts to single-column when that produces a better mobile experience.
* Stack CTAs when inline buttons become cramped.
* Move sidebars above or below primary content when needed.
* Hide, shorten, or collapse expendable metadata when it competes with the main content.
* Preserve important content, but remove visual clutter where it harms the mobile experience.
* Consider accordions, compact cards, horizontal scrolling groups, reduced media, simplified grids, reordered content, and mobile-specific section treatments.
* Do not shrink body text below readable mobile sizes.
* Do not preserve desktop shape on mobile when doing so creates awkward wrapping, tiny text, crowded controls, or weak hierarchy.

Tablet rules:

* Treat tablets as an intermediate design context, not automatically desktop and not automatically mobile.
* Preserve desktop structure on larger tablets when it remains balanced.
* Use hybrid layouts where appropriate: two-column grids, compressed sidebars, reduced card density, smaller media, and tighter spacing.
* On portrait tablets, avoid overly wide single-column sections unless the design benefits from it.
* On landscape tablets, preserve more desktop-like structure where possible.

Implementation expectations:

* Make targeted CSS and layout changes.
* Prefer responsive CSS using `clamp()`, `min()`, `max()`, CSS grid, flexbox, container queries where useful, and breakpoint-specific rules.
* Keep existing design tokens and naming conventions where they exist.
* Avoid broad rewrites unless a section is structurally unsalvageable.
* Use separate logic where needed for viewport width, pointer type, hover capability, and device-like mobile contexts.
* Do not rely only on screen width when deciding mobile behavior.
* Preserve the desktop design language while allowing mobile to have its own practical layout.
* After edits, rerun MCP Playwright screenshots at the same viewport sizes.
* Confirm that each major section looks intentional, balanced, readable, and usable across mobile, tablet, narrow desktop, and full desktop.

Decision framework:

For every responsive issue, decide which fix category applies:

1. Compression fix:
   Use when the desktop structure still works but needs smaller spacing, typography, icons, cards, or media.

2. Layout preservation fix:
   Use when the section should remain in its desktop shape across narrow desktop widths.

3. Mobile restructuring fix:
   Use when the viewport is a real mobile device and the section would be more usable as a stacked, simplified, reordered, or collapsed layout.

4. Content priority fix:
   Use when secondary metadata, decorative elements, repeated labels, dates, avatars, or supporting copy are crowding the core experience.

5. Structural redesign fix:
   Use only when CSS scaling and responsive reflow cannot make the section work cleanly.

Final deliverable:

* Summarize the responsive issues found.
* Group issues by mobile, tablet, narrow desktop, and full desktop.
* List the CSS/layout changes made.
* Explain where compression was used to preserve desktop structure.
* Explain where mobile-specific restructuring was used.
* Note any content that was hidden, shortened, collapsed, or deprioritized.
* Note any sections that still need design input.
* Include before/after observations for:

  * Smallest mobile viewport
  * One larger mobile viewport
  * One tablet portrait viewport
  * One narrow desktop viewport near 600px
  * One standard desktop viewport
* Confirm that screenshots were rerun after implementation.
