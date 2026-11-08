---
title: "What Is the Most Used Version of Minecraft Java in 2026?"
slug: what-is-the-most-used-version-of-minecraft-java
status: draft
visibility: public
publicStub: false
excerpt: "26.3 leads on Paper-family servers and in Fabric and Quilt mod downloads; Forge mods are downloaded most for 1.20.1 and NeoForge mods for 1.21.1."
categories:
  - entertainment
  - gaming
  - minecraft
tags:
  - minecraft
  - minecraft-java
  - minecraft-servers
  - mods
  - research
coverImage: ./images/minecraft-java-versions-2026.webp
layout: journal
featured: false
publishedAt: '2026-10-24T00:00:00.000Z'
type: post
author: gbtilabs
---

In this article we take a look at the most played version of Minecraft Java in 2026.

When a Minecraft Java player joins a custom server, the player has to run the Minecraft version that the server supports.

We wanted to build an understanding of not only which Minecraft Java version was most being played in 2026, but also what type of server software was being used since there are many unique frameworks being used to run Minecraft servers.

Inside this article we will ask the following questions given the data currently available on the internet:

- What is the most used version of Minecraft Java?
- What version do most Minecraft servers use?
- What is the most popular Minecraft version for mods?
- Which Minecraft server software is most popular?

## What is the most used version of Minecraft Java?

![Every Minecraft Java version's share averaged over five kinds of server, each counted equally: 1.20.1 24.6%, 26.3 15.0%, 1.21.1 13.5%, 1.21.11 10.3%, 26.2 9.2%, other versions 27.3%. The five are Paper-family servers (bStats, read 24 October 2026) and Fabric, Forge, NeoForge and Quilt mod downloads (Modrinth, 17 October 2026 to 24 October 2026).](./images/most-used-average.svg)

Averaged across the five kinds of server, 1.20.1 is the most used version of Minecraft Java, at 24.64%. It is the most downloaded version for Forge mods, with 66.30% of their downloads, and the second for Fabric, NeoForge and Quilt mods. 26.3 comes next at 15.01%, and it is the top version on Paper-family servers and for Fabric and Quilt mods.

```reveal Show how the average is calculated
---
For each version, we add up its share on each of the five kinds of server, then divide the total by five:

`average = (Paper family + Fabric + Forge + NeoForge + Quilt) ÷ 5`

For 1.20.1: (2.20% + 16.19% + 66.30% + 21.71% + 16.80%) ÷ 5 = 123.20% ÷ 5 = 24.64%.

The Paper-family figure is a share of servers and the other four are shares of one week of mod downloads. Each kind counts the same, however many servers or downloads stand behind it, and each kind's shares add up to 100%, so the averages do too. The next section shows each kind on its own.
```

## What version do most Minecraft servers use?

![The four most used Minecraft Java versions on each kind of server. Paper family (servers, bStats): 26.3 23.4%, 1.21.11 23.1%, 26.2 23.1%, 26.1.2 6.9%. Fabric (mod downloads, Modrinth): 26.3 22.1%, 1.20.1 16.2%, 1.21.1 14.9%, 1.21.11 13.0%. Forge (mod downloads, Modrinth): 1.20.1 66.3%, 1.20 13.0%, 1.19.2 2.3%, 1.20.2 1.8%. NeoForge (mod downloads, Modrinth): 1.21.1 39.1%, 1.20.1 21.7%, 1.21 8.6%, 26.3 8.2%. Quilt (mod downloads, Modrinth): 26.3 20.0%, 1.20.1 16.8%, 1.21.11 12.7%, 1.21.1 10.0%. Servers read 24 October 2026; downloads from 17 October 2026 to 24 October 2026.](./images/most-used-by-kind.svg)

26.3 is the most used version on Paper-family servers, at 23.38%, and the most downloaded version for Fabric and Quilt mods. Forge mods are downloaded most for 1.20.1, and NeoForge mods for 1.21.1.

### How this was gathered

Paper-family servers report their version to bStats[^1]. bStats is the built-in reporting engine that keeps track of global usage, so we were able to collect data on over 196,558 servers. The Paper family is Paper itself, Spigot, which Paper is built on, and the servers built on Paper, such as Purpur, Leaf and Folia.

Fabric, Forge, NeoForge and Quilt servers do not have the same reporting mechanisms, so we had to take a different path to understand version-usage stats by reviewing known statistics of the last week of mod download data publicly available from each platform's 500 most downloaded mods on Modrinth[^2], one of the most popular mod hosting sites.

```callout info
**Did you know?** Mojang [announced](https://www.minecraft.net/en-us/article/minecraft-new-version-numbering-system) on 2 December 2025 that Minecraft would number its versions by year. The first number is the year, the second is the release within that year, and the third is the hotfix, so 26.1.2 is the second hotfix of the first release of 2026. The last version numbered the old way, starting with "1.", was 1.21.11, according to the [Minecraft Wiki](https://minecraft.wiki/w/Version_formats).
```

## What is the most popular Minecraft version for mods?

It depends on the platform. On Modrinth, Fabric and Quilt mods are downloaded most for 26.3, Forge mods for 1.20.1 and NeoForge mods for 1.21.1.

### Fabric servers

Fabric's most downloaded version is 26.3 at 22.14%. The next two are 1.20.1 at 16.19% and 1.21.1 at 14.89%. These are shares of one week of downloads of the 500 most downloaded Fabric mods on Modrinth.

![Share of one week of Fabric mod downloads by Minecraft version, 17 October 2026 to 24 October 2026, for the 500 most downloaded Fabric mods (Modrinth only): 26.3 22.1%; 1.20.1 16.2%; 1.21.1 14.9%; 1.21.11 13.0%; 26.2 9.4%; 1.21 4.9%.](./images/loader-fabric.svg)

#### Fabric API by version

Fabric API is a library mod that most Fabric mods need, according to Fabric's own [documentation](https://docs.fabricmc.net/players/installing-mods), so its downloads are the clearest single sign of which versions Fabric runs on.

| Minecraft version | Weekly downloads | Share of the week |
|---|---|---|
| 26.3 | 2,745,580 | 37.96% |
| 1.21.11 | 1,292,528 | 17.87% |
| 26.2 | 837,048 | 11.57% |
| 1.21.1 | 802,316 | 11.09% |
| 1.20.1 | 562,513 | 7.78% |
| 1.21.4 | 145,301 | 2.01% |

*Fabric API on Modrinth, 17 October 2026 to 24 October 2026.*

## Which Minecraft server software is most popular?

Paper is the most used server software by far: 74.39% of the 190,740 servers that report their software to bStats run it, against 9.05% for Purpur and 6.30% for Spigot. For mods it depends on the site. Fabric mods are downloaded most on Modrinth, ahead of Forge. On CurseForge, NeoForge mods are downloaded most and Forge is second, ahead of Fabric. Quilt is fourth on both.

This table gives each mod platform's total downloads for the week on Modrinth and on CurseForge[^3], the two mod sites we measured, and each server software's count of servers reporting to bStats. A mod made for several platforms counts in each of their rows, so the download rows cannot be added together. CurseForge appears only here, because its per-version download counts barely moved during the week.

| Platform | Modrinth downloads | CurseForge downloads | Servers on bStats |
|---|---|---|---|
| Fabric | 263,147,623 | 241,759,579 | not measured |
| Forge | 206,867,186 | 275,835,894 | not measured |
| NeoForge | 237,817,761 | 289,926,225 | not measured |
| Quilt | 168,295,563 | 124,002,301 | not measured |
| Paper | not measured | not measured | 141,897 (74.39%) |
| Purpur | not measured | not measured | 17,261 (9.05%) |
| Spigot | not measured | not measured | 12,023 (6.30%) |
| Leaf | not measured | not measured | 4,412 (2.31%) |
| UniverseSpigot | not measured | not measured | 2,093 (1.10%) |
| Arclight | not measured | not measured | 1,519 (0.80%) |
| Folia | not measured | not measured | 1,361 (0.71%) |
| Mohist | not measured | not measured | 927 (0.49%) |
| AdvancedSlimePaper | not measured | not measured | 926 (0.49%) |
| Other or not recognized | not measured | not measured | 8,321 (4.36%) |

*Downloads: the 500 most downloaded mods per platform, 17 October 2026 to 24 October 2026. Servers: bStats, read 24 October 2026, out of the 190,740 servers that report their software.*

![Weekly mod downloads by platform, 17 October 2026 to 24 October 2026, for the 500 most downloaded mods per platform. Modrinth: Fabric 263,147,623, Forge 206,867,186, NeoForge 237,817,761, Quilt 168,295,563. CurseForge: Fabric 241,759,579, Forge 275,835,894, NeoForge 289,926,225, Quilt 124,002,301. A mod made for several platforms counts for each of them.](./images/downloads-by-platform.svg)

## Version leaders on Paper-family servers since 2018

The oldest copy of bStats' version chart in the Internet Archive[^4] is from July 2018, so that is where this history starts. In the archived copies, 15 different versions held the top spot, starting with 1.12.2 at 49.40% in July 2018. The highest share any version reached was 51.83%, by 1.20.1 in September 2023, and 1.21.11 reached 48.05% in March 2026.

1.21.4 held the top spot longest, in nine copies in a row from February 2025 to August 2025. Leaders have held between 19.61% and 51.83%, so 26.3's 23.38% is within the usual range. The archive has no copies from August 2018 to July 2020, which the chart marks, and other months it missed may hide versions that led briefly.

![The most used Minecraft Java version on servers reporting to bStats, at each archived reading from 2018 to 2026 and our reading of 24 October 2026, with its highest share while it led: 1.12.2 (Jul 2018) 49.4%; 1.16.1 (Aug 2020 to Sep 2020) 39.8%; 1.16.5 (Feb 2021) 38.7%; 1.17.1 (Sep 2021) 45.2%; 1.18.2 (Apr 2022 to Jun 2022) 45.9%; 1.19 (Jul 2022 to Aug 2022) 34.0%; 1.19.2 (Oct 2022 to Nov 2022) 45.9%; 1.19.3 (Feb 2023 to Mar 2023) 38.0%; 1.20.1 (Jul 2023 to Jan 2024) 51.8%; 1.20.4 (Mar 2024 to Jun 2024) 42.0%; 1.21 (Aug 2024 to Sep 2024) 34.2%; 1.21.1 (Sep 2024) 24.2%; 1.21.4 (Feb 2025 to Aug 2025) 40.2%; 1.21.8 (Oct 2025 to Nov 2025) 25.8%; 1.21.11 (Mar 2026) 48.0%; 26.3 (our reading, Oct 2026) 23.4%. The archive has no copies from August 2018 to July 2020.](./images/most-used-version-since-2018.svg)

### Servers still on 1.8

In July 2018, 31.40% of servers ran a 1.8 release. Now 2.18% do. Version 1.9 changed combat by adding an attack cooldown, according to Mojang's [release notes](https://web.archive.org/web/20161218214458/http://mojang.com/2016/02/minecraft-19-combat-update/), and Hypixel [said](https://hypixel.net/threads/hypixel-now-supports-minecraft-version-1-13.1698790/) in 2018 that it was still optimized for 1.8.9. Neither source says why other servers stayed on 1.8.

![Share of servers reporting to bStats that run a Minecraft 1.8 release, at the first archived reading of each year and our reading of 24 October 2026: Jul 2018 31.4%; Aug 2020 13.1%; Feb 2021 8.9%; Apr 2022 7.3%; Feb 2023 5.8%; Jan 2024 4.9%; Feb 2025 3.7%; Mar 2026 2.6%; Oct 2026 2.2%.](./images/servers-on-1-8.svg)

## Java runtimes and proxies

Minecraft servers run on Java, the programming language. Of the servers reporting to bStats, 66.34% run Java 25 and 23.78% run Java 21. Every year-based version needs Java 25 ([Mojang](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1)), and more servers run Java 25 than run a year-based version (53.67%), so some servers still on 1.21 already use Java 25.

![Java runtime of the 197,495 Paper-family servers reporting to bStats, read 24 October 2026: Java 25 66.3%; Java 21 23.8%; Java 17 2.7%; Java 8 2.3%; Java 26 2.3%; Java 22 0.8%; Everything else 1.7%.](./images/java-runtimes.svg)

A proxy joins several servers into one network that players move between. Velocity passed BungeeCord in July 2024, by monthly average, and in October 2026 Velocity averaged 13,391 proxies to BungeeCord's 2,115, counting only proxies that run at least one bStats plugin.[^5]

![Proxies running at least one bStats plugin, monthly average: Jan 2024: Velocity 4,246, BungeeCord 7,265; Jul 2024: Velocity 6,452, BungeeCord 6,056; Jan 2025: Velocity 7,863, BungeeCord 5,284; Jul 2025: Velocity 9,547, BungeeCord 4,327; Jan 2026: Velocity 11,258, BungeeCord 3,488; Jul 2026: Velocity 12,953, BungeeCord 2,607; Oct 2026: Velocity 13,391, BungeeCord 2,115.](./images/proxies.svg)

## How we measured

We measured Paper-family servers through bStats, which collects statistics from Paper itself and from every server running a plugin that reports to it. We read its overall version, software, Java and proxy charts, plus the version chart each server software publishes there. We took full readings on the first, fourth and last day of the week from 17 October 2026 to 24 October 2026, and a shorter reading every three hours in between. For Fabric, Forge, NeoForge and Quilt we counted downloads of the 500 most downloaded mods on Modrinth during the same week. From CurseForge we used only each platform's weekly total, because its per-version counters barely moved.

```reveal Show the full method
---
bStats numbers count servers that run at least one plugin with bStats enabled. Each server submits once every 30 minutes to the global charts, and the same server appears once no matter how many bStats plugins it runs. bStats caps submissions at 16 servers per IP address each half hour on the global charts, and at 8 per IP on per-software pages. Servers behind a single address that run more than that are undercounted.

We took full readings on the first, fourth and last day of the week from 17 October 2026 to 24 October 2026: the version, software, Java runtime and proxy charts, and every per-software version page that bStats lists. Every three hours in between, a shorter reading recorded the global version and software charts and the version charts of Paper, Purpur, Leaf, UniverseSpigot and Folia. Three of those were missed on 18 October, when the machine taking them was off.

For Fabric, Forge, NeoForge and Quilt we tallied downloads on Modrinth for the 500 most downloaded mods of each platform from 17 October 2026 to 24 October 2026. Those 500 mods covered between 69.51% and 91.71% of each platform's Modrinth downloads that week. A mod built for several platforms counts toward each platform's total. Modrinth counts one download per address per project in any 15 seconds, and at most six per address per project in six hours.

Version strings were cleaned against Mojang's version manifest. Strings that matched a known Java release were grouped under that release. Anything else, such as mod version strings, git builds and typos, was counted as other and left out of the shares.

CurseForge counts downloads per mod and per file. During the week its per-file counts grew by only 1.8% as much as its per-mod counts, so its per-version figures could not be used, and the article uses CurseForge's weekly totals per platform instead.

The limits of this measurement are:
- Servers with bStats switched off are missing entirely.
- ViaVersion and ViaBackwards allow players to join on a different client version than the server runs, so the server version chart does not necessarily match the versions players use.
- Proxy counts include only those proxies that run at least one bStats plugin.
```

## Short answers about Minecraft Java versions

**What is the latest version of Minecraft Java?** The latest release is 26.3. Mojang shipped it on 15 September 2026.

**Which versions do Fabric and Forge players use most?** On Modrinth, in the week we measured, Fabric's most downloaded version was 26.3. Forge's was 1.20.1. NeoForge's was 1.21.1, and Quilt's was 26.3.

**Why do some servers still run 1.8?** The sources do not state a reason. Hypixel said in 2018 that it was still optimized for 1.8.9, but that does not explain why other servers stayed.

Paper-family servers report their Minecraft versions directly to bStats[^1], a statistics service integrated into Paper. This allows the article to count servers by version. Fabric, Forge, NeoForge and Quilt servers do not provide equivalent reporting, so the article estimates their version usage based on mod download activity for each Minecraft version on Modrinth[^2], with each platform's weekly totals from CurseForge[^3].

## Sources

- [bStats global Bukkit charts](https://bstats.org/global/bukkit): server versions, software, Java runtimes and historical counts.
- [bStats Velocity](https://bstats.org/global/velocity) and [BungeeCord](https://bstats.org/global/bungeecord) charts: proxy counts.
- [bStats per-software pages](https://bstats.org/plugin/server-implementation/paper/580): versions on each server software (Paper's page shown; the others follow the same address pattern).
- [bStats software API](https://bstats.org/api/v2/software): per-IP submission caps.
- [Internet Archive](https://web.archive.org/): archived bStats charts from 2018 to 2026.
- [Mojang version manifest](https://piston-meta.mojang.com/mc/game/version_manifest_v2.json): Java release dates and strings.
- [Mojang new-version numbering](https://www.minecraft.net/en-us/article/minecraft-new-version-numbering-system): the year-based scheme and Java's hotfix format.
- [Minecraft Wiki version formats](https://minecraft.wiki/w/Version_formats): 1.21.11 as the last "1." release.
- [PaperMC downloads service](https://fill.papermc.io/v3/projects/paper): build dates and support status for Paper and Folia.
- [Purpur downloads API](https://api.purpurmc.org/v2/purpur): Purpur build dates.
- [Leaf downloads API](https://api.leafmc.one/v2/projects/leaf): Leaf build dates and release channels.
- [Mojang 26.1 release notes](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-1): Java 25 requirement.
- [Mojang 1.9 combat update](https://web.archive.org/web/20161218214458/http://mojang.com/2016/02/minecraft-19-combat-update/): attack cooldown.
- [Hypixel 1.8.9 statement](https://hypixel.net/threads/hypixel-now-supports-minecraft-version-1-13.1698790/): optimization for 1.8.9.
- [ViaVersion](https://github.com/ViaVersion/ViaVersion): version proxying between client and server.
- [Modrinth API](https://api.modrinth.com/v2): mod downloads by platform and version.
- [Modrinth Labrinth server code](https://github.com/modrinth/code): download counting rules.
- [CurseForge API](https://api.curseforge.com): weekly download totals per platform.
- [Forge 1.20.1 policy](https://forums.minecraftforge.net/topic/154387-forge-474-minecraft-1201/): long-term version plan.
- [NeoForge 21.2 release](https://neoforged.net/news/21.2release/): 1.21.1 as the recommended maintenance version.
- [NeoForge 26.1 release](https://neoforged.net/news/26.1release/): 26.1 as the expected next stable version.
- [Fabric API docs](https://docs.fabricmc.net/players/installing-mods): majority of mods require Fabric API.
- [Arclight](https://github.com/IzzelAliz/Arclight): hybrid server implementation.

[^1]: [bStats global charts](https://bstats.org/global/bukkit): bStats collects usage statistics from Minecraft servers, and its charts give the share of servers on each Minecraft version, server software and Java runtime, read several times a day from 17 October 2026 to 24 October 2026.

[^2]: [Modrinth API](https://api.modrinth.com/v2): one week of downloads, 17 October 2026 to 24 October 2026, for the 500 most downloaded mods of each platform, split by Minecraft version.

[^3]: [CurseForge API](https://api.curseforge.com): each platform's total downloads for the same week.

[^4]: [Internet Archive](https://web.archive.org/): archived copies of the bStats version chart since July 2018, for the most used version over time.

[^5]: [bStats proxy charts for Velocity](https://bstats.org/global/velocity) and [BungeeCord](https://bstats.org/global/bungeecord): the proxy counts.
