// sow-316 / sow-226 Q4: "Curator" means exactly one thing, the paid publishing tier.
//
// A dormant news-publishing PERMISSION used the same word (curatorsFromParsed, isCurator, authorizeCurator,
// canCurateNews, a `curators:` key in roles.yml). Nobody held it, but the next reader of authorizeCurator would
// have assumed it meant the tier. Renamed to "news editor" by owner decision on 2026-09-08. This guards the
// rename staying complete, and the one thing deliberately NOT renamed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
function walk(dir, out = []) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (n === 'node_modules' || n === 'dist' || n === '.git' || n === '.data') continue;
    if (statSync(p).isDirectory()) walk(p, out); else if (/\.(mjs|ts|astro|yml)$/.test(n)) out.push(p);
  }
  return out;
}
// `extension/src` is listed because the FIRST version of this guard omitted it, and so did the rename it guards,
// so the guard passed while the extension bundle failed to build on two missing exports. A completeness guard
// written by the same hand as the change inherits the change's blind spots; the build is the second opinion.
const SRC_DIRS = ['membership', 'workers', 'client/src', 'client-ui/src', 'extension/src', 'scripts', 'src', 'house'].map((d) => join(ROOT, d));
const files = SRC_DIRS.flatMap((d) => { try { return walk(d); } catch { return []; } });

test('no source file still carries the old permission identifiers', () => {
  const OLD = /\b(curatorsFromParsed|curatorsFromText|isCurator|authorizeCurator|canCurateNews)\b/;
  const hits = files.filter((f) => OLD.test(readFileSync(f, 'utf8'))).map((f) => f.replace(ROOT, ''));
  assert.deepEqual(hits, [], 'old permission names survive in: ' + hits.join(', '));
});

test('roles.yml carries newsEditors and not curators', () => {
  const y = readFileSync(join(ROOT, 'house/roles.yml'), 'utf8');
  assert.match(y, /^newsEditors:/m);
  assert.doesNotMatch(y, /^curators:/m, 'the old key would be read by nothing and silently grant nobody');
});

test('the reader and the key agree, on both the server core and the client', () => {
  // A renamed key that the reader still looks up under the old name is the "reads true, means nothing" shape.
  assert.match(readFileSync(join(ROOT, 'membership/overrides-core.mjs'), 'utf8'), /parsed\?\.newsEditors \?\? \[\]/);
  assert.match(readFileSync(join(ROOT, 'client/src/roles.mjs'), 'utf8'), /parsed\?\.newsEditors \?\? \[\]/);
});

test('the wire field canCurate is KEPT, because shipped extension builds read it', () => {
  // Renaming it would break the news "Add to Discord" affordance in every already-installed extension. The
  // permission is dormant so nothing would visibly break, which is exactly why it would go unnoticed.
  assert.match(readFileSync(join(ROOT, 'workers/signup/membership-status.mjs'), 'utf8'), /canCurate/);
  assert.match(readFileSync(join(ROOT, 'client-ui/src/elements/gbti-news-reader.mjs'), 'utf8'), /status\?\.canCurate/);
});

test('the public tier label is Curator, read from the one place it lives', () => {
  const y = readFileSync(join(ROOT, 'house/membership-tiers.yml'), 'utf8');
  assert.match(y, /- key: creator\n\s+label: Curator\n/, 'the rename is this one line; everything else binds to it');
});

test('positive control: the walker actually reads the files it claims to guard', () => {
  // A guard over zero files passes forever. Prove the corpus is real and contains a known token.
  assert.ok(files.length > 200, `only ${files.length} files walked`);
  const known = files.filter((f) => /\bauthorizeNewsEditor\b/.test(readFileSync(f, 'utf8')));
  assert.ok(known.length >= 2, 'the NEW name must be findable by the same walk, or the zero above is a blind walker');
});

// sow-316: the label lives in TWO places by design (house/membership-tiers.yml for the site, membership/tiers.mjs
// TIER_LABEL for node-free code), and the first pass of this rename updated one and not the other. Fourteen dist
// files still said "Content Creator" while the yml said Curator. They must agree, and nothing may spell the name.
import { load as loadYaml } from 'js-yaml';
import { TIER, TIER_LABEL, tierLabel } from '../membership/tiers.mjs';

test('the node-free label map agrees with the yml registry, for every paid tier', () => {
  const tiers = loadYaml(readFileSync(join(ROOT, 'house/membership-tiers.yml'), 'utf8'))?.tiers ?? [];
  const paid = tiers.filter((t) => t.key !== 'none');
  assert.ok(paid.length >= 2, 'the registry lists the paid tiers');
  for (const t of paid) assert.equal(tierLabel(t.key), t.label, `TIER_LABEL[${t.key}] drifted from the yml`);
  assert.equal(TIER_LABEL[TIER.creator], 'Curator');
});

// A line is COPY when the old name appears outside a comment. Comments may recount history; copy may not.
const spellsOldName = (line) => /Content Creator/.test(line.split('//')[0]) && !/^\s*(\*|\/\*)/.test(line) && !/<!--.*Content Creator/.test(line);

test('no source file spells "Content Creator" in copy; every surface binds to the label', () => {
  const hits = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((line, i) => { if (spellsOldName(line)) hits.push(`${f.replace(ROOT, '')}:${i + 1}`); });
  }
  assert.deepEqual(hits, [], 'the old name is still spelled in copy at: ' + hits.join(', '));
});

test('positive control: the copy predicate catches the shapes it is meant to', () => {
  assert.ok(spellsOldName("  label: 'Content Creator',"));
  assert.ok(spellsOldName('  <p>Apply to become a Content Creator</p>'));
  assert.ok(spellsOldName("  const need = required === TIER.creator ? 'Content Creator' : 'Network Member';"));
  assert.ok(!spellsOldName('  // sow-218 built the Content Creator gate'), 'a comment is history, not copy');
  assert.ok(!spellsOldName('   * sow-293: Content Creator unlocks the PUBLIC audience.'));
  assert.ok(!spellsOldName('  const x = 1; // was Content Creator'));
  assert.ok(!spellsOldName('/** True when a tier holds the badge (Content Creator only). */'), 'a one-line JSDoc is a comment');
});
