// sow-346: the one way a host reads the signed-in member's own profile.
//
// THE STATE IS THE POINT. Anything that acts on "there is no profile" (the welcome step creates one, the profile
// editor starts a blank one) must be able to tell a profile that does not exist from a read that failed, or a slow
// or refused read becomes a blank profile saved over a real one. So:
//   found   the profile was read; `item` holds it
//   absent  the read ANSWERED "not found" (the host's error code), and nothing else
//   failed  anything else: no identity, a thrown read, a host that answered nothing
//
// The website lists no profile type (its listing is index-driven), so the member's own path is the fallback; a
// member folder is named by username. Four surfaces used to do this four slightly different ways.

/** @returns {Promise<{ state: 'found'|'absent'|'failed', path: string|null, item: {path, frontmatter, body}|null }>} */
export async function readOwnProfile(client, { identity } = {}) {
  if (!client?.getContentItem) return { state: 'failed', path: null, item: null };
  let who = identity;
  if (who === undefined) {
    try { who = (await client.status())?.identity ?? null; } catch { who = null; }
  }
  let listed = null;
  try { listed = (await client.listContent?.({ type: 'profile' }))?.items?.[0]?.path || null; } catch { listed = null; }
  const name = who?.username || who?.login || '';
  const path = listed || (name ? `members/${name}/profile.md` : null);
  if (!path) return { state: 'failed', path: null, item: null };
  try {
    const item = await client.getContentItem({ path });
    if (!item) return { state: 'failed', path, item: null }; // a host that answered nothing has not said "absent"
    return { state: 'found', path, item: { path, frontmatter: item.frontmatter || {}, body: item.body || '' } };
  } catch (e) {
    return { state: e?.code === 'not-found' ? 'absent' : 'failed', path, item: null };
  }
}
