---
title: SavePoint Broadcasting Software
slug: savepoint-broadcasting-software
shortDescription: >-
  Desktop software for running 24/7 live radio and video channels on a schedule. Stream to Discord,
  YouTube, Twitch, Kick, and Mixcloud from your own hardware.
categories:
  - entertainment
status: published
visibility: public
publicStub: false
pricingUrl: https://savepoint.fm/pricing?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory
version: 1.57.1
requires: Windows 10+ or Node 22+
tags:
  - broadcasting
  - live-streaming
  - online-radio
  - discord
  - youtube
  - twitch
  - kick
  - mixcloud
  - rtmp
  - self-hosted
platforms:
  - Windows
  - macOS
  - Linux
  - WSL
icon: ./images/savepoint-icon-128x128.webp
iconLarge: ./images/savepoint-icon-256x256.webp
banner: ./images/savepoint-banner.webp
featuredImage: ./images/savepoint-featured.webp
gallery:
  - src: ./images/savepoint-dashboard.webp
    caption: Broadcast Control, with Start Broadcast, a toggle for each connected channel, and station totals.
  - src: ./images/savepoint-schedule.webp
    caption: The weekly schedule as a timeline, with the live broadcast summary and session history in the sidebar.
  - src: ./images/savepoint-channels.webp
    caption: Channel setup for Discord, YouTube, Mixcloud, Restream, custom RTMP, Twitch, TikTok Live, and Kick, plus the listener chat commands.
  - src: ./images/savepoint-pre-rendering.webp
    caption: The pre-rendering queue, showing each track in progress with its workers, frame rate, and completion.
  - src: ./images/savepoint-deploy-connection.webp
    caption: The Deployment connection tab, where a production server is configured over SSH with key-based authentication.
  - src: ./images/savepoint-deploy-push.webp
    caption: Push to Production, choosing the deployment type, what to deploy, and which stations to include.
  - src: ./images/savepoint-deploy-pull.webp
    caption: Pull from Production, merging favorites, exclude lists, channel settings, and broadcast history into the local copy.
  - src: ./images/savepoint-deploy-jobs.webp
    caption: The deployment jobs history, listing each completed push and what it included.
video: https://www.youtube.com/watch?v=_Sli3U6wb8w
sidebarPosition: right
links:
  - type: download
    url: https://savepoint.fm/download?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory
    label: Download SavePoint
    primary: true
  - type: homepage
    url: https://savepoint.fm/?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory
    label: savepoint.fm
  - type: documentation
    url: https://savepoint.fm/documentation?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory
    label: Documentation
type: project
author: atwellpub
publishedAt: '2026-09-12T23:30:51.000Z'
---

SavePoint is a desktop application for running an online radio or video station around the clock. You build playlists and segments, arrange them on a weekly schedule, and SavePoint airs that schedule to every channel you have connected. The station runs on your own hardware and storage.

## Broadcast control

Start Broadcast, on the Broadcast Control dashboard, puts the station on air on every channel you have switched on. The dashboard also counts the station's playlists, segments, and hours streamed.

## A weekly schedule

The schedule lays out each day of the week on a timeline. You control each slot separately, deciding what airs in it and which contributors may use it. Pre-recorded and live blocks share the same schedule, and the sidebar shows what is on air, what plays next, and the recent session history.

## Streaming channels

SavePoint streams to Discord, YouTube, Twitch, Kick, Mixcloud, and TikTok Live, and to any other service with an RTMP or RTMPS endpoint. You can also connect Restream, which passes the broadcast on to the destinations Restream supports.

Listeners can ask the station what is playing. In Discord voice channel chat and YouTube live chat, `!segment` shows the current segment, `!playlist` lists the tracklist, and `!last` and `!next` show the previous and upcoming tracks. The same commands also work with a `/` prefix.

Chat Explorer gathers chat from Discord, YouTube, Twitch, and Kick into one feed. From that page you can send one message to several platforms, schedule messages ahead of time, and delete messages, time out users, or ban them where a platform allows it. SavePoint logs each moderation action, so co-hosts can see who did what.

## Sub-accounts and live contributors

Co-hosts, DJs, and other contributors sign in with sub-accounts instead of the owner account. You scope each sub-account to specific segments, playlists, and broadcasting capabilities, and each one has a DJ Mode for live talk-overs.

You can hand any scheduled block to a sub-account. The contributor broadcasts live from their own setup over RTMP, every connected channel switches to their feed for that slot, and the station returns to its own programming when the slot ends.

## Pre-rendering

For video broadcasts, SavePoint renders tracks into video before they air. The pre-rendering queue shows each track in progress with its worker count and frame rate, and you can leave the worker count on automatic.

## Deploying to a production server

You can build and test a station on your own machine, then deploy it to a production server over SSH. The Deployment page stores the server connection and uses key-based authentication.

Push to Production sends the parts you choose: application code, the database, the media library, and video pre-renders. It can take a full backup on the server first, and you pick which stations to include. Pull from Production goes the other way. It merges favorites, exclude lists, channel profile settings, and broadcast history from the server into your local copy without removing anything already there. The jobs history records every push and pull.

## Now Playing API

A public Now Playing feed reports what is on air at any moment, including which member is live during a contributor segment. Widgets, embeds, and other integrations can read from it.

## Install

SavePoint runs as a Windows application on Windows 10 and 11 (64-bit). A command-line install runs the same broadcast engine on macOS, Linux, and Windows Subsystem for Linux, and requires Node 22 or newer. Both are on the [download page](https://savepoint.fm/download?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory), and the [documentation](https://savepoint.fm/documentation?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory) covers installation and first setup. The [pricing page](https://savepoint.fm/pricing?utm_source=gbti-network&utm_medium=referral&utm_campaign=directory) lists the current plans.
