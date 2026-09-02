// SOW-087: suggest ONE flat topic key (house/topics.yml) for a shared link, so the share composer can pre-fill
// its category select. Follows the news worker's classify pattern (workers/news/src/classify.mjs): constrain the
// model by prompt, then VALIDATE the reply against the vocabulary (CF Llama has no reliable guided-JSON mode).
// The vocabulary comes from the reconcile KV mirror (topics:vocab), never from the client. Fail-OPEN to null:
// a missing mirror, a disabled knob, an AI error, or no keyword match all mean "no suggestion" — the member
// always confirms or overrides the category in the composer, so a wrong guess can never publish itself.
//
// Cost posture (owner-reviewed): one tiny Workers AI call (title + description + declared tags in, ~12 tokens
// out) per composer preview fetch, inside the account's free Neuron budget. The `classify` knob in
// house/syndication-config.yml flips to `keyword` (free) or `off` if quotas ever tighten.

import { TOPICS_MIRROR_KEY } from '../../membership/topics-vocab.mjs';
import { classifyMode } from '../../membership/syndication-config-core.mjs';
import { readSyndicationConfig } from './syndication-store.mjs';

/** Read the mirrored topic vocabulary ({ key: { label, group? } }) from KV. Missing/invalid = {} (no suggestion). */
export async function readTopicsVocab(kv) {
  try {
    const mirror = await kv.get(TOPICS_MIRROR_KEY, 'json');
    const topics = mirror?.topics;
    return topics && typeof topics === 'object' && !Array.isArray(topics) ? topics : {};
  } catch {
    return {};
  }
}

/**
 * Map a raw model reply to a topic key (case-insensitive, tolerant of quotes/extra words), or null when nothing
 * in the vocabulary matches. Prefers an exact key or label match, then the longest contained key/label. Pure.
 */
export function normalizeTopic(raw, vocab) {
  if (!raw || typeof raw !== 'string') return null;
  const s = raw.toLowerCase().replace(/["'`]/g, '').trim();
  if (!s) return null;
  let best = null;
  let bestLen = 0;
  for (const [key, v] of Object.entries(vocab || {})) {
    const label = String(v?.label || '').toLowerCase();
    if (s === key || (label && s === label)) return key; // clean exact match
    for (const cand of [key, label]) {
      if (cand && s.includes(cand) && cand.length > bestLen) { best = key; bestLen = cand.length; }
    }
  }
  return best;
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Cheap keyword guess: an exact declared-tag match on a topic key/label wins first (the page's own tags are the
 * strongest signal), then a whole-word key/label match over title + description + tags. Null when nothing hits. Pure.
 */
export function keywordTopic({ title = '', description = '', tags = [] } = {}, vocab) {
  const entries = Object.entries(vocab || {});
  if (!entries.length) return null;
  const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const byName = new Map(); // normalized key / label / de-kebabed key -> topic key
  for (const [key, v] of entries) {
    for (const name of [key, key.replace(/-/g, ' '), norm(v?.label)]) {
      if (name && !byName.has(name)) byName.set(name, key);
    }
  }
  for (const t of Array.isArray(tags) ? tags : []) {
    const hit = byName.get(norm(t));
    if (hit) return hit;
  }
  const hay = norm(`${title} ${description} ${Array.isArray(tags) ? tags.join(' ') : ''}`);
  if (!hay) return null;
  for (const [name, key] of byName) {
    if (name.length < 2) continue; // a 1-char name would match noise
    if (new RegExp(`(?:^|[^a-z0-9])${escapeRe(name)}(?:[^a-z0-9]|$)`).test(hay)) return key;
  }
  return null;
}

/** System + user messages for the topic classifier. Pure. */
export function buildTopicMessages({ title = '', description = '', tags = [] } = {}, vocab) {
  const list = Object.entries(vocab || {}).map(([key, v]) => `- ${key}: ${v?.label || key}`).join('\n');
  const system =
    'You classify a shared web link into exactly ONE topic from the list below. ' +
    'Reply with ONLY the topic key (the part before the colon), exactly as written, and nothing else.\n\nTopics:\n' + list;
  const tagLine = Array.isArray(tags) && tags.length ? `\nTags: ${tags.join(', ')}` : '';
  const user = `Title: ${title || '(none)'}\nDescription: ${description || '(none)'}${tagLine}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ---------------------------------------------------------------------------------------------------------
// sow-303: SUGGESTED TAGS, alongside the topic category above.
//
// WHY THIS EXISTS. A syndicated share ended with one hashtag, because 49 of 57 shares carried no tags at all
// and the composer never asked for any. Tags are what {tags-hashtags} renders from, so an untagged share can
// only ever emit its category.
//
// WHY NOT SCRAPE THEM. og-scrape already collects the page's declared article:tag/keywords and hands them here
// as `tags`. Measured against 20 real shared urls: TWO declare anything and one of those declares an empty
// string. They are kept as the free fallback below, and they are not a solution on their own.
//
// WHY A SECOND AI CALL RATHER THAN ONE COMBINED ONE. The header of this file states the binding constraint:
// CF Llama has no reliable guided-JSON mode, which is why the topic reply is a single token that is then
// validated against a vocabulary. Asking one reply to carry a topic AND a tag list means one malformed reply
// loses both answers. Two calls keep each answer independently parseable and independently discardable.
// Cost: this roughly triples the output tokens of a composer preview (about 12 to about 40), and it fires
// only when a member is composing a share, not per request.
//
// TAGS ARE FREE-FORM, unlike the category (owner ruling, 2026-09-02). The category routes a Discord channel,
// so it MUST validate against the vocabulary. A tag routes nothing, so an unrecognized one breaks nothing,
// and the specific tags are the useful ones: the best hand-tagged shares carry `supply-chain`, `qwen`, `crt`,
// which the flat topic vocabulary cannot express.

/** The house tag shape, matching TAG_KEBAB_RE in client/src/schemas.mjs. */
const TAG_SHAPE = /^[a-z0-9][a-z0-9.-]*$/;

/**
 * Parse a model reply (or a declared-tag array) into house-shaped tags. Pure.
 *
 * NORMALIZING HERE IS MANDATORY, NOT TIDINESS, and the reason is not obvious from this file. buildShareFile
 * (client/src/content-ops.mjs) parses against shareSchema but then serializes `cleaned` rather than the
 * PARSED result, so tagsSchema's normalization is computed and thrown away while its `.refine` rejection
 * still fires. A tag that is not already house-shaped therefore does not get fixed on the way in: it THROWS
 * ContentValidationError and the share fails to publish. So anything that reaches a share's frontmatter has
 * to arrive already correct. A test pins agreement with normalizeTag rather than trusting this comment.
 *
 * Anything that cannot be repaired into shape is DROPPED rather than mangled: a suggestion is a convenience
 * the member confirms, so losing one is free and publishing a broken one is not.
 */
export function normalizeSuggestedTags(raw, { max = 4, minLen = 2, maxLen = 32 } = {}) {
  const parts = Array.isArray(raw) ? raw : String(raw || '').split(/[,\n]/);
  const out = [];
  for (const part of parts) {
    const t = String(part ?? '')
      // A list marker the model may add. Anchored to a marker FOLLOWED BY SPACE so it cannot eat the leading
      // digit of a real tag: `3d-printing` must survive, and `- 3d-printing` must lose only the bullet.
      .replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '')
      .trim().toLowerCase()
      .replace(/["'`#]/g, '')          // the model likes quoting, and sometimes writes them as #hashtags
      .replace(/[\s_]+/g, '-')         // the house rule: spaces and underscores become hyphens
      .replace(/[^a-z0-9.-]/g, '')     // drop what the shape forbids outright (c++ -> c)
      .replace(/-{2,}/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '');
    if (t.length < minLen || t.length > maxLen) continue;
    // REDUNDANT BY CONSTRUCTION, and kept deliberately. The strips above already remove every character the
    // shape forbids and trim the leading dot or hyphen, so nothing reaching here can fail this test: a
    // mutation deleting the line kills no test, which was measured rather than assumed. It stays as the
    // stated invariant, so an edit to the strip chain that stops being sufficient fails here instead of
    // shipping a tag that makes a share unpublishable. The CONTRACT is pinned by a property test.
    if (!TAG_SHAPE.test(t)) continue;
    if (!out.includes(t)) out.push(t);
    if (out.length >= max) break;
  }
  return out;
}

/** System + user messages for the tag extractor. Pure. */
export function buildTagMessages({ title = '', description = '', tags = [] } = {}) {
  const system =
    'You extract topic tags for a shared web link. Reply with ONLY a comma-separated list of two to four '
    + 'short tags and nothing else: no numbering, no hashes, no explanation, no sentences. '
    + 'Write each tag in lowercase with hyphens instead of spaces. '
    + 'Prefer the SPECIFIC term over the general one: "supply-chain" rather than "security", '
    + '"wireguard" rather than "networking", "qwen" rather than "ai".';
  const tagLine = Array.isArray(tags) && tags.length ? `\nTags: ${tags.join(', ')}` : '';
  const user = `Title: ${title || '(none)'}\nDescription: ${description || '(none)'}${tagLine}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Suggest free-form tags for a link preview. Returns a (possibly empty) array; NEVER throws.
 *
 * Honors the same `classify` knob as suggestTopic, and `off` means off: no AI call and no declared-tag
 * fallback either, so one switch silences every suggestion rather than most of them.
 *
 * Otherwise the page's own declared tags are the floor. The AI reply replaces them when it yields anything
 * usable, because a model reading the title beats a publisher's keywords meta in practice, and falls back to
 * them on any error. Both paths pass through the same normalizer, so no caller can tell which one answered.
 */
export async function suggestTags(env, { title, description, tags, kv = env?.SIGNUP_KV, max = 4 } = {}) {
  const declared = normalizeSuggestedTags(tags, { max });
  if (!kv) return declared;
  let mode;
  try { mode = classifyMode(await readSyndicationConfig(kv)); } catch { return declared; }
  if (mode === 'off') return [];
  if (mode === 'ai' && env?.AI?.run) {
    try {
      const out = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct', {
        messages: buildTagMessages({ title, description, tags }),
        max_tokens: 40,
        temperature: 0,
      });
      const got = normalizeSuggestedTags(out?.response ?? out?.result ?? '', { max });
      if (got.length) return got;
    } catch { /* fall through to the declared tags */ }
  }
  return declared;
}

/**
 * Suggest a topic key for a link preview, honoring the `classify` knob (ai | keyword | off) from the mirrored
 * syndication config. Returns the key or null; never throws.
 */
export async function suggestTopic(env, { title, description, tags, kv = env?.SIGNUP_KV } = {}) {
  if (!kv) return null;
  const vocab = await readTopicsVocab(kv);
  if (!Object.keys(vocab).length) return null;
  const mode = classifyMode(await readSyndicationConfig(kv));
  if (mode === 'off') return null;
  const input = { title, description, tags };
  if (mode === 'ai' && env?.AI?.run) {
    try {
      const out = await env.AI.run(env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct', {
        messages: buildTopicMessages(input, vocab),
        max_tokens: 12,
        temperature: 0,
      });
      const key = normalizeTopic(out?.response ?? out?.result ?? '', vocab);
      if (key) return key;
    } catch { /* fall through to the free keyword guess */ }
  }
  return keywordTopic(input, vocab);
}
