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
