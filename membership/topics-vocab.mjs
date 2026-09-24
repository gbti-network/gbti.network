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

/** sow-227: the extra headings declared in the file's own `groups:` map, as [{ key, label }] in file order. These are
 *  for topics the category tree has no place for; every other heading comes from the tree. */
export function topicGroupsFromParsed(parsed) {
  const src = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed.groups : null;
  if (!src || typeof src !== 'object' || Array.isArray(src)) return [];
  return Object.entries(src)
    .filter(([key]) => KEY_RE.test(key))
    .map(([key, val]) => {
      const label = typeof val === 'string' ? val.trim() : (val && typeof val.label === 'string' ? val.label.trim() : '');
      return { key, label: label || titleCase(key) };
    });
}

/** sow-227: the heading a topic lands under when its `group` names neither a tree key nor a declared extra. */
export const MORE_TOPICS = Object.freeze({ key: 'more', label: 'More topics' });

/**
 * sow-227: the vocabulary with each topic's heading resolved, plus the headings in display order (owner, 2026-09-23:
 * mirror the superadmin Categories screen). A topic's `group` names a TOP-LEVEL key of the category tree
 * (house/taxonomy.yml `tree`), whose label and order the heading takes, or a key of the file's own `groups:` map.
 * Headings follow the tree's order, then the extras in file order, and only headings in use are listed. A topic whose
 * group resolves to neither falls under MORE_TOPICS, last, so a renamed tree key can never hide a topic.
 *
 * Returns { groups: [{ key, label }], topics: [{ key, label, group, groupKey }] }. `group` is the heading LABEL, the
 * shape /topics.json has always promised (the published extension renders it as a heading). A vocabulary with no
 * grouped topic at all returns no headings and no group fields, so a flat file still renders flat.
 */
export function topicVocabGrouped(parsed, taxonomyTree) {
  const list = topicVocabList(parsed);
  if (!list.some((t) => t.group)) return { groups: [], topics: list.map(({ key, label }) => ({ key, label })) };
  const tree = taxonomyTree && typeof taxonomyTree === 'object' && !Array.isArray(taxonomyTree) ? taxonomyTree : {};
  const known = new Map();
  for (const [key, node] of Object.entries(tree)) {
    known.set(key, { key, label: (node && typeof node.label === 'string' && node.label.trim()) || titleCase(key) });
  }
  for (const g of topicGroupsFromParsed(parsed)) if (!known.has(g.key)) known.set(g.key, g);
  const used = new Set();
  const topics = list.map((t) => {
    const g = (t.group && known.get(t.group)) || MORE_TOPICS;
    used.add(g.key);
    return { key: t.key, label: t.label, group: g.label, groupKey: g.key };
  });
  const groups = [...known.values()].filter((g) => used.has(g.key));
  if (used.has(MORE_TOPICS.key) && !known.has(MORE_TOPICS.key)) groups.push({ ...MORE_TOPICS });
  return { groups, topics };
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

// SOW-087: reconcile mirrors the vocabulary to this KV key so the signup Worker can suggest a share category
// (workers/signup/topic-suggest.mjs) without a redeploy when topics change (the synd:config mirror precedent).
export const TOPICS_MIRROR_KEY = 'topics:vocab';

/** The secret-free KV mirror payload for house/topics.yml: the clean { key: { label, group? } } map. */
export function toTopicsMirror(parsed, now = () => new Date().toISOString()) {
  return { generatedAt: now(), topics: topicsVocabFromParsed(parsed) };
}
