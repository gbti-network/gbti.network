// sow-161 increment A: rankForPath is the per-path role rank the multi-file admin-write gate uses. It exists
// because a multi-file op cannot declare one rank (category-batch touches an admin file AND a superadmin file),
// and because classify-pr.isTierS is the WRONG source (it calls content-channels.yml Tier A, disagreeing with
// the CODEOWNERS superadmin pin). These tests pin the CODEOWNERS tier map AND assert it agrees with every
// existing CONFIG_OP row, so rankForPath and the hand-set per-op ranks cannot silently drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { rankForPath, maxRankForPaths, ROLE_RANK } from '../membership/path-rank.mjs';

const SUPERADMIN = ROLE_RANK.superadmin;
const ADMIN = ROLE_RANK.admin;
const MEMBER = ROLE_RANK.member;

test('rankForPath: the CODEOWNERS-pinned house files are superadmin', () => {
  for (const p of ['house/roles.yml', 'house/content-channels.yml', 'house/moderation-flags.yml', 'house/site-settings.yml']) {
    assert.equal(rankForPath(p), SUPERADMIN, p);
  }
  assert.equal(rankForPath('house/applets/hue/index.md'), SUPERADMIN);
  assert.equal(rankForPath('CODEOWNERS'), SUPERADMIN);
  assert.equal(rankForPath('.github/workflows/deploy.yml'), SUPERADMIN);
});

test('rankForPath: anything outside members/ and house/ fails closed to superadmin (infra)', () => {
  for (const p of ['astro.config.mjs', 'package.json', 'src/pages/index.astro', 'scripts/reconcile.mjs', 'membership/points.mjs', 'workers/signup/index.mjs']) {
    assert.equal(rankForPath(p), SUPERADMIN, p);
  }
});

test('rankForPath: the rest of house/** is admin', () => {
  for (const p of ['house/taxonomy.yml', 'house/quotes.yml', 'house/news-sources.yml', 'house/coupons.yml', 'house/bans.yml', 'house/grandfathered.yml', 'house/syndication-config.yml', 'house/posts/x/index.md']) {
    assert.equal(rankForPath(p), ADMIN, p);
  }
});

test('rankForPath: member content is member-tier (a curation op base rank covers editing it)', () => {
  assert.equal(rankForPath('members/atwellpub/posts/foo/index.md'), MEMBER);
  assert.equal(rankForPath('members/dikafei/products/bar/index.md'), MEMBER);
});

test('rankForPath: an unclean path fails closed to superadmin (no ../ escape into the admin bucket)', () => {
  for (const p of ['members/octocat/../../house/roles.yml', '/etc/passwd', 'house\\roles.yml', 'a/./b', '', null, undefined]) {
    assert.equal(rankForPath(p), SUPERADMIN, JSON.stringify(p));
  }
});

test('maxRankForPaths: takes the greatest rank in the set, floored at the op base', () => {
  // A taxonomy-only batch (admin base) stays admin.
  assert.equal(maxRankForPaths(['house/taxonomy.yml'], ADMIN), ADMIN);
  // Add a superadmin-pinned file and it RISES to superadmin.
  assert.equal(maxRankForPaths(['house/taxonomy.yml', 'house/content-channels.yml'], ADMIN), SUPERADMIN);
  // The base is a floor: an all-member file set under an admin base stays admin, not member.
  assert.equal(maxRankForPaths(['members/a/posts/x/index.md', 'members/b/posts/y/index.md'], ADMIN), ADMIN);
  // Empty set returns the base.
  assert.equal(maxRankForPaths([], ADMIN), ADMIN);
});

// THE DRIFT GUARD. Every single-file CONFIG_OP row in the Worker declares a rank by hand. rankForPath must agree
// with all of them, or the multi-file gate and the single-file gate disagree about who may write the same file.
// Parsed from source (not imported) because membership-admin-author.mjs is a Worker module; the regex mirrors
// the row shape `'<action>': { path: '<path>', rank: ROLE_RANK.<role>, ...`.
test('DRIFT: rankForPath agrees with every CONFIG_OP row rank in the Worker', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../workers/signup/membership-admin-author.mjs', import.meta.url)), 'utf8');
  const start = src.indexOf('const CONFIG_OP = {');
  assert.ok(start > -1, 'could not find the CONFIG_OP table in the Worker (did it move or rename?)');
  const block = src.slice(start, src.indexOf('\n};', start));
  const rows = [...block.matchAll(/path:\s*'([^']+)',\s*rank:\s*ROLE_RANK\.(\w+)/g)];
  assert.ok(rows.length >= 4, `expected several CONFIG_OP rows, parsed ${rows.length} (the regex may have gone stale)`);
  for (const [, path, roleName] of rows) {
    const declared = ROLE_RANK[roleName];
    assert.ok(declared !== undefined, `CONFIG_OP row uses ROLE_RANK.${roleName}, which is not a known rank`);
    assert.equal(rankForPath(path), declared, `rankForPath('${path}') must equal the CONFIG_OP-declared ROLE_RANK.${roleName}`);
  }
});
