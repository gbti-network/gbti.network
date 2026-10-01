// sow-434: the pure core of the example profile page (/claim/profile/?code=<CODE>). Every decision the page script makes
// is here: which code it may ask about, what an answer means, what a dead link shows (the invitation page's own words,
// nothing about the listing), what the example shows, whose photo it may draw, and which addresses it may link to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseProfileQuery, invitationHref, exampleProfileHref, githubProfileUrl, readOutcome, panelView, profileName,
  profileInitial, cardAuthor, projectsHeading, projectCard, viewerPicture, NAME_MAX, PHOTO_SIZE, BANNER_LEAD, BANNER_TEXT,
  BIO_PLACEHOLDER, INERT_TOOLTIP,
} from '../src/lib/claim-profile-core.mjs';
import * as claimCore from '../src/lib/claim-core.mjs';

const { claimReturnPath, claimView } = claimCore;

const LISTING = Object.freeze({
  type: 'project', slug: 'widget-toolkit',
  frontmatter: {
    title: 'Widget Toolkit', shortDescription: 'Keeps widgets in line.', categories: ['devops', 'frameworks'],
    icon: './images/icon.png', pricing: 'free',
    links: [{ type: 'repository', url: 'https://github.com/sam/widget' }, { type: 'homepage', url: 'https://widget.example/' }],
  },
  body: '', images: ['icon.png'], recipientName: 'Sam Rivera', message: '', suggestedNote: '',
  githubLogin: 'Sam-Rivera', preparedByLogin: 'atwellpub', tier: 'member', freeDays: 365,
});

// ---------------------------------------------------------------------------------------------------------------
// The code and the addresses built from it

test('parseProfileQuery: the code in canonical form, or null before any request', () => {
  assert.deepEqual(parseProfileQuery('?code=abc123'), { code: 'ABC123' });
  assert.deepEqual(parseProfileQuery('?code=%20xyz9%20&welcome=1'), { code: 'XYZ9' }, 'trimmed; other keys ignored');
  for (const bad of ['', '?code=', '?code=ab', '?code=a!b2', `?code=${'A'.repeat(33)}`, '?other=ABC123', null, undefined, 42]) {
    assert.deepEqual(parseProfileQuery(bad), { code: null }, String(bad));
  }
});

test('invitationHref is exactly the invitation return path; exampleProfileHref is this page', () => {
  for (const c of ['ABC123', 'abc123', ' Z9Z9 ']) {
    assert.equal(invitationHref(c), claimReturnPath(c), 'the same address the invitation page and the Worker use');
    assert.equal(exampleProfileHref(c), `/claim/profile/?code=${c.trim().toUpperCase()}`);
  }
  for (const bad of ['', 'ab', '../x', 'A B C', null, {}]) {
    assert.equal(invitationHref(bad), null);
    assert.equal(exampleProfileHref(bad), null);
  }
});

test('the invitation page\'s byline links to this page: both cores build the same address', () => {
  // claim-core's exampleProfileHref is the link on the invitation page (the byline name); this page's own is the
  // address it hands back to itself. If either changes alone, the byline points at a page that is not there.
  assert.equal(typeof claimCore.exampleProfileHref, 'function', 'the invitation page links to the example profile');
  for (const c of ['ABC123', ' abc123 ', 'ab', '', null]) assert.equal(claimCore.exampleProfileHref(c), exampleProfileHref(c), String(c));
});

test('githubProfileUrl: only a well-formed login becomes an address, case kept', () => {
  assert.equal(githubProfileUrl('Sam-Rivera'), 'https://github.com/Sam-Rivera');
  assert.equal(githubProfileUrl('a'), 'https://github.com/a');
  for (const bad of [null, undefined, '', '-sam', 'sam-', 'sa--m', 'sam/../evil', 'sam rivera', 'javascript:alert(1)',
    'https://evil.example', 'x'.repeat(40), 42, ['sam']]) {
    assert.equal(githubProfileUrl(bad), null, String(bad));
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Reading the Worker's answer, and the panel

test('readOutcome: only an ok answer carrying a listing object is a listing', () => {
  assert.deepEqual(readOutcome(200, { ok: true, listing: LISTING }), { listing: LISTING });
  assert.deepEqual(readOutcome(429, null), { rateLimited: true });
  assert.deepEqual(readOutcome(404, { ok: false }), { inactive: true });
  for (const [status, body] of [[200, { ok: false }], [200, null], [200, { ok: true }], [200, { ok: true, listing: [] }],
    [200, { ok: true, listing: 'x' }], [200, { ok: 'true', listing: LISTING }], [400, { ok: true, listing: LISTING }], [403, null], [302, null]]) {
    assert.deepEqual(readOutcome(status, body), { inactive: true }, `${status} ${JSON.stringify(body)}`);
  }
  for (const status of [0, 500, 502, 503]) assert.deepEqual(readOutcome(status, null), { error: true }, String(status));
});

test('panelView: a dead link reads exactly as it does on the invitation page, and takes no listing to say so', () => {
  assert.equal(panelView.length, 1, 'the panel is decided from the state alone: it cannot carry anything of the listing');
  for (const state of ['inactive', 'rate_limited']) {
    const v = panelView(state);
    const c = claimView(state);
    assert.equal(v.title, c.title);
    assert.equal(v.text, c.text);
    assert.deepEqual(v.actions, c.actions);
    assert.equal(v.busy, false);
  }
  assert.equal(panelView('inactive').title, 'This invitation is no longer active');
  for (const state of ['error', 'claimed', 'ready', 'signin', 'nonsense', '', undefined]) {
    assert.equal(panelView(state).title, claimView('error').title, `${state} falls back to the failed read, never a claim`);
  }
  const loading = panelView('loading');
  assert.deepEqual(loading, { title: 'Opening the example profile', text: '', busy: true, actions: [] });
  // The actions carry site paths only, so the page's actionNode never meets an outside address here.
  for (const state of ['inactive', 'rate_limited', 'error']) {
    for (const a of panelView(state).actions) if (a.href !== undefined) assert.match(a.href, /^\/(?!\/)/);
  }
  // A copy, so the page can never change the core's frozen view through it.
  const a = panelView('inactive');
  a.actions[0].label = 'changed';
  assert.notEqual(panelView('inactive').actions[0].label, 'changed');
});

// ---------------------------------------------------------------------------------------------------------------
// What the example shows

test('profileName: the recipient name, cleaned and capped; then the tied login; then a placeholder', () => {
  assert.equal(profileName(LISTING), 'Sam Rivera');
  assert.equal(profileName({ recipientName: '  Sam\u0000\n  Rivera\t ' }), 'Sam Rivera');
  assert.equal(profileName({ recipientName: 'x'.repeat(300) }).length, NAME_MAX);
  assert.equal(NAME_MAX, 100, 'the claim slices the profile displayName to 100 (prepared-claim-files.mjs)');
  assert.match(readFileSync(new URL('../membership/prepared-claim-files.mjs', import.meta.url), 'utf8'), /\.slice\(0, 100\)/);
  assert.equal(profileName({ recipientName: '', githubLogin: 'Sam-Rivera' }), 'Sam-Rivera');
  assert.equal(profileName({ recipientName: '   ', githubLogin: 'bad login' }), 'Your name');
  assert.equal(profileName(null), 'Your name');
  assert.equal(profileName({ recipientName: 42 }), 'Your name');
});

test('cardAuthor: the GBTI folder the card will print once published, when it is known', () => {
  assert.equal(cardAuthor(LISTING), 'sam-rivera', 'a tied login, lower-cased as a new folder is');
  assert.equal(cardAuthor(LISTING, 'samr'), 'samr', 'the viewer\'s own folder wins when they are the person invited');
  assert.equal(cardAuthor({ ...LISTING, githubLogin: null }), 'Sam Rivera', 'neither known: the name');
  assert.equal(cardAuthor({ ...LISTING, githubLogin: null }, 'Not A Folder'), 'Sam Rivera');
});

test('projectsHeading: as the published profile writes it', () => {
  assert.equal(projectsHeading('Sam Rivera'), 'Projects by Sam Rivera');
  assert.equal(projectsHeading(''), 'Projects by you');
  assert.equal(projectsHeading('A\nB'), 'Projects by A B');
});

test('projectCard: the fields ProjectCard renders, by the same rules', () => {
  const card = projectCard(LISTING, { frameworks: 'Frameworks', devops: 'DevOps' });
  assert.deepEqual(card, {
    title: 'Widget Toolkit', description: 'Keeps widgets in line.', category: 'Frameworks', paid: false,
    membersLinks: false, repo: 'https://github.com/sam/widget', iconName: 'icon.png',
  });
  const fm = (over) => ({ ...LISTING, frontmatter: { ...LISTING.frontmatter, ...over } });
  // The leaf label, falling back to the key as leafLabel does; no categories, no chip.
  assert.equal(projectCard(fm({ categories: ['devops', 'mystery'] }), {}).category, 'mystery');
  assert.equal(projectCard(fm({ categories: [] })).category, '');
  // Paid is anything set that is not free (ProjectCard: d.pricing && d.pricing !== 'free').
  for (const [pricing, paid] of [['free', false], ['', false], [undefined, false], ['paid', true], ['freemium', true]]) {
    assert.equal(projectCard(fm({ pricing })).paid, paid, String(pricing));
  }
  // Members chip: any members-only link. Repo: the first PUBLIC repository link, through safeHref.
  const links = [
    { type: 'repository', url: 'https://github.com/sam/private', visibility: 'members' },
    { type: 'repository', url: 'https://github.com/sam/public' },
  ];
  assert.equal(projectCard(fm({ links })).repo, 'https://github.com/sam/public');
  assert.equal(projectCard(fm({ links })).membersLinks, true);
  assert.equal(projectCard(fm({ links: [{ type: 'repository', url: 'javascript:alert(1)' }] })).repo, null);
  assert.equal(projectCard(fm({ links: 'nope' })).repo, null);
  // The icon is one of the listing's own images, never a remote address.
  assert.equal(projectCard(fm({ icon: 'https://evil.example/x.png' })).iconName, null);
  assert.equal(projectCard(fm({ icon: undefined, iconLarge: './images/big.webp' })).iconName, 'big.webp');
  // Title fallbacks, as the invitation page's model has them.
  assert.equal(projectCard(fm({ title: '  ' })).title, 'widget-toolkit');
  assert.equal(projectCard({}).title, 'Untitled project');
  assert.equal(projectCard(null).description, '');
});

test('viewerPicture: only the person invited gets their own photo, never the preparer or another account', () => {
  const sam = { login: 'sam-rivera', username: 'sam-rivera', githubId: '12345' };
  const pic = viewerPicture(sam, LISTING);
  assert.deepEqual(pic, { seed: 'sam-rivera', photos: [`https://avatars.githubusercontent.com/u/12345?s=${PHOTO_SIZE}&v=4`, '/avatar/sam-rivera'] });
  assert.equal(viewerPicture(null, LISTING), null, 'signed out');
  assert.equal(viewerPicture({ login: 'bad login', githubId: '1' }, LISTING), null, 'a malformed login is not an identity');
  // The preparer, on an UNTIED listing (a tied one already refuses every other account, which would hide this rule).
  const untied = { ...LISTING, githubLogin: null };
  assert.equal(viewerPicture({ login: 'AtwellPub', githubId: '7' }, untied), null, 'the preparer, any case');
  assert.equal(viewerPicture({ login: 'atwellpub', githubId: '7' }, { ...untied, preparedByLogin: '@atwellpub' }), null);
  assert.equal(viewerPicture({ login: 'AtwellPub', githubId: '7' }, LISTING), null, 'and on a tied one');
  assert.equal(viewerPicture({ login: 'someone-else', githubId: '9' }, LISTING), null, 'a tied listing shows only its account');
  // Untied: anyone but the preparer is taken to be the person invited.
  assert.deepEqual(viewerPicture({ login: 'someone-else', githubId: '9' }, { ...LISTING, githubLogin: null }),
    { seed: null, photos: [`https://avatars.githubusercontent.com/u/9?s=${PHOTO_SIZE}&v=4`] });
  // Before enrollment there may be no folder; without an account number either, nothing to draw.
  assert.deepEqual(viewerPicture({ login: 'sam-rivera', username: 'Sam-Rivera' }, LISTING), { seed: 'sam-rivera', photos: ['/avatar/sam-rivera'] });
  assert.equal(viewerPicture({ login: 'sam-rivera' }, LISTING), null);
  assert.equal(viewerPicture({ login: 'sam-rivera', githubId: 'not-a-number', username: '../x' }, LISTING), null);
  assert.ok(PHOTO_SIZE <= 460, 'GitHub serves nothing larger');
});

// ---------------------------------------------------------------------------------------------------------------
// The words

test('the banner is the spec wording, with the picture among what the person adds (the claim writes none)', () => {
  assert.equal(`${BANNER_LEAD} ${BANNER_TEXT}`,
    'Example profile. This page is not published. It is set up to show how your profile will look on GBTI Network. '
    + 'When you claim your listing, your profile starts with your name, and you fill in the rest yourself, including your picture.');
  assert.doesNotMatch(BANNER_TEXT, /name and picture/, 'the claimed profile has no picture to start with');
});

test('profileInitial: the published header\'s no-picture disc, because the claim writes the profile with no avatar', () => {
  assert.equal(profileInitial('Rob Rochford'), 'R');
  assert.equal(profileInitial(profileName(LISTING)), 'S');
  assert.equal(profileInitial(profileName({})), 'Y', 'the placeholder name');
  assert.equal(profileInitial(''), '');
  assert.equal(profileInitial(null), '');
  // The published arm it mirrors, and the claim it describes: a profile built from the name alone.
  const header = readFileSync(new URL('../src/components/members/ProfileHeader.astro', import.meta.url), 'utf8');
  assert.ok(header.includes('<span class="h1" style="color:#fff">{d.displayName.charAt(0)}</span>'));
  const claim = readFileSync(new URL('../membership/prepared-claim-files.mjs', import.meta.url), 'utf8');
  assert.match(claim, /buildContentFile\(\{ type: 'profile', username: folder, input: \{ displayName \} \}\)/);
});

const CONTRACTION = /\b\w+n't\b|\b\w+'(?:re|ve|ll|d|m)\b|\b(?:it|that|there|what|here|he|she|who|let)'s\b/i;

test('every string the core can put on the page follows the writing rules', () => {
  const words = [BANNER_LEAD, BANNER_TEXT, BIO_PLACEHOLDER, INERT_TOOLTIP, panelView('loading').title, projectsHeading('X'),
    profileName(null), projectCard({}).title];
  for (const w of words) {
    assert.doesNotMatch(w, /[\u2013\u2014]/, w);
    assert.doesNotMatch(w, / - /, w);
    assert.doesNotMatch(w, CONTRACTION, w);
    assert.doesNotMatch(w, /\btrial\b/i, w);
  }
  // Controls: the scans fire on copy that breaks them.
  assert.match("it isn't", CONTRACTION);
  assert.match('a \u2014 b', /[\u2013\u2014]/);
  const src = readFileSync(new URL('../src/lib/claim-profile-core.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /[\u2013\u2014]/, 'no dash anywhere in the file, comments included');
  assert.doesNotMatch(src, /\btrial\b/i);
});

test('the core is pure: no DOM, no network, no logging', () => {
  const src = readFileSync(new URL('../src/lib/claim-profile-core.mjs', import.meta.url), 'utf8');
  const code = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
  assert.ok(code.length > 2000, 'read the code: this check is broken if that is small');
  assert.doesNotMatch(code, /\b(document|window|localStorage|fetch|XMLHttpRequest)\b/);
  assert.doesNotMatch(code, /\bconsole\./);
});
