// SOW-043 groundwork (deploy-independent): the news-category -> Discord-channel map (admin-owned house config,
// house/news-channels.yml). Pure over the PARSED yaml ({ channels: [{ category, channelId }] }), like the other
// membership cores: the caller (CI validator / the signup Worker's heart-publish path) parses the yaml and passes
// the object. channelForCategory resolves a news category to its Discord channel id (null when unmapped -> the
// heart is recorded but nothing is posted, fail-closed). validateNewsChannels returns structural errors for CI.
// Node-free (no fs / no yaml).

const lc = (s) => String(s ?? '').trim().toLowerCase();

/** Parsed map -> Map(category -> channelId), skipping malformed/empty entries (last write wins on a dup). */
export function newsChannelMap(parsed) {
  const out = new Map();
  const list = Array.isArray(parsed?.channels) ? parsed.channels : [];
  for (const e of list) {
    const cat = lc(e?.category);
    const ch = String(e?.channelId ?? '').trim();
    if (cat && ch) out.set(cat, ch);
  }
  return out;
}

/** Resolve a news category to its Discord channel id, or null when unmapped (fail-closed: no post). */
export function channelForCategory(parsed, category) {
  return newsChannelMap(parsed).get(lc(category)) ?? null;
}

/** SOW-088: resolve a channel for a taxonomy PATH, DEEPEST-mapped key first (['ai','prompts','skill'] tries
 *  skill, then prompts, then ai). Lets one leaf mapping (skill -> #devops) win over the broad top-level row.
 *  Falls back to null like channelForCategory; a non-array input degrades to the single-key resolution. */
export function channelForCategoryPath(parsed, path) {
  const arr = Array.isArray(path) ? path : (path ? [path] : []);
  for (let i = arr.length - 1; i >= 0; i--) {
    const hit = channelForCategory(parsed, arr[i]);
    if (hit) return hit;
  }
  return null;
}

/** Structural validation for CI: `channels` must be a list of { category, numeric channelId }, no dup category.
 *  An absent map (null) is valid (no channels configured). Returns a (possibly empty) array of error strings.
 *  SOW-087: `file` labels the errors, so house/content-channels.yml (same shape) reuses this validator. */
export function validateNewsChannels(parsed, { file = 'news-channels.yml' } = {}) {
  const errors = [];
  if (parsed == null) return errors; // absent file = no channels configured, valid
  const list = parsed.channels;
  if (list === undefined || list === null) { errors.push(`${file}: a \`channels:\` list is required (use [] for none)`); return errors; }
  if (!Array.isArray(list)) { errors.push(`${file}: \`channels\` must be a list`); return errors; }
  const seen = new Set();
  list.forEach((e, i) => {
    const cat = lc(e?.category);
    const ch = String(e?.channelId ?? '').trim();
    if (!cat) errors.push(`${file} channels[${i}]: a non-empty category is required`);
    if (!ch) errors.push(`${file} channels[${i}]: a non-empty channelId is required`);
    else if (!/^[0-9]{5,25}$/.test(ch)) errors.push(`${file} channels[${i}]: channelId "${ch}" must be a numeric Discord channel id`);
    if (cat && seen.has(cat)) errors.push(`${file}: duplicate category "${cat}"`);
    if (cat) seen.add(cat);
  });
  return errors;
}
