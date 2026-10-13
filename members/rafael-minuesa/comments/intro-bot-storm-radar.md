---
id: intro-bot-storm-radar
targetType: project
targetSlug: bot-storm-radar
createdAt: '2026-10-13T21:28:42.676Z'
status: published
visibility: public
authorNote: true
type: comment
author: rafael-minuesa
---

I wrote Bot Storm Radar after bot swarms kept hitting the sites I managed with increasing frequency this year. A MediaWiki installation, several WooCommerce stores, my own agency site, etc. Every time the pattern was the same: thousands of residential addresses, 1 or 2 requests each, a handful of browser strings rotated evenly, almost nobody fetching a stylesheet. 

The worst one brought about 256,000 addresses in 3 hours. nginx rate limits, fail2ban and user-agent rules were all working as designed on those servers, but none of them could see any of it, because no single address did anything wrong. The crowd was the only thing that stood out, so the plugin scores the crowd. Start it in observe mode, give it a week to learn your baseline, and read the Bans tab before you switch enforcement on. 

If you run the GitHub build, get a free AbuseIPDB key, save it under Settings and let it report the scanners it bans. Every scanner reported from your site is one more that other sites can refuse. Bug reports and pull requests on GitHub are welcome as well.
