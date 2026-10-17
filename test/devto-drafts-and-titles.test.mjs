// dev.to from the Social Queue (owner, 2026-10-17): every post is a DRAFT the owner publishes on dev.to, the title is
// the item's own title, and an item that moved folders after it was queued is still found. Each test drives the REAL
// dev.to adapter with a fake fetch, so nothing reaches dev.to or GitHub. No secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevtoAdapter, currentLocationFor } from '../clients/syndication/devto.mjs';
import { renderDevtoTitle } from '../membership/syndication-render.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import { putTask, getTask } from '../workers/signup/social-queue-store.mjs';
import { handleSocialQueueAction } from '../workers/signup/social-queue-admin.mjs';

function fakeKV(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    async get(key, type) { const v = store.get(key); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); },
    async put(key, value) { store.set(key, value); },
    async delete(key) { store.delete(key); },
    async list({ prefix = '' } = {}) { return { keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const superAuth = async () => ({ ok: true, role: 'superadmin', githubId: '1', login: 'owner' });
const req = (body) => new Request('https://signup.gbti.network/membership/social-queue', { method: 'POST', headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const FILE = (author) => `---
title: 'Minecraft Fabric Mod: Jockey Radio'
slug: jockey-radio
shortDescription: A Fabric server mod that plays radio on music discs.
categories: [entertainment, gaming]
tags: [minecraft, fabric]
status: published
visibility: public
type: project
author: ${author}
---

Jockey Radio puts live radio on Minecraft music discs.
`;

// GitHub raw (only the NEW folder exists), the site's projects index, and dev.to.
function world({ indexItems = [{ type: 'project', slug: 'jockey-radio', author: 'gbtilabs', path: 'members/gbtilabs/projects/jockey-radio/index.md' }] } = {}) {
  const calls = [];
  let article = null;
  const fetchImpl = async (url, opts = {}) => {
    calls.push(url);
    if (url.startsWith('https://raw.githubusercontent.com/')) {
      return url.endsWith('/members/gbtilabs/projects/jockey-radio/index.md')
        ? { ok: true, status: 200, text: async () => FILE('gbtilabs') }
        : { ok: false, status: 404, text: async () => '404: Not Found' };
    }
    if (url === 'https://gbti.network/projects-index.json') return { ok: true, status: 200, json: async () => ({ items: indexItems }) };
    if (url === 'https://dev.to/api/articles') {
      article = JSON.parse(opts.body).article;
      return { ok: true, status: 201, text: async () => JSON.stringify({ id: 42, url: 'https://dev.to/gbti-network/temp-slug-42' }) };
    }
    return { ok: false, status: 599, text: async () => '' };
  };
  return { fetchImpl, calls, article: () => article };
}

// The Jockey Radio task as it sits in the live queue: queued from atwellpub's folder before the move.
const STALE_ITEM = {
  source: 'project', targetType: 'project', targetSlug: 'members/atwellpub/projects/jockey-radio', author: 'atwellpub',
  authorName: 'Hudson Atwell', authorDevto: 'https://dev.to/atwellpub', title: 'Jockey Radio',
  url: 'https://gbti.network/projects/jockey-radio/', visibility: 'public', membersOnly: false, categoryPath: ['entertainment', 'gaming'],
};

test('a moved item is read from where it lives now, credited to its current author, and saved as a draft', async () => {
  const w = world();
  const ad = createDevtoAdapter({ env: { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' }, fetchImpl: w.fetchImpl });
  const r = await ad.post({ ...STALE_ITEM, textOverride: 'Minecraft Fabric Mod: Jockey Radio' });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(w.calls.includes('https://gbti.network/projects-index.json'), 'the old folder 404s, so the site index is consulted');
  const a = w.article();
  assert.equal(a.published, false, 'a draft, never live');
  assert.equal(a.title, 'Minecraft Fabric Mod: Jockey Radio');
  assert.equal(a.canonical_url, 'https://gbti.network/projects/jockey-radio/');
  assert.match(a.body_markdown, /gbti\.network\/members\/gbtilabs\//, 'the byline credits the current author');
  assert.doesNotMatch(a.body_markdown, /members\/atwellpub\//);
  assert.equal(r.draft, true);
});

test('a missing file the index cannot place still fails with the plain reason', async () => {
  const w = world({ indexItems: [] });
  const ad = createDevtoAdapter({ env: { DEVTO_API_KEY: 'k' }, fetchImpl: w.fetchImpl });
  const r = await ad.post({ ...STALE_ITEM });
  assert.deepEqual(r, { ok: false, error: 'devto: could not read the canonical file (404)' });
  assert.equal(w.article(), null, 'nothing reaches dev.to');
});

test('the index lookup refuses a path outside the content folders', async () => {
  const bad = world({ indexItems: [{ slug: 'jockey-radio', author: 'x', path: 'members/../../etc/index.md' }] });
  assert.equal(await currentLocationFor(STALE_ITEM, bad.fetchImpl), null);
  const other = world({ indexItems: [{ slug: 'jockey-radio', author: 'x', path: '.github/workflows/index.md' }] });
  assert.equal(await currentLocationFor(STALE_ITEM, other.fetchImpl), null);
});

test('Post now from the Social Queue saves a dev.to draft and the task records it', async () => {
  const kv = fakeKV();
  await putTask(kv, { id: 'jr::devto', itemId: 'jr', channel: 'devto', source: 'project', title: 'Jockey Radio', url: STALE_ITEM.url,
    text: 'Minecraft Fabric Mod: Jockey Radio', item: STALE_ITEM, status: 'pending', createdAt: 1 });
  const w = world();
  const env = { SIGNUP_KV: kv, DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  const res = await handleSocialQueueAction(req({ action: 'post', id: 'jr::devto' }), env,
    { kv, now: () => 9, authorize: superAuth, adapters: { devto: createDevtoAdapter({ env, fetchImpl: w.fetchImpl }) } });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.draft, true);
  assert.equal(w.article().published, false);
  const done = await getTask(kv, 'jr::devto');
  assert.equal(done.status, 'done');
  assert.equal(done.postedDraft, true);
});

test('a dev.to queue task is titled with the item title, never the Discord announcement', async () => {
  // dev.to is an AUTO channel routed On-Manual; before the fix its text fell through to the shared Discord template.
  const cfg = { syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: {},
    auto_matrix: { project: { devto: 'on-manual', discord: 'off', 'discord-category': 'off', x: 'off', linkedin: 'off', bluesky: 'off', reddit: 'off', dailydev: 'off', substack: 'off' } } } };
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(cfg) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'project', targetSlug: 'gsusi/ishacked', author: 'gsusi', mention: '<@493193064467267594>',
    title: 'IsHacked: Know a Client Site Is Hacked Before Google Does', url: 'https://gbti.network/projects/ishacked/', visibility: 'public' }, { kv, now: () => 0 });
  await drainSyndication({}, { kv, now: () => 48 * 3600e3, adapters: {} });
  const tasks = [...kv.store.entries()].filter(([k]) => k.startsWith('social:task:')).map(([, v]) => JSON.parse(v));
  const devto = tasks.find((t) => t.channel === 'devto');
  assert.ok(devto, 'a dev.to task is queued');
  assert.equal(devto.text, 'IsHacked: Know a Client Site Is Hacked Before Google Does');
});

test('the dev.to title helper: a members-only item gets the titled suffix, and nothing carries a link or a mention', () => {
  const cfg = syndicationConfigFromParsed({});
  const pub = renderDevtoTitle(cfg, { source: 'post', title: 'A **bold** idea', url: 'https://gbti.network/blog/a/', mention: '<@1>' });
  assert.equal(pub, 'A bold idea');
  const stub = renderDevtoTitle(cfg, { source: 'prompt', title: 'Hidden', visibility: 'members' });
  assert.equal(stub, 'Hidden (a members-only prompt from the GBTI Network)');
  assert.ok(renderDevtoTitle(cfg, { source: 'post', title: 'x'.repeat(300) }).length <= 128);
});
