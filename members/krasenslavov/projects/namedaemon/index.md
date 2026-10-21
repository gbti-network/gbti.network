---
title: 'NameDaemon: Find .com Names From the Browser or the Command Line'
slug: namedaemon
shortDescription: >-
  Free .com domain tools, all reading from a daily snapshot of the whole .com zone. The same answers
  come back from packages for Node, Python, Go, PHP and Ruby, a command line and a public JSON API.
categories:
  - devops
  - tooling
status: published
visibility: public
pricing: free
pricingUrl: https://namedaemon.com/pro/
license: MIT
requires: Node 18, Python 3.9, Go, PHP or Ruby for the packages; a browser for the tools
tags:
  - cli
  - npm
  - pypi
  - whois
  - dns
  - rdap
  - namedaemon
  - tdl
  - domain-availability
  - domain-names
platforms:
  - Web
  - Node.js
  - Python
  - Go
  - PHP
  - Ruby
  - Chrome
  - Windows
  - Linux
icon: ./images/namedaemon-icon.webp
featuredImage: ./images/gallery-1-cover.png
bannerPreset: mods
galleryStyle: carousel
sidebarPosition: right
links:
  - type: homepage
    url: https://namedaemon.com/
    label: namedaemon.com
    primary: true
  - type: documentation
    url: https://namedaemon.com/developers/
    label: For developers
  - type: repository
    url: https://github.com/orgs/namedaemon/repositories
    label: The repositories on GitHub
  - type: download
    url: >-
      https://chromewebstore.google.com/detail/namedaemon-com-drop-checker/dmipfdmmffmeamphkjocdgkbblfmmbng
    label: The browser extension
  - type: support
    url: https://namedaemon.com/contact/
publishedAt: '2026-10-21T15:21:19.370Z'
updatedAt: '2026-10-21T16:19:46.075Z'
type: project
author: krasenslavov
---

NameDaemon is about thirty free tools for working with .com domain names, and all of them read from one daily snapshot of every registered .com. Its own home page puts it as "30 tools, one snapshot." The site is available in English, Spanish, French and German.

## A daily snapshot of every registered .com

Each morning the full .com zone file is downloaded from ICANN's Centralized Zone Data Service, published by the registry operator, Verisign. It holds names only, with no owner and no contact details. Today's list is compared against yesterday's: a name in yesterday's and not in today's has left the zone, and a name in today's and not yesterday's has appeared. That is how a drop gets spotted. For the names that matter the live registry status is then checked over RDAP, because a name missing from the zone is not always free.

Every result says which day it is from. The list of names itself is never published and there is no bulk export.

The daily numbers are published on their own page. On 2026-10-20 the zone held 167,843,117 names, 67,718 more than the day before, with 189,643 names appearing and 121,925 leaving. The median name was 12 characters, 9.93% contained a hyphen, and GoDaddy ran 21.58% of the zone by first nameserver.

## Finding, judging and watching a name

The tools come in three groups.

**Finding a name:** a generator, short pronounceable names that are missing from the zone, domain hacks, a handle matcher that checks GitHub, npm, PyPI and Bluesky, ENS and Solana names read from the blockchain, and a brand studio.

**Judging a name:** a 0 to 100 score that shows every part of its reasoning, an appraisal that reports strength and deliberately gives no price, a one-page Domain Report you can share, a screener and cost lookups.

**Watching a name:** an audit of what a name used to be, read from the Internet Archive, plus lookalikes, a health check covering expiry, transfer lock, DNS, SPF, DMARC and blocklists, a WHOIS lookup, a drop calendar, deleted domains, keyword trends and hosting stats.

Anyone can watch one name free and get an email when it frees up. Saved domains stay in your own browser.

## Packages, the command line and the API

The same tools are packages, free under MIT and needing no key.

```
npm install namedaemon
pip install namedaemon
```

The npm and PyPI packages expose the same typed methods with no dependencies at all: Node 18 and later, Deno and Bun on one, Python 3.9 and later on the other, using nothing but the standard library. Clients for Go (with a Homebrew tap), PHP (Composer) and Ruby (RubyGems) sit beside them. There is a command line too, through `npx namedaemon` or the `namedaemon` binary, with `--json` for the raw answer.

```
npx namedaemon rate example
npx namedaemon ideas nova 10
npx namedaemon check nova novax mybrand
npx namedaemon tco io
```

The packages wrap a public JSON API, so any language can call it with a GET or a POST:

```
curl "https://namedaemon.com/wp-json/nd/v1/rate?name=example"
```

The site runs on WordPress, with a theme of its own, and the API is served straight out of it. A status panel on the developer page reports the API up, checked every five minutes, at 99.97% over 30 days and 99.85% over 7, measured from outside by UptimeRobot.

## The extension, the desktop app and the web app

A browser extension checks any .com from the toolbar. Type a name, or select one on any page and right-click it, and it says whether the name is taken, free or about to drop, with the estimated release date and where to register or backorder it. From there you can appraise it, check its health and audit its past without leaving the tab. It is free, needs no account, and runs on Chrome, Edge, Firefox, Brave and Opera.

A desktop app for Windows and Linux puts nine of the tools in a window of their own: the Domain Name Generator, Availability Checker (up to 50 names at once, with CSV export), Domain Report, Domain Score, Domain Appraisal, Domain Audit, Domain Health Check, Short Domains and the Drop Calendar. It adds a watchlist kept on your computer that sends a notification when a name changes status, and a tray icon for checking the name you just copied. It is free and open source under MIT, has no account, no ads and no analytics, and sends a name to NameDaemon only when you check it. It is not code-signed yet, so Windows may show a warning before it installs. Download it from SourceForge or the Snap Store, or directly from namedaemon.com, where every file has a SHA-256 checksum.

The same tools also work as an installable web app, from the browser or from the Microsoft Store. It runs under Chrome and Edge on Windows, macOS, Linux and Android, and on Safari through Add to Home Screen.

## What it costs, and what Pro will be

Every tool, package and app is free, with no account and no key.

Pro is not open. Its page is headed "PRO / COMING SOON" and carries a waitlist where a checkout would be. The planned price is from $12 a month, and the page says in as many words that the price is not final until Pro opens.

What it is planned to carry: up to 15 keyword rules matched against each day's new and departing names, one daily digest by email, Telegram or on the site with the last 30 days searchable, watching up to 50 single names, saved domains kept on the account and not only in the browser, keyword trend alerts on up to 10 words that report counts and never a list of names, following the twelve weekly domain lists, 30 WHOIS lookups a day without the verification step visitors go through, and AI notes on each match. Payment through Stripe, with a sign-in link by email instead of an account and a password.

## Where the numbers stop being reliable

A Limits page says where, in plain words and not in small print. A name missing from the snapshot is not necessarily available: it can be registered without nameservers, or registered after the snapshot, so only the live registry check says a name is free and you should still confirm with your registrar. Drop dates are estimates worked out from the registry's last-changed date and can be off by several days, and popular names are taken within seconds of dropping by automated backorder services.

Scores are heuristics rather than valuations, which is why the appraisal reports strength and gives no price: a price needs sales data the site does not have. The audit reads what the Internet Archive happens to hold and the health check reads public registry and DNS data, so a clean result means nothing was found, which is not the same as nothing having happened, and neither is a security audit. The offensiveness screener covers 20 languages written in Latin letters and misses slang. Alerts and watches run once a day, so a watch is a head start and not a guarantee.

The page ends on the trademark question. A name being available does not mean you may use it.
