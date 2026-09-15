// sow-337: the icon picker's view of the button icon library the site builds (src/pages/icons/). It fetches the
// names index once, searches it locally (membership/icon-catalog.mjs), and fetches only the shards its visible
// results live in, keeping each so a second search is instant. A failed index load is remembered as a failure with
// its reason, and a later call tries again (the picker offers Try again): it never retries on its own.
import { searchIcons, unpackIcon } from '../../membership/icon-catalog.mjs';

export function createIconLibrary({ base = 'https://gbti.network', fetchImpl = (...a) => globalThis.fetch(...a) } = {}) {
  let index = null;
  let indexLoad = null;
  const shards = new Map(); // key -> Promise<packed[]>

  async function loadIndex() {
    if (index) return index;
    if (!indexLoad) {
      indexLoad = (async () => {
        const r = await fetchImpl(`${base}/icons/index.json`);
        if (!r.ok) throw new Error(`the icon library returned ${r.status}`);
        const body = await r.json();
        if (!body?.available) throw new Error(body?.problem || 'the icon library is not available');
        index = body;
        return body;
      })().catch((e) => { indexLoad = null; throw e; });
    }
    return indexLoad;
  }

  function loadShard(key) {
    if (!shards.has(key)) {
      shards.set(key, (async () => {
        const r = await fetchImpl(`${base}/icons/${encodeURIComponent(key)}.json`);
        if (!r.ok) throw new Error(`icon shard ${key} returned ${r.status}`);
        const body = await r.json();
        return Array.isArray(body?.icons) ? body.icons : [];
      })().catch((e) => { shards.delete(key); throw e; }));
    }
    return shards.get(key);
  }

  return {
    loadIndex,
    /** The sets for the filter chips: [{ id, name, count }]. */
    async sets() {
      const idx = await loadIndex();
      return idx.sets.map((s) => ({ id: s.id, name: s.name, count: s.names.length }));
    },
    /** Search, then resolve each visible result to its stored icon. { total, icons: [icon] } in result order. */
    async search(query, { setId = '', limit = 48 } = {}) {
      const idx = await loadIndex();
      const { total, results } = searchIcons(idx, query, { setId, limit });
      const icons = await Promise.all(results.map(async (r) => {
        const packed = (await loadShard(r.shard))[r.index % idx.shardSize];
        return packed ? unpackIcon(r.name, r.setName, packed) : null;
      }));
      return { total, icons: icons.filter(Boolean) };
    },
  };
}
