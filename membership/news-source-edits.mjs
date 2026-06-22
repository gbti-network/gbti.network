// SOW-056 Phase 2: the PURE news-source-pool edit core. Given the PARSED house/news-sources.yml
// ({ sources: [{ id, name, url, description, enabled }] }) plus an action, each function returns
// { next, changed, audit } — `next` is the new parsed doc (the caller serializes + commits it via the SOW-005 PR
// flow, exactly like taxonomy-edits.mjs), `changed` is false when the action is already satisfied (idempotent), and
// `audit` is an identity-minimal log entry folded into the PR body. Node-free (no fs / no yaml) so it runs in the
// client, the Worker, and node tests.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (house/** is admin-owned) +
// no-bypass branch protection + the metadata-only gate, exactly like roles/bans/taxonomy edits. A non-admin PR
// touching house/news-sources.yml is auto-rejected regardless of what this computes.

export class NewsSourceEditError extends Error {}

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case, matching the discover-sources slug rule
const MAX_NAME = 80;
const MAX_DESC = 120;

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new NewsSourceEditError('invalid timestamp');
  return d.toISOString();
}
/** Identity-minimal audit entry (the SOW-024/038/055 shape), keyed by the source id rather than a github_id. */
function auditEntry(ctx, action, id, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { id },
    detail: detail ?? null,
  };
}

/** The site domain of a feed URL (used as the default, daily.dev-free description). '' when unparseable. */
export function hostOf(url) {
  try { return new URL(url).hostname; } catch { return String(url || '').replace(/^https?:\/\//i, '').split('/')[0] || ''; }
}

/** Derive a stable kebab id from a name (fallback to the URL host), capped. '' when nothing usable. */
export function slugify(name, url = '') {
  let s = String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!s) s = hostOf(url).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.slice(0, 60).replace(/-+$/g, '');
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!Array.isArray(d.sources)) d.sources = [];
  return d;
}
const normUrl = (u) => String(u || '').trim();

/**
 * ADD a source. `id` is optional (derived from name/host when absent). Idempotent: re-adding the same id+url is a
 * no-op; an id clash with a DIFFERENT url, or a duplicate url under a different id, is an error. New sources default
 * to enabled and get the bare domain as their description (our convention) unless one is supplied.
 */
export function addSource(doc, { id, name, url, description, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const nm = String(name || '').trim().slice(0, MAX_NAME);
  const u = normUrl(url);
  if (!nm) throw new NewsSourceEditError('a source name is required');
  if (!/^https?:\/\//i.test(u)) throw new NewsSourceEditError('a source needs an http(s) feed url');
  const sid = (typeof id === 'string' && id.trim()) ? id.trim() : slugify(nm, u);
  if (!ID_RE.test(sid)) throw new NewsSourceEditError('the source id must be kebab-case (lowercase letters, digits, single hyphens)');

  const byId = d.sources.find((s) => s.id === sid);
  const byUrl = d.sources.find((s) => normUrl(s.url) === u);
  if (byId) {
    if (normUrl(byId.url) === u) return { next: d, changed: false, audit: auditEntry(ctx, 'news-source.add', sid, { url: u, noop: true }) };
    throw new NewsSourceEditError(`a source "${sid}" already exists with a different url; pick another id`);
  }
  if (byUrl) throw new NewsSourceEditError(`that feed url is already in the pool as "${byUrl.id}"`);

  const desc = String(description ?? '').trim().slice(0, MAX_DESC) || hostOf(u);
  d.sources.push({ id: sid, name: nm, url: u, description: desc, enabled: enabled !== false });
  return { next: d, changed: true, audit: auditEntry(ctx, 'news-source.add', sid, { name: nm, url: u }) };
}

/** ENABLE / DISABLE a source (the preferred way to mute a noisy feed — kept for history). Idempotent. */
export function setSourceEnabled(doc, { id, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const sid = String(id || '').trim();
  const want = enabled !== false;
  const s = d.sources.find((x) => x.id === sid);
  if (!s) throw new NewsSourceEditError(`source not found: ${sid}`);
  if ((s.enabled !== false) === want) return { next: d, changed: false, audit: auditEntry(ctx, 'news-source.enable', sid, { enabled: want, noop: true }) };
  s.enabled = want;
  return { next: d, changed: true, audit: auditEntry(ctx, 'news-source.enable', sid, { enabled: want }) };
}

/** REMOVE a source outright (prefer setSourceEnabled(false) to keep history; remove is for genuinely bad entries). */
export function removeSource(doc, { id } = {}, ctx = {}) {
  const d = clean(doc);
  const sid = String(id || '').trim();
  const i = d.sources.findIndex((x) => x.id === sid);
  if (i < 0) throw new NewsSourceEditError(`source not found: ${sid}`);
  d.sources.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'news-source.remove', sid, null) };
}
