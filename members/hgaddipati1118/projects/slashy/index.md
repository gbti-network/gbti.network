---
title: 'Slashy: The AI Email Client That Writes Like You and Plugs Into Your Agents'
slug: slashy
shortDescription: >-
  Cursor for email. Slashy drafts replies in your voice, books meetings and chases follow-ups, and
  its MCP server and agent skills let Claude Code, Cursor or Codex run your inbox. 20% off with code
  GBTI.
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
pricingUrl: https://www.slashy.com/pricing?ref=GBTI
license: Proprietary
platforms:
  - Web
  - macOS
  - iOS
bannerPreset: ink
links:
  - type: homepage
    url: https://www.slashy.com/?ref=GBTI
    label: Try Slashy (20% off with code GBTI)
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
    caption: The Slashy inbox with the AI assistant panel open (demo data).
  - src: ./images/slashy-mcp.webp
    caption: Add the Slashy MCP server to Claude Code in one command.
  - src: ./images/slashy-pricing.webp
    caption: >-
      Professional is $25 per user per month billed annually. GBTI readers get 20% off with code
      GBTI.
status: published
visibility: public
publishedAt: '2026-10-23T22:30:49.533Z'
type: project
author: hgaddipati1118
updatedAt: '2026-10-24T21:51:57.908Z'
---

## Your inbox, finally on autopilot

Most "AI email" tools bolt a chatbot onto Gmail. Slashy is the whole email client, rebuilt around an assistant that actually does the work. Y Combinator's directory sums it up in three words: **Cursor for Email**.

Open a thread and the reply is already waiting, written the way you write. Slashy reads the full conversation, drafts the response you would have sent, chases the follow-ups you would have forgotten, and books the meeting without the five-email back and forth. You review, tweak if you want, and hit send.

## What users say

Slashy is rated **4.9/5 on [G2](https://www.g2.com/products/slashy/reviews)**. A few lines from verified reviews:

> "Slashy is the best agent-native email client I've used, and I've probably given almost all of them a serious try."
> **Adam B., Founder / CEO**

> "The MCP connector, so badly missing with many other email clients, allows me agentic access to my entire mailbox."
> **Verified user in Investment Banking**

> "It picks up on my voice and what I like and turns out replies I send with barely any edits... Delegating that stuff saves me hours every week."
> **Julian J., Technical Support Representative**

> "I actually started a side project to just create my own program, then I discovered Slashy. It was literally everything I wanted in an email client."
> **William R., President**

## What it does for you every day

- **Drafts in your voice.** Not generic AI filler. Slashy learns how you write and drafts replies that sound like you on a good day.
- **Inline rewrites.** Highlight any text to rewrite it, shorten it, or change the tone.
- **Scheduling on autopilot.** It checks your calendar, proposes times, and creates the event.
- **Follow-ups that don't slip.** Reminders and automations nudge threads forward before they go cold.
- **Meeting prep and contact research.** Walk into every call knowing who you're talking to and what you last discussed.
- **Everywhere you work.** Mac, iPhone and web, plus an iMessage agent and Slack access. Gmail and Outlook, with unlimited inboxes.

## Built for people who live in Claude Code, Cursor and Codex

This is the part GBTI readers will love. Slashy runs a hosted MCP server at `https://slashy.ctrlcenter.ai/mcp`, so your coding agent can work your inbox directly: draft, send, reply, schedule, label, check availability, research a contact, prep a meeting and set reminders. It connects over OAuth 2.1 with PKCE, so there are no API keys to copy, rotate, or leak.

Want more than raw tools? Two open repos ship the agent side:

- **`Slashy-com/skills`**: seven agent skills in the open `SKILL.md` format, covering onboarding, inbox briefings, a reply and follow-up sweep, meeting-to-email, relationship briefs and automation setup. Install with `npx skills add Slashy-com/skills`, with published install paths for Claude Code, Cursor, Codex, Copilot in VS Code and Windsurf.
- **`Slashy-com/slashy-plugin`**: a Claude plugin for Gmail or Outlook mail and Google or Outlook calendar.

Try asking your agent "triage my inbox and draft replies to anything urgent" and watch it go. The skills are built to read full context before writing, default to drafts when sending intent is unclear, and treat email content as untrusted input rather than instructions.

## Pricing, plus 20% off for GBTI readers

Professional is $25 per user per month billed annually, or $30 monthly. That covers intelligent drafts and inline rewrites, calendar and scheduling, automations and reminders, team collaboration and unlimited inboxes. Enterprise adds SSO and SCIM, a dedicated account manager, guided onboarding, and custom security and data controls.

**GBTI readers get 20% off:** sign up through [slashy.com/?ref=GBTI](https://www.slashy.com/?ref=GBTI) or enter the code `GBTI` at checkout. Every plan starts with 7 days of full access.

## Enterprise-grade security

Your email is the most sensitive data you have, and Slashy treats it that way. SOC 2 Type II and CASA Tier 2 assessments are complete. Customer data is never used to train Slashy's models or any third-party models, and AI providers are contractually held to the same. Data is encrypted in transit with TLS 1.2+ and at rest with 256-bit AES, hosted on AWS in the United States. Disconnect and your production data is gone within 24 hours.

## Who makes it

Slashy is a Y Combinator Summer 2025 company based in San Francisco, founded by Harsha Gaddipati (CEO) and Dhruv Roongta (CTO). Got a feature request? Leave a comment below, the founders read them.
