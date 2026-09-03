// Pure gallery-row helpers (sow-268 Phase 1), shared by the content editor. No DOM: the component reads the
// rows out of the shadow DOM and passes them through these, so the parse + serialize contract is unit-tested
// in node without a browser.
//
// Why this exists: `gallery` is a `kind: 'json'` field, and the editor used to render it through the generic
// json control. An ARRAY value is comma-joined for display (gbti-content-editor.mjs, the `v` expression), so
// the textarea showed `./images/a.webp, ./images/b.webp`, and gather()'s coerceValue('json', ...) then
// JSON.parse'd that string and threw. Every project with screenshots was unsaveable, and Preview (whose
// gather() sits outside a try) was a dead button. The fix mirrors the links[] structured rows: a hidden json
// input holds JSON.stringify(the serialized value), and these helpers are the parse/serialize either side.
//
// The serialize side MUST round-trip the ten existing projects byte-for-byte: they all use bare path strings,
// so an uncaptioned row serializes back to a bare string, NOT { src, caption: '' }, or opening and saving a
// project would churn its own frontmatter. This mirrors normalizeGallery (src/lib/project-page.mjs), which
// reads a bare string or a { src, caption } object in any mix.

/**
 * Read a stored gallery value into editable rows.
 * Accepts an array (of bare path strings and/or { src, caption } objects) or a JSON string of the same.
 * @returns {{ src: string, caption: string }[]}
 */
export function galleryRowsFromValue(value) {
  let arr = [];
  if (Array.isArray(value)) arr = value;
  else if (typeof value === 'string' && value.trim()) {
    try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) arr = parsed; } catch { arr = []; }
  }
  const rows = [];
  for (const entry of arr) {
    if (!entry) continue;
    if (typeof entry === 'string') { rows.push({ src: entry, caption: '' }); continue; }
    if (typeof entry === 'object' && entry.src) {
      rows.push({ src: String(entry.src), caption: typeof entry.caption === 'string' ? entry.caption : '' });
    }
  }
  return rows;
}

/**
 * Rebuild the stored gallery value from editable rows. A row with no `src` is dropped (an empty row is not a
 * screenshot, matching _serializeLinks). An uncaptioned row serializes to a bare string so it does not churn
 * existing frontmatter; a captioned row serializes to { src, caption }.
 * @param {{ src?: string, caption?: string }[]} rows
 * @returns {(string | { src: string, caption: string })[]}
 */
export function galleryValueFromRows(rows) {
  const out = [];
  for (const row of rows ?? []) {
    const src = String((row && row.src) || '').trim();
    if (!src) continue;
    const caption = String((row && row.caption) || '').trim();
    out.push(caption ? { src, caption } : src);
  }
  return out;
}

/**
 * sow-268: move the row at `from` so it sits at index `to`, returning a NEW array.
 *
 * Extracted rather than done in the DOM because the index arithmetic is where reordering actually goes
 * wrong, and it is invisible once it is tangled up with drag events. The subtle case is a DOWNWARD move:
 * removing the row first shifts every later index by one, so a naive splice-out-splice-in lands one short.
 *
 * Out-of-range and no-op moves return an equal array rather than throwing, because both are reachable from
 * real input: dragging a row onto itself, or pressing ArrowUp on the first row.
 */
export function moveGalleryRow(rows, from, to) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  const n = out.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return out;
  if (from < 0 || from >= n) return out;
  const dest = Math.max(0, Math.min(n - 1, to));
  if (dest === from) return out;
  const [item] = out.splice(from, 1);
  out.splice(dest, 0, item);
  return out;
}

/**
 * sow-268 Phase 3: pick an image filename that does not collide with one already in play this editor session.
 *
 * stageImage (client/src/operations-admin.mjs) uses the uploaded filename VERBATIM as `./images/<filename>`: it
 * VALIDATES the name (rejects path separators and unsupported extensions) but never renames or de-duplicates.
 * So two picked files both named "image.png" both stage to `./images/image.png`, and a multi-file gallery add
 * would create two rows pointing at ONE picture while the second stage silently overwrites the first's bytes.
 * The single-file cover uploader never hit this; a multi-file gallery add will on any repeated name.
 *
 * This inserts "-1", "-2", ... before the extension until the name is free. `taken` holds the bare filenames
 * already used this session: the current rows' basenames plus every name staged earlier in the same batch. The
 * hyphen suffix (not a space) keeps the resulting `./images/` URL clean, and it survives stageImage's validation
 * (no path separator, extension preserved).
 *
 * @param {string} name  the desired filename, e.g. "shot.png"
 * @param {Iterable<string>} taken  filenames already used this session
 * @returns {string} a filename not present in `taken`
 */
export function uniqueImageName(name, taken) {
  const used = taken instanceof Set ? taken : new Set(taken || []);
  const raw = String(name || '').trim() || 'image';
  if (!used.has(raw)) return raw;
  // Split on the LAST dot so a multi-dot name keeps its real extension; a leading-dot name (".keep") has none.
  const dot = raw.lastIndexOf('.');
  const base = dot > 0 ? raw.slice(0, dot) : raw;
  const ext = dot > 0 ? raw.slice(dot) : '';
  for (let i = 1; i < 10000; i += 1) {
    const candidate = `${base}-${i}${ext}`;
    if (!used.has(candidate)) return candidate;
  }
  return `${base}-${Date.now()}${ext}`;
}
