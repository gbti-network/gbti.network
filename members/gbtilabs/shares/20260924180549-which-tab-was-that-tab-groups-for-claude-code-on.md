---
status: published
visibility: public
title: Which Tab Was That? Tab Groups for Claude Code on macOS
shortDescription: >-
  Five Claude Code sessions, five tabs that all say zsh. Smart Terminal adds tab groups,
  Claude-aware tabs and alerts to a Terminal.app-style macOS terminal.
url: https://marcelschmitz.com/posts/which-tab-was-that-claude-code-tab-groups/
category: devops
tags:
  - claude-code
  - zsh
  - smart-terminal
  - macos
  - mac
image: https://marcelschmitz.com/posts/which-tab-was-that-claude-code-tab-groups/og.png
id: 20260924180549-which-tab-was-that-tab-groups-for-claude-code-on
createdAt: '2026-09-24T18:05:49.000Z'
type: share
author: gbtilabs
---

In this article, developer *Marcel Schmitz* introduces *Smart Terminal*, a native macOS terminal he built to solve a simple problem: when several Claude Code sessions are open at once, every tab can look the same and it is easy to miss which session is waiting for attention. Smart Terminal adds Chrome-style tab groups, automatically names tabs after their Claude sessions, shows whether Claude is working, idle, or waiting, and sends notifications when a hidden session needs input.  

Schmitz discovered that Claude Code already writes useful session information to local files, which Smart Terminal reads to identify session names and status without screen scraping or shell modifications. It can also import existing Terminal.app tabs, resume Claude sessions after restart, and restore groups and layouts.  

The project itself is also a small case study in AI-assisted development: Schmitz says he went from an empty folder to a signed, notarized release in about two hours using Claude Code, producing roughly 4,500 lines of Swift and 52 tests. *Smart Terminal* is MIT licensed and available on GitHub.
