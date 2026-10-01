// sow-427 E2-E4: source-level guards on the prepared-listing claim page. Each pins a property no unit test of the pure
// core can see: the page is unindexed and unfurls generically (trap 7: a pasted link must not publish the project's
// title or the person's name), the sitemap and the Referer never carry the code, the free-year line binds to the tier
// registry, the message and the listing never reach innerHTML, every href is vetted, the signed-out read carries no
// credentials while the claim calls do, and the copy follows the writing rules.
//
// sow-434 extended it deliberately in three places: the page now renders in the real site chrome (no longer `bare`),
// the DOM builders moved partly into src/lib/claim-render.ts (read here with the page script, and allowed NO
// innerHTML at all), and the href census gained the preview's own addresses, each from a checked builder: the hero
// crumbs (crumbHref), the example profile link (exampleProfileHref) and the in-page contents anchors.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeaders, cspForPath } from '../scripts/check-headers.mjs';
import { inviteBlocker } from '../src/lib/digest-invite-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const PAGE = 'src/pages/claim/index.astro';
const DIALOG = 'src/components/claim/ClaimDialog.astro';
const LISTING = 'src/components/claim/ClaimListing.astro';
const CORE = 'src/lib/claim-core.mjs';
const SCRIPT = 'src/lib/claim-page.ts';
const RENDER = 'src/lib/claim-render.ts'; // sow-434: the preview's DOM builders, under the page script's rules
const ASTRO = [PAGE, DIALOG, LISTING];
const SCRIPTS = [SCRIPT, RENDER];
const NEW_FILES = [
  ...ASTRO, CORE, ...SCRIPTS, 'test/claim-core.test.mjs', 'test/claim-page-guards.test.mjs',
  'test/claim-render.test.mjs', 'test/claim-preview-core.test.mjs',
];

/** The BaseLayout opening tag of the page, whole. */
function layoutTag(src) {
  const at = src.indexOf('<BaseLayout');
  assert.ok(at > 0, 'the page renders through BaseLayout');
  return src.slice(at, src.indexOf('>', at) + 1);
}

/**
 * The words a visitor can read in an .astro file: the markup text and the text-bearing attributes, with the
 * frontmatter code, the style and script blocks and the comments taken out (CSS such as `calc(100% - 32px)` is not
 * prose). Over-inclusive rather than under: it may add a false alarm, never hide a sentence.
 */
function astroWords(src) {
  let s = src.replace(/^---[\s\S]*?\n---/, '');
  s = s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '');
  s = s.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<!--[\s\S]*?-->/g, '');
  const attrs = [...s.matchAll(/\b(?:placeholder|aria-label|title|description|alt)="([^"]*)"/g)].map((m) => m[1]);
  const text = s.replace(/<[^>]+>/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !/^[{}]/.test(l));
  return [...attrs, ...text].join('\n');
}

/** The string literals of a script: what it can put on the page as words. */
function literals(src) {
  const out = [];
  for (const m of src.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`]*)`|"([^"\\\n]*(?:\\.[^"\\\n]*)*)"/g)) out.push(m[1] ?? m[2] ?? m[3]);
  return out.join('\n');
}

const CONTRACTION = /\b\w+n't\b|\b\w+'(?:re|ve|ll|d|m)\b|\b(?:it|that|there|what|here|he|she|who|let)'s\b/i;

test('every new file stays at or under the 900-line cap', () => {
  for (const f of NEW_FILES) {
    const n = read(f).split('\n').length;
    assert.ok(n > 40, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

test('the page is noindex in the real site chrome, with a generic title and description and the default share image', () => {
  const tag = layoutTag(read(PAGE));
  assert.match(tag, /\bnoindex=\{true\}/);
  // sow-434 (owner, 2026-09-30): the real header and footer, so the preview reads as part of the site.
  assert.doesNotMatch(tag, /\bbare\b/, 'the invitation renders in the real site chrome');
  assert.match(tag, /\btitle="An invitation"/, 'bare: BaseLayout adds the brand to the page title and og:title');
  assert.match(tag, /\bdescription="[^"{}]+"/, 'a literal description, nothing interpolated');
  // Generic unfurls: no page-specific image or type, and no prop that could carry anything from the listing.
  assert.doesNotMatch(tag, /ogImage|ogType|ogImageSize/);
  const props = [...tag.matchAll(/\s([a-zA-Z]+)=/g)].map((m) => m[1]).sort();
  assert.deepEqual(props, ['description', 'noindex', 'title']);
});

test('the real chrome does not bring the digest invitation: a live subscribe form never opens over the preview', () => {
  // Without `bare`, BaseLayout mounts DigestInvite. A signed-out recipient on the invitation link (?code=, not a coupon)
  // would meet it a minute in, once the claim dialog closes, unless the quiet list covers the page.
  const ctx = { state: null, visit: null, signedIn: false, path: '/claim/', search: '?code=ABC123', now: Date.now() };
  assert.equal(inviteBlocker(ctx), 'quiet-page');
  assert.equal(inviteBlocker({ ...ctx, path: '/claim' }), 'quiet-page');
});

test('nothing sets the document title or writes to the head from listing data', () => {
  for (const f of [...ASTRO, CORE, ...SCRIPTS]) {
    const src = read(f);
    assert.doesNotMatch(src, /document\.title/, `${f} must not set document.title (the project title stays out of the tab)`);
    assert.doesNotMatch(src, /set:html|outerHTML|insertAdjacentHTML|document\.write/, `${f} writes markup directly`);
    assert.doesNotMatch(src, /<meta\b|<title\b|property="og:/, `${f} adds head metadata of its own`);
  }
  assert.doesNotMatch(read(SCRIPT), /document\.head\.(?!appendChild\(s\))/, 'the one head write is the Turnstile script tag');
  assert.doesNotMatch(read(RENDER), /\.head\b/, 'the preview builders never touch the head');
});

test('the message and the listing never reach innerHTML: one parse, of the markdown renderer output, in a <template>', () => {
  const src = read(SCRIPT);
  const uses = src.match(/\.innerHTML\b/g) || [];
  assert.equal(uses.length, 1, 'exactly one innerHTML in the page script');
  assert.match(src, /const tpl = doc\.createElement\('template'\);\n\s*tpl\.innerHTML = html;/);
  const html = new Set([...src.matchAll(/\bhtml = ([^;]+);/g)].map((m) => m[1].trim()));
  assert.deepEqual([...html].sort(), ["''", 'renderMarkdown(md)'], 'html is only ever the renderer output or empty');
  // The message goes in as nodes, built from text.
  assert.match(src, /msg\.replaceChildren\(\.\.\.messageToNodes\(/);
  assert.doesNotMatch(src, /message[^\n]*innerHTML|innerHTML[^\n]*message/);
  // Frontmatter strings go to textContent only.
  assert.doesNotMatch(src, /\.innerText\s*=/);
  for (const f of ASTRO) assert.doesNotMatch(read(f), /innerHTML/, `${f}`);
  // sow-434: the preview builders parse nothing at all, and the author note card is built from nodes.
  const render = read(RENDER);
  assert.ok(render.length > 2000, 'the render module was read: this check is broken if not');
  assert.doesNotMatch(render, /\.innerHTML|\.outerHTML|insertAdjacentHTML|createContextualFragment|new DOMParser/);
  assert.match(render, /buildAuthorNoteNodes\(doc, \{/, 'the note card is the DOM twin, not the HTML string builder');
  assert.doesNotMatch(render, /buildAuthorNoteHtml/);
});

test('every href the page script sets is vetted: safeHref, the model (safeHref inside), bodyLinkHref, or a claim-core builder', () => {
  const src = read(SCRIPT);
  const render = read(RENDER);
  const sets = [...(src + render).matchAll(/(\w+)\.href = ([^;]+);|setAttribute\('href', ([^)]+)\)/g)].map((m) => m[0]);
  assert.deepEqual(sets.sort(), [
    'a.href = l.url;', // a model link: listingModel passed every url through safeHref
    'el.href = href;', // an action: a site path, or safeHref
    'location.href = url;', // the sign-in: buildClaimSigninUrl, pinned below
    "setAttribute('href', `#${id}`)", // an icon from the page's own sprite, by an id from iconForUrl's fixed map
    "setAttribute('href', href)", // a body link: bodyLinkHref
    // sow-434, the preview's own addresses (claim-render.ts):
    "setAttribute('href', href)", // a hero crumb: crumbHref, the feed filtered to a taxonomy-shaped key
    "setAttribute('href', profile)", // the byline avatar: exampleProfileHref of the validated code
    "setAttribute('href', profile)", // the byline name: the same
    "setAttribute('href', `#${t.id}`)", // a contents entry: an id this page stamped (claimToc)
    'licLink.href = m.license.href;', // the licence link: licenseRow (https only), then safeHref in listingModel
  ].sort());
  assert.match(read(CORE), /license: lic \? \{ id: lic\.id, href: safeHref\(lic\.href\) \} : null,/, 'the licence href passed safeHref');
  // Each new address comes from its checked builder, and only from there.
  assert.match(render, /const href = crumbHref\(c\.key\);\n\s*if \(href\) a\.setAttribute\('href', href\);/);
  assert.match(render, /if \(profile\) av\.setAttribute\('href', profile\);/);
  assert.match(render, /if \(profile\) name\.setAttribute\('href', profile\);/);
  assert.match(render, /const \{ ids, toc \} = claimToc\(/, 'the contents ids and entries come from claimToc');
  assert.match(src, /const profileHref = exampleProfileHref\(code\);/);
  const calls = [...src.matchAll(/\b(?:fillByline|renderNoteCard)\(doc, [^;]*;/g)].map((m) => m[0]);
  assert.equal(calls.length, 2, 'the byline and the note card are each filled from one place');
  for (const call of calls) assert.match(call, /, profileHref, /, `${call} takes the example profile address`);
  // The note card's links are set inside buildAuthorNoteNodes, which takes only a same-site path or an http(s) URL.
  assert.match(read('src/lib/author-note.mjs'), /const link = typeof href === 'string' && \(\/\^\\\/\(\?!\\\/\)\/\.test\(href\) \|\| \/\^https\?:\\\/\\\/\/i\.test\(href\)\) \? href : null;/);
  assert.match(render, /buildAuthorNoteNodes\(doc, \{ name: who\.name, href: profile,/);
  assert.match(src, /const url = buildClaimSigninUrl\(\{[\s\S]*?\}\);\n\s*if \(url\) window\.location\.href = url;/);
  assert.match(src, /const href = typeof a\.href === 'string' && \/\^\\\/\(\?!\\\/\)\/\.test\(a\.href\) \? a\.href : safeHref\(a\.href\);\n\s*if \(href\) el\.href = href;/);
  assert.match(src, /const href = bodyLinkHref\(a\.getAttribute\('href'\) \|\| ''\);\n\s*if \(!href\) \{ a\.removeAttribute\('href'\); return; \}\n\s*a\.setAttribute\('href', href\);/);
  // linkButton is fed only the model's links (every url in them passed safeHref in listingModel).
  const fed = [...src.matchAll(/linkButton\(([^,]+),/g)].map((m) => m[1].trim()).sort();
  assert.deepEqual(fed, ['l', 'm.primary', 'm.primary', 'm.repo', 'm.repo']);
  assert.match(src, /m\.railLinks\.map\(\(l: any\) => linkButton\(l,/);
  // Images and frames in the body are re-checked too, and nothing loaded from the body sends a Referer.
  assert.match(src, /const src = bodyImageSrc\(img\.getAttribute\('src'\) \|\| '', images\);/);
  assert.match(src, /img\.setAttribute\('referrerpolicy', 'no-referrer'\);/);
  assert.match(src, /const src = bodyFrameSrc\(f\.getAttribute\('src'\) \|\| '', location\.origin\);/);
  assert.match(src, /frag\.querySelectorAll\('script, style, object, embed/);
});

test('the signed-out reads carry no credentials; the claim calls carry the session, and the POST the CSRF header', () => {
  const src = read(SCRIPT);
  assert.doesNotMatch(read(RENDER), /\bfetch\(/, 'the preview builders read nothing from the network');
  const fetches = [...src.matchAll(/await fetch\(([^;]*?)\);/gs)].map((m) => m[1]);
  assert.equal(fetches.length, 4, 'the listing read, the image read, the claim status and the claim POST');
  const listingReads = fetches.filter((f) => f.startsWith('url, { cache'));
  assert.equal(listingReads.length, 2);
  for (const f of listingReads) assert.doesNotMatch(f, /credentials/, 'wildcard CORS: never credentials on /invite/listing*');
  const claim = fetches.filter((f) => /credentials: 'include'/.test(f));
  assert.equal(claim.length, 2);
  const post = claim.find((f) => /method: 'POST'/.test(f));
  assert.ok(post, 'the POST is credentialed');
  assert.match(post, /'X-GBTI-CSRF': csrf/);
  assert.match(post, /body: JSON\.stringify\(\{ code, note \}\)/, 'the POST sends only the code and the note');
});

test('the claim status is asked whenever this browser is signed in, even after an inactive read (amendment 3)', () => {
  const src = read(SCRIPT);
  const boot = src.slice(src.indexOf('async function boot()'));
  assert.doesNotMatch(boot, /read\.inactive/, 'an inactive read must not end the visit before the status call');
  assert.match(boot, /if \(!hasWebSessionCookie\(\)\) \{ apply\(listing \? 'signin' : 'inactive'\); return; \}/);
  assert.match(boot, /await checkStatus\(true\);/);
});

test('the bot check is on demand, and a token is spent and dropped in the same tap', () => {
  const dialog = read(DIALOG);
  assert.doesNotMatch(dialog, /cf-turnstile/, 'no implicit render: a signed-in member never loads the widget');
  assert.match(dialog, /data-claim-ts data-sitekey=\{TURNSTILE_SITE_KEY\}/);
  const src = read(SCRIPT);
  assert.match(src, /'https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit'/);
  const click = src.slice(src.indexOf("goBtn?.addEventListener('click'"), src.indexOf("window.addEventListener('pageshow'"));
  assert.ok(click.indexOf('tsReset();') > 0 && click.indexOf('tsReset();') < click.indexOf('window.location.href = url'),
    'the token is dropped before the navigation');
  assert.match(click, /buildClaimSigninUrl\(\{/, 'the sign-in URL comes from the tested builder');
});

test('the free-year line binds to the tier registry, never to words typed into the page', () => {
  const dialog = read(DIALOG);
  assert.match(dialog, /import \{ tierDisplay \} from '\.\.\/\.\.\/lib\/tiers';/);
  assert.match(dialog, /tierDisplay\('member'\)/);
  assert.match(dialog, /tierDisplay\('creator'\)/);
  assert.match(dialog, /data-tiers=\{JSON\.stringify\(tierData\)\}/);
  for (const f of [...ASTRO, CORE, SCRIPT]) {
    const src = read(f);
    assert.doesNotMatch(src, /Network Supporter|Curator|\$\s?50\b|\$\s?150\b/, `${f} types a tier name or price`);
  }
});

test('the sitemap leaves out the claim pages (/claim/ and /claim/profile/), and nothing else', () => {
  const cfg = read('astro.config.mjs');
  const m = /sitemap\(\{ filter: \(page\) => !\/(.+?)\/\.test\(page\)/.exec(cfg);
  assert.ok(m, 'the sitemap filter regex was found: this check is broken if not');
  const re = new RegExp(m[1]);
  assert.ok(re.test('https://gbti.network/claim/'), '/claim/ is left out');
  assert.ok(re.test('https://gbti.network/claim'));
  assert.ok(!re.test('https://gbti.network/projects/widget/'), 'control: a normal page stays in');
  assert.ok(!re.test('https://gbti.network/claims-explained/'), 'control: a page merely starting with claim stays in');
});

test('/claim sends no Referer, and the rule adds one header without touching the site CSP', () => {
  const rules = parseHeaders(read('public/_headers'));
  for (const p of ['/claim', '/claim/*']) {
    const r = rules.find((x) => x.path === p);
    assert.ok(r, `a ${p} rule exists`);
    assert.equal(r.set['referrer-policy']?.value, 'no-referrer', `${p} sets Referrer-Policy: no-referrer`);
    assert.deepEqual(r.unset, [], `${p} removes nothing`);
    assert.deepEqual(Object.keys(r.set), ['referrer-policy'], `${p} sets nothing else`);
  }
  const global = rules.find((x) => x.path === '/*').set['content-security-policy'].value;
  assert.equal(cspForPath(rules, '/claim/'), global, 'the claim page keeps the site policy');
  // The site policy already admits what the page loads: the Worker, Turnstile, data: images and the /embed relay.
  assert.match(global, /connect-src[^;]*https:\/\/signup\.gbti\.network/);
  assert.match(global, /frame-src[^;]*'self'[^;]*https:\/\/challenges\.cloudflare\.com/);
  assert.match(global, /img-src[^;]*data:/);
});

test('no logging anywhere in the page, its components or its core', () => {
  for (const f of [...ASTRO, CORE, ...SCRIPTS, 'src/lib/author-note.mjs']) assert.doesNotMatch(read(f), /\bconsole\./, `${f} logs`);
});

test('the copy follows the writing rules: no dashes, no contractions, "free year" never "trial"', () => {
  for (const f of [...ASTRO, CORE, ...SCRIPTS]) {
    const src = read(f);
    assert.doesNotMatch(src, /[\u2014\u2013]/, `${f} carries an em or en dash`);
    assert.doesNotMatch(src, /\btrial\b/i, `${f} says trial`);
  }
  const words = [...ASTRO.map((f) => astroWords(read(f))), ...SCRIPTS.map((f) => literals(read(f))), literals(read(CORE))].join('\n');
  assert.ok(words.length > 2000, `read ${words.length} characters of copy: this check is broken if that is small`);
  assert.match(words, /Look at the listing first/, 'control: the dialog text was read');
  assert.match(words, /Add your note and publish/, 'control: the core copy was read');
  assert.match(words, /This listing is not published yet\./, 'control: the sow-434 strip was read');
  assert.match(words, /Open screenshot /, 'control: the preview builders were read');
  assert.doesNotMatch(words, CONTRACTION, 'no contractions');
  assert.doesNotMatch(words, / - /, 'no spaced hyphen standing in for a dash');
  // Controls: the scans fire on copy that breaks them.
  assert.match(astroWords('<p>It isn\'t here - yet</p>'), CONTRACTION);
  assert.match(astroWords('<p>It is here - yet</p>'), / - /);
  assert.doesNotMatch(astroWords('<style>.x { width: calc(100% - 32px); }</style><p>ok</p>'), / - /, 'CSS is not copy');
});
