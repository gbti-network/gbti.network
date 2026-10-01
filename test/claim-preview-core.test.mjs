// sow-434: the pure decisions behind the invitation preview looking published (src/lib/claim-core.mjs). Where each
// hero crumb and the byline link, which layout the screenshots take, what the contents rail lists, whose name and
// picture the byline carries in each state, what the pinned author note card shows and how it is labelled, and the
// published page's words for a members-only link. The DOM side is test/claim-render.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  crumbHref, exampleProfileHref, lockedHint, railDate, claimToc, bylineName, bylineIdentity, noteCardName, noteCardView, noteToNodes,
  listingModel, CLAIMANT_STATES, SERVER_STATES, NOTE_MAX, NOTE_LABEL_SUGGESTED, NOTE_LABEL_OWN, NOTE_CARD_PLACEHOLDER,
} from '../src/lib/claim-core.mjs';
import { resolveGalleryStyle, CAROUSEL_THRESHOLD } from '../src/lib/project-page.mjs';
import { MAX_SUGGESTED_NOTE } from '../membership/prepared-listings-shared.mjs';
import { cardAuthor } from '../src/lib/claim-profile-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

/** A document stand-in with just what the node builders use, so the test sees the exact tree. */
function fakeDoc() {
  const el = (tag) => ({ tag, children: [], appendChild(n) { this.children.push(n); return n; } });
  return { createElement: (tag) => el(tag), createTextNode: (text) => ({ tag: '#text', text }) };
}
const textOf = (n) => (n.tag === '#text' ? n.text : n.tag === 'br' ? '\n' : n.children.map(textOf).join(''));

const shot = (n) => ({ src: `./images/shot-${n}.png`, caption: `Shot ${n}` });
const IMAGES = Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((n) => [`shot-${n}.png`, `data:image/png;base64,U0hPVC${n}`]));
const listing = (fm = {}) => ({ slug: 'widget', frontmatter: { title: 'Widget', ...fm }, body: '' });

test('this file stays at or under the 900-line cap', () => {
  const n = read('test/claim-preview-core.test.mjs').split('\n').length;
  assert.ok(n > 40 && n <= 900, `test/claim-preview-core.test.mjs is ${n} lines`);
});

test('a hero crumb links to the feed filtered to its category, as the published crumbs do; a malformed key links nowhere', () => {
  assert.equal(crumbHref('devops'), '/feeds/?cat=devops');
  assert.equal(crumbHref('ide-plugins'), '/feeds/?cat=ide-plugins');
  for (const bad of ['', 'DevOps', '../x', 'a b', 'javascript:alert(1)', '/feeds/', 'x'.repeat(65), null, 7]) assert.equal(crumbHref(bad), null, String(bad));
  // Drift: the published crumb renderer links the same place.
  assert.match(read('src/components/CategoryCrumbs.astro'), /href=\{`\/feeds\/\?cat=\$\{encodeURIComponent\(c\.key\)\}`\}/);
});

test('the example profile link carries exactly the validated code, and nothing for a code that could not be one', () => {
  assert.equal(exampleProfileHref(' abc123 '), '/claim/profile/?code=ABC123');
  for (const bad of ['', 'ab', 'ABC-123', 'ABC123&x=1', '<b>', null]) assert.equal(exampleProfileHref(bad), null, String(bad));
});

test('a members-only link carries the published page tooltip, word for word', () => {
  const page = read('src/pages/projects/[slug].astro');
  const members = lockedHint({ visibility: 'members' });
  const encrypted = lockedHint({ visibility: 'members', encrypted: true });
  assert.equal(members, 'Members only. Open in the GBTI client to unlock.');
  assert.equal(encrypted, 'Encrypted member content. Open in the GBTI client to unlock.');
  assert.ok(page.includes(`'${members}'`) && page.includes(`'${encrypted}'`), 'the published lockedHint still says these words');
  assert.equal(lockedHint({ visibility: 'public' }), '', 'a public link has no hint');
  assert.equal(lockedHint(null), '');
});

test('the rail date is written the way the published rail writes it', () => {
  const d = new Date('2026-10-01T03:00:00Z');
  assert.equal(railDate(d), d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }));
  assert.match(read('src/pages/projects/[slug].astro'), /\['Published', d\.publishedAt\.toLocaleDateString\('en-GB', \{ day: 'numeric', month: 'short', year: 'numeric' \}\)\]/);
});

test('the screenshots take the published layout: the grid under the threshold, the carousel at it, an explicit choice wins', () => {
  const gallery = (n) => Array.from({ length: n }, (_, i) => shot(i + 1));
  for (const n of [1, 4, CAROUSEL_THRESHOLD - 1, CAROUSEL_THRESHOLD, 7]) {
    const m = listingModel(listing({ gallery: gallery(n) }), { images: IMAGES });
    assert.equal(m.galleryStyle, resolveGalleryStyle(undefined, m.gallery.length), `${n} shots`);
  }
  assert.equal(listingModel(listing({ gallery: gallery(4) }), { images: IMAGES }).galleryStyle, 'grid');
  assert.equal(listingModel(listing({ gallery: gallery(7) }), { images: IMAGES }).galleryStyle, 'carousel');
  assert.equal(listingModel(listing({ gallery: gallery(2), galleryStyle: 'carousel' }), { images: IMAGES }).galleryStyle, 'carousel');
  assert.equal(listingModel(listing({ gallery: gallery(7), galleryStyle: 'grid' }), { images: IMAGES }).galleryStyle, 'grid');
  // Counted on the shots that ARRIVED, as the published page counts the shots it has.
  const missing = listingModel(listing({ gallery: gallery(7) }), { images: { 'shot-1.png': IMAGES['shot-1.png'] } });
  assert.equal(missing.gallery.length, 1);
  assert.equal(missing.galleryStyle, 'grid');
});

test('the rail: a Published row for today in its published place, the link icon, and the tooltip on a locked link', () => {
  const fm = {
    version: '1.0.0', requires: 'Node 20+', platforms: ['linux'], license: 'MIT',
    links: [
      { type: 'download', url: 'https://example.com/get' },
      { type: 'documentation', url: 'https://docs.example.com' },
      { type: 'support', url: 'https://example.com/help', visibility: 'members' },
    ],
  };
  const now = new Date('2026-10-01T12:00:00Z');
  const m = listingModel(listing(fm), { now });
  assert.deepEqual(m.specs.map(([k]) => k), ['Version', 'Requires', 'Works with', 'Published'], 'the published order: specs, then Published (the License row follows, built from licenseRow)');
  assert.deepEqual(m.specs[3], ['Published', railDate(now)]);
  assert.ok(!listingModel(listing(fm)).specs.some(([k]) => k === 'Published'), 'no date without a now');
  assert.ok(!listingModel(listing(fm), { now: new Date('nope') }).specs.some(([k]) => k === 'Published'), 'an invalid now adds nothing');
  assert.deepEqual(m.railLinks.map((l) => [l.label, l.icon, l.locked, l.hint]), [
    ['Documentation', 'ico-link', false, ''],
    ['Support', 'ico-link', true, 'Members only. Open in the GBTI client to unlock.'],
  ]);
  assert.equal(m.primary.hint, '', 'the install button is public here');
  assert.equal(m.primary.icon, null, 'the install button keeps its own icon rule (iconForUrl)');
});

test('the contents rail: Overview, the body h2s with stamped ids, Screenshots, Discussion; under three entries, none', () => {
  const { ids, toc } = claimToc(['What it does', 'Install', 'What it does', 'Comments', 'Screenshots'], { hasGallery: true });
  assert.deepEqual(ids, ['what-it-does', 'install', 'what-it-does-2', 'comments-2', 'screenshots']);
  assert.deepEqual(toc.map((t) => t.id), ['pd-overview', ...ids, 'pd-screenshots', 'comments']);
  assert.equal(toc[0].label, 'Overview');
  assert.equal(toc.at(-1).label, 'Discussion');
  assert.equal(new Set(toc.map((t) => t.id)).size, toc.length, 'no id twice: a heading never takes a landmark id');
  for (const id of ids) assert.match(id, /^[a-z0-9_-]+$/, 'an id is safe in an href and a selector');
  assert.deepEqual(claimToc([]).toc.map((t) => t.id), [], 'Overview and Discussion alone are not worth a rail');
  assert.deepEqual(claimToc(['One']).toc.map((t) => t.id), ['pd-overview', 'one', 'comments']);
  assert.deepEqual(claimToc([], { hasGallery: true }).toc.map((t) => t.id), ['pd-overview', 'pd-screenshots', 'comments']);
  assert.equal(claimToc(['<b>x</b> & y']).ids[0], 'bxb-y', 'markup in a heading is text, and only word characters reach the id');
  assert.match(claimToc(['<img src=x onerror=alert(1)>']).ids[0], /^[a-z0-9_-]+$/);
});

test('the byline name is the recipient name on one line, or a plain stand-in', () => {
  assert.equal(bylineName('  Ali   Khallad '), 'Ali Khallad');
  assert.equal(bylineName('Ali\nKhallad\u0000'), 'Ali Khallad');
  assert.equal(bylineName(''), 'Your name');
  assert.equal(bylineName(null), 'Your name');
  assert.equal(bylineName('x'.repeat(200)).length, 80);
});

test('the byline wears the claimant face only in a claimant state; everyone else sees the blobatar of the recipient name', () => {
  const signal = { username: 'sam-dev', login: 'Sam-Dev', githubId: '123' };
  // Signed out, or signed in as the preparer, another account, or one that cannot claim: the recipient name only.
  for (const state of ['signin', 'checking', 'preview_only', 'wrong_account', 'not_permitted', 'inactive', 'claimed', 'error']) {
    assert.deepEqual(bylineIdentity({ state, signal, recipientName: 'Sam' }), { name: 'Sam', seed: 'Sam', photo: '' }, state);
  }
  assert.deepEqual(bylineIdentity({ state: 'ready', signal: null, recipientName: 'Sam' }), { name: 'Sam', seed: 'Sam', photo: '' });
  // The claimant with a GBTI folder: /avatar/<folder>, the blobatar for the folder underneath.
  assert.deepEqual(bylineIdentity({ state: 'ready', signal, recipientName: 'Sam' }), { name: 'Sam', seed: 'sam-dev', photo: '/avatar/sam-dev' });
  // Before enrollment: GitHub's picture for the account number, the blobatar for the folder the login becomes.
  assert.deepEqual(bylineIdentity({ state: 'redeem', signal: { login: 'Sam-Dev', githubId: '123' }, recipientName: 'Sam' }),
    { name: 'Sam', seed: 'sam-dev', photo: 'https://avatars.githubusercontent.com/u/123?s=128&v=4' });
  // Nothing usable: the recipient name, never a guessed picture.
  assert.deepEqual(bylineIdentity({ state: 'ready', signal: { username: 'Not A Folder', githubId: 'abc' }, recipientName: '' }), { name: 'Your name', seed: 'Your name', photo: '' });
  // The name stays the recipient's: a login is not a display name.
  assert.equal(bylineIdentity({ state: 'ready', signal, recipientName: 'Sam' }).name, 'Sam');
  for (const s of CLAIMANT_STATES) assert.ok(SERVER_STATES.includes(s), s);
  for (const s of ['preview_only', 'wrong_account', 'not_permitted', 'claimed', 'inactive']) assert.ok(!CLAIMANT_STATES.includes(s), s);
});

test('the note card name is the folder the published card prints, not the byline display name', () => {
  // Published: the byline reads the profile name, the pinned card authorDisplay(folder) (Comments.astro).
  const comments = read('src/components/blog/Comments.astro');
  assert.match(comments, /const introName = intro \? authorDisplay\(intro\.data\.author\) : '';/, 'the published card prints the folder');
  assert.match(comments, /class="link" style="font-weight:700;display:inline-flex">\{introName\}<\/a>/);
  const tied = { recipientName: 'Rob Rochford', githubLogin: 'RobRoch' };
  const untied = { recipientName: 'Rob Rochford', githubLogin: null };
  const claimant = { username: 'RobRoch', login: 'RobRoch', githubId: '42' };
  // Signed in as the person invited, with a folder: that folder.
  assert.equal(noteCardName({ state: 'ready', signal: claimant, listing: untied }), 'robroch');
  // A tied invitation, signed out or signed in as someone else: the bound login, lower-cased as a new folder is.
  assert.equal(noteCardName({ state: 'signin', signal: null, listing: tied }), 'robroch');
  assert.equal(noteCardName({ state: 'wrong_account', signal: { username: 'other' }, listing: tied }), 'robroch');
  // Untied and signed out, or a non-claimant state: the recipient name, as the byline has it.
  assert.equal(noteCardName({ state: 'signin', signal: null, listing: untied }), 'Rob Rochford');
  assert.equal(noteCardName({ state: 'preview_only', signal: { username: 'atwellpub' }, listing: untied }), 'Rob Rochford', 'never the preparer');
  assert.equal(noteCardName({ state: 'ready', signal: { username: 'Not A Folder' }, listing: { recipientName: '' } }), 'Your name');
  assert.equal(noteCardName({ state: 'signin', listing: { recipientName: 'Rob', githubLogin: 'bad login' } }), 'Rob', 'a malformed login is no folder');
  assert.equal(noteCardName(), 'Your name');
  // The example profile's card prints the same rule, so the two pages name the person alike.
  for (const [listing, folder] of [[tied, null], [untied, null], [untied, 'robroch'], [tied, 'robroch']]) {
    const state = folder ? 'ready' : 'signin';
    const signal = folder ? { username: folder } : null;
    assert.equal(noteCardName({ state, signal, listing }), cardAuthor(listing, folder), JSON.stringify([listing, folder]));
  }
  // The byline keeps the display name.
  assert.equal(bylineIdentity({ state: 'ready', signal: claimant, recipientName: 'Rob Rochford' }).name, 'Rob Rochford');
  // And the page passes the card this name, with the byline's face.
  const page = read('src/lib/claim-page.ts');
  assert.match(page, /const name = noteCardName\(\{ state, signal: currentIdentity\(readMemberSignal\(\)\), listing \}\);\n\s*renderNoteCard\(doc, holder, \{ \.\.\.who\(\), name \}, profileHref, view\);/);
});

test('the note card: the suggestion labelled as one, the person own words once changed, a placeholder when empty', () => {
  const sug = 'Tracks AI answers.\n\nThanks for reading.';
  assert.deepEqual(noteCardView({ suggestion: sug }), { label: NOTE_LABEL_SUGGESTED, text: sug, placeholder: '' }, 'before the note box exists');
  assert.deepEqual(noteCardView({ suggestion: sug, current: sug }), { label: NOTE_LABEL_SUGGESTED, text: sug, placeholder: '' }, 'pre-filled, untouched');
  assert.deepEqual(noteCardView({ suggestion: sug, current: `${sug} More.` }), { label: NOTE_LABEL_OWN, text: `${sug} More.`, placeholder: '' });
  assert.deepEqual(noteCardView({ suggestion: sug, current: '' }), { label: NOTE_LABEL_OWN, text: '', placeholder: NOTE_CARD_PLACEHOLDER }, 'cleared');
  assert.deepEqual(noteCardView({ suggestion: '', current: '' }), { label: NOTE_LABEL_OWN, text: '', placeholder: NOTE_CARD_PLACEHOLDER }, 'no suggestion, nothing typed');
  assert.deepEqual(noteCardView({ suggestion: '', current: 'Mine.' }), { label: NOTE_LABEL_OWN, text: 'Mine.', placeholder: '' });
  assert.deepEqual(noteCardView({ suggestion: '   ', current: '   ' }).placeholder, NOTE_CARD_PLACEHOLDER, 'whitespace is not a note');
  assert.deepEqual(noteCardView({}), { label: NOTE_LABEL_OWN, text: '', placeholder: NOTE_CARD_PLACEHOLDER });
  assert.equal(NOTE_LABEL_SUGGESTED, 'Suggested note');
});

test('the note becomes paragraphs of text nodes, broken where the published markdown breaks it, never markup, at the cap', () => {
  const doc = fakeDoc();
  const nodes = noteToNodes('First line\r\nsecond line\n\n\n<b>bold</b> stays text', doc);
  assert.deepEqual(nodes.map((p) => p.tag), ['p', 'p']);
  // A single newline is a CommonMark soft break: the published card joins the lines with a space, so the preview does.
  assert.ok(nodes[0].children.every((c) => c.tag === '#text'), 'no <br> for a soft break');
  assert.equal(textOf(nodes[0]), 'First line second line');
  assert.equal(textOf(nodes[1]), '<b>bold</b> stays text');
  assert.ok(nodes.every((p) => p.children.every((c) => c.tag === '#text' || c.tag === 'br')), 'only text and line breaks');
  // A hard break is two or more spaces, or a backslash, before the newline; the marker itself does not show.
  for (const src of ['Kind regards,  \nHudson', 'Kind regards,\\\nHudson', 'Kind regards,   \nHudson']) {
    const [p] = noteToNodes(src, doc);
    assert.deepEqual(p.children.map((c) => c.tag), ['#text', 'br', '#text'], JSON.stringify(src));
    assert.equal(textOf(p), 'Kind regards,\nHudson', JSON.stringify(src));
  }
  assert.equal(textOf(noteToNodes('Kind regards, \nHudson', doc)[0]), 'Kind regards,  Hudson', 'one trailing space is not a break');
  // A line of spaces is a blank line: a new paragraph, as in markdown.
  assert.deepEqual(noteToNodes('One.\n   \nTwo.', doc).map(textOf), ['One.', 'Two.']);
  // A trailing marker on a paragraph's last line breaks nothing and stays as written.
  assert.equal(textOf(noteToNodes('End\\\n\nNext', doc)[0]), 'End\\');
  assert.deepEqual(noteToNodes('', doc), []);
  assert.deepEqual(noteToNodes(null, doc), []);
  // The cap is the claim note's (and so the suggestion's): a full suggestion is shown whole.
  assert.equal(NOTE_MAX, MAX_SUGGESTED_NOTE);
  const long = 'a'.repeat(NOTE_MAX + 50);
  assert.equal(textOf(noteToNodes(long, doc)[0]).length, NOTE_MAX);
  const full = 'b'.repeat(NOTE_MAX);
  assert.equal(textOf(noteToNodes(full, doc)[0]), full, 'a note at the cap is never cut');
});

test('the new words follow the writing rules: no dashes, no contractions, "free year" never "trial"', () => {
  const words = [
    NOTE_LABEL_SUGGESTED, NOTE_LABEL_OWN, NOTE_CARD_PLACEHOLDER, bylineName(''),
    lockedHint({ visibility: 'members' }), lockedHint({ visibility: 'members', encrypted: true }),
  ].join('\n');
  assert.ok(words.length > 120, 'the copy was read');
  assert.doesNotMatch(words, /[\u2014\u2013]| - /);
  assert.doesNotMatch(words, /\btrial\b/i);
  assert.doesNotMatch(words, /\b\w+n't\b|\b\w+'(?:re|ve|ll|d|m)\b|\b(?:it|that|there|what|here|he|she|who|let)'s\b/i);
  assert.doesNotMatch(words, /[\u2018\u2019]/);
});
