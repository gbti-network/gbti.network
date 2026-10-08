// Owner, 2026-10-08: "content owners and superadmins should be able to edit from this dropdown by opening up the
// content inside the workbench." The "..." menu on an item carries Edit, first, for the item's owner and for a
// superadmin, and it opens that item in the WorkBench editor through the WorkBench's own deep links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setClient } from '../client-ui/src/index.mjs';
import { GbtiModActions } from '../client-ui/src/elements/gbti-mod-actions.mjs';
import { readFileSync } from 'node:fs';
import { canEditItem, editHrefFor, workbenchTarget } from '../client-ui/src/mod-actions-core.mjs';
import { parseWorkspaceEdit, parseWorkspaceEditShare } from '../client-ui/src/workspace-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
/** Run fn with globalThis.location set as a page on that address would have it. */
function at(url, fn) {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  const u = new URL(url);
  Object.defineProperty(globalThis, 'location', { value: { protocol: u.protocol, hostname: u.hostname }, configurable: true });
  try { return fn(); } finally { if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location; }
}

test('the owner and a superadmin may edit; nobody else may', () => {
  assert.equal(canEditItem({ role: 'superadmin', viewer: 'bob', author: 'alice' }), true);
  assert.equal(canEditItem({ role: 'member', viewer: 'alice', author: 'alice' }), true);
  assert.equal(canEditItem({ role: 'member', viewer: 'Alice', author: 'alice' }), true, 'a folder compares without case');
  for (const role of ['member', 'moderator', 'admin']) {
    assert.equal(canEditItem({ role, viewer: 'bob', author: 'alice' }), false, role);
  }
  assert.equal(canEditItem({ role: 'member', viewer: '', author: '' }), false, 'no viewer is never the owner');
  assert.equal(canEditItem({}), false);
  assert.equal(canEditItem({ role: 'member', viewer: 'alice', author: 'alice', locked: true }), false,
    'a lapsed owner: the WorkBench would show its locked screen, not the editor');
  assert.equal(canEditItem({ role: 'superadmin', viewer: 'alice', author: 'alice', locked: true }), true);
});

test('the WorkBench is the site\'s own on gbti.network, and the website\'s in a new tab anywhere else', () => {
  const site = { base: '/workbench/', newTab: false };
  const away = { base: 'https://gbti.network/workbench/', newTab: true };
  assert.deepEqual(workbenchTarget(new URL('https://gbti.network/blog/x/')), site);
  assert.deepEqual(workbenchTarget(new URL('https://preview.gbti.network/browse/')), site);
  assert.deepEqual(workbenchTarget({ protocol: 'chrome-extension:', hostname: 'iffjdmifgnjgkdjoodapjciddibmifka' }), away);
  assert.deepEqual(workbenchTarget(new URL('http://127.0.0.1:4567/')), away, 'the agent server serves no /workbench/');
  assert.deepEqual(workbenchTarget(new URL('https://evilgbti.network/')), away, 'a lookalike host is not the site');
  assert.deepEqual(workbenchTarget(null), away);
});

test('the link opens the item itself, and the WorkBench reads it back to the same item', () => {
  const post = editHrefFor({ type: 'post', author: 'alice', slug: 'hello' });
  assert.equal(post, '/workbench/#tab=post&edit=members%2Falice%2Fposts%2Fhello%2Findex.md');
  assert.equal(parseWorkspaceEdit(post.slice(post.indexOf('#'))), 'members/alice/posts/hello/index.md');
  const project = editHrefFor({ type: 'project', author: 'alice', slug: 'tool' }, 'https://gbti.network/workbench/');
  assert.equal(project, 'https://gbti.network/workbench/#tab=project&edit=members%2Falice%2Fprojects%2Ftool%2Findex.md');
  assert.equal(parseWorkspaceEdit(project.slice(project.indexOf('#'))), 'members/alice/projects/tool/index.md');
  assert.match(editHrefFor({ type: 'product', author: 'alice', slug: 'tool' }), /#tab=project&edit=members%2Falice%2Fprojects%2Ftool/, 'a legacy product is a project');
  const prompt = editHrefFor({ type: 'prompt', author: 'alice', slug: 'qa-skill' });
  assert.equal(parseWorkspaceEdit(prompt.slice(prompt.indexOf('#'))), 'members/alice/prompts/qa-skill/index.md');
  const share = editHrefFor({ type: 'share', author: 'alice', id: '20261008132645-smoked-fish' });
  assert.equal(share, '/workbench/#tab=share&edit-share=20261008132645-smoked-fish');
  assert.equal(parseWorkspaceEditShare(share.slice(share.indexOf('#'))), '20261008132645-smoked-fish');
});

test('no link where the WorkBench could not open the item', () => {
  assert.equal(editHrefFor({ type: 'post', author: 'gbti', slug: 'hello' }), null, 'house items live outside members/');
  assert.equal(editHrefFor({ type: 'post', author: 'house', slug: 'hello' }), null);
  assert.equal(editHrefFor({ type: 'post', author: 'Alice', slug: 'hello' }), null, 'the WorkBench accepts lowercase paths only');
  assert.equal(editHrefFor({ type: 'post', author: 'alice', slug: '../x' }), null);
  assert.equal(editHrefFor({ type: 'post', author: 'alice', slug: '' }), null);
  assert.equal(editHrefFor({ type: 'share', author: 'alice', id: '' }), null);
  assert.equal(editHrefFor({ type: 'news', author: 'alice', slug: 'x' }), null);
});

/** A DOM-free element, as in mod-menu.test.mjs, with the viewer it would have read from status(). */
function element({ type = 'post', author = 'alice', slug = 'hello', id = '', role = 'member', viewer = '' } = {}) {
  setClient({ status: async () => ({ role, identity: { username: viewer } }), admin: async () => ({ ok: true }) });
  const el = new GbtiModActions();
  el.dataset = { gbtiType: type, gbtiAuthor: author, gbtiSlug: slug, gbtiId: id };
  let html = '';
  el.set = (m) => { html = m; };
  el.$ = () => null;
  el.$$ = () => [];
  el._role = role;
  el._viewer = viewer;
  el._flags = { stale: false, unindexed: false };
  el._open = false;
  el._said = '';
  el._onDocClick = () => {};
  el._onKey = () => {};
  return { el, html: () => html };
}
const acts = (html) => [...html.matchAll(/data-act="([a-z]+)"/g)].map((m) => m[1]);

test('the owner who is not a superadmin gets the "..." button with Edit alone', () => at('https://gbti.network/browse/', () => {
  const { el, html } = element({ viewer: 'alice' });
  el.render();
  const out = html();
  assert.match(out, /<a class="mi mi-edit" role="menuitem" data-edit href="\/workbench\/#tab=post&amp;edit=members%2Falice%2Fposts%2Fhello%2Findex\.md">Edit<\/a>/);
  assert.deepEqual(acts(out), [], 'no moderation rows');
  assert.doesNotMatch(out, /class="sep"/, 'no separator under a lone Edit');
  assert.match(out, /aria-label="More actions"/);
  setClient(null);
}));

test('a lapsed owner gets no menu', () => {
  const { el, html } = element({ viewer: 'alice' });
  el._locked = true;
  el.render();
  assert.equal(html(), '');
  setClient(null);
});

test('a superadmin gets Edit first, then a separator, then the moderation rows', () => {
  const { el, html } = element({ role: 'superadmin', viewer: 'bob' });
  el.render();
  const out = html();
  const at = (s) => out.indexOf(s);
  assert.ok(at('data-edit') > 0 && at('data-edit') < at('class="sep"') && at('class="sep"') < at('data-act="hide"'), 'Edit, separator, Hide');
  assert.deepEqual(acts(out), ['hide', 'stale', 'unindex', 'remove']);
  setClient(null);
});

test('another member sees no menu; a house item gives a superadmin no Edit', () => {
  const other = element({ viewer: 'bob' });
  other.el.render();
  assert.equal(other.html(), '');
  const house = element({ role: 'superadmin', viewer: 'bob', author: 'gbti' });
  house.el.render();
  assert.doesNotMatch(house.html(), /data-edit/);
  assert.deepEqual(acts(house.html()), ['hide', 'stale', 'unindex', 'remove'], 'the moderation rows stay');
  setClient(null);
});

test('from the extension, Edit opens the website WorkBench in a new tab', () => {
  const had = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'chrome-extension:' }, configurable: true });
  try {
    const { el, html } = element({ type: 'share', slug: '', id: '20261008132645-smoked-fish', viewer: 'alice' });
    el.render();
    assert.match(html(), /href="https:\/\/gbti\.network\/workbench\/#tab=share&amp;edit-share=20261008132645-smoked-fish" target="_blank" rel="noopener">Edit<\/a>/);
  } finally {
    if (had) Object.defineProperty(globalThis, 'location', had); else delete globalThis.location;
    setClient(null);
  }
});

test('the viewer and the lock come from status(), and a failed read shows no owner Edit', async () => {
  const { el } = element();
  el._role = 'member'; el._viewer = '';
  setClient({ status: async () => ({ role: 'member', membership: 'active', identity: { username: 'alice' } }) });
  el.render = () => {};
  await el._load();
  assert.equal(el._viewer, 'alice');
  assert.equal(el._locked, false);
  setClient({ status: async () => ({ role: 'member', membership: 'expired', identity: { username: 'alice' } }) });
  await el._load();
  assert.equal(el._locked, true);
  setClient({ status: async () => { throw new Error('offline'); } });
  await el._load();
  assert.equal(el._viewer, '');
  assert.equal(el._role, 'member');
  assert.equal(el._locked, true);
  setClient(null);
});

test('Space presses the Edit link, and a new-tab Edit returns focus to the button', () => {
  const { el } = element({ viewer: 'alice' });
  let clicked = 0;
  const link = { matches: (sel) => sel === 'a.mi', click: () => { clicked += 1; } };
  Object.defineProperty(el, 'root', { value: { activeElement: link }, configurable: true });
  el._open = true;
  let prevented = false;
  el._key({ key: ' ', preventDefault: () => { prevented = true; } });
  assert.equal(clicked, 1);
  assert.equal(prevented, true, 'the page does not scroll');
  const src = read('client-ui/src/elements/gbti-mod-actions.mjs');
  assert.match(src, /if \(newTab\) this\.\$\('\[data-dots\]'\)\?\.focus\?\.\(\);/);
  setClient(null);
});

test('the WorkBench carries the edit link through sign-in', () => {
  const src = read('src/pages/workbench.astro');
  assert.match(src, /const RETURN_TO = '\/login\/\?return_to=' \+ encodeURIComponent\('\/workbench\/' \+ RETURN_HASH\);/);
  assert.doesNotMatch(src, /return_to=%2Fworkbench%2F'/, 'the old fixed return is gone');
});

test('the reader\'s author card opens the item too, through the same link', () => {
  const src = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(src, /editHrefFor\(\{ type: it\.type, author: it\.author, slug: targetSlugFor\(it\), id: it\.id \}, ws\.base\)/);
  assert.doesNotMatch(src, /#tab=\$\{esc\(it\.type\)\}"/, 'no link to the bare tab is left');
});
