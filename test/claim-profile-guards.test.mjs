// sow-434: source-level guards on the example profile page, /claim/profile/?code=<CODE>. Each pins a property the pure
// core cannot see: the page unfurls generically and is unlisted three ways (noindex, the sitemap, no Referer), it
// carries the example banner, nothing on it can sign in, follow, subscribe or save, every href and image source the
// script sets is vetted, the signed-out reads carry no credentials, ProfileHeader's example arms leave the published
// markup alone, and the look-alikes stay in step with ProjectCard, SubscribeButton and the published profile page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseHeaders, cspForPath } from '../scripts/check-headers.mjs';
import { inviteBlocker } from '../src/lib/digest-invite-core.mjs';
import { BANNER_LEAD, BANNER_TEXT, BIO_PLACEHOLDER, INERT_TOOLTIP } from '../src/lib/claim-profile-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

const PAGE = 'src/pages/claim/profile/index.astro';
const SCRIPT = 'src/lib/claim-profile.ts';
const CORE = 'src/lib/claim-profile-core.mjs';
const HEADER = 'src/components/members/ProfileHeader.astro';
const NEW_FILES = [PAGE, SCRIPT, CORE, 'test/claim-profile-core.test.mjs', 'test/claim-profile-guards.test.mjs'];

/** The page template: everything after the frontmatter, without the script and style blocks and the comments. */
const template = (src) => src.replace(/^---[\s\S]*?\n---/, '').replace(/<script[\s\S]*?<\/script>/g, '')
  .replace(/<style[\s\S]*?<\/style>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
/** A script without its whole-line comments, so a comment that explains a rule is never read as breaking it. */
const code = (src) => src.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

/** ProfileHeader's example arm: from the `{example ? (` opening the avatar to the `) : d.avatar ? (` closing it, and
 *  from the `{example ? (` opening the links to the `) : socials.length > 0 && (` closing it. */
function exampleArms(src) {
  const arms = [];
  for (const [open, close] of [['{example ? (', ') : d.avatar ? ('], ['{example ? (', ') : socials.length > 0 && (']]) {
    const end = src.indexOf(close);
    const start = src.lastIndexOf(open, end);
    assert.ok(start > 0 && end > start, `the arm closed by "${close}" was found: this check is broken if not`);
    arms.push(src.slice(start, end));
  }
  return arms.join('\n');
}

const CONTRACTION = /\b\w+n't\b|\b\w+'(?:re|ve|ll|d|m)\b|\b(?:it|that|there|what|here|he|she|who|let)'s\b/i;

test('every new file stays at or under the 900-line cap', () => {
  for (const f of NEW_FILES) {
    const n = read(f).split('\n').length;
    assert.ok(n > 40, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
  assert.ok(read(HEADER).split('\n').length <= 900);
});

test('the page has the real chrome, is noindex, and unfurls with the generic title, description and share image', () => {
  const src = read(PAGE);
  const at = src.indexOf('<BaseLayout');
  const tag = src.slice(at, src.indexOf('>', at) + 1);
  const props = [...tag.matchAll(/\s([a-zA-Z]+)=/g)].map((m) => m[1]).sort();
  assert.deepEqual(props, ['description', 'noindex', 'title'], 'no `bare` (the real header and footer), no og overrides');
  assert.match(tag, /\btitle="An invitation"/, 'bare title: BaseLayout adds the brand');
  assert.match(tag, /\bnoindex=\{true\}/);
  assert.match(tag, /\bdescription="A private invitation to join GBTI Network, a professional publishing network for developers\."/,
    'the invitation page\'s own generic description, nothing interpolated');
  assert.doesNotMatch(src, /<meta\b|<title\b|property="og:/, 'no head metadata of its own');
});

test('the real chrome does not bring the digest invitation: no live subscribe form opens over the example', () => {
  // The page is not `bare`, so BaseLayout mounts DigestInvite; the `/claim/` quiet path is what keeps it closed.
  const ctx = { state: null, visit: null, signedIn: false, path: '/claim/profile/', search: '?code=ABC123', now: Date.now() };
  assert.equal(inviteBlocker(ctx), 'quiet-page');
});

test('nothing sets the tab title or writes markup from a string', () => {
  for (const f of [PAGE, SCRIPT, CORE]) {
    const src = read(f);
    assert.doesNotMatch(src, /document\.title/, `${f} must not set document.title (the name stays out of the tab)`);
    assert.doesNotMatch(src, /\.innerHTML\b|set:html|outerHTML|insertAdjacentHTML|document\.write|\.innerText\s*=/, `${f} writes markup`);
    assert.doesNotMatch(src, /\bconsole\./, `${f} logs`);
  }
  assert.doesNotMatch(read(SCRIPT), /document\.head/, 'the script never touches the head');
});

test('the banner carries the spec wording, and the page renders it from the core', () => {
  const src = read(PAGE);
  assert.match(src, /import \{ BANNER_LEAD, BANNER_TEXT, BIO_PLACEHOLDER, INERT_TOOLTIP \} from '\.\.\/\.\.\/\.\.\/lib\/claim-profile-core\.mjs';/);
  assert.match(src, /<p class="cp-banner-text"><strong>\{BANNER_LEAD\}<\/strong> \{BANNER_TEXT\}<\/p>/);
  assert.equal(`${BANNER_LEAD} ${BANNER_TEXT}`, 'Example profile. This page is not published. It is set up to show how your profile will '
    + 'look on GBTI Network. When you claim your listing, your profile starts with your name, and you fill in the rest yourself, '
    + 'including your picture.');
  // The banner sits at the top of the example, above the profile header.
  const t = template(src);
  assert.ok(t.indexOf('class="cp-banner"') > 0 && t.indexOf('class="cp-banner"') < t.indexOf('<ProfileHeader example>'));
  assert.ok(t.indexOf('data-cp-page hidden') < t.indexOf('class="cp-banner"'), 'the banner shows only with the example, never on a panel');
  assert.match(src, /\{BIO_PLACEHOLDER\}/);
  assert.match(src, /<p class="cp-example-tag">Example bio<\/p>/, 'the bio is labelled as an example');
});

test('inert by construction: no sign-in hook, no custom element, no data-gbti hook, no live component', () => {
  const page = template(read(PAGE));
  const arms = exampleArms(read(HEADER));
  assert.ok(page.includes('cp-inert') && arms.includes('data-example-github'), 'control: both subjects were read');
  assert.match(template('<p>a</p>{/* <gbti-x data-signin> */}'), /^<p>a<\/p>$/, 'control: a comment is not markup');
  for (const [name, src] of [['page', page], ['ProfileHeader example arms', arms]]) {
    assert.doesNotMatch(src, /data-signin|data-gbti-|data-copy-link|data-ext-open|data-subscribe\b/, `${name} carries a live hook`);
    assert.doesNotMatch(src, /<[a-z]+-[a-z-]+[\s>]/, `${name} renders a custom element (save-controls or client-ui would upgrade it)`);
  }
  // The page renders none of the live components: the subscribe control and the card are look-alikes.
  const imports = [...read(PAGE).matchAll(/^import (\w+) from '([^']+)'/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['BaseLayout', 'Container', 'ProfileHeader']);
  // The one control is disabled, says why, and is a plain button.
  assert.match(page, new RegExp(`<span class="cp-inert-wrap" style="display:inline-flex" data-tooltip=\\{INERT_TOOLTIP\\}>\\s*<button type="button" class="btn btn-white subscribe-btn cp-inert" disabled aria-disabled="true">`));
  assert.equal(INERT_TOOLTIP, 'Available once published');
});

test('no real profile link except the person\'s own GitHub: every static href is a sprite icon', () => {
  const page = template(read(PAGE));
  const hrefs = [...page.matchAll(/\bhref=("[^"]*"|\{[^}]*\})/g)].map((m) => m[1]);
  assert.ok(hrefs.length >= 3, 'the sprite uses were read: this check is broken if none');
  for (const h of hrefs) assert.match(h, /^"#ico-[a-z-]+"$/, `a static address on the page: ${h}`);
  // The example links are spans: nothing to follow. The one anchor in the arms is the GitHub link, with no address
  // until the script sets it from a checked login.
  const arms = exampleArms(read(HEADER));
  const anchors = [...arms.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(anchors.length, 1);
  assert.match(anchors[0], /data-example-github hidden/);
  assert.doesNotMatch(anchors[0], /\bhref=/);
  assert.match(arms, /\{EXAMPLE_LINKS\.map\(\(\[k, label\]\) => \(\s*<span data-example-link data-tooltip=\{label\}/);
  assert.match(arms, /border:1\.5px dashed/, 'the examples look like examples');
  assert.match(arms, /The dashed links are examples\. You add your own after you claim the listing\./);
});

test('every href and image source the script sets is vetted', () => {
  const src = read(SCRIPT);
  const hrefs = [...src.matchAll(/(\w+)\.href = ([^;]+);|setAttribute\('href', ([^)]+)\)/g)].map((m) => m[0]).sort();
  assert.deepEqual(hrefs, [
    'a.href = back;', // invitationHref(code): a normalized code
    'a.href = self;', // exampleProfileHref(code): a normalized code
    'el.href = href;', // a panel action: a site path, or safeHref
    'gh.href = ghUrl;', // githubProfileUrl: a checked login
    'repo.href = card.repo;', // projectCard: safeHref inside
  ].sort());
  assert.match(src, /const back = invitationHref\(code\);/);
  assert.match(src, /const self = exampleProfileHref\(code\);/);
  assert.match(src, /const ghUrl = githubProfileUrl\(l\.githubLogin\);/);
  assert.match(src, /const card = projectCard\(l, labels\);/);
  assert.match(src, /const href = typeof a\.href === 'string' && \/\^\\\/\(\?!\\\/\)\/\.test\(a\.href\) \? a\.href : safeHref\(a\.href\);\n\s*if \(href\) el\.href = href;/);
  const srcs = [...src.matchAll(/(\w+)\.src = ([^;]+);/g)].map((m) => m[0]).sort();
  assert.deepEqual(srcs, [
    'icon.src = src;', // imageDataUrl(safeImagePayload(...)): a data: URL of an image type from a short list
    'img.src = photos[i];', // viewerPicture: GitHub by account number, or /avatar/<folder>
    'img.src = src;', // memberBlob: a data: URL
  ].sort());
  assert.match(src, /const src = imageDataUrl\(safeImagePayload\(await readJson\(res\), fileName\)\);/);
  assert.match(src, /const src = memberBlob\(seed\);/);
  assert.match(src, /const pic = viewerPicture\(signal, listing\);/);
});

test('the reads are signed out: two plain fetches, no credentials, nothing else', () => {
  const src = code(read(SCRIPT));
  const fetches = [...src.matchAll(/fetch\(([^;]*?)\);/gs)].map((m) => m[1]);
  assert.deepEqual(fetches, ['url, { cache: \'no-store\' }', 'url, { cache: \'no-store\' }'], 'the icon and the listing');
  assert.doesNotMatch(src, /credentials|XMLHttpRequest|sendBeacon|method:/);
  assert.match(src, /const url = listingReadUrl\(base, code\);\n\s*if \(!code \|\| !url\) \{ showPanel\('inactive'\); return; \}/,
    'a malformed code is the inactive panel before any request');
  assert.match(src, /const url = listingImageUrl\(base, code, fileName\);/);
});

test('a dead link reveals nothing: the example is filled only from a readable listing', () => {
  const src = read(SCRIPT);
  const boot = src.slice(src.indexOf('async function boot()'));
  assert.match(boot, /if \(!\('listing' in outcome\)\) \{\n\s*showPanel\([^)]*\);\n\s*return;\n\s*\}\n\s*listing = outcome\.listing;\n\s*fill\(listing\);/);
  assert.equal((src.match(/\bfill\(/g) || []).length, 2, 'fill is declared once and called once');
  // Until then the page frame holds no listing data at all: the name is a placeholder and every hook is empty.
  const page = template(read(PAGE));
  for (const hook of ['data-cp-card-title', 'data-cp-card-desc', 'data-cp-card-name']) {
    assert.match(page, new RegExp(`${hook}[^>]*></`), `${hook} is empty at build time`);
  }
  assert.match(page, /<div data-cp-page hidden>/);
  // The panel's words are claimView's, chosen by state alone (claim-profile-core.test.mjs holds them equal).
  assert.match(read(CORE), /const v = claimView\(\['inactive', 'rate_limited'\]\.includes\(state\) \? state : 'error'\);/);
});

test('the sitemap leaves out /claim/profile/ as well as /claim/', () => {
  const cfg = read('astro.config.mjs');
  const m = /sitemap\(\{ filter: \(page\) => !\/(.+?)\/\.test\(page\)/.exec(cfg);
  assert.ok(m, 'the sitemap filter regex was found: this check is broken if not');
  const re = new RegExp(m[1]);
  for (const u of ['https://gbti.network/claim/profile/', 'https://gbti.network/claim/profile', 'https://gbti.network/claim/']) {
    assert.ok(re.test(u), `${u} is left out`);
  }
  for (const u of ['https://gbti.network/members/bomsn/', 'https://gbti.network/claim/profiles/', 'https://gbti.network/profile/']) {
    assert.ok(!re.test(u), `control: ${u} stays in`);
  }
});

test('the existing /claim/* rule sends no Referer for this page too, and the site CSP is unchanged', () => {
  const rules = parseHeaders(read('public/_headers'));
  // Cloudflare's _headers matching, as scripts/check-headers.mjs models it: `/x/*` matches the prefix, else exact.
  const matches = (pattern, p) => (pattern.endsWith('/*') ? p.startsWith(pattern.slice(0, -1)) : p === pattern);
  assert.ok(matches('/claim/*', '/claim/profile/') && !matches('/claim/*', '/claims/') && !matches('/claim', '/claim/profile/'), 'control');
  for (const p of ['/claim/profile/', '/claim/profile']) {
    const hits = rules.filter((r) => r.path !== '/*' && matches(r.path, p));
    assert.deepEqual(hits.map((r) => r.path), ['/claim/*'], `${p} is covered by the claim rule alone`);
    assert.equal(hits[0].set['referrer-policy']?.value, 'no-referrer');
    assert.equal(cspForPath(rules, p), rules.find((r) => r.path === '/*').set['content-security-policy'].value);
  }
});

test('ProfileHeader: the published markup is untouched, and the example takes arms of the expressions already there', () => {
  const src = read(HEADER);
  const tpl = src.replace(/^---[\s\S]*?\n---\n/, '');
  // No wrapper: Astro's compact printer re-flows markup inside or after a new expression, which would change the bytes
  // of every published profile. Measured byte-identical on all fifteen member pages (2026-10-01).
  assert.ok(tpl.startsWith('<header class="band-sm dark relative overflow-hidden">\n'), 'the header is still the first node');
  // The published arms, verbatim.
  for (const line of [
    '<img src={d.avatar} alt={d.displayName} class="h-48 w-48 object-cover sm:h-[300px] sm:w-[300px]" style="border-radius:var(--r-lg);border:4px solid var(--paper);box-shadow:var(--sh-lg)" />',
    '<span class="h1" style="color:#fff">{d.displayName.charAt(0)}</span>',
    '<a href={v} target="_blank" rel="noopener noreferrer" data-tooltip={k} class="grid h-11 w-11 place-items-center transition hover:-translate-y-0.5" style="border-radius:var(--r);border:1.5px solid var(--line-dark-2);color:var(--on-dark-soft)">',
  ]) assert.ok(src.includes(line), `published markup changed: ${line}`);
  // The one attribute added to shared markup renders nothing outside the example (Astro drops an undefined attribute).
  assert.match(src, /<h1 class="h1" style="color:#fff" data-example-name=\{example \? '' : undefined\}>\{d\.displayName\}<\/h1>/);
  assert.match(src, /\{example \? \(\n\s*<div data-example-avatar/);
  assert.match(src, /\) : d\.avatar \? \(/);
  assert.match(src, /\{example \? \(\n\s*<>/);
  assert.match(src, /\) : socials\.length > 0 && \(/);
  assert.match(src, /const d = \(example \? \{ displayName: 'Your name' \} : profile!\.data\)/, 'no profile is read in the example');
});

test('the example picture is the initial the claimed profile will show, not a photo it will not have', () => {
  // The claim writes the profile with a name and no avatar, so the published header draws its no-avatar arm: an ink
  // square with the first letter. The example arm draws the same square, and the script writes the same letter.
  const src = read(HEADER);
  const arm = exampleArms(src).split(') : d.avatar ? (')[0];
  const pubDisc = /\) : \(\n\s*(<div class="grid h-48 w-48 place-items-center sm:h-\[300px\] sm:w-\[300px\]" style="[^"]+">)\n\s*<span class="h1" style="color:#fff">\{d\.displayName\.charAt\(0\)\}<\/span>/.exec(src);
  assert.ok(pubDisc, 'the published no-avatar arm was found: this check is broken if not');
  assert.ok(arm.includes(pubDisc[1].replace('<div ', '<div data-example-avatar ')), 'the example square is the published square');
  assert.match(arm, /<span class="h1" style="color:#fff" data-example-initial>\{d\.displayName\.charAt\(0\)\}<\/span>/);
  assert.doesNotMatch(arm, /<img\b|data-example-blob|data-example-photo/, 'no picture layers in the example header');
  const script = read(SCRIPT);
  assert.match(script, /setText\(\$\('\[data-example-initial\]'\), profileInitial\(name\)\);/);
  assert.doesNotMatch(script, /data-example-(blob|photo)/, 'nothing draws a photo into the header');
});

test('DRIFT: the example card is ProjectCard\'s markup', () => {
  const card = read('src/components/projects/ProjectCard.astro');
  const page = read(PAGE);
  // Every literal class and style ProjectCard renders in its directory variant (not the `home` arm), plus the icon
  // style and the stacked avatar's classes.
  const body = card.slice(card.indexOf('<article'));
  const dir = body.slice(0, body.indexOf('{home ? (')) + body.slice(body.indexOf(') : (', body.indexOf('{home ? (')));
  const literals = [...dir.matchAll(/\b(class|style)="([^"]+)"/g)].map((m) => `${m[1]}="${m[2]}"`);
  assert.ok(literals.length >= 12, `read ${literals.length} literals from ProjectCard: this check is broken if few`);
  for (const l of new Set(literals)) assert.ok(page.includes(l), `ProjectCard renders ${l}; the example card does not`);
  const iconStyle = /<Image [^>]*style="([^"]+)"/.exec(card)[1];
  assert.ok(page.includes(`style="${iconStyle}"`), 'the icon tile');
  const stacked = read('src/components/StackedAvatars.astro');
  for (const l of ['class="flex -space-x-2"', 'class="relative inline-block transition-transform hover:z-10 hover:-translate-y-0.5"']) {
    assert.ok(stacked.includes(l) && page.includes(l), l);
  }
  assert.match(stacked, /sm: 'h-5 w-5 text-\[9px\]'/);
  assert.match(page, /class="h-5 w-5 text-\[9px\] relative block overflow-hidden rounded-full"/);
  assert.match(card, /<use href="#ico-arrow"\/>/);
  assert.match(page, /View details <svg class="ar" viewBox="0 0 24 24" width="16" height="16"><use href="#ico-arrow"\/><\/svg>/);
});

test('DRIFT: the inert subscribe control is SubscribeButton\'s button, variant white as the profile page uses it', () => {
  const sb = read('src/components/SubscribeButton.astro');
  assert.match(sb, /<button type="button" class=\{`btn btn-\$\{variant\} subscribe-btn`\} data-subscribe>/);
  assert.match(sb, /<svg viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px"><use href="#ico-mega"\/><\/svg>\n\s*Subscribe to activity/);
  assert.match(read('src/pages/members/[username].astro'), /<SubscribeButton name=\{d\.displayName\} username=\{d\.username\} variant="white" \/>/);
  const page = read(PAGE);
  assert.match(page, /class="btn btn-white subscribe-btn cp-inert"/);
  assert.match(page, /<svg viewBox="0 0 24 24" width="16" height="16" style="margin-right:6px"><use href="#ico-mega"\/><\/svg>\n\s*Subscribe to activity/);
});

test('DRIFT: the example lays out the way the published profile page does', () => {
  const real = read('src/pages/members/[username].astro');
  const page = read(PAGE);
  for (const l of [
    '<div class="mx-auto max-w-xl sm:mx-0 lead">',
    '<div class="mt-4 flex flex-wrap max-sm:justify-center gap-3 sm:justify-start">',
    '<section class="band tint">',
    'style="scroll-margin-top:90px"',
    '<div class="sec-head">',
    '<h2 class="h2"',
    '<div class="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">',
  ]) {
    assert.ok(real.includes(l), `the published page no longer has ${l}: update the example to match`);
    assert.ok(page.includes(l), `the example is missing ${l}`);
  }
  assert.match(real, /<ProfileHeader profile=\{profile\}>/);
  assert.match(page, /<ProfileHeader example>/);
});

test('the copy follows the writing rules: no dashes, no contractions, "free year" never "trial"', () => {
  const words = [];
  for (const f of [PAGE, HEADER]) {
    let s = read(f).replace(/^---[\s\S]*?\n---/, '');
    s = s.replace(/<style[\s\S]*?<\/style>/g, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
    words.push(...[...s.matchAll(/\b(?:placeholder|aria-label|title|alt|data-tooltip)="([^"]*)"/g)].map((m) => m[1]));
    words.push(...s.replace(/<[^>]+>/g, '\n').split('\n').map((l) => l.trim()).filter((l) => l && !/^[{}()]/.test(l)));
  }
  const lits = (src) => [...src.matchAll(/'([^'\\\n]*(?:\\.[^'\\\n]*)*)'|`([^`]*)`/g)].map((m) => m[1] ?? m[2]);
  words.push(...lits(read(SCRIPT)), ...lits(read(HEADER).match(/^---[\s\S]*?\n---/)[0]), BANNER_TEXT, BIO_PLACEHOLDER);
  const all = words.join('\n');
  assert.ok(all.length > 800, `read ${all.length} characters of copy: this check is broken if that is small`);
  assert.match(all, /Back to your invitation/, 'control: the page text was read');
  assert.match(all, /Example LinkedIn profile/, 'control: the header frontmatter was read');
  assert.doesNotMatch(all, CONTRACTION);
  assert.doesNotMatch(all, / - /);
  for (const f of [PAGE, SCRIPT, CORE]) {
    assert.doesNotMatch(read(f), /[\u2014\u2013]/, `${f} carries an em or en dash`);
    assert.doesNotMatch(read(f), /\btrial\b/i, `${f} says trial`);
  }
  assert.doesNotMatch(read(HEADER), /[\u2014\u2013]/);
});
