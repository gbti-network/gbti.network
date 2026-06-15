---
type: product
title: "Traveler's Lectern"
slug: travelers-lectern
author: atwellpub
status: published
visibility: public
shortDescription: "A Minecraft mod that adds lecterns with regenerating books on a configurable cooldown."
categories: ["minecraft", "mods"]
icon: "./images/minecraft-mod-travelers-lectern-icon-128x128-1.webp"
publishedAt: 2025-09-27
banner: "./images/github-product-banner-minecraft-mod-travelers-lectern.webp"
featuredImage: "./images/travelers-lectern-featured.webp"
gallery:
  - "./images/travelers-lectern-shot-1.webp"
  - "./images/travelers-lectern-shot-2.webp"
  - "./images/travelers-lectern-shot-3.webp"
  - "./images/travelers-lectern-shot-4.webp"
  - "./images/travelers-lectern-shot-5.webp"
  - "./images/travelers-lectern-shot-6.webp"
video: "pjTmNA3EKcE"
links:
  - { type: download, url: "https://modrinth.com/mod/travelers-lectern", primary: true }
  - { type: repository, url: "https://github.com/gbti-network/minecraft-mod-travelers-lectern" }
---

# Traveler's Lectern

A Minecraft mod that implements lecterns with regenerating books. When a book is taken from a Traveler's Lectern, it will reappear after a configurable cooldown period.

## Features

-   Automatic book regeneration with configurable cooldown timers
-   Server-side implementation for multiplayer compatibility
-   Permission-based lectern management
-   Configuration via simple commands
-   Built for Minecraft 1.21.1 (Fabric Server Required)

## Use Cases

-   Quest hubs
-   Information centers
-   Libraries
-   Educational servers
-   Adventure maps

## Technical Specifications

**Requirements:**

-   Minecraft 1.21.1
-   Fabric Loader ≥0.16.5
-   Fabric API
-   Java 21 or higher

**Implementation Details:**

-   Server-side mod
-   No client-side installation required
-   Configurable debug logging
-   JSON-based data storage

## Commands

Admin-level commands (requires permission level 4):

-   `/travelers_lectern create [time]`: Creates a new Traveler's Lectern
-   `/travelers_lectern edit [time]`: Modifies cooldown time
-   `/travelers_lectern destroy`: Removes Traveler's Lectern functionality

## Configuration

Settings are stored in `config/travelers-lectern/`:

-   `travelers_lectern_config.txt`: Debug settings
-   `travelers_lecterns.json`: Lectern data

## Support

-   [Issue Tracker](https://github.com/gbti-network/minecraft-mod-travelers-lectern/issues)
-   [Source Code](https://github.com/gbti-network/minecraft-mod-travelers-lectern)
-   [Modrinth](https://modrinth.com/mod/travelers-lectern)

## License

GNU General Public License v3.0
