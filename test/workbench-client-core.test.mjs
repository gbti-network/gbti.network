// sow-158 Phase 3b: the pure core of the website WorkBench adapter (src/lib/workbench-client-core.mjs). No network,
// no TS: the .ts adapter is the cookie transport; this proves the members-only file planning, the discussion
// filter/tier-gate, the comment-visibility coercion, and the favorite derivation. Uses a FAKE encrypt (no Worker).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMemberFiles, planPublishImage, planPublishImageFiles, reassembleMemberBody, filterThreadComments, coerceCommentInput, favoritedFrom, COMMENT_TARGET_TYPES, MEMBER_READ_TIER, sanitizeImageName, referencedImages, normalizeImageFields, normalizeImageValue, IMAGE_FIELD_KEYS, base64Bytes, renameOriginOf, mergedRedirectFrom, renameIntroMoveFiles, isNetworkPath, networkContent } from '../src/lib/workbench-client-core.mjs';
import { buildCommentFile, buildContentFile, buildShareFile, shareId, commentId, parseContentFile, serializeContentFile } from '../client/src/content-ops.mjs';

const fakeEncrypt = async (plaintext, assetId) => ({ v: 1, kid: '1', iv: 'IV', aad: assetId, ct: 'CT(' + plaintext + ')' });
// A fake decrypt that inverts fakeEncrypt (extracts the plaintext from the ct wrapper), for the round-trip test.
const fakeDecryptCt = (ct) => String(ct).replace(/^CT\(/, '').replace(/\)$/, '');

// The website WorkBench duplicates client/src/operations.mjs planMemberFiles, so the teaser rule has to hold in
// BOTH or publishing the same item from the website silently wipes the public part the extension kept.
test('planMemberFiles: a MEMBERS item with a marker keeps the teaser public and encrypts only the tail', async () => {
  const body = 'Public teaser TEASER_W.\n\n<!-- members-only -->\n\nGATED_PAYLOAD_W';
  const built = buildContentFile({ type: 'prompt', username: 'gwen', input: { slug: 'mode-b-teaser', title: 'T', shortDescription: 'x', visibility: 'members', publicStub: true, status: 'published' }, body });
  const plan = await planMemberFiles({ built, body, encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2);
  const md = plan.files.find((f) => f.path.endsWith('.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  assert.match(md.content, /TEASER_W/, 'the public teaser must survive into the committed .md');
  assert.doesNotMatch(md.content, /GATED_PAYLOAD_W/, 'the gated payload must NOT be in the committed .md');
  assert.doesNotMatch(md.content, /<!-- members-only -->/, 'the marker itself must never reach the committed .md');
  assert.match(enc.content, /CT\(GATED_PAYLOAD_W\)/);
});

test('planMemberFiles: a members comment encrypts to a .enc + a stub .md carrying the pointer', async () => {
  const id = commentId('2026-01-02T03:04:05Z', 'abc123');
  const built = buildCommentFile({ username: 'gwen', input: { id, targetType: 'post', targetSlug: 'hello', createdAt: '2026-01-02T03:04:05Z', status: 'published', visibility: 'members' }, body: 'a members-only reply' });
  const plan = await planMemberFiles({ built, body: 'a members-only reply', encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2);
  const md = plan.files.find((f) => f.path.endsWith('.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  assert.equal(md.path, `members/gwen/comments/${id}.md`);
  assert.equal(enc.path, `members/gwen/_enc/comment-${id}-body.enc`);
  assert.match(md.content, /encryptedBody:/);
  assert.doesNotMatch(md.content, /a members-only reply/, 'the plaintext members body must NOT appear in the committed .md');
  assert.match(enc.content, /CT\(a members-only reply\)/, 'the ciphertext envelope carries the encrypted body');
  assert.equal(plan.encPath, enc.path);
});

// sow-158 Part 3: the account-page Share composer defaults to members-only. postShare() planning must encrypt the
// whole body to a .enc and leave the stub .md plaintext-free (the same invariant the Worker feed relies on).
test('planMemberFiles: a members Share (composer default) encrypts to .enc + a plaintext-free stub .md', async () => {
  const id = shareId('2026-03-01T00:00:00Z', 'astro is great');
  const built = buildShareFile({ username: 'gwen', input: { id, createdAt: '2026-03-01T00:00:00Z', title: 'Astro is great', visibility: 'members' }, body: 'my secret members-only take' });
  const plan = await planMemberFiles({ built, body: 'my secret members-only take', encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2);
  const md = plan.files.find((f) => f.path.endsWith('.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  assert.equal(md.path, `members/gwen/shares/${id}.md`);
  assert.match(md.content, /encryptedBody:/);
  assert.doesNotMatch(md.content, /my secret members-only take/, 'the members share plaintext must NOT reach the committed .md');
  assert.match(enc.content, /CT\(my secret members-only take\)/);
});

test('planMemberFiles: a PUBLIC Share returns null -> the caller commits a single plaintext .md', async () => {
  const id = shareId('2026-03-01T00:00:00Z', 'public note');
  const built = buildShareFile({ username: 'gwen', input: { id, createdAt: '2026-03-01T00:00:00Z', title: 'Public note', visibility: 'public' }, body: 'a public link share' });
  assert.equal(await planMemberFiles({ built, body: 'a public link share', encrypt: fakeEncrypt }), null);
});

test('planMemberFiles: a public intro (no marker) returns null -> the caller commits the plaintext .md', async () => {
  const id = commentId('2026-01-02T03:04:05Z', 'pub1');
  const built = buildCommentFile({ username: 'gwen', input: { id, targetType: 'product', targetSlug: 'radle', createdAt: '2026-01-02T03:04:05Z', status: 'published', visibility: 'public', authorNote: true }, body: 'why I built this' });
  assert.equal(await planMemberFiles({ built, body: 'why I built this', encrypt: fakeEncrypt }), null);
});

test('reassembleMemberBody (Mode A/B): visibility members -> the decrypted memberText is the whole body', () => {
  assert.equal(reassembleMemberBody({ visibility: 'members' }, '', 'the whole gated body'), 'the whole gated body');
  // a Mode B stub may carry a public teaser in index.md, but the whole authoring body is still the members text
  assert.equal(reassembleMemberBody({ visibility: 'members' }, 'ignored teaser', 'gated'), 'gated');
});

test('reassembleMemberBody (Mode C): visibility public -> public part + marker + members part', () => {
  assert.equal(reassembleMemberBody({ visibility: 'public' }, 'the public teaser', 'the gated tail'),
    'the public teaser\n\n<!-- members-only -->\n\nthe gated tail');
  // no public part -> the marker leads
  assert.equal(reassembleMemberBody({ visibility: 'public' }, '', 'gated only'), '<!-- members-only -->\n\ngated only');
});

test('ROUND-TRIP: a Mode C body splits (planMemberFiles) and reassembles to the original', async () => {
  const original = 'A public intro paragraph.\n\n<!-- members-only -->\n\nThe members-only continuation.';
  const built = buildContentFile({ type: 'post', username: 'gwen', input: { slug: 'hello', title: 'Hello', visibility: 'public', status: 'published' }, body: original });
  const plan = await planMemberFiles({ built, body: original, encrypt: fakeEncrypt });
  assert.equal(plan.files.length, 2, 'a Mode C item commits index.md + .enc');
  const idx = plan.files.find((f) => f.path.endsWith('index.md'));
  const enc = plan.files.find((f) => f.path.endsWith('.enc'));
  const publicPart = parseContentFile(idx.content).body; // what the committed index.md carries
  assert.doesNotMatch(idx.content, /members-only/, 'the marker + gated tail never reach the committed index.md');
  assert.doesNotMatch(idx.content, /members-only continuation/);
  const memberText = fakeDecryptCt(JSON.parse(enc.content).ct); // what the Worker would return on decrypt
  const rebuilt = reassembleMemberBody(parseContentFile(idx.content).frontmatter, publicPart, memberText);
  assert.equal(rebuilt, original, 'getContentItem reassembly reproduces the exact authoring body');
});

test('coerceCommentInput: a discussion reply is coerced to members; only an author-note intro stays public', () => {
  // a plain reply, even if the client asks for public -> members
  assert.equal(coerceCommentInput({ id: 'c1', targetType: 'post', targetSlug: 's', visibility: 'public' }).visibility, 'members');
  // an author-note intro on a post/product/prompt -> public
  assert.equal(coerceCommentInput({ id: 'c2', targetType: 'product', targetSlug: 's', authorNote: true, visibility: 'public' }).visibility, 'public');
  assert.equal(coerceCommentInput({ id: 'c2', targetType: 'product', targetSlug: 's', authorNote: true, visibility: 'public' }).authorNote, true);
  // an author-note on a SHARE is never public (SOW-044) -> members
  assert.equal(coerceCommentInput({ id: 'c3', targetType: 'share', targetSlug: 's', authorNote: true, visibility: 'public' }).visibility, 'members');
  // a reply carries its parentId + createdAt through
  const withParent = coerceCommentInput({ id: 'c4', targetType: 'post', targetSlug: 's', createdAt: 'T', parentId: 'p1' });
  assert.equal(withParent.parentId, 'p1');
  assert.equal(withParent.createdAt, 'T');
  assert.equal(withParent.status, 'published');
});

const thread = [
  { id: 'b', targetType: 'post', targetSlug: 'hello', status: 'published', visibility: 'public', body: 'second', createdAt: '2026-01-02T00:00:02Z' },
  { id: 'a', targetType: 'post', targetSlug: 'hello', status: 'published', visibility: 'members', body: '', createdAt: '2026-01-02T00:00:01Z' },
  { id: 'c', targetType: 'post', targetSlug: 'other', status: 'published', visibility: 'public', body: 'nope', createdAt: '2026-01-02T00:00:03Z' },
  { id: 'd', targetType: 'product', targetSlug: 'hello', status: 'published', visibility: 'public', body: 'wrongtype', createdAt: '2026-01-02T00:00:04Z' },
  { id: 'e', targetType: 'post', targetSlug: 'renamed-old', status: 'published', visibility: 'public', body: 'alias', createdAt: '2026-01-02T00:00:05Z' },
  { id: 'f', targetType: 'post', targetSlug: 'hello', status: 'draft', visibility: 'public', body: 'draft', createdAt: '2026-01-02T00:00:06Z' },
];

test('filterThreadComments: matches target + aliases, drops other targets/types/drafts, sorts oldest-first', () => {
  const items = filterThreadComments(thread, { targetType: 'post', targetSlug: 'hello', aliases: ['renamed-old'] });
  assert.deepEqual(items.map((c) => c.id), ['a', 'b', 'e'], 'oldest-first, only post:hello + the alias, no draft/other-target/other-type');
});

test('filterThreadComments: a non-member viewer sees ONLY public rows (member stubs are tier-gated)', () => {
  const items = filterThreadComments(thread, { targetType: 'post', targetSlug: 'hello', canSeeMembers: false });
  assert.deepEqual(items.map((c) => c.id), ['b'], 'the members row (a) is dropped for a non-member');
});

test('filterThreadComments: an invalid target or missing slug returns empty', () => {
  assert.deepEqual(filterThreadComments(thread, { targetType: 'nope', targetSlug: 'x' }), []);
  assert.deepEqual(filterThreadComments(thread, { targetType: 'post', targetSlug: '' }), []);
});

test('favoritedFrom: derives favorited from the activity favorites list', () => {
  const activity = { favorites: [{ type: 'post', slug: 'x' }, { type: 'product', slug: 'y' }] };
  assert.equal(favoritedFrom(activity, 'post', 'x'), true);
  assert.equal(favoritedFrom(activity, 'post', 'z'), false);
  assert.equal(favoritedFrom(null, 'post', 'x'), false);
});

// sow-158 image upload: the client sanitize/flush core mirrors the Worker gate.
test('sanitizeImageName: cleans to an own-folder leaf, rejects svg + traversal + non-images', () => {
  assert.equal(sanitizeImageName('My Cover.PNG'), 'my-cover.png');
  assert.equal(sanitizeImageName('a/b/../evil.jpg'), 'evil.jpg', 'path segments are dropped to the leaf');
  assert.equal(sanitizeImageName('photo.jpeg'), 'photo.jpeg');
  assert.equal(sanitizeImageName('x.webp'), 'x.webp');
  assert.equal(sanitizeImageName('logo.svg'), null, 'svg is refused on the web');
  assert.equal(sanitizeImageName('note.txt'), null, 'a non-image is refused');
  assert.equal(sanitizeImageName('.hidden.png'), 'hidden.png', 'a leading dot is stripped');
  assert.equal(sanitizeImageName(''), null);
});

// Astro resolves an image() field RELATIVE to the markdown file that declares it, so `./images/<file>` beside
// index.md is the only shape that works, and it is the shape all 78 committed values use. The website stager
// wrote a repo-rooted `members/<login>/images/<file>` instead, which image() cannot resolve at all: publishing
// one reddened the site build, and every render surface joined it onto the item folder and 404ed.
test('normalizeImageValue: rewrites what the stager used to write, and leaves alone what it must', () => {
  const n = (v) => normalizeImageValue(v, 'gwen');
  assert.equal(n('members/gwen/images/cover.png'), './images/cover.png', 'the flat own-folder path is the defect');
  assert.equal(n('images/cover.png'), './images/cover.png');
  assert.equal(n('cover.png'), './images/cover.png');
  assert.equal(n('members/gwen/images/Cover 1.PNG'), './images/cover-1.png', 'sanitized on the way through');
  assert.equal(n('./images/cover.png'), './images/cover.png', 'already canonical, untouched');
  // Left alone: a resolved URL, a build-optimized asset, another member's folder, a non-image, and empties.
  for (const keep of ['https://cdn/x.png', '//cdn/x.png', '/_astro/x.hash.webp', '/img/x.png',
    'members/other/images/x.png', 'members/gwen/images/notes.txt', '', null, undefined]) {
    assert.equal(n(keep), keep, `${JSON.stringify(keep)} must pass through unchanged`);
  }
});

test('normalizeImageFields: covers every image() field, including the gallery list, without mutating input', () => {
  const fm = {
    coverImage: 'members/gwen/images/cover.png',
    icon: 'members/gwen/images/icon.gif',
    iconLarge: 'members/gwen/images/icon-2x.png',
    banner: 'https://cdn/x.png',
    gallery: ['members/gwen/images/a.webp', { src: 'members/gwen/images/b.webp', caption: 'two' }, { caption: 'no src' }],
    title: 'x', coverAlt: 'alt text',
  };
  const out = normalizeImageFields(fm, 'gwen');
  assert.equal(out.coverImage, './images/cover.png');
  assert.equal(out.icon, './images/icon.gif');
  assert.equal(out.iconLarge, './images/icon-2x.png', 'iconLarge is an image() field and was being missed');
  assert.equal(out.banner, 'https://cdn/x.png');
  assert.deepEqual(out.gallery, ['./images/a.webp', { src: './images/b.webp', caption: 'two' }, { caption: 'no src' }]);
  assert.equal(out.coverAlt, 'alt text', 'a text field is not a path');
  assert.equal(fm.coverImage, 'members/gwen/images/cover.png', 'the input object is not mutated');
});

test('referencedImages: names every canonical image the content uses, deduped, and nothing else', () => {
  const fm = {
    coverImage: './images/cover.png', icon: './images/icon.gif', iconLarge: './images/icon-2x.png',
    gallery: ['./images/shot.webp', { src: './images/cover.png' }],
    banner: 'https://cdn/x.png', title: 'x', coverAlt: 'alt text',
  };
  assert.deepEqual(referencedImages(fm).map((r) => r.name),
    ['cover.png', 'icon.gif', 'icon-2x.png', 'shot.webp'], 'the repeat of cover.png is one image, not two');
  assert.equal(referencedImages(fm).find((r) => r.name === 'icon-2x.png').field, 'iconLarge');
  // A remote or unresolvable value is not ours to flush into the PR.
  assert.deepEqual(referencedImages({ banner: 'https://cdn/x.png', icon: 'members/gwen/images/x.png' }), []);
  assert.deepEqual(referencedImages(), []);
  assert.deepEqual(referencedImages({}), []);
});

test('every image() field in the content schemas is covered by the flush list', () => {
  // The bug this pins: iconLarge and gallery were missing, so an image staged into either was never flushed
  // into the publish PR and the .md committed a reference to a file the PR did not carry.
  for (const k of ['coverImage', 'image', 'banner', 'featuredImage', 'icon', 'iconLarge']) {
    assert.ok(IMAGE_FIELD_KEYS.includes(k), `${k} is an image() field in src/content.config.ts and must be flushed`);
  }
  const gal = referencedImages({ gallery: [{ src: './images/g.png' }] });
  assert.deepEqual(gal.map((r) => r.name), ['g.png'], 'gallery is an image() field too');
});

test('base64Bytes: padding-aware decoded length', () => {
  assert.equal(base64Bytes(Buffer.from('hello').toString('base64')), 5);
  assert.equal(base64Bytes(Buffer.from('ab').toString('base64')), 2);
  assert.equal(base64Bytes(''), 0);
});

test('the shared tier + target sets are as expected', () => {
  assert.ok(COMMENT_TARGET_TYPES.has('share') && COMMENT_TARGET_TYPES.has('post'));
  assert.ok(COMMENT_TARGET_TYPES.has('news'), 'sow-158 News: the website discussion supports news threads');
  assert.ok(MEMBER_READ_TIER.has('paid') && MEMBER_READ_TIER.has('trialing') && !MEMBER_READ_TIER.has('none'));
});

// ---- sow-158 permalink rename (rename-at-publish) pure helpers ----

test('renameOriginOf: resolves an own item of the same type, else null', () => {
  assert.deepEqual(
    renameOriginOf({ path: 'members/gwen/posts/old-slug/index.md', username: 'gwen', type: 'post' }),
    { scope: 'member', username: 'gwen', oldSlug: 'old-slug', oldPath: 'members/gwen/posts/old-slug/index.md' },
  );
  // Case-insensitive username match (the folder is lowercase).
  assert.ok(renameOriginOf({ path: 'members/gwen/products/x/index.md', username: 'Gwen', type: 'product' }));
  // Another member's path -> null (you may only rename your own) UNLESS allowAnyFolder (sow-183).
  assert.equal(renameOriginOf({ path: 'members/alice/posts/x/index.md', username: 'gwen', type: 'post' }), null);
  // Wrong type (a product path while publishing a post) -> null.
  assert.equal(renameOriginOf({ path: 'members/gwen/products/x/index.md', username: 'gwen', type: 'post' }), null);
  // A non-item path (a comment, or house) -> null.
  assert.equal(renameOriginOf({ path: 'members/gwen/comments/intro-x.md', username: 'gwen', type: 'post' }), null);
  assert.equal(renameOriginOf({ path: 'house/posts/x/index.md', username: 'gwen', type: 'post' }), null);
  assert.equal(renameOriginOf({ path: undefined, username: 'gwen', type: 'post' }), null);
});

// sow-183: allowAnyFolder resolves house/ and another member's folder (a superadmin's authorship reassignment).
// This function does no authorization itself -- it is only reachable in practice via UI already gated to
// role==='superadmin' (gbti-workspace.mjs), and the Worker independently re-verifies (authorizeSuperadmin).
test('renameOriginOf: allowAnyFolder resolves house/ and any member folder; still shape + type checked', () => {
  assert.deepEqual(
    renameOriginOf({ path: 'house/posts/quarterly-update/index.md', type: 'post', allowAnyFolder: true }),
    { scope: 'house', username: null, oldSlug: 'quarterly-update', oldPath: 'house/posts/quarterly-update/index.md' },
  );
  assert.deepEqual(
    renameOriginOf({ path: 'members/rfilipo/products/gizmo/index.md', username: 'atwellpub', type: 'product', allowAnyFolder: true }),
    { scope: 'member', username: 'rfilipo', oldSlug: 'gizmo', oldPath: 'members/rfilipo/products/gizmo/index.md' },
  );
  // Still rejects a mismatched type and a non-item path even with allowAnyFolder.
  assert.equal(renameOriginOf({ path: 'house/products/gizmo/index.md', type: 'post', allowAnyFolder: true }), null);
  assert.equal(renameOriginOf({ path: 'house/roles.yml', type: 'post', allowAnyFolder: true }), null);
});

test('mergedRedirectFrom: a rename appends + dedupes the old URL; a plain re-publish KEEPS the old redirects', () => {
  // Rename: the old public URL is appended to the existing set (deduped).
  assert.deepEqual(
    mergedRedirectFrom({ oldFm: { redirectFrom: ['/articles/older/'] }, inputRedirectFrom: [], renaming: true, type: 'post', oldSlug: 'old' }),
    ['/articles/older/', '/articles/old/'],
  );
  // Already-present old URL is not duplicated.
  assert.deepEqual(
    mergedRedirectFrom({ oldFm: { redirectFrom: ['/articles/old/'] }, inputRedirectFrom: [], renaming: true, type: 'post', oldSlug: 'old' }),
    ['/articles/old/'],
  );
  // Product base.
  assert.deepEqual(
    mergedRedirectFrom({ oldFm: {}, inputRedirectFrom: [], renaming: true, type: 'product', oldSlug: 'gizmo' }),
    ['/products/gizmo/'],
  );
  // REGRESSION: a plain re-publish (no rename) must PRESERVE the item's existing redirectFrom, not drop it.
  assert.deepEqual(
    mergedRedirectFrom({ oldFm: { redirectFrom: ['/articles/prev/'] }, inputRedirectFrom: [], renaming: false, type: 'post', oldSlug: 'cur' }),
    ['/articles/prev/'],
  );
  // No oldFm + no input -> undefined (nothing to write).
  assert.equal(mergedRedirectFrom({ oldFm: null, inputRedirectFrom: [], renaming: false, type: 'post', oldSlug: 'x' }), undefined);
});

test('renameIntroMoveFiles: an intro moves + retargets; no-intro or a note-less type is empty', () => {
  const introText = serializeContentFile({ id: 'intro-old', targetType: 'product', targetSlug: 'old', authorNote: true, visibility: 'public' }, 'From the author.');
  const from = { scope: 'member', username: 'gwen' };
  const files = renameIntroMoveFiles({ from, type: 'product', oldSlug: 'old', newSlug: 'new', introText });
  assert.equal(files.length, 2);
  assert.equal(files[0].path, 'members/gwen/comments/intro-new.md');
  const movedFm = parseContentFile(files[0].content).frontmatter;
  assert.equal(movedFm.id, 'intro-new');
  assert.equal(movedFm.targetSlug, 'new');
  assert.equal(files[1].path, 'members/gwen/comments/intro-old.md');
  assert.equal(files[1].content, null, 'the old intro is deleted');
  // 2026-08-11: a POST now carries its note through a rename too. This previously returned [], which orphaned
  // an article's note at the old slug where nothing would ever read it again.
  const postFiles = renameIntroMoveFiles({ from, type: 'post', oldSlug: 'old', newSlug: 'new', introText });
  assert.equal(postFiles.length, 2, 'an article rename moves its note instead of stranding it');
  assert.equal(postFiles[0].path, 'members/gwen/comments/intro-new.md');
  assert.equal(parseContentFile(postFiles[0].content).frontmatter.targetSlug, 'new');
  assert.equal(postFiles[1].content, null, 'the old intro is deleted');
  // A type that cannot carry a note at all is still empty.
  assert.deepEqual(renameIntroMoveFiles({ from, type: 'share', oldSlug: 'old', newSlug: 'new', introText }), []);
  // No existing intro (introText null) -> nothing to move.
  assert.deepEqual(renameIntroMoveFiles({ from, type: 'product', oldSlug: 'old', newSlug: 'new', introText: null }), []);
});

// sow-183: a `to` different from `from` moves the intro to the NEW owner's folder (house<->member reassignment),
// not just a same-folder rename.
test('renameIntroMoveFiles: a different `to` moves the intro to the new owner (network<->member)', () => {
  const introText = serializeContentFile({ id: 'intro-gizmo', targetType: 'product', targetSlug: 'gizmo', authorNote: true, visibility: 'public' }, 'From the author.');
  const houseToMember = renameIntroMoveFiles({ from: { scope: 'house' }, to: { scope: 'member', username: 'atwellpub' }, type: 'product', oldSlug: 'gizmo', newSlug: 'gizmo', introText });
  assert.equal(houseToMember[0].path, 'members/atwellpub/comments/intro-gizmo.md');
  assert.equal(houseToMember[1].path, 'members/gbtilabs/comments/intro-gizmo.md'); // sow-195: the network folder, not house/
  const memberToHouse = renameIntroMoveFiles({ from: { scope: 'member', username: 'atwellpub' }, to: { scope: 'house' }, type: 'prompt', oldSlug: 'gizmo', newSlug: 'gizmo', introText });
  assert.equal(memberToHouse[0].path, 'members/gbtilabs/comments/intro-gizmo.md');
  assert.equal(memberToHouse[1].path, 'members/atwellpub/comments/intro-gizmo.md');
});

// sow-182: house-content selection for the website WorkBench's House content scope, mirroring memberContent's
// (client-ui/src/member-view-core.mjs) sort/cap shape but selecting by path, since the network's content has no
// individual author to filter by. sow-195: those paths are members/gbtilabs/ now, not house/.
const houseItems = [
  { type: 'post', title: 'H-A', path: 'members/gbtilabs/posts/h-a/index.md', publishedAt: 300 },
  { type: 'post', title: 'H-B', path: 'members/gbtilabs/posts/h-b/index.md', publishedAt: 100 },
  { type: 'post', title: 'H-C-dateless', path: 'members/gbtilabs/posts/h-c/index.md', publishedAt: null },
  { type: 'prompt', title: 'H-D-prompt', path: 'members/gbtilabs/prompts/h-d/index.md', publishedAt: 200 },
  { type: 'post', title: 'M-alice', path: 'members/alice/posts/m-alice/index.md', publishedAt: 999 },
  { type: 'post', title: 'bad-path', path: 'house/roles.yml', publishedAt: 999 }, // governance file, never a content item
];

test('isNetworkPath: matches the network folder only, and no longer the emptied house/ paths', () => {
  assert.equal(isNetworkPath('members/gbtilabs/posts/hello/index.md'), true);
  assert.equal(isNetworkPath('members/gbtilabs/products/thing/index.md'), true);
  assert.equal(isNetworkPath('members/gbtilabs/prompts/thing/index.md'), true);
  // sow-195: house/ holds no content any more. Matching it is what made the website WorkBench show nothing,
  // so the OLD paths must now be false, not merely unused.
  assert.equal(isNetworkPath('house/posts/hello/index.md'), false);
  assert.equal(isNetworkPath('members/alice/posts/hello/index.md'), false);
  assert.equal(isNetworkPath('members/gbtilabs/roles.yml'), false);
  assert.equal(isNetworkPath('members/gbtilabs/posts/../../etc/passwd'), false);
  assert.equal(isNetworkPath(''), false);
  assert.equal(isNetworkPath(null), false);
});

test('networkContent: selects the network items by path, newest-first, dateless last, across content types', () => {
  const out = networkContent(houseItems);
  assert.deepEqual(out.map((i) => i.title), ['H-A', 'H-D-prompt', 'H-B', 'H-C-dateless']);
  // the member item and the bad-path governance-file entry are excluded
  assert.equal(out.some((i) => i.title === 'M-alice' || i.title === 'bad-path'), false);
});

test('networkContent: cap applies after the sort (keeps the newest N)', () => {
  const out = networkContent(houseItems, 2);
  assert.deepEqual(out.map((i) => i.title), ['H-A', 'H-D-prompt']);
});

test('networkContent: a non-array input returns []', () => {
  assert.deepEqual(networkContent(undefined), []);
  assert.deepEqual(networkContent({}), []);
});

// The publish-time image rule. Before this existed, publish read the in-tab Map and SILENTLY dropped anything
// it did not find, opening a PR whose frontmatter named an image the PR did not carry. Astro's image() has to
// resolve, so merging that broke the site build on main.
// The descriptor publish hands it: the file name, the draft it was staged for, and the repo path it would
// commit to. The three sources are keyed differently (the session Map and the store by name/item, main by the
// resolved commit path), which is why each lookup gets the whole descriptor.
const IMG = { name: 'lead.png', item: 'post:hello', commitPath: 'members/gwen/posts/hello/images/lead.png' };
const never = () => { throw new Error('this source must not be consulted'); };

test('planPublishImage: the in-tab bytes are used without touching the store or main', async () => {
  const plan = await planPublishImage(IMG, { fromSession: () => 'SESSION_B64', fromStore: never, onMain: never });
  assert.deepEqual(plan, { action: 'commit', contentBase64: 'SESSION_B64' });
});

test('planPublishImage: the staged store answers after a reload, and OUTRANKS the copy on main', async () => {
  // Re-staging the same file name is a REPLACEMENT of the committed image, so a store hit has to win. If main
  // were checked first, replacing an image would publish the old one back over the new one.
  const plan = await planPublishImage(IMG, {
    fromSession: () => undefined,
    fromStore: async () => 'STORE_B64',
    onMain: async () => true,
  });
  assert.deepEqual(plan, { action: 'commit', contentBase64: 'STORE_B64' });
});

test('planPublishImage: an image already committed on main is a SKIP, not a failure', async () => {
  // The steady state for every re-publish of an item whose image has not changed: the bytes are gone from both
  // caches because publish deleted them, and the file is on main. Refusing here would block editing any item
  // that carries a lead image.
  const plan = await planPublishImage(IMG, { fromSession: () => undefined, fromStore: async () => null, onMain: async () => true });
  assert.deepEqual(plan, { action: 'skip' });
});

// ---- sow-183: a MOVE has to carry the images with it (owner report 2026-08-27) ----
//
// Images are co-located, so an item's folder IS its images' folder: reassigning the author or changing the
// slug moves them. Every lookup above points at the DESTINATION, where nothing is yet, so on a move the
// session missed, the store missed (publish deletes the staged copy once it merges), and main missed. The
// publish then refused with "no longer staged", and reassigning any item carrying an image was impossible.
// Since co-location is universal here, that was most of them.
const MOVED = {
  name: 'lead.png',
  item: 'prompt:grok',
  commitPath: 'members/atwellpub/prompts/grok/images/lead.png',
  oldPath: 'members/gbtilabs/prompts/grok/images/lead.png',
};

test('planPublishImage: on a move the committed copy in the ORIGIN folder is found and carried over', async () => {
  // THE DISCRIMINATING CASE, and the exact state of every already-published item being reassigned: nothing
  // in the tab, nothing staged, nothing at the destination, and the real bytes sitting in the old folder.
  const plan = await planPublishImage(MOVED, {
    fromSession: () => undefined,
    fromStore: async () => null,
    fromOldFolder: async () => 'OLD_FOLDER_B64',
    onMain: async () => false,
  });
  assert.deepEqual(plan, { action: 'commit', contentBase64: 'OLD_FOLDER_B64' });
});

test('planPublishImage: a re-staged image still OUTRANKS the old folder copy', async () => {
  // The order is the whole point. If the old folder were tried first, replacing an image DURING a
  // reassignment would carry the picture being replaced into the new folder and report success. A test that
  // only proved the old folder is consulted would pass with the order wrong.
  const plan = await planPublishImage(MOVED, {
    fromSession: () => undefined,
    fromStore: async () => 'STORE_B64',
    fromOldFolder: async () => { throw new Error('the old folder must not be consulted ahead of the store'); },
    onMain: never,
  });
  assert.deepEqual(plan, { action: 'commit', contentBase64: 'STORE_B64' });
});

test('planPublishImageFiles: a move emits the new-path commit AND the old-path delete, never one alone', async () => {
  // A half-move is the failure that would ship unnoticed. Committing without deleting leaves an orphaned
  // image in a folder whose index.md is gone: nothing references it, so the build stays green and the repo
  // quietly accumulates the images of every item ever reassigned.
  const r = await planPublishImageFiles(
    { ...MOVED, oldBase64: 'OLD_FOLDER_B64' },
    { fromSession: () => undefined, fromStore: async () => null, onMain: async () => false },
  );
  assert.equal(r.action, 'commit');
  assert.deepEqual(r.files, [
    { path: 'members/atwellpub/prompts/grok/images/lead.png', contentBase64: 'OLD_FOLDER_B64' },
    { path: 'members/gbtilabs/prompts/grok/images/lead.png', content: null },
  ]);
});

test('planPublishImageFiles: a re-staged image on a move still clears the old folder', async () => {
  // The bytes come from the store, so the old copy is not needed for the carry. It still has to GO: the
  // delete is about the origin folder being emptied, not about where the new bytes came from.
  const r = await planPublishImageFiles(
    { ...MOVED, oldBase64: 'OLD_FOLDER_B64' },
    { fromSession: () => undefined, fromStore: async () => 'STORE_B64', onMain: never },
  );
  assert.deepEqual(r.files, [
    { path: 'members/atwellpub/prompts/grok/images/lead.png', contentBase64: 'STORE_B64' },
    { path: 'members/gbtilabs/prompts/grok/images/lead.png', content: null },
  ]);
});

test('planPublishImageFiles: during a move the ORIGIN folder outranks a copy already at the destination', async () => {
  // The old folder is consulted BEFORE main, so a stray file at the destination does not short-circuit the
  // carry. That is the right way round: the move already proved the destination index.md does not exist, so
  // anything sitting in the destination images folder is debris from an aborted attempt, not the item's
  // picture. Committing identical bytes over it is a no-op in the tree; trusting it could publish an unrelated
  // image under this item's name.
  const r = await planPublishImageFiles(
    { ...MOVED, oldBase64: 'OLD_FOLDER_B64' },
    { fromSession: () => undefined, fromStore: async () => null, onMain: async () => true },
  );
  assert.equal(r.action, 'commit');
  assert.deepEqual(r.files, [
    { path: 'members/atwellpub/prompts/grok/images/lead.png', contentBase64: 'OLD_FOLDER_B64' },
    { path: 'members/gbtilabs/prompts/grok/images/lead.png', content: null },
  ]);
});

test('planPublishImageFiles: a move with an EMPTY origin folder falls through to main and skips', async () => {
  // The origin holding nothing is the only way main is reached on a move. It must still skip rather than
  // refuse (the image is where the frontmatter says it is), and it must not emit a delete for a path that
  // holds nothing.
  const r = await planPublishImageFiles(
    { ...MOVED, oldBase64: null },
    { fromSession: () => undefined, fromStore: async () => null, onMain: async () => true },
  );
  assert.equal(r.action, 'skip');
  assert.deepEqual(r.files, []);
});

test('planPublishImageFiles: a PLAIN edit emits the commit and never a delete', async () => {
  // No oldPath means no move. The delete must be reachable only through a move, or an ordinary re-publish
  // would delete the image it just committed.
  const r = await planPublishImageFiles(
    { name: 'lead.png', item: 'post:hello', commitPath: 'members/gwen/posts/hello/images/lead.png' },
    { fromSession: () => 'SESSION_B64', fromStore: never, onMain: never },
  );
  assert.deepEqual(r.files, [{ path: 'members/gwen/posts/hello/images/lead.png', contentBase64: 'SESSION_B64' }]);
});

test('planPublishImageFiles: nothing anywhere still REFUSES, and fabricates no delete', async () => {
  // An absent old copy must not produce a delete entry. Deleting a path that is not there is a file entry
  // for a file that does not exist, which is the PR asking the repo to remove something it never had.
  const r = await planPublishImageFiles(
    { ...MOVED, oldBase64: null },
    { fromSession: () => undefined, fromStore: async () => null, onMain: async () => false },
  );
  assert.equal(r.action, 'refuse');
  assert.deepEqual(r.files, []);
  assert.match(r.message, /lead\.png/);
});

test('planPublishImageFiles: an oldPath equal to the commit path is not a move', async () => {
  // Defence against a caller that derives the origin folder wrongly and hands back the destination. Deleting
  // that path would delete the file the same PR just committed, in the same PR.
  const same = 'members/gwen/posts/hello/images/lead.png';
  const r = await planPublishImageFiles(
    { name: 'lead.png', item: 'post:hello', commitPath: same, oldPath: same, oldBase64: 'B64' },
    { fromSession: () => 'SESSION_B64', fromStore: never, onMain: never },
  );
  assert.deepEqual(r.files, [{ path: same, contentBase64: 'SESSION_B64' }]);
});

test('planPublishImage: bytes nowhere and no file on main REFUSES, naming the image', async () => {
  const plan = await planPublishImage(IMG, { fromSession: () => undefined, fromStore: async () => null, onMain: async () => false });
  assert.equal(plan.action, 'refuse');
  assert.match(plan.message, /lead\.png/);
  assert.match(plan.message, /choose it again before publishing/);
  // No lookup at all is the same refusal, not an accidental commit of undefined.
  assert.equal((await planPublishImage(IMG)).action, 'refuse');
  // Each source is handed the descriptor, so publish can key them differently.
  await planPublishImage(IMG, {
    fromSession: (r) => { assert.equal(r.name, 'lead.png'); return undefined; },
    fromStore: async (r) => { assert.equal(r.item, 'post:hello'); return null; },
    onMain: async (r) => { assert.equal(r.commitPath, 'members/gwen/posts/hello/images/lead.png'); return false; },
  });
});
