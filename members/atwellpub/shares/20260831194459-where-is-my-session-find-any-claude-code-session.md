---
status: published
visibility: public
title: Where Is My Session? Find Any Claude Code Session
shortDescription: >-
  claude --resume only lists your current folder. wims finds every Claude Code session on your
  machine and resumes it in the right one.
url: https://marcelschmitz.com/posts/where-is-my-session-claude-code/
category: devops
image: https://marcelschmitz.com/posts/where-is-my-session-claude-code/og.png
id: 20260831194459-where-is-my-session-find-any-claude-code-session
createdAt: '2026-08-31T19:44:59.644Z'
type: share
author: atwellpub
---

**wims** is an open-source CLI/TUI for Claude Code that solves a simple problem: `claude --resume` only shows sessions from your current folder, while wims scans all Claude Code sessions on your machine, lets you search them by title or even by the text of your past prompts, shows useful context like project path and git branch, then jumps your shell into the correct folder and resumes the session automatically. It reads Claude’s local `~/.claude` data, makes no network calls, requires Node 20+, and is MIT licensed. Repo: [https://github.com/pluginslab/wims](https://github.com/pluginslab/wims)
