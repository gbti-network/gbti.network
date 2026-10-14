---
type: project
title: Jockey Radio
slug: jockey-radio
author: atwellpub
status: published
visibility: public
shortDescription: >-
  A Minecraft Fabric server mod that puts live radio, streams, and custom audio on music discs, played
  through jukebox speakers with Simple Voice Chat.
categories:
  - entertainment
  - gaming
  - minecraft
  - mods
tags:
  - minecraft
  - fabric
  - server-side
  - simple-voice-chat
  - internet-radio
  - rtmp
  - music-discs
platforms:
  - Minecraft Java
pricing: free
requires: Minecraft 26.2 with Fabric API and Simple Voice Chat 2.6.21+
license: Custom
licenseUrl: https://github.com/gbti-network/jockey-radio/blob/main/LICENSE
icon: ./images/jockey-radio-icon-128x128.webp
iconLarge: ./images/jockey-radio-icon-256x256.webp
featuredImage: ./images/jockey-radio-featured.webp
bannerPreset: mods
gallery:
  - src: ./images/jockey-radio-shot-1.webp
    caption: Nearby players hear the jukebox through Simple Voice Chat while the HUD reports that the station is on air.
  - src: ./images/jockey-radio-shot-2.webp
    caption: Connect an HLS playlist, internet radio station, podcast feed, or HTTP audio stream, and set its range and look.
  - src: ./images/jockey-radio-shot-3.webp
    caption: Set up an RTMP receiver for OBS, DJ software, broadcast automation, or a relay, with its port, stream key, and public host.
  - src: ./images/jockey-radio-shot-4.webp
    caption: Copy the RTMP server, stream key, or full ingest URL, then test, monitor, or give the finished disc in game.
  - src: ./images/jockey-radio-shot-5.webp
    caption: Loop or play audio files kept on the server or reached over HTTP, with repeat behavior, radius, colors, and styles.
  - src: ./images/jockey-radio-shot-6.webp
    caption: Radio discs can take the look of any disc in Minecraft's music-disc collection.
sidebarPosition: right
video: 69d1GtO3CP8
links:
  - type: download
    url: https://github.com/gbti-network/jockey-radio/releases
    label: Download from GitHub
    primary: true
  - type: repository
    url: https://github.com/gbti-network/jockey-radio
  - type: documentation
    url: https://github.com/gbti-network/jockey-radio/tree/main/docs/user
    label: Setup guides
  - type: support
    url: https://github.com/gbti-network/jockey-radio/issues
    label: Report an issue
publishedAt: 2026-10-13
---

Create a disc, place it in a jukebox, and nearby players hear the audio through
[Simple Voice Chat](https://modrinth.com/plugin/simple-voice-chat). Players listen with the standard
Simple Voice Chat client, so no other client mod is needed.

## Audio sources

Each radio disc plays one source:

- **HLS and internet radio:** HLS playlists, SavePoint station streams, Icecast streams, HTTP audio, and
  compatible broadcast endpoints.
- **RTMP receive:** the Minecraft server becomes an RTMP ingest endpoint, so you can broadcast directly from
  OBS, SavePoint, or other broadcasting software or relays.
- **Direct URLs and local audio:** play a direct audio URL or loop a file kept on the server.
- **SavePoint:** connect a SavePoint station over HLS, or push a live SavePoint broadcast into Minecraft over
  RTMP. The [Now Playing API](https://savepoint.fm/docs/api/now-playing-api) shows the current track in the
  boss bar.

## The /jockey disc manager

Operators run `/jockey` to open the server-side disc manager. From it they can:

- Create, edit, test, give, and delete radio discs
- Set an audible radius for each disc
- Choose each disc's appearance, display name, color, and text style
- Copy the RTMP server, stream key, and full ingest URL
- Configure now-playing metadata and marquee templates
- See live, idle, and buffering states
- Run several stations and jukeboxes at the same time

Radio discs remain ordinary Minecraft music-disc items. Inserting one starts its source, and ejecting it
stops playback.

## Requirements

On the server:

- Minecraft 26.2
- Fabric Loader 0.19.3 or newer
- Fabric API
- Simple Voice Chat 2.6.21 or newer
- Java 25

Players need the normal Simple Voice Chat client and its dependencies. If game sounds play in your
headphones but the radio plays on your speakers, set Simple Voice Chat's output device to your headphones.

## Bundled media tools

The release jar bundles ffmpeg, for decoding and RTMP ingest, and yt-dlp, for optional platform-link
resolution. They extract into the server configuration directory on first use, so the mod runs on managed
hosts that offer no shell access. Server operators can turn the bundled binaries off and provide their own
executable paths instead. The release includes third-party notices and license texts.

## Platform links

Platform-link resolution is off unless a server operator sets `enablePlatformLinks`. Before turning it on,
the operator must review the terms of service of every platform they intend to use and confirm they hold
the rights to rebroadcast the selected content. Jockey Radio distributes no audio, grants no rebroadcasting
rights, and is not affiliated with or endorsed by any of those platforms.

## Scaling

Jockey Radio has not yet been load-tested at large-server scale. Testing so far covers four to six
simultaneous audio sources on the development host. Jukeboxes playing the same disc share one upstream
feed, but each active jukebox still needs its own encoder and Simple Voice Chat channel. Increase usage
gradually while watching server tick time, CPU, memory, and network traffic.

## AI disclosure

Jockey Radio is developed by the GBTI Network, a team with over 20 years of combined experience in product
and application development. We use modern AI coding tools (Claude Code, Codex, and OpenClaw) as
assistants in our workflow. AI-generated code is present in the project.

## License

Jockey Radio is a GBTI project distributed under an All Rights Reserved license. The source is published on
GitHub.
