// sow-337: the button icon library, built from React Icons (pinned 5.7.0, a build-only dependency) WITHOUT running
// any of its code. Each set's index.mjs is a generated file of `export function Name (props) { return
// GenIcon({...})(props); };` where the argument is a JSON tree, so the build reads the file as text, pulls each tree
// out with a pattern and JSON.parse, and converts it with reactIconToCta (the same allowlist a saved icon meets). The
// site ships no React.
//
// Output, served from the site (src/pages/icons/): a names index (every set, its display name and its icon names in
// order) and the icons themselves in shards of ICON_SHARD_SIZE per set, so the picker fetches only the shards its
// search results fall in. An icon in a shard is packed ({ v, a?, s }); `a` is left out when it is the React Icons
// default paint, which nearly every icon uses. unpackIcon turns it back into exactly what reactIconToCta produced.
//
// Pure and Node-free: the build, the picker (client-ui) and the tests share it.
import { reactIconToCta } from './cta-icon.mjs';

export const ICON_CATALOG_VERSION = '5.7.0';
export const ICON_SHARD_SIZE = 250;
export const DEFAULT_ICON_ATTRS = Object.freeze({ fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '0' });

const EXPORT_RE = /^export function ([A-Z][A-Za-z0-9]*) \(props\) \{\n\s*return GenIcon\((\{.*\})\)\(props\);\n\};?$/gm;

/** Every icon tree in a set's generated index.mjs, as [{ name, tree }], plus how many exports it could not read. */
export function parseIconModule(src) {
  const text = String(src || '');
  const icons = [];
  let m;
  EXPORT_RE.lastIndex = 0;
  while ((m = EXPORT_RE.exec(text))) {
    try { icons.push({ name: m[1], tree: JSON.parse(m[2]) }); } catch { /* counted below */ }
  }
  // Every export the pattern or the JSON parse could not read, so the build can say how much it left out.
  const exports = (text.match(/^export function /gm) || []).length;
  return { icons, unreadable: exports - icons.length };
}

/** The set list from react-icons/lib/iconsManifest.mjs, read as JSON text: [{ id, name, license }]. */
export function parseIconsManifest(src) {
  const text = String(src || '');
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start < 0 || end < start) return [];
  let rows;
  try { rows = JSON.parse(text.slice(start, end + 1)); } catch { return []; }
  return (Array.isArray(rows) ? rows : [])
    .filter((r) => r && /^[a-z0-9]+$/.test(String(r.id || '')) && typeof r.name === 'string')
    .map((r) => ({ id: r.id, name: r.name, license: typeof r.license === 'string' ? r.license : '' }));
}

/** Convert one set's parsed trees. Returns { names, packed, refused } in source order (refused icons left out). */
export function convertIconSet(setName, icons) {
  const names = [];
  const packed = [];
  let refused = 0;
  for (const { name, tree } of icons) {
    const icon = reactIconToCta(name, setName, tree);
    if (!icon) { refused += 1; continue; }
    names.push(name);
    packed.push(packIcon(icon));
  }
  return { names, packed, refused };
}

const sameAttrs = (a) => {
  const keys = Object.keys(a || {});
  return keys.length === 3 && keys.every((k) => a[k] === DEFAULT_ICON_ATTRS[k]);
};

/** An icon as it is stored in a shard. */
export function packIcon(icon) {
  return sameAttrs(icon.attrs) ? { v: icon.viewBox, s: icon.shapes } : { v: icon.viewBox, a: icon.attrs, s: icon.shapes };
}

/** A shard entry back into the stored icon shape ({ name, set, viewBox, attrs, shapes }). */
export function unpackIcon(name, setName, packed) {
  return { name, set: setName, viewBox: packed?.v, attrs: packed?.a ? { ...packed.a } : { ...DEFAULT_ICON_ATTRS }, shapes: packed?.s };
}

/** The shard file name for an icon position in a set. */
export const iconShardKey = (setId, index) => `${setId}-${Math.floor(index / ICON_SHARD_SIZE)}`;

/** The words of an icon name without its set prefix: "FaAmazonPay" -> "amazon pay", "HiOutlineBookOpen" -> "outline book open". */
export function iconWords(name) {
  const parts = String(name || '').match(/[A-Z][a-z]*|[0-9]+[a-z]*/g) || [];
  // The first token is the set prefix (Fa, Si, Tb, Hi, Io, Lia...), and some sets add a version digit (Fa6 is
  // written FaIcon, but Hi2 and Io5 names start HiOutline / IoAlarm). Drop exactly one leading token.
  return parts.slice(1).join(' ').toLowerCase();
}

/**
 * Search the names index. `index` is { sets: [{ id, name, names }] }. A name that IS the query ranks first (FaAmazon for
 * "amazon"), then a name holding it as whole words, then a word that starts with it, then a name containing it. Returns { total, results: [{ name, index, setId,
 * setName, shard }] } with at most `limit` results, ordered by rank, then set order, then name order.
 */
export function searchIcons(index, query, { setId = '', limit = 48 } = {}) {
  const q = String(query || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const sets = (Array.isArray(index?.sets) ? index.sets : []).filter((s) => !setId || s.id === setId);
  const ranked = [];
  sets.forEach((s, si) => {
    (Array.isArray(s.names) ? s.names : []).forEach((name, i) => {
      let rank = 4;
      if (q) {
        const words = iconWords(name);
        const flat = words.replace(/ /g, '');
        const qFlat = q.replace(/ /g, '');
        if (words === q) rank = 0;
        else if (words.split(' ').includes(q) || (` ${words} `).includes(` ${q} `)) rank = 1;
        else if (words.startsWith(q) || words.split(' ').some((w) => w.startsWith(q))) rank = 2;
        else if (flat.includes(qFlat) || name.toLowerCase().includes(qFlat)) rank = 3;
        else return;
      }
      ranked.push({ rank, si, i, name, setId: s.id, setName: s.name, shard: iconShardKey(s.id, i) });
    });
  });
  ranked.sort((a, b) => a.rank - b.rank || a.si - b.si || a.i - b.i);
  return { total: ranked.length, results: ranked.slice(0, limit).map(({ name, i, setId: id, setName, shard }) => ({ name, index: i, setId: id, setName, shard })) };
}
