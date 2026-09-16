// sow-189 + sow-274: the four content flag actions (stale / unstale / unindex / reindex), driven through the
// real admin endpoint.
//
// These were the last admin actions the network did not serve, so until sow-274 they ran in the client and
// committed from the acting member's own copy of the repository. The invariants are the ones the client used to
// hold, re-asserted where they now live: superadmin only, ONE file written (the registry, never the member's
// own file), the key derived from the path rather than taken from the caller, and idempotency.
//
// Driving the endpoint rather than the pure core is deliberate. The core was already covered
// (test/content-flags.test.mjs); what sow-274 added was the WIRING, and a wiring bug is exactly what a
// core-only test cannot see.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { contentFlagInput, contentFlagOps } from '../workers/signup/membership-admin-flags.mjs';

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const PATH = 'members/bob/posts/old-news/index.md';
const ENV = { MEMBERSHIP_AUTHOR_ENABLED: 'true', GITHUB_APP_INSTALLATION_ID: '123', UPSTREAM_REPO: 'gbti-network/gbti.network' };

/** A GitHub stand-in that serves the registry and records every write. */
function makeFetch(registry, seen) {
  return async (url, opts = {}) => {
    const u = String(url).replace('https://api.github.com', '');
    const method = opts.method || 'GET';
    seen.push({ method, url: u, body: opts.body ? JSON.parse(opts.body) : null });
    if (method === 'GET' && u.includes('/contents/house/content-flags.yml')) return { ok: true, status: 200, json: async () => ({ content: b64(registry), sha: 'f1' }) };
    if (method === 'GET' && u.includes('/git/ref/heads/main')) return { ok: true, status: 200, json: async () => ({ object: { sha: 'mainsha' } }) };
    if (method === 'POST' && u.endsWith('/git/refs')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'GET' && u.includes('/contents/')) return { ok: true, status: 200, json: async () => ({ sha: 'old' }) };
    if (method === 'PUT' && u.includes('/contents/')) return { ok: true, status: 201, json: async () => ({}) };
    if (method === 'POST' && u.endsWith('/pulls')) return { ok: true, status: 201, json: async () => ({ number: 77, html_url: 'u' }) };
    return { ok: false, status: 500, json: async () => ({}) };
  };
}

async function run(role, payload, registry = 'flags: {}\n') {
  const seen = [];
  const res = await membershipAdminAuthor({ json: async () => payload }, ENV, {
    fetchImpl: makeFetch(registry, seen),
    authorize: async () => ({ ok: true, role, githubId: '999' }),
    kv: { get: async () => ({ token: 'inst-token', expiresAt: Date.now() + 3600e3 }), put: async () => {} },
    limiter: async () => ({ allowed: true }),
    allowCookie: false,
  });
  const writes = seen.filter((s) => s.method === 'PUT' || s.method === 'DELETE');
  return { res, seen, writes };
}

test('an admin is refused; only a superadmin may flag content', async () => {
  const { res, writes } = await run('admin', { action: 'stale', path: PATH });
  assert.equal(res.status, 403, JSON.stringify(res.body));
  assert.equal(writes.length, 0);
});

test('marking stale writes ONE file, the registry, with who, when and why', async () => {
  const { res, seen, writes } = await run('superadmin', { action: 'stale', path: PATH, reason: 'superseded by the 2026 guide' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(writes.length, 1);
  assert.match(writes[0].url, /\/contents\/house\/content-flags\.yml/);

  const doc = yaml.load(Buffer.from(writes[0].body.content, 'base64').toString('utf8'));
  const entry = doc.flags['post:old-news'];
  assert.equal(entry.stale, true);
  assert.equal(entry.by, '999'); // the acting superadmin, from the session, never from the payload
  assert.equal(entry.reason, 'superseded by the 2026 guide');
  assert.ok(entry.at, 'the entry records when');

  // The member's own file is never touched: the flag is a statement ABOUT their content, kept where they cannot
  // reach it. The pull request branch names the item, so a second flag on a different item does not clobber it.
  assert.ok(!writes.some((w) => w.url.includes('members/bob')), 'the member file was written to');
  const branch = seen.find((s) => s.method === 'POST' && s.url.endsWith('/git/refs'))?.body?.ref || '';
  assert.match(branch, /content-flag-post-old-news/);
});

test('the key comes from the path, and a path that is not content is refused', async () => {
  for (const path of ['members/bob/shares/12.md', 'house/roles.yml', '../etc/passwd', '']) {
    const { res, writes } = await run('superadmin', { action: 'unindex', path });
    assert.equal(res.status, 400, `${path || '(empty)'} should be refused, got ${res.status}`);
    // The refusal must come from the path check, named in the message. The endpoint answers 400 for anything
    // that throws, so a status on its own would read the same whether the guard refused it or something failed
    // further in, which is how a deleted guard goes unnoticed.
    assert.match(res.body?.message || '', path ? /not a flaggable content path/ : /a content item path is required/);
    assert.equal(writes.length, 0);
  }
  // A caller cannot name the key themselves: a made-up one is ignored and the path decides.
  const built = contentFlagInput({ path: PATH, key: 'post:something-else' });
  assert.equal(built.ok, true);
  assert.equal(built.args.key, 'post:old-news');
});

test('flagging twice changes nothing; clearing one flag keeps the other, and an empty entry goes', async () => {
  const already = 'flags:\n  "post:old-news":\n    stale: true\n    unindexed: true\n    at: "2026-09-01T00:00:00.000Z"\n';

  const twice = await run('superadmin', { action: 'stale', path: PATH }, already);
  assert.equal(twice.res.status, 200);
  assert.equal(twice.res.body.noop, true);
  assert.equal(twice.writes.length, 0, 'an unchanged flag opened a pull request anyway');

  const cleared = await run('superadmin', { action: 'unstale', path: PATH }, already);
  const doc = yaml.load(Buffer.from(cleared.writes[0].body.content, 'base64').toString('utf8'));
  assert.deepEqual(doc.flags['post:old-news'], { unindexed: true, at: '2026-09-01T00:00:00.000Z' }, 'stale cleared, unindexed kept');

  const last = await run('superadmin', { action: 'reindex', path: PATH }, 'flags:\n  "post:old-news":\n    unindexed: true\n');
  const emptied = yaml.load(Buffer.from(last.writes[0].body.content, 'base64').toString('utf8'));
  assert.deepEqual(emptied.flags, {}, 'nothing left: the entry goes rather than lingering as an empty record');
});

test('all four actions are superadmin and write the one registry file', () => {
  const ops = contentFlagOps(4);
  assert.deepEqual(Object.keys(ops).sort(), ['reindex', 'stale', 'unindex', 'unstale']);
  for (const [name, op] of Object.entries(ops)) {
    assert.equal(op.path, 'house/content-flags.yml', `${name} writes somewhere else`);
    assert.equal(op.rank, 4, `${name} is not pinned to the rank it was given`);
  }
});
