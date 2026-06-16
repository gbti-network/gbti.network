// The client read path for the on-demand Discord invite, via the signup Worker's GET /membership/discord-invite.
// Mirrors member-follows-client.mjs: a thin, injectable-fetch wrapper that sends the GitHub bearer token. The bot
// mints the invite in the Worker (token never reaches the client); this just fetches the resulting URL. The
// welcome view falls back to the static DISCORD_INVITE_URL when this is unavailable. Unit-tested with a fake fetch.

const trimBase = (signupBase) => String(signupBase || '').replace(/\/$/, '');

export class InviteClientError extends Error {}

/** Fetch a fresh-or-cached Discord invite ({ ok, url, source }) for the signed-in member. */
export async function getDiscordInvite({ token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new InviteClientError('not signed in');
  const res = await fetch(trimBase(signupBase) + '/membership/discord-invite', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) throw new InviteClientError(data?.message || data?.error || `invite request failed (${res.status})`);
  return data;
}
