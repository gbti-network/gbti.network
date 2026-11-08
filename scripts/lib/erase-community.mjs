// sow-494: erase a member's Community data. It lives in one SQLite Durable Object behind the signup Worker, which no
// KV or GitHub credential this script holds can reach: only the Worker's superadmin route can, and that route verifies
// a superadmin's OWN GitHub token. The erasure runs locally (npm run erase-member reads .env), so the operator passes
// theirs for the run, for example `GBTI_SUPERADMIN_GITHUB_TOKEN=$(gh auth token) npm run erase-member -- ... --apply`.
//
// What the Worker op does (CommunityStore.eraseMember): deletes the member's answers, reactions, uploaded images and
// access grants; turns their posts into removed placeholders (deleted outright when nothing replies to them); and
// blanks their name and id on what stays, so the thread still reads and names nobody.
//
// WITHOUT A TOKEN THE STEP IS `incomplete`, NOT `skipped`. A skip reads as "nothing to do"; here the records were
// never looked at, so the audit must say the erasure did not finish.

export const COMMUNITY_ERASE_ROUTE = '/membership/admin/community';
export const COMMUNITY_TOKEN_ENV = 'GBTI_SUPERADMIN_GITHUB_TOKEN';

export async function eraseCommunity({ githubId, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (!githubId) throw new Error('a github_id is required');
  const token = String(env?.[COMMUNITY_TOKEN_ENV] || '').trim();
  if (!token) {
    return { incomplete: true, reason: `Community not erased: set ${COMMUNITY_TOKEN_ENV} to a superadmin's GitHub token (gh auth token) and run again` };
  }
  const base = String(env?.GBTI_SIGNUP_BASE || 'https://signup.gbti.network').replace(/\/$/, '');
  const res = await fetchImpl(base + COMMUNITY_ERASE_ROUTE, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'erase-member', githubId: String(githubId) }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  if (!res.ok) return { error: `Community erase refused (${res.status}): ${data?.message || data?.error || 'no reason given'}` };
  const counts = ['answers', 'reactions', 'posts', 'images', 'grants'].map((k) => Number(data?.[k]) || 0);
  const total = counts.reduce((a, b) => a + b, 0);
  return total ? { deleted: true } : { deleted: false, reason: 'nothing in Community' };
}
