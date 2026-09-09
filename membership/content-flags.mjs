// sow-189: the PURE content-flags core over the parsed house/content-flags.yml. Node-free (no fs, no yaml), so
// the site build, the admin write path, the sitemap filter and the tests all share one reading of the file.
//
//   { flags: { "post:<slug>": { stale?: true, unindexed?: true, at, by, reason? } } }
//
// setContentFlag returns { next, changed, audit } in the superadmin-actions shape; the caller writes the file
// through the PR flow. SECURITY: this only COMPUTES the edit. CODEOWNERS and the gate are the boundary.

export class ContentFlagEditError extends Error {}

export const CONTENT_FLAGS = Object.freeze(['stale', 'unindexed']);
export const KEY_RE = /^(post|project|prompt):[a-z0-9][a-z0-9-]*$/;
const TYPE_OF_DIR = { posts: 'post', projects: 'project', prompts: 'prompt' };

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new ContentFlagEditError('invalid timestamp');
  return d.toISOString();
}

/** The parsed file, cleaned: a plain object of key -> entry, junk dropped. */
export function contentFlagsFromParsed(parsed) {
  const out = {};
  const src = parsed && typeof parsed === 'object' && parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
  for (const [key, v] of Object.entries(src)) {
    if (!KEY_RE.test(key) || !v || typeof v !== 'object') continue;
    const e = {};
    for (const f of CONTENT_FLAGS) if (v[f] === true) e[f] = true;
    if (!Object.keys(e).length) continue; // an entry with no flag set is noise
    if (v.at) e.at = String(v.at);
    if (v.by) e.by = String(v.by);
    if (v.reason) e.reason = String(v.reason);
    out[key] = e;
  }
  return out;
}

/** The key for an item: `post:<slug>`. */
export const flagKey = (type, slug) => `${type}:${slug}`;

/** The flags on one item, `{ stale, unindexed }` booleans, from a cleaned map. */
export function flagsFor(flags, type, slug) {
  const e = (flags && flags[flagKey(type, slug)]) || {};
  return { stale: e.stale === true, unindexed: e.unindexed === true };
}

/** `post:<slug>` from a member content path, or null when the path is not one. */
export function flagKeyForPath(path) {
  const m = /^(?:members\/[A-Za-z0-9_-]+|house)\/(posts|projects|prompts)\/([a-z0-9][a-z0-9-]*)\/index\.md$/.exec(String(path || ''));
  return m ? flagKey(TYPE_OF_DIR[m[1]], m[2]) : null;
}

/** The site paths the sitemap must drop: every unindexed article. Articles only in v1 (the key carries the type). */
export function sitemapExcludes(flags) {
  const out = new Set();
  for (const [key, e] of Object.entries(flags || {})) {
    if (e.unindexed !== true) continue;
    const [type, slug] = key.split(':');
    if (type === 'post') out.add(`/articles/${slug}/`);
  }
  return out;
}

function audit(ctx, action, key, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { key },
    detail: detail ?? null,
  };
}

/**
 * Set or clear one flag on one item. Idempotent: setting a flag already set (or clearing one already clear)
 * returns changed:false. An entry with no flag left is removed from the file.
 */
export function setContentFlag(parsed, { key, flag, on = true, reason } = {}, ctx = {}) {
  const k = String(key || '');
  if (!KEY_RE.test(k)) throw new ContentFlagEditError('key must be <post|project|prompt>:<slug>');
  if (!CONTENT_FLAGS.includes(flag)) throw new ContentFlagEditError(`flag must be one of ${CONTENT_FLAGS.join(', ')}`);
  const flags = contentFlagsFromParsed(parsed);
  const cur = flags[k] || {};
  const already = cur[flag] === true;
  const action = `content.${on ? flag : 'un' + flag}`;
  if (on === already) return { next: { flags }, changed: false, audit: audit(ctx, action, k, { noop: true }) };
  const next = { ...cur };
  if (on) {
    next[flag] = true;
    next.at = isoOf(ctx?.now);
    if (ctx?.actor?.login) next.by = String(ctx.actor.login);
    else if (ctx?.actor?.githubId != null) next.by = String(ctx.actor.githubId);
    const r = String(reason || '').trim();
    if (r) next.reason = r.slice(0, 200);
  } else {
    delete next[flag];
  }
  const out = { ...flags };
  if (CONTENT_FLAGS.some((f) => next[f] === true)) out[k] = next; else delete out[k];
  return { next: { flags: out }, changed: true, audit: audit(ctx, action, k, reason ? { reason: String(reason).slice(0, 200) } : null) };
}
