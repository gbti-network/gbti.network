// sow-261: the ONE tweet-link reader, shared by both comment renderers (client/src/markdown.mjs and the site build's
// remark pass), the /embed/ relay, the tweet frame wiring (client-ui/src/tweet-frames.mjs) and the share views, so a
// tweet link resolves identically everywhere. Pure, node-free and unit-tested.
//
// Owner rulings: 2026-09-22, an X share shows the live tweet (extension reader and website share page); 2026-10-06, a
// comment line that is only a tweet link embeds the tweet too, on both surfaces. Embedding needs no script from X:
// https://platform.twitter.com/embed/Tweet.html is the frame X's own script would create, and framed alone it posts
// its size to the parent (measured 2026-10-06: twttr.private.resize { width, height }, then twttr.private.rendered;
// a deleted or unknown id posts twttr.private.no_results instead).

/** The origin X's tweet frame lives on, and the only origin whose messages the wiring trusts for a direct frame. */
export const TWEET_FRAME_ORIGIN = 'https://platform.twitter.com';

// x.com or twitter.com (www. and mobile. too), a handle of 1 to 15 word characters or the i/web form, /status/ (or the
// older /statuses/), a numeric id, then optionally a sub-path (/photo/1, /video/1), a query (?s=20) or a fragment.
const TWEET_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/(?:[A-Za-z0-9_]{1,15}|i\/web)\/status(?:es)?\/(\d{5,25})(?:[/?#]\S*)?$/i;

/** The numeric id of a tweet link, or null for anything that is not one. */
export function tweetId(url) {
  const m = String(url ?? '').trim().match(TWEET_RE);
  return m ? m[1] : null;
}

/**
 * A line that is NOTHING but a tweet link, the same rule bareVideoLine applies to video: both comment renderers turn
 * such a line into the tweet block. Returns the trimmed URL, or null. A link with words around it stays a link.
 */
export function bareTweetLine(line) {
  const s = String(line ?? '').trim();
  if (!/^https?:\/\/\S+$/.test(s)) return null;
  return tweetId(s) ? s : null;
}

/** The light or dark theme a frame is asked for; anything else is light. */
export const tweetTheme = (t) => (t === 'dark' ? 'dark' : 'light');

/** X's own tweet frame for an id or a tweet link, in a theme; null when neither is a tweet. dnt asks X not to track. */
export function tweetFrameUrl(idOrUrl, { theme = 'light' } = {}) {
  const raw = String(idOrUrl ?? '').trim();
  const id = /^\d{5,25}$/.test(raw) ? raw : tweetId(raw);
  if (!id) return null;
  return `${TWEET_FRAME_ORIGIN}/embed/Tweet.html?id=${id}&theme=${tweetTheme(theme)}&dnt=true`;
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * The tweet block a comment renderer emits for a bare tweet line: the plain link, inside a box the wiring later adds
 * the frame to. With no wiring, or when X has nothing to show, the reader still has the link. data-embed-url lets the
 * prose editor read the block back as the URL line it came from, as it does for a video poster.
 */
export function tweetBlockHtml(url) {
  const u = String(url ?? '').trim();
  if (!tweetId(u)) return '';
  const e = escAttr(u);
  return `<div class="md-tweet" data-tweet-url="${e}" data-embed-url="${e}"><a href="${e}" target="_blank" rel="noopener nofollow">${e}</a></div>`;
}

/**
 * Read a message from a tweet frame: X's own JSON-RPC message (a string or an object under "twttr.embed"), or the
 * relay's forwarded one ({ gbtiTweet: { method, height } }). Returns { method: 'resize' | 'rendered' | 'no_results',
 * height? }, or null for anything else. The caller checks the message's origin and source; this only reads its shape.
 */
export function parseTweetMessage(data) {
  let d = data;
  if (typeof d === 'string') {
    if (d.length > 20000 || (!d.includes('twttr.embed') && !d.includes('gbtiTweet'))) return null;
    try { d = JSON.parse(d); } catch { return null; }
  }
  if (!d || typeof d !== 'object') return null;
  const fwd = d.gbtiTweet;
  if (fwd && typeof fwd === 'object') return shaped(fwd.method, fwd.height);
  const rpc = d['twttr.embed'];
  if (!rpc || typeof rpc !== 'object' || typeof rpc.method !== 'string') return null;
  const method = rpc.method.replace(/^twttr\.private\./, '');
  const p = Array.isArray(rpc.params) ? rpc.params[0] : null;
  return shaped(method, p && p.height);
}

function shaped(method, height) {
  if (method === 'rendered' || method === 'no_results') return { method };
  if (method !== 'resize') return null;
  const h = Number(height);
  return Number.isFinite(h) && h > 0 && h < 20000 ? { method, height: Math.ceil(h) } : null;
}
