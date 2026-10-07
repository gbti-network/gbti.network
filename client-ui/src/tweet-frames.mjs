// sow-261: turns each tweet block a renderer emitted (client/src/tweet-embed.mjs tweetBlockHtml, or the site build's
// <div class="md-tweet"><a href=...>) into the live tweet. Used by every comment surface (the discussion, the website's
// pending-comment cards, a members comment's locked body, the built comment list) and by the two share views.
//
// The block shows its plain link until the tweet reports a size; then the frame takes the tweet's height and the link
// hides. X answering "no_results" (a deleted or private tweet) removes the frame and leaves the link. A tweet that is
// slow to answer keeps its frame and swaps in whenever it does: giving up would gain nothing (the link is already
// showing) and would lose a tweet that arrives late (measured 2026-10-06: a relayed frame now and then answered after
// 15 seconds in a loaded browser). The block is marked data-tweet-why="slow" past the threshold, for diagnosis.
// On a chrome-extension:// page the frame is the site's https /embed/ relay (the relay frames X
// and forwards its size), since an extension page sends no referrer; on the website it is X's frame directly.
import { tweetId, tweetFrameUrl, tweetTheme, parseTweetMessage, TWEET_FRAME_ORIGIN } from '../../client/src/tweet-embed.mjs';

export const TWEET_RELAY = 'https://gbti.network/embed/';
export const TWEET_RELAY_ORIGIN = 'https://gbti.network';
export const TWEET_SLOW_MS = 15000;

/** The tweet block's look, for a component's shadow root (the website's built list carries the same rules globally). */
export const TWEET_CSS = `
  .md-tweet { margin:.6em 0 1em; max-width:550px; }
  /* color-scheme:normal matches X's own page, so the frame stays transparent; inheriting a dark page's scheme makes
     Chrome paint an opaque white backdrop, which showed as white corners around the dark tweet (measured 2026-10-06). */
  .md-tweet > iframe { display:block; width:100%; height:0; border:0; overflow:hidden; background:transparent; color-scheme:normal; }
  .md-tweet.is-ready > a { display:none; }
  .md-tweet-share:not(.is-ready) { margin:0; }
`;

/**
 * sow-444 (owner, 2026-10-06): in a COMMENT, an embed sits under the avatar and runs card edge to card edge. A comment
 * container declares how far its text column sits in from its edges, --embed-out-l (left padding + avatar + gap) and
 * --embed-out-r (right padding); a ready tweet and a video poster break out by those amounts. Unset (anywhere else)
 * they are 0. X renders a tweet at most 550px wide, flush left (measured 2026-10-06), so the frame is capped at 550px
 * and centred when the card is wider (the owner's choice); a portrait video keeps its 360px frame, centred. Only comment
 * surfaces include this, and after TWEET_CSS and EMBED_POSTER_CSS, whose rules it overrides.
 */
export const COMMENT_EMBED_CSS = `
  .md-tweet.is-ready { margin-left:calc(-1 * var(--embed-out-l, 0px)); margin-right:calc(-1 * var(--embed-out-r, 0px)); max-width:none; }
  .md-tweet.is-ready > iframe { max-width:550px; margin-inline:auto; }
  .md-embed { width:auto; margin-left:calc(-1 * var(--embed-out-l, 0px)); margin-right:calc(-1 * var(--embed-out-r, 0px)); }
  .md-embed.md-embed-portrait { width:min(360px, calc(100% + var(--embed-out-l, 0px) + var(--embed-out-r, 0px))); max-width:none; margin-right:0; margin-left:calc(max(0px, (100% + var(--embed-out-l, 0px) + var(--embed-out-r, 0px) - 360px) / 2) - var(--embed-out-l, 0px)); }
`;

/** The page's theme: the html data-theme the site and the extension both set, else the OS preference. */
export function pageTheme(doc = globalThis.document) {
  const t = doc?.documentElement?.getAttribute?.('data-theme');
  if (t === 'dark' || t === 'light') return t;
  try { return globalThis.matchMedia?.('(prefers-color-scheme: dark)')?.matches ? 'dark' : 'light'; } catch { return 'light'; }
}

/** Whether frames on this page go through the relay: forced by `via`, else only on an extension page. */
export function usesRelay(via = 'auto', protocol = globalThis.location?.protocol) {
  if (via === 'relay') return true;
  if (via === 'direct') return false;
  return protocol === 'chrome-extension:';
}

/** The src for one tweet frame. */
export function tweetFrameSrc(url, { relay, theme }) {
  if (relay) return `${TWEET_RELAY}?u=${encodeURIComponent(url)}&theme=${tweetTheme(theme)}`;
  return tweetFrameUrl(url, { theme });
}

// One window listener for every frame on the page, keyed by the frame's window (a WindowProxy keeps its identity across
// the frame's navigation, so the key set at creation still matches once X's page loads in it).
const FRAMES = new Map();
// The last height each tweet reported. A component re-render (a fold, a delete) rebuilds its blocks, so a known tweet
// takes its height and shows at once instead of flashing back to the link while X reloads it.
const HEIGHTS = new Map();
let listening = false;

function onMessage(e) {
  const rec = FRAMES.get(e.source);
  if (!rec || e.origin !== rec.origin) return; // only this frame's own origin, never a look-alike
  const m = parseTweetMessage(e.data);
  if (!m) return;
  if (m.method === 'no_results') { drop(rec, 'no_results'); return; }
  if (m.method === 'resize') { rec.iframe.style.height = `${m.height}px`; HEIGHTS.set(rec.id, m.height); }
  if (!rec.ready && (m.method === 'rendered' || m.method === 'resize')) {
    rec.ready = true;
    clearTimeout(rec.timer);
    rec.el.classList.add('is-ready');
    rec.el.removeAttribute('data-tweet-why');
    try { rec.onReady?.(rec.el); } catch { /* a caller's hook never breaks the frame */ }
  }
}

// X has nothing to show: the frame goes and the link stays, with the reason kept on the block.
function drop(rec, why) {
  clearTimeout(rec.timer);
  HEIGHTS.delete(rec.id);
  FRAMES.delete(rec.iframe.contentWindow);
  rec.iframe.remove();
  rec.el.classList.remove('is-ready');
  rec.el.classList.add('is-missing');
  rec.el.setAttribute('data-tweet-why', why);
}

/**
 * Give every unwired tweet block under `root` its frame. Safe to call after every render: a wired block is skipped.
 * @param {ParentNode} root  a document, element or shadow root
 * @param {{ via?: 'auto'|'relay'|'direct', theme?: string, onReady?: (el: Element) => void, slowMs?: number }} [opts]
 * @returns {number} how many blocks were wired
 */
export function wireTweets(root, { via = 'auto', theme, onReady, slowMs = TWEET_SLOW_MS } = {}) {
  if (!root?.querySelectorAll || typeof document === 'undefined') return 0;
  const relay = usesRelay(via);
  const origin = relay ? TWEET_RELAY_ORIGIN : TWEET_FRAME_ORIGIN;
  for (const [win, rec] of FRAMES) if (!rec.iframe.isConnected) { clearTimeout(rec.timer); FRAMES.delete(win); } // re-rendered away
  let n = 0;
  for (const el of root.querySelectorAll('.md-tweet:not([data-tweet-wired])')) {
    const url = el.getAttribute('data-tweet-url') || el.querySelector('a[href]')?.getAttribute('href') || '';
    const id = tweetId(url);
    if (!id) continue;
    el.setAttribute('data-tweet-wired', '');
    const iframe = document.createElement('iframe');
    iframe.title = 'Post on X';
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('allowtransparency', 'true');
    iframe.src = tweetFrameSrc(url, { relay, theme: theme || pageTheme() });
    el.appendChild(iframe);
    const rec = { el, iframe, id, origin, onReady, ready: false, timer: null };
    FRAMES.set(iframe.contentWindow, rec);
    const known = HEIGHTS.get(id);
    if (known) { // shown at once at its last height; X's own messages still confirm it, or remove it
      iframe.style.height = `${known}px`;
      el.classList.add('is-ready');
      rec.ready = true;
      try { onReady?.(el); } catch { /* a caller's hook never breaks the frame */ }
    }
    if (!rec.ready) rec.timer = setTimeout(() => { if (!rec.ready) el.setAttribute('data-tweet-why', 'slow'); }, slowMs); // never gives up
    n++;
  }
  if (n && !listening) { globalThis.addEventListener?.('message', onMessage); listening = true; }
  return n;
}
