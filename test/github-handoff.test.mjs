// sow-442 (owner, 2026-10-03; design of record: the "GitHub Hand-off" canvas): prepare people for the GitHub step on
// the invite pages' shared claim box and on the sign-in page. A week of sign-in records (2026-09-26 to 2026-10-02) had
// only two of five probably-new people through GitHub on the first try: they pressed a button that never named GitHub,
// saw no feedback, met GitHub's own sign-in and approval screens, and went back. These pins hold the label, the "What
// happens next" box, the held state with its 15-second way out, the desktop hero button, and the Welcome back note.
// The single-use token handling they sit on is pinned separately (test/turnstile-single-use.test.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const LANDER = 'src/components/invite/InviteLander.astro';
const LOGIN = 'src/pages/login.astro';
const between = (src, from, to) => { const a = src.indexOf(from); const b = src.indexOf(to, a + from.length); return a >= 0 && b > a ? src.slice(a, b) : ''; };

test('the claim button names GitHub and shows its logo; the hero button does too on desktop only', () => {
  const s = read(LANDER);
  assert.match(s, /claimCtaLabel = 'Claim with GitHub',/, 'the default label');
  const claim = between(s, '<button id="signup-go"', '</button>');
  assert.match(claim, /<span class="ci-idle"><svg class="ci-gh" viewBox="0 0 24 24" aria-hidden="true"><use href="#ico-github" \/><\/svg>\{claimCtaLabel\}<\/span>/);
  assert.match(claim, /<span class="ci-busy"><span class="ci-spin" aria-hidden="true"><\/span>Taking you to GitHub&hellip;<\/span>/);
  const hero = between(s, '<a href="#claim" class="btn-primary ci-hero-claim" data-hero-claim>', '</a>');
  assert.match(hero, /<span class="ci-lbl-wide"><svg class="ci-gh"[^>]*><use href="#ico-github" \/><\/svg>\{claimCtaLabel\}<\/span><span class="ci-lbl-narrow">\{hero\.ctaLabel\}<\/span>/, 'wide: the claim label; narrow: the page\'s own');
  assert.match(s, /@media \(max-width: 960px\) \{ \.ci \.ci-lbl-wide \{ display: none; \} \.ci \.ci-lbl-narrow \{ display: inline; \} \}/, 'the switch is the hero\'s own breakpoint');
  assert.match(s, /var wide = window\.matchMedia \? window\.matchMedia\('\(min-width: 961px\)'\) : null;/, 'the script uses the same breakpoint');
});

test('the desktop hero button starts the claim when the check passed, and points at the check when not', () => {
  const s = read(LANDER);
  const h = between(s, "if (heroBtn) heroBtn.addEventListener('click', function (e) {", '});');
  assert.match(h, /if \(!wide \|\| !wide\.matches\) return;\s*\n\s*e\.preventDefault\(\);/, 'a narrow screen keeps the scroll');
  assert.match(h, /if \(btn && btn\.dataset\.token\) \{ btn\.click\(\); return; \}/, 'the same path as the claim button, token handling included');
  assert.match(h, /claimBox\.classList\.add\('ci-attn'\);/);
  assert.match(h, /tickNote\.hidden = false;/);
  assert.match(s, /<p class="ci-tick" data-ts-tick hidden>Tick the box above, then press \{claimCtaLabel\}\.<\/p>/);
  assert.match(s, /\.ci \.ci-claim\.ci-attn \{ box-shadow:/);
});

test('a press holds both buttons with a spinner, and a page that never leaves gets its button back in 15 seconds', () => {
  for (const [p, label] of [[LANDER, 'invite'], [LOGIN, 'sign-in']]) {
    const s = read(p);
    assert.match(s, /window\.gbtiTurnstileReset\(\);\n\s*showPending\(\);\n\s*var u = new URL\(signupBase \+ '\/signup\/start'\);/, `${label}: held right after the token is spent, before the navigation`);
    const fallback = between(s, 'function showPending() {', '\n    }\n') || between(s, 'function showPending() {', '\n      }\n');
    assert.match(fallback, /setTimeout\(function \(\) \{\s*\n\s*if \(!pending\) return;\s*\n\s*setPending\(false\);\s*\n\s*window\.gbtiTurnstileReset\(\);\s*\n\s*try \{ if \(window\.turnstile\) window\.turnstile\.reset\(\); \}/, `${label}: the way out runs the check again`);
    assert.match(fallback, /\}, (PENDING_MS|15000)\);/, `${label}: after 15 seconds`);
    const restore = between(s, "window.addEventListener('pageshow', function (e) {", '});');
    assert.match(restore, /if \(!e\.persisted\) return;\s*\n\s*setPending\(false\);/, `${label}: a page restored from the cache is no longer leaving`);
  }
  const s = read(LANDER);
  assert.match(s, /var PENDING_MS = 15000;/);
  assert.match(s, /\[btn, heroBtn\]\.forEach\(function \(b\) \{/, 'both claim buttons');
  assert.match(s, /\.ci \.btn-primary\.is-pending, \.ci \.btn-primary\.is-pending:disabled \{ opacity: 1;/, 'busy is not faded');
  assert.match(read(LOGIN), /\.login-go\.is-pending, \.login-go\.is-pending:disabled \{ opacity: 1;/);
});

test('the waiting line says why the button is off, and goes once the check passes or a press starts', () => {
  const s = read(LANDER);
  assert.match(s, /<p class="ci-wait" data-ts-wait>The button turns on once the check above finishes\.<\/p>/);
  assert.match(between(s, 'window.gbtiTurnstileOk = function (token) {', '};'), /if \(waitNote\) waitNote\.hidden = true;/);
  assert.match(s, /window\.gbtiTurnstileReset = function \(\) \{ resetButton\(\); if \(waitNote && !pending\) waitNote\.hidden = false; \};/, 'never shown during a press');
  const l = read(LOGIN);
  assert.match(l, /data-login-wait>Complete the check above to continue\.<\/p>/);
  assert.match(l, /window\.gbtiTurnstileOk = function \(token\) \{ if \(btn\) \{ btn\.disabled = false; btn\.dataset\.token = token; \} if \(waitNote\) waitNote\.hidden = true; \};/);
});

test('Welcome back: this tab only, within 30 minutes of the press, never once signed in', () => {
  const s = read(LANDER);
  assert.match(s, /try \{ sessionStorage\.setItem\(LEFT_KEY, String\(Date\.now\(\)\)\); \}/, 'the press is remembered in this tab');
  assert.match(s, /var LEFT_KEY = 'gbti-claim-left';/);
  assert.match(s, /var BACK_MS = 30 \* 60 \* 1000;/);
  const c = between(s, 'function checkBack() {', '\n    }\n');
  assert.match(c, /if \(cookie\('gbti_csrf'\)\) \{\s*\n\s*try \{ sessionStorage\.removeItem\(LEFT_KEY\); \}[^\n]*\n\s*backNote\.hidden = true;\s*\n\s*return;/, 'a finished sign-in clears it');
  assert.match(c, /var show = at > 0 && Date\.now\(\) - at < BACK_MS;/);
  assert.match(c, /withCode\.hidden = !hasCode;/, 'the coupon sentence only with a coupon');
  assert.match(s, /checkBack\(\);\n/, 'checked on load');
  assert.match(between(s, "window.addEventListener('pageshow', function (e) {", '});'), /checkBack\(\);/, 'and on a restore from the cache');
  assert.match(s, /<div class="ci-back" data-claim-back role="status" hidden>/);
  assert.match(s, /You left GitHub before it finished\. <span data-claim-back-coupon>Your coupon is still applied, so press<\/span><span data-claim-back-plain hidden>Press<\/span> the button again whenever you are ready\./);
  assert.match(s, /\.ci \.ci-back\[hidden\] \{ display: none; \}/, 'the flex box still hides');
});

test('"What happens next" on both pages, in the approved words and the writing rules', () => {
  const s = read(LANDER);
  assert.match(s, /GitHub asks you to sign in, if you are not already, and to approve read-only access to your profile and email\./);
  assert.match(s, /You come straight back to set up your account, and your free year starts\./);
  assert.match(s, /<p class="ci-fine">No card at any point during the free year, and nothing bills automatically\.<\/p>/, 'the fine print no longer repeats the GitHub line');
  const l = read(LOGIN);
  assert.match(l, /GitHub may ask you to sign in and, the first time, to approve read-only access to your profile and email\./);
  assert.match(l, /You come straight back, signed in\./);
  for (const [p, src] of [[LANDER, s], [LOGIN, l]]) {
    assert.ok(!/[—–]/.test(src), `${p}: no em or en dashes`);
    assert.ok(!/\b(don't|can't|isn't|won't|it's|you're|we're|didn't|doesn't|you'll|we'll)\b/i.test(src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\/|<!--[\s\S]*?-->/g, '')), `${p}: no contractions`);
  }
});
