// sow-405 (owner, 2026-09-25): "We want to make bluesky an assisted post, not an automated post." Bluesky joins X,
// LinkedIn, Reddit and daily.dev: every Bluesky post lands in the Social Queue, Assist opens Bluesky's own composer
// with the text filled in, and a person posts it. These tests pin the live grid, the link inside every Bluesky
// to-do (the old adapter carried the link as a card, so the article templates had none), and the queue's button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { syndicationConfigFromParsed, autoModeFor, channelCapability, AUTO_TYPES } from '../membership/syndication-config-core.mjs';
import { buildSocialTask, withLink } from '../membership/social-queue.mjs';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import { listTasks } from '../workers/signup/social-queue-store.mjs';
import { GbtiSocialQueue } from '../client-ui/src/elements/gbti-social-queue.mjs';

const HOUSE = yaml.load(readFileSync(new URL('../house/syndication-config.yml', import.meta.url), 'utf8'));
const LIVE = syndicationConfigFromParsed(HOUSE.syndication ?? HOUSE);

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
const at = (t) => () => t;
const AFTER_HOLD = 4 * 60 * 60_000;

test('Bluesky is assisted: every content type on the live grid lands in the Social Queue, none posts itself', () => {
  assert.equal(channelCapability('bluesky'), 'manual');
  for (const t of AUTO_TYPES) assert.equal(autoModeFor(LIVE, t, 'bluesky'), 'on-manual', `${t} -> Bluesky is a queue to-do`);
});

test('every stored Bluesky template carries the link, as X does', () => {
  const tpl = HOUSE.syndication.channel_templates.bluesky;
  for (const t of AUTO_TYPES) assert.match(String(tpl[t] || ''), /\{(url|shareurl)\}/, `bluesky ${t}`);
});

test('a Bluesky to-do always carries the link: appended when missing, left alone when present, kept within 300', () => {
  const url = 'https://gbti.network/articles/hello/';
  const item = { id: 'i1', source: 'post', title: 'Hello', url };
  assert.equal(buildSocialTask({ item, channel: 'bluesky', text: 'New article: "Hello" #ai' }).text, `New article: "Hello" #ai ${url}`);
  assert.equal(buildSocialTask({ item, channel: 'bluesky', text: `"Hello" ${url} #ai` }).text, `"Hello" ${url} #ai`, 'no second copy');
  const long = buildSocialTask({ item, channel: 'bluesky', text: 'x'.repeat(400) }).text;
  assert.ok(long.length <= 300 && long.endsWith(` ${url}`), 'trimmed to make room, never over the cap');
  assert.equal(buildSocialTask({ item, channel: 'x', text: 'no link here' }).text, 'no link here', 'only Bluesky is changed');
  assert.equal(withLink('text', '', 300), 'text', 'an item without a link is left as it is');
});

test('the posting job queues Bluesky (never its adapter) with the live wording, and the article to-do links the article', async () => {
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify({ syndication: { ...HOUSE.syndication, enabled: true, require_approval: false, hold_minutes: 60 } }) });
  await enqueue({ SIGNUP_KV: kv }, { source: 'post', targetSlug: 'members/alice/posts/hello', title: 'Hello World', url: 'https://gbti.network/articles/hello/', visibility: 'public', author: 'alice' }, { kv, now: at(0) });
  const never = { bluesky: { name: 'bluesky', enabled: () => true, post: async () => { throw new Error('bluesky must not auto-post'); } } };
  await drainSyndication({ BLUESKY_HANDLE: 'h', BLUESKY_APP_PASSWORD: 'p' }, { kv, now: at(AFTER_HOLD), adapters: never });
  const task = (await listTasks(kv)).find((t) => t.channel === 'bluesky');
  assert.ok(task, 'a Bluesky to-do was queued');
  assert.equal(task.status, 'pending');
  assert.match(task.text, /Hello World/);
  assert.ok(task.text.includes('https://gbti.network/articles/hello/'), task.text);
});

test('the queue row offers "Assist post to Bluesky", which opens Bluesky\'s composer with the text filled in', () => {
  const task = { id: 'i1::bluesky', channel: 'bluesky', source: 'share', title: 'Cops', text: '"Cops" https://gbti.network/shares/x/ #english', status: 'pending', createdAt: 1 };
  const el = Object.create(GbtiSocialQueue.prototype);
  el._rowBusy = null;
  const row = el._todoRow(task);
  assert.match(row, /data-assist="i1::bluesky"[^>]*>[^]*Assist post to Bluesky</);
  assert.doesNotMatch(row, /data-post=|Post now/, 'no automatic post from the queue');
  const opened = [];
  const prev = globalThis.window;
  globalThis.window = { open: (u) => opened.push(u) };
  try {
    el._byId = () => task;
    el.render = () => {};
    el._assist(task.id);
  } finally { globalThis.window = prev; }
  assert.deepEqual(opened, [`https://bsky.app/intent/compose?text=${encodeURIComponent(task.text)}`]);
});

test('the queue\'s intro names Bluesky among the channels posted by hand', () => {
  const src = readFileSync(new URL('../client-ui/src/elements/gbti-social-queue.mjs', import.meta.url), 'utf8');
  assert.match(src, /on the channels posted by hand \(X, LinkedIn, Reddit, daily\.dev and Bluesky\), Assist opens/);
});
