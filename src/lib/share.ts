// Programmatic social-share text builder (see .data/ops/share-ops/README.md). One schema per content
// type drives the lead sentence and the base discovery hashtags; the content's top-level category adds
// one more hashtag. Each platform gets text shaped to its norm: X carries hashtags (discovery), the
// messaging targets (WhatsApp / SMS) drop them as noise, Substack Notes keeps them. No SDKs, no trackers,
// every target is a plain intent URL or a copy string. Reused across prompt / post / product pages.

import { categoryLabel, topKey } from './taxonomy';

export type ShareType = 'prompt' | 'post' | 'product';

// Per-type share schema: the conversational lead and the base hashtags. Edit here to retune the voice
// or discovery tags for a whole content type in one place.
const SHARE_SCHEMA: Record<ShareType, { lead: string; hashtags: string[] }> = {
  prompt: { lead: 'Have a look at this AI prompt I found:', hashtags: ['gbti', 'aiprompts'] },
  post: { lead: 'Worth a read from GBTI Network:', hashtags: ['gbti', 'devblog'] },
  product: { lead: 'Check out this tool on GBTI Network:', hashtags: ['gbti', 'devtools'] },
};

/** Slugify any word/label into a bare hashtag token (letters + digits only, lowercased). '' if nothing usable. */
function hashtagToken(word: string): string {
  return (word || '').replace(/[^a-zA-Z0-9]+/g, '').toLowerCase();
}

export interface ShareInput {
  type: ShareType;
  title: string;
  url: string; // absolute, canonical URL (build from Astro.site)
  categories?: string[]; // taxonomy path; its top-level key becomes the category hashtag
}

export interface ShareLinks {
  lead: string; // the conversational lead sentence
  hashtags: string[]; // ['#gbti', '#aiprompts', '#ai'] — display form
  x: string; // X intent href (hashtags carried in the intent's hashtags param)
  whatsapp: string; // wa.me intent href (no hashtags)
  sms: string; // sms: URI (no hashtags)
  substackText: string; // copy string for the Substack Notes composer (keeps hashtags)
  plain: string; // generic full payload: "lead title url #tags"
}

/**
 * Build every share variant for one content item. Pure + framework-free, so it is unit-testable and the
 * same logic serves prompts, posts, and products. Platform shaping:
 *  - X: text = "lead title", url + hashtags ride their own intent params (hashtags help discovery).
 *  - WhatsApp / SMS: one combined "lead title url" string, NO hashtags (noise in a DM).
 *  - Substack: copy "lead title url #tags" (Notes supports hashtags); the page opens the composer.
 */
export function buildShare({ type, title, url, categories }: ShareInput): ShareLinks {
  const schema = SHARE_SCHEMA[type];
  const enc = encodeURIComponent;

  // Base hashtags + one category hashtag derived from the top-level taxonomy key (e.g. ai -> #ai).
  const catKey = topKey(categories);
  const catToken = catKey ? hashtagToken(categoryLabel(catKey)) : '';
  const tokens = [...schema.hashtags.map(hashtagToken), catToken].filter(Boolean);
  // De-dupe while preserving order (a base tag may equal the category, e.g. nothing overlaps today but stay safe).
  const seen = new Set<string>();
  const uniqueTokens = tokens.filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
  const hashtags = uniqueTokens.map((t) => `#${t}`);

  const lead = schema.lead;
  const headline = `${lead} ${title}`.trim(); // the human sentence, no url, no tags
  const messaging = `${headline} ${url}`.trim(); // WhatsApp / SMS: no hashtags
  const plain = `${messaging}${hashtags.length ? ' ' + hashtags.join(' ') : ''}`.trim();

  return {
    lead,
    hashtags,
    x: `https://twitter.com/intent/tweet?text=${enc(headline)}&url=${enc(url)}${
      uniqueTokens.length ? `&hashtags=${enc(uniqueTokens.join(','))}` : ''
    }`,
    whatsapp: `https://wa.me/?text=${enc(messaging)}`,
    sms: `sms:?&body=${enc(messaging)}`,
    substackText: plain,
    plain,
  };
}
