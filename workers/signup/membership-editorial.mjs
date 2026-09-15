// sow-323 Phase 3: the EDITORIAL REVIEW QUEUE, Worker side. Three surfaces and one commit:
//   - a member publishes a members-only article, project or prompt, and a record is written (the caller emails
//     the owner about what was stored);
//   - a superadmin lists what is waiting;
//   - a superadmin approves (which makes the item public in one commit) or dismisses it (silent, owner's rule).
//
// THE RECORD IS WRITTEN BEFORE THE PULL REQUEST OPENS (the publish routes call recordEditorialItems first and
// refuse the publish if the write fails). The other order loses items: a publish that merges with no record is
// an item waiting for review that nothing lists, and nobody would ever know. A record whose publish then fails
// is the harmless direction: approving it answers "not on the site yet", and a superadmin can dismiss it.
//
// APPROVAL IS DONE HERE rather than in the editor, because the editor's make-public path carried three defects
// a server-side approval cannot have (see membership/editorial-approve.mjs): the locked-page flag left beside
// public, the orphaned ciphertext, and the restamped date. The Worker holds the content key, so it can decrypt
// the members-only body, put the item back together and commit it.
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { applyFile } from './membership-admin-files.mjs';
import { adminHostedBranchFor } from '../../membership/hosted-author.mjs';
import { resolveEpochKey } from './membership-content.mjs';
import { decryptAssetText, encryptAsset } from '../../client/src/crypto-assets.mjs';
import { parseContentFile, serializeContentFile } from '../../client/src/content-ops.mjs';
import { encAssetFor } from '../../client/src/member-content.mjs';
import { planApproval } from '../../membership/editorial-approve.mjs';
import { readEditorialEntry } from './editorial-records.mjs'; // the writes live there: both publish routes call them
import {
  EDITORIAL_KEY_PREFIX, EDITORIAL_STATE, editorialKey, entryState, newEntry, decideEntry,
  canDecide, sortEntries, reviewableItem, itemUrl,
} from '../../membership/editorial-queue.mjs';

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const bad = (status, error, message) => ({ status, body: { ok: false, error, message } });

/** GET /membership/admin/editorial -> the queue, waiting first. Superadmin only. */
export async function editorialList(request, env, { authorize = authorizeSuperadmin, ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  const names = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: EDITORIAL_KEY_PREFIX, cursor });
    for (const k of page?.keys ?? []) names.push(k.name);
    cursor = page?.list_complete ? null : page?.cursor;
  } while (cursor);

  const items = [];
  for (const name of names) {
    const path = name.slice(EDITORIAL_KEY_PREFIX.length);
    const rec = await readEditorialEntry(kv, path);
    const state = entryState(rec);
    // A record that parses but is STRUCTURALLY BAD is kept and flagged, following the applications lane:
    // dropping it would make a corrupt record invisible to the only surface that could notice it. It is not
    // decidable, so nothing is ever published off the back of whatever identity the broken record carries.
    if (state === EDITORIAL_STATE.unknown) {
      items.push({ ...(rec ?? {}), path, key: name, state, corrupt: true });
      continue;
    }
    items.push({ ...rec, state, url: itemUrl(rec.type, rec.slug, env?.SITE_ORIGIN) });
  }
  return { status: 200, body: { ok: true, items: sortEntries(items) } };
}

/** Read a file from main as raw text. Returns null when it is not there (or unreadable). */
async function readMain(fetchImpl, instToken, upstream, path) {
  try {
    const r = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, {
      headers: { ...GH_HEADERS(instToken), Accept: 'application/vnd.github.raw' },
    });
    if (!r || r.status !== 200) return null;
    return await r.text();
  } catch { return null; }
}

/**
 * The files an approval commits, with the members-only body decrypted, the item reassembled, and a section the
 * author marked members-only re-encrypted so it stays gated. Returns `{ files }`, `{ alreadyPublic: true }`, or
 * `{ error }` (a message, and never a key or a fragment of plaintext).
 */
export async function buildApproval(env, { item, indexText, encText }) {
  const { frontmatter, body } = parseContentFile(indexText);
  let memberText = '';
  if (encText) {
    let envelope;
    try { envelope = JSON.parse(encText); } catch { return { error: 'the members-only body could not be read' }; }
    const key = resolveEpochKey(env, String(envelope?.kid ?? env?.MEMBER_CONTENT_KID ?? '1'));
    if (!key) return { error: 'the members-only body was encrypted with a key this Worker does not hold' };
    try { memberText = await decryptAssetText({ envelope, key }); } catch { return { error: 'the members-only body could not be decrypted' }; }
  }

  const plan = planApproval({ frontmatter, indexBody: body, memberText });
  if (plan.alreadyPublic) return { alreadyPublic: true };

  if (plan.gated) {
    // A public page with a members-only section (SOW-016 Mode C): the ciphertext is rewritten under the
    // canonical path for this item, and a stale one at a different path is deleted rather than orphaned.
    const { assetId, path: encPath } = encAssetFor(item.type, item.login, item.slug);
    const kid = String(env?.MEMBER_CONTENT_KID || '1');
    const key = resolveEpochKey(env, kid);
    if (!key) return { error: 'the content key is not configured' };
    const envelope = await encryptAsset({ plaintext: plan.gated, key, assetId, kid });
    const files = [
      { path: item.path, content: serializeContentFile({ ...plan.frontmatter, encryptedBody: encPath }, plan.body) },
      { path: encPath, content: JSON.stringify(envelope) },
    ];
    if (plan.encPath && plan.encPath !== encPath) files.push({ path: plan.encPath, content: null });
    return { files };
  }

  const files = [{ path: item.path, content: serializeContentFile(plan.frontmatter, plan.body) }];
  if (plan.removeEnc && plan.encPath) files.push({ path: plan.encPath, content: null }); // the whole item is public now
  return { files };
}

/** Commit the approval on a hosted-admin branch and open its pull request, which the gate auto-merges. */
async function commitApproval(fetchImpl, instToken, upstream, { githubId, slug, files }) {
  const branch = adminHostedBranchFor(githubId, `editorial-${slug}`.slice(0, 80));
  if (!branch) return { ok: false, status: 500, message: 'could not build the approval branch' };
  const main = await fetchImpl(`${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainData = await main.json().catch(() => ({}));
  const mainSha = mainData?.object?.sha;
  if (!main.ok || !mainSha) return { ok: false, status: 502, message: 'could not read the main branch' };
  const create = await fetchImpl(`${GH}/repos/${upstream}/git/refs`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!create.ok) {
    if (create.status !== 422) return { ok: false, status: 502, message: 'could not create the approval branch' };
    const reset = await fetchImpl(`${GH}/repos/${upstream}/git/refs/heads/${branch}`, {
      method: 'PATCH', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: mainSha, force: true }),
    });
    if (!reset.ok) return { ok: false, status: 502, message: 'could not reset the approval branch' };
  }
  for (const f of files) {
    const applied = await applyFile(fetchImpl, instToken, upstream, branch, f);
    if (!applied.ok) return { ok: false, status: 502, message: `could not write ${f.path}` };
  }
  const pr = await fetchImpl(`${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: `Editorial approval: ${slug}`.slice(0, 256),
      head: branch,
      base: 'main',
      maintainer_can_modify: false,
      body: `Approved for the public site by github_id ${githubId} through the editorial review queue (sow-323).`,
    }),
  });
  if (pr.status === 422) return { ok: true, number: null, html_url: null, already: true };
  const prData = await pr.json().catch(() => ({}));
  if (!pr.ok) return { ok: false, status: 502, message: `GitHub returned ${pr.status}` };
  return { ok: true, number: prData.number, html_url: prData.html_url };
}

/**
 * POST /membership/admin/editorial -> { path, decision: 'approve' | 'dismiss' }. Superadmin only.
 *
 * Approve reads the item from main, makes it public in one commit and then records the decision. Dismiss
 * records the decision and does nothing else: the item stays members-only and its author is not told (owner,
 * 2026-09-15). The commit goes first for the same reason the tier grant precedes the application record: a
 * failure between the two halves leaves the item waiting and a second approval redoes the same commit, where
 * the other order would mark it approved with nothing published.
 */
export async function editorialDecide(request, env, deps = {}) {
  const {
    authorize = authorizeSuperadmin, fetchImpl = globalThis.fetch, now = new Date(), notifyAuthor = null,
    getToken = getInstallationToken, // injected so the commit order is assertable without an App key
  } = deps;
  const upstream = deps.upstream || env?.UPSTREAM_REPO || 'gbti-network/gbti.network';
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  const kv = env?.SIGNUP_KV;
  if (!kv) return bad(503, 'unavailable', 'the edge store is not reachable right now');

  let payload;
  try { payload = await request.json(); } catch { payload = null; }
  const decision = String(payload?.decision ?? '').trim();
  if (decision !== 'approve' && decision !== 'dismiss') return bad(400, 'bad_request', 'decision must be approve or dismiss');
  // The item is read from the PATH alone, so nothing else the caller sends can retarget another item.
  const item = reviewableItem(String(payload?.path ?? ''));
  if (!item) return bad(400, 'bad_request', 'path must be a member article, project or prompt');

  const existing = await readEditorialEntry(kv, item.path);
  if (decision === 'dismiss') {
    if (!existing || entryState(existing) === EDITORIAL_STATE.unknown) return bad(404, 'not_found', 'nothing is waiting for review at that path');
    if (!canDecide(existing, 'dismiss')) return bad(409, 'not_pending', `this item is already ${entryState(existing)}`);
    const rec = decideEntry(existing, { decision, githubId: auth.githubId, login: auth.login ?? null, now });
    try { await kv.put(editorialKey(item.path), JSON.stringify(rec)); }
    catch { return bad(503, 'unavailable', 'the decision could not be saved; please try again'); }
    return { status: 200, body: { ok: true, item: rec } };
  }

  // A corrupt record cannot be decided, but a MISSING one can be approved: a superadmin's own members-only item
  // never entered the queue, and approval has to work for it too.
  if (existing && !canDecide(existing, 'approve')) {
    const state = entryState(existing);
    return bad(409, state === EDITORIAL_STATE.unknown ? 'corrupt' : 'already_approved', `this item is ${state}, so there is no approval left to make`);
  }

  let instToken;
  try { instToken = await getToken(env, deps); }
  catch { return bad(500, 'misconfigured', 'the publishing app is not configured'); }

  const indexText = await readMain(fetchImpl, instToken, upstream, item.path);
  if (indexText == null) {
    return bad(409, 'not_on_main', 'this item is not on the site yet: the publish is still merging. Try again in a minute.');
  }
  const encPath = parseContentFile(indexText)?.frontmatter?.encryptedBody;
  const hasEnc = typeof encPath === 'string' && encPath.length > 0;
  const encText = hasEnc ? await readMain(fetchImpl, instToken, upstream, encPath) : null;
  if (hasEnc && encText == null) return bad(502, 'git_failed', 'the members-only body could not be read from the site');

  const built = await buildApproval(env, { item, indexText, encText });
  if (built.error) return bad(500, 'approval_failed', built.error);
  let pr = { number: null, html_url: null };
  if (!built.alreadyPublic) {
    const done = await commitApproval(fetchImpl, instToken, upstream, { githubId: auth.githubId, slug: item.slug, files: built.files });
    if (!done.ok) return bad(done.status ?? 502, 'git_failed', done.message);
    pr = done;
  }

  const base = existing ?? newEntry({ ...item, githubId: null, title: item.slug, now });
  const rec = decideEntry(base, { decision: 'approve', githubId: auth.githubId, login: auth.login ?? null, now });
  try { await kv.put(editorialKey(item.path), JSON.stringify(rec)); }
  catch { return bad(503, 'unavailable', 'the item was published, but the decision could not be saved'); }

  // The author is told about APPROVALS only (owner, 2026-09-15). Fail-soft and AFTER the record, exactly as the
  // owner alert is: a lost email costs the author the news, never the approval.
  if (typeof notifyAuthor === 'function') {
    try { await notifyAuthor(rec); } catch { /* fail-soft */ }
  }
  return {
    status: 200,
    body: { ok: true, item: rec, alreadyPublic: built.alreadyPublic === true, number: pr.number ?? null, html_url: pr.html_url ?? null },
    record: rec,
  };
}
