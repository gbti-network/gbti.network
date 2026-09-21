// sow-351: a Tailwind variant cannot override the unlayered utility shim, so an element carrying both is
// silently stuck in one state.
//
// The member profile header asked for a desktop layout on seven elements and received it on none of them,
// from the day it was written until 2026-09-20. Nothing looked wrong in the stylesheet, in the markup or in
// review: both rules are present and correct, and only the computed value on a real page disagrees. A guard
// is the only thing that catches that shape, which is why this exists rather than a note in a document.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  shimmedNames, classLists, collisionsIn, baseName, checkTree, GROUPS,
} from '../scripts/check-utility-shim-collisions.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const CSS = path.join(ROOT, 'src/styles/gbti-v3.css');

const SHIM = '.grid { display: grid; }\n.flex { display: flex; }\n'
  + '.items-center{align-items:center}.items-start{align-items:flex-start}\n'
  + '.justify-between{justify-content:space-between}.justify-center{justify-content:center}\n'
  + '.relative{position:relative}\n';

test('the shimmed names are read from the stylesheet, not copied into the guard', () => {
  const names = shimmedNames(SHIM);
  assert.deepEqual([...names].sort(), ['flex', 'grid', 'items-center', 'items-start', 'justify-between', 'justify-center', 'relative']);
  // Remove an entry and the guard stops protecting that property, with no edit here. That is the point: the
  // day somebody deletes the shim, this narrows itself instead of reporting a bug that no longer exists.
  assert.ok(!shimmedNames(SHIM.replace('.justify-center{justify-content:center}', '')).has('justify-center'));
});

test('it does not mistake a longer name for a shimmed one', () => {
  // `.flex-col` sets flex-direction and is NOT the shimmed `.flex`. Reading it as one would flag every
  // column in the codebase.
  const names = shimmedNames('.flex-col{flex-direction:column}\n.justify-items-center{justify-items:center}\n');
  assert.equal(names.size, 0);
  // And a compound selector is not a bare utility either.
  assert.equal(shimmedNames('.card .flex { display: flex; }').size, 0);
});

test('the collision is a bare shimmed token plus a variant of the SAME property', () => {
  const shim = shimmedNames(SHIM);
  const hits = collisionsIn('flex flex-wrap justify-center gap-3 sm:justify-start', shim);
  assert.equal(hits.length, 1);
  assert.deepEqual(hits[0], { shimmed: 'justify-center', beaten: 'sm:justify-start', property: 'justify-content' });
});

test('different properties are not a collision, which is most of the codebase', () => {
  const shim = shimmedNames(SHIM);
  // display beside flex-direction: both apply, and flagging this would bury the real finding.
  assert.deepEqual(collisionsIn('flex flex-col gap-8 sm:flex-row', shim), []);
  // A shimmed token with no override at all is fine: it is wanted at every width.
  assert.deepEqual(collisionsIn('flex flex-wrap items-center gap-3', shim), []);
  // The fixed form: two variants, neither of them bare, so nothing is beaten.
  assert.deepEqual(collisionsIn('flex flex-wrap max-sm:justify-center gap-3 sm:justify-start', shim), []);
});

test('a variant prefix is stripped from the end, not the start', () => {
  assert.equal(baseName('sm:justify-start'), 'justify-start');
  assert.equal(baseName('max-sm:items-center'), 'items-center');
  assert.equal(baseName('dark:hover:md:flex'), 'flex');
  assert.equal(baseName('!items-center'), 'items-center');
  assert.equal(baseName('flex'), 'flex');
});

test('a class list built at runtime is skipped rather than guessed at', () => {
  const shim = shimmedNames(SHIM);
  // The override is written as a CLEAN token here on purpose. The first version quoted it, so it never parsed
  // as a utility whether the list was skipped or not, and a mutation run showed the test could not fail.
  const dynamic = 'flex justify-center {extra} sm:justify-start';
  assert.deepEqual(collisionsIn(dynamic, shim), [],
    'a list carrying an expression is not static text; reading it as one invents findings');
  // Control: the same list without the expression IS a collision, so the skip is what made the difference.
  assert.equal(collisionsIn('flex justify-center sm:justify-start', shim).length, 1);
});

test('the real tree is clean, and the guard actually looked at it', () => {
  const { errors, scanned, shimmed } = checkTree({ root: ROOT, cssFile: CSS, srcDir: path.join(ROOT, 'src') });
  assert.deepEqual(errors, []);
  // A zero from a working scan and a zero from a broken one look identical, so assert it read something.
  assert.ok(scanned > 1000, `expected the scan to read the whole tree, it read ${scanned} class lists`);
  assert.ok(shimmed.size >= 6, `expected the shim to still be present, found ${shimmed.size} names`);
});

test('an empty subject is a failure, not a pass', () => {
  const empty = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'shim-guard-'));
  try {
    const { errors } = checkTree({ root: ROOT, cssFile: CSS, srcDir: empty });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /proved nothing/);
  } finally { fs.rmSync(empty, { recursive: true, force: true }); }
});

test('every group is a real CSS property with more than one value', () => {
  for (const [prop, names] of Object.entries(GROUPS)) {
    assert.ok(names.length > 1, `${prop} needs more than one value or nothing can collide`);
    assert.ok(new Set(names).size === names.length, `${prop} lists a name twice`);
  }
});

test('it is wired into the build, unlike the local-only number check', () => {
  // This one CAN run in CI: its subject is src/, which exists in a fresh checkout.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.match(pkg.scripts['verify:dist'], /check-utility-shim-collisions/,
    'the guard must run in the build, or the eighth collision ships the same silent way the first seven did');
});

test('the seven elements it was built for are fixed and stay fixed', () => {
  const files = ['src/components/members/ProfileHeader.astro', 'src/pages/members/[username].astro'];
  for (const rel of files) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const { value } of classLists(src)) {
      const tokens = value.split(/\s+/);
      const bare = new Set(tokens.filter((t) => !t.includes(':')));
      for (const t of tokens.filter((x) => x.startsWith('sm:'))) {
        const b = baseName(t);
        const group = Object.keys(GROUPS).find((g) => GROUPS[g].includes(b));
        if (!group) continue;
        for (const other of bare) {
          assert.ok(!GROUPS[group].includes(other),
            `${rel}: "${t}" sits beside bare "${other}" again, which is the bug sow-351 fixed`);
        }
      }
    }
  }
});
