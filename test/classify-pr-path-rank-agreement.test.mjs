// sow-298: the PR gate and CODEOWNERS must not share one blind spot.
//
// WHY THIS FILE EXISTS. workers/signup/membership-admin-author.mjs documents a TWO-AUTHORITY model and states
// the safety property in its own words: the Worker applies the change with GBTI's installation token, and the
// SOW-005 gate re-checks the caller's git-native role against the touched path, "so even a bug here cannot
// merge beyond the caller's real role". That held only if the two authorities disagree independently.
//
// They did not. classify-pr's isTierS called EVERY house/** path except roles.yml Tier A, while CODEOWNERS
// pinned content-channels.yml, moderation-flags.yml, site-settings.yml and house/applets/ to the two
// superadmins. For exactly the files the gate existed to protect, the second authority reached the same wrong
// conclusion from the same module, and two checks that consult one source are one check.
//
// isTierS now delegates to rankForPath, so there is ONE source of path tier. These tests hold that delegation
// honest and, more importantly, hold rankForPath in lockstep with the real CODEOWNERS file, which is what
// converts "somebody must remember to add the row" into "the suite reds if they forget".

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { isTierS, isTierA } from '../membership/classify-pr.mjs';
import { rankForPath, ROLE_RANK, SUPERADMIN_HOUSE_FILES } from '../membership/path-rank.mjs';
import { ROLE } from '../membership/overrides-core.mjs';

const SUPERADMIN = ROLE_RANK[ROLE.superadmin];

// A corpus spanning every branch of both functions, including the shapes that fail closed.
const CORPUS = [
  // CODEOWNERS-pinned house files: the whole point of the fix.
  'house/roles.yml',
  'house/content-channels.yml',
  'house/moderation-flags.yml',
  'house/site-settings.yml',
  'house/syndication-config.yml',
  'house/applets/hue/index.md',
  // Ordinary admin-tier house config and content.
  'house/taxonomy.yml',
  'house/quotes.yml',
  'house/news-sources.yml',
  'house/bans.yml',
  'house/grandfathered.yml',
  'house/members-index.yml',
  'house/posts/x/index.md',
  'house',
  // Member content.
  'members/alice/posts/x/index.md',
  'members/alice/profile.md',
  'members/bob/comments/c.md',
  // Infrastructure, which fails closed to superadmin.
  'CODEOWNERS',
  '.github/workflows/tests.yml',
  'src/pages/index.astro',
  'scripts/reconcile.mjs',
  'membership/classify-pr.mjs',
  'workers/signup/index.mjs',
  'package.json',
  // Non-canonical shapes. Both sides must fail closed rather than let a traversal land in the admin bucket.
  '../house/roles.yml',
  'members/alice/../../house/roles.yml',
  './house/taxonomy.yml',
  '/house/roles.yml',
  'house\\roles.yml',
  'house/roles.yml\0',
  '',
];

test('isTierS is exactly "rankForPath says superadmin", across every path shape', () => {
  for (const p of CORPUS) {
    assert.equal(
      isTierS(p),
      rankForPath(p) === SUPERADMIN,
      `isTierS and rankForPath disagree on ${JSON.stringify(p)}: ` +
        `isTierS=${isTierS(p)} rank=${rankForPath(p)}`,
    );
  }
});

test('the CODEOWNERS-pinned house files are Tier S, which is the behaviour that was wrong before', () => {
  // Stated as literals rather than derived, so this test still fails if the derivation below breaks.
  for (const p of [
    'house/roles.yml',
    'house/content-channels.yml',
    'house/moderation-flags.yml',
    'house/site-settings.yml',
    'house/syndication-config.yml',
    'house/applets/hue/index.md',
  ]) {
    assert.equal(isTierS(p), true, `${p} must be Tier S: CODEOWNERS pins it to the two superadmins`);
    assert.equal(rankForPath(p), SUPERADMIN, `${p} must rank superadmin`);
  }
});

test('the rest of house/** stays Tier A, so the fix did not sweep ordinary config into superadmin', () => {
  // The negative half. Without it, an isTierS that simply returned true would pass the test above.
  for (const p of ['house/taxonomy.yml', 'house/quotes.yml', 'house/news-sources.yml', 'house/bans.yml']) {
    assert.equal(isTierS(p), false, `${p} must NOT be Tier S`);
    assert.equal(isTierA(p), true, `${p} must stay Tier A`);
    assert.equal(rankForPath(p), ROLE_RANK[ROLE.admin], `${p} must rank admin`);
  }
});

test('Tier S and Tier A are disjoint by construction, not by the order decide() tests them', () => {
  // classifyPaths exports both lists to callers that do not know decide() checks tierS first at line 261.
  const both = CORPUS.filter((p) => isTierS(p) && isTierA(p));
  assert.deepEqual(both, [], `paths classified as BOTH Tier S and Tier A: ${JSON.stringify(both)}`);
});

test('LOCKSTEP: every house path CODEOWNERS pins to the superadmins ranks superadmin', () => {
  // The guard that removes the recall dependency. Before this, adding a pin to CODEOWNERS without adding the
  // matching row left the endpoint rank as the only real control, silently, and nothing anywhere failed.
  const file = path.resolve(process.cwd(), 'CODEOWNERS');
  const pinned = [];
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = line.match(/^(\/house\/\S+)\s+(.*)$/);
    if (!m) continue;
    const owners = m[2].trim();
    // The blanket /house/ rule is admin-tier and is deliberately not in the pinned set.
    if (m[1] === '/house/') continue;
    if (owners !== '@atwellpub @gbtilabs') continue;
    pinned.push(m[1].replace(/^\//, ''));
  }

  // A parse that matched nothing would make every assertion below vacuous and the test would still pass.
  assert.ok(
    pinned.length >= 5,
    `parsed only ${pinned.length} pinned house paths from CODEOWNERS, so this guard is not actually reading it`,
  );

  for (const entry of pinned) {
    // A directory pin (house/applets/) governs the files inside it, so probe one.
    const probe = entry.endsWith('/') ? `${entry}probe/index.md` : entry;
    assert.equal(
      rankForPath(probe),
      SUPERADMIN,
      `CODEOWNERS pins ${entry} to the two superadmins but rankForPath ranks ${probe} at ` +
        `${rankForPath(probe)}. Add it to SUPERADMIN_HOUSE_FILES in membership/path-rank.mjs.`,
    );
    assert.equal(isTierS(probe), true, `${probe} is CODEOWNERS-pinned but the PR gate does not treat it as Tier S`);
  }

  // THE OTHER DIRECTION, which is the state house/syndication-config.yml was actually in until 2026-09-01:
  // ranked superadmin by the code while CODEOWNERS said nothing, so the endpoint rank was the only control
  // and the gate would not have caught an admin-ranked mistake. That direction is fail-SAFE rather than
  // fail-open, which is precisely why it survived unnoticed: nothing breaks, the protection is just absent.
  for (const entry of SUPERADMIN_HOUSE_FILES) {
    assert.ok(
      pinned.includes(entry),
      `membership/path-rank.mjs ranks ${entry} superadmin but CODEOWNERS does not pin it to ` +
        `@atwellpub @gbtilabs, so the PR gate is the only authority for it. Add the pin to CODEOWNERS.`,
    );
  }
});
