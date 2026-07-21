// SOW-134: the Hashnode destination. The pure body pipeline (reusing the shared dev.to guards: fail-closed
// publish gate, members-marker cut, CDN image rewrite) with Hashnode's [{name,slug}] tag shape, plus the
// adapter (the GraphQL publishPost payload, skips, GraphQL + HTTP error surfacing). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentPathFor, prepareHashnodeBody, normalizeHashnodeTags } from '../clients/syndication/hashnode-body.mjs';
import { DEVTO_CDN_BASE } from '../clients/syndication/devto-body.mjs';
import { createHashnodeAdapter } from '../clients/syndication/hashnode.mjs';

const ITEM = { source: 'post', targetSlug: 'my-article', author: 'atwellpub', title: 'My Article', url: 'https://gbti.network/articles/my-article/', visibility: 'public', categoryPath: ['ai', 'devops'] };
const FILE = `---
title: My Article
status: published
visibility: public
tags:
  - Claude-Code
  - agent skills
  - ai
  - workflow
  - extra-tag
---

Intro paragraph with a relative image:

![](./images/pic.webp)

And one without the dot: ![x](images/two.png)

<!-- members-only -->

SECRET members part.
`;

test('contentPathFor is reused from the shared pipeline (maps sub folder, refuses shares)', () => {
  assert.equal(contentPathFor(ITEM), 'members/atwellpub/posts/my-article/index.md');
  assert.equal(contentPathFor({ ...ITEM, source: 'share' }), null);
});

test('normalizeHashnodeTags: [{name, slug}], slug lowercase-dash, max 5, taxonomy fallback', () => {
  assert.deepEqual(normalizeHashnodeTags(['Claude-Code', 'agent skills', 'ai'], null), [
    { slug: 'claude-code', name: 'Claude-Code' },
    { slug: 'agent-skills', name: 'agent skills' },
    { slug: 'ai', name: 'ai' },
  ]);
  // caps at 5
  assert.equal(normalizeHashnodeTags(['a', 'b', 'c', 'd', 'e', 'f'], null).length, 5);
  // fallback to the taxonomy path leaves
  assert.deepEqual(normalizeHashnodeTags(null, ['ai', 'prompts']), [
    { slug: 'ai', name: 'ai' },
    { slug: 'prompts', name: 'prompts' },
  ]);
  assert.deepEqual(normalizeHashnodeTags([], undefined), []);
});

test('prepareHashnodeBody: marker cut, CDN rewrite, byline prepend, tag shape', () => {
  const r = prepareHashnodeBody(FILE, ITEM, { intro: '**By Hudson.**' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'full');
  assert.ok(r.body.startsWith('**By Hudson.**\n\n'), 'the byline leads');
  assert.ok(!r.body.includes('SECRET'), 'the members part is cut');
  assert.ok(!r.body.includes('members-only'), 'the marker itself is cut');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/pic.webp`), 'relative ./ image rewritten');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/two.png`), 'bare images/ path rewritten');
  assert.deepEqual(r.tags, [
    { slug: 'claude-code', name: 'Claude-Code' },
    { slug: 'agent-skills', name: 'agent skills' },
    { slug: 'ai', name: 'ai' },
    { slug: 'workflow', name: 'workflow' },
    { slug: 'extra-tag', name: 'extra-tag' },
  ]);
});

test('prepareHashnodeBody: a members item STUBS (rendered stub template, never any body)', () => {
  const membersFile = FILE.replace('visibility: public', 'visibility: members');
  const r = prepareHashnodeBody(membersFile, ITEM, { intro: '**By H.**', footer: 'Join us.', stubBody: 'A great teaser.' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'stub');
  assert.equal(r.body, '**By H.**\n\nA great teaser.\n\nJoin us.');
  assert.ok(!r.body.includes('Intro paragraph'), 'no body content in a stub');
  assert.ok(!r.body.includes('SECRET'));
});

test('prepareHashnodeBody fails closed: drafts, empty public body, no frontmatter', () => {
  assert.equal(prepareHashnodeBody(FILE.replace('status: published', 'status: draft'), ITEM).ok, false);
  assert.equal(prepareHashnodeBody('no frontmatter at all', ITEM).ok, false);
  const bareMembers = '---\nstatus: published\nvisibility: members\n---\nSECRET';
  assert.equal(prepareHashnodeBody(bareMembers, ITEM, {}).ok, false);
});

test('hashnode adapter: the GraphQL publishPost payload (canonical, publicationId, cover, tags, auth header)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.startsWith('https://raw.githubusercontent.com/')) return { ok: true, status: 200, text: async () => FILE };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { publishPost: { post: { id: 'abc123', url: 'https://gbti.hashnode.dev/my-article', slug: 'my-article' } } } }) };
  };
  const env = { HASHNODE_TOKEN: 'tok', HASHNODE_PUBLICATION_ID: 'pub123' };
  const ad = createHashnodeAdapter({ env, fetchImpl });
  assert.equal(ad.enabled(), true);
  const r = await ad.post({ ...ITEM, textOverride: 'My Article', image: '/_astro/cover.webp', hashnodeIntro: '**By Hudson Atwell.**' });
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/gbti-network/gbti.network/main/members/atwellpub/posts/my-article/index.md');
  assert.equal(calls[1].url, 'https://gql.hashnode.com');
  assert.equal(calls[1].opts.headers.Authorization, 'tok'); // bare PAT, no Bearer prefix
  const payload = JSON.parse(calls[1].opts.body);
  assert.match(payload.query, /publishPost/);
  const input = payload.variables.input;
  assert.equal(input.title, 'My Article');
  assert.equal(input.publicationId, 'pub123');
  assert.equal(input.originalArticleURL, ITEM.url);
  assert.equal(input.coverImageOptions.coverImageURL, 'https://gbti.network/_astro/cover.webp');
  assert.ok(input.contentMarkdown.startsWith('**By Hudson Atwell.**'));
  assert.ok(!input.contentMarkdown.includes('SECRET'));
  assert.deepEqual(input.tags, [
    { slug: 'claude-code', name: 'Claude-Code' },
    { slug: 'agent-skills', name: 'agent skills' },
    { slug: 'ai', name: 'ai' },
    { slug: 'workflow', name: 'workflow' },
    { slug: 'extra-tag', name: 'extra-tag' },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.id, 'abc123');
  assert.match(r.url, /gbti\.hashnode\.dev/);
});

test('hashnode adapter: skips (share, draft file), no-publication-id, and readable errors', async () => {
  const env = { HASHNODE_TOKEN: 'tok', HASHNODE_PUBLICATION_ID: 'pub123' };
  const raw = (file) => async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => file } : { ok: true, status: 200, text: async () => JSON.stringify({ data: { publishPost: { post: { id: '1', url: 'https://gbti.hashnode.dev/x' } } } }) });

  assert.equal((await createHashnodeAdapter({ env, fetchImpl: raw(FILE) }).post({ ...ITEM, source: 'share' })).skipped, true);
  assert.equal((await createHashnodeAdapter({ env, fetchImpl: raw(FILE.replace('status: published', 'status: draft')) }).post({ ...ITEM })).skipped, true, 'an unpublished canonical file skips');

  // no publication id -> hard error (not a silent post to nowhere)
  const noPub = await createHashnodeAdapter({ env: { HASHNODE_TOKEN: 'tok' }, fetchImpl: raw(FILE) }).post({ ...ITEM });
  assert.equal(noPub.ok, false);
  assert.match(noPub.error, /publication id/);

  // GraphQL returns HTTP 200 with an errors[] -> treated as a failure with the message surfaced
  const gqlErr = await createHashnodeAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE } : { ok: true, status: 200, text: async () => JSON.stringify({ errors: [{ message: 'Publication not found' }] }) }) }).post({ ...ITEM });
  assert.equal(gqlErr.ok, false);
  assert.match(gqlErr.error, /hashnode: Publication not found/);

  // a hard HTTP error surfaces its status
  const http500 = await createHashnodeAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE } : { ok: false, status: 500, text: async () => 'upstream error' }) }).post({ ...ITEM });
  assert.equal(http500.ok, false);
  assert.match(http500.error, /hashnode 500/);
});

test('hashnode adapter is disabled without both secrets', () => {
  assert.equal(createHashnodeAdapter({ env: {} }).enabled(), false);
  assert.equal(createHashnodeAdapter({ env: { HASHNODE_TOKEN: 'x' } }).enabled(), false);
  assert.equal(createHashnodeAdapter({ env: { HASHNODE_TOKEN: 'x', HASHNODE_PUBLICATION_ID: 'y' } }).enabled(), true);
});
