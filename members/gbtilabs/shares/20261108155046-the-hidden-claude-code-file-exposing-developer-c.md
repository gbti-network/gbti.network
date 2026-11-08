---
status: published
visibility: public
title: The Hidden Claude Code File Exposing Developer Credentials
shortDescription: >-
  Apiiro found thousands of credentials exposed in public repositories after coding-agent commands
  were saved into project configuration and history.
url: https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again
category: security
tags:
  - agentic-development
  - software-supply-chain
  - application-security
  - ai-security
sourceName: Apiiro
id: 20261108155046-the-hidden-claude-code-file-exposing-developer-c
createdAt: '2026-11-08T15:50:46.962Z'
type: share
author: gbtilabs
---

Apiiro researchers found 2,539 credentials they classified as real secrets across 1,994 public GitHub repositories, including database passwords, API tokens, SSH credentials, and cloud keys.[^1]

One major source is Claude Code’s `.claude/settings.local.json`. Anthropic documents that choosing “Yes, and don’t ask again” for a Bash command saves a standing approval to this project-local file.[^2] If that command contains a credential, the credential can be saved with it. Claude Code normally adds the file to a global Git exclusion, but Apiiro found cases where it was still committed, copied, or preserved in history.

The research goes further into what conventional secret scanners miss, other agent-generated files carrying credentials, and what developers should check now.

[^1]: [Apiiro, *Coding Agents Copy Your Secrets to a Hidden File. Thousands Are on GitHub*, November 5, 2026](https://apiiro.com/blog/coding-agents-leaking-secrets-github-dont-ask-again)
[^2]: [Anthropic, *Claude Code Settings Files and Precedence*](https://code.claude.com/docs/en/settings)
