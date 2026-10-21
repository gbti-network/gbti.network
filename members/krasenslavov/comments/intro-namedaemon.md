---
id: intro-namedaemon
targetType: project
targetSlug: namedaemon
createdAt: '2026-10-21T15:21:19.370Z'
status: published
visibility: public
authorNote: true
type: comment
author: krasenslavov
---

NameDaemon is a set of free tools for working with .com domain names, built on a daily snapshot of every registered .com. The zone file is downloaded each morning from ICANN's Centralized Zone Data Service, today's list is compared against yesterday's to see what appeared and what left, and the names that matter are then checked live against the registry over RDAP. The tools are free and need no account, and the site is available in English, Spanish, French and German.

They fall into three groups. Finding a name: a generator, short pronounceable names missing from the zone, domain hacks, a handle matcher that checks GitHub, npm, PyPI and Bluesky, ENS and Solana names read from the blockchain, and a brand studio. Judging a name: a 0 to 100 score with the reasons, an appraisal that reports strength and deliberately gives no price, a one-page shareable Domain Report, and an offensiveness screener. Watching a name: an audit of what a name used to be from the Internet Archive, lookalikes, a health check covering expiry, transfer lock, DNS, SPF, DMARC and blocklists, a WHOIS lookup and a drop calendar.

The same tools ship as packages. Run npm install namedaemon or pip install namedaemon, or use the clients for PHP (Composer), Ruby and Go. All are free and MIT licensed and need no key. Each one carries a method per tool, and there is a command line as well. The packages wrap a public JSON API that any language can call with a GET or a POST.

A browser extension checks any .com from the toolbar in Chrome and other Chromium browsers. A free, open-source desktop app for Windows and Linux puts nine of the tools in a window of their own, with bulk check of up to 50 names and CSV export, a watchlist that sends a notification when a name changes status, and a tray icon. It is not code-signed yet. Download it from SourceForge or the Snap Store, or directly from namedaemon.com.
