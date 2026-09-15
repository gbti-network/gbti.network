// sow-337: the one reader of the React Icons package for the build (src/pages/icons/). It reads each set's generated
// index.mjs as TEXT and converts it through membership/icon-catalog.mjs, so no code from the package ever runs. A
// missing or unreadable package never fails the build: the catalog comes back { available: false, problem } and the
// picker says the icon library is unavailable, while the rest of the site builds as usual.
import fs from 'node:fs';
import path from 'node:path';
import { parseIconModule, parseIconsManifest, convertIconSet, ICON_SHARD_SIZE } from '../../membership/icon-catalog.mjs';

const cache = new Map(); // root -> catalog; a build asks for it once per shard page

/**
 * The converted catalog: { available, version, sets: [{ id, name, license, names }], shards: Map(key -> packed[]),
 * refused, unreadable } or { available: false, problem, sets: [], shards: empty }.
 */
export function readIconCatalog(root, { dir = path.join(root, 'node_modules', 'react-icons') } = {}) {
  if (cache.has(dir)) return cache.get(dir);
  const empty = (problem) => ({ available: false, problem, version: null, sets: [], shards: new Map(), refused: 0, unreadable: 0 });
  let out;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    const manifest = parseIconsManifest(fs.readFileSync(path.join(dir, 'lib', 'iconsManifest.mjs'), 'utf8'));
    if (!manifest.length) throw new Error('the icon set list could not be read');
    const sets = [];
    const shards = new Map();
    let refused = 0, unreadable = 0;
    for (const m of manifest) {
      const file = path.join(dir, m.id, 'index.mjs');
      if (!fs.existsSync(file)) continue;
      const parsed = parseIconModule(fs.readFileSync(file, 'utf8'));
      unreadable += parsed.unreadable;
      const set = convertIconSet(m.name, parsed.icons);
      refused += set.refused;
      if (!set.names.length) continue;
      sets.push({ id: m.id, name: m.name, license: m.license, names: set.names });
      for (let i = 0; i < set.packed.length; i += ICON_SHARD_SIZE) shards.set(`${m.id}-${i / ICON_SHARD_SIZE}`, set.packed.slice(i, i + ICON_SHARD_SIZE));
    }
    out = sets.length ? { available: true, problem: null, version: String(pkg.version || ''), sets, shards, refused, unreadable } : empty('no icon sets were found');
  } catch (e) {
    out = empty(`the icon library could not be read (${e?.code || e?.message || 'unknown'})`);
  }
  cache.set(dir, out);
  return out;
}
