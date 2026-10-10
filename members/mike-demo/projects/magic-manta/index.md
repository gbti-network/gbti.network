---
title: 'Magic Manta: Find and Verify a Company''s Social Profiles'
slug: magic-manta
shortDescription: >-
  Enter a company's domain and it finds and verifies that company's social profiles across X,
  Threads, Instagram, LinkedIn, Bluesky, GitHub and more, showing the evidence behind every handle.
categories:
  - devops
  - utilities
tags:
  - osint
  - social-media
  - brand-monitoring
  - mcp
  - agents
  - verification
  - schema-org
  - research
  - saas
  - web-app
platforms:
  - Web
pricing: paid
pricingUrl: https://magicmanta.com/pricing
icon: ./images/mm-icon-128.webp
featuredImage: ./images/mm-featured.webp
bannerPreset: utilities
gallery:
  - src: ./images/mm-scan.webp
    caption: >-
      A lookup on gbti.network: confirmed footprint, 6 of 21 signals, and one button to copy every
      verified handle.
  - src: ./images/mm-profiles.webp
    caption: >-
      Each handle carries its evidence: where it was found, the source, and when it was last
      checked.
  - src: ./images/mm-adapters.webp
    caption: >-
      Three doorways into the same engine. The MCP server is live now; REST and a React SDK are
      marked coming soon.
links:
  - label: Magic Manta
    url: https://magicmanta.com/
    type: homepage
  - label: Framework adapters and MCP
    url: https://magicmanta.com/adapters
    type: documentation
  - label: Agent auth docs
    url: https://magicmanta.com/auth.md
    type: documentation
status: published
visibility: public
publishedAt: '2026-10-10T23:14:43.399Z'
type: project
author: mike-demo
---

Magic Manta is a social radar scanner. Enter a company's domain and it finds that company's social media profiles across X, Threads, Instagram, LinkedIn, Bluesky, GitHub and more, then shows the evidence behind every handle it returns.

## How a lookup works

It reads the site's Schema.org sameAs data and the links on its official pages, then falls back to targeted search for anything those do not declare. A profile declared through JSON-LD sameAs or an official-site DOM link gets a Verified badge, with its evidence source shown. A search fallback candidate stays Unverified unless it links back to the official domain. Every result carries a last-checked timestamp, and conflicts between official sources are flagged.

## Beyond one domain

Batch lookups sweep several domains in a single run: five per batch on the Operative plan, twenty-five on Deep Recon.

## For agents

The radar core is framework-agnostic, with three doorways into the same engine. The MCP server is live today, auth-gated, at 100 lookups per account per day. A REST endpoint and a React SDK are listed as coming soon, and there is no public REST API yet.

## Accounts and plans

Single lookups need no account. An account unlocks saved lookups, lists, paid plans and the MCP server, with sign-in through Google, Apple, Microsoft, AgentID, or email and password. Single lookups are free. Operative is a one-time five dollars for an account, lookup history, saved lists and CSV or JSON export. Deep Recon is ten dollars a month, and Brand Command twenty dollars a month.

## Hosting and carbon

The site runs on Lovable Cloud behind Cloudflare, which the Green Web Foundation verifies as green hosting, and 1.5 percent of purchases goes to Stripe Climate for carbon removal. A machine-readable disclosure sits at /carbon.txt.
