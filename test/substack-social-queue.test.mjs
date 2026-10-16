// Substack in the Social Queue (owner, 2026-10-16). Substack has no write API and no composer prefill, so it is
// a hand-posted channel: the drain renders a Substack Note into a Social Queue task, Assist copies it and opens
// substack.com/notes. The owner set the format by example; the first test pins exactly that text, rendered from
// the LIVE house/syndication-config.yml through the same mirror the Worker reads. No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { drainSyndication } from '../workers/signup/syndication-drain.mjs';
import { enqueue, SYND_CONFIG_KEY } from '../workers/signup/syndication-store.mjs';
import {
  CHANNELS, MATRIX_CHANNELS, AUTO_TYPES, channelCapability, toSyndicationMirror, syndicationConfigFromParsed,
  autoModeFor, templateFor,
} from '../membership/syndication-config-core.mjs';
import { SYNDICATION_CHANNEL_NAMES } from '../membership/syndication-template-edits.mjs';
import { channelLimit, rendersMarkdown } from '../membership/syndication-channels.mjs';
import { renderChannelText } from '../membership/syndication-render.mjs';
import { composeUrl, assistCopiesText } from '../client-ui/src/social-composer.mjs';

const LIVE = yaml.load(fs.readFileSync(new URL('../house/syndication-config.yml', import.meta.url), 'utf8'));
const DESCRIPTION = 'Advanced Pixel Editor brings crop, resize, sharpening, contrast, rotation, and optional AI editing directly into the WordPress Media Library.';
const URL_ = 'https://gbti.network/projects/advanced-pixel-editor/';
// The owner's example, verbatim apart from the line break the chat box swallowed.
const OWNER_EXAMPLE = `Latest project posted 🎉 ${URL_}\n${DESCRIPTION}`;

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

test('a published project drains into a Substack task carrying the owner\'s example text exactly', async () => {
  // The KV copy is what the mirror job writes on merge, so this is the text the live Worker would queue.
  const kv = fakeKV({ [SYND_CONFIG_KEY]: JSON.stringify(toSyndicationMirror(LIVE)) });
  await enqueue({ SIGNUP_KV: kv }, {
    source: 'project', targetSlug: 'gbtilabs/advanced-pixel-editor', title: 'Advanced Pixel Editor',
    blurb: DESCRIPTION, url: URL_, visibility: 'public', author: 'gbtilabs',
  }, { kv, now: at(0) });
  await drainSyndication({}, { kv, now: at(48 * 60 * 60_000), adapters: {} });
  const tasks = [...kv.store.entries()].filter(([k]) => k.startsWith('social:task:')).map(([, v]) => JSON.parse(v));
  const sub = tasks.find((t) => t.channel === 'substack');
  assert.ok(sub, `a Substack task is queued (got: ${tasks.map((t) => t.channel).join(', ') || 'none'})`);
  assert.equal(sub.text, OWNER_EXAMPLE);
  assert.equal(sub.status, 'pending');
});

test('Substack is a hand-posted channel in all three channel lists, so none of them can drift', () => {
  assert.ok(CHANNELS.includes('substack'));
  assert.ok(MATRIX_CHANNELS.includes('substack'), 'it gets a column in the Channels page grid');
  assert.ok(SYNDICATION_CHANNEL_NAMES.includes('substack'), 'a template saved on its card is accepted');
  assert.equal(channelCapability('substack'), 'manual');
  // The third list (the Syndicate now destinations) is pinned in membership-syndicate-now.test.mjs.
  assert.equal(rendersMarkdown('substack'), false, 'a Note is plain text');
  assert.equal(channelLimit('substack'), 3000);
});

test('the live settings send every type to the Substack queue, with the Note templates', () => {
  const cfg = syndicationConfigFromParsed(LIVE);
  for (const type of AUTO_TYPES) assert.equal(autoModeFor(cfg, type, 'substack'), 'on-manual', type);
  for (const type of ['post', 'project', 'prompt']) {
    assert.equal(templateFor(cfg, type, 'substack', { channelOnly: true }), 'Latest {content-type} posted 🎉 {url}\\n{short-description}', type);
  }
  const article = renderChannelText(cfg, { source: 'post', title: 'T', blurb: 'What it covers.', url: 'https://gbti.network/blog/t/' }, 'substack');
  assert.equal(article, 'Latest article posted 🎉 https://gbti.network/blog/t/\nWhat it covers.');
  const share = renderChannelText(cfg, { source: 'share', title: 'A good read', url: 'https://ex.com/read' }, 'substack');
  assert.equal(share, 'Latest link shared 🎉 https://ex.com/read\nA good read');
  // A note-less item leaves no dangling blank line.
  assert.equal(renderChannelText(cfg, { source: 'prompt', title: 'P', url: 'https://gbti.network/prompts/p/' }, 'substack'),
    'Latest prompt posted 🎉 https://gbti.network/prompts/p/');
});

test('a members-only item gets the members teaser with its link, never the public text', () => {
  const cfg = syndicationConfigFromParsed(LIVE);
  const text = renderChannelText(cfg, { source: 'project', title: 'Hidden', authorName: 'Ada', blurb: 'secret detail', url: 'https://gbti.network/projects/hidden/', visibility: 'members' }, 'substack');
  assert.equal(text, 'Members-only on the GBTI Network: "Hidden" by Ada. Membership unlocks it. https://gbti.network/projects/hidden/');
});

test('Assist copies the text and opens Substack Notes, because Substack cannot be filled in', () => {
  assert.equal(composeUrl({ channel: 'substack', text: OWNER_EXAMPLE }), 'https://substack.com/notes');
  assert.equal(assistCopiesText('substack'), true);
  assert.equal(assistCopiesText('dailydev'), true, 'daily.dev cannot be filled in either');
  assert.equal(assistCopiesText('x'), false, 'X opens with the text already filled in');
});
