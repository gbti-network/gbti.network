// sow-428: a member's GBTI name is their FOLDER (members/<folder>/), and it can differ from their GitHub login. The
// members index (house/members-index.yml, github_id -> folder) is the one record of it. The publish path already
// reads the index live on every write (membership-author.mjs), because it authorizes a write. The routes here only
// need to NAME the caller's folder (the status oracle, the caller's own shares, a Discord mention), so they share
// one short-lived copy instead of reading GitHub on every page view.
//
// A folder is never guessed from a login when the index answers. When the index cannot be read at all, the caller's
// lowercased login is the fallback, which is exactly what enrollment writes for every member whose name was not
// changed by hand, so an outage leaves an ordinary member untouched.
import { parseMembersIndex } from '../../membership/hosted-author.mjs';
import { getInstallationToken } from './github-app.mjs';

const GH = 'https://api.github.com';
export const MEMBERS_INDEX_TTL_MS = 5 * 60 * 1000;

let memo = null; // { at, upstream, map }

/** Test seam: forget the cached copy. */
export function resetMemberFolderCache() { memo = null; }

/**
 * The members index as a Map<github_id, folder>, cached for MEMBERS_INDEX_TTL_MS. Throws when it cannot be read
 * and there is no earlier copy; an earlier copy, however old, is preferred to nothing.
 */
export async function readMembersIndexCached(env, { fetchImpl = globalThis.fetch, kv = env?.SIGNUP_KV, getToken = getInstallationToken, now = Date.now } = {}) {
  const upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network';
  const t = now();
  if (memo && memo.upstream === upstream && t - memo.at < MEMBERS_INDEX_TTL_MS) return memo.map;
  try {
    const token = await getToken(env, { fetchImpl, kv });
    const res = await fetchImpl(`${GH}/repos/${upstream}/contents/house/members-index.yml?ref=main`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' },
    });
    if (!res || !res.ok) throw new Error(`members index ${res ? res.status : 'no response'}`);
    const data = await res.json();
    const map = parseMembersIndex(atob(String(data?.content || '').replace(/\n/g, '')));
    // An empty parse is a failed read (the index always holds members), never "nobody is enrolled".
    if (!map.size) throw new Error('members index parsed empty');
    memo = { at: t, upstream, map };
    return map;
  } catch (e) {
    if (memo && memo.upstream === upstream) return memo.map;
    throw e;
  }
}

/** The caller's folder: their index entry, else their lowercased login. Never throws. */
export async function memberFolderFor(env, githubId, login, deps = {}) {
  try {
    const folder = (await readMembersIndexCached(env, deps)).get(String(githubId ?? ''));
    if (folder) return folder;
  } catch { /* fall back to the login below */ }
  const lg = String(login || '').trim().toLowerCase();
  return lg || null;
}

/** The github_id that owns a folder, or null when the index has no such folder or cannot be read. Never throws. */
export async function githubIdForFolder(env, folder, deps = {}) {
  const want = String(folder || '').trim().toLowerCase();
  if (!want) return null;
  try {
    for (const [id, f] of await readMembersIndexCached(env, deps)) if (f === want) return id;
  } catch { /* unknown */ }
  return null;
}
