// sow-189: the pure content-flags core over house/content-flags.yml (stale and unindexed, superadmin-owned).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';

import { contentFlagsFromParsed, flagsFor, flagKeyForPath, sitemapExcludes, setContentFlag, ContentFlagEditError, KEY_RE } from '../membership/content-flags.mjs';
import { visibleActions } from '../client-ui/src/mod-actions-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const CTX = { actor: { githubId: '1', login: 'hudson' }, now: '2026-09-08T22:00:00Z' };

test('the committed registry parses, is empty, and its header names both flags', () => {
  const txt = readFileSync(ROOT + 'house/content-flags.yml', 'utf8');
  const parsed = yaml.load(txt);
  assert.deepEqual(contentFlagsFromParsed(parsed), {}, 'ships empty: nothing live is flagged by this build');
  assert.match(txt, /stale:/); assert.match(txt, /unindexed:/); assert.match(txt, /house\/\*\* is where a member cannot/);
});

test('parse: junk keys, junk values and flagless entries are dropped; the two flags and the note survive', () => {
  const out = contentFlagsFromParsed({ flags: {
    'post:good-one': { stale: true, at: '2026-09-08', by: 'hudson', reason: 'superseded' },
    'post:both': { stale: true, unindexed: true },
    'post:nothing-set': { stale: false, reason: 'x' },
    'Post:Bad Key': { stale: true },
    'post:string-value': 'stale',
    'video:x': { stale: true },
  } });
  assert.deepEqual(Object.keys(out).sort(), ['post:both', 'post:good-one']);
  assert.deepEqual(out['post:good-one'], { stale: true, at: '2026-09-08', by: 'hudson', reason: 'superseded' });
  assert.deepEqual(flagsFor(out, 'post', 'both'), { stale: true, unindexed: true });
  assert.deepEqual(flagsFor(out, 'post', 'absent'), { stale: false, unindexed: false });
  assert.deepEqual(contentFlagsFromParsed(null), {});
  assert.deepEqual(contentFlagsFromParsed({ flags: [] }), {});
});

test('the key comes from a member or house content path, and from nothing else', () => {
  assert.equal(flagKeyForPath('members/bob/posts/my-post/index.md'), 'post:my-post');
  assert.equal(flagKeyForPath('members/bob/projects/tool/index.md'), 'project:tool');
  assert.equal(flagKeyForPath('house/prompts/hello/index.md'), 'prompt:hello');
  assert.equal(flagKeyForPath('members/bob/shares/123.md'), null);
  assert.equal(flagKeyForPath('house/roles.yml'), null);
  assert.equal(flagKeyForPath('members/../house/posts/x/index.md'), null);
  assert.ok(KEY_RE.test('post:a-b-2'));
  assert.ok(!KEY_RE.test('post:-bad'));
});

test('set: idempotent, records who/when/why, clears cleanly, removes an entry with no flag left', () => {
  const r1 = setContentFlag({ flags: {} }, { key: 'post:x', flag: 'stale', on: true, reason: 'out of date' }, CTX);
  assert.equal(r1.changed, true);
  assert.deepEqual(r1.next.flags['post:x'], { stale: true, at: '2026-09-08T22:00:00.000Z', by: 'hudson', reason: 'out of date' });
  assert.equal(r1.audit.action, 'content.stale'); assert.equal(r1.audit.actor.login, 'hudson'); assert.deepEqual(r1.audit.target, { key: 'post:x' });
  const r2 = setContentFlag(r1.next, { key: 'post:x', flag: 'stale', on: true }, CTX);
  assert.equal(r2.changed, false, 'already stale');
  const r3 = setContentFlag(r1.next, { key: 'post:x', flag: 'unindexed', on: true }, CTX);
  assert.deepEqual(flagsFor(r3.next.flags, 'post', 'x'), { stale: true, unindexed: true }, 'the two flags are independent');
  const r4 = setContentFlag(r3.next, { key: 'post:x', flag: 'stale', on: false }, CTX);
  assert.equal(r4.changed, true); assert.deepEqual(flagsFor(r4.next.flags, 'post', 'x'), { stale: false, unindexed: true });
  assert.equal(r4.audit.action, 'content.unstale');
  const r5 = setContentFlag(r4.next, { key: 'post:x', flag: 'unindexed', on: false }, CTX);
  assert.ok(!('post:x' in r5.next.flags), 'nothing left to say about it: the entry goes');
  assert.equal(setContentFlag(r5.next, { key: 'post:x', flag: 'stale', on: false }, CTX).changed, false, 'clearing a clear flag is a no-op');
});

test('set: a bad key or an unknown flag is refused before anything is computed', () => {
  assert.throws(() => setContentFlag({}, { key: 'post:Bad', flag: 'stale' }, CTX), ContentFlagEditError);
  assert.throws(() => setContentFlag({}, { key: 'post:x', flag: 'hidden' }, CTX), ContentFlagEditError);
  assert.throws(() => setContentFlag({}, { key: 'post:x', flag: 'stale' }, { now: 'not a date' }), ContentFlagEditError);
});

test('the sitemap drops exactly the unindexed articles; stale alone stays advertised (owner: the flags are independent)', () => {
  const flags = contentFlagsFromParsed({ flags: { 'post:a': { unindexed: true }, 'post:b': { stale: true }, 'post:c': { stale: true, unindexed: true }, 'prompt:p': { unindexed: true } } });
  assert.deepEqual([...sitemapExcludes(flags)].sort(), ['/articles/a/', '/articles/c/'], 'articles only in v1; the prompt key is carried but not yet mapped');
  assert.deepEqual([...sitemapExcludes({})], []);
});

test('the control: the four flag actions show for a superadmin only', () => {
  assert.deepEqual(visibleActions('superadmin'), ['hide', 'unhide', 'remove', 'stale', 'unstale', 'unindex', 'reindex']);
  assert.deepEqual(visibleActions('admin'), ['hide', 'unhide', 'remove']);
  assert.deepEqual(visibleActions('moderator'), ['hide', 'unhide']);
  assert.deepEqual(visibleActions('member'), []);
});
