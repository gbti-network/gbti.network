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
import { classifyMode } from '../../membership/syndication-config.mjs';
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
