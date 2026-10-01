// sow-427: the files a claim commits (membership/prepared-claim-files.mjs) and the owner notice it sends
// (membership/prepared-notify.mjs). The claim publishes the STORED record plus the claimant's note, in one pull
// request, under the claimant's members-index folder; these tests pin what lands in it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import {
  buildClaimFiles, sanitizeClaimNote, categoryPathProblem, listingHouseProblems, preparedSizeProblem, MAX_CLAIM_NOTE,
} from '../membership/prepared-claim-files.mjs';
import { validatePreparedDraft, newListing } from '../membership/prepared-listings.mjs';
import { listingClaimedRecord, listingClaimedNotice } from '../membership/prepared-notify.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';
import { validateHostedRequest, HOSTED_MAX_IMAGE_BYTES } from '../membership/hosted-author.mjs';

const NOW = new Date('2026-10-02T10:00:00.000Z');
const b64 = (n) => Buffer.alloc(n, 1).toString('base64');
const IMAGES = { 'icon.png': b64(10), 'cover.webp': b64(10), 'shot-1.png': b64(10) };
const TAXONOMY = { tree: { devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks', children: { wordpress: { label: 'WordPress' } } } } }, ai: { label: 'AI' } } };
const LICENSES = { licenses: { MIT: { url: 'https://opensource.org/license/mit' }, Custom: {} } };

const listing = (fmOver = {}, body = 'It watches the web.\n\n![The dashboard](./images/shot-1.png)') => {
  const r = validatePreparedDraft({
    type: 'project', slug: 'surfacedby', body,
    frontmatter: { title: 'SurfacedBy', shortDescription: 'x', icon: './images/icon.png', featuredImage: './images/cover.webp', categories: ['devops'], ...fmOver },
  });
  assert.ok(r.ok, JSON.stringify(r.issues));
  return newListing({ id: 'ABCDEFGHJKMNPQRS', draft: r.draft, recipientName: 'Sam', message: 'Hi', campaign: 'CODEABLEYEAR', code: 'CDEABEYEAR23456789AB', preparedBy: '2002207', now: NOW });
};
const build = (over = {}) => buildClaimFiles({ listing: listing(), folder: 'hudson', note: 'I built this to find mentions.', profile: null, images: IMAGES, now: NOW, ...over });

test('one pull request: the project, the note and the images, all under the member folder', () => {
  const r = build();
  assert.ok(r.ok, r.message);
  assert.equal(r.itemId, 'project-surfacedby');
  assert.equal(r.title, 'SurfacedBy');
  assert.deepEqual(r.files.map((f) => f.path), [
    'members/hudson/projects/surfacedby/index.md',
    'members/hudson/comments/intro-surfacedby.md',
    'members/hudson/projects/surfacedby/images/icon.png',
    'members/hudson/projects/surfacedby/images/cover.webp',
    'members/hudson/projects/surfacedby/images/shot-1.png',
  ]);
  assert.equal(r.projectPath, 'members/hudson/projects/surfacedby/index.md');
  assert.equal(r.profilePath, null, 'no profile unless the member has none');
  // And the Worker's own wall accepts exactly this set for this folder.
  assert.ok(validateHostedRequest({ files: r.files, itemId: r.itemId, folder: 'hudson', allowAnyFolder: false }).ok);
});

test('the project is published, public, dated at the claim, and authored by the FOLDER', () => {
  const { frontmatter } = parseContentFile(build().files[0].content);
  assert.equal(frontmatter.author, 'hudson', 'author === folder, never the login');
  assert.equal(frontmatter.status, 'published');
  assert.equal(frontmatter.visibility, 'public');
  assert.equal(frontmatter.publishedAt, NOW.toISOString());
  assert.equal(frontmatter.slug, 'surfacedby');
  assert.equal(frontmatter.title, 'SurfacedBy');
});

test('the note is the claimant\'s author note: authorNote, public, targeting the project', () => {
  const { frontmatter, body } = parseContentFile(build().files[1].content);
  assert.equal(frontmatter.authorNote, true);
  assert.equal(frontmatter.visibility, 'public', 'a members comment would need an encrypted body');
  assert.equal(frontmatter.status, 'published');
  assert.equal(frontmatter.targetType, 'project');
  assert.equal(frontmatter.targetSlug, 'surfacedby');
  assert.equal(frontmatter.id, 'intro-surfacedby');
  assert.equal(frontmatter.author, 'hudson');
  assert.equal(body.trim(), 'I built this to find mentions.');
});

test('a basic profile only when asked: the name and the folder, and NO avatar address', () => {
  const r = build({ profile: { displayName: 'Hudson Atwell' } });
  assert.equal(r.profilePath, 'members/hudson/profile.md');
  const prof = r.files.find((f) => f.path === r.profilePath);
  const { frontmatter } = parseContentFile(prof.content);
  assert.equal(frontmatter.username, 'hudson');
  assert.equal(frontmatter.displayName, 'Hudson Atwell');
  assert.equal('avatar' in frontmatter, false, 'the site draws it by account number at /avatar/<folder> (sow-428)');
  assert.doesNotMatch(prof.content, /github\.com\//, 'never a login-derived picture');
  assert.equal(parseContentFile(build({ profile: { displayName: '' } }).files[2].content).frontmatter.displayName, 'hudson', 'no name falls back to the folder');
});

test('nothing from the claimant but the note: the files equal a build of the stored record', () => {
  const rec = listing();
  const a = buildClaimFiles({ listing: rec, folder: 'hudson', note: 'mine', images: IMAGES, now: NOW });
  const b = buildClaimFiles({ listing: JSON.parse(JSON.stringify(rec)), folder: 'hudson', note: 'mine', images: { ...IMAGES, 'extra.png': b64(5) }, now: NOW });
  assert.deepEqual(a.files, b.files, 'an extra image offered alongside is never committed');
});

test('the stored record is validated again at the claim, so a record edited by hand cannot skip the checks', () => {
  const rec = listing();
  rec.frontmatter = { ...rec.frontmatter, links: [{ type: 'homepage', url: 'javascript:alert(1)' }] };
  const r = buildClaimFiles({ listing: rec, folder: 'hudson', note: 'x', images: IMAGES, now: NOW });
  assert.equal(r.ok, false);
  assert.equal(r.error, 'invalid');
});

test('refusals: a missing folder, an empty note, a missing image', () => {
  assert.equal(build({ folder: null }).error, 'bad_folder');
  assert.equal(build({ folder: 'Hudson' }).error, 'bad_folder', 'a folder is lowercase, as the members index writes it');
  assert.equal(build({ note: '  \n ' }).error, 'note_required');
  const noShot = build({ images: { 'icon.png': b64(10), 'cover.webp': b64(10) } });
  assert.equal(noShot.error, 'image_missing');
  assert.match(noShot.message, /shot-1\.png/);
});

test('sanitizeClaimNote keeps paragraphs and drops controls', () => {
  assert.equal(sanitizeClaimNote(' one\r\n\r\n\r\ntwo\x00 '), 'one\n\ntwo');
  assert.equal(sanitizeClaimNote('x'.repeat(MAX_CLAIM_NOTE + 10)).length, MAX_CLAIM_NOTE);
  assert.equal(sanitizeClaimNote(null), '');
});

// ---- the house lists -------------------------------------------------------------------------------------------

test('categoryPathProblem agrees with the category tree, node by node', () => {
  assert.equal(categoryPathProblem(undefined, TAXONOMY), null);
  assert.equal(categoryPathProblem([], TAXONOMY), null, 'uncategorized is allowed');
  assert.equal(categoryPathProblem(['devops'], TAXONOMY), null);
  assert.equal(categoryPathProblem(['devops', 'frameworks', 'wordpress'], TAXONOMY), null);
  assert.match(categoryPathProblem(['devops', 'wordpress'], TAXONOMY), /not in the category tree/, 'a skipped level is not a path');
  assert.match(categoryPathProblem(['nope'], TAXONOMY), /not in the category tree/);
  assert.match(categoryPathProblem('devops', TAXONOMY), /must be a list/);
  assert.match(categoryPathProblem(['devops'], null), /could not be read/, 'an unreadable tree refuses, never admits');
  assert.match(categoryPathProblem(['devops'], {}), /could not be read/, 'a missing file (read as {}) refuses too');
});

test('categoryPathProblem accepts the real tree\'s own paths', () => {
  const real = yaml.load(fs.readFileSync(new URL('../house/taxonomy.yml', import.meta.url), 'utf8'));
  const [top] = Object.keys(real.tree);
  assert.equal(categoryPathProblem([top], real), null);
  const kids = Object.keys(real.tree[top].children || {});
  if (kids.length) assert.equal(categoryPathProblem([top, kids[0]], real), null);
  assert.ok(categoryPathProblem([top, 'surely-not-a-real-category'], real));
});

test('listingHouseProblems checks the licence against the list, and refuses when the list cannot be read', () => {
  assert.deepEqual(listingHouseProblems({ categories: ['devops'], license: 'MIT' }, { taxonomy: TAXONOMY, licenses: LICENSES }), []);
  assert.equal(listingHouseProblems({ license: 'WTFPL' }, { taxonomy: TAXONOMY, licenses: LICENSES }).length, 1);
  assert.equal(listingHouseProblems({ license: 'Custom' }, { taxonomy: TAXONOMY, licenses: LICENSES }).length, 1, 'Custom needs its link');
  assert.match(listingHouseProblems({ license: 'MIT' }, { taxonomy: TAXONOMY, licenses: null })[0], /could not be read/);
  assert.deepEqual(listingHouseProblems({}, { taxonomy: null, licenses: null }), [], 'nothing to check needs no list');
  assert.equal(listingHouseProblems({ categories: ['nope'], license: 'WTFPL' }, { taxonomy: TAXONOMY, licenses: LICENSES }).length, 2);
});

// ---- the size dry run (amendment 9) ----------------------------------------------------------------------------

test('preparedSizeProblem passes a listing a claim could publish', () => {
  assert.equal(preparedSizeProblem({ listing: listing(), images: IMAGES }), null);
});

test('preparedSizeProblem refuses what every claim would then fail on, using the hosted limits', () => {
  const bigBody = listing({}, `${'word '.repeat(21_000)}\n\n![x](./images/shot-1.png)`); // over 100 KB of text
  const r = preparedSizeProblem({ listing: bigBody, images: IMAGES });
  assert.equal(r.status, 413);
  assert.equal(r.error, 'too_large');
  const big = b64(HOSTED_MAX_IMAGE_BYTES + 1);
  assert.equal(preparedSizeProblem({ listing: listing(), images: { ...IMAGES, 'shot-1.png': big } }).error, 'too_large', 'one image over 1 MiB');
  const nearCap = b64(HOSTED_MAX_IMAGE_BYTES - 10);
  const five = listing({ gallery: ['./images/g1.png', './images/g2.png'] });
  const r5 = preparedSizeProblem({ listing: five, images: { 'icon.png': nearCap, 'cover.webp': nearCap, 'shot-1.png': nearCap, 'g1.png': nearCap, 'g2.png': nearCap } });
  assert.equal(r5.error, 'too_large', 'five images near 1 MiB each pass one by one and fail the 4 MiB total');
  assert.equal(preparedSizeProblem({ listing: listing(), images: {} }).error, 'image_missing');
});

// ---- the owner notice (A4) -------------------------------------------------------------------------------------

const claimed = () => ({
  ...listing(), title: 'SurfacedBy', recipientName: 'Sam', preparedByLogin: 'atwellpub', claimedLogin: 'Sam-Dev', claimedFolder: 'sam-dev',
  claimedAt: NOW.toISOString(), prNumber: 12, boundGithubId: '4242', message: 'a private hello',
});

test('the notice names the preparer, the recipient, the claimant, the project page and the pull request', () => {
  const rec = listingClaimedRecord(claimed(), { siteBase: 'https://gbti.network/', upstream: 'gbti-network/gbti.network' });
  assert.equal(rec.projectUrl, 'https://gbti.network/projects/surfacedby/');
  assert.equal(rec.prUrl, 'https://github.com/gbti-network/gbti.network/pull/12');
  const n = listingClaimedNotice(rec);
  assert.match(n.subject, /SurfacedBy/);
  assert.match(n.subject, /Sam-Dev/);
  for (const part of [n.text, n.html]) {
    for (const fact of ['atwellpub', 'Sam', 'Sam-Dev', 'sam-dev', 'https://gbti.network/projects/surfacedby/', '#12']) assert.ok(part.includes(fact), fact);
  }
});

test('the notice never carries the invitation code or the personal message', () => {
  const n = listingClaimedNotice(listingClaimedRecord(claimed()));
  for (const part of [n.subject, n.text, n.html]) {
    assert.ok(!part.includes('CDEABEYEAR23456789AB'), 'the code is a bearer credential');
    assert.ok(!part.includes('a private hello'), 'the message was deleted with the listing');
    assert.ok(!part.includes('4242'), 'no account number');
  }
});

test('the notice survives a minimized record and missing facts without printing undefined', () => {
  const n = listingClaimedNotice(listingClaimedRecord({ slug: null, prNumber: null }));
  assert.ok(!/undefined|null/.test(n.text), n.text);
  assert.match(n.subject, /untitled project/);
});

test('this test file stays at or under 900 lines', () => {
  assert.ok(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').length <= 900);
});
