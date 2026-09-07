---
type: post
title: "A Claude Code status line that shows what is left of your usage budget"
slug: claude-code-status-line-usage-budget
author: atwellpub
status: draft
visibility: public
publishedAt: 2026-09-07
excerpt: "The Claude Code status line turns out to be a script you can replace. Stefano Ginella's puts your rate limits on screen and works out whether today's pace reaches the weekly reset."
categories: ["ai", "agents"]
tags: ["claude-code", "status-line", "rate-limits", "developer-tools"]
coverImage: "./images/cover.webp"
---

I only recently learned that the Claude Code status line is something you can change.

It sits at the bottom of the terminal showing the model and the working directory, and I had read it as fixed furniture, the way you read a window title bar. It is not. It is a command you point at a script, and whatever that script prints is what you see. That was new to me, and it reframes the bar as space you own rather than space the tool occupies.

Which raises the question of what is worth putting there. Claude Code tells you which model you are on. It does not tell you how much of your usage allowance you have already spent, and you generally find out you are close to the ceiling by hitting it.

Stefano Ginella ([GitHub](https://github.com/stefanoginella), [Codeable](https://www.codeable.io/developers/stefano-ginella/?ref=MzT91)) published [a single-file status line](https://gist.github.com/stefanoginella/ffe56f293baf6241abe74c3883082755) that puts the answer on screen permanently:

![The Claude Code status line rendering the model, effort level, context use, the five hour and seven day rate limit windows, and a daily budget figure](./images/claude-code-status-line.webp)

Left to right on the first line: the model and its effort level, how full the context window is, the share of the five hour rate limit spent and how long until it resets, the same for the seven day limit, and a daily pace figure. The second line carries the session id, the project path, and the git branch.

## The numbers arrive for free

The part worth understanding first is that none of this costs an API call.

Claude Code pipes a JSON payload to your status line command on every render, and that payload already contains the rate limits. The script reads `rate_limits.five_hour.used_percentage` and `resets_at`, then the same pair for `seven_day`. There is no request to make, no token to store, and nothing that can rate limit you further for asking.

Everything except the git branch comes from that payload.

## The cache covers a real gap, and expires itself

Rate limits are absent from the payload until the session's first API response lands. Without help, a status line would show nothing at all for the first exchange of every session, which is exactly when you are deciding how hard to push.

The script caches the last values it saw and reuses them to bridge that gap. This works because rate limits are account-wide rather than per-session, so a value borrowed from your last session is still true.

The care is in the expiry. A cached window whose reset time has already passed has rolled over, so its old percentage is no longer true and there is nothing to replace it with. Rather than show a stale number, the script drops it. That is the right failure direction: a missing gauge tells you it does not know, and a confidently wrong one does not.

## The daily figure is the one to actually read

`D:10/24%` is where the script stops reporting and starts advising, and it answers a question the raw gauges cannot.

The seven day gauge only climbs. It tells you the total, not whether today's rate will carry you to the reset. Twenty percent spent means something very different on day one than on day six.

So the script derives a daily budget:

1. At each local midnight it snapshots the seven day gauge into a small state file.
2. Today's usage is the rise since that snapshot.
3. Today's budget is whatever was left at the snapshot, divided by the days remaining before the weekly reset.

The consequence is the useful part. Overspending today shrinks every later day's budget rather than being quietly forgiven, so the number stays honest about what a heavy session actually cost you.

Two details in that arithmetic are worth calling out, because both are the kind of thing that is easy to get wrong and hard to notice afterwards.

The reset day is counted as a fraction rather than a whole day. A day's usable capacity is treated as running from a start hour (nine in the morning by default, overridable with `CLAUDE_DAY_START_HOUR`) to midnight, and the reset day only counts for the share of that window which survives the reset. A reset at eight in the morning adds nothing. Rounding it up to a full day would dilute every earlier day's budget to fund hours that do not exist.

Whole days are rounded rather than floored, because daylight saving time makes some local days twenty three or twenty five hours long. Flooring would silently lose a day twice a year.

## Reading a level the payload will not give you

There is a neat piece of work behind the effort label.

The payload reports ultracode as `xhigh`, because ultracode is xhigh plus dynamic workflow orchestration and the two share a level. So the status line cannot read it from stdin at all.

Instead the script tails the session transcript, looking for the last line where `/effort` echoed its own result. Three things keep that cheap and safe:

- It reads only the bytes appended since the previous render, tracking the offset in a state file, so it is not re-reading a growing transcript on every keystroke.
- It reads whole JSONL lines only, leaving a trailing partial line for the next call, so the stored offset never lands mid-record.
- It matches only `user` entries. Assistant prose that happens to quote the string, which is exactly what happens when you ask Claude about the status line itself, cannot spoof the reading.

That last point is a small thing that would have produced a genuinely confusing bug.

## Installing it

Save the file as `~/.claude/statusline/statusline.mjs`, then point your settings at it:

```json
"statusLine": {
  "type": "command",
  "command": "node /Users/you/.claude/statusline/statusline.mjs"
}
```

That goes in `~/.claude/settings.json` to apply everywhere, or in a project's `.claude/settings.json` to try it on one repo first. Use your own absolute path.

If you run Claude Code inside VS Code, the status bar renders in terminal mode only. It does not appear in the sidebar chat.

## What it leaves on disk

Three small state files under `~/.claude/statusline/`, all of them recoverable by deletion:

- `.usage-cache.json`, the last seen rate limit values
- `.daily-state.json`, the midnight snapshot the daily figure is measured against
- `.effort-state.json`, the transcript offset and last known effort level

Deleting any of them costs you one render of accuracy and nothing else.

## Why it is worth the five minutes

The gauges are useful, but the daily pace figure is the reason to install it. A percentage on its own invites you to guess whether you are fine. A budget you are currently over or under does not.

Credit to Stefano Ginella for the script, and for writing it to run entirely offline. You can find his work on [GitHub](https://github.com/stefanoginella), and he takes on client work through [Codeable](https://www.codeable.io/developers/stefano-ginella/?ref=MzT91).

**Disclosure:** the Codeable links here are referral links. GBTI Network is a longstanding fan of the Codeable community for WordPress and React work.
