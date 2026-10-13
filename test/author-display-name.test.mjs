// A surface that HAS a member's profile must print their name, not their folder (sow-454).
//
// WHY THIS EXISTS. src/lib/authors.ts states the intended rule in its own header: a caller holding a profile
// prefers its displayName, and only a caller without one falls through to the handle. ContentMeta and
// AuthorBox followed it; eight other surfaces loaded the profile collection for the avatars and then printed
// the bare folder anyway. A member who claimed an invited listing read as "gsusi" on his own project while
// the byline directly above it read his name, and the project directory disagreed with its own popover.
//
// The regression mode is a NEW card, so this is shaped around the rule and not around today's file list: any
// component that reads the profile collection has to use what it read. A surface with no profile in hand is
// outside the rule by design and is not flagged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function astroFiles(dir, out = []) {
  for (const e of readdirSync(path.join(ROOT, dir))) {
    const rel = `${dir}/${e}`;
    if (statSync(path.join(ROOT, rel)).isDirectory()) astroFiles(rel, out);
    else if (e.endsWith('.astro')) out.push(rel);
  }
  return out;
}

// Reading the profile collection in any of these shapes means the name is already in hand.
const HAS_PROFILES = /getCollection\('profile'\)|buildAvatarIndex|profileByUser|profileName|profiles\.find\(/;
// Preferring it, in any of the shapes the codebase actually uses.
const PREFERS = /displayName \?\? authorDisplay|\?\.name \?\? authorDisplay|nameOf\(|authorName|prof\?\.displayName/;

test('every surface holding a profile prints the display name, not the folder', () => {
  const offenders = [];
  for (const rel of [...astroFiles('src/components'), ...astroFiles('src/pages')]) {
    const src = readFileSync(path.join(ROOT, rel), 'utf8');
    if (!src.includes('authorDisplay(')) continue;
    if (!HAS_PROFILES.test(src)) continue; // no profile in hand: the documented fallback is correct
    const bare = (src.match(/authorDisplay\(/g) || []).length;
    const prefers = (src.match(PREFERS) || []).length;
    if (bare > 0 && prefers === 0) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], 'these read the profile collection and still print the folder');
});

test('authors.ts still states the rule these surfaces follow', () => {
  // If this header is ever rewritten, the test above loses the thing it enforces, so it is pinned here.
  const src = readFileSync(path.join(ROOT, 'src/lib/authors.ts'), 'utf8');
  assert.match(src, /Callers that have a profile prefer its displayName/);
  // And the fallback itself stays the handle, which is what makes a profile-less caller correct.
  assert.match(src, /return NETWORK_AUTHORS\.has\(username\) \? 'GBTI Network' : username;/);
});
