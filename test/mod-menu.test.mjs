// sow-409 (owner, 2026-09-25): the moderation control is one "..." button and a menu, for a superadmin only, listing
// only the actions that apply. These drive the element DOM-free, and check the published marks it reads.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { publicContentFlags } from '../membership/content-flags.mjs';
import { setClient } from '../client-ui/src/index.mjs';
import { GbtiModActions } from '../client-ui/src/elements/gbti-mod-actions.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// ---- the published marks ----

test('the published marks carry each key\'s booleans and nothing else', () => {
  const out = publicContentFlags({
    'post:a': { stale: true, at: '2026-09-01', by: 'atwellpub', reason: 'old' },
    'prompt:b': { unindexed: true },
    'share:c': { stale: true }, // not a flaggable type
    'post:d': { stale: false },
    'bad key': { stale: true },
  });
  assert.deepEqual(out, { 'post:a': { stale: true }, 'prompt:b': { unindexed: true } });
  assert.deepEqual(publicContentFlags({}), {});
  assert.deepEqual(publicContentFlags(null), {});
});

test('the site publishes /content-flags.json from the registry', () => {
  const src = read('src/pages/content-flags.json.ts');
  assert.match(src, /flags: allPublicContentFlags\(\)/);
  assert.match(src, /'Access-Control-Allow-Origin': '\*'/);
});

// ---- the element ----

/** A DOM-free element with a fake shadow root that records what render() writes. */
function element({ type = 'post', author = 'alice', slug = 'hello', id = '', role = 'superadmin', admin } = {}) {
  const calls = [];
  setClient({
    status: async () => ({ role }),
    admin: admin || (async (action, body) => { calls.push([action, body.path]); return { ok: true }; }),
  });
  const el = new GbtiModActions();
  el.dataset = { gbtiType: type, gbtiAuthor: author, gbtiSlug: slug, gbtiId: id };
  let html = '';
  el.set = (m) => { html = m; };
  el.$ = () => null;
  el.$$ = () => [];
  el._role = role;
  el._open = false;
  el._said = '';
  el._onDocClick = () => {};
  el._onKey = () => {};
  const events = [];
  el.dispatchEvent = (e) => { events.push(e); return true; };
  return { el, calls, events, html: () => html };
}

const labels = (html) => [...html.matchAll(/role="menuitem" data-act="([a-z]+)"/g)].map((m) => m[1]);

test('a non-superadmin sees nothing at all', () => {
  for (const role of ['member', 'moderator', 'admin']) {
    const { el, html } = element({ role });
    el._flags = { stale: false, unindexed: false };
    el.render();
    assert.equal(html(), '', role);
  }
  setClient(null);
});

test('a superadmin gets one "..." button and a closed menu of what applies', () => {
  const { el, html } = element();
  el._flags = { stale: false, unindexed: false };
  el.render();
  const out = html();
  assert.equal((out.match(/data-dots/g) || []).length, 1, 'one button');
  assert.match(out, /aria-label="Moderation actions"[^>]*aria-haspopup="menu" aria-expanded="false"/);
  assert.match(out, /<div class="menu" role="menu" aria-label="Moderation actions" hidden>/, 'closed until clicked');
  assert.deepEqual(labels(out), ['hide', 'stale', 'unindex', 'remove']);
  assert.equal((out.match(/class="ma /g) || []).length, 0, 'the old row of buttons is gone');
  setClient(null);
});

test('a share lists Hide and Remove', () => {
  const { el, html } = element({ type: 'share', slug: '', id: '20260925-homelabfest' });
  el._flags = undefined;
  el.render();
  assert.deepEqual(labels(html()), ['hide', 'remove']);
  setClient(null);
});

test('a finished Mark stale flips the local mark, so the next open offers Unmark stale', async () => {
  const { el, calls, events, html } = element();
  el._flags = { stale: false, unindexed: false };
  globalThis.confirm = () => true;
  await el._do('stale');
  assert.deepEqual(events.map((e) => [e.type, e.detail.action]), [['mod-action', 'stale']], 'the host is told');
  assert.deepEqual(calls, [['stale', 'members/alice/posts/hello/index.md']]);
  assert.deepEqual(el._flags, { stale: true, unindexed: false });
  assert.deepEqual(labels(html()), ['hide', 'unstale', 'unindex', 'remove']);
  assert.match(html(), /<span class="said" role="status">Marked stale<\/span>/);
  delete globalThis.confirm;
  setClient(null);
});

test('a declined confirm sends nothing', async () => {
  const { el, calls } = element();
  el._flags = { stale: false, unindexed: false };
  globalThis.confirm = () => false;
  await el._do('remove');
  assert.deepEqual(calls, []);
  delete globalThis.confirm;
  setClient(null);
});

test('a refusal says so and changes no mark', async () => {
  const err = Object.assign(new Error('no'), { code: 'forbidden' });
  const { el, html } = element({ admin: async () => { throw err; } });
  el._flags = { stale: false, unindexed: false };
  globalThis.confirm = () => true;
  await el._do('unindex');
  assert.deepEqual(el._flags, { stale: false, unindexed: false });
  assert.equal(el._said, 'Not permitted');
  assert.match(html(), />Not permitted</);
  delete globalThis.confirm;
  setClient(null);
});

test('the menu copies the avatar menu\'s look and opens below its button', () => {
  const src = read('client-ui/src/elements/gbti-mod-actions.mjs');
  assert.match(src, /\.menu \{ position:absolute; top:calc\(100% \+ 8px\); right:0;/);
  assert.match(src, /\.mi:hover, \.mi:focus-visible \{ background:var\(--green-tint\)/);
  // The drive caught the panel see-through in the Glass layout: the page's frosting rule cannot reach a shadow root.
  assert.match(src, /backdrop-filter:var\(--glass-blur, none\);/);
  assert.match(src, /\.dots:hover, \.dots\[aria-expanded="true"\] \{[^}]*background:transparent;/, 'the shared green button hover is overridden');
});
