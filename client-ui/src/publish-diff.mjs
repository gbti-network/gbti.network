// sow-327: WHAT, EXACTLY, IS UNPUBLISHED? The editor's staged-draft banner says there are unpublished
// changes; this module answers the next question the owner asked, which is which ones.
//
// It is a real comparison, and that is the point. The banner itself is a flag: `staged` is one boolean
// written once at load, and the editor holds no copy of the committed file at all, which is why the old copy
// claiming the draft was "ahead of the live edge" was an unearned guess (sow-326). Everything here works on
// two frontmatter objects and two bodies handed in by the caller, so the element fetches the live item once,
// on demand, and this stays pure and node-testable.
//
// The body is compared BLOCK by block using the editor's own parser, not line by line. Two reasons: a
// paragraph is what an author sees as one thing, and a soft-wrapped paragraph has no stable line count, so a
// line diff reports rewraps as edits. Reusing `parseBlocks` also means an item's `index` IS the index of the
// block on screen, which is what lets the list scroll to it and flash it.
//
// Not to be confused with contrib-diff.mjs, which RENDERS a unified patch GitHub already computed for a
// contribution review. This one computes a diff locally because no server has ever seen the staged draft.
import { parseBlocks, serializeBlocks } from './markdown-blocks.mjs';

/**
 * Fields deliberately not listed, each for a different reason:
 *   updatedAt   is stamped at the publish, so it ALWAYS differs and listing it would bury the real changes
 *   publishedAt is resolved by the publish from the committed file, so the editor's copy decides nothing
 *   status      is forced to published by the publish, so a difference here is not a change the author made
 *   the rest    are machine-managed (ciphertext pointers, credits, the rename trail)
 */
export const IGNORED_FIELDS = Object.freeze(new Set([
  'updatedAt', 'publishedAt', 'status', 'encryptedBody', 'contributors', 'redirectFrom', 'author',
]));

/**
 * `author` is in that list for a different reason from the rest, and it is worth the sentence. A
 * reassignment is a REAL change worth listing, but it does not travel in the gathered frontmatter at all: it
 * rides as `authorTarget`, from the Author picker, and the committed file always carries `author`. Comparing
 * the two therefore reported "Author changed, was atwellpub, now empty" on every single item, always. The
 * caller passes the pending reassignment in explicitly instead, which is the only place that knows it.
 */
export function reassignmentChange({ from, to } = {}) {
  if (!to) return null;
  const label = (o) => (o?.scope === 'house' ? 'House / GBTI Network' : (o?.username || 'a member'));
  return { kind: 'field', key: 'author', label: 'Author', was: from ? label(from) : 'unchanged', now: label(to) };
}

/** Human labels, and the order the metadata changes are listed in. Anything unlisted sorts after, by key. */
export const FIELD_ORDER = Object.freeze([
  'title', 'slug', 'author', 'visibility', 'layout', 'excerpt', 'shortDescription', 'categories', 'tags',
  'coverImage', 'coverAlt', 'video', 'featured', 'publicStub', 'pricing', 'pricingUrl', 'links', 'gallery',
  'galleryStyle', 'sidebarPosition', 'bannerPreset', 'canonicalUrl',
]);

export const FIELD_LABELS = Object.freeze({
  title: 'Title', slug: 'Permalink', author: 'Author', visibility: 'Visibility', layout: 'Layout',
  excerpt: 'Excerpt', shortDescription: 'Short description', categories: 'Categories', tags: 'Tags',
  coverImage: 'Cover image', coverAlt: 'Cover image alt text', video: 'Video', featured: 'Featured',
  publicStub: 'Public stub', pricing: 'Pricing', pricingUrl: 'Pricing link', links: 'Links',
  gallery: 'Gallery', galleryStyle: 'Gallery layout', sidebarPosition: 'Sidebar position',
  bannerPreset: 'Banner style', canonicalUrl: 'Canonical URL',
});

/** A key with no label reads as a field name, spaced out, rather than as camelCase. */
export function fieldLabel(key) {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  const s = String(key || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

const BLOCK_NOUNS = {
  paragraph: 'Paragraph', heading: 'Heading', code: 'Code block', quote: 'Quote', list: 'List',
  table: 'Table', image: 'Image', embed: 'Embed', callout: 'Callout', members: 'Members-only divider',
};
export const blockNoun = (type) => BLOCK_NOUNS[type] || 'Block';

/** One comparable string for any value, so "absent", null and "" are one thing and array order still counts. */
function normalize(v) {
  if (v == null) return '';
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? '' : v.toISOString();
  if (Array.isArray(v)) return JSON.stringify(v.map((x) => normalize(x)));
  if (typeof v === 'object') {
    return JSON.stringify(Object.keys(v).sort().map((k) => [k, normalize(v[k])]));
  }
  // An ABSENT boolean and an explicit false are the same state here: every boolean in these schemas
  // defaults to false, and the editor's checkboxes always gather a value while a file usually omits the
  // field entirely. Without this collapse, "Featured changed, was empty, now no" appeared on every item that
  // had never been featured, which is the kind of noise that makes a change list stop being read.
  if (typeof v === 'boolean') return v ? 'true' : '';
  return String(v).trim();
}

export function sameValue(a, b) { return normalize(a) === normalize(b); }

/** Collapse to one readable line. `empty` is a caller-facing word, never an empty string in the UI. */
export function formatValue(v, { max = 120, empty = 'empty' } = {}) {
  if (v == null || v === '') return empty;
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) {
    const parts = v.map((x) => (x && typeof x === 'object' ? JSON.stringify(x) : String(x))).filter((s) => s !== '');
    return parts.length ? truncate(parts.join(', '), max) : empty;
  }
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? empty : v.toISOString().slice(0, 10);
  if (typeof v === 'object') return truncate(JSON.stringify(v), max);
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s ? truncate(s, max) : empty;
}

export function truncate(s, max = 120) {
  const str = String(s ?? '');
  return str.length > max ? `${str.slice(0, max - 1).trimEnd()}…` : str;
}

/** The first line of a block, flattened, for a one-line description of it. */
export function snippet(md, max = 120) {
  const first = String(md ?? '').split('\n').map((l) => l.trim()).find((l) => l !== '') || '';
  return truncate(first.replace(/\s+/g, ' '), max);
}

/**
 * Metadata differences between the committed file and what would be published, in FIELD_ORDER.
 * Keys are unioned from both sides, so a field ADDED in the draft and one REMOVED from it both surface.
 */
export function frontmatterChanges(live = {}, draft = {}) {
  const a = live && typeof live === 'object' ? live : {};
  const b = draft && typeof draft === 'object' ? draft : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => !IGNORED_FIELDS.has(k));
  const rank = (k) => { const i = FIELD_ORDER.indexOf(k); return i === -1 ? FIELD_ORDER.length : i; };
  keys.sort((x, y) => (rank(x) - rank(y)) || (x < y ? -1 : x > y ? 1 : 0));
  const out = [];
  for (const key of keys) {
    if (sameValue(a[key], b[key])) continue;
    out.push({ kind: 'field', key, label: fieldLabel(key), was: a[key], now: b[key] });
  }
  return out;
}

// The cost ceiling for the O(n*m) table below. A 200-block article against a 200-block draft is 40000 cells,
// which is nothing; the cap exists so a pathological pair degrades to a COUNT rather than to a frozen tab.
export const DIFF_CELL_CAP = 250000;

/**
 * Block-level differences, in draft order. `index` is the block's position in the DRAFT, which is the
 * position on screen, so the list can point at it. A removed block carries the index where it USED to sit
 * relative to the draft, which is where the gap is.
 *
 * A removal immediately followed by an addition is reported as ONE 'changed' item rather than two, because
 * that is what editing a paragraph in place actually is, and two entries per edit makes the list unreadable.
 */
export function blockChanges(liveBody, draftBody) {
  const A = parseBlocks(liveBody ?? '').map((b) => ({ type: b.type, md: serializeBlocks([b]) }));
  const B = parseBlocks(draftBody ?? '').map((b) => ({ type: b.type, md: serializeBlocks([b]) }));
  // Trim the common head and tail first. Most edits touch a small middle, and this usually reduces the
  // table to a handful of cells before it is ever built.
  let head = 0;
  while (head < A.length && head < B.length && A[head].md === B[head].md) head++;
  let tail = 0;
  while (tail < A.length - head && tail < B.length - head
    && A[A.length - 1 - tail].md === B[B.length - 1 - tail].md) tail++;
  const a = A.slice(head, A.length - tail);
  const b = B.slice(head, B.length - tail);
  if (!a.length && !b.length) return [];
  if (a.length * b.length > DIFF_CELL_CAP) {
    return [{
      kind: 'block', op: 'coarse', index: head, type: 'paragraph',
      now: `${b.length} blocks`, was: `${a.length} blocks`,
    }];
  }
  const script = editScript(a, b);
  const items = [];
  for (let i = 0; i < script.length; i++) {
    const s = script[i];
    if (s.op === 'keep') continue;
    const next = script[i + 1];
    if (s.op === 'remove' && next && next.op === 'add') {
      items.push({ kind: 'block', op: 'changed', index: head + next.bi, type: b[next.bi].type, now: b[next.bi].md, was: a[s.ai].md });
      i++; // the pair is consumed
      continue;
    }
    if (s.op === 'add') { items.push({ kind: 'block', op: 'added', index: head + s.bi, type: b[s.bi].type, now: b[s.bi].md, was: null }); continue; }
    items.push({ kind: 'block', op: 'removed', index: head + s.bi, type: a[s.ai].type, now: null, was: a[s.ai].md });
  }
  return items;
}

/** Longest common subsequence over block markdown, walked back into an ordered keep/add/remove script. */
function editScript(a, b) {
  const n = a.length;
  const m = b.length;
  const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[i][j] = a[i].md === b[j].md ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    }
  }
  const out = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i].md === b[j].md) { out.push({ op: 'keep', ai: i, bi: j }); i++; j++; continue; }
    // A removal is emitted before an addition at the same position, which is what makes the pairing above
    // recognise an in-place edit.
    if (L[i + 1][j] >= L[i][j + 1]) { out.push({ op: 'remove', ai: i, bi: j }); i++; }
    else { out.push({ op: 'add', ai: i, bi: j }); j++; }
  }
  while (i < n) { out.push({ op: 'remove', ai: i, bi: j }); i++; }
  while (j < m) { out.push({ op: 'add', ai: i, bi: j }); j++; }
  return out;
}

/**
 * The whole answer, as one ordered list: metadata first (short, and it changes what the page IS), then the
 * author note, then the body in document order.
 *
 * `live` is null when the item has never been published, which is not a diff at all: everything in it is new,
 * and saying so is more useful than listing every block as an addition.
 */
export function publishChanges({ live, draft, liveNote, draftNote, reassign } = {}) {
  const d = draft || {};
  if (!live) {
    return { isNew: true, items: [], blockCount: parseBlocks(d.body ?? '').length };
  }
  // A draft with NO metadata at all, against a live file that has some, is not an author who emptied every
  // field: it is a frontmatter that could not be read. The editor's rail is built from a fetched field list
  // (client.formFields), and when that fetch fails the rail renders empty and everything gathers as absent.
  // Found by driving the real component in a browser, where a stubbed-out field list produced nine confident
  // rows saying the title, permalink, author and visibility had all been cleared. Listing phantom deletions
  // is worse than saying nothing, because the author would believe them.
  const liveKeys = Object.keys(live.frontmatter || {}).filter((k) => !IGNORED_FIELDS.has(k));
  const draftKeys = Object.keys(d.frontmatter || {}).filter((k) => !IGNORED_FIELDS.has(k));
  const metaUnread = liveKeys.length > 0 && draftKeys.length === 0;
  const items = metaUnread ? [] : [...frontmatterChanges(live.frontmatter, d.frontmatter)];
  const moved = reassignmentChange(reassign || {});
  if (moved) items.unshift(moved);
  const noteWas = typeof liveNote === 'string' ? liveNote : null;
  const noteNow = typeof draftNote === 'string' ? draftNote : null;
  if ((noteWas != null || noteNow != null) && !sameValue(noteWas ?? '', noteNow ?? '')) {
    items.push({ kind: 'note', label: 'From-the-author note', was: noteWas ?? '', now: noteNow ?? '' });
  }
  items.push(...blockChanges(live.body, d.body));
  return { isNew: false, metaUnread, items, blockCount: parseBlocks(d.body ?? '').length };
}

/** The one-line heading for an entry. Numbering is the list's job, not this function's. */
export function changeLabel(item) {
  if (!item) return '';
  if (item.kind === 'field') return `${item.label} changed`;
  if (item.kind === 'note') return `${item.label} changed`;
  const noun = blockNoun(item.type);
  if (item.op === 'coarse') return 'The body changed substantially';
  if (item.op === 'added') return `${noun} added`;
  if (item.op === 'removed') return `${noun} removed`;
  return `${noun} edited`;
}
