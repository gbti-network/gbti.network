// sow-190: strip known TRACKING parameters from a member-supplied outbound link (a share's url). A DENYLIST,
// never an allowlist and never a blanket query strip: a share is often a video whose query carries FUNCTIONAL
// params (YouTube's `v` is the video id, `t` a start timestamp, `list`/`start_radio` a playlist), and dropping
// those breaks both the destination AND the SOW-092 inline player (embedUrl in ./video-embed.mjs). So only
// tokens that are UNAMBIGUOUSLY tracking/attribution are removed here; ambiguous short ones (s, ref, feature,
// pp, spm, share_id) are deliberately LEFT for a later owner decision on how aggressive to be, and playlist
// context (list/start_radio) is left as functional. (Note: YouTube's attribution param is `si`; a pasted `is`
// is a typo for it and is left alone as an unknown param, not stripped.) Pure, node-free, imported by every host + the Astro site,
// mirroring the one-shared-extractor pattern of video-embed.mjs.
//
// Fails OPEN: a non-http(s) string, or an unparseable URL, is returned UNCHANGED (a bad link must still be
// shareable, never blocked by normalization). Preserves the original string EXACTLY when nothing is stripped
// (no gratuitous re-encoding of a clean url).

// Exact-match tracking keys (compared case-insensitively). Universally-recognized attribution/analytics only.
const TRACKING_KEYS = new Set([
  'si',          // YouTube per-share attribution token (the reported case)
  'fbclid',      // Facebook click id
  'gclid',       // Google Ads click id
  'igshid',      // Instagram share id
  'mc_cid',      // Mailchimp campaign id
  'mc_eid',      // Mailchimp recipient id
  'ab_channel',  // YouTube channel-attribution on a watch url
]);

// Prefix families (case-insensitive): utm_source, utm_medium, utm_campaign, utm_term, utm_content, ...
const TRACKING_PREFIXES = ['utm_'];

function isTrackingKey(key) {
  const k = String(key).toLowerCase();
  if (TRACKING_KEYS.has(k)) return true;
  return TRACKING_PREFIXES.some((p) => k.startsWith(p));
}

/**
 * Remove unambiguous tracking parameters from an http(s) URL. Returns the cleaned URL string, or the input
 * unchanged when it is not a parseable http(s) URL or carries no tracking parameter. Pure.
 */
export function stripTrackingParams(input) {
  const s = String(input ?? '').trim();
  if (!/^https?:\/\//i.test(s)) return s; // fail open: not an http(s) URL, leave it alone
  let u;
  try { u = new URL(s); } catch { return s; } // unparseable, leave it alone
  let changed = false;
  for (const key of [...u.searchParams.keys()]) {
    if (isTrackingKey(key)) { u.searchParams.delete(key); changed = true; }
  }
  if (!changed) return s; // nothing tracking: preserve the original string exactly (no re-encoding)
  const qs = u.searchParams.toString();
  u.search = qs ? `?${qs}` : ''; // drop a now-empty '?' so a fully-cleaned url is bare
  return u.toString();
}

// sow-364: the same denylist, run over the URLs inside a BODY. An assistant hands its citations back carrying
// its own tag (`?utm_source=chatgpt.com`, and the same shape from gemini, grok, claude and perplexity), so a
// note pasted out of one publishes with a tracking parameter on every link. `utm_` was already in the denylist
// above; the gap was that nothing ever ran it on text. ONE denylist, so a link in a note and the share's own
// url are cleaned by the same rule and there is no second list to drift.
//
// Fenced code and inline code spans are LEFT ALONE: a note may be documenting a URL rather than linking to it,
// and rewriting inside a code block changes what the author wrote. The build guard is defined as "this function
// changes nothing", so anything this deliberately skips is something the guard cannot then reject.

// A URL run inside markdown. It stops at whitespace and at the characters that close a markdown construct, so
// `](url)`, `<url>` and `[1]: url "title"` all yield the url and nothing else. A URL containing a literal `)`
// (a Wikipedia article) is cut short at that paren, which fails open: the truncated run carries no query, so
// nothing is rewritten and the line is preserved exactly.
const TEXT_URL_RE = /https?:\/\/[^\s<>"'`)\]]+/gi;
// Sentence punctuation that follows a bare URL rather than belonging to it. Without this, a trailing full stop
// is parsed as part of the query and swallowed when the parameter is stripped.
const TRAILING_PUNCT_RE = /[.,;:!?*_~]+$/;
// An inline code span, kept whole. Backtick runs of any length, as CommonMark allows.
const CODE_SPAN_RE = /(`+)(?:[^`]|(?!\1)`)*\1/g;

function cleanUrlsInProse(text) {
  return text.replace(TEXT_URL_RE, (run) => {
    const punct = (TRAILING_PUNCT_RE.exec(run) || [''])[0];
    const url = punct ? run.slice(0, run.length - punct.length) : run;
    const cleaned = stripTrackingParams(url);
    return cleaned === url ? run : cleaned + punct;
  });
}

/**
 * Strip tracking parameters from every URL in a markdown body. Returns the text unchanged, byte for byte, when
 * nothing is stripped. Pure, node-free, and safe on any input: it never throws and never drops content.
 */
export function stripTrackingParamsInText(input) {
  const src = String(input ?? '');
  if (!src || !/https?:\/\//i.test(src)) return src;
  const lines = src.split('\n');
  let fence = 0;
  for (let i = 0; i < lines.length; i++) {
    const f = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (f) {
      if (!fence) fence = f[1].length;
      else if (f[1].length >= fence && !f[2].trim()) fence = 0;
      continue;
    }
    if (fence) continue;
    const line = lines[i];
    if (!/https?:\/\//i.test(line)) continue;
    // Split the line into code spans (kept) and prose (cleaned), so a documented URL survives inside backticks.
    let out = '';
    let last = 0;
    CODE_SPAN_RE.lastIndex = 0;
    let m;
    while ((m = CODE_SPAN_RE.exec(line))) {
      out += cleanUrlsInProse(line.slice(last, m.index)) + m[0];
      last = m.index + m[0].length;
    }
    out += cleanUrlsInProse(line.slice(last));
    lines[i] = out;
  }
  return lines.join('\n');
}
