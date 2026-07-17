// githubFetchUser (workers/signup/oauth.mjs): the Worker's server-side token verification. GitHub intermittently
// rejects the Worker egress with a transient 403 (secondary rate limit) / 429 / 5xx, which must NOT be reported as
// a bad token. These lock in: a transient status retries then succeeds, a persistent transient fails carrying the
// real status, and a 401 (genuinely bad token) is NOT retried. All with an injected fetch + a noop sleep (no delay).

import test from 'node:test';
import assert from 'node:assert/strict';
import { githubFetchUser } from '../workers/signup/oauth.mjs';

const noSleep = () => Promise.resolve();
const jsonRes = (status, body) => ({ ok: status >= 200 && status < 300, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });

test('githubFetchUser: returns the user on a 200', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonRes(200, { id: 2002207, login: 'atwellpub' }); };
  const u = await githubFetchUser('tok', fetchImpl, { sleep: noSleep });
  assert.deepEqual(u, { githubId: '2002207', githubLogin: 'atwellpub' });
  assert.equal(calls, 1);
});

test('githubFetchUser: a transient 403 is retried then succeeds (retries opt-in)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return calls < 2 ? jsonRes(403, 'rate limited') : jsonRes(200, { id: 5, login: 'x' }); };
  const u = await githubFetchUser('tok', fetchImpl, { retries: 2, sleep: noSleep });
  assert.equal(u.githubId, '5');
  assert.equal(calls, 2);
});

test('githubFetchUser: the DEFAULT is no retry (hot paths are not silently retried)', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonRes(403, 'rate limited'); };
  await assert.rejects(() => githubFetchUser('tok', fetchImpl, { sleep: noSleep }), (e) => { assert.equal(calls, 1); assert.equal(e.status, 403); return true; });
});

test('githubFetchUser: a persistent 403 throws carrying the real status', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonRes(403, 'secondary rate limit'); };
  await assert.rejects(
    () => githubFetchUser('tok', fetchImpl, { retries: 2, sleep: noSleep }),
    (e) => { assert.equal(e.status, 403); assert.equal(calls, 3); return true; },
  );
});

test('githubFetchUser: a 401 (bad token) is NOT retried', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonRes(401, 'Bad credentials'); };
  await assert.rejects(
    () => githubFetchUser('tok', fetchImpl, { retries: 2, sleep: noSleep }),
    (e) => { assert.equal(e.status, 401); assert.equal(calls, 1); return true; },
  );
});

test('githubFetchUser: a 5xx is retried then propagates its status', async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; return jsonRes(502, 'bad gateway'); };
  await assert.rejects(
    () => githubFetchUser('tok', fetchImpl, { retries: 1, sleep: noSleep }),
    (e) => { assert.equal(e.status, 502); assert.equal(calls, 2); return true; },
  );
});
