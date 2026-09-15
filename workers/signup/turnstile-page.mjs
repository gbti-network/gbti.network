// The page a BROWSER gets when /signup/start refuses its Turnstile token (sow-339, 2026-09-15).
//
// A token is single use and lives five minutes, and the Worker verifies it before anything else. A person who lands
// here has almost always just spent their own token: a second tap on the claim button while the phone was still
// navigating, Back from GitHub and another tap, or a reload of this very page. Measured on 2026-09-15: a colleague's
// first tap was accepted at 21:21:44 UTC and sent on to GitHub, and the next two requests, three and seven seconds
// later, carried the same token and were refused. What they saw was `{"error":"turnstile_failed"}` in a phone
// browser, which reads as "signup is broken". This page says what happened and where to go. A script caller keeps
// the JSON it always had: only a navigation (Accept: text/html) gets this.
//
// Nothing from the request reaches the page unescaped. The only request-derived value is the back link, and it is
// used only when it sits on the site's own origin; anything else falls back to the membership page.

/** True when the request is a browser navigation rather than a script call. */
export function wantsHtml(request) {
  const accept = request?.headers?.get?.('Accept') || '';
  return /text\/html/i.test(accept);
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/**
 * Where "Go back" points: the referring page when it is on the site (the browser sends at least the origin for a
 * same-site navigation), else the membership page. Never a foreign origin, whatever the Referer header says.
 */
export function backLinkFor(request, env) {
  const site = String(env?.SITE_BASE_URL || 'https://gbti.network').replace(/\/+$/, '');
  const referer = String(request?.headers?.get?.('Referer') || '');
  if (referer === site || referer.startsWith(`${site}/`)) return referer;
  return `${site}/membership/`;
}

/** The whole page. Inline styles only: this Worker serves no assets and the page must read on any phone. */
export function turnstileRejectedPage(request, env) {
  const back = esc(backLinkFor(request, env));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Sign-in link already used</title>
<style>
  body { margin: 0; padding: 32px 20px; background: #f6f5f8; color: #25232b; font: 16px/1.55 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 480px; margin: 0 auto; background: #fff; border-radius: 14px; padding: 28px 24px; box-shadow: 0 8px 30px rgba(37, 35, 43, .08); }
  h1 { font-size: 22px; line-height: 1.25; margin: 0 0 12px; }
  p { margin: 0 0 14px; }
  a.btn { display: inline-block; margin-top: 6px; padding: 12px 20px; border-radius: 10px; background: #1f9e5f; color: #fff; text-decoration: none; font-weight: 700; }
  a.btn:hover { background: #18854f; }
  .muted { color: #6c6976; font-size: 14px; }
</style>
</head>
<body>
<main>
  <h1>That sign-in link was already used</h1>
  <p>A sign-in link works once and for five minutes. This one was spent already, usually by a second tap on the button, by going back and tapping again, or by reloading this page.</p>
  <p>Go back to the page you came from, reload it so the check runs again, and tap the button once. The next page you see should be GitHub asking you to sign in.</p>
  <p><a class="btn" href="${back}" data-back>Go back</a></p>
  <p class="muted">If this keeps happening, tell us where you tapped and what phone you are on.</p>
</main>
<script>
  // The referring page is the better place to land when the browser still has it in history.
  (function () {
    var a = document.querySelector('[data-back]');
    if (a && window.history && window.history.length > 1) {
      a.addEventListener('click', function (e) { e.preventDefault(); window.history.back(); });
    }
  })();
</script>
</body>
</html>
`;
}
