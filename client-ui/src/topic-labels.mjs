// The share's category pill on the extension's cards. A share stores one flat topic key from house/topics.yml
// ("music", "nextjs"); the website's feed card turns it into the vocabulary's label ("Music", "Next.js") at build
// time (src/lib/feed-items.ts topicLabel). The extension reads shares live from the Worker and has no build step to
// do that, so its cards showed only "SHARE". This reads the same vocabulary from the public /topics.json, once per
// page, and remembers it in localStorage (it is the same for everyone and holds nothing personal) so a new tab
// paints the pill on its first frame instead of popping it in.
import { topicsFromJson } from './topic-picker-core.mjs';
import { titleCase } from '../../membership/topics-vocab.mjs';

const TOPICS_URL = 'https://gbti.network/topics.json';
export const TOPIC_LABELS_KEY = 'gbti-topic-labels';

/** key -> label from a /topics.json payload (or the remembered `{ topics }` copy). An empty map when malformed. */
export function topicLabelMap(data) {
  const map = new Map();
  for (const t of topicsFromJson(data)) map.set(t.key, t.label);
  return map;
}

/**
 * The pill text for a share's topic key. The vocabulary's label when it lists the key; the key title-cased when the
 * vocabulary is loaded but does not list it, which is what the site prints for the same share (topicVocabLabel);
 * and '' while no vocabulary is known, so a first paint shows no pill rather than a wrong one ("Nextjs", "Aws").
 */
export function topicLabelFor(key, labels) {
  const k = typeof key === 'string' ? key.trim() : '';
  if (!k || !(labels instanceof Map) || !labels.size) return '';
  return labels.get(k) || titleCase(k);
}

/** True when two label maps say the same thing, so a refresh that changed nothing does not redraw the feed. */
export function sameTopicLabels(a, b) {
  if (!(a instanceof Map) || !(b instanceof Map) || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}

/** The remembered vocabulary, or an empty map (first run, storage blocked, or a damaged copy). */
export function rememberedTopicLabels() {
  try { return topicLabelMap(JSON.parse(localStorage.getItem(TOPIC_LABELS_KEY) || 'null')); } catch { return new Map(); }
}

let LOAD = null;

/** Fetch the vocabulary once per page and remember it. Resolves the map, or null on any failure (not cached, so a
 *  later call retries); the caller keeps whatever it already had. */
export function loadTopicLabels() {
  if (!LOAD) {
    LOAD = fetch(TOPICS_URL, { cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error(`http-${r.status}`); return r.json(); })
      .then((data) => {
        const map = topicLabelMap(data);
        if (!map.size) throw new Error('empty');
        try { localStorage.setItem(TOPIC_LABELS_KEY, JSON.stringify({ topics: [...map].map(([key, label]) => ({ key, label })) })); } catch { /* storage blocked */ }
        return map;
      })
      .catch(() => { LOAD = null; return null; });
  }
  return LOAD;
}
