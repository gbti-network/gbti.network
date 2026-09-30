// sow-428: a member's GBTI name is their FOLDER (members/<folder>/), from the members index, and it can differ from
// their GitHub login. Owner, 2026-09-30: "lets give him a gbti name, drop the 666 create the member index layer"
// (a new member's login was loraxian666; his folder is mike-conley). Then: "We can use blobatar library for anyone
// who does not have a linked avatar."
//
// The fixtures use that real case: github_id 113307118, login loraxian666, folder mike-conley. Both `mike-conley`
// and `loraxian` are unrelated accounts on GitHub, which is why nothing here may look a member up by name there.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { readMembersIndexCached, memberFolderFor, githubIdForFolder, resetMemberFolderCache, MEMBERS_INDEX_TTL_MS } from '../workers/signup/member-folder.mjs';
import { membershipStatus } from '../workers/signup/membership-status.mjs';
import { listMyShares } from '../workers/signup/membership-shares.mjs';
import { membershipAuthor } from '../workers/signup/membership-author.mjs';
import { memberSignalFromStatus } from '../src/lib/member-signal-core.mjs';
import { canEditItem, isOwnProfile } from '../src/lib/content-edit.mjs';
import { fetchStripeStatus, resolveMembership } from '../client/src/membership.mjs';
import { confirmDeviceLogin } from '../client/src/mcp-auth.mjs';
import { memberAvatarUrl, idAvatarUrl, memberAvatarRedirects, NETWORK_AVATAR } from '../membership/member-avatar.mjs';
import { memberBlob, memberBlobSvg } from '../membership/member-blob.mjs';
import { blobSrc, blobSeeds } from '../src/lib/blob-seeds.mjs';
import { avatarLayers, attachAvatarFallback } from '../client-ui/src/member-avatars.mjs';
import { composeRedirects, avatarRows } from '../scripts/compose-redirects.mjs';
import { parseMembersIndex } from '../membership/hosted-author.mjs';
import { freshIndexAdditions, syncEnrollments } from '../scripts/lib/enroll-members.mjs';

const ID = '113307118';
const INDEX = `members:\n  "2002207": atwellpub\n  "${ID}": mike-conley\n`;
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// A GitHub contents fake for the members index; counts the reads.
function indexFetch(text = INDEX, { fail = false } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    if (fail) return { ok: false, status: 502, async json() { return {}; } };
    return { ok: true, status: 200, async json() { return { content: b64(text) }; } };
  };
  return { calls, fetchImpl };
}
const getToken = async () => 'ghs_test';

// ---- the Worker's folder lookup ----

test('the caller\'s folder comes from the members index by account number, not from the login', async () => {
  resetMemberFolderCache();
  const { fetchImpl } = indexFetch();
  assert.equal(await memberFolderFor({}, ID, 'loraxian666', { fetchImpl, getToken }), 'mike-conley');
  assert.equal(await githubIdForFolder({}, 'mike-conley', { fetchImpl, getToken }), ID);
  assert.equal(await githubIdForFolder({}, 'loraxian666', { fetchImpl, getToken }), null, 'the login is not a folder');
});

test('a member with no index entry, or an unreadable index, falls back to the lowercased login', async () => {
  resetMemberFolderCache();
  const ok = indexFetch();
  assert.equal(await memberFolderFor({}, '42', 'NewMember', { fetchImpl: ok.fetchImpl, getToken }), 'newmember');
  resetMemberFolderCache();
  const down = indexFetch(INDEX, { fail: true });
  assert.equal(await memberFolderFor({}, ID, 'loraxian666', { fetchImpl: down.fetchImpl, getToken }), 'loraxian666');
  resetMemberFolderCache();
  const empty = indexFetch('members:\n');
  await assert.rejects(readMembersIndexCached({}, { fetchImpl: empty.fetchImpl, getToken }), /parsed empty/, 'an empty parse is a failed read');
});

test('the index is read once per five minutes, and an old copy beats no copy when GitHub fails', async () => {
  resetMemberFolderCache();
  let t = 1_000_000;
  const now = () => t;
  const ok = indexFetch();
  await readMembersIndexCached({}, { fetchImpl: ok.fetchImpl, getToken, now });
  await readMembersIndexCached({}, { fetchImpl: ok.fetchImpl, getToken, now });
  assert.equal(ok.calls.length, 1, 'the second read inside the window is cached');
  t += MEMBERS_INDEX_TTL_MS + 1;
  const down = indexFetch(INDEX, { fail: true });
  const map = await readMembersIndexCached({}, { fetchImpl: down.fetchImpl, getToken, now });
  assert.equal(down.calls.length, 1, 'past the window it tries again');
  assert.equal(map.get(ID), 'mike-conley', 'and keeps the old copy when the read fails');
});

test('/membership/status returns the folder beside the login', async () => {
  const r = await membershipStatus({ headers: { get: (k) => (k.toLowerCase() === 'authorization' ? 'Bearer good' : null) }, url: 'https://s/membership/status' }, { STRIPE_SECRET_KEY: 'rk' }, {
    fetchUser: async () => ({ githubId: ID, githubLogin: 'loraxian666' }),
    makeStripe: () => ({ findCustomerByGithubId: async () => null }),
    folderFor: async (_env, id, login) => (id === ID ? 'mike-conley' : login),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.login, 'loraxian666');
  assert.equal(r.body.folder, 'mike-conley');
});

test('"my shares" lists the folder, never the login', async () => {
  const urls = [];
  const fetchImpl = async (url, init = {}) => {
    urls.push(`${url} ${init.body || ''}`);
    if (/graphql/.test(String(url))) return { ok: false, status: 500, async json() { return {}; } };
    return { ok: false, status: 404, async json() { return {}; } };
  };
  const r = await listMyShares({ headers: { get: () => null } }, {}, {
    authorize: async () => ({ ok: true, githubId: ID, login: 'loraxian666' }),
    folderFor: async () => 'mike-conley',
    fetchImpl, getToken, kv: {},
  });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.items, []);
  assert.ok(urls.some((u) => u.includes('members/mike-conley/shares')), 'the folder was listed');
  assert.ok(!urls.some((u) => u.includes('loraxian666')), 'the login never was');
});

test('a hosted publish for a renamed member lands in their folder, and the pull request pings nobody', async () => {
  const rec = [];
  const fetchImpl = async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64(INDEX) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (method !== 'GET') { rec.push({ method, url, body: JSON.parse(init.body || '{}') }); }
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 7, html_url: 'https://github.com/x/pull/7' }; } };
    if (/\/contents\//.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    return { ok: true, status: 201, async json() { return {}; } };
  };
  const kvStore = new Map();
  const kv = { async get(k) { return kvStore.get(k) ?? null; }, async put(k, v) { kvStore.set(k, v); }, async delete(k) { kvStore.delete(k); } };
  const env = { GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
  const body = { itemId: 'hello', title: 'Hello', files: [{ path: 'members/mike-conley/posts/hello/index.md', content: '---\ntitle: Hello\n---\nhi' }] };
  const r = await membershipAuthor({ headers: { get: () => 'Bearer tok' }, json: async () => body }, env, {
    kv, fetchImpl, signJwt: async () => 'jwt', limiter: async () => ({ allowed: true }),
    authorize: async () => ({ ok: true, githubId: ID, tier: 'creator' }),
    fetchUser: async () => ({ githubLogin: 'loraxian666', githubId: ID }),
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const pr = rec.find((c) => /\/pulls$/.test(c.url));
  assert.match(pr.body.body, /on behalf of mike-conley \(github_id 113307118\)/);
  assert.doesNotMatch(pr.body.body, /@/, 'no @mention: a GBTI name can be a stranger\'s GitHub account');
});

// ---- every client learns the folder ----

test('the website signal names the folder as the username, and keeps the login', () => {
  const s = memberSignalFromStatus({ ok: true, github_id: ID, login: 'loraxian666', folder: 'mike-conley', status: 'paid' });
  assert.equal(s.username, 'mike-conley');
  assert.equal(s.login, 'loraxian666');
  const old = memberSignalFromStatus({ ok: true, github_id: '1', login: 'Alice', status: 'paid' });
  assert.equal(old.username, 'alice', 'an older Worker with no folder: the lowercased login');
  const bad = memberSignalFromStatus({ ok: true, github_id: '1', login: 'alice', folder: '../house', status: 'paid' });
  assert.equal(bad.username, 'alice', 'a malformed folder is ignored');
});

test('ownership on the website is by folder', () => {
  const me = { login: 'loraxian666', username: 'mike-conley', role: 'member' };
  assert.equal(canEditItem(me, 'mike-conley'), true);
  assert.equal(canEditItem(me, 'loraxian666'), false, 'the login owns nothing');
  assert.equal(canEditItem({ login: 'alice' }, 'alice'), true, 'an identity with no username still works by login');
  assert.equal(isOwnProfile(me, 'mike-conley'), true);
});

test('the extension, command-line and agent hosts read the folder from the status', async () => {
  const oracle = (body) => async () => ({ ok: true, json: async () => body });
  assert.equal((await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: oracle({ status: 'paid', folder: 'mike-conley' }) })).folder, 'mike-conley');
  assert.equal((await fetchStripeStatus({ token: 't', signupBase: 'https://s', fetch: oracle({ status: 'paid', folder: 'Not A Folder' }) })).folder, null);
  assert.equal((await resolveMembership({ githubId: ID, token: 't', signupBase: 'https://s', fetch: oracle({ status: 'paid', effectiveStatus: 'paid', folder: 'mike-conley' }) })).folder, 'mike-conley');
});

test('agent-tool sign-in: the local index wins, then the Worker\'s folder, then the login', async () => {
  const store = (seed = {}) => { const m = new Map(Object.entries(seed)); return { get: (k) => m.get(k) ?? null, set: (p) => { for (const [k, v] of Object.entries(p)) m.set(k, v); } }; };
  const run = async (readFile, folder) => {
    const s = store({ pendingDeviceLogin: { deviceCode: 'D', clientId: 'c' } });
    const r = await confirmDeviceLogin({ store: s }, {
      pollToken: async () => ({ access_token: 'tok' }),
      makeRepoClient: () => ({ getAuthUser: async () => ({ login: 'loraxian666', id: Number(ID) }) }),
      resolveMembershipImpl: async () => ({ stripeStatus: 'paid', membership: 'paid', folder }),
      fetchStatusImpl: async () => ({ status: 'paid', folder }),
      readFile,
    });
    return [r.username, s.get('identity').username];
  };
  const clone = (idx) => (p) => (p === 'house/roles.yml' ? 'roles: {}\n' : p === 'house/members-index.yml' ? idx : null);
  assert.deepEqual(await run(null, 'mike-conley'), ['mike-conley', 'mike-conley'], 'no clone: the Worker names the folder');
  assert.deepEqual(await run(clone('members: {}\n'), 'mike-conley'), ['mike-conley', 'mike-conley'], 'a clone that does not know them yet');
  assert.deepEqual(await run(clone(`members:\n  "${ID}": from-clone\n`), 'mike-conley'), ['from-clone', 'from-clone'], 'a clone\'s index wins');
  assert.deepEqual(await run(null, null), ['loraxian666', 'loraxian666'], 'nothing answers: the lowercased login');
});

test('the extension stores the folder at sign-in and whenever membership is resolved', () => {
  const bg = read('extension/src/background.mjs');
  assert.match(bg, /if \(folder\) store\.set\(\{ identity: \{ login: u\.login, githubId: String\(u\.id\), username: folder \} \}\);/);
  const ctx = read('extension/src/ext-context.mjs');
  assert.match(ctx, /if \(folder && cur && cur\.githubId === id\.githubId && cur\.username !== folder\) store\.set\(\{ identity: \{ \.\.\.cur, username: folder \} \}\);/);
});

// ---- avatars ----

test('a member avatar is addressed by folder and served by account number', () => {
  assert.equal(memberAvatarUrl('Mike-Conley'), 'https://gbti.network/avatar/mike-conley');
  assert.equal(memberAvatarUrl('mike-conley', { site: '' }), '/avatar/mike-conley');
  assert.equal(memberAvatarUrl('../etc'), '');
  assert.equal(idAvatarUrl(ID), `https://avatars.githubusercontent.com/u/${ID}?s=128&v=4`);
  assert.equal(idAvatarUrl('mike-conley'), '', 'only a number');
  const rows = memberAvatarRedirects(parseMembersIndex(INDEX));
  assert.deepEqual(rows.find((r) => r[0] === '/avatar/mike-conley'), ['/avatar/mike-conley', idAvatarUrl(ID), 302]);
  assert.deepEqual(rows.find((r) => r[0] === '/avatar/gbti'), ['/avatar/gbti', NETWORK_AVATAR, 302]);
  assert.ok(!rows.some((r) => /github\.com\//.test(r[1])), 'no row looks an account up by name');
  assert.ok(rows.every((r) => r[2] === 302), 'never a permanent redirect');
});

test('the build writes one avatar row per enrolled member, and refuses an empty index', () => {
  const real = avatarRows(new URL('..', import.meta.url).pathname);
  const index = parseMembersIndex(read('house/members-index.yml'));
  assert.ok(real.length >= index.size, `${real.length} rows for ${index.size} members`);
  const { text } = composeRedirects('# base\n/old /new/ 301\n', [], [], [['/avatar/mike-conley', idAvatarUrl(ID), 302], ['/old', 'https://x', 302]]);
  assert.match(text, /^\/avatar\/mike-conley https:\/\/avatars\.githubusercontent\.com\/u\/113307118\?s=128&v=4 302$/m);
  assert.doesNotMatch(text, /^\/old https:\/\/x/m, 'a path the committed file claims keeps its rule');
});

test('the blobatar is the same creature for the same name, a different one for another, and costs no request', () => {
  const a = memberBlob('mike-conley');
  assert.match(a, /^data:image\/svg\+xml,/);
  assert.equal(memberBlob('mike-conley'), a);
  assert.equal(memberBlob('  Mike-Conley '), a, 'blobatar trims and lowercases');
  assert.notEqual(memberBlob('atwellpub'), a);
  assert.match(memberBlob(''), /^data:image\/svg\+xml,/, 'an empty name still draws something');
});

test('the site serves one blobatar file per known member, and inlines one only for a seed it does not know', () => {
  const index = parseMembersIndex(read('house/members-index.yml'));
  const seeds = blobSeeds();
  for (const f of index.values()) assert.ok(seeds.has(f), `${f} has a file`);
  for (const f of ['gbti', 'gbtilabs', 'house']) assert.ok(seeds.has(f), `${f} has a file`);
  const known = [...index.values()][0];
  assert.equal(blobSrc(known), `/blobatar/${known}.svg`);
  assert.equal(blobSrc(known.toUpperCase()), `/blobatar/${known}.svg`, 'case-folded');
  assert.match(blobSrc('Some Display Name'), /^data:image\/svg\+xml,/);
  // The file and the inline URL are the same drawing (the URL only swaps quote marks and escapes).
  const norm = (x) => x.replace(/"/g, "'");
  assert.equal(norm(decodeURIComponent(memberBlob('mike-conley').replace('data:image/svg+xml,', ''))), norm(memberBlobSvg('mike-conley')));
});

test('a component avatar is the blobatar with the photo on top, and a failed photo is removed', () => {
  const html = avatarLayers('mike-conley');
  assert.match(html, /^<img data-blob src="data:image\/svg\+xml,[^"]+" alt="" aria-hidden="true"><img data-avphoto src="https:\/\/gbti\.network\/avatar\/mike-conley" alt="" loading="lazy">$/);
  assert.doesNotMatch(avatarLayers('mike-conley', ''), /data-avphoto/, 'no photo: only the blobatar');
  assert.match(avatarLayers('x', 'https://a/b?c=1&d="2"'), /src="https:\/\/a\/b\?c=1&amp;d=&quot;2&quot;"/);
  // The listener removes a failed PHOTO only.
  let handler = null;
  const root = { addEventListener: (type, fn, capture) => { assert.equal(type, 'error'); assert.equal(capture, true); handler = fn; }, removeEventListener: () => {} };
  attachAvatarFallback(root);
  const made = (attrs) => { const el = { tagName: 'IMG', removed: false, hasAttribute: (a) => attrs.includes(a), remove() { el.removed = true; } }; return el; };
  const photo = made(['data-avphoto']);
  const blob = made(['data-blob']);
  handler({ target: photo });
  handler({ target: blob });
  assert.equal(photo.removed, true);
  assert.equal(blob.removed, false, 'the blobatar stays');
});

// Source guards: every avatar surface draws the blobatar, and none looks a member up on GitHub by name.
test('no avatar surface falls back to a letter disc or builds github.com/<folder>.png', () => {
  const surfaces = [
    'src/components/Avatar.astro', 'src/components/StackedAvatars.astro', 'src/lib/feed-share-cards.mjs', 'src/lib/author-note.mjs',
    'client-ui/src/elements/gbti-card-list.mjs', 'client-ui/src/elements/gbti-discussion.mjs', 'client-ui/src/elements/gbti-reader.mjs',
    'client-ui/src/elements/gbti-member-view.mjs', 'client-ui/src/elements/gbti-welcome.mjs', 'client-ui/src/elements/gbti-account.mjs',
    'client-ui/src/elements/gbti-notification-bell.mjs', 'client-ui/src/elements/gbti-notify-modal.mjs', 'client-ui/src/elements/gbti-notifications-settings.mjs',
    'client-ui/src/elements/gbti-subscriptions.mjs', 'client-ui/src/elements/gbti-superadmin-dashboard.mjs', 'client-ui/src/elements/gbti-content-editor.mjs',
  ];
  // A news CHANNEL keeps its letter icon in the follow list (gbti-subscriptions): a channel is not a person.
  const channelIcon = /const ini = esc\(\(c\.name \|\| '\?'\)/;
  for (const f of surfaces) {
    const src = read(f).replace(channelIcon, '');
    assert.match(src, /memberBlob|avatarLayers|blobSrc/, `${f}: draws the blobatar`);
    assert.doesNotMatch(src, /\b(ini|initial|authorInitial)\b *=/, `${f}: no letter-disc initial`);
    assert.doesNotMatch(src, /github\.com\/\$\{/, `${f}: no github.com/<name> avatar`);
  }
  assert.doesNotMatch(read('membership/mail-render.mjs'), /github\.com\/\$\{/, 'the digest');
});

// ---- the enrollment race ----

test('enrollment appends onto main\'s CURRENT index, so a hand edit merged meanwhile survives', () => {
  const stale = `members:\n  "${ID}": loraxian666\n`;
  const main = `members:\n  "${ID}": mike-conley\n  "5": taken\n`;
  const adds = [{ githubId: '9', folder: 'newbie' }, { githubId: ID, folder: 'loraxian666' }, { githubId: '6', folder: 'taken' }];
  const { text, additions } = freshIndexAdditions(b64(main), adds, () => stale);
  assert.equal(text, main, 'main\'s copy, not the checkout');
  assert.deepEqual(additions, [{ githubId: '9', folder: 'newbie' }], 'an id enrolled meanwhile and a folder taken meanwhile are dropped');
  assert.equal(freshIndexAdditions(undefined, adds, () => stale).text, stale, 'with no copy from main, the checkout (the old behaviour)');
});

test('syncEnrollments writes main\'s index plus the new entry, never the stale checkout', async () => {
  const root = fs.mkdtempSync(`${process.env.TMPDIR || '/tmp'}/enroll-`);
  fs.mkdirSync(`${root}/house`, { recursive: true });
  fs.mkdirSync(`${root}/members`, { recursive: true });
  fs.writeFileSync(`${root}/house/members-index.yml`, `members:\n  "${ID}": loraxian666\n`);
  const main = `members:\n  "${ID}": mike-conley\n`;
  let written = null;
  const github = {
    getRef: async () => ({ object: { sha: 's' } }),
    createRef: async () => ({}),
    getContent: async () => ({ sha: 'f', content: b64(main) }),
    putContent: async (_p, { content }) => { written = Buffer.from(content, 'base64').toString('utf8'); },
    createPull: async () => ({ number: 1 }),
    mergePull: async () => ({}),
  };
  const members = [{ githubId: '77', githubLogin: 'newbie', effective: { status: 'paid' }, username: 'newbie' }];
  const r = await syncEnrollments({ members, overrides: { membersIndex: parseMembersIndex(`members:\n  "${ID}": loraxian666\n`) }, root, github, dryRun: false });
  assert.equal(r.synced, true);
  assert.match(written, new RegExp(`"${ID}": mike-conley`), 'the hand edit on main survived');
  assert.doesNotMatch(written, /loraxian666/);
  assert.match(written, /"77": newbie/);
  fs.rmSync(root, { recursive: true, force: true });
});
