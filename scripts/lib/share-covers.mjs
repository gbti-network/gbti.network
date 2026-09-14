// sow-283 / sow-272: the pure half of the share-covers workflow. No network, no filesystem, so every decision the
// workflow makes is a unit test (test/share-covers.test.mjs). scripts/share-covers.mjs is the thin runner.
//
// The lifecycle of one public share's cover, and why it has two stages:
//
//   1. COPY. The share's `image` is an outside URL (or it has none, its preview was never removed, and its link
//      has a preview image). A job with NO credentials fetches it under scripts/lib/safe-fetch.mjs, converts it
//      to a WebP and writes members/<author>/shares/images/<id>-<hash>.webp plus a record in
//      house/share-covers.yml. The share itself is untouched, so the site keeps showing the original image
//      (owner decision, 2026-09-13).
//   2. SWITCH. Only once that exact file is DEPLOYED (the runner downloads our URL and compares the sha256), the
//      share's `image` is rewritten to our URL and the original is kept as `imageSource`. Switching before the
//      copy is live would show every reader, the extension included, a broken image for a few minutes.
//
// And the reverse: a share that stops being public gets its original image back and its copy deleted (a static
// site cannot hide a file, so a members-only share never has one). A share whose preview was removed, or that
// was deleted, loses its copy. A member who re-previews a different image gets a new copy under a new name.
import yaml from 'js-yaml';
import { parseShareCoverUrl } from '../../membership/share-cover-url.mjs';

export const MANIFEST_PATH = 'house/share-covers.yml';
export const RETRY_AFTER_DAYS = 7;
const DAY_MS = 86400000;

// A failure worth trying again later: the outside site may come back. Anything else (no preview image on the
// page, a 404, not an image, a refused address) will not change until the share itself does, and a changed
// `image` or `url` is a new source that gets tried anyway.
const TRANSIENT = /^(timeout|unreachable|read-failed|http-5\d\d|http-429|budget)$/;

export const shareKey = (author, id) => `${author}/${id}`;
export const isPublishedPublic = (s) => s?.status === 'published' && s?.visibility === 'public';

function retryDue(entry, now) {
  if (!entry?.failed || !TRANSIENT.test(String(entry.failed))) return false;
  const tried = Date.parse(entry.triedAt);
  return !Number.isFinite(tried) || now - tried >= RETRY_AFTER_DAYS * DAY_MS;
}

/**
 * Decide everything one run should do.
 *
 * @param {object} a
 * @param {Array<{author,id,status,visibility,image,imageSource,imageRemoved,url}>} a.shares every share file
 * @param {Record<string, object>} a.manifest house/share-covers.yml `covers`, keyed author/id
 * @param {Record<string, string[]>} a.files copy file names present, keyed author
 * @param {number} a.now epoch ms
 * @returns {{ fetch: object[], promote: object[], restore: object[], deleteFiles: string[], dropEntries: string[] }}
 *   deleteFiles are repo-relative paths.
 */
export function planShareCovers({ shares = [], manifest = {}, files = {}, now = Date.now() } = {}) {
  const fetch = [];
  const promote = [];
  const restore = [];
  const deleteFiles = [];
  const dropEntries = new Set();
  const known = new Set();

  const filesFor = (author, id) => (files[author] || []).filter((f) => parseShareCoverUrl(`/media/shares/${author}/${f}`)?.id === id);
  const drop = (author, id, keep = new Set()) => {
    for (const f of filesFor(author, id)) if (!keep.has(f)) deleteFiles.push(`members/${author}/shares/images/${f}`);
  };

  for (const s of shares) {
    const key = shareKey(s.author, s.id);
    known.add(key);
    const entry = manifest[key];
    const ours = parseShareCoverUrl(s.image);
    const mine = ours && ours.author === s.author && ours.id === s.id ? ours : null;

    if (!isPublishedPublic(s)) {
      if (mine) restore.push({ key, author: s.author, id: s.id, image: s.imageSource || null });
      drop(s.author, s.id);
      if (entry) dropEntries.add(key);
      continue;
    }

    if (ours && !mine) {
      // Another share's copy, pasted as this share's image. It is already on our host, so there is nothing to copy.
      drop(s.author, s.id);
      if (entry) dropEntries.add(key);
      continue;
    }

    if (mine) {
      if (!filesFor(s.author, s.id).includes(mine.file)) {
        // Points at a copy that is not in the repo (deleted by hand, or a bad merge): put the original back.
        restore.push({ key, author: s.author, id: s.id, image: s.imageSource || null });
        drop(s.author, s.id);
        if (entry) dropEntries.add(key);
      } else {
        drop(s.author, s.id, new Set([mine.file]));
      }
      continue;
    }

    if (typeof s.image === 'string' && s.image) {
      const same = entry && entry.source === s.image && !entry.lookup;
      if (same && entry.file && filesFor(s.author, s.id).includes(entry.file)) {
        promote.push({ key, author: s.author, id: s.id, file: entry.file, sha256: entry.sha256, source: entry.source });
        drop(s.author, s.id, new Set([entry.file]));
      } else if (same && entry.failed && !retryDue(entry, now)) {
        drop(s.author, s.id);
      } else {
        fetch.push({ key, author: s.author, id: s.id, kind: 'image', source: s.image });
        drop(s.author, s.id);
      }
      continue;
    }

    // No image at all.
    if (s.imageRemoved === true || typeof s.url !== 'string' || !s.url) {
      drop(s.author, s.id);
      if (entry) dropEntries.add(key);
      continue;
    }
    const same = entry && entry.lookup === s.url;
    if (same && entry.file && filesFor(s.author, s.id).includes(entry.file)) {
      promote.push({ key, author: s.author, id: s.id, file: entry.file, sha256: entry.sha256, source: entry.source });
      drop(s.author, s.id, new Set([entry.file]));
    } else if (same && entry.failed && !retryDue(entry, now)) {
      drop(s.author, s.id);
    } else {
      fetch.push({ key, author: s.author, id: s.id, kind: 'lookup', url: s.url });
      drop(s.author, s.id);
    }
  }

  // Copies and records for shares that no longer exist.
  for (const [author, names] of Object.entries(files)) {
    for (const f of names) {
      const p = parseShareCoverUrl(`/media/shares/${author}/${f}`);
      if (!p || !known.has(shareKey(author, p.id))) deleteFiles.push(`members/${author}/shares/images/${f}`);
    }
  }
  for (const key of Object.keys(manifest)) if (!known.has(key)) dropEntries.add(key);

  return { fetch, promote, restore, deleteFiles: [...new Set(deleteFiles)].sort(), dropEntries: [...dropEntries].sort() };
}

// ---------------------------------------------------------------------------------------------------------------
// Frontmatter edits. A share file is member content, so the switch changes EXACTLY the image lines and nothing
// else: no re-serialization, no reflowed description, no reordered keys. A folded `image: >-` value (eight real
// shares carry one) spans several lines, and all of them belong to the key.

function splitFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?\r?\n)---(\r?\n|$)/.exec(text);
  if (!m) return null;
  const start = text.startsWith('---\r\n') ? 5 : 4;
  return { head: m[1], start, end: start + m[1].length };
}

/** Line ranges of a top-level key inside the frontmatter block: the key line plus its indented continuation. */
function keyRange(lines, key) {
  const re = new RegExp(`^${key}:(\\s|$)`);
  const i = lines.findIndex((l) => re.test(l));
  if (i === -1) return null;
  let j = i + 1;
  while (j < lines.length && /^\s+\S/.test(lines[j])) j++; // a folded scalar's (or a list's) indented lines
  return [i, j];
}

const scalar = (v) => yaml.dump(String(v), { lineWidth: -1 }).trimEnd();

/**
 * Set (or remove, with value null) top-level frontmatter keys, editing only their own lines. `after` names the key a
 * newly inserted key follows; without it, or when that key is absent, the new key goes at the end of the block.
 * Returns the new text, or null when the file has no frontmatter.
 */
export function editFrontmatter(text, edits) {
  const fm = splitFrontmatter(text);
  if (!fm) return null;
  const nl = fm.head.includes('\r\n') ? '\r\n' : '\n';
  const lines = fm.head.slice(0, -nl.length).split(nl);
  for (const { key, value, after } of edits) {
    const r = keyRange(lines, key);
    if (value == null) {
      if (r) lines.splice(r[0], r[1] - r[0]);
      continue;
    }
    const line = `${key}: ${scalar(value)}`;
    if (r) { lines.splice(r[0], r[1] - r[0], line); continue; }
    const a = after ? keyRange(lines, after) : null;
    if (a) lines.splice(a[1], 0, line);
    else lines.push(line);
  }
  return text.slice(0, fm.start) + lines.join(nl) + nl + text.slice(fm.end);
}

/** The switch: `image` becomes our URL and the original is kept as `imageSource`. */
export function switchToCopy(text, { url, source }) {
  return editFrontmatter(text, [
    { key: 'image', value: url, after: 'url' },
    { key: 'imageSource', value: source, after: 'image' },
  ]);
}

/** The reverse: `image` goes back to the original (or away, when there was none) and `imageSource` is removed. */
export function restoreOriginal(text, { image }) {
  return editFrontmatter(text, [
    { key: 'image', value: image || null },
    { key: 'imageSource', value: null },
  ]);
}

/** Parse house/share-covers.yml to its `covers` map. A missing or empty file is an empty map; a malformed one throws,
 *  because running against a record we cannot read would re-copy everything and forget every failure. */
export function parseManifest(text) {
  if (!text || !String(text).trim()) return {};
  const doc = yaml.load(text);
  if (doc == null) return {};
  if (typeof doc !== 'object' || (doc.covers != null && typeof doc.covers !== 'object')) throw new Error('share-covers manifest: expected a `covers` map');
  return doc.covers || {};
}

const MANIFEST_HEADER = `# Share cover copies (sow-283). WRITTEN BY THE share-covers WORKFLOW (scripts/share-covers.mjs); do not hand-edit.
#
# One entry per public share whose cover we host, keyed <author>/<share id>:
#   source    the outside image URL the copy was made from (for a lookup, the preview image the page named)
#   lookup    present when the share had no image and its link's page was read for a preview image
#   file      the copy under members/<author>/shares/images/, named <id>-<first 8 of sha256>.webp
#   sha256    of that file; the switch compares it with what gbti.network serves before pointing the share at it
#   failed    why the last attempt failed; triedAt is when. Only timeouts, unreachable hosts and 5xx are retried,
#             after ${RETRY_AFTER_DAYS} days. A changed image or link is a new source and is always tried.
`;

/** Serialize the manifest with stable key order, so a no-op run writes a byte-identical file. */
export function serializeManifest(covers) {
  const sorted = Object.fromEntries(Object.keys(covers).sort().map((k) => [k, covers[k]]));
  return `${MANIFEST_HEADER}${yaml.dump({ covers: sorted }, { lineWidth: -1, sortKeys: false, noRefs: true })}`;
}
