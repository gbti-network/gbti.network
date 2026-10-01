// sow-427 E4: the pure half of the prepared-listing claim page. What the sign-in carries (and that the Worker's own
// return-path rules accept it and send a new account to the claim first), how the personal message becomes nodes
// without ever becoming markup, the poll schedule, which links and images the listing view may render, how the
// Worker's answers map to what the page shows, and the words of every view.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CLAIM_CODE_RE, NOTE_MAX, SETUP_PATIENCE_MS, POLL_GIVE_UP_MS, SERVER_STATES, PAGE_STATES, TERMINAL_STATES, POLLING_STATES,
  normalizeClaimCode, parseClaimQuery, claimReturnPath, buildClaimSigninUrl, claimStatusUrl, listingReadUrl,
  listingImageUrl, pollDelayMs, greetingLine, preparedByLine, messageParagraphs, messageToNodes, tierLine, safeHref,
  isImageName, listingImageName, safeImagePayload, imageDataUrl, listingImageNames, bodyImageSrc, bodyLinkHref,
  relayFrameSrc, bodyFrameSrc, listingModel, statusFromResponse, postOutcome, postErrorMessage, welcomeHref,
  claimView, WELCOME_REDIRECT_MS,
} from '../src/lib/claim-core.mjs';
import { signinLanding } from '../workers/signup/signin-landing.mjs';
import { safeReturnTo } from '../workers/signup/index.mjs';
import { CLAIM_STATE } from '../membership/prepared-listings.mjs';
import { MAX_CLAIM_NOTE } from '../membership/prepared-claim-files.mjs';
import { MAX_MESSAGE } from '../membership/prepared-listings.mjs';

const BASE = 'https://signup.gbti.network';
const TIERS = { member: { label: 'Network Supporter', priceAnnual: 50 }, creator: { label: 'Curator', priceAnnual: 150 } };

/** A document stand-in with just what messageToNodes uses, so the test sees the exact node tree it builds. */
function fakeDoc() {
  const el = (tag) => ({
    tag, children: [],
    appendChild(n) { this.children.push(n); return n; },
  });
  return {
    createElement: (tag) => el(tag),
    createTextNode: (text) => ({ tag: '#text', text }),
  };
}

// ---- the code, the query, the sign-in -------------------------------------------------------------------------

test('a code is trimmed and uppercased, and anything outside the coupon alphabet is refused before any request', () => {
  assert.equal(normalizeClaimCode(' abc123 '), 'ABC123');
  for (const bad of ['', 'AB', 'A'.repeat(33), 'ABC-123', 'ABC 123', 'ABC123&x=1', null, undefined, 42, 'ÄBC123']) {
    assert.equal(normalizeClaimCode(bad), null, String(bad));
  }
  assert.equal(CLAIM_CODE_RE.source, '^[A-Z0-9]{3,32}$', 'the same alphabet the Worker checks (COUPON_CODE_RE)');
  assert.deepEqual(parseClaimQuery('?code=abc123&welcome=1'), { code: 'ABC123', welcome: true });
  assert.deepEqual(parseClaimQuery('?code=abc123&welcome=yes'), { code: 'ABC123', welcome: false });
  assert.deepEqual(parseClaimQuery('?code=%3Cscript%3E'), { code: null, welcome: false });
  assert.deepEqual(parseClaimQuery(''), { code: null, welcome: false });
});

test('the sign-in carries the invitation as the coupon and EXACTLY /claim/?code=<CODE> as the return path', () => {
  const url = new URL(buildClaimSigninUrl({ signupBase: `${BASE}/`, token: 'tok-1', code: 'abc123', ref: 'r1', via: 'projects/x', sid: 's1' }));
  assert.equal(url.origin + url.pathname, `${BASE}/signup/start`);
  assert.equal(url.searchParams.get('cf-turnstile-response'), 'tok-1');
  assert.equal(url.searchParams.get('coupon'), 'ABC123');
  assert.equal(url.searchParams.get('return_to'), '/claim/?code=ABC123');
  assert.equal(url.searchParams.get('ref'), 'r1');
  assert.equal(url.searchParams.get('via'), 'projects/x');
  assert.equal(url.searchParams.get('sid'), 's1');
  // Absent cookies are left out, not sent empty.
  const bare = new URL(buildClaimSigninUrl({ signupBase: BASE, token: 't', code: 'ABC123' }));
  assert.deepEqual([...bare.searchParams.keys()].sort(), ['cf-turnstile-response', 'coupon', 'return_to']);
});

test('the return path survives the Worker, and a NEW account lands on the claim first, marked welcome=1', () => {
  // The two real Worker functions the path meets: safeReturnTo at /signup/start, signinLanding at the callback.
  const rt = new URL(buildClaimSigninUrl({ signupBase: BASE, token: 't', code: 'x7k2m9pq' })).searchParams.get('return_to');
  assert.equal(safeReturnTo(rt), rt, 'safeReturnTo keeps it whole');
  assert.equal(signinLanding({ created: true, returnTo: safeReturnTo(rt) }), '/claim/?code=X7K2M9PQ&welcome=1');
  assert.equal(signinLanding({ created: false, returnTo: safeReturnTo(rt) }), '/claim/?code=X7K2M9PQ');
  assert.equal(claimReturnPath('x7k2m9pq'), '/claim/?code=X7K2M9PQ');
  // Control: a return path with anything more would send a new account to the welcome first, which is why the page
  // never adds the welcome marker (or anything else) to it.
  assert.match(signinLanding({ created: true, returnTo: '/claim/?code=X7K2M9PQ&welcome=1' }), /^\/welcome\/\?next=/);
});

test('no sign-in URL without a token, a valid code or an http(s) Worker base', () => {
  assert.equal(buildClaimSigninUrl({ signupBase: BASE, token: '', code: 'ABC123' }), null);
  assert.equal(buildClaimSigninUrl({ signupBase: BASE, token: 't', code: 'no' }), null);
  assert.equal(buildClaimSigninUrl({ signupBase: 'javascript:alert(1)//', token: 't', code: 'ABC123' }), null);
  assert.equal(buildClaimSigninUrl({ signupBase: '', token: 't', code: 'ABC123' }), null);
  assert.equal(claimReturnPath('bad code'), null);
});

test('the Worker URLs carry only a well-formed code (and a well-formed image name)', () => {
  assert.equal(claimStatusUrl(`${BASE}/`, 'abc123'), `${BASE}/membership/claim?code=ABC123`);
  assert.equal(listingReadUrl(BASE, 'abc123'), `${BASE}/invite/listing?code=ABC123`);
  assert.equal(listingImageUrl(BASE, 'abc123', 'icon.png'), `${BASE}/invite/listing-image?code=ABC123&name=icon.png`);
  assert.equal(listingImageUrl(BASE, 'abc123', '../x.png'), null);
  assert.equal(listingImageUrl(BASE, 'abc123', 'Icon.PNG'), null);
  assert.equal(claimStatusUrl(BASE, 'x'), null);
  assert.equal(listingReadUrl(BASE, ''), null);
});

test('polls at 5, 10 and 15 seconds, then every 30; a server hint lengthens a wait but never shortens one', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 50].map((n) => pollDelayMs(n)), [5000, 10000, 15000, 30000, 30000, 30000]);
  assert.equal(pollDelayMs(-3), 5000);
  assert.equal(pollDelayMs(0, 10), 10000, 'retryAfterSeconds 10 lengthens the first wait');
  assert.equal(pollDelayMs(2, 10), 15000, 'and never shortens a longer one');
  assert.equal(pollDelayMs(0, 3600), 30000, 'a huge hint is capped at the longest step');
  assert.equal(pollDelayMs(0, 'x'), 5000);
  assert.equal(SETUP_PATIENCE_MS, 10 * 60 * 1000, 'the plan: after about ten minutes, say the link keeps working');
  assert.ok(POLL_GIVE_UP_MS > SETUP_PATIENCE_MS);
});

// ---- the greeting and the message ------------------------------------------------------------------------------

test('the message keeps its line breaks and paragraphs, and markup in it stays literal text', () => {
  const msg = 'Hi from the team.\nWe wrote this up for you.\n\n<img src=x onerror=alert(1)> is text here\r\nlast line';
  assert.deepEqual(messageParagraphs(msg), [
    ['Hi from the team.', 'We wrote this up for you.'],
    ['<img src=x onerror=alert(1)> is text here', 'last line'],
  ]);
  const nodes = messageToNodes(msg, fakeDoc());
  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes.map((p) => p.tag), ['p', 'p']);
  assert.deepEqual(nodes[0].children.map((c) => c.tag), ['#text', 'br', '#text']);
  // The markup arrived as ONE text node, never as an element.
  assert.equal(nodes[1].children[0].tag, '#text');
  assert.equal(nodes[1].children[0].text, '<img src=x onerror=alert(1)> is text here');
  assert.ok(nodes.every((p) => p.children.every((c) => c.tag === '#text' || c.tag === 'br')));
});

test('an empty message is no nodes, and a message longer than the Worker cap is cut at the cap', () => {
  assert.deepEqual(messageToNodes('', fakeDoc()), []);
  assert.deepEqual(messageToNodes(null, fakeDoc()), []);
  assert.deepEqual(messageParagraphs('\n\n  \n'), []);
  const long = messageParagraphs('a'.repeat(MAX_MESSAGE + 500));
  assert.equal(long[0][0].length, MAX_MESSAGE);
  assert.equal(NOTE_MAX, MAX_CLAIM_NOTE, 'the note box allows exactly what the Worker keeps');
});

test('the greeting names the person, or says Hello; the preparer line names only a well-formed login', () => {
  assert.equal(greetingLine('Sam'), 'Hi Sam,');
  assert.equal(greetingLine('  Sam \n Lee '), 'Hi Sam Lee,');
  assert.equal(greetingLine(''), 'Hello,');
  assert.equal(greetingLine(null), 'Hello,');
  assert.equal(greetingLine('x'.repeat(200)).length, 'Hi ,'.length + 60);
  assert.equal(preparedByLine('atwellpub'), 'Prepared for you by @atwellpub at GBTI Network.');
  assert.equal(preparedByLine('@atwellpub'), 'Prepared for you by @atwellpub at GBTI Network.');
  assert.equal(preparedByLine(null), 'Prepared for you by GBTI Network.');
  assert.equal(preparedByLine('<b>x</b>'), 'Prepared for you by GBTI Network.');
});

test('the free-year line comes from the registry data and is omitted when the tier or its terms are unknown', () => {
  assert.equal(tierLine({ tier: 'member', freeDays: 365 }, TIERS),
    'The invitation comes with a free year at the Network Supporter tier, normally $50 a year. No card is needed, and nothing bills automatically.');
  assert.match(tierLine({ tier: 'member', freeDays: 90 }, TIERS), /^The invitation comes with 90 free days at the Network Supporter tier/);
  assert.equal(tierLine({ tier: 'member', freeDays: 365 }, { member: { label: 'Free', priceAnnual: 0 } }),
    'The invitation comes with a free year at the Free tier. No card is needed, and nothing bills automatically.');
  assert.equal(tierLine({ tier: 'founder', freeDays: 365 }, TIERS), null, 'an unknown tier omits the line');
  assert.equal(tierLine({ tier: 'member', freeDays: null }, TIERS), null, 'terms the Worker could not read omit it');
  assert.equal(tierLine({ tier: null, freeDays: null }, TIERS), null);
  assert.equal(tierLine({ tier: 'toString', freeDays: 365 }, TIERS), null, 'no prototype key is a tier');
  assert.equal(tierLine({ tier: 'member', freeDays: 365 }, {}), null);
});

// ---- links and images ------------------------------------------------------------------------------------------

test('safeHref admits absolute http(s) only', () => {
  assert.equal(safeHref('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(safeHref('HTTP://Example.com'), 'http://example.com/');
  for (const bad of [
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)', '//evil.example/x', '/relative/path', 'relative', '#top', 'mailto:a@b.c', 'ftp://x.y/z',
    'java\u0000script:alert(1)', 'https://x.com/\u0000', 'javascript&colon;alert(1)', '', null, undefined, {},
  ]) assert.equal(safeHref(bad), null, JSON.stringify(bad));
});

test('image names and references follow the listing store shape, and payloads become image data URLs only', () => {
  assert.ok(isImageName('icon.png') && isImageName('shot-1.jpeg') && isImageName('a.webp'));
  assert.ok(!isImageName('Icon.png') && !isImageName('x.svg') && !isImageName('../x.png') && !isImageName('.png'));
  assert.equal(listingImageName('./images/icon.png'), 'icon.png');
  assert.equal(listingImageName('members/sam/images/icon.png'), null, 'the flat shape is refused');
  assert.equal(listingImageName('https://cdn.example/icon.png'), null);
  assert.deepEqual(listingImageNames({ images: ['icon.png', 'icon.png', 'X.png', 'b.gif', 7] }), ['icon.png', 'b.gif']);
  assert.deepEqual(listingImageNames(null), []);

  assert.deepEqual(safeImagePayload({ dataBase64: 'iVBORw0KGgo=', contentType: 'image/png' }, 'a.png'), { dataBase64: 'iVBORw0KGgo=', contentType: 'image/png' });
  // A stored type that is not an image is replaced by the file extension's, or refused.
  assert.equal(safeImagePayload({ dataBase64: 'AAAA', contentType: 'text/html' }, 'a.png').contentType, 'image/png');
  assert.equal(safeImagePayload({ dataBase64: 'AAAA', contentType: 'image/svg+xml' }, 'a.svg'), null);
  assert.equal(safeImagePayload({ dataBase64: 'AAAA', contentType: 'text/html' }, ''), null);
  assert.equal(safeImagePayload({ dataBase64: 'AA"onerror="x', contentType: 'image/png' }, 'a.png'), null, 'base64 only');
  assert.equal(safeImagePayload(null, 'a.png'), null);
  assert.equal(imageDataUrl({ dataBase64: 'AAAA', contentType: 'image/gif' }), 'data:image/gif;base64,AAAA');
  assert.equal(imageDataUrl(null), '');
});

test('body links, images and frames: http(s) or in-page anchors, the listing images, and only the /embed relay', () => {
  const images = { 'shot.png': 'data:image/png;base64,AAAA' };
  assert.equal(bodyImageSrc('./images/shot.png', images), 'data:image/png;base64,AAAA');
  assert.equal(bodyImageSrc('./images/missing.png', images), null);
  assert.equal(bodyImageSrc('https://cdn.example/x.png', images), 'https://cdn.example/x.png');
  assert.equal(bodyImageSrc('javascript:alert(1)', images), null);
  assert.equal(bodyImageSrc('/claim/images/x.png', images), null, 'never resolved against this page');
  assert.equal(bodyLinkHref('#fn-1'), '#fn-1');
  assert.equal(bodyLinkHref('https://example.com'), 'https://example.com/');
  assert.equal(bodyLinkHref('javascript:alert(1)'), null);
  assert.equal(bodyLinkHref('#"><x'), null);
  const yt = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
  assert.equal(relayFrameSrc(yt, 'https://preview.gbti.network'), `https://preview.gbti.network/embed/?u=${encodeURIComponent(yt)}`);
  assert.equal(relayFrameSrc('https://example.com/not-a-video', 'https://gbti.network'), null);
  assert.equal(relayFrameSrc(yt, 'javascript:x'), null);
  // The renderer's relay frame is moved onto this page's origin; every other frame is dropped.
  assert.equal(bodyFrameSrc(`https://gbti.network/embed/?u=${encodeURIComponent(yt)}`, 'https://gbti.network'), `https://gbti.network/embed/?u=${encodeURIComponent(yt)}`);
  assert.equal(bodyFrameSrc(`https://gbti.network/embed/?u=${encodeURIComponent(yt)}`, 'http://localhost:4321'), `http://localhost:4321/embed/?u=${encodeURIComponent(yt)}`);
  assert.equal(bodyFrameSrc('https://evil.example/embed/?u=x', 'https://gbti.network'), null);
  assert.equal(bodyFrameSrc('https://www.youtube.com/embed/dQw4w9WgXcQ', 'https://gbti.network'), null);
  assert.equal(bodyFrameSrc('javascript:alert(1)', 'https://gbti.network'), null);
});

// ---- the listing view model ------------------------------------------------------------------------------------

const LISTING = {
  type: 'project', slug: 'widget',
  frontmatter: {
    title: 'Widget', shortDescription: 'Does widget things.', categories: ['devops', 'unknown-key'], tags: ['cli', ' '],
    icon: './images/icon.png', iconLarge: './images/icon-large.png', featuredImage: './images/cover.png',
    banner: 'https://cdn.example/remote-banner.png', version: '1.2.0', requires: 'Node 20+', platforms: ['linux', 'mac'],
    license: 'MIT', pricing: 'free', pricingUrl: 'javascript:alert(1)', video: 'javascript:alert(1)',
    gallery: ['./images/shot-1.png', { src: './images/shot-2.png', caption: 'Second' }, { src: 'https://cdn.example/x.png' }],
    links: [
      { type: 'homepage', url: 'javascript:alert(document.cookie)', primary: true },
      { type: 'repository', url: 'https://github.com/sam/widget' },
      { type: 'download', url: 'data:text/html,<script>alert(1)</script>' },
      { type: 'documentation', url: 'https://docs.example/widget', label: 'Docs' },
      { type: 'support', url: 'https://example.com/support', visibility: 'members' },
    ],
  },
  body: '# Widget\n\nHello.',
};
const IMAGES = {
  'icon.png': 'data:image/png;base64,SUNPTg==', 'icon-large.png': 'data:image/png;base64,TEFSR0U=',
  'shot-1.png': 'data:image/png;base64,MQ==', 'shot-2.png': 'data:image/png;base64,Mg==',
};

test('the listing view refuses every non-http(s) link: a javascript: primary never becomes the install button', () => {
  const m = listingModel(LISTING, { labels: { devops: 'DevOps' }, images: IMAGES });
  const every = [m.repo, m.primary, ...m.railLinks].filter(Boolean).map((l) => l.url);
  assert.ok(every.length >= 2);
  for (const u of every) assert.match(u, /^https?:\/\//, u);
  assert.equal(m.repo.url, 'https://github.com/sam/widget');
  assert.equal(m.primary.url, 'https://docs.example/widget', 'the only public non-repository link left');
  assert.equal(m.primary.label, 'Docs');
  assert.deepEqual(m.railLinks.map((l) => [l.url, l.locked]), [['https://example.com/support', true]]);
  assert.equal(m.video, null, 'a javascript: video is not framed');
  assert.ok(!JSON.stringify(m).includes('javascript:'), 'no javascript: anywhere in the model');
  assert.ok(!JSON.stringify(m).includes('data:text'), 'no data: document anywhere in the model');
});

test('image fields resolve only to the listing images that arrived; a remote image field is not loaded', () => {
  const m = listingModel(LISTING, { labels: {}, images: IMAGES });
  // The remote banner wins the hero pick (as on the published page) but is not a listing image, so the hero falls
  // back to the default band rather than loading a third-party address or leaving a hole.
  assert.deepEqual(m.hero, { image: '', preset: 'ink' });
  assert.equal(m.mark, IMAGES['icon-large.png']);
  assert.equal(m.barMark, IMAGES['icon.png']);
  assert.deepEqual(m.gallery.map((s) => s.src), [IMAGES['shot-1.png'], IMAGES['shot-2.png']]);
  assert.equal(m.captioned, true);
  const noBanner = listingModel({ ...LISTING, frontmatter: { ...LISTING.frontmatter, banner: undefined } }, { images: { 'cover.png': 'data:image/png;base64,Q09W' } });
  assert.deepEqual(noBanner.hero, { image: 'data:image/png;base64,Q09W', preset: null });
  const preset = listingModel({ ...LISTING, frontmatter: { ...LISTING.frontmatter, banner: undefined, bannerPreset: 'green' } }, {});
  assert.deepEqual(preset.hero, { image: '', preset: 'green' });
});

test('the rest of the view: labels, specs, tags, the side, the video through the relay', () => {
  const m = listingModel({ ...LISTING, frontmatter: { ...LISTING.frontmatter, video: 'https://youtu.be/dQw4w9WgXcQ', sidebarPosition: 'left' } }, { labels: { devops: 'DevOps' }, images: IMAGES });
  assert.equal(m.title, 'Widget');
  assert.equal(m.description, 'Does widget things.');
  assert.deepEqual(m.crumbs, [{ key: 'devops', label: 'DevOps' }, { key: 'unknown-key', label: 'unknown-key' }]);
  assert.deepEqual(m.specs, [['Version', '1.2.0'], ['Requires', 'Node 20+'], ['Works with', 'linux, mac'], ['License', 'MIT']]);
  assert.deepEqual(m.tags, ['cli']);
  assert.equal(m.version, 'v1.2.0');
  assert.equal(m.pricing, 'Free');
  assert.equal(m.ctaSub, 'Free · Node 20+');
  assert.equal(m.side, 'left');
  assert.equal(m.video, 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(m.body, '# Widget\n\nHello.');
  // The schema default puts the rail on the right, as the published page does when the field is absent.
  assert.equal(listingModel({ slug: 's', frontmatter: {} }).side, 'right');
  assert.equal(listingModel({ slug: 's', frontmatter: {} }).title, 's');
  assert.equal(listingModel(null).title, 'Untitled project');
});

// ---- the Worker's answers --------------------------------------------------------------------------------------

test('the page knows exactly the 13 states the claim route can answer', () => {
  assert.deepEqual([...SERVER_STATES].sort(), Object.values(CLAIM_STATE).sort());
  for (const s of PAGE_STATES) assert.ok(!SERVER_STATES.includes(s), `${s} is the page's own`);
});

test('status answers: a named state is shown, a 401 is signed out, and anything else is asked again', () => {
  assert.deepEqual(statusFromResponse(200, { ok: true, state: 'ready', projectUrl: null, retryAfterSeconds: null }),
    { state: 'ready', projectUrl: null, retryAfterSeconds: null });
  assert.deepEqual(statusFromResponse(200, { ok: true, state: 'claimed', projectUrl: 'https://gbti.network/projects/widget/' }),
    { state: 'claimed', projectUrl: 'https://gbti.network/projects/widget/', retryAfterSeconds: null });
  assert.equal(statusFromResponse(200, { ok: true, state: 'claimed', projectUrl: 'javascript:alert(1)' }).projectUrl, null);
  assert.equal(statusFromResponse(200, { ok: true, state: 'publishing', retryAfterSeconds: 10 }).retryAfterSeconds, 10);
  assert.deepEqual(statusFromResponse(401, { error: 'unauthorized' }), { state: 'signin' });
  assert.deepEqual(statusFromResponse(429, { ok: false }), { transient: true, rateLimited: true });
  for (const [st, body] of [[200, { ok: true, state: 'grant_everything' }], [200, { ok: false, state: 'ready' }], [200, null],
    [502, { ok: false, error: 'index_unavailable' }], [503, {}], [500, { error: 'misconfigured' }], [403, { error: 'forbidden' }]]) {
    assert.deepEqual(statusFromResponse(st, body), { transient: true }, `${st} ${JSON.stringify(body)}`);
  }
});

test('Publish answers: 200 is publishing, a refusal that names a state shows it, any other refusal stays on the note', () => {
  assert.deepEqual(postOutcome(200, { ok: true, state: 'publishing', number: 12 }), { state: 'publishing' });
  assert.deepEqual(postOutcome(409, { ok: false, error: 'claim_not_ready', state: 'pending_grant', grantPending: true }), { state: 'pending_grant', projectUrl: null });
  assert.deepEqual(postOutcome(409, { ok: false, error: 'claimed', state: 'claimed', projectUrl: 'https://gbti.network/projects/w/' }), { state: 'claimed', projectUrl: 'https://gbti.network/projects/w/' });
  assert.deepEqual(postOutcome(409, { ok: false, error: 'claim_failed', state: 'claim_failed' }), { state: 'claim_failed', projectUrl: null });
  assert.deepEqual(postOutcome(403, { ok: false, error: 'wrong_account', state: 'wrong_account' }), { state: 'wrong_account', projectUrl: null });
  assert.deepEqual(postOutcome(404, { ok: false, error: 'inactive', state: 'inactive' }), { state: 'inactive', projectUrl: null });
  assert.deepEqual(postOutcome(401, { error: 'unauthorized' }), { state: 'signin' });
  assert.deepEqual(postOutcome(400, { ok: false, error: 'note_required' }), { state: 'ready', error: 'note_required' });
  assert.deepEqual(postOutcome(409, { ok: false, error: 'slug_taken' }), { state: 'ready', error: 'slug_taken' });
  assert.deepEqual(postOutcome(403, { error: 'forbidden', message: 'csrf check failed' }), { state: 'ready', error: 'session' });
  assert.deepEqual(postOutcome(429, null), { state: 'ready', error: 'rate_limited' });
  assert.deepEqual(postOutcome(502, null), { state: 'ready', error: 'unavailable' });
  assert.deepEqual(postOutcome(200, { ok: true, state: 'grant_everything' }), { state: 'publishing' }, 'a 200 is publishing, whatever else it says');
  assert.deepEqual(postOutcome(403, { state: 'grant_everything' }), { state: 'ready', error: 'unavailable' });
  for (const e of ['note_required', 'slug_taken', 'listing_invalid', 'too_large', 'listing_changed', 'author_disabled', 'rate_limited', 'session', 'git_failed', 'whatever']) {
    assert.ok(postErrorMessage(e).length > 20, e);
  }
  assert.equal(postErrorMessage('git_failed'), postErrorMessage('images_unavailable'), 'unlisted errors share the retry sentence');
});

// ---- the views -----------------------------------------------------------------------------------------------

const ALL_STATES = [...SERVER_STATES, ...PAGE_STATES];

test('every state has words, and an unknown state is the failed-read view, never a claim', () => {
  for (const s of ALL_STATES) {
    const v = claimView(s);
    assert.ok(v.title.length > 5, `${s} has a title`);
    assert.ok(v.surface === 'dialog' || v.surface === 'panel');
  }
  const odd = claimView('grant_everything');
  assert.equal(odd.state, 'error');
  assert.equal(odd.note, false);
  assert.equal(odd.signin, null);
});

test('only ready and claim_failed offer the note; only signed-out and redeem offer sign-in with the free-year line', () => {
  for (const s of ALL_STATES) {
    const v = claimView(s);
    assert.equal(v.note, s === 'ready' || s === 'claim_failed', `${s} note`);
    assert.equal(Boolean(v.signin), s === 'signin' || s === 'redeem', `${s} signin`);
    assert.equal(v.tier, s === 'signin' || s === 'redeem', `${s} tier`);
    assert.equal(v.poll, POLLING_STATES.includes(s), `${s} poll`);
  }
  assert.equal(claimView('signin').signin.label, 'Sign in with GitHub to claim this listing');
  assert.equal(claimView('redeem').signin.label, 'Accept the free year');
});

test('nothing of the listing is on the inactive, claimed or failed-read pages', () => {
  for (const s of ['inactive', 'claimed', 'error', 'rate_limited', 'loading']) assert.equal(claimView(s).surface, 'panel', s);
  for (const s of ['ready', 'redeem', 'signin', 'publishing', 'pending_grant', 'wrong_account', 'preview_only', 'year_used']) {
    assert.equal(claimView(s).surface, 'dialog', s);
  }
});

test('a long wait says the link keeps working, and a tab left open stops asking and offers a button', () => {
  for (const s of ['pending_grant', 'pending_folder', 'publishing']) {
    const early = claimView(s, { waitedMs: 60 * 1000 });
    const late = claimView(s, { waitedMs: SETUP_PATIENCE_MS });
    assert.notEqual(early.text, late.text, s);
    assert.match(late.text, /link|close this page/i, s);
    const done = claimView(s, { waitedMs: POLL_GIVE_UP_MS, gaveUp: true });
    assert.equal(done.poll, false);
    assert.equal(done.busy, false);
    assert.deepEqual(done.actions.map((a) => a.kind), ['recheck']);
  }
  assert.match(claimView('pending_folder', { waitedMs: SETUP_PATIENCE_MS }).text, /Your link keeps working/);
});

test('a new account (welcome=1) is handed on to the welcome steps from every state that ends the visit, and only those', () => {
  for (const s of ALL_STATES) {
    const v = claimView(s, { welcome: true, projectUrl: 'https://gbti.network/projects/widget/' });
    const hands = v.actions.filter((a) => a.label === 'Continue to the welcome steps');
    if (TERMINAL_STATES.includes(s)) {
      assert.equal(hands.length, 1, s);
      assert.equal(v.actions[0], hands[0], `${s}: the hand-off comes first`);
      assert.equal(v.actions.filter((a) => a.primary).length, 1, `${s}: one primary action`);
    } else {
      assert.equal(hands.length, 0, s);
    }
    assert.equal(claimView(s).actions.filter((a) => a.label === 'Continue to the welcome steps').length, 0, `${s} without welcome`);
  }
  const claimed = claimView('claimed', { welcome: true, projectUrl: 'https://gbti.network/projects/widget/' });
  assert.equal(claimed.redirect, '/welcome/?next=%2Fprojects%2Fwidget%2F');
  assert.ok(WELCOME_REDIRECT_MS >= 3000, 'long enough to read the success first');
  assert.equal(claimView('claimed', { welcome: false }).redirect, null);
  assert.equal(claimView('inactive', { welcome: true }).redirect, null, 'only a claim sends the page on by itself');
});

test('the success view links the project only through safeHref, and the welcome carries it only as a same-site path', () => {
  const ok = claimView('claimed', { projectUrl: 'https://gbti.network/projects/widget/' });
  assert.deepEqual(ok.actions.map((a) => [a.label, a.href]), [['View your project', 'https://gbti.network/projects/widget/'], ['Open your WorkBench', '/workbench/']]);
  const bad = claimView('claimed', { projectUrl: 'javascript:alert(1)' });
  assert.deepEqual(bad.actions.map((a) => a.href), ['/workbench/']);
  assert.equal(welcomeHref('https://gbti.network/projects/widget/'), '/welcome/?next=%2Fprojects%2Fwidget%2F');
  assert.equal(welcomeHref('https://evil.example/projects/widget/?x=1'), '/welcome/?next=%2Fprojects%2Fwidget%2F', 'the path only, never the host');
  assert.equal(welcomeHref('https://gbti.network/account/'), '/welcome/');
  assert.equal(welcomeHref('javascript:alert(1)'), '/welcome/');
  assert.equal(welcomeHref(null), '/welcome/');
});

test('wrong account offers sign out; the free-year states offer membership; the preparer gets no claim control', () => {
  assert.deepEqual(claimView('wrong_account').actions.map((a) => a.kind), ['signout']);
  for (const s of ['year_used', 'year_unavailable']) {
    assert.deepEqual(claimView(s).actions.map((a) => [a.kind, a.href]), [['link', '/membership/']]);
    assert.match(claimView(s).text, /link works once you are a member/);
  }
  const prev = claimView('preview_only');
  assert.equal(prev.note, false);
  assert.equal(prev.signin, null);
  assert.deepEqual(claimView('error').actions.map((a) => a.kind), ['retry']);
});

// ---- the words -----------------------------------------------------------------------------------------------

/** Every sentence this module can put on the page. */
function everySentence() {
  const out = [];
  for (const s of [...ALL_STATES, 'grant_everything']) {
    for (const opts of [{}, { welcome: true, projectUrl: 'https://gbti.network/projects/w/' }, { waitedMs: SETUP_PATIENCE_MS }, { gaveUp: true, waitedMs: POLL_GIVE_UP_MS }]) {
      const v = claimView(s, opts);
      out.push(v.title, v.text, ...(v.signin ? [v.signin.label] : []), ...v.actions.map((a) => a.label));
    }
  }
  for (const e of ['note_required', 'slug_taken', 'listing_invalid', 'too_large', 'listing_changed', 'author_disabled', 'rate_limited', 'session', 'other']) {
    out.push(postErrorMessage(e));
  }
  out.push(tierLine({ tier: 'member', freeDays: 365 }, TIERS), tierLine({ tier: 'member', freeDays: 90 }, TIERS));
  out.push(greetingLine('Sam'), greetingLine(''), preparedByLine('sam'), preparedByLine(null));
  return out.filter(Boolean);
}

test('the page copy follows the writing rules: no dashes, no contractions, and "free year", never "trial"', () => {
  const words = everySentence();
  assert.ok(words.length > 60, `read ${words.length} sentences: this check is broken if that is small`);
  const all = words.join('\n');
  assert.doesNotMatch(all, /[\u2014\u2013]/, 'no em or en dash');
  assert.doesNotMatch(all, / - /, 'no spaced hyphen standing in for a dash');
  assert.doesNotMatch(all, /\btrial\b/i, 'free year, never trial');
  assert.doesNotMatch(all, /\b\w+n't\b|\b\w+'(?:re|ve|ll|d|m)\b|\b(?:it|that|there|what|here|he|she|who|let)'s\b/i, 'no contractions');
  assert.doesNotMatch(all, /[\u2018\u2019]/, 'no curly apostrophes hiding a contraction');
  assert.match(all, /free year/, 'the control: the offer is named');
  // Control: the same scans fire on a sentence that breaks them.
  assert.match("It isn't ready", /\b\w+n't\b/);
  assert.match('a trial \u2014 now', /[\u2014\u2013]/);
});
