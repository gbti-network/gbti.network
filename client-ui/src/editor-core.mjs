// SOW-184: pure, node-free helpers for the WorkBench content editor's sidebar (design handoff 3a). The editor
// element (gbti-content-editor.mjs) imports GbtiElement, which is browser-only, so it cannot be unit-tested under
// node. These two descriptors are the parts of the rail that are worth testing, kept here so test/editor-core.test.mjs
// can exercise them without a DOM. No imports, no side effects.

/** ISO date (YYYY-MM-DD) from a date-ish value, or '' when empty or unparseable. Mirrors the element's own fmtD. */
export function fmtDate(value) {
  if (!value) return '';
  const t = new Date(value);
  return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10);
}

/**
 * SOW-184: the Status card descriptor for the editor rail. A staged draft carries status: 'published' BY
 * DESIGN (the "draft" is where it is kept, not a draft status -- see gbti-content-editor render()), so the
 * `staged` flag WINS over the status field, exactly as the doc-slug meta does.
 * @param {{ staged?: boolean, status?: string, publishedAt?: string }} item
 * @returns {{ label: string, tone: 'live'|'staged'|'draft', publishedLabel: string }}
 */
export function editorStatus({ staged = false, status = '', publishedAt = '' } = {}) {
  if (staged) return { label: 'Staged draft', tone: 'staged', publishedLabel: '' };
  if (String(status).toLowerCase() === 'published') {
    return { label: 'Live', tone: 'live', publishedLabel: fmtDate(publishedAt) };
  }
  return { label: 'Draft', tone: 'draft', publishedLabel: '' };
}

// The image field(s) the Media rail section shows per type, plus the noun to summarize them with. Kept in lockstep
// with RAIL_SCHEMA's Media section keys in gbti-content-editor.mjs. Post has one true cover; product's Media holds
// icon + featuredImage + banner; prompt has one image.
const MEDIA_FIELDS = {
  post: { keys: ['coverImage'], one: 'cover', many: 'covers' },
  project: { keys: ['icon', 'featuredImage', 'banner'], one: 'image', many: 'images' },
  prompt: { keys: ['image'], one: 'image', many: 'images' },
};

/** True when a preset field holds a real value (a non-empty string, or a non-empty array). */
export function hasValue(v) {
  if (v == null) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim() !== '';
}

/**
 * SOW-184: the at-a-glance summary shown on the Media rail section's header (the mockup's "1 cover" hint). Counts
 * the set image fields for the type's Media section. Returns '' for an unknown type or when nothing is set, so the
 * header simply shows no hint.
 * @returns {string} e.g. '1 cover', '2 images', or ''
 */
export function mediaSummary(type, preset = {}) {
  const spec = MEDIA_FIELDS[type];
  if (!spec) return '';
  const n = spec.keys.reduce((acc, k) => acc + (hasValue(preset[k]) ? 1 : 0), 0);
  if (!n) return '';
  return `${n} ${n === 1 ? spec.one : spec.many}`;
}

// sow-477 (owner, 2026-10-24): a publish that MOVES an item (a change of author or of permalink) takes about 25
// seconds to land on main, and every publish works out its file set against main. A second publish inside that
// window finds neither the item nor its pictures at the new path, so it refused with "the image ... is no longer
// staged". Letting it through would be worse: the Worker rebuilds an open publish's branch from main using the
// newest request alone (hosted-commit.mjs), so a second save would undo the move and leave two copies. The editor
// therefore waits for its own move to land before it publishes again.

/** The path a publish moved the item to, or null when it moved nothing (a plain edit, a new item). */
export function landingPath(res) {
  if (!res || !(res.reassigned || res.renamed)) return null;
  return typeof res.path === 'string' && res.path ? res.path : null;
}

export const LANDING_INTERVAL_MS = 3000;
export const LANDING_LIMIT_MS = 90000;

/**
 * Re-read `path` until it is there. 'landed' once a read returns the item; 'timeout' when it is still not found
 * after limitMs (no read is made past the limit); 'unknown' when a read fails for any reason other than not-found,
 * because waiting cannot fix that and the publish's own checks report it better. `sleep` is injected for tests.
 */
export async function waitForLanding({ read, path, intervalMs = LANDING_INTERVAL_MS, limitMs = LANDING_LIMIT_MS, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  let waited = 0;
  for (;;) {
    try {
      if (await read(path)) return 'landed';
    } catch (e) {
      if (e?.code !== 'not-found') return 'unknown';
    }
    if (waited + intervalMs > limitMs) return 'timeout';
    await sleep(intervalMs);
    waited += intervalMs;
  }
}
