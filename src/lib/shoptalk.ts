// sow-191: read house/shoptalk.yml at build time and hand it to the pure core.
//
// This file is the only part of the Shop Talk path that touches the filesystem. Everything that can be got
// wrong (RFC 5545 escaping, folding, DST, the fail-closed join URL) lives in shoptalk-core.mjs, which is
// node-testable; this is the thin adapter around it, matching the split used by workbench-client.ts and
// workbench-client-core.mjs.
//
// Same "static site is the published read-view" shape as quotes.json.ts and news-sources.json.ts: the YAML is
// the source of truth in the repo, a fork carries its own, and the build bakes it into a CDN-cached artifact.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  normalizeShoptalk,
  displayWhen,
  displayTimeShort,
  buildShoptalkIcs,
} from './shoptalk-core.mjs';

export type Shoptalk = ReturnType<typeof normalizeShoptalk>;

let cached: Shoptalk | null = null;

/** Load and validate the event. Cached because both the homepage and the .ics endpoint ask for it in one build
 *  and re-reading is pointless; a build is a single process with an immutable working tree. */
export function loadShoptalk(): Shoptalk {
  if (cached) return cached;
  const file = path.resolve(process.cwd(), 'house', 'shoptalk.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { shoptalk?: unknown } | null;
  // normalizeShoptalk throws with a field-specific message, so a bad edit fails the build rather than shipping
  // an event that imports at the wrong time. That failure mode is silent for the member: they do not report a
  // bug, they just arrive late.
  cached = normalizeShoptalk(parsed?.shoptalk) as Shoptalk;
  return cached;
}

/** The card's "when" line, for example "Saturdays, 11:00 AM Central Time". Derived from the IANA zone, never a
 *  hardcoded abbreviation: America/Chicago is CDT for roughly eight months of the year. */
export function shoptalkWhen(): string {
  return displayWhen(loadShoptalk());
}

/** The short chip under the event tile, for example "Sat, 11:00 AM CT". */
export function shoptalkTimeShort(): string {
  return displayTimeShort(loadShoptalk());
}

/**
 * The full .ics document.
 *
 * The UID is a STABLE constant, not a per-build value. A UID that changed on every deploy would make each
 * build look like a brand new event to a client that already holds the old one, and the member would collect
 * a fresh copy of the same weekly call every time the site deployed.
 *
 * DTSTAMP is derived from the event configuration rather than from the clock for the same reason it is
 * injected in the core: a wall-clock DTSTAMP changes the bytes on every build, which churns the deploy diff
 * for no behavioural gain.
 */
export function shoptalkIcs(): string {
  const event = loadShoptalk();
  return buildShoptalkIcs(event, {
    uid: 'shoptalk-weekly@gbti.network',
    stamp: `${event.startsOnCompact}T000000Z`,
  });
}
