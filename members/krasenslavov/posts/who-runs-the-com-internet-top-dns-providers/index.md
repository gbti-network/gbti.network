---
title: Who Runs the .com Internet? Top DNS Providers
slug: who-runs-the-com-internet-top-dns-providers
status: published
visibility: public
categories:
  - devops
  - tooling
tags:
  - webdev
  - cloud
  - data
  - dns
  - tld
layout: journal
coverImage: ./images/cover-15.png
featured: false
updatedAt: '2026-10-22T20:42:21.453Z'
publishedAt: '2026-10-22T20:42:21.454Z'
type: post
author: krasenslavov
---

The top DNS providers of .com are GoDaddy, with 21.66% of names, and Cloudflare, with 12.94%. Together they run about a third of the zone. We counted all 167 million names on 8 October 2026, each under the provider of its first nameserver.

## Who are the top DNS providers in .com?

A [DNS provider](https://namedaemon.com/glossary/dns-provider/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) runs the nameservers that tell the world where a name points. Every name in the .com zone lists at least one. We grouped the names by the company behind that nameserver.

| Rank | Provider | Names | Share of the zone |
| --- | --- | --- | --- |
| 1 | GoDaddy | 36,254,891 | 21.66% |
| 2 | Cloudflare | 21,649,792 | 12.94% |
| 3 | Google Domains | 7,831,569 | 4.68% |
| 4 | Namecheap | 6,126,924 | 3.66% |
| 5 | dns-parking.com | 5,217,859 | 3.12% |
| 6 | Afternic (GoDaddy marketplace) | 5,044,711 | 3.01% |
| 7 | Wix | 4,826,924 | 2.88% |
| 8 | NameBright | 3,521,223 | 2.10% |
| 9 | Alibaba Cloud (HiChina) | 2,713,056 | 1.62% |
| 10 | Amazon Route 53 | 2,323,462 | 1.39% |

The top 15 providers run about 62% of all names. However, a long tail of thousands of smaller providers runs the rest. Our [State of .com page](https://namedaemon.com/state-of-com/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) keeps the full ranking and updates it daily.

## How concentrated are the top DNS providers?

The top two providers alone run about 35% of the zone. That is a large share for a system built to spread the load. The reason is simple: most people do not choose a DNS provider. Their registrar or web host does it for them.

GoDaddy leads because it is also one of the largest registrars. Cloudflare is different. Many owners pick it on purpose, for speed and for its free plan. So the first place reflects habit, and the second reflects choice.

## What parking and marketplace names do

Some entries in the table are not ordinary hosts. The provider dns-parking.com looks like a parking service, and Afternic is a marketplace for names that are for sale. Together they run about 6% of all names.

A parked name points to a page that shows ads or a "for sale" notice. These names do not have a real website. So the real share of working sites is lower than the raw ranking suggests.

## Why the top DNS providers matter

DNS is a quiet point of failure. If a big provider has an outage, millions of names can stop resolving at the same time. That has happened to large providers in the past, and it will happen again.

Concentration also affects safety and choice. A single account that holds your name, site and DNS is easier to attack. Many owners now keep their DNS at a separate provider as a backup. Our post on [registrar vs web host vs DNS provider](https://namedaemon.com/blog/registrar-vs-web-host-vs-dns-provider/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) shows how to split the jobs.

## How to find the provider of any name

You do not have to guess. The [Hosting Stats](https://namedaemon.com/tools/hosting-stats/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) tool shows the market share of providers and looks up the DNS provider of any name. The [Domain Health Check](https://namedaemon.com/tools/domain-health/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) lists the [nameservers](https://namedaemon.com/glossary/nameserver/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) of a name along with its email records.

Remember that the DNS provider is often, but not always, the registrar or the web host. It tells you who answers the DNS question, not who stores the website. For the numbers about the zone itself, read [how many .com domains there are](https://namedaemon.com/blog/how-many-com-domains-are-there/?utm_source=devto&utm_medium=republish&utm_campaign=nd30).

## What this ranking cannot tell you

A ranking by nameserver has limits. First, we count each name once, under its first nameserver. A name that uses two providers shows up under only one. Second, the label is a best guess for well-known providers, and unknown ones show their raw name.

Also, DNS is not hosting. A name can use one company for DNS and another for its website. So this table shows who answers the DNS question, not who stores the pages. Use it as a map of who sits in the middle of .com, and nothing more.

## What to remember

A few companies run a large part of .com DNS, and most owners never chose them. Know who runs yours, and keep a copy of your records. Verisign, which runs the registry, publishes the zone every day, as its page on [.com](https://www.verisign.com/en_US/domain-names/dot-com/index.xhtml) explains. The providers in this table do the work that makes each name answer.

---

*Originally published at [namedaemon.com/blog/top-dns-providers-who-runs-the-com-internet/](https://namedaemon.com/blog/top-dns-providers-who-runs-the-com-internet/). NameDaemon has 18 free tools for .com names, built on the daily zone file, and the numbers are on the [State of .com](https://namedaemon.com/state-of-com/?utm_source=devto&utm_medium=republish&utm_campaign=nd30) page.*
