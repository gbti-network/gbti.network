// sow-194 Phase 1a: the CI-built repo-drafts index (scripts/lib/repo-drafts-index.mjs). Pure, node-testable
// (a temp fixture repo), no network. Verifies only status:draft content items are indexed, owner-tagged and
// path-scoped, that published / no-status / governance files are excluded, and the creds-gated KV PUT.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildRepoDraftsIndex, mirrorRepoDraftsToKv, contentSha, REPO_DRAFTS_KV_KEY } from '../scripts/lib/repo-drafts-index.mjs';

function writeItem(root, rel, frontmatter, body = 'hello') {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  const fm = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
  fs.writeFileSync(abs, `---\n${fm}\n---\n${body}\n`);
}

function fixtureRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-drafts-'));
  writeItem(root, 'members/alice/posts/my-wip/index.md', { title: 'My WIP', status: 'draft', visibility: 'public' });
  writeItem(root, 'members/alice/projects/shipped/index.md', { title: 'Shipped', status: 'published' });
  writeItem(root, 'members/Bob/prompts/secret-prompt/index.md', { title: 'Secret Prompt', status: 'draft', visibility: 'members' });
  writeItem(root, 'members/carol/posts/unindexed/index.md', { title: 'Carol', status: 'draft' }); // NOT in members-index
  writeItem(root, 'house/posts/airllm/index.md', { title: 'AirLLM', status: 'draft' });
  writeItem(root, 'house/posts/live-one/index.md', { title: 'Live', status: 'published' });
  writeItem(root, 'members/alice/posts/no-status/index.md', { title: 'No Status' }); // defaults to published
  fs.writeFileSync(path.join(root, 'house', 'roles.yml'), 'superadmins: []\n'); // governance: never indexed
  // The reconcile-maintained immutable-id map. carol is deliberately absent (an un-indexed member).
  fs.writeFileSync(path.join(root, 'house', 'members-index.yml'), 'members:\n  "10": alice\n  "20": bob\n');
  return root;
}

test('buildRepoDraftsIndex: returns the status:draft items tagged with the IMMUTABLE github_id (from members-index)', () => {
  const root = fixtureRepo();
  try {
    const idx = buildRepoDraftsIndex(root);
    assert.deepEqual(idx.map((i) => `${i.owner}/${i.type}/${i.slug}`).sort(),
      ['alice/post/my-wip', 'bob/prompt/secret-prompt', 'carol/post/unindexed', 'house/post/airllm'].sort());
    assert.deepEqual(idx.find((i) => i.slug === 'my-wip'),
      { path: 'members/alice/posts/my-wip/index.md', type: 'post', slug: 'my-wip', owner: 'alice', githubId: '10', title: 'My WIP', visibility: 'public' });
    const secret = idx.find((i) => i.slug === 'secret-prompt');
    assert.equal(secret.owner, 'bob'); // folder 'Bob' -> lowercased
    assert.equal(secret.githubId, '20'); // resolved via members-index, not the login
    assert.equal(secret.path, 'members/Bob/prompts/secret-prompt/index.md'); // path keeps the real folder case
    // HOUSE has no github_id -> null, so no member (even a login 'house') can ever match it in the Worker.
    assert.equal(idx.find((i) => i.slug === 'airllm').owner, 'house');
    assert.equal(idx.find((i) => i.slug === 'airllm').githubId, null);
    // An un-indexed member -> githubId null (fail closed: they see it only once reconcile indexes them).
    assert.equal(idx.find((i) => i.slug === 'unindexed').githubId, null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('buildRepoDraftsIndex: excludes published, no-status (defaults published), and governance files', () => {
  const root = fixtureRepo();
  try {
    const paths = buildRepoDraftsIndex(root).map((i) => i.path);
    assert.ok(!paths.some((p) => p.includes('shipped')));
    assert.ok(!paths.some((p) => p.includes('live-one')));
    assert.ok(!paths.some((p) => p.includes('no-status')));
    assert.ok(!paths.some((p) => p.includes('roles.yml')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('mirrorRepoDraftsToKv: creds-gated no-op (no throw) without CF_*; a real PUT sends { generatedAt, items }', async () => {
  const root = fixtureRepo();
  try {
    const noop = await mirrorRepoDraftsToKv({ root, env: {} });
    assert.equal(noop.written, false);
    assert.match(noop.reason, /CF_ACCOUNT_ID/);

    let sent = null;
    const fetchImpl = async (url, opts) => { sent = { url, opts }; return { ok: true }; };
    const wrote = await mirrorRepoDraftsToKv({ root, env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' }, fetchImpl, now: new Date('2026-08-07T00:00:00.000Z') });
    assert.equal(wrote.written, true);
    assert.ok(sent.url.endsWith(`/values/${encodeURIComponent(REPO_DRAFTS_KV_KEY)}`));
    const body = JSON.parse(sent.opts.body);
    assert.equal(body.generatedAt, '2026-08-07T00:00:00.000Z');
    assert.equal(body.items.length, 4); // alice/my-wip, bob/secret-prompt, carol/unindexed, house/airllm
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// sow-315: the envelope carries the CONTENT COMMIT so the review surfaces can pin their jsDelivr image URLs
// to it. A `@main` URL is cached for seven days in the viewer's browser, so a replaced image keeps showing
// the old picture and no purge reaches it. Envelope, not per item: the item-shape deepEqual above pins
// exactly seven keys, and the sha describes the whole index rather than any one draft.
test('contentSha: only a full 40-hex GITHUB_SHA is recorded', () => {
  const SHA = 'a3190e581c09127494dafe5baf41cf14b2ab1a1e';
  assert.equal(contentSha({ GITHUB_SHA: SHA }), SHA);
  assert.equal(contentSha({ GITHUB_SHA: SHA.toUpperCase() }), SHA, 'normalized, not rejected');
  // A SHORT sha resolves as a BRANCH at jsDelivr and keeps the mutable seven-day cache, so recording one
  // would look like a pin and fix nothing. Null instead, which keeps the honest `main` behaviour.
  assert.equal(contentSha({ GITHUB_SHA: 'a3190e5' }), null);
  assert.equal(contentSha({ GITHUB_SHA: '' }), null);
  assert.equal(contentSha({}), null, 'absent locally, where there is no Actions runner');
  assert.equal(contentSha(undefined), null);
});

test('mirrorRepoDraftsToKv: the PUT body carries the content sha beside generatedAt', async () => {
  const root = fixtureRepo();
  const SHA = 'a3190e581c09127494dafe5baf41cf14b2ab1a1e';
  try {
    let sent = null;
    const fetchImpl = async (url, opts) => { sent = { url, opts }; return { ok: true, status: 200, text: async () => '' }; };
    await mirrorRepoDraftsToKv({
      root, fetchImpl, now: new Date('2026-08-07T00:00:00.000Z'),
      env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't', GITHUB_SHA: SHA },
    });
    const body = JSON.parse(sent.opts.body);
    assert.equal(body.sha, SHA);
    assert.equal(body.generatedAt, '2026-08-07T00:00:00.000Z', 'the existing envelope field is untouched');
    assert.ok(Array.isArray(body.items) && body.items.length > 0);

    // No commit available (a local run) must not write a half-pin.
    await mirrorRepoDraftsToKv({
      root, fetchImpl, now: new Date('2026-08-07T00:00:00.000Z'),
      env: { CF_ACCOUNT_ID: 'a', CF_KV_NAMESPACE_ID: 'n', CF_API_TOKEN: 't' },
    });
    assert.equal(JSON.parse(sent.opts.body).sha, null);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
