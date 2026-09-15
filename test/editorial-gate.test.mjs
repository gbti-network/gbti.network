// sow-323 Phase 3: the merge gate's half of editorial review (membership/classify-pr.mjs decide, scripts/pr-gate.mjs).
//
// Two things, and the first was a live defect. A members-only publish commits its encrypted body beside the item
// as `_enc/<type>-<slug>-body.enc`. The gate typed that file as unclassifiable, which requires the higher tier,
// so it CLOSED every ordinary supporter's members-only article and comment: the only way the one-plan change let
// them publish at all. Nobody met it because every members-only item so far was a superadmin's. These cases use
// the file names the client really writes (encAssetFor), not a shortened fixture, because the shortened fixture
// in pr-gate.test.mjs (`_enc/hello-body.enc`) is exactly the shape that hid it.
//
// The second is the side door. WHO may make content public is decided in the Worker, which reads frontmatter
// this gate cannot. A PR the Worker did not open never passed that check, so it is held for a superadmin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, contentTypesTouched } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides-core.mjs';
import { TIER } from '../membership/tiers.mjs';
import { encAssetFor } from '../client/src/member-content.mjs';
import { parseEvent, shouldExplainHold, HOLD_NOTE, shouldAutoMerge, evaluatePR } from '../scripts/pr-gate.mjs';
import { buildPriceTierMap } from '../membership/tiers.mjs';
import { TOOLS, shareVisibilityArg } from '../client/src/mcp-tools.mjs';
import { canSharePublicly } from '../client-ui/src/share-post-core.mjs';

const PAID = { status: 'paid' };
const base = { role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member };
const item = (type, dir, slug) => [`members/octocat/${dir}/${slug}/index.md`, encAssetFor(type, 'octocat', slug).path];

test('a supporter\'s members-only article, project and prompt, each with its real body file, pass and auto-merge', () => {
  for (const [type, dir] of [['post', 'posts'], ['project', 'projects'], ['prompt', 'prompts']]) {
    const paths = item(type, dir, 'a-members-piece');
    const d = decide({ ...base, paths, workerOpened: true });
    assert.equal(d.check, 'pass', `${type}: ${d.reasons[0]}`);
    assert.equal(d.label, 'paid');
    assert.equal(d.autoMerge, true);
    assert.equal(shouldAutoMerge(d, paths), true, `${type}: and the actuator agrees`);
  }
});

test('a supporter\'s members-only comment and share, with their body files, pass', () => {
  const comment = ['members/octocat/comments/c-1.md', encAssetFor('comment', 'octocat', 'c-1').path];
  assert.equal(decide({ ...base, paths: comment, workerOpened: true }).label, 'paid');
  const share = ['members/octocat/shares/20260915120000-x.md', encAssetFor('share', 'octocat', '20260915120000-x').path];
  assert.equal(decide({ ...base, paths: share, workerOpened: true }).label, 'paid');
});

test('the body file is typed by the name it declares, and a name the gate cannot read still fails closed', () => {
  assert.deepEqual(contentTypesTouched(['members/octocat/_enc/post-hello-body.enc'], 'octocat'), ['post']);
  assert.deepEqual(contentTypesTouched(['members/octocat/_enc/comment-c-1-body.enc'], 'octocat'), ['comment']);
  for (const odd of ['_enc/mystery-x-body.enc', '_enc/post-x.enc', '_enc/post--body.enc', '_enc/nested/post-x-body.enc', '_enc/POST-x-body.enc']) {
    assert.deepEqual(contentTypesTouched([`members/octocat/${odd}`], 'octocat'), ['other'], odd);
    const d = decide({ ...base, paths: [`members/octocat/${odd}`], workerOpened: true });
    assert.equal(d.label, 'rejected-not-creator', `${odd}: an unreadable body file still needs the higher tier`);
  }
});

test('the same content opened by hand is HELD for a superadmin: green, open, never merged, never closed', () => {
  for (const paths of [item('post', 'posts', 'p'), ['members/octocat/projects/y/index.md'], ['members/octocat/products/y/index.md'], ['members/octocat/shares/20260915120000-x.md']]) {
    const d = decide({ ...base, paths });
    assert.equal(d.check, 'pass', paths[0]);
    assert.equal(d.label, 'held-for-review', paths[0]);
    assert.equal(d.autoMerge, false);
    assert.equal(shouldAutoMerge(d, paths), false);
  }
});

test('outside review, nothing is held: comments, a profile, a trusted author, and staff', () => {
  assert.equal(decide({ ...base, paths: ['members/octocat/comments/c.md'] }).label, 'paid');
  assert.equal(decide({ ...base, paths: ['members/octocat/profile.md'] }).label, 'paid');
  assert.equal(decide({ ...base, tier: TIER.creator, paths: ['members/octocat/posts/x/index.md'] }).label, 'paid', 'a trusted author is not reviewed');
  assert.equal(decide({ ...base, role: ROLE.superadmin, paths: ['members/octocat/posts/x/index.md'] }).label, 'superadmin-automerge');
  // a mixed PR is held when any reviewed type is in it
  assert.equal(decide({ ...base, paths: ['members/octocat/comments/c.md', 'members/octocat/posts/x/index.md'] }).label, 'held-for-review');
});

test('the hold is announced once, and parseEvent carries the labels and who opened the PR', () => {
  assert.equal(shouldExplainHold('held-for-review', []), true);
  assert.equal(shouldExplainHold('held-for-review', ['held-for-review']), false, 'a later push does not repeat it');
  assert.equal(shouldExplainHold('paid', []), false);
  assert.match(HOLD_NOTE, /superadmin/);
  assert.doesNotMatch(HOLD_NOTE, /[–—]/);
  const handEvent = { number: 7, pull_request: { user: { id: 555 }, head: { sha: 'h', ref: 'x', repo: { id: 2, owner: { id: 555 } } }, base: { repo: { id: 1 } }, labels: [{ name: 'held-for-review' }] } };
  const hand = parseEvent(handEvent, '999');
  assert.equal(hand.botOpened, false);
  assert.deepEqual(hand.labels, ['held-for-review']);
  const app = parseEvent({ ...handEvent, pull_request: { ...handEvent.pull_request, user: { id: 999 }, labels: undefined } }, '999');
  assert.equal(app.botOpened, true);
  assert.deepEqual(app.labels, []);
});

test('the runnable gate passes who opened the PR through to the decision', async () => {
  // A supporter on the member tier, resolved from a real Stripe-shaped customer and price map, as the gate does.
  const priceTierMap = buildPriceTierMap({ priceTiers: { price_supporter: 'member' } });
  const customer = { id: 'c', metadata: { github_id: '100' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: 'price_supporter' } }] } }] } };
  const args = {
    author: '100', paths: item('post', 'posts', 'x'), priceTierMap, now: new Date('2026-09-15T00:00:00Z'),
    overrides: { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map([['100', 'octocat']]) },
    stripe: { async findCustomerByGithubId() { return customer; } },
  };
  const viaApp = await evaluatePR({ ...args, workerOpened: true });
  assert.equal(viaApp.tier, 'member');
  assert.equal(viaApp.label, 'paid');
  assert.equal((await evaluatePR(args)).label, 'held-for-review', 'the default is the safe one: not opened by the app');
});

test('the agent share tool posts members-only unless a superadmin asks, and no longer makes the agent ask', () => {
  assert.equal(shareVisibilityArg(undefined), 'members');
  assert.equal(shareVisibilityArg(''), 'members');
  assert.equal(shareVisibilityArg('public'), 'public', 'passed through; the Worker refuses it for anyone but a superadmin');
  assert.throws(() => shareVisibilityArg('everyone'), /visibility must be/);
  const tool = TOOLS.find((t) => t.name === 'add_share');
  assert.deepEqual(tool.inputSchema.required, ['url']);
  assert.doesNotMatch(tool.description, /ALWAYS ask the member/);
  // and the composer rule the tool now matches
  assert.equal(canSharePublicly({ membership: 'paid', role: 'member' }), false);
});
