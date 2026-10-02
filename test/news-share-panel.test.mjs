// sow-171 (owner, 2026-10-01): the "Share to our channels" panel in the extension's news reader, and the relays it
// calls. The owner approved the design with one condition, "make sure that these extra items are not revealed
// initially", so the first tests here hold exactly that: a superadmin sees one button, the panel is hidden until it is
// pressed, and no channel is picked when it opens. The shared rules and the Worker are in news-share-core.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { dispatch } from '../extension/src/ext-dispatch.mjs';
import { handleApi } from '../client/src/api.mjs';
import { createHttpClient } from '../client-ui/src/client.mjs';
import { GbtiNewsShare, discordPreviewHtml } from '../client-ui/src/elements/gbti-news-share.mjs';
import { GbtiNewsReader } from '../client-ui/src/elements/gbti-news-reader.mjs';
import { composeUrl } from '../client-ui/src/social-composer.mjs';
import { newsShareDraft, formatNewsPost } from '../membership/news-share.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const STORY = {
  guid: 'https://techcrunch.com/?p=3061234',
  title: 'World’s first enhanced geothermal power plant completed in just 23 months',
  link: 'https://techcrunch.com/2026/09/30/fervo-geothermal/',
  source: 'techcrunch',
  category: 'Energy',
  excerpt: 'Fervo Energy completes world’s first enhanced geothermal power plant in under 2 years.',
};

// A panel without a DOM: render() writes its markup to `html`, and the wiring is skipped (the handlers are called
// directly below). The constructor is not run, so the fields it sets are set here the same way.
function panel({ client = null, status = null } = {}) {
  const el = Object.create(GbtiNewsShare.prototype);
  el.html = '';
  el.set = (m) => { el.html = m; };
  el.css = () => '';
  el.$ = () => null;
  el.$$ = () => [];
  Object.defineProperty(el, 'client', { value: client, configurable: true });
  el._story = STORY;
  el._publisher = 'TechCrunch';
  el._reset();
  el._status = status;
  el._channels = [];
  return el;
}

// ---- "not revealed initially" ----

test('the panel opens with no channel picked: only the coverage line, the channel pills and a hint show', () => {
  const el = panel({ status: { discord: { posted: false }, channels: {} } });
  el.render();
  assert.match(el.html, /Pick a channel to write its post\./);
  assert.doesNotMatch(el.html, /aria-pressed="true"/, 'a channel was picked before the superadmin picked one');
  assert.doesNotMatch(el.html, /<textarea|<input|data-assist|data-done|data-discord|Link to/, 'the composer showed before a channel was picked');
  for (const label of ['X', 'Bluesky', 'LinkedIn', 'Reddit', 'daily.dev', 'Discord', 'dev.to']) assert.match(el.html, new RegExp(`<span>${label.replace('.', '\\.')}</span>`));
  assert.match(el.html, /disabled title="dev\.to takes pages we publish ourselves"[^]*GBTI pages only/, 'dev.to is shown, disabled');
});

test('the panel element hides itself while it has the hidden attribute, and closing forgets the pick', () => {
  const src = read('client-ui/src/elements/gbti-news-share.mjs');
  assert.match(src, /:host\(\[hidden\]\) \{ display:none !important; \}/, 'without it the host display beats the hidden attribute');
  const el = panel();
  el._target = 'x';
  el._drafts = { x: 'edited' };
  el._msg = { text: 'Copied the post text.' };
  el.close();
  assert.equal(el.hidden, true);
  assert.equal(el._target, '');
  assert.deepEqual(el._drafts, {});
  assert.equal(el._msg, null);
});

test('a superadmin sees only the "Share to our channels" button, with the panel slotted but hidden', () => {
  const prevDoc = globalThis.document;
  globalThis.document = { createElement: (tag) => ({ tag }) };
  try {
    const r = Object.create(GbtiNewsReader.prototype);
    r._mountShare(STORY);
    assert.equal(r._share.tag, 'gbti-news-share');
    assert.equal(r._share.hidden, true, 'the panel must start hidden');
    assert.equal(r._share.story.guid, STORY.guid);
  } finally { globalThis.document = prevDoc; }
  const src = read('client-ui/src/elements/gbti-news-reader.mjs');
  assert.match(src, /aria-expanded="\$\{this\._shareOpen\}" aria-controls="news-share"/);
  // Every open() starts with no panel and closed, so a panel never carries over to another story.
  const open = src.slice(src.indexOf('async open(item)'), src.indexOf('this.render();', src.indexOf('async open(item)')));
  assert.match(open, /this\._share = null;/);
  assert.match(open, /this\._shareOpen = false;/, 'a story opens with the panel closed');
  assert.equal((src.match(/createElement\('gbti-news-share'\)/g) || []).length, 1, 'one place makes the panel');
  assert.equal((src.match(/this\._mountShare\(/g) || []).length, 1, 'one call site, behind the superadmin check');
  assert.match(src, /if \(status\?\.role === 'superadmin' && item\.guid && this\._item === item\) \{ this\._mountAdmin\(item\); this\._mountShare\(item\); \}/, 'superadmins only');
  assert.match(src, /: this\._canCurate \? `<button class="disc" data-disc type="button">Add to Discord<\/button>` : '';/, 'a curator who is not a superadmin keeps Add to Discord');
});

test('the toggle opens and closes the panel', () => {
  const calls = [];
  const r = Object.create(GbtiNewsReader.prototype);
  r._share = { open: () => calls.push('open'), close: () => calls.push('close') };
  r._shareOpen = false;
  r.render = () => calls.push('render');
  r._toggleShare();
  r._toggleShare();
  assert.deepEqual(calls, ['open', 'render', 'close', 'render']);
  assert.equal(r._shareOpen, false);
});

// ---- picking a channel ----

test('picking X shows its draft, a count against 280, the link choice and the three actions', () => {
  const el = panel({ status: { discord: {}, channels: {} } });
  el._target = 'x';
  el.render();
  const draft = newsShareDraft('x', STORY, { publisher: 'TechCrunch' });
  assert.ok(el.html.includes(`>${draft.replace(/’/g, '’')}</textarea>`), 'the draft is in the editor');
  assert.match(el.html, new RegExp(`${draft.length} / 280`));
  assert.match(el.html, /The article on techcrunch\.com/);
  assert.match(el.html, /Our news page on gbti\.network/);
  assert.match(el.html, /Assist post to X/);
  assert.match(el.html, /data-copy>Copy text</);
  assert.match(el.html, /data-done>Mark done</);
});

test('Assist opens the same composer address the Social Queue opens, with the draft filled in', () => {
  const el = panel({ status: { discord: {}, channels: {} } });
  el._target = 'x';
  const opened = [];
  const prev = globalThis.window;
  globalThis.window = { open: (u) => opened.push(u) };
  try { el._assist(); } finally { globalThis.window = prev; }
  const text = newsShareDraft('x', STORY, { publisher: 'TechCrunch' });
  assert.deepEqual(opened, [composeUrl({ channel: 'x', text, url: STORY.link })]);
  assert.equal(el._opened.x, true);
  assert.match(el._msg.text, /^Opened X with the text\. Post it there, then press Mark done\.$/);
});

test('switching the link keeps an edited draft and only changes the address in it', () => {
  const el = panel({ status: { discord: {}, channels: {} } });
  el._target = 'x';
  el._drafts.x = `Worth a read: ${STORY.link}`;
  el._setLink('gbti');
  assert.equal(el._drafts.x, `Worth a read: https://gbti.network/news/item/?g=${encodeURIComponent(STORY.guid)}&s=techcrunch`);
});

test('Mark done shows Posted at once, sends the record, and puts it back if the server refuses', async () => {
  const sent = [];
  const ok = { newsShareDone: async (r) => { sent.push(r); return { ok: true, done: { doneAt: 5, doneBy: 'atwellpub' } }; } };
  const el = panel({ client: ok, status: { discord: {}, channels: { x: null } } });
  el._target = 'x';
  await el._markDone();
  assert.equal(sent.length, 1);
  assert.deepEqual(Object.keys(sent[0]).sort(), ['category', 'channel', 'guid', 'text', 'title', 'url']);
  assert.equal(sent[0].channel, 'x');
  assert.equal(sent[0].url, STORY.link);
  assert.deepEqual(el._status.channels.x, { doneAt: 5, doneBy: 'atwellpub' });
  el.render();
  assert.match(el.html, /data-pick="x" aria-pressed="true">[^]*?<span class="pst">Posted<\/span>/);
  assert.match(el.html, /Marked done\. It is listed in the Social Queue under Manual done, so nobody posts it twice\./);
  assert.doesNotMatch(el.html, /Marked done by/, 'right after the press, one line says it, not two');
  el._msg = null; // the panel opened again later: the record says who and when
  el.render();
  assert.match(el.html, /Marked done by atwellpub on [^.]+\. You can still post it again\./);

  const bad = { newsShareDone: async () => { throw new Error('superadmin access is required to share news to our channels'); } };
  const el2 = panel({ client: bad, status: { discord: {}, channels: { x: null } } });
  el2._target = 'x';
  await el2._markDone();
  assert.equal(el2._status.channels.x, null, 'the optimistic Posted was put back');
  assert.equal(el2._msg.err, true);
});

test('Discord previews the exact message and posts to the chosen channel; the category channel is the default', async () => {
  const calls = [];
  const client = { publishNews: async (item, opts) => { calls.push(opts); return { ok: true, posted: true, channelId: opts.channelId || '11' }; } };
  const el = panel({ client, status: { discord: { posted: false, mappedChannelId: '11' }, channels: {} } });
  el._channels = [{ id: '11', name: 'energy', type: 0 }, { id: '22', name: 'news', type: 0 }];
  el._target = 'discord';
  el.render();
  assert.ok(el.html.includes(discordPreviewHtml(formatNewsPost(STORY))), 'the preview is the posted message');
  assert.ok(el.html.includes('📰 <strong>World’s first enhanced geothermal power plant completed in just 23 months</strong><br><em>via techcrunch</em><br>https://techcrunch.com/2026/09/30/fervo-geothermal/'),
    'shown as Discord shows it: bold title, italic credit, plain link');
  assert.equal(discordPreviewHtml('📰 **<img src=x onerror=alert(1)>**\nhttps://e.com/a_b_'), '📰 <strong>&lt;img src=x onerror=alert(1)&gt;</strong><br>https://e.com/a_b_', 'escaped, and a link keeps its underscores');
  assert.match(el.html, /<option value="11" selected>#energy<\/option>/);
  assert.doesNotMatch(el.html, /Link to/, 'Discord always links the article');
  await el._postDiscord();
  assert.deepEqual(calls[0], {}, 'the default channel is left to the Worker');
  assert.equal(el._status.discord.posted, true);

  const el2 = panel({ client, status: { discord: { posted: false, mappedChannelId: '11' }, channels: {} } });
  el2._channels = [{ id: '22', name: 'news', type: 0 }];
  el2._target = 'discord';
  el2._discordChoice = '22';
  await el2._postDiscord();
  assert.deepEqual(calls[1], { channelId: '22' });

  const el3 = panel({ client, status: { discord: { posted: false, mappedChannelId: null }, channels: {} } });
  el3._channels = [{ id: '22', name: 'news', type: 0 }];
  el3._target = 'discord';
  await el3._postDiscord();
  assert.equal(calls.length, 2, 'an "Other" story with no channel picked does not post');
  assert.equal(el3._msg.text, 'Pick a Discord channel first.');
});

test('a failed status read says so and offers a retry, rather than claiming nothing was posted', () => {
  const el = panel();
  el._statusErr = 'Could not check where this story has been posted.';
  el.render();
  assert.match(el.html, /msg err" role="status">Could not check where this story has been posted\. <button type="button" class="link" data-retry>Try again<\/button>/);
  assert.doesNotMatch(el.html, /Not posted anywhere yet/);
});

// ---- the relays ----

function workerStub(answer = { ok: true }) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null });
    return { ok: true, status: 200, async json() { return answer; } };
  };
  return { calls, fetch };
}
const ctxFor = ({ fetch, identity = { login: 'alice', githubId: '1', username: 'alice' } } = {}) => ({
  identity: () => identity,
  store: { get: (k) => ({ githubToken: 'tok' })[k] },
  getRepoClient: () => null,
  fetch: fetch ?? (async () => { throw new Error('no network in test'); }),
  reader: { async readFile() { return null; } },
});

test('both hosts relay /api/news-share to the Worker with the member token', async () => {
  for (const [name, call] of [
    ['extension', (ctx, req) => dispatch(ctx, req)],
    ['website/agent', (ctx, req) => handleApi(req, ctx)],
  ]) {
    const { calls, fetch } = workerStub({ ok: true, discord: {}, channels: {} });
    const ctx = ctxFor({ fetch });
    const g = await call(ctx, { method: 'GET', pathname: '/api/news-share', query: { guid: STORY.guid, category: 'Energy' } });
    assert.equal(g.status, 200, `${name} GET ${JSON.stringify(g.json ?? g.body)}`);
    const p = await call(ctx, { method: 'POST', pathname: '/api/news-share', query: {}, body: { guid: STORY.guid, channel: 'x', url: STORY.link, text: 'x' } });
    assert.equal(p.status, 200, `${name} POST`);
    assert.equal(calls.length, 2, name);
    assert.equal(calls[0].url, `https://signup.gbti.network/membership/news-share?guid=${encodeURIComponent(STORY.guid)}&category=Energy`);
    assert.equal(calls[1].method, 'POST');
    assert.equal(calls[1].body.channel, 'x');
    for (const c of calls) assert.equal(c.auth, 'Bearer tok', `${name}: the Worker is the gate, so it must get the member token`);
    const bad = await call(ctx, { method: 'POST', pathname: '/api/news-share', query: {}, body: { channel: 'x' } });
    assert.equal(bad.status, 400, `${name}: a record without a story never reaches the Worker`);
    assert.equal(calls.length, 2);
  }
});

test('the page client calls the share route and passes a chosen Discord channel', async () => {
  const seen = [];
  const fetch = async (url, init) => { seen.push({ url, body: init.body ? JSON.parse(init.body) : null }); return { ok: true, status: 200, json: async () => ({ ok: true }) }; };
  const c = createHttpClient({ baseUrl: '', token: 't', fetch });
  await c.newsShareStatus('g 1', 'AI/ML');
  await c.newsShareDone({ guid: 'g', channel: 'x' });
  await c.publishNews({ guid: 'g' }, { channelId: '22' });
  await c.publishNews({ guid: 'g' });
  assert.equal(seen[0].url, '/api/news-share?guid=g+1&category=AI%2FML');
  assert.deepEqual(seen[1].body, { guid: 'g', channel: 'x' });
  assert.deepEqual(seen[2].body, { item: { guid: 'g' }, channelId: '22' });
  assert.deepEqual(seen[3].body, { item: { guid: 'g' } }, 'a curator call is unchanged');
});

test('the Social Queue labels a news row and opens the shared composer addresses', () => {
  const src = read('client-ui/src/elements/gbti-social-queue.mjs');
  assert.match(src, /const SRC_LABEL = \{ share: 'Share', post: 'Article', project: 'Project', prompt: 'Prompt', news: 'News' \};/);
  assert.match(src, /import \{ composeUrl \} from '\.\.\/social-composer\.mjs';/);
  assert.doesNotMatch(src, /const composeUrl = /, 'one copy of the composer addresses');
});
