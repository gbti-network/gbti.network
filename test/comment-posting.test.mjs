// sow-443 (owner report, 2026-10-06): a comment posted in the extension showed "No replies yet", then reappeared as
// "2002207" with a blank avatar, its long link ran past the card, the share's cover had vanished, and a bare video or
// tweet line could never embed in the extension. These pin each fix: the post waits (bounded) for its echo, an echo is
// shown under the viewer's name, long words wrap, the share reader falls back to the share's own image, and the
// extension's client passes autoEmbed to the renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mergeCommentEchoes, reapEchoes, normalizeEchoRecord, addEcho } from '../membership/comment-echo.mjs';
import { publishComment } from '../client/src/operations-social.mjs';
import { mergeCommentEchoesFor } from '../client/src/operations-read.mjs';
import { createHttpClient } from '../client-ui/src/client.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body, text: async () => JSON.stringify(body) });
const SLUG = 'atwellpub/20261006152854-chatgpt-ads-don-t-work-yet-here-s-the-proof';
const TWEET = 'https://x.com/KatieKeithBarn2/status/2107396191969562653';

test('a pending echo is shown under the viewer\'s name; the stored key stays the account number', () => {
  const echo = { id: 'c1', author: '2002207', targetType: 'share', targetSlug: SLUG, body: TWEET, prNumber: 7, createdAt: '2026-10-06T15:35:36.318Z' };
  const deployed = [{ id: 'd1', author: 'robrochford', createdAt: '2026-10-06T15:00:00.000Z' }];
  const r = mergeCommentEchoes({ deployed, echoes: [echo], viewer: 'atwellpub' });
  const pending = r.comments.find((c) => c.id === 'c1');
  assert.equal(pending.author, 'atwellpub');
  assert.equal(pending._pending, true);
  assert.equal(r.comments.find((c) => c.id === 'd1').author, 'robrochford', 'a deployed row keeps its own author');
  assert.equal(echo.author, '2002207', 'the input echo is not mutated');
  assert.equal(mergeCommentEchoes({ echoes: [echo] }).comments[0].author, '2002207', 'no viewer: unchanged (the old behaviour)');
  assert.equal(mergeCommentEchoes({ echoes: [echo], viewer: '  ' }).comments[0].author, '2002207', 'a blank viewer is no viewer');
  // Reaping still matches the stored key, which the Worker sets from the token.
  const rec = addEcho(normalizeEchoRecord(null), echo, { now: () => 1 });
  assert.equal(reapEchoes(rec, ['c1'], { author: '2002207' }).echoes.length, 0);
});

test('both hosts pass the viewer: the extension from its identity, the website from its folder name', async () => {
  const calls = [];
  const ctx = {
    identity: () => ({ username: 'atwellpub', githubId: 2002207 }),
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    fetch: async (url, init) => { calls.push([url, init?.method]); return json({ echoes: [{ id: 'c1', author: '2002207', targetType: 'share', targetSlug: SLUG, body: TWEET, prNumber: 7, createdAt: '2026-10-06T15:35:36.318Z' }] }); },
  };
  const rows = await mergeCommentEchoesFor(ctx, { targetType: 'share', targetSlug: SLUG, deployed: [] });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].author, 'atwellpub');
  assert.match(calls[0][0], /\/membership\/comment-echo\?/);
  assert.match(read('src/lib/workbench-client.ts'), /mergeCommentEchoes\(\{ deployed, echoes, viewer: user \}\)/);
});

function postCtx(echoFetch) {
  const events = [];
  return {
    events,
    identity: () => ({ username: 'atwellpub', githubId: 2002207 }),
    membership: async () => 'paid',
    store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
    now: () => '2026-10-06T15:35:36.318Z',
    fetch: async (url, init) => {
      if (String(url).endsWith('/membership/author')) return json({ ok: true, number: 7, html_url: 'https://github.com/x/pull/7', branch: 'gbti/comment-x' });
      if (String(url).includes('/membership/comment-echo')) return echoFetch(events, init);
      throw new Error(`unexpected ${url}`);
    },
  };
}
const post = (ctx) => publishComment(ctx, { targetType: 'share', targetSlug: SLUG, body: TWEET, visibility: 'public' })
  .then((r) => { ctx.events.push('returned'); return r; });

test('a post returns only after its echo is written, so the discussion\'s reload finds it', async () => {
  const ctx = postCtx(async (events, init) => {
    events.push(`echo ${JSON.parse(init.body).action}`);
    await new Promise((r) => { setTimeout(r, 60); });
    events.push('echo stored');
    return json({ ok: true });
  });
  const r = await post(ctx);
  assert.equal(r.prNumber, 7);
  assert.deepEqual(ctx.events, ['echo add', 'echo stored', 'returned']);
});

test('a failed echo write never fails the post', async () => {
  const ctx = postCtx(async () => json({ error: 'nope' }, 500));
  const r = await post(ctx);
  assert.equal(r.prNumber, 7);
});

test('an echo write that never answers holds the post for 4 seconds at most', async () => {
  const ctx = postCtx(() => new Promise(() => {}));
  const t0 = Date.now();
  let timer;
  // A race, not a test timeout: a longer bound must FAIL here (a timed-out test only reports as cancelled).
  const late = new Promise((r) => { timer = setTimeout(() => r('still waiting'), 7000); });
  const r = await Promise.race([post(ctx), late]);
  clearTimeout(timer);
  const waited = Date.now() - t0;
  assert.notEqual(r, 'still waiting', 'the post must return within the bound');
  assert.equal(r.prNumber, 7);
  assert.ok(waited >= 3900 && waited < 6000, `waited ${waited} ms`);
});

test('the extension\'s client sends autoEmbed to the renderer (it was dropped, so no bare link ever embedded there)', async () => {
  const sent = [];
  const client = createHttpClient({ baseUrl: 'http://host', token: 't', fetch: async (url, init) => { sent.push(JSON.parse(init.body)); return json({ html: '' }); } });
  await client.preview({ body: TWEET, autoEmbed: true });
  await client.preview({ body: 'plain' });
  assert.deepEqual(sent[0], { body: TWEET, autoEmbed: true });
  assert.deepEqual(sent[1], { body: 'plain' }, 'an article preview asks for no embeds');
});

test('long words wrap in every comment body, and the share reader falls back to the share\'s own image', () => {
  assert.match(read('client-ui/src/elements/gbti-discussion.mjs'), /\.cbody \{[^}]*overflow-wrap:anywhere;/);
  assert.match(read('client-ui/src/elements/gbti-comment-echoes.mjs'), /\.body \{[^}]*overflow-wrap:anywhere;/);
  assert.match(read('src/components/blog/Comments.astro'), /\.cmt-rich \{ overflow-wrap: anywhere; \}/);
  assert.match(read('client-ui/src/elements/gbti-reader.mjs'),
    /const coverUrl = resolveAsset\(it\.thumbWide \|\| it\.thumbCard \|\| it\.thumb \|\| \(it\.type === 'share' \? it\.image : null\)\);/,
    'a hosted thumbnail first, then the share\'s own image');
});
