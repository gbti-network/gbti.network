// sow-270 Phase 5: the one shell every Worker-served mail page renders into.
//
// WHY THIS EXISTS. mail-subscribe.mjs and membership-unsubscribe.mjs each carried their own copy of the same
// page() helper, feeding fifteen call sites between them. At the moment of extraction the two copies were BYTE
// IDENTICAL, which is the good case and also the reason to act: two copies that agree today are two copies that
// disagree after the next edit to one of them, and nothing would have reported it. These pages are what a
// subscriber sees after clicking a link in an email, so a subscribe confirmation quietly looking different from
// an unsubscribe confirmation is a trust problem rather than a tidiness one.
//
// NODE-FREE and dependency-free. It runs inside the Worker, which cannot reach the site's stylesheets or fonts,
// so every style is inlined here and there is no build step to add one. Do not import anything into this file
// that is not available in a Worker.
//
// NO CHANGE OF APPEARANCE WAS MADE IN THE EXTRACTION. The markup, the styles and the headers are the ones both
// copies already emitted, and a test renders a corpus through this module and compares it against a snapshot
// taken from the old helper before it was removed, so the refactor is provably shell-only.

const str = (v) => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The escaping used for anything interpolated into a page. Identical in behaviour to the two copies it
 *  replaces, which differed only in how they coerced a non-string.
 *
 *  Carried over from the unsubscribe copy, whose note is worth keeping: the hash and token that reach these
 *  pages are machine-validated already (64 hex characters, and base64url), so this is defence in depth rather
 *  than the primary guard. */
export function escapePage(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** no-store because these pages are keyed by a one-time token, and no-referrer so a token in the address bar is
 *  never handed to whatever the page links to. */
export const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
};

/** The page as a string. Pure, so it can be diffed against a snapshot without constructing a Response. */
export function pageHtml(title, bodyHtml) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="referrer" content="no-referrer">`
    + `<title>${escapePage(title)}</title>`
    + `<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
    + `max-width:34rem;margin:4rem auto;padding:0 1.25rem;line-height:1.55;color:#25232b;background:#fff}`
    + `h1{font-size:1.4rem;margin:0 0 .75rem}p{margin:.5rem 0}`
    + `button{font:inherit;font-weight:600;padding:.6rem 1.1rem;border:0;border-radius:.5rem;`
    + `background:#1f9e5f;color:#fff;cursor:pointer}button:hover{background:#188a51}`
    + `.muted{color:#6c6976;font-size:.9rem}</style></head><body>${bodyHtml}</body></html>`;
}

/** The page as a Response, which is what every call site wants. */
export function pageResponse(title, bodyHtml, status = 200) {
  return new Response(pageHtml(title, bodyHtml), { status, headers: PAGE_HEADERS });
}

// ---------------------------------------------------------------------------------------------------------
// sow-270 Phase 6: the FULL STOP page.
//
// The plain shell above is right for a page that reports something (an expired link, a method not allowed).
// It is wrong for the page a reader lands on after confirming, which is the end of the journey and the first
// impression the network makes. That one follows the reference the owner supplied on 2026-08-23: the mark
// alone above the panel, one tinted panel holding everything, a single large icon in the brand colour, a warm
// oversized headline, then two or three centered lines.
//
// THE COPY HAS TO DO REAL WORK RATHER THAN CONFIRM TWICE. The headline already says it worked, so the lines
// underneath tell the reader what they could not otherwise know: when the mail arrives, and what to do if it
// does not appear. Tuesday is honest, not aspirational: the compile runs on the Tuesday crons at 7 AM Central.
//
// NO NAVIGATION, NO FOOTER, NO LINKS OUT, by the same reference. The page is an ending, and every link on it
// is an invitation to leave before reading the two lines that matter.
// ---------------------------------------------------------------------------------------------------------

/** The GBTI wordmark, as text. The Worker cannot reach the site assets, and the mail templates already render
 *  the mark this way, so the page and the email that led to it agree. */
const WORDMARK = `<div class="mk">GBTI <span>Network</span></div>`;

/** One check inside a circle, in the brand green. Drawn inline because there is nothing to link to, and chosen
 *  rather than borrowed: the reference's own glyph is theirs. */
const ICON_CHECK = `<svg viewBox="0 0 48 48" width="84" height="84" role="img" aria-label="Confirmed" focusable="false">`
  + `<circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3"></circle>`
  + `<path d="M14.5 24.5l6.5 6.5 12.5-13.5" fill="none" stroke="currentColor" stroke-width="4"`
  + ` stroke-linecap="round" stroke-linejoin="round"></path></svg>`;

const PANEL_CSS = `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;`
  + `margin:0;padding:3rem 1.25rem 4rem;line-height:1.55;color:#25232b;background:#fff}`
  + `.mk{text-align:center;font-family:'Trebuchet MS',Verdana,sans-serif;font-size:1.35rem;font-weight:700;`
  + `color:#232029;margin:0 auto .5rem;max-width:44rem}.mk span{color:#187a4b}`
  + `.pnl{max-width:44rem;margin:0 auto;background:#eef6f0;padding:3rem 2rem 3.25rem;text-align:center}`
  + `.ic{color:#4fb07d;line-height:0;display:block;margin:0 auto 1.9rem}`
  + `h1{font-size:2.35rem;line-height:1.15;margin:0 0 1.5rem;color:#232029;letter-spacing:-.01em}`
  + `.pnl p{margin:0 auto .9rem;max-width:30rem;font-size:1.125rem;line-height:1.7;color:#3f3b48}`
  + `.pnl p:last-child{margin-bottom:0}`
  + `button{font:inherit;font-weight:600;padding:.6rem 1.1rem;border:0;border-radius:.5rem;`
  + `background:#1f9e5f;color:#fff;cursor:pointer}button:hover{background:#188a51}`
  + `@media (max-width:30rem){.pnl{padding:2.25rem 1.25rem 2.5rem}h1{font-size:1.85rem}.pnl p{font-size:1.05rem}}`;

/**
 * The tinted-panel page.
 *
 * @param {string} title     the document title.
 * @param {object} a
 * @param {string} a.heading the oversized headline.
 * @param {string[]} a.lines centered lines under it, each already plain text (escaped here).
 * @param {string} [a.icon]  inline svg; defaults to the check.
 * @param {string} [a.extra] trusted markup appended inside the panel, for the no-script confirm form.
 */
export function panelPage(title, { heading, lines = [], icon = ICON_CHECK, extra = '' } = {}) {
  const body = WORDMARK
    + `<div class="pnl">`
    + `<span class="ic">${icon}</span>`
    + `<h1>${escapePage(heading)}</h1>`
    + lines.map((l) => `<p>${escapePage(l)}</p>`).join('')
    + extra
    + `</div>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">`
    + `<meta name="viewport" content="width=device-width, initial-scale=1">`
    + `<meta name="referrer" content="no-referrer">`
    + `<title>${escapePage(title)}</title>`
    + `<style>${PANEL_CSS}</style></head><body>${body}</body></html>`;
}

/** The panel page as a Response, with the same headers every other mail page carries. */
export function panelResponse(title, opts, status = 200) {
  return new Response(panelPage(title, opts), { status, headers: PAGE_HEADERS });
}
