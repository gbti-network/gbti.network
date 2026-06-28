// SOW-080: the admin-owned flat TOPIC VOCABULARY (house/topics.yml). A "followed topic" is a key in this flat,
// git-native vocabulary, DECOUPLED from the content taxonomy (house/taxonomy.yml) so the ~50 follow topics can grow
// without re-tagging any content. Read by src/lib/taxonomy.ts (the site build + /topics.json), validated against
// house/topic-map.yml (membership/topic-map.mjs), and rendered by the extension topic picker. Each entry is a
// kebab-case key -> { label, group? }.
//
// Node-free + pure (no fs, no IO): the parser, the list/label accessors, and the key accessor. The site build, the
// signup Worker, the client, and node tests all read house/topics.yml themselves and call these.

const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // kebab-case

const titleCase = (key) => String(key).split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');

/**
 * Parse raw parsed-YAML into a clean { key: { label, group? } } map. Accepts { topics: {...} } or a bare map; each
 * value may be a string label, or { label, group }, or null (label then defaults to a Title-Cased key). Drops any
 * malformed / non-kebab-case key. A missing/empty doc yields {}.
 */
export function topicsVocabFromParsed(parsed) {
  const out = {};
  const src = parsed && typeof parsed === 'object' ? (parsed.topics ?? parsed) : {};
  if (!src || typeof src !== 'object' || Array.isArray(src)) return out;
  for (const [key, val] of Object.entries(src)) {
    if (typeof key !== 'string' || !KEY_RE.test(key)) continue;
    let label = '';
    let group;
    if (typeof val === 'string') label = val.trim();
    else if (val && typeof val === 'object' && !Array.isArray(val)) {
      label = typeof val.label === 'string' ? val.label.trim() : '';
      group = typeof val.group === 'string' && val.group.trim() ? val.group.trim() : undefined;
    }
    out[key] = { label: label || titleCase(key), ...(group ? { group } : {}) };
  }
  return out;
}

/** The flat vocabulary as a sorted-by-label [{ key, label, group? }] list. */
export function topicVocabList(parsed) {
  return Object.entries(topicsVocabFromParsed(parsed))
    .map(([key, v]) => ({ key, label: v.label, ...(v.group ? { group: v.group } : {}) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/** Display label for a topic key (falls back to a Title-Cased key). */
export function topicVocabLabel(parsed, key) {
  const m = topicsVocabFromParsed(parsed);
  return (m[key] && m[key].label) || titleCase(key);
}

/** The topic keys (used to validate house/topic-map.yml against the vocabulary). */
export function topicVocabKeys(parsed) {
  return Object.keys(topicsVocabFromParsed(parsed));
}
