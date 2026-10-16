---
title: 'IsHacked: Know a Client Site Is Hacked Before Google Does'
slug: ishacked
shortDescription: >-
  Checks websites from the outside, the way visitors and Google see them: cloaked spam, phone-only
  redirects, malware, downtime, expiring SSL and broken email. Free check; daily monitoring from
  $3/month.
categories:
  - devops
  - security
status: published
visibility: public
pricing: freemium
pricingUrl: https://ishacked.com/#pricing
requires: Nothing to install
tags:
  - wordpress
  - security
  - malware
  - monitoring
  - seo
  - uptime
icon: ./images/ishacked-icon.png
featuredImage: ./images/ishacked-cover.png
sidebarPosition: right
links:
  - type: homepage
    url: https://ishacked.com
    label: Website
  - type: documentation
    url: https://ishacked.com/docs/api
    label: API docs
updatedAt: '2026-10-16T16:14:35.042Z'
publishedAt: '2026-10-16T16:14:35.042Z'
type: project
author: gsusi
---

IsHacked checks websites from the outside, the way visitors and Google see them. It catches the hacks owners miss because the site looks normal to them: spam served only to Googlebot, redirects that fire only for phones arriving from Google, malware loaders hidden from logged-in admins. It also watches the everyday failures that hurt just as much: downtime, PHP errors, expiring SSL and broken email. There is nothing to install and it needs no access to the site. The free check takes about a minute, with no sign-up.

## What it checks

25 checks per site, from Germany, the US and the UK:

- **Hacks and malware:** redirects that only phones, Google visitors or one country see; malware signatures such as NDSW, Balada and SocGholish; new script, iframe and form domains; rogue WordPress users and fake plugins; exposed database dumps, wp-config backups, .env and .git.
- **SEO spam and indexing:** cloaking (what Googlebot sees versus visitors), casino, pharma and Japanese keyword spam, hidden links, injected sitemaps, robots.txt tampering and surprise noindex. Inner pages sampled from the sitemap get the same checks.
- **Uptime and errors:** pings every 5 minutes with down and back-up alerts confirmed from a second location, 5xx and PHP fatal errors, WordPress critical-error screens, database errors, stuck maintenance mode and suspended-account pages.
- **SSL, domain and DNS:** certificate and domain expiry, nameserver and MX changes, and the http to https redirect.
- **Email deliverability:** SPF, DKIM and DMARC matched to the mailbox provider, plus Spamhaus blocklists.
- **Security hygiene:** outdated WordPress core and end-of-life PHP, mixed content, version leaks, username enumeration, XML-RPC and security headers.

## How it works

1. **Run a free check.** Enter any URL at ishacked.com. The report is ready in about a minute and gets a shareable link for 7 days.
2. **Add your sites.** Paste client URLs one per line, with an optional label. The first scan learns what is normal for each site, so after that only changes are reported.
3. **Hear only when something changes.** Plain-English alerts go to you and up to 5 extra addresses, or to Slack, Discord or a webhook, followed by an all-clear when it is fixed.

## For developers and agencies

Raw headers, the HTML as Googlebot and as a phone, redirect chains and the full JSON of every scan. A REST API to trigger checks from CI after a deploy, CSV export, and a one-click re-check of every site.

## What it can't do

No external scanner can prove a site is clean: a backdoor that shows nothing to the public stays invisible from outside. IsHacked catches what visitors and Google see, so pair it with a server-side scan of files and the database.

## Pricing

Priced near cost. Every plan gets every check, and you can cancel any time:

- **Solo, $3/month:** up to 10 sites
- **Pro, $9/month:** up to 50 sites
- **Agency, $25/month:** up to 200 sites
