// SOW-018: pure planning for syndicating member Shares to Discord. PUBLIC published Shares are broadcast to
// the co-op Shares channel; members-only Shares are NEVER syndicated (their body is encrypted and must not be
// posted in plaintext). Best-effort + idempotent: a Share is posted at most once, tracked by id in a state
// list (house/shares-syndicated.yml). Pure (no network/fs), so the planner + message format are unit-tested;
// the runner (scripts/syndicate-shares.mjs) wires the reader, the state file, and the Discord client.

const DISCORD_MAX = 2000; // Discord message content hard limit
const SNIPPET = 280;

/** Discord message text for a public Share. Truncates the body; never includes a members body (caller filters). */
export function formatShareMessage(share, nameOf = (a) => a) {
  const who = (typeof nameOf === 'function' ? nameOf(share.author) : null) || share.author || 'A member';
  const title = share.title ? `**${String(share.title).trim()}**\n` : '';
  const raw = String(share.body ?? '').trim();
  const body = raw.length > SNIPPET ? raw.slice(0, SNIPPET - 1).trimEnd() + '…' : raw;
  const link = share.url ? `\n${share.url}` : '';
  const msg = `📣 New Share from ${who}\n${title}${body}${link}`.trim();
  return msg.length > DISCORD_MAX ? msg.slice(0, DISCORD_MAX - 1) + '…' : msg;
}

/**
 * Plan which Shares to syndicate. Input `shares` is the feed-summary list (any order). Returns:
 *   { toPost }      PUBLIC + published Shares not yet syndicated, OLDEST-FIRST (so the channel reads
 *                   chronologically), capped at `limit`.
 *   { syndicated }  the updated id list = the prior set PLUS the toPost ids (so a re-run is a no-op).
 * A members Share is excluded (no plaintext to Discord); a draft is excluded; a missing/duplicate id is skipped.
 */
export function planShareSyndication({ shares = [], syndicated = [], limit = 50 } = {}) {
  const prior = (syndicated ?? []).map(String);
  const seen = new Set(prior);
  const eligible = (shares ?? []).filter(
    (s) => s && s.status === 'published' && s.visibility === 'public' && s.id && !seen.has(String(s.id)),
  );
  // De-dup within this batch (a malformed input could repeat an id) and order OLDEST-FIRST. Key on createdAt
  // ONLY with a deterministic id tie-break (mirroring byShareNewest, inverted) — never fold the raw id into the
  // primary key, or an undated share (id is a timestamp-slug, not an ISO string) would mis-sort against dated ones.
  const byId = new Map();
  for (const s of eligible) if (!byId.has(String(s.id))) byId.set(String(s.id), s);
  const ordered = [...byId.values()].sort((a, b) => {
    const t = String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));
    return t !== 0 ? t : String(a.id ?? '').localeCompare(String(b.id ?? ''));
  });
  const toPost = ordered.slice(0, Math.max(0, limit));
  return { toPost, syndicated: [...prior, ...toPost.map((s) => String(s.id))] };
}
