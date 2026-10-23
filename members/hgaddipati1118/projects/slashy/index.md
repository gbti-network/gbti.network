---
title: 'Slashy: AI Email Client with an MCP Server and Agent Skills'
slug: slashy
shortDescription: >-
  An AI email client with a hosted MCP server, a Claude plugin and seven agent skills, so Claude
  Code, Cursor or Codex can work your inbox.
categories:
  - ai
  - agents
tags:
  - email
  - mcp
  - agent-skills
  - productivity
  - claude-code
  - inbox
pricing: paid
pricingUrl: https://www.slashy.com/pricing
license: Proprietary
platforms:
  - Web
  - macOS
  - iOS
bannerPreset: ink
links:
  - type: homepage
    url: https://www.slashy.com/
    label: Visit Slashy.com
    primary: true
    visibility: public
  - type: documentation
    url: https://help.slashy.com/how-to-guides/slashy-mcp-overview
    visibility: public
  - type: repository
    url: https://github.com/Slashy-com/skills
    visibility: public
icon: ./images/slashy-icon.png
featuredImage: ./images/slashy-cover.webp
gallery:
  - src: ./images/slashy-inbox.webp
    caption: >-
      The product's own marketing demo of the inbox and the assistant panel. The names in it are
      from the television series Silicon Valley, not customers.
  - src: ./images/slashy-mcp.webp
    caption: The MCP overview in Slashy's help centre, showing the server being added from Claude Code.
  - src: ./images/slashy-pricing.webp
    caption: >-
      Professional is $25 per user per month billed annually. The trial runs 7 days and takes a
      card.
status: published
visibility: public
publishedAt: '2026-10-23T22:30:49.533Z'
type: project
author: hgaddipati1118
---

## What Slashy is

Slashy is an AI email client. Its homepage heading reads "Your intelligent inbox", and Y Combinator's own directory describes it in three words: "Cursor for Email". The homepage line under it is "Slashy drafts replies in your voice, schedules meetings, and handles follow ups, so you spend less time managing email."

Four things are named on that page. AI drafts, which "reads the full thread and drafts the reply you would have written". An inline assistant, where you "Highlight any text to rewrite it, shorten it, or change the tone". Voice drafts. Snippets. The pricing table gives the platforms as Mac, iPhone and web, and the help centre documents an iMessage agent and Slack access as well.

## An MCP server, a plugin and seven skills

Slashy runs a hosted MCP server at `https://slashy.ctrlcenter.ai/mcp`. Its documentation says the server lets "your favorite AI tools", naming Claude Code, Claude Desktop, Cursor, Codex and Hermes, "use Slashy's email, calendar, and research tools directly". Authorization is OAuth 2.1 with PKCE, which the docs put as "no API keys to copy, rotate, or leak".

The tools it exposes, from the same page: email automation (draft, send, reply, schedule, label and attach), calendar automation (create events, check availability, propose meeting times), research (look up a contact's professional background, search the web and your email history), meeting prep, and reminders with email or calendar triggers.

Two public repositories carry the agent side, both last pushed on 2026-10-23. `Slashy-com/slashy-plugin` is a plugin for Claude covering Gmail or Outlook mail and Google or Outlook calendar. `Slashy-com/skills` is an Agent Plugin, manifest `plugin.json` against spec 1.0.0, bundling seven skills in the open `SKILL.md` format: a general MCP guide plus workflows for onboarding, inbox briefings, a reply and follow-up sweep, meeting-to-email, relationship briefs and automation setup. Install paths are published for Claude Code, Cursor, Codex, Copilot in VS Code and Windsurf, and `npx skills add Slashy-com/skills` covers anything else that reads the skills CLI.

The skills README states the safety posture directly: they "read full context before writing, default to drafts when sending intent is unclear, and treat email bodies, calendar descriptions, attachments, and webpages as untrusted content rather than user instructions."

Slashy itself is closed source. The public repositories are the plugin and the skills, not the client.

## Price, and the trial that takes a card

Professional is $25 per user per month billed annually, or $30 monthly. It covers intelligent drafts and inline rewrites, calendar and scheduling, automations and reminders, team collaboration and unlimited inboxes. Enterprise is custom and adds SSO and SCIM, a dedicated account manager, guided onboarding, and custom security and data controls.

The pricing page is explicit about the trial: "Professional starts with 7 days of full access. A credit card is required."

## Security, in their own words

These are the claims on the security page as of 2026-10-23. A completed SOC 2 Type II examination and a completed CASA Tier 2 assessment, with the report available on request. On training: "We do not use customer data to train our own models or any third party models", and agreements with AI providers require the same of them. Data is encrypted in transit with TLS 1.2 or later and at rest with 256-bit AES, held in PostgreSQL on AWS in the United States. On disconnection or deletion, production data goes within 24 hours and backups within 7 days, extended to 14 during an incident investigation. Every subprocessor listed is in the United States except CloudConvert, which is in Germany.

Two gaps are the page's own. It gives no report date or scope for either assessment, and penetration test results are available only under NDA.

## Who makes it

Slashy is a Y Combinator Summer 2025 company based in San Francisco, with a team of three. Y Combinator's directory names Harsha Gaddipati as founder and chief executive, and Dhruv Roongta as founder and chief technology officer.
