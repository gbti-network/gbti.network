// SOW-087: the PURE content-channels edit core. Given the PARSED house/content-channels.yml
// ({ channels: [{ category, channelId }] }) plus an action, each function returns { next, changed, audit } —
// `next` is the new parsed doc (the caller serializes + commits it via the SOW-005 PR flow), `changed` is false
// when the action is already satisfied (idempotent), and `audit` is an identity-minimal log entry folded into
// the PR body. Node-free (no fs / no yaml), like news-source-edits.mjs.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (the file is
// superadmin-owned) + no-bypass branch protection + the metadata-only gate. A non-superadmin PR touching
// house/content-channels.yml is auto-rejected regardless of what this computes.

export class ContentChannelEditError extends Error {}

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case, matching topic + taxonomy keys
const CHANNEL_ID_RE = /^[0-9]{5,25}$/; // a numeric Discord channel id

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new ContentChannelEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, action, category, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { category },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!Array.isArray(d.channels)) d.channels = [];
  return d;
}

/** UPSERT a category -> channelId mapping. Idempotent: mapping the same pair again is a no-op. */
export function setChannel(doc, { category, channelId } = {}, ctx = {}) {
  const d = clean(doc);
  const cat = String(category || '').trim().toLowerCase();
  const ch = String(channelId || '').trim();
  if (!KEY_RE.test(cat)) throw new ContentChannelEditError('the category must be a kebab-case key (a topic key or a top-level taxonomy key)');
  if (!CHANNEL_ID_RE.test(ch)) throw new ContentChannelEditError('the channelId must be a numeric Discord channel id');
  const existing = d.channels.find((e) => String(e?.category || '').trim().toLowerCase() === cat);
  if (existing) {
    if (String(existing.channelId ?? '').trim() === ch) return { next: d, changed: false, audit: auditEntry(ctx, 'content-channel.set', cat, { channelId: ch, noop: true }) };
    existing.channelId = ch;
    return { next: d, changed: true, audit: auditEntry(ctx, 'content-channel.set', cat, { channelId: ch, updated: true }) };
  }
  d.channels.push({ category: cat, channelId: ch });
  d.channels.sort((a, b) => String(a.category).localeCompare(String(b.category)));
  return { next: d, changed: true, audit: auditEntry(ctx, 'content-channel.set', cat, { channelId: ch }) };
}

/** REMOVE a category mapping (its items then only post to the featured per-type channel). */
export function removeChannel(doc, { category } = {}, ctx = {}) {
  const d = clean(doc);
  const cat = String(category || '').trim().toLowerCase();
  const i = d.channels.findIndex((e) => String(e?.category || '').trim().toLowerCase() === cat);
  if (i < 0) throw new ContentChannelEditError(`no channel mapping for category: ${cat}`);
  d.channels.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'content-channel.remove', cat, null) };
}
