// SOW-088: the dev.to destination — the pure body pipeline (fail-closed guards, marker cut, CDN image
// rewrite, tag normalization) and the adapter (payload shape, skips, error surfacing). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contentPathFor, prepareDevtoBody, normalizeDevtoTags, DEVTO_CDN_BASE } from '../clients/syndication/devto-body.mjs';
import { createDevtoAdapter } from '../clients/syndication/devto.mjs';

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

test('contentPathFor maps the sub folder per type and refuses shares', () => {
  assert.equal(contentPathFor(ITEM), 'members/atwellpub/posts/my-article/index.md');
  assert.equal(contentPathFor({ ...ITEM, source: 'prompt' }), 'members/atwellpub/prompts/my-article/index.md');
  assert.equal(contentPathFor({ ...ITEM, source: 'share' }), null);
});

test('prepareDevtoBody: marker cut, CDN rewrite, byline prepend, tag normalization', () => {
  const r = prepareDevtoBody(FILE, ITEM, { intro: '**By Hudson.**' });
  assert.equal(r.ok, true);
  assert.ok(r.body.startsWith('**By Hudson.**\n\n'), 'the byline leads');
  assert.ok(!r.body.includes('SECRET'), 'the members part is cut');
  assert.ok(!r.body.includes('members-only'), 'the marker itself is cut');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/pic.webp`), 'relative ./ image rewritten');
  assert.ok(r.body.includes(`${DEVTO_CDN_BASE}/members/atwellpub/posts/my-article/images/two.png`), 'bare images/ path rewritten');
  assert.deepEqual(r.tags, ['claudecode', 'agentskills', 'ai', 'workflow'], 'lowercase alphanumeric, capped at 4');
});

test('prepareDevtoBody fails closed: drafts, members visibility, empty public body', () => {
  assert.equal(prepareDevtoBody(FILE.replace('status: published', 'status: draft'), ITEM).ok, false);
  assert.equal(prepareDevtoBody(FILE.replace('visibility: public', 'visibility: members'), ITEM).ok, false);
  const onlyMembers = '---\nstatus: published\nvisibility: public\n---\n<!-- members-only -->\nSECRET';
  assert.equal(prepareDevtoBody(onlyMembers, ITEM).ok, false, 'nothing public to post');
  assert.equal(prepareDevtoBody('no frontmatter at all', ITEM).ok, false);
});

test('normalizeDevtoTags falls back to the taxonomy path', () => {
  assert.deepEqual(normalizeDevtoTags(null, ['ai', 'prompts', 'skill']), ['ai', 'prompts', 'skill']);
  assert.deepEqual(normalizeDevtoTags([], undefined), []);
});

test('devto adapter: the full article payload (org, canonical, cover, draft flag)', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, opts });
    if (url.startsWith('https://raw.githubusercontent.com/')) return { ok: true, status: 200, text: async () => FILE };
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 777, url: 'https://dev.to/gbti-network/my-article-1abc' }) };
  };
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  const ad = createDevtoAdapter({ env, fetchImpl });
  assert.equal(ad.enabled(), true);
  const r = await ad.post({ ...ITEM, textOverride: 'My Article', image: '/_astro/cover.webp', devtoIntro: '**By Hudson Atwell.**' });
  assert.equal(calls[0].url, 'https://raw.githubusercontent.com/gbti-network/gbti.network/main/members/atwellpub/posts/my-article/index.md');
  assert.equal(calls[1].url, 'https://dev.to/api/articles');
  assert.equal(calls[1].opts.headers['api-key'], 'k');
  const a = JSON.parse(calls[1].opts.body).article;
  assert.equal(a.title, 'My Article');
  assert.equal(a.canonical_url, ITEM.url);
  assert.equal(a.published, true);
  assert.equal(a.organization_id, 10466);
  assert.equal(a.main_image, 'https://gbti.network/_astro/cover.webp');
  assert.ok(a.body_markdown.startsWith('**By Hudson Atwell.**'));
  assert.ok(!a.body_markdown.includes('SECRET'));
  assert.deepEqual(a.tags, ['claudecode', 'agentskills', 'ai', 'workflow']);
  assert.equal(r.ok, true);
  assert.equal(r.id, '777');
  assert.match(r.url, /dev\.to/);
});

test('devto adapter: draft flag, skips (share/members/draft file), and readable errors', async () => {
  const env = { DEVTO_API_KEY: 'k', DEVTO_ORG_ID: '10466' };
  let lastBody = null;
  const okFetch = async (url, opts) => {
    if (url.startsWith('https://raw.')) return { ok: true, text: async () => FILE };
    lastBody = JSON.parse(opts.body);
    return { ok: true, status: 201, text: async () => JSON.stringify({ id: 1, url: 'https://dev.to/x' }) };
  };
  const ad = createDevtoAdapter({ env, fetchImpl: okFetch });
  const draft = await ad.post({ ...ITEM, devtoDraft: true });
  assert.equal(lastBody.article.published, false);
  assert.equal(draft.draft, true);
  assert.equal((await ad.post({ ...ITEM, source: 'share' })).skipped, true);
  assert.equal((await ad.post({ ...ITEM, visibility: 'members', membersOnly: true })).skipped, true);
  const draftFile = createDevtoAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE.replace('status: published', 'status: draft') } : null) });
  assert.equal((await draftFile.post({ ...ITEM })).skipped, true, 'an unpublished canonical file skips');
  const err422 = createDevtoAdapter({ env, fetchImpl: async (u) => (u.startsWith('https://raw.') ? { ok: true, text: async () => FILE } : { ok: false, status: 422, text: async () => JSON.stringify({ error: 'Title has already been used' }) }) });
  const e = await err422.post({ ...ITEM });
  assert.equal(e.ok, false);
  assert.match(e.error, /devto 422 .*Title/);
});
