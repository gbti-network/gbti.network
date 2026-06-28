// SOW-076 P1c: the client comment-echo transport. Fake fetch -> no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getCommentEchoes, addCommentEcho, reapCommentEchoes, CommentEchoClientError } from '../client/src/member-comment-echo-client.mjs';

const ok = (json) => async (url, opts) => ({ _url: url, _opts: opts, ok: true, async json() { return json; } });

test('getCommentEchoes GETs /membership/comment-echo with the target query + bearer token', async () => {
  let cap;
  const fetch = async (url, opts) => { cap = { url, opts }; return { ok: true, async json() { return { echoes: [{ id: 'e1' }] }; } }; };
  const r = await getCommentEchoes({ targetType: 'post', targetSlug: 'a', token: 'tok', signupBase: 'https://s/', fetch });
  assert.equal(cap.url, 'https://s/membership/comment-echo?targetType=post&targetSlug=a');
  assert.equal(cap.opts.headers.Authorization, 'Bearer tok');
  assert.deepEqual(r.echoes, [{ id: 'e1' }]);
});

test('addCommentEcho POSTs action add; reapCommentEchoes POSTs action reap', async () => {
  let cap;
  const fetch = async (url, opts) => { cap = { url, body: JSON.parse(opts.body) }; return { ok: true, async json() { return { ok: true }; } }; };
  await addCommentEcho({ echo: { id: 'e1', targetType: 'post', targetSlug: 'a' }, token: 't', signupBase: 's', fetch });
  assert.equal(cap.body.action, 'add');
  assert.equal(cap.body.echo.id, 'e1');
  await reapCommentEchoes({ targetType: 'post', targetSlug: 'a', ids: ['e1'], token: 't', signupBase: 's', fetch });
  assert.equal(cap.body.action, 'reap');
  assert.deepEqual(cap.body.ids, ['e1']);
});

test('throws when not signed in, and surfaces a non-ok error', async () => {
  await assert.rejects(() => getCommentEchoes({ targetType: 'post', targetSlug: 'a', token: '', signupBase: 's', fetch: ok({}) }), CommentEchoClientError);
  const bad = async () => ({ ok: false, status: 403, async json() { return { error: 'forbidden' }; } });
  await assert.rejects(() => addCommentEcho({ echo: {}, token: 't', signupBase: 's', fetch: bad }), /forbidden/);
});
