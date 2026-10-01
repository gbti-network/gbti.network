// sow-427 C4: POST /membership/claim (workers/signup/membership-claim.mjs). The claim publishes EXACTLY the stored
// record plus the claimant's own note, as ONE pull request into the claimant's members-index folder, and only when
// the merge gate will see the same membership the Worker sees (trap 2).
//
// Every network edge is faked (test/prepared-claim-fixtures.mjs), but the GitHub-facing helpers the route uses are
// the REAL ones (readContentTree, loadHouseYaml, githubUserById, the members-index read, commitHostedFiles) driven
// through a URL-matching fetch, so these tests exercise the path production takes. The fake records every write, and
// "no writes" below means that record is empty.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { membershipClaimPost } from '../workers/signup/membership-claim.mjs';
import { buildClaimFiles } from '../membership/prepared-claim-files.mjs';
import { inviteKey, inviteState, INVITE_STATE } from '../membership/invites.mjs';
import { listingKey, listingState, LISTING_STATE } from '../membership/prepared-listings.mjs';
import { rateLimit } from '../workers/signup/abuse.mjs';
import {
  NOW, PREPARER, CLAIMANT, STRANGER, MODERATOR, LISTING_ID, CODE, IMG, env, seed, ghFake, pull, as, postReq, claimDeps,
} from './prepared-claim-fixtures.mjs';

const NOTE = 'I built SurfacedBy to find where people talk about my work.';
const commits = (rec) => rec.filter((c) => c.method === 'PUT' || c.method === 'DELETE' || /\/git\/refs/.test(c.url) || /\/pulls$/.test(c.url));
const putPaths = (rec) => rec.filter((c) => c.method === 'PUT').map((c) => decodeURIComponent(c.url.split('/contents/')[1]));
const listingOf = (kv) => kv.json(listingKey(LISTING_ID));
const inviteOf = (kv) => kv.json(inviteKey(CODE));
const dispatches = (rec, type) => rec.filter((c) => /\/dispatches$/.test(c.url) && c.body.event_type === type);

test('claim: one pull request with the project, the note and a basic profile, into the members-index folder', async () => {
  const { kv } = seed();
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec) }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { ok: true, state: 'publishing', number: 77, retryAfterSeconds: 10 });
  assert.equal(r.notify, null, 'nothing is announced until the pull request MERGES');

  const prs = rec.filter((c) => /\/pulls$/.test(c.url));
  assert.equal(prs.length, 1, 'exactly ONE pull request');
  assert.equal(prs[0].body.head, `hosted/${CLAIMANT}/project-surfacedby`, 'the branch carries the VERIFIED account number');
  assert.equal(prs[0].body.base, 'main');
  assert.doesNotMatch(prs[0].body.body, /@sam|We built this page|Claim it any time|CODEABLE/, 'no mention, no message, no code in the pull request');
  const paths = putPaths(rec);
  assert.deepEqual(paths, [
    'members/sam/projects/surfacedby/index.md',
    'members/sam/comments/intro-surfacedby.md',
    'members/sam/profile.md',
    'members/sam/projects/surfacedby/images/icon.png',
    'members/sam/projects/surfacedby/images/cover.webp',
    'members/sam/projects/surfacedby/images/shot-1.png',
  ], 'project, note, profile and images, all under the claimant folder, in one branch');
  for (const c of rec.filter((x) => x.method === 'PUT')) assert.equal(c.body.branch, `hosted/${CLAIMANT}/project-surfacedby`);

  const project = Buffer.from(rec.find((c) => /projects\/surfacedby\/index\.md$/.test(c.url)).body.content, 'base64').toString('utf8');
  assert.match(project, /^author: sam$/m);
  assert.match(project, /^status: published$/m);
  assert.match(project, /^visibility: public$/m);
  assert.match(project, /^publishedAt: /m);
  const note = Buffer.from(rec.find((c) => /intro-surfacedby\.md$/.test(c.url)).body.content, 'base64').toString('utf8');
  assert.match(note, /authorNote: true/);
  assert.match(note, /visibility: public/);
  assert.ok(note.includes(NOTE), 'the note is the claimant words');
  const profile = Buffer.from(rec.find((c) => /profile\.md$/.test(c.url)).body.content, 'base64').toString('utf8');
  assert.match(profile, /displayName: Sam Rivera/, 'the GitHub display name, looked up by the account NUMBER');
  assert.doesNotMatch(profile, /avatar/, 'no avatar: the site draws it from the account number');

  const l = listingOf(kv);
  assert.equal(listingState(l), LISTING_STATE.publishing, 'the listing is locked while the pull request is open');
  assert.equal(l.claimPendingBy, CLAIMANT);
  assert.equal(l.prNumber, 77);
  assert.equal(l.claimPendingFolder, 'sam');
  assert.equal(l.claimPendingLogin, 'Sam-Dev');
  assert.equal(l.claimedAt, null, 'claimedAt is set only after the MERGE');
  const i = inviteOf(kv);
  assert.equal(inviteState(i, NOW), INVITE_STATE.claim_pending, 'the invite cannot grant a year while the claim is open');
  assert.equal(i.claimPr, 77);
});

test('claim: a TAMPERED body is ignored; the committed files equal buildClaimFiles over the STORED record', async () => {
  const { kv, listing } = seed();
  const rec = [];
  const tampered = {
    code: CODE, note: NOTE, slug: 'evil', folder: 'hudson', itemId: 'post-evil', title: 'Evil',
    frontmatter: { title: 'Evil', visibility: 'members' }, body: 'rewritten <script>x</script>',
    files: [{ path: 'house/roles.yml', content: 'superadmins: []' }],
  };
  const r = await membershipClaimPost(postReq(tampered), env(), claimDeps({ kv, fetchImpl: ghFake(rec) }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const expected = buildClaimFiles({ listing, folder: 'sam', note: NOTE, profile: { displayName: 'Sam Rivera' }, images: IMG, now: NOW });
  assert.ok(expected.ok);
  const got = rec.filter((c) => c.method === 'PUT').map((c) => ({ path: decodeURIComponent(c.url.split('/contents/')[1]), content: c.body.content }));
  assert.deepEqual(got, expected.files.map((f) => ({ path: f.path, content: f.contentBase64 ?? Buffer.from(f.content, 'utf8').toString('base64') })));
  assert.ok(!putPaths(rec).some((p) => /evil|roles\.yml|hudson/.test(p)), 'nothing from the body reaches the repository');
  assert.equal(rec.find((c) => /\/pulls$/.test(c.url)).body.head, `hosted/${CLAIMANT}/project-surfacedby`);
});

test('claim: the folder comes from the members index (hudson), never from the login (atwellpub)', async () => {
  const index = `members:\n  "${CLAIMANT}": hudson\n`;
  const { kv } = seed();
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({
    kv, fetchImpl: ghFake(rec, { index, user: { id: Number(CLAIMANT), login: 'atwellpub', name: null, type: 'User' } }),
    resolve: as(CLAIMANT, 'paid', 'stripe', 'atwellpub'),
  }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const paths = putPaths(rec);
  assert.ok(paths.length > 0 && paths.every((p) => p.startsWith('members/hudson/')), paths.join(' '));
  assert.ok(!paths.some((p) => p.includes('atwellpub')));
  const profile = Buffer.from(rec.find((c) => /profile\.md$/.test(c.url)).body.content, 'base64').toString('utf8');
  assert.match(profile, /displayName: atwellpub/, 'no GitHub name: the login heads the profile');
  assert.equal(listingOf(kv).claimPendingFolder, 'hudson');
});

test('claim: an existing profile.md on main means NO profile file in the pull request', async () => {
  const { kv } = seed();
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec, { profile: true }) }));
  assert.equal(r.status, 200);
  assert.ok(!putPaths(rec).some((p) => p.endsWith('profile.md')));
  assert.equal(putPaths(rec).length, 5, 'project, note and three images');
});

test('claim: no members-index entry is 409 folderPending, fires ONE enroll dispatch per window, and writes nothing', async () => {
  const { kv } = seed();
  const rec = [];
  const deps = claimDeps({ kv, fetchImpl: ghFake(rec, { index: 'members:\n' }), limiter: rateLimit });
  const r1 = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), deps);
  const r2 = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), deps);
  for (const r of [r1, r2]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'claim_not_ready');
    assert.equal(r.body.state, 'pending_folder');
    assert.equal(r.body.folderPending, true);
    assert.equal(r.body.grantPending, false);
  }
  assert.equal(dispatches(rec, 'enroll').length, 1, 'the enroll nudge is limited to one per five minutes');
  assert.equal(dispatches(rec, 'enroll')[0].body.client_payload.github_id, CLAIMANT);
  assert.equal(commits(rec).length, 0, 'no branch, file or pull request');
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.prepared);
});

test('claim: a free year the gate cannot see yet (source coupon) is 409 grantPending with ONE regate dispatch', async () => {
  const { kv } = seed({ redeemedBy: CLAIMANT });
  const rec = [];
  const deps = claimDeps({ kv, fetchImpl: ghFake(rec), resolve: as(CLAIMANT, 'paid', 'coupon'), limiter: rateLimit });
  const r1 = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), deps);
  const r2 = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), deps);
  for (const r of [r1, r2]) {
    assert.equal(r.status, 409);
    assert.equal(r.body.error, 'claim_not_ready');
    assert.equal(r.body.state, 'pending_grant');
    assert.equal(r.body.grantPending, true);
  }
  assert.equal(dispatches(rec, 'regate').length, 1, 'one regate per five minutes (it folds the grant AND enrolls)');
  assert.equal(commits(rec).length, 0);
});

test('claim: a bound invitation and a different account is wrong_account with ZERO GitHub writes', async () => {
  const { kv } = seed({ bound: CLAIMANT });
  const rec = [];
  const before = [...kv.puts];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec), resolve: as(STRANGER) }));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'wrong_account');
  assert.equal(commits(rec).length, 0);
  assert.deepEqual(kv.puts.filter((k) => k.startsWith('invite')), before.filter((k) => k.startsWith('invite')), 'no invite or listing write');
  // And the right account claims the same bound invitation.
  const ok = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  assert.equal(ok.status, 200);
});

test('claim: a permalink already taken on the site is 409 with no writes; an empty note is 400', async () => {
  const { kv } = seed();
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec, { treeSlugs: ['surfacedby'] }) }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'slug_taken');
  assert.equal(commits(rec).length, 0);
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.prepared, 'the listing is not locked');
  assert.equal(inviteState(inviteOf(kv), NOW), INVITE_STATE.issued);

  for (const note of ['', '   \n\t ', '\x00\x01', undefined, 42]) {
    const rec2 = [];
    const e = await membershipClaimPost(postReq({ code: CODE, note }), env(), claimDeps({ kv, fetchImpl: ghFake(rec2) }));
    assert.equal(e.status, 400, `note ${JSON.stringify(note)}`);
    assert.equal(e.body.error, 'note_required');
    assert.equal(commits(rec2).length, 0);
  }
});

test('claim: the preparer gets preview_only; a MODERATOR (staff) claims an unbound listing like any member', async () => {
  const { kv } = seed();
  const rec = [];
  const p = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec), resolve: as(PREPARER, 'paid', 'staff', 'atwellpub') }));
  assert.equal(p.status, 403);
  assert.equal(p.body.error, 'preview_only');
  assert.equal(commits(rec).length, 0);

  const rec2 = [];
  const m = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({
    kv, fetchImpl: ghFake(rec2, { user: { id: Number(MODERATOR), login: 'mod-person', name: 'Mo', type: 'User' } }),
    resolve: as(MODERATOR, 'paid', 'staff', 'mod-person'),
  }));
  assert.equal(m.status, 200, JSON.stringify(m.body));
  assert.ok(putPaths(rec2).every((x) => x.startsWith('members/mod-person/')));
});

test('claim: a preparer who is no longer a superadmin voids the approval (inactive, no writes)', async () => {
  const { kv } = seed({ mirrorOpts: { superadmins: [] } });
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec) }));
  assert.equal(r.status, 404);
  assert.equal(r.body.error, 'inactive');
  assert.equal(commits(rec).length, 0);
  const banned = seed({ mirrorOpts: { bans: [PREPARER] } });
  const b = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv: banned.kv, fetchImpl: ghFake([]) }));
  assert.equal(b.body.error, 'inactive', 'a banned preparer too');
});

test('claim: the pull request already exists (422): its number is found by the HEAD BRANCH and recorded', async () => {
  const { kv } = seed();
  const rec = [];
  const gh = ghFake(rec, { prCreate: 422, byBranch: [pull(64)] });
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: gh }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 64);
  assert.deepEqual(gh.headQueries.map((q) => new URL(q).searchParams.get('head')), [`gbti-network:hosted/${CLAIMANT}/project-surfacedby`]);
  assert.equal(new URL(gh.headQueries[0]).searchParams.get('state'), 'all');
  assert.equal(listingOf(kv).prNumber, 64);
  assert.equal(inviteOf(kv).claimPr, 64);
});

test('claim: while the pull request is OPEN the lock holds: nobody else claims, and the claimant cannot publish twice', async () => {
  const { kv } = seed();
  await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  const pulls = new Map([[77, pull(77)]]);

  const rec = [];
  const other = await membershipClaimPost(postReq({ code: CODE, note: 'mine now' }), env(), claimDeps({
    kv, fetchImpl: ghFake(rec, { pulls }), resolve: as(STRANGER),
    now: new Date(NOW.getTime() + 48 * 3600e3), // long after any timeout: an open pull request has no expiry
  }));
  assert.equal(other.status, 404);
  assert.equal(other.body.error, 'inactive');
  assert.equal(commits(rec).length, 0);

  const rec2 = [];
  const again = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec2, { pulls }) }));
  assert.equal(again.status, 409);
  assert.equal(again.body.error, 'publishing');
  assert.equal(commits(rec2).length, 0);
  assert.equal(listingOf(kv).claimPendingBy, CLAIMANT);
});

test('claim: a failed commit releases the lock and the pending claim, so the person can try again', async () => {
  const { kv } = seed();
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake([], { prCreate: 500 }) }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'open_pr_failed');
  const l = listingOf(kv);
  assert.equal(listingState(l), LISTING_STATE.prepared);
  assert.ok(!('claimPendingFolder' in l) && !('claimPendingLogin' in l), 'the lock-time details go with the lock');
  assert.equal(inviteState(inviteOf(kv), NOW), INVITE_STATE.issued);
  const retry = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake([]) }));
  assert.equal(retry.status, 200);
});

test('claim: refusals for a not-paying, banned, disabled or anonymous caller, and an unknown code', async () => {
  const { kv } = seed();
  const refuse = async (deps, body = { code: CODE, note: NOTE }, e = env()) => membershipClaimPost(postReq(body), e, claimDeps({ kv, fetchImpl: ghFake([]), ...deps }));
  assert.equal((await refuse({ resolve: as(CLAIMANT, 'banned', 'ban') })).body.error, 'not_permitted');
  const notPaying = await refuse({ resolve: as(CLAIMANT, 'none', 'stripe') });
  assert.equal(notPaying.status, 403);
  assert.match(notPaying.body.error, /^(redeem|year_used|year_unavailable)$/);
  assert.equal((await refuse({ resolve: async () => ({ ok: false, status: 401, body: { error: 'unauthorized' } }) })).status, 401);
  assert.equal((await refuse({}, { code: 'NOPE0000', note: NOTE })).body.error, 'inactive');
  assert.equal((await refuse({}, { code: 'lower-case!', note: NOTE })).body.error, 'inactive');
  const off = await refuse({}, { code: CODE, note: NOTE }, env({ MEMBERSHIP_AUTHOR_ENABLED: 'false' }));
  assert.equal(off.status, 403);
  assert.equal(off.body.error, 'author_disabled');
  const limited = await refuse({ limiter: async () => ({ allowed: false }) });
  assert.equal(limited.status, 429);
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.prepared, 'none of them locked anything');
});

test('claim: a category that left the taxonomy stops the claim before anything is written', async () => {
  const { kv } = seed({ listingOver: { frontmatter: { ...seed().listing.frontmatter, categories: ['blockchain'] } } });
  const rec = [];
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: ghFake(rec) }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'listing_invalid');
  assert.equal(commits(rec).length, 0);
});

test('claim: a request to GitHub that THROWS mid-commit keeps the lock (a pull request may exist) and answers 502', async () => {
  const { kv } = seed();
  const base = ghFake([]);
  const flaky = async (url, init = {}) => {
    if (/\/pulls$/.test(String(url)) && init.method === 'POST') throw new Error('network');
    return base(url, init);
  };
  const r = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv, fetchImpl: flaky }));
  assert.equal(r.status, 502);
  assert.equal(r.body.error, 'git_failed');
  assert.equal(listingState(listingOf(kv)), LISTING_STATE.publishing, 'held until finalize learns what GitHub did');
  const idxDown = seed();
  const thrown = async (url, init = {}) => {
    if (/members-index\.yml/.test(String(url))) throw new Error('network');
    return base(url, init);
  };
  const s = await membershipClaimPost(postReq({ code: CODE, note: NOTE }), env(), claimDeps({ kv: idxDown.kv, fetchImpl: thrown }));
  assert.equal(s.status, 502);
  assert.equal(s.body.error, 'index_unavailable');
});
