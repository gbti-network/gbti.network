// SOW-157: the hosted draft store endpoint over KV (the follows/activity pattern).
//   GET  /membership/drafts                           -> { ok, drafts: [record] }   (the caller's own drafts)
//   POST /membership/drafts { op:'put', draft }       -> { ok, drafts }
//   POST /membership/drafts { op:'delete', type, slug } -> { ok, drafts }
//
// Auth = SIGNED-IN, non-banned (authorizeMember): TRIAL members may stage drafts (SOW-011 lets trials
// author; hosted trials have no fork, so this store IS their staging area, and nothing here ever reaches
// the canonical repo). Data is keyed `drafts:<github_id>`: per-member, private, ERASABLE (a hard KV delete,
// the SOW-024 right-to-erasure runbook). Pure transforms in membership/member-drafts.mjs; this handler only
// does auth + the read-modify-write, unit-tested with a fake KV + a stubbed authorizer.

import { authorizeMember } from './membership-content.mjs';
import { mirrorRole } from './membership-admin.mjs';
import { NETWORK_CONTENT_OWNER_ID } from '../../client/src/content-ops.mjs';
import { DraftError, normalizeDrafts, applyDraftPut, applyDraftDelete, listDraftRecords, draftKeyOf, isNetworkDraftPath, mergeSharedDrafts } from '../../membership/member-drafts.mjs';

export const DRAFTS_KEY = (githubId) => `drafts:${githubId}`;

// sow-489: drafts of the network's own content (members/gbtilabs/...) are kept in the network account's store, so the
// network account and every superadmin open ONE saved copy. A superadmin is recognised by the role in the overrides
// mirror (mirrorRole, fail closed), read for the identity authorize() has already verified; a payload never decides it.
// Nobody else is ever routed to another account's store.
export async function handleDrafts(request, env, { kv = env?.SIGNUP_KV, now, authorize = authorizeMember, roleOf = mirrorRole, ...authDeps } = {}) {
  if (!kv) return { status: 500, body: { error: 'misconfigured', message: 'the draft store is not configured' } };

  const auth = await authorize(request, env, { ...authDeps, allowCookie: true }); // sow-158 Phase 1b: accept the website session cookie
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const key = DRAFTS_KEY(auth.githubId);
  const networkKey = DRAFTS_KEY(NETWORK_CONTENT_OWNER_ID);
  const method = request.method;
  // The network account's own store already IS the shared one; anyone else shares it only as a superadmin.
  let sharesCache;
  const sharesNetwork = async () => {
    if (sharesCache === undefined) {
      if (String(auth.githubId) === NETWORK_CONTENT_OWNER_ID) sharesCache = false;
      else { try { const r = await roleOf({ ...env, SIGNUP_KV: kv }, String(auth.githubId)); sharesCache = r?.ok === true && r.role === 'superadmin'; } catch { sharesCache = false; } }
    }
    return sharesCache;
  };
  const listFor = async () => {
    const own = await kv.get(key, 'json');
    if (!(await sharesNetwork())) return listDraftRecords(own);
    return mergeSharedDrafts(own, await kv.get(networkKey, 'json'));
  };

  if (method === 'GET') return { status: 200, body: { ok: true, drafts: await listFor() } };
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }

  // Which store this write belongs to. A put names its path in the draft. A delete names it as `path`; an older client
  // that sends only type and slug deletes from the caller's own store, or from the shared one when only it holds the item.
  let target = key;
  if (payload?.op === 'put' && isNetworkDraftPath(payload?.draft?.path) && await sharesNetwork()) target = networkKey;
  if (payload?.op === 'delete' && await sharesNetwork()) {
    if (isNetworkDraftPath(payload?.path)) target = networkKey;
    else if (!payload?.path) {
      const k = draftKeyOf(String(payload?.type ?? ''), String(payload?.slug ?? ''));
      const inOwn = Boolean(normalizeDrafts(await kv.get(key, 'json')).items[k]);
      const shared = normalizeDrafts(await kv.get(networkKey, 'json')).items[k];
      if (!inOwn && shared && isNetworkDraftPath(shared.path)) target = networkKey;
    }
  }

  const state = normalizeDrafts(await kv.get(target, 'json'));
  let next;
  try {
    if (payload?.op === 'put') next = applyDraftPut(state, payload.draft, now ? { now } : undefined);
    else if (payload?.op === 'delete') next = applyDraftDelete(state, { type: payload.type, slug: payload.slug });
    else return { status: 400, body: { error: 'bad_request', message: 'op must be put or delete' } };
  } catch (err) {
    if (err instanceof DraftError) return { status: 400, body: { error: 'invalid', message: err.message } };
    throw err;
  }
  await kv.put(target, JSON.stringify(next));
  return { status: 200, body: { ok: true, drafts: await listFor() } };
}

/** SOW-024 right-to-erasure: hard-delete a member's draft store. */
export async function eraseMemberDrafts(env, githubId, { kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return { ok: false, error: 'the draft store is not configured' };
  const key = DRAFTS_KEY(String(githubId));
  await kv.delete(key);
  return { ok: true, key };
}
