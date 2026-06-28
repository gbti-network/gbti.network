// SOW-076 P1: the client transport for optimistic comment ECHOES, via the signup Worker's /membership/comment-echo.
// Mirrors member-activity-client.mjs: thin, injectable-fetch wrappers that send the GitHub bearer token. The Worker
// stores the echo per target (read-your-writes: the GET returns only the caller's own pending echoes). Unit-tested
// with a fake fetch (no network).

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class CommentEchoClientError extends Error {}

async function call(method, path, body, { token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new CommentEchoClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/comment-echo' + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new CommentEchoClientError(data?.message || data?.error || `comment-echo request failed (${res.status})`);
  return data;
}

/** The caller's own pending echoes for one target: { echoes: [{ id, body, prNumber, createdAt, ... }] }. */
export async function getCommentEchoes({ targetType, targetSlug, ...opts }) {
  const q = `?targetType=${encodeURIComponent(targetType)}&targetSlug=${encodeURIComponent(targetSlug)}`;
  return call('GET', q, null, opts);
}

/** Write an optimistic echo on comment-post (the Worker stamps the author from the token). */
export async function addCommentEcho({ echo, ...opts }) {
  return call('POST', '', { action: 'add', echo }, opts);
}

/** Reap (delete) the caller's own echoes that have landed (now deployed) or been declined. */
export async function reapCommentEchoes({ targetType, targetSlug, ids, ...opts }) {
  return call('POST', '', { action: 'reap', targetType, targetSlug, ids }, opts);
}
