// sow-323 Phase 3: the merge gate's half of editorial review (membership/classify-pr.mjs decide, scripts/pr-gate.mjs).
//
// Two things, and the first was a live defect. A members-only publish commits its encrypted body beside the item
// as `_enc/<type>-<slug>-body.enc`. The gate typed that file as unclassifiable, which requires the higher tier,
// so it CLOSED every ordinary supporter's members-only article and comment: the only way the one-plan change let
// them publish at all. Nobody met it because every members-only item so far was a superadmin's. These cases use
// the file names the client really writes (encAssetFor), not a shortened fixture, because the shortened fixture
// in pr-gate.test.mjs (`_enc/hello-body.enc`) is exactly the shape that hid it.
//
// The second WAS the side door: a PR GBTI's publishing app did not open was held (`held-for-review`) for a
// superadmin. The owner retired editorial review on 2026-10-16, so that hold is gone. A paid member's own-folder
// content merges whoever opened the PR; the cases below pin that, and pin that every OTHER gate rule survived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decide, contentTypesTouched } from '../membership/classify-pr.mjs';
import { ROLE } from '../membership/overrides-core.mjs';
import { TIER } from '../membership/tiers.mjs';
import { encAssetFor } from '../client/src/member-content.mjs';
import * as gate from '../scripts/pr-gate.mjs';
import { parseEvent, shouldAutoMerge, evaluatePR } from '../scripts/pr-gate.mjs';
import { buildPriceTierMap } from '../membership/tiers.mjs';
import { TOOLS, shareVisibilityArg } from '../client/src/mcp-tools.mjs';
import { canSharePublicly } from '../client-ui/src/share-post-core.mjs';

const PAID = { status: 'paid' };
const base = { role: ROLE.member, effective: PAID, ownedFolder: 'octocat', tier: TIER.member };
const item = (type, dir, slug) => [`members/octocat/${dir}/${slug}/index.md`, encAssetFor(type, 'octocat', slug).path];

test('a supporter\'s members-only article, project and prompt, each with its real body file, pass and auto-merge', () => {
  for (const [type, dir] of [['post', 'posts'], ['project', 'projects'], ['prompt', 'prompts']]) {
    const paths = item(type, dir, 'a-members-piece');
    const d = decide({ ...base, paths });
    assert.equal(d.check, 'pass', `${type}: ${d.reasons[0]}`);
    assert.equal(d.label, 'paid');
    assert.equal(d.autoMerge, true);
    assert.equal(shouldAutoMerge(d, paths), true, `${type}: and the actuator agrees`);
  }
});

test('a supporter\'s members-only comment and share, with their body files, pass', () => {
  const comment = ['members/octocat/comments/c-1.md', encAssetFor('comment', 'octocat', 'c-1').path];
  assert.equal(decide({ ...base, paths: comment }).label, 'paid');
  const share = ['members/octocat/shares/20260915120000-x.md', encAssetFor('share', 'octocat', '20260915120000-x').path];
  assert.equal(decide({ ...base, paths: share }).label, 'paid');
});

test('the body file is typed by the name it declares, and a name the gate cannot read still fails closed', () => {
  assert.deepEqual(contentTypesTouched(['members/octocat/_enc/post-hello-body.enc'], 'octocat'), ['post']);
  assert.deepEqual(contentTypesTouched(['members/octocat/_enc/comment-c-1-body.enc'], 'octocat'), ['comment']);
  for (const odd of ['_enc/mystery-x-body.enc', '_enc/post-x.enc', '_enc/post--body.enc', '_enc/nested/post-x-body.enc', '_enc/POST-x-body.enc']) {
    assert.deepEqual(contentTypesTouched([`members/octocat/${odd}`], 'octocat'), ['other'], odd);
    const d = decide({ ...base, paths: [`members/octocat/${odd}`] });
    assert.equal(d.label, 'rejected-not-creator', `${odd}: an unreadable body file still needs the higher tier`);
  }
});

test('2026-10-16: the same content opened by hand is NOT held: it passes and auto-merges like any own-folder content', () => {
  // These are the exact shapes the retired `held-for-review` branch used to catch: a member-tier supporter's
  // post (with its real body file), project, retired-products project, prompt and share, opened by hand.
  const shapes = [
    item('post', 'posts', 'p'),
    ['members/octocat/projects/y/index.md'],
    ['members/octocat/products/y/index.md'],
    item('prompt', 'prompts', 'z'),
    ['members/octocat/shares/20260915120000-x.md'],
  ];
  for (const paths of shapes) {
    const d = decide({ ...base, paths });
    assert.equal(d.check, 'pass', paths[0]);
    assert.equal(d.label, 'paid', `${paths[0]}: no held-for-review label`);
    assert.equal(d.autoMerge, true, paths[0]);
    assert.equal(shouldAutoMerge(d, paths), true, `${paths[0]}: and the actuator agrees`);
  }
});

test('comments, a profile, a trusted author, staff and a mixed own-folder PR all pass as before', () => {
  assert.equal(decide({ ...base, paths: ['members/octocat/comments/c.md'] }).label, 'paid');
  assert.equal(decide({ ...base, paths: ['members/octocat/profile.md'] }).label, 'paid');
  assert.equal(decide({ ...base, tier: TIER.creator, paths: ['members/octocat/posts/x/index.md'] }).label, 'paid', 'a trusted author is not reviewed');
  assert.equal(decide({ ...base, role: ROLE.superadmin, paths: ['members/octocat/posts/x/index.md'] }).label, 'superadmin-automerge');
  // a mixed own-folder PR (a comment and an article) used to be held because an article was in it; now it merges
  const mixed = decide({ ...base, paths: ['members/octocat/comments/c.md', 'members/octocat/posts/x/index.md'] });
  assert.equal(mixed.label, 'paid');
  assert.equal(mixed.autoMerge, true);
});

test('retiring the hold widened nothing else: trial, non-member, another member\'s folder and protected paths', () => {
  const post = ['members/octocat/posts/x/index.md'];
  // publishing is still paid-only, and a non-member is still refused before anything else
  assert.equal(decide({ ...base, effective: { status: 'trialing' }, paths: post }).label, 'rejected-not-paid');
  assert.equal(decide({ ...base, effective: { status: 'trialing' }, paths: post }).autoMerge, false);
  assert.equal(decide({ ...base, effective: { status: 'expired' }, paths: post }).label, 'rejected-not-a-member');
  // a change to ANOTHER member's folder is still the contribution hold, never an auto-merge
  const other = ['members/someoneelse/posts/x/index.md'];
  const contribution = decide({ ...base, paths: other });
  assert.equal(contribution.check, 'fail');
  assert.equal(contribution.label, 'contribution-pending-owner');
  assert.equal(shouldAutoMerge(contribution, other), false);
  // own folder mixed with another member's folder, or with house/** or Tier S, is still an escalation
  assert.equal(decide({ ...base, paths: [...post, ...other] }).label, 'rejected-escalation');
  assert.equal(decide({ ...base, paths: [...post, 'house/taxonomy.yml'] }).label, 'rejected-escalation');
  assert.equal(decide({ ...base, paths: [...post, 'house/roles.yml'] }).label, 'rejected-escalation');
  assert.equal(decide({ ...base, paths: [...post, '.github/workflows/x.yml'] }).label, 'rejected-escalation');
});

test('the hold note is gone, and parseEvent still reports who opened the PR without carrying labels', () => {
  assert.equal('shouldExplainHold' in gate, false, 'the hold comment helper was removed');
  assert.equal('HOLD_NOTE' in gate, false, 'the hold comment text was removed');
  const handEvent = { number: 7, pull_request: { user: { id: 555 }, head: { sha: 'h', ref: 'x', repo: { id: 2, owner: { id: 555 } } }, base: { repo: { id: 1 } }, labels: [{ name: 'held-for-review' }] } };
  const hand = parseEvent(handEvent, '999');
  assert.equal(hand.botOpened, false);
  assert.equal(hand.author, 555);
  assert.equal('labels' in hand, false, 'labels were read only to post the hold note once');
  const app = parseEvent({ ...handEvent, pull_request: { ...handEvent.pull_request, user: { id: 999 } } }, '999');
  assert.equal(app.botOpened, true);
});

test('the runnable gate gives a hand-opened supporter PR the same verdict an app-opened one gets', async () => {
  // A supporter on the member tier, resolved from a real Stripe-shaped customer and price map, as the gate does.
  const priceTierMap = buildPriceTierMap({ priceTiers: { price_supporter: 'member' } });
  const customer = { id: 'c', metadata: { github_id: '100' }, subscriptions: { data: [{ status: 'active', created: 1, items: { data: [{ price: { id: 'price_supporter' } }] } }] } };
  const args = {
    author: '100', paths: item('post', 'posts', 'x'), priceTierMap, now: new Date('2026-09-15T00:00:00Z'),
    overrides: { roles: new Map(), bans: new Map(), grandfathers: new Map(), membersIndex: new Map([['100', 'octocat']]) },
    stripe: { async findCustomerByGithubId() { return customer; } },
  };
  const d = await evaluatePR(args);
  assert.equal(d.tier, 'member');
  assert.equal(d.label, 'paid', 'no held-for-review: who opened the PR no longer matters');
  assert.equal(d.autoMerge, true);
  assert.equal(shouldAutoMerge(d, args.paths), true);
});

test('sow-458: the agent share tool posts public unless the member asks for members only, and does not make the agent ask', () => {
  assert.equal(shareVisibilityArg(undefined), 'public');
  assert.equal(shareVisibilityArg(''), 'public');
  assert.equal(shareVisibilityArg('members'), 'members');
  assert.throws(() => shareVisibilityArg('everyone'), /visibility must be/);
  const tool = TOOLS.find((t) => t.name === 'add_share');
  assert.deepEqual(tool.inputSchema.required, ['url']);
  assert.doesNotMatch(tool.description, /ALWAYS ask the member|only a superadmin/);
  // and the composer rule the tool now matches: a paying member may choose Public
  assert.equal(canSharePublicly({ membership: 'paid', role: 'member' }), true);
});
