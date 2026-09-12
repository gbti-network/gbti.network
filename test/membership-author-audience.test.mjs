// sow-323: the AUDIENCE rule on the hosted author route. Publishing is open to any paid supporter now; what a
// superadmin controls is whether an item may be PUBLIC. Every case here drives the real membershipAuthor, because
// the rule spans a pure path-and-frontmatter read (pathsNeedingApproval) and a read of main (approvedOnMain), and
// a unit test of either half alone is what let the encrypt-gate defect live for nine days.
//
// This file replaces the sow-304 share-edit suite. The six-hour share slow mode it exercised was removed by the
// owner on 2026-09-12 (editorial approval is the stronger brake), and isShareEdit's main-reading machinery became
// approvedOnMain rather than being deleted. The one pin carried over verbatim in spirit is the LAST test: the
// trusted-author waiver must resolve to REFUSED for an unresolvable tier, because an exemption is exactly where a
// fail-open hides.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { membershipAuthor, approvedOnMain } from '../workers/signup/membership-author.mjs';
import { pathsNeedingApproval, statedVisibility } from '../membership/hosted-author.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const fakeKv = () => { const m = new Map(); return { async get(k, t) { const v = m.get(k); return (t === 'json' || t?.type === 'json') && typeof v === 'string' ? JSON.parse(v) : v ?? null; }, async put(k, v) { m.set(k, v); }, async delete(k) { m.delete(k); } }; };
const signJwt = async () => 'fake.jwt.sig';
const memberOk = async () => ({ ok: true, githubId: '2002207', tier: 'member' });
const creatorOk = async () => ({ ok: true, githubId: '2002207', tier: 'creator' });
const userMe = async () => ({ githubLogin: 'atwellpub', githubId: '2002207' });
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const INDEX_YML = 'members:\n  "2002207": atwellpub\n';
const ID = '20260901120000-a-members-share';
const stub = { path: `members/atwellpub/shares/${ID}.md`, content: `---\ntype: share\nid: ${ID}\nauthor: atwellpub\nstatus: published\nvisibility: members\nencryptedBody: members/atwellpub/_enc/share-${ID}-body.enc\ncreatedAt: 2026-09-01T12:00:00.000Z\n---\n` };
const enc = { path: `members/atwellpub/_enc/share-${ID}-body.enc`, content: '{"v":1,"kid":"1","iv":"AAAA","aad":"a","ct":"AAAA"}' };
const body = { itemId: `share-${ID}`, title: 'Update Share', files: [stub, enc] };

/** A GitHub fake for the whole hosted flow; `existing` lists share paths that already live on main. */
function ghFetch(existing = [], { contentsThrow = false } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64(INDEX_YML) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return {}; } };
    if (/\/git\/refs\/heads\//.test(url) && method === 'PATCH') return { ok: true, status: 200, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'GET') {
      if (contentsThrow) throw new Error('network down');
      const p = decodeURIComponent(url.split('/contents/')[1].split('?')[0]);
      // sow-323: approvedOnMain reads the RAW text to see the audience, so the fake answers text() too. What it
      // returns is driven by `existing`: a path listed there is PUBLIC on main (already approved).
      const raw = `---\ntype: share\nvisibility: public\n---\nb`;
      return existing.includes(p)
        ? { ok: true, status: 200, async json() { return { sha: 'oldsha', content: b64(raw) }; }, async text() { return raw; } }
        : { ok: false, status: 404, async json() { return {}; }, async text() { return ''; } };
    }
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) return { ok: true, status: 201, async json() { return {}; } };
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 42, html_url: 'https://github.com/gbti-network/gbti.network/pull/42' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
}

const PUB_ID = '20260901120000-a-public-share';
const pubStub = { path: `members/atwellpub/shares/${PUB_ID}.md`, content: `---\ntype: share\nid: ${PUB_ID}\nauthor: atwellpub\nstatus: published\nvisibility: public\n---\nA link worth reading.\n` };
const pubBody = { itemId: `share-${PUB_ID}`, title: 'A public share', files: [pubStub] };
const run = (b, authorize, gh) => membershipAuthor(req(b), env, { fetchImpl: gh, fetchUser: userMe, authorize, kv: fakeKv(), signJwt });

test('pathsNeedingApproval is the pure half: members-only passes, public and silence and unreadable do not', () => {
  assert.deepEqual(pathsNeedingApproval([stub, enc], 'atwellpub'), [], 'a members share needs no approval');
  assert.equal(pathsNeedingApproval([pubStub], 'atwellpub').length, 1, 'a public share does');
  const silent = { path: 'members/atwellpub/posts/p/index.md', content: '---\ntitle: T\n---\nbody' };
  assert.equal(pathsNeedingApproval([silent], 'atwellpub').length, 1, 'an ABSENT visibility is public (the schema default) and must be refused');
  const binary = { path: 'members/atwellpub/posts/p/index.md', contentBase64: 'AAAA' };
  assert.equal(pathsNeedingApproval([binary], 'atwellpub').length, 1, 'unreadable is not a licence to assume members-only');
  assert.equal(statedVisibility(undefined), null, 'and the reader says so rather than guessing');
});

test('comments and profiles never reach the audience rule', () => {
  const comment = { path: 'members/atwellpub/comments/c.md', content: '---\nvisibility: public\n---\nhi' };
  const profile = { path: 'members/atwellpub/profile.md', content: '---\nvisibility: public\n---\nbio' };
  assert.deepEqual(pathsNeedingApproval([comment, profile], 'atwellpub'), [],
    'a public comment and a public profile are outside editorial review by the owner decision of 2026-09-12');
});

test('a paid supporter publishes a MEMBERS-ONLY item with no approval and no creator tier', async () => {
  const r = await run(body, memberOk, ghFetch([]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 42);
});

test('the same supporter publishing a PUBLIC item is refused for review, not for payment', async () => {
  const r = await run(pubBody, memberOk, ghFetch([]));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'review_required', 'the error must name review, not membership: the old message told a paying member to pay');
  assert.match(r.body.message, /approved by a superadmin after editorial review/);
});

test('an item ALREADY public on main stays publishable by its author, so a typo fix cannot take the page down', async () => {
  const r = await run(pubBody, memberOk, ghFetch([pubStub.path]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('a trusted author (the silently granted creator tier) publishes public directly', async () => {
  const r = await run(pubBody, creatorOk, ghFetch([]));
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('the main read FAILS CLOSED: a thrown contents fetch refuses rather than admits', async () => {
  const r = await run(pubBody, memberOk, ghFetch([pubStub.path], { contentsThrow: true }));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'review_required');
});

test('approvedOnMain answers false for an empty list, a 404, and a members-only file on main', async () => {
  const base = { instToken: 't', upstream: 'o/r' };
  assert.equal(await approvedOnMain({ ...base, fetchImpl: ghFetch([pubStub.path]), paths: [] }), false, 'nothing to check is not approval');
  assert.equal(await approvedOnMain({ ...base, fetchImpl: ghFetch([]), paths: ['members/atwellpub/shares/x.md'] }), false, 'absent is not approved');
  const membersOnMain = async () => ({ ok: true, status: 200, async text() { return '---\nvisibility: members\n---\nb'; } });
  assert.equal(await approvedOnMain({ ...base, fetchImpl: membersOnMain, paths: ['members/atwellpub/shares/x.md'] }), false,
    'existing is not enough: the file on main has to SAY public');
  // and the positive control, so the three negatives above are not all passing for the same wrong reason
  assert.equal(await approvedOnMain({ ...base, fetchImpl: ghFetch([pubStub.path]), paths: [pubStub.path] }), true);
});

test('the trusted-author waiver resolves the safe way when the tier is unknown', async () => {
  // Carried over from the sow-293 slow-mode suite, re-pointed at the waiver that replaced it. The route guards
  // with `!meetsTier(paid.tier, TIER.creator)`, and the whole safety of the waiver rests on an unresolvable tier
  // landing on REFUSED rather than WAIVED. It is a default, and defaults get refactored, so it is pinned.
  const { meetsTier, TIER } = await import('../membership/tiers.mjs');
  const needsApproval = (tier) => !meetsTier(tier, TIER.creator);
  assert.equal(needsApproval('creator'), false, 'a trusted author is waived');
  assert.equal(needsApproval('member'), true, 'an ordinary supporter is reviewed');
  for (const unknown of [null, undefined, '', 'none', 'nonsense', 0, false, {}]) {
    assert.equal(needsApproval(unknown), true,
      `an unresolvable tier (${JSON.stringify(unknown)}) must be REVIEWED, not waived: the waiver must never be the fail-open`);
  }
});
