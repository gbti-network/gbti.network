// SOW-087: the pure edit cores behind the channel-map manager (content-channels + moderation flags +
// syndication templates). Idempotency, validation, audit shape. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setChannel, removeChannel, ContentChannelEditError } from '../membership/content-channels-edits.mjs';
import { addFlagTerm, removeFlagTerm, ModerationFlagEditError } from '../membership/moderation-flags-edits.mjs';
import { setTemplate, setNewsEngagement, TemplateEditError } from '../membership/syndication-template-edits.mjs';
import { templateFor, syndicationConfigFromParsed } from '../membership/syndication-config.mjs';

const ctx = { actor: { githubId: '42', login: 'root' }, now: '2026-07-04T00:00:00Z' };

test('setChannel upserts (add, update, no-op) with validation, sorted + lowercased', () => {
  const add = setChannel({ channels: [] }, { category: 'DevOps', channelId: '12345' }, ctx);
  assert.equal(add.changed, true);
  assert.deepEqual(add.next.channels, [{ category: 'devops', channelId: '12345' }]);
  assert.equal(add.audit.action, 'content-channel.set');
  assert.equal(add.audit.actor.github_id, '42');
  const noop = setChannel(add.next, { category: 'devops', channelId: '12345' }, ctx);
  assert.equal(noop.changed, false);
  const update = setChannel(add.next, { category: 'devops', channelId: '99999' }, ctx);
  assert.equal(update.changed, true);
  assert.equal(update.next.channels[0].channelId, '99999');
  assert.throws(() => setChannel({}, { category: 'Not Valid!', channelId: '12345' }, ctx), ContentChannelEditError);
  assert.throws(() => setChannel({}, { category: 'ai', channelId: 'abc' }, ctx), ContentChannelEditError);
});

test('removeChannel deletes a mapping; a missing category is an error', () => {
  const doc = { channels: [{ category: 'ai', channelId: '11111' }] };
  const r = removeChannel(doc, { category: 'AI' }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next.channels, []);
  assert.throws(() => removeChannel({ channels: [] }, { category: 'ai' }, ctx), ContentChannelEditError);
});

test('addFlagTerm / removeFlagTerm: case-insensitive idempotency, list must exist, caps enforced', () => {
  const doc = { lists: { political: ['election'], profanity: [] } };
  const add = addFlagTerm(doc, { list: 'profanity', term: ' Fudge ' }, ctx);
  assert.equal(add.changed, true);
  assert.deepEqual(add.next.lists.profanity, ['Fudge']);
  assert.equal(addFlagTerm(add.next, { list: 'profanity', term: 'fudge' }, ctx).changed, false);
  const rm = removeFlagTerm(add.next, { list: 'profanity', term: 'FUDGE' }, ctx);
  assert.deepEqual(rm.next.lists.profanity, []);
  assert.throws(() => addFlagTerm(doc, { list: 'nope', term: 'x' }, ctx), ModerationFlagEditError); // a typo never creates a list
  assert.throws(() => addFlagTerm(doc, { list: 'political', term: '' }, ctx), ModerationFlagEditError);
  assert.throws(() => removeFlagTerm(doc, { list: 'political', term: 'absent' }, ctx), ModerationFlagEditError);
});

test('setTemplate writes/clears syndication.templates and round-trips through templateFor', () => {
  const doc = { syndication: { enabled: true } };
  const set = setTemplate(doc, { type: 'share', template: '{title} {shareurl}' }, ctx);
  assert.equal(set.changed, true);
  assert.equal(templateFor(syndicationConfigFromParsed(set.next), 'share'), '{title} {shareurl}');
  assert.equal(setTemplate(set.next, { type: 'share', template: '{title} {shareurl}' }, ctx).changed, false);
  // clearing falls back to the share default
  const clear = setTemplate(set.next, { type: 'share', template: '' }, ctx);
  assert.equal(clear.changed, true);
  assert.equal(templateFor(syndicationConfigFromParsed(clear.next), 'share'), 'Shared by {memberdiscord} {shareurl}');
  // the rest of the config survives the edit
  assert.equal(clear.next.syndication.enabled, true);
  assert.throws(() => setTemplate(doc, { type: 'news', template: 'x' }, ctx), TemplateEditError);
});

// SOW-111: the news engagement settings edit (same file as the templates).
test('setNewsEngagement patches only the supplied fields, validates hard, and is idempotent', () => {
  const doc = { syndication: { enabled: true, templates: { share: 'x' } } };
  const set = setNewsEngagement(doc, { enabled: true, openThreshold: 3, tier: 'paid-trial' }, ctx);
  assert.equal(set.changed, true);
  assert.deepEqual(set.next.syndication.news_engagement, { enabled: true, open_threshold: 3, tier: 'paid-trial', comment_autopost: true });
  assert.equal(set.next.syndication.templates.share, 'x'); // the rest of the config survives
  assert.equal(set.audit.action, 'news-engagement.set');
  // idempotent against the normalized current state
  assert.equal(setNewsEngagement(set.next, { openThreshold: 3 }, ctx).changed, false);
  // partial patch: only the tier changes
  const tierOnly = setNewsEngagement(set.next, { tier: 'signed-in' }, ctx);
  assert.equal(tierOnly.next.syndication.news_engagement.open_threshold, 3);
  assert.equal(tierOnly.next.syndication.news_engagement.tier, 'signed-in');
  // hard validation
  assert.throws(() => setNewsEngagement(doc, { tier: 'everyone' }, ctx), TemplateEditError);
  assert.throws(() => setNewsEngagement(doc, { openThreshold: 0 }, ctx), TemplateEditError);
  assert.throws(() => setNewsEngagement(doc, { enabled: 'yes' }, ctx), TemplateEditError);
});

// SOW-100: the batch apply (N pending workspace edits -> ONE house PR). Uses the admin-ops surface.
import { applyCategoryBatch } from '../client/src/admin-ops.mjs';

function batchCtx({ role = 'superadmin', taxonomy = 'tree:\n  devops:\n    label: DevOps\n', channels = 'channels: []\n' } = {}) {
  const puts = []; const pulls = [];
  return {
    puts, pulls,
    identity: () => ({ username: 'root', githubId: '1' }),
    role: () => role,
    reader: { readFile: async (rel) => (rel === 'house/taxonomy.yml' ? taxonomy : rel === 'house/content-channels.yml' ? channels : null) },
    getRepoClient: () => ({
      upstream: 'gbti-network/gbti.network',
      ensureFork: async () => ({ full_name: 'root/gbti.network', owner: 'root' }),
      getDefaultBranch: async () => 'main',
      getBranchSha: async (r, b) => (b === 'main' ? 'sha' : (() => { throw new Error('404'); })()),
      ensureBranch: async () => {},
      getFileSha: async () => null,
      putFile: async (_r, p, opts) => { puts.push({ path: p, content: Buffer.from(opts.contentBase64, 'base64').toString('utf8') }); },
      deleteFile: async () => {},
      findOpenPull: async () => null,
      openPull: async (o) => { pulls.push(o); return { number: 3, html_url: 'u' }; },
    }),
    store: { get: (k) => (k === 'repoPath' ? 'extension' : null) },
    now: () => '2026-07-07T12:00:00.000Z',
  };
}

test('applyCategoryBatch: mixed ops land as ONE PR touching both house files', async () => {
  const ctx = batchCtx({});
  const r = await applyCategoryBatch(ctx, { ops: [
    { kind: 'label', args: { path: ['devops'], label: 'DevOps and Cloud' } },
    { kind: 'add', args: { parentPath: ['devops'], key: 'observability', label: 'Observability' } },
    { kind: 'channel-set', args: { category: 'devops', channelId: '12345678' } },
  ] });
  assert.equal(r.changed, true);
  assert.equal(r.applied, 3);
  assert.equal(ctx.pulls.length, 1); // ONE PR
  assert.deepEqual(ctx.puts.map((f) => f.path).sort(), ['house/content-channels.yml', 'house/taxonomy.yml']);
  assert.match(ctx.puts.find((f) => f.path === 'house/taxonomy.yml').content, /DevOps and Cloud/);
  assert.match(ctx.puts.find((f) => f.path === 'house/taxonomy.yml').content, /observability/);
  assert.match(ctx.pulls[0].head ?? '', /gbti\/category-batch-20260707/);
});

test('applyCategoryBatch guards: migration kinds refused; channel ops need superadmin; empty refused; full noop', async () => {
  await assert.rejects(applyCategoryBatch(batchCtx({}), { ops: [{ kind: 'key-rename', args: {} }] }), /cannot batch/);
  await assert.rejects(applyCategoryBatch(batchCtx({ role: 'admin' }), { ops: [{ kind: 'channel-set', args: { category: 'devops', channelId: '123456' } }] }), /superadmin/);
  await assert.rejects(applyCategoryBatch(batchCtx({}), { ops: [] }), /empty/);
  // an admin CAN batch taxonomy-only
  const r = await applyCategoryBatch(batchCtx({ role: 'admin' }), { ops: [{ kind: 'label', args: { path: ['devops'], label: 'DevOps' } }] });
  assert.equal(r.noop, true); // label unchanged -> nothing published
});
