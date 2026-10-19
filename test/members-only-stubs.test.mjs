// Owner, 2026-10-19: "if a member shares something that is members only, the stubs are not made public unless
// somewhere explicitly said to leave a public stub. This is for all content." The website already held to it; shares
// did not. A members-only share was posted to the members' Discord AND queued as a teaser for X, LinkedIn, Bluesky,
// Reddit, daily.dev and Substack carrying its title, summary, picture and link (it happened on 2026-10-06), and a share
// had no stub option at all. The owner's answers that day: such a share goes to the members' Discord only, and shares
// get a "Leave a public stub" option, which gives them a LOCKED public page that the announcements link to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { channelAllowedFor, MATRIX_CHANNELS } from '../membership/syndication-config-core.mjs';
import { buildQueueItem, normalizeItem } from '../membership/syndication-queue.mjs';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, getItem, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import { handleSyndicateNow } from '../workers/signup/membership-syndicate-now.mjs';
import { buildSyndicationItem, sharePageUrl } from '../scripts/lib/content-syndication.mjs';
import { toQueueInput } from '../scripts/enqueue-syndication.mjs';
import { checkBuildSecrets } from '../scripts/check-build-secrets.mjs';
import { buildShareFile, shareSummary } from '../client/src/content-ops.mjs';
import { editInputFor } from '../client-ui/src/share-post-core.mjs';
import { isShareStub, isPublicShare } from '../src/lib/home-feed.mjs';
import { syndicateAttrs } from '../src/lib/syndicate-attrs.mjs';
import { membersOnlyPagePaths } from '../membership/members-only-pages.mjs';

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
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
const tasks = (kv) => [...kv.store.keys()].filter((k) => k.startsWith('social:task:'));

test('the rule: public goes anywhere, a stub goes anywhere, a no-stub members share only to the members\' Discord', () => {
  assert.ok(MATRIX_CHANNELS.includes('x') && MATRIX_CHANNELS.includes('discord') && MATRIX_CHANNELS.length >= 8, 'control: the channel list');
  const pub = { source: 'share', visibility: 'public', membersOnly: false };
  const share = { source: 'share', visibility: 'members', membersOnly: true };
  const post = { source: 'post', visibility: 'members', membersOnly: true };
  for (const ch of MATRIX_CHANNELS) {
    assert.equal(channelAllowedFor(pub, ch), true, `public, ${ch}`);
    assert.equal(channelAllowedFor({ ...share, publicStub: true }, ch), true, `stub share, ${ch}`);
    assert.equal(channelAllowedFor(share, ch), ch === 'discord' || ch === 'discord-category', `members share, ${ch}`);
    assert.equal(channelAllowedFor(post, ch), false, `members article, ${ch}`);
    assert.equal(channelAllowedFor({ ...post, publicStub: true }, ch), true, `stub article (Syndicate now on its locked page), ${ch}`);
  }
  // Fail closed.
  assert.equal(channelAllowedFor({ source: 'share' }, 'x'), false, 'no visibility is members-only');
  assert.equal(channelAllowedFor({ ...share, publicStub: 'true' }, 'x'), false, 'a stub must be exactly true');
  assert.equal(channelAllowedFor({ source: 'share', visibility: 'public', membersOnly: true }, 'x'), false, 'a contradictory item is members-only');
  assert.equal(channelAllowedFor(null, 'discord'), false);
});

test('a queue item carries the stub only as an exact true on a members-only item; an older stored item reads false', () => {
  const q = (extra) => buildQueueItem({ source: 'share', targetSlug: 'members/a/shares/s', ...extra });
  assert.equal(q({ visibility: 'members', publicStub: true }).publicStub, true);
  assert.equal(q({ visibility: 'members' }).publicStub, false);
  assert.equal(q({ visibility: 'members', publicStub: 'true' }).publicStub, false);
  assert.equal(q({ visibility: 'public', publicStub: true }).publicStub, false, 'meaningless on a public item');
  const old = { id: 'share:members/a/shares/s#1', source: 'share', targetSlug: 'members/a/shares/s', visibility: 'members' };
  assert.equal(normalizeItem(old).publicStub, false);
  assert.equal(normalizeItem({ ...old, publicStub: true }).publicStub, true);
});

// The drain is the backstop: it also holds back anything queued before the rule existed.
const DRAIN_CFG = JSON.stringify({ syndication: { enabled: true, require_approval: false, hold_minutes: 60, channels: { discord: true },
  auto_matrix: { share: { discord: 'on', x: 'on-manual', bluesky: 'on-manual', linkedin: 'off', dailydev: 'off', substack: 'off', reddit: 'off', devto: 'off' } } } });
const discordOk = (calls) => ({ discord: { name: 'discord', enabled: () => true, post: async (i) => { calls.push(i.id); return { ok: true, id: 'm1', url: 'u' }; } } });
const AFTER_HOLD = 4 * 60 * 60_000;

test('the drain: a members-only share with no stub posts to Discord, and X and Bluesky get no task', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: DRAIN_CFG });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'members/a/shares/s', url: 'https://ext.com/m', visibility: 'members' }, { kv, now: () => 0 });
  // Stored the way the old code stored it: no publicStub field at all.
  const stored = JSON.parse(kv.store.get(`synd:item:${r.id}`));
  delete stored.publicStub;
  kv.store.set(`synd:item:${r.id}`, JSON.stringify(stored));
  const calls = [];
  await drainSyndication({ DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'c' }, { kv, now: () => AFTER_HOLD, adapters: discordOk(calls) });
  const item = await getItem(kv, r.id);
  assert.equal(calls.length, 1, 'the members\' Discord still gets it');
  assert.equal(item.perChannel.discord.status, 'sent');
  for (const ch of ['x', 'bluesky']) assert.deepEqual([item.perChannel[ch]?.status, item.perChannel[ch]?.reason], ['skipped', 'members-only'], ch);
  assert.deepEqual(tasks(kv), [], 'no Social Queue teaser');
});

test('the drain: the same share with a public stub gets its X and Bluesky tasks', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: DRAIN_CFG });
  const r = await enqueue({ SIGNUP_KV: kv }, { source: 'share', targetSlug: 'members/a/shares/s', url: 'https://gbti.network/shares/a/s/', visibility: 'members', publicStub: true }, { kv, now: () => 0 });
  await drainSyndication({ DISCORD_BOT_TOKEN: 't', DISCORD_CHANNEL_SHARES: 'c' }, { kv, now: () => AFTER_HOLD, adapters: discordOk([]) });
  const item = await getItem(kv, r.id);
  assert.equal(item.perChannel.x.status, 'queued-manual');
  assert.equal(item.perChannel.bluesky.status, 'queued-manual');
  assert.equal(tasks(kv).length, 2);
});

test('the enqueue: a stub share carries the stub and links its locked page; a no-stub share keeps its own link', () => {
  const fm = { title: 'A members share', status: 'published', visibility: 'members', author: 'alice', url: 'https://ext.com/m', category: 'devops' };
  const rel = 'members/alice/shares/s3.md';
  const stubItem = buildSyndicationItem(rel, { ...fm, publicStub: true });
  assert.equal(stubItem.publicStub, true);
  const stub = toQueueInput({ item: stubItem, fm: { ...fm, publicStub: true }, rel, siteOrigin: 'https://gbti.network' });
  assert.equal(stub.url, 'https://gbti.network/shares/alice/s3/');
  assert.equal(stub.publicStub, true);
  const plain = toQueueInput({ item: buildSyndicationItem(rel, fm), fm, rel, siteOrigin: 'https://gbti.network' });
  assert.equal(plain.url, 'https://ext.com/m', 'its own link, which only the members\' Discord receives');
  assert.equal(plain.publicStub, false);
  // A share that names no visibility is members-only, its schema default (it used to be taken as public here).
  assert.equal(buildSyndicationItem(rel, { ...fm, visibility: undefined }).visibility, 'members');
  assert.equal(sharePageUrl({ type: 'share', author: 'alice', slug: 's3', visibility: 'members' }), null);
  assert.equal(sharePageUrl({ type: 'share', author: 'alice', slug: 's3', visibility: 'members', publicStub: 'true' }), null);
});

test('Syndicate now refuses an outside network for a no-stub members share, and allows it with a stub', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { enabled: true, channels: { discord: true } } }) });
  const req = (body) => ({ method: 'POST', headers: { get: () => 'Bearer t' }, async json() { return body; } });
  const superadmin = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
  const item = { source: 'share', targetSlug: 'members/a/shares/s', targetType: 'share', author: 'a', title: 'A members share', url: 'https://ext.com/m', visibility: 'members' };
  const refused = await handleSyndicateNow(req({ destination: 'x', item, template: '{title} {url}' }), { SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error, 'members_only');
  assert.deepEqual(tasks(kv), []);
  const ok = await handleSyndicateNow(req({ destination: 'x', item: { ...item, publicStub: true, url: 'https://gbti.network/shares/a/s/' }, template: '{title} {url}' }), { SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(ok.status, 200);
  assert.equal(tasks(kv).length, 1);
  const article = await handleSyndicateNow(req({ destination: 'discord', channelId: '111222333444555666', item: { ...item, source: 'post', targetType: 'post' }, template: '{title}' }), { SIGNUP_KV: kv }, { kv, authorize: superadmin });
  assert.equal(article.status, 409, 'a members-only article with no stub goes nowhere, Discord included');
});

test('the build guard: a locked share page passes, and fails the moment it carries the link', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-stub-'));
  try {
    fs.mkdirSync(path.join(root, 'house/_enc'), { recursive: true });
    fs.mkdirSync(path.join(root, 'members/alice/shares'), { recursive: true });
    fs.writeFileSync(path.join(root, 'members/alice/shares/st-1.md'), '---\nstatus: published\nvisibility: members\npublicStub: true\nid: st-1\nauthor: alice\ntitle: A locked share heading\nurl: https://ext.com/secret-thing?a=1&b=2\n---\n');
    fs.writeFileSync(path.join(root, 'members/alice/shares/no-stub.md'), '---\nstatus: published\nvisibility: members\nid: no-stub\nauthor: alice\ntitle: A share with no stub heading\n---\n');
    fs.mkdirSync(path.join(root, 'dist/shares/alice/st-1'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/index.html'), '<html>ok</html>');
    const page = path.join(root, 'dist/shares/alice/st-1/index.html');
    fs.writeFileSync(page, '<html><h1>A locked share heading</h1><p>Members-only link</p></html>');
    assert.deepEqual(checkBuildSecrets({ root, env: {} }).errors, [], 'the locked page with its title is allowed');
    fs.writeFileSync(page, '<html><h1>A locked share heading</h1><a href="https://ext.com/secret-thing?a=1&amp;b=2">x</a></html>');
    assert.ok(checkBuildSecrets({ root, env: {} }).errors.some((e) => /locked page of a members-only share carries the link/.test(e)), 'the link, even HTML-escaped');
    fs.writeFileSync(page, '<html><h1>A locked share heading</h1></html>');
    fs.mkdirSync(path.join(root, 'dist/shares/alice/no-stub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist/shares/alice/no-stub/index.html'), '<html>x</html>');
    assert.ok(checkBuildSecrets({ root, env: {} }).errors.some((e) => /NON-public share has a page in dist: dist\/shares\/alice\/no-stub\//.test(e)), 'no stub, no page');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('saving and editing a share keeps the stub only on a members-only share', () => {
  const base = { id: 'astro-tip', createdAt: '2026-10-19T00:00:00Z', title: 'Astro', category: 'devops', url: 'https://ext.com/a' };
  assert.equal(buildShareFile({ username: 'ann', input: { ...base, visibility: 'members', publicStub: true } }).frontmatter.publicStub, true);
  assert.match(buildShareFile({ username: 'ann', input: { ...base, visibility: 'members', publicStub: true } }).markdown, /^publicStub: true$/m);
  for (const input of [{ ...base, visibility: 'public', publicStub: true }, { ...base, visibility: 'members', publicStub: 'true' }, { ...base, visibility: 'members', publicStub: false }]) {
    assert.equal('publicStub' in buildShareFile({ username: 'ann', input }).frontmatter, false, JSON.stringify(input));
  }
  assert.equal(shareSummary('members/ann/shares/astro-tip.md', { visibility: 'members', publicStub: true }).publicStub, true);
  assert.equal(shareSummary('members/ann/shares/astro-tip.md', { visibility: 'public', publicStub: true }).publicStub, false);
  const share = { id: 'astro-tip', visibility: 'members', publicStub: true, status: 'published' };
  assert.equal(editInputFor({ share, fields: {} }).publicStub, true, 'an edit that does not touch it keeps it');
  assert.equal('publicStub' in editInputFor({ share, fields: { publicStub: false } }), false, 'unticked');
  assert.equal('publicStub' in editInputFor({ share, fields: { visibility: 'public' } }), false, 'gone on a switch to Public');
});

test('the composer offers the stub under Members only, off by default, and sends it only for members; so does the agent tool', () => {
  const c = read('client-ui/src/elements/gbti-share-composer.mjs');
  assert.match(c, /<label class="stubopt" data-stub-opt hidden><input type="checkbox" data-public-stub \/><span><b>Leave a public stub<\/b>/, 'hidden, and not checked');
  assert.match(c, /stubOpt\.hidden = this\._visibility !== 'members';/);
  assert.match(c, /const publicStub = visibility === 'members' && this\.\$\('\[data-public-stub\]'\)\?\.checked === true;/);
  assert.match(c, /if \(publicStub\) input\.publicStub = true;/);
  assert.match(c, /visibility, publicStub, removeUrl:/, 'an edit sends the box as it stands');
  assert.equal((c.match(/stub\.checked = false;/g) || []).length, 2, 'cleared after a post and when an edit ends');
  // The Syndicate now panel holds back the same channels the Worker refuses, and learns the stub from the page.
  const panel = read('client-ui/src/elements/gbti-syndicate-now.mjs');
  assert.match(panel, /const membersHeld = !channelAllowedFor\(this\._item\(\), d\.id\);/);
  assert.match(panel, /publicStub: d\.gbtiPublicStub === 'true',/);
  const t = read('client/src/mcp-tools.mjs');
  assert.match(t, /publicStub: visibility === 'members' && args\.publicStub === true \? true : undefined,/);
});

test('the locked page: one fail-closed check, no link anywhere in it, no discussion, unindexed and out of the sitemap', () => {
  assert.equal(isShareStub({ status: 'published', visibility: 'members', publicStub: true }), true);
  for (const d of [{ status: 'draft', visibility: 'members', publicStub: true }, { status: 'published', visibility: 'members' }, { status: 'published', visibility: 'members', publicStub: 'true' }, { status: 'published', visibility: 'public', publicStub: true }]) {
    assert.equal(isShareStub(d), false, JSON.stringify(d));
  }
  assert.equal(isPublicShare({ status: 'published', visibility: 'members', publicStub: true }), false, 'a stub is still not a public share (no feed)');
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /\.filter\(\(s\) => isPublicShare\(s\.data\) \|\| isShareStub\(s\.data\)\)/);
  assert.equal((page.match(/d\.url/g) || []).length, 1, 'the link is read once, into `link`, which a locked page leaves undefined');
  assert.match(page, /const link: string \| undefined = locked \? undefined : d\.url;/);
  assert.match(page, /\{!locked && <Comments /);
  assert.match(page, /noindex=\{locked \? 'noindex' : false\}/);
  assert.match(page, /url=\{locked \? new URL\(`\/shares\/\$\{slug\}\/`/, 'the Syndicate now panel links the locked page, not the share\'s link');
  // The panel learns about the stub only for a members-only item.
  assert.equal(syndicateAttrs({ type: 'share', id: 's', author: 'a', visibility: 'members', publicStub: true })['data-gbti-public-stub'], 'true');
  assert.equal('data-gbti-public-stub' in syndicateAttrs({ type: 'share', id: 's', author: 'a', visibility: 'public', publicStub: true }), false);
  assert.equal('data-gbti-public-stub' in syndicateAttrs({ type: 'share', id: 's', author: 'a', visibility: 'members' }), false);
  // Every members-only share is named for the sitemap filter; a public one is not.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-stub-paths-'));
  try {
    fs.mkdirSync(path.join(root, 'members/alice/shares'), { recursive: true });
    fs.writeFileSync(path.join(root, 'members/alice/shares/st-1.md'), '---\nstatus: published\nvisibility: members\npublicStub: true\nid: st-1\n---\n');
    fs.writeFileSync(path.join(root, 'members/alice/shares/pub-1.md'), '---\nstatus: published\nvisibility: public\nid: pub-1\n---\n');
    assert.deepEqual([...membersOnlyPagePaths(root)], ['/shares/alice/st-1/']);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the public CTA list names an item only when it has a public page', () => {
  assert.match(read('src/lib/ctas.mjs'), /title: live \? \(found\?\.title \?\? null\) : null,/);
  assert.match(read('src/pages/ctas.json.ts'), /live: isPublicShare\(d\) \|\| isShareStub\(d\) \}\);/);
});
