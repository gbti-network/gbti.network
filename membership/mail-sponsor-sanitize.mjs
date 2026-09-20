// sow-266 Phase 3: the sponsor block's markup, made safe to put in an inbox.
//
// WHY A NEW ONE, when the repository already has a sanitizer. `src/lib/markdown-sanitize.mjs` is a rehype
// plugin set that runs inside the Astro build; it depends on hast and it cannot be called from the mail
// renderer, which is pure and node-free by contract. The other precedent, the call-to-action card
// (membership/cta-card-render.mjs), passes partner markup through UNSANITIZED and leans on a per-card host
// allowlist wired into the page's content security policy. **An email client has no content security policy.**
// Copying that shape into the digest would put a sponsor's markup into inboxes with nothing between.
//
// WHAT THIS IS FOR, and it is not defence against the person typing it. Only a superadmin can set this field.
// It is defence against what a SPONSOR hands them: a snippet with a tracking pixel, an analytics script, a
// <style> block that reflows the whole mail, a form. Those arrive in good faith and would ship by accident.
//
// ALLOWLIST, NOT DENYLIST. Anything not named below is removed, so a tag nobody thought about fails closed.
// Elements are unwrapped rather than deleted, keeping their text, except for the few whose CONTENT is the
// danger (script, style) which are removed whole.

/** Tags a sponsor block may use. Deliberately small: this is one paragraph and a picture, not a page. */
const ALLOWED = new Set(['a', 'b', 'strong', 'i', 'em', 'br', 'p', 'span', 'small', 'img']);

/** Tags whose CONTENT must go with them, rather than being unwrapped into the mail as text. */
const DROP_WITH_CONTENT = ['script', 'style', 'iframe', 'object', 'embed', 'form', 'noscript', 'svg', 'template'];

/** Per-tag attribute allowlist. Everything else, including every on* handler, is dropped. */
const ATTRS = {
  a: ['href', 'title'],
  img: ['src', 'alt', 'width', 'height'],
  p: [],
  span: [],
  small: [],
  b: [], strong: [], i: [], em: [], br: [],
};

const isHttps = (v) => /^https:\/\/[^\s"'<>]+$/i.test(v);
const isMailto = (v) => /^mailto:[^\s"'<>]+$/i.test(v);
const isDigits = (v) => /^[0-9]{1,4}$/.test(v);

const escapeAttr = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * Is this attribute keepable on this tag, and what is its safe value? Returns null to drop it.
 *
 * NO http, NO protocol-relative, NO data: and NO javascript:. https or mailto, nothing else. A tracking pixel
 * served over http would also strip the reader's transport security on a click.
 */
function attrValue(tag, name, raw) {
  const value = String(raw ?? '').trim();
  if (!value) return null;
  if (tag === 'a' && name === 'href') return (isHttps(value) || isMailto(value)) ? value : null;
  if (tag === 'img' && name === 'src') return isHttps(value) ? value : null;
  if (name === 'width' || name === 'height') return isDigits(value) ? value : null;
  if (name === 'alt' || name === 'title') return value.slice(0, 200);
  return null;
}

/**
 * The sponsor markup, reduced to what is safe to send. Pure, node-free, and deterministic.
 *
 * A LINK ALWAYS LEAVES WITH rel and target. A sponsor link is an advertisement, so it is marked as sponsored
 * for the same reason the site marks its outbound links, and it opens away from the mail client's own frame.
 */
export function sanitizeSponsorHtml(input) {
  let html = typeof input === 'string' ? input : '';
  if (!html.trim()) return '';

  // 1. Remove the elements whose content is the problem, opening tag through closing tag.
  //
  // AN UNCLOSED ONE TAKES THE REST OF THE INPUT WITH IT. Removing only the tag would unwrap its body into the
  // mail as visible text, so `<script>alert(1)` with no closing tag would print "alert(1)" inside the sponsor
  // block. Inert, but it is somebody's code showing up as copy. Where the end cannot be located, the safe
  // reading is that everything after it is content.
  for (const tag of DROP_WITH_CONTENT) {
    const whole = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}\\s*>`, 'gi');
    const toEnd = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*$`, 'i');
    const stray = new RegExp(`<\\/${tag}\\s*>`, 'gi');
    html = html.replace(whole, '').replace(toEnd, '').replace(stray, '');
  }
  // 2. Comments, which can carry conditional markup that some clients execute.
  html = html.replace(/<!--[\s\S]*?-->/g, '');

  // 3. Every remaining tag is rebuilt from the allowlist, or unwrapped.
  const rewritten = html.replace(/<\/?([a-zA-Z][a-zA-Z0-9-]*)\b([^>]*)>/g, (_m, rawTag, rawAttrs) => {
    const tag = String(rawTag).toLowerCase();
    if (!ALLOWED.has(tag)) return ''; // unwrapped: the text inside it survives, the element does not
    if (_m.startsWith('</')) return `</${tag}>`;

    const keep = [];
    const allowed = ATTRS[tag] || [];
    // Attributes are re-read from the raw string rather than trusted as written, so an odd quoting style
    // cannot smuggle one through. Anything not matched by this is not an attribute we keep.
    const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
    let m;
    while ((m = re.exec(String(rawAttrs ?? ''))) !== null) {
      const name = m[1].toLowerCase();
      if (!allowed.includes(name)) continue; // drops every on* handler, style, class, id, srcset, data-*
      const value = attrValue(tag, name, m[3] ?? m[4] ?? m[5]);
      if (value !== null) keep.push(`${name}="${escapeAttr(value)}"`);
    }
    if (tag === 'a') {
      // A link with nothing safe to point at stops being a link, rather than becoming an empty one.
      if (!keep.some((a) => a.startsWith('href='))) return '';
      keep.push('target="_blank"', 'rel="noopener nofollow sponsored"');
    }
    if (tag === 'img' && !keep.some((a) => a.startsWith('src='))) return '';
    if (tag === 'br') return '<br />';
    return `<${tag}${keep.length ? ' ' + keep.join(' ') : ''}>`;
  });

  // 4. Anything still holding a `<` is malformed: a truncated tag like `<scr`, left behind when a nested or
  //    re-formed element was removed around it. Every well formed tag has already been rewritten into the
  //    small set below, so a `<` that does not begin one of those is text, and is escaped as text rather than
  //    shipped as markup an email client has to guess at.
  return rewritten.replace(/</g, (m, i, whole) => (EMITTED_AT.test(whole.slice(i)) ? '<' : '&lt;'));
}

/** The only tags step 3 can emit, used to tell a real tag from the wreckage of a removed one. */
const EMITTED_AT = /^<\/?(?:a|b|strong|i|em|br|p|span|small|img)\b/;

/**
 * The plain-text alternative for the sponsor block: its words, and the address of any link it carried.
 *
 * The text part of a mail is not a lesser copy, it is what a text-only client shows, so a sponsor paying for a
 * placement gets their line there too. Built from the SANITIZED markup, never the raw input, so a stripped
 * script cannot reappear in the text half.
 */
export function sponsorText(input) {
  const safe = sanitizeSponsorHtml(input);
  if (!safe) return '';
  const hrefs = [];
  for (const m of safe.matchAll(/<a\s[^>]*href="([^"]+)"/gi)) hrefs.push(m[1].replace(/&amp;/g, '&'));
  const words = safe
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  const unique = [...new Set(hrefs)];
  return [words, ...unique].filter(Boolean).join(' ');
}
