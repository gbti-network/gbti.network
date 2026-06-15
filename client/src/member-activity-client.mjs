// SOW-024: the client write path for member ACTIVITY (favorites + collections) against the deletable edge
// store, via the signup Worker's POST/GET /membership/activity. Mirrors member-content.mjs: thin, injectable
// fetch wrappers that send the GitHub bearer token. Unit-tested with a fake fetch (no network).
//
// Collections let a member organize prompts (and posts/products) into named lists, in ADDITION to favoriting
// them. Both live in the edge store keyed by github_id, so they are private and erasable (SOW-024), unlike the
// git-native SOW-013 favorites.yml. New write surfaces should prefer this store.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class ActivityClientError extends Error {}

async function call(method, body, { token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new ActivityClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/activity', {
    method,
    headers: { Authorization: 'Bearer ' + token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new ActivityClientError(data?.message || data?.error || `activity request failed (${res.status})`);
  return data;
}

/** The caller's full activity ({ favorites, collections }). */
export async function getActivity(opts) {
  return call('GET', null, opts);
}

/** Toggle a favorite. targetType in {post,product,prompt}. */
export async function setFavorite({ targetType, targetSlug, on = true, ...opts }) {
  return call('POST', { action: 'favorite', type: targetType, slug: targetSlug, on }, opts);
}

/** Create a named collection; the returned body carries the new collection `id`. */
export async function createCollection({ name, ...opts }) {
  return call('POST', { action: 'collection.create', name }, opts);
}

export async function renameCollection({ id, name, ...opts }) {
  return call('POST', { action: 'collection.rename', id, name }, opts);
}

export async function deleteCollection({ id, ...opts }) {
  return call('POST', { action: 'collection.delete', id }, opts);
}

/** Add (on:true) or remove (on:false) a content item to/from a collection. */
export async function setCollectionItem({ id, targetType, targetSlug, on = true, ...opts }) {
  return call('POST', { action: 'collection.item', id, type: targetType, slug: targetSlug, on }, opts);
}
