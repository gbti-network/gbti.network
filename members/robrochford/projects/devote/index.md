---
title: 'Devote: A Distraction-Free Daily Devotional'
slug: devote
shortDescription: >-
  A full-screen daily devotional for Windows, macOS and Android: a moment of quiet, the day's
  reading with Matthew Henry's commentary, and guided reflection questions.
categories:
  - education
tags:
  - devotional
  - bible
  - electron
  - capacitor
  - react
  - android
platforms:
  - Windows
  - macOS
  - Android
pricing: free
icon: ./images/devote-icon-128.webp
iconLarge: ./images/devote-icon-256.webp
featuredImage: ./images/devote-featured.webp
gallery:
  - src: ./images/devote-choose-a-plan.webp
    caption: >-
      Setting up: Devote's recommended plan alternates the New Testament and the Psalms, or a custom
      library spreads the books you choose across the year.
  - src: ./images/devote-daily-reading.webp
    caption: The day's reading in the ESV, with Study one click away.
  - src: ./images/devote-commentary.webp
    caption: 'Study: Matthew Henry''s Concise Commentary on the day''s chapter.'
  - src: ./images/devote-go-in-peace.webp
    caption: 'Go In Peace: a closing blessing and the running streak.'
links:
  - label: Source on GitHub
    url: https://github.com/robrochford/Devote
    type: repository
  - label: Download for Windows and macOS
    url: https://github.com/robrochford/Devote/releases/latest
    type: download
bannerPreset: ink
status: published
visibility: public
publishedAt: '2026-10-03T14:23:40.428Z'
type: project
author: robrochford
---

Devote is a daily Christian devotional for Windows, macOS and Android. Once a day it opens full screen and walks through one short sequence, then gets out of the way until tomorrow.

## A day in Devote

1. **Be Still.** A moment of quiet before the reading begins.
2. **The Word.** The day's passage in the ESV, with audio, and a Study panel carrying Matthew Henry's Concise Commentary on the chapter.
3. **Guided Reflection.** Questions drawn from the day's reading, written by an AI model with your own Anthropic, OpenAI or Gemini key. The reading and the commentary work without one.
4. **Go In Peace.** A closing blessing and a running streak.

## Reading plans

Devote sets up a 365-day plan on first launch:

- **Devote's Recommendation** alternates daily between the New Testament and the Psalms, with the Gospels spread evenly across the year.
- **Custom Library** takes the books of the Bible you choose and alternates between them through the year.

## On the desktop

On Windows and macOS, Devote lives in the system tray and opens on its own when a new day begins at 4:00 in the morning. It can be snoozed for an hour or skipped for a day, it can launch when the computer starts, and it updates itself. Installers for both are on the GitHub releases page.

## On Android

The Android app is built from the same React codebase with Capacitor. The commentary is bundled for offline reading, and each day's audio is saved to the device after it first plays.
