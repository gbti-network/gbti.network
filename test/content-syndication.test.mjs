// SOW-034: content-publish syndication. Pure classification/eligibility/format/plan, the mention resolver, and
// the runner end-to-end with injected deps (no fs, no network).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyContentPath, hasPublicPage, publicUrlFor, buildSyndicationItem,
  formatPublishMessage, channelForType, planContentSyndication, allowedMentionsFor,
} from '../scripts/lib/content-syndication.mjs';
import { reverseMembersIndex, createMentionResolver } from '../scripts/lib/discord-mention.mjs';
import { main as runSyndicate, parseArgs } from '../scripts/syndicate-content.mjs';

const CHANNELS = { post: 'C_POST', product: 'C_PROD', prompt: 'C_PROMPT', share: 'C_SHARE' };

// ---- classification ----
test('classifyContentPath: maps the four content shapes, rejects everything else', () => {
  assert.deepEqual(classifyContentPath('members/alice/posts/hello/index.md'), { type: 'post', slug: 'hello' });
  assert.deepEqual(classifyContentPath('house/products/radle/index.md'), { type: 'product', slug: 'radle' });
  assert.deepEqual(classifyContentPath('members/bob/prompts/p/index.md'), { type: 'prompt', slug: 'p' });
  assert.deepEqual(classifyContentPath('members/bob/shares/20260616-x.md'), { type: 'share', slug: '20260616-x' });
  for (const bad of ['house/roles.yml', 'members/alice/profile.md', 'members/a/posts/x/cover.png',
    'members/a/../house/posts/x/index.md', 'house/pages/about/index.md', null, 42]) {
    assert.equal(classifyContentPath(bad), null, `reject ${JSON.stringify(bad)}`);
  }
});

// ---- eligibility (hasPublicPage) ----
test('hasPublicPage: public yes, Mode B stub yes, Mode A no, draft no, share no', () => {
  assert.equal(hasPublicPage({ status: 'published', visibility: 'public' }), true);
  assert.equal(hasPublicPage({ status: 'published', visibility: 'members', publicStub: true }), true); // Mode B
  assert.equal(hasPublicPage({ status: 'published', visibility: 'members', publicStub: false }), false); // Mode A
  assert.equal(hasPublicPage({ status: 'draft', visibility: 'public' }), false);
  assert.equal(hasPublicPage({ status: 'published', visibility: 'public', type: 'share' }), false);
});

test('publicUrlFor: per-type slug url for a public item; null for Mode A / share', () => {
  assert.equal(publicUrlFor({ type: 'post', slug: 'hello', hasPublicPage: true }), 'https://gbti.network/articles/hello/');
  assert.equal(publicUrlFor({ type: 'product', slug: 'radle', hasPublicPage: true }, 'https://gbti.network/'), 'https://gbti.network/products/radle/');
  assert.equal(publicUrlFor({ type: 'prompt', slug: 'p', hasPublicPage: true }), 'https://gbti.network/prompts/p/');
  assert.equal(publicUrlFor({ type: 'post', slug: 'x', hasPublicPage: false }), null); // Mode A
  assert.equal(publicUrlFor({ type: 'share', slug: 's', hasPublicPage: false }), null);
});

// ---- item building ----
test('buildSyndicationItem: published only; title required (non-share); type-mismatch guarded', () => {
  const post = buildSyndicationItem('members/alice/posts/hello/index.md', { type: 'post', title: 'Hello', author: 'alice', status: 'published', visibility: 'public' });
  assert.deepEqual(post, { type: 'post', slug: 'hello', author: 'alice', title: 'Hello', visibility: 'public', hasPublicPage: true, shareUrl: null });
  // draft -> null
  assert.equal(buildSyndicationItem('members/a/posts/x/index.md', { title: 'X', status: 'draft' }), null);
  // missing title (non-share) -> null
  assert.equal(buildSyndicationItem('members/a/posts/x/index.md', { status: 'published' }), null);
  // a frontmatter type that disagrees with the path subtree -> null (cannot retarget a channel)
  assert.equal(buildSyndicationItem('members/a/posts/x/index.md', { type: 'product', title: 'X', status: 'published' }), null);
  // members-only Mode A post -> built, hasPublicPage false
  const a = buildSyndicationItem('members/a/posts/secret/index.md', { type: 'post', title: 'Secret', author: 'a', status: 'published', visibility: 'members', publicStub: false });
  assert.equal(a.hasPublicPage, false);
  // share with a link
  const sh = buildSyndicationItem('members/a/shares/20260616-x.md', { type: 'share', title: 'Cool tool', author: 'a', status: 'published', visibility: 'members', url: 'https://example.com' });
  assert.equal(sh.type, 'share'); assert.equal(sh.shareUrl, 'https://example.com');
});

// ---- message format ----
test('formatPublishMessage: public link, members title-only, share link, mention', () => {
  const pub = formatPublishMessage({ type: 'post', slug: 'hello', title: 'Hello', author: 'alice', hasPublicPage: true }, { mention: '<@123>' });
  assert.match(pub, /New article published by network member <@123> 🎉/);
  assert.match(pub, /\*\*Hello\*\*/);
  assert.match(pub, /https:\/\/gbti\.network\/articles\/hello\//);

  const modeA = formatPublishMessage({ type: 'prompt', slug: 's', title: 'Secret', author: 'a', visibility: 'members', hasPublicPage: false }, { mention: '@a' });
  assert.match(modeA, /New members-only prompt by network member @a 🎉/);
  assert.match(modeA, /\*\*Secret\*\*/);
  assert.doesNotMatch(modeA, /https:\/\/gbti\.network\/prompts/); // no public link
  assert.match(modeA, /open it in the GBTI client/i);

  const share = formatPublishMessage({ type: 'share', title: 'Cool', author: 'a', shareUrl: 'https://x.com', hasPublicPage: false, visibility: 'members' }, { mention: '<@9>' });
  assert.match(share, /New members-only Share from <@9> 🎉/);
  assert.match(share, /https:\/\/x\.com/);
});

test('channelForType + planContentSyndication: group by channel, drop no-channel types', () => {
  assert.equal(channelForType('post', CHANNELS), 'C_POST');
  assert.equal(channelForType('share', {}), null);
  const plan = planContentSyndication([
    { item: { type: 'post', slug: 'a', title: 'A', author: 'x', hasPublicPage: true }, mention: '<@1>' },
    { item: { type: 'share', title: 'S', author: 'y', shareUrl: 'https://s', hasPublicPage: true, visibility: 'public' }, mention: '<@2>' },
    { item: { type: 'prompt', slug: 'p', title: 'P', author: 'z', hasPublicPage: true }, mention: '<@3>' },
  ], { post: 'C_POST', share: 'C_SHARE' }); // prompt has no channel -> dropped
  assert.deepEqual(plan.map((p) => p.channelId), ['C_POST', 'C_SHARE']);
});

// ---- mention safety (allowed_mentions) ----
test('allowedMentionsFor: only the resolved author may ping; text fallback pings nothing', () => {
  assert.deepEqual(allowedMentionsFor('<@123>'), { parse: [], users: ['123'] });
  assert.deepEqual(allowedMentionsFor('<@!456>'), { parse: [], users: ['456'] }); // nickname mention form
  assert.deepEqual(allowedMentionsFor('@alice'), { parse: [] });
  assert.deepEqual(allowedMentionsFor(''), { parse: [] });
});

test('a hostile title (@everyone / role ping) is INERT: allowed_mentions never permits it', () => {
  const item = buildSyndicationItem('members/mallory/posts/x/index.md', { type: 'post', title: '@everyone hi <@&999>', slug: 'x', author: 'mallory', status: 'published', visibility: 'public' });
  const plan = planContentSyndication([{ item, mention: '<@111>' }], { post: 'C_POST' });
  // The literal text rides along, but the only id Discord is allowed to notify is the author's.
  assert.match(plan[0].message, /@everyone hi <@&999>/);
  assert.deepEqual(plan[0].allowedMentions, { parse: [], users: ['111'] });
  // text-fallback author -> no ping at all
  const plan2 = planContentSyndication([{ item, mention: '@mallory' }], { post: 'C_POST' });
  assert.deepEqual(plan2[0].allowedMentions, { parse: [] });
});

// ---- mention resolver ----
test('createMentionResolver: override > Stripe > @login; house is plain; cached; never throws', async () => {
  const reverseIndex = reverseMembersIndex({ '1': 'alice', '2': 'bob', '3': 'carol' });
  let calls = 0;
  const stripe = {
    async searchCustomerByGithubId(id) {
      calls++;
      if (id === '1') return { metadata: { discord_user_id: '111' } };
      if (id === '2') throw new Error('stripe lag');
      return null; // carol: no customer
    },
  };
  const resolve = createMentionResolver({ reverseIndex, stripe, overrides: { Dave: '999' } });
  assert.equal(await resolve('alice'), '<@111>');       // via Stripe
  assert.equal(await resolve('bob'), '@bob');            // Stripe threw -> text fallback (no throw)
  assert.equal(await resolve('carol'), '@carol');        // no customer -> text fallback
  assert.equal(await resolve('dave'), '<@999>');         // override (case-insensitive)
  assert.equal(await resolve('gbti'), 'GBTI Network');   // house, no ping
  await resolve('alice'); // cached
  assert.equal(calls, 3, 'alice looked up once (cached), bob+carol once each; house/override no Stripe call');
});

// ---- runner end-to-end (injected deps) ----
test('runner: --apply posts each item to its type channel; dry-run posts nothing; draft skipped', async () => {
  const files = {
    'members/alice/posts/hello/index.md': '---\ntype: post\ntitle: Hello\nslug: hello\nauthor: alice\nstatus: published\nvisibility: public\n---\n\nbody',
    'members/bob/shares/20260616-x.md': '---\ntype: share\nid: 20260616-x\ntitle: Cool\nauthor: bob\nstatus: published\nvisibility: members\nurl: https://example.com\ncreatedAt: 2026-06-16T00:00:00Z\n---\n\n',
    'members/carol/prompts/draft/index.md': '---\ntype: prompt\ntitle: Draft\nslug: draft\nauthor: carol\nstatus: draft\nvisibility: public\n---\n\n',
  };
  const env = { DISCORD_BOT_TOKEN: 'bot', DISCORD_CHANNEL_POSTS: 'C_POST', DISCORD_CHANNEL_SHARES: 'C_SHARE', SITE_ORIGIN: 'https://gbti.network' };
  const posts = [];
  const deps = {
    readFile: (rel) => files[rel] ?? null,
    resolveMention: async (login) => `<@${{ alice: '1001', bob: '1002', carol: '1003' }[login]}>`,
    discord: { postChannelMessage: async (channelId, message, opts) => { posts.push({ channelId, message, opts }); } },
    stripe: null,
  };
  const added = ['members/alice/posts/hello/index.md', 'members/bob/shares/20260616-x.md', 'members/carol/prompts/draft/index.md'];

  // dry-run: nothing posted
  const dry = await runSyndicate({ argv: ['--added', ...added], env, deps });
  assert.equal(posts.length, 0);
  assert.equal(dry.planned.length, 2, 'the draft is excluded; 2 publishable');

  // apply: posts the post to C_POST and the share to C_SHARE (draft skipped)
  const r = await runSyndicate({ argv: ['--apply', '--added', ...added], env, deps });
  assert.equal(r.posted.length, 2);
  const byChannel = Object.fromEntries(posts.map((p) => [p.channelId, p.message]));
  assert.match(byChannel.C_POST, /New article published by network member <@1001> 🎉[\s\S]*\*\*Hello\*\*[\s\S]*\/articles\/hello\//);
  assert.match(byChannel.C_SHARE, /New members-only Share from <@1002> 🎉[\s\S]*https:\/\/example\.com/);
  // each post restricts pings to the resolved author only
  assert.deepEqual(posts.find((p) => p.channelId === 'C_POST').opts, { allowedMentions: { parse: [], users: ['1001'] } });
});

test('parseArgs: --added accepts space- and comma-separated paths', () => {
  assert.deepEqual(parseArgs(['--apply', '--added', 'a/b/index.md', 'c/d/index.md']).added, ['a/b/index.md', 'c/d/index.md']);
  assert.deepEqual(parseArgs(['--added', 'a,b,c']).added, ['a', 'b', 'c']);
  assert.equal(parseArgs(['--apply']).apply, true);
  assert.deepEqual(parseArgs([]).added, []);
});
