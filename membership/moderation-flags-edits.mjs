// SOW-087: the PURE moderation-flags edit core. Given the PARSED house/moderation-flags.yml
// ({ lists: { political: [...], profanity: [...] } }) plus an action, each function returns
// { next, changed, audit } (the news-source-edits shape). Terms are matched case-insensitively for
// idempotency; a list name must already exist or be one of the seed lists (a typo must not silently create a
// new list). Node-free (no fs / no yaml).
//
// SECURITY: this only COMPUTES the file edit. CODEOWNERS (superadmin-owned) + the gate are the real boundary.

export class ModerationFlagEditError extends Error {}

const LIST_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_TERM = 64;

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new ModerationFlagEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, action, list, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { list },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.lists || typeof d.lists !== 'object' || Array.isArray(d.lists)) d.lists = {};
  for (const [name, terms] of Object.entries(d.lists)) {
    if (!Array.isArray(terms)) d.lists[name] = [];
  }
  return d;
}

const normTerm = (t) => String(t || '').replace(/\s+/g, ' ').trim();

function requireListAndTerm(d, list, term) {
  const name = String(list || '').trim();
  if (!LIST_RE.test(name)) throw new ModerationFlagEditError('the list name must be kebab-case');
  if (!(name in d.lists)) throw new ModerationFlagEditError(`no such flag list: ${name} (lists: ${Object.keys(d.lists).join(', ') || 'none'})`);
  const t = normTerm(term);
  if (!t) throw new ModerationFlagEditError('a non-empty term is required');
  if (t.length > MAX_TERM) throw new ModerationFlagEditError(`a term is capped at ${MAX_TERM} characters`);
  return { name, t };
}

/** ADD a term to a list. Idempotent (case-insensitive): re-adding is a no-op. */
export function addFlagTerm(doc, { list, term } = {}, ctx = {}) {
  const d = clean(doc);
  const { name, t } = requireListAndTerm(d, list, term);
  if (d.lists[name].some((x) => normTerm(x).toLowerCase() === t.toLowerCase())) {
    return { next: d, changed: false, audit: auditEntry(ctx, 'flag-term.add', name, { term: t, noop: true }) };
  }
  d.lists[name].push(t);
  d.lists[name].sort((a, b) => String(a).localeCompare(String(b)));
  return { next: d, changed: true, audit: auditEntry(ctx, 'flag-term.add', name, { term: t }) };
}

/** REMOVE a term from a list (case-insensitive). */
export function removeFlagTerm(doc, { list, term } = {}, ctx = {}) {
  const d = clean(doc);
  const { name, t } = requireListAndTerm(d, list, term);
  const i = d.lists[name].findIndex((x) => normTerm(x).toLowerCase() === t.toLowerCase());
  if (i < 0) throw new ModerationFlagEditError(`term not in ${name}: ${t}`);
  d.lists[name].splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'flag-term.remove', name, { term: t }) };
}
