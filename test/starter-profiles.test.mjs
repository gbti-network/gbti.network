// sow-439 (owner, 2026-10-02: "Give everyone a starter page"): a paying member with no profile gets a starter profile
// file from reconcile, so their profile link stops leading to "We could not find that page". These pins hold who gets
// one (only effective-paid members with no profile file in any state), what it says (their name, a GitHub link, one
// third-person line, out of the directory), and that a write never overwrites a profile and never happens on a dry run.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';

import { starterProfileText, starterCandidates, cleanDisplayName, syncStarterProfiles, STARTER_SKIP, profilePath } from '../scripts/lib/starter-profiles.mjs';
import { resolveLoginById } from '../scripts/lib/enroll-members.mjs';
import { isSanctionedAvatar } from '../client-ui/src/profile-fields.mjs';

const fm = (text) => yaml.load(text.split('---')[1]);
const body = (text) => text.split('---').slice(2).join('---').trim();
const idx = (o) => new Map(Object.entries(o));
const paid = (githubId, githubLogin = null) => ({ githubId, githubLogin, effective: { status: 'paid' } });

test('the starter file: their name, a GitHub link, one third-person line, published and out of the directory', () => {
  const text = starterProfileText({ folder: 'gbarrionuevo', displayName: 'Gerónimo Barrionuevo', githubLogin: 'gbarrionuevo', githubId: '17553670', joinedAt: new Date('2026-10-02T18:00:00Z') });
  const f = fm(text);
  assert.deepEqual(f, {
    type: 'profile', username: 'gbarrionuevo', displayName: 'Gerónimo Barrionuevo', tier: 'paid', directory: false,
    status: 'published', visibility: 'public', avatar: 'https://avatars.githubusercontent.com/u/17553670?s=460&v=4',
    links: { github: 'https://github.com/gbarrionuevo' }, joinedAt: new Date('2026-10-02'),
  });
  assert.equal(body(text), 'Gerónimo Barrionuevo is a member of the GBTI Network.');
  assert.ok(isSanctionedAvatar(f.avatar), 'the content check accepts the picture');
  assert.equal('avatar' in fm(starterProfileText({ folder: 'gbarrionuevo', githubLogin: 'gbarrionuevo', githubId: 'not-a-number' })), false, 'no account number: the initial instead');
  assert.equal('headline' in f, false, 'nothing is written in the member\'s voice');
});

test('the name falls back to the login, then the folder', () => {
  assert.equal(fm(starterProfileText({ folder: 'mike-conley', displayName: null, githubLogin: 'mconley' })).displayName, 'mconley');
  assert.equal(fm(starterProfileText({ folder: 'mike-conley', displayName: '   ', githubLogin: null })).displayName, 'mike-conley');
  assert.equal('links' in fm(starterProfileText({ folder: 'mike-conley', githubLogin: 'not a login!' })), false, 'no link to a login that cannot be one');
});

test('a name cannot carry markup or YAML structure onto a public page', () => {
  assert.equal(cleanDisplayName('Ana "the <b>dev</b>": admin'), 'Ana the b dev b admin');
  assert.equal(cleanDisplayName('O\'Brien & Sons (Ltd.)'), 'O\'Brien & Sons (Ltd.)');
  assert.equal(cleanDisplayName('Zoë Ngô 李'), 'Zoë Ngô 李');
  assert.equal(cleanDisplayName('*** ---'), '', 'punctuation alone is not a name');
  assert.equal(cleanDisplayName('a'.repeat(200)).length, 80);
  for (const raw of ['x: y', '"quoted"', 'line\nbreak', '#hash', '[link](https://x)', '- dash']) {
    const text = starterProfileText({ folder: 'someone', displayName: raw, githubLogin: 'someone' });
    const f = fm(text);
    assert.equal(f.username, 'someone', `${JSON.stringify(raw)} kept the frontmatter intact`);
    assert.doesNotMatch(body(text), /[<>[\]#*`\n]/, `${JSON.stringify(raw)} put nothing markdown-active in the body`);
  }
  assert.throws(() => starterProfileText({ folder: '../escape', displayName: 'x' }), /not a valid folder/);
});

test('who gets one: paying members whose folder has no profile file in any state', () => {
  const members = [
    paid('1', 'newbie'), // enrolled, no profile
    paid('2', 'writer'), // has a profile
    { githubId: '3', githubLogin: 'lapsed', effective: { status: 'expired' } },
    { githubId: '4', githubLogin: 'banned', effective: { status: 'banned' } },
    paid('5', 'tester'), // the test account
    paid('6', 'unindexed'), // no folder yet
    paid('7', 'unknown'), // profile state unknown
  ];
  const membersIndex = idx({ 1: 'newbie', 2: 'writer', 3: 'lapsed', 4: 'banned', 5: 'gbti-test-member', 7: 'unknown' });
  const hasProfile = (f) => (f === 'writer' ? true : f === 'unknown' ? null : false);
  assert.deepEqual(starterCandidates({ members, membersIndex, hasProfile }), [{ githubId: '1', folder: 'newbie', hintLogin: 'newbie' }]);
  assert.ok(STARTER_SKIP.has('gbti-test-member') && STARTER_SKIP.has('gbti'));
});

const fakeGithub = (onMain = new Set(), { indexText } = {}) => {
  const calls = [];
  return {
    calls,
    async getContent(p) {
      if (p === 'house/members-index.yml') return { content: Buffer.from(indexText ?? '').toString('base64') };
      if (onMain.has(p)) return { sha: 'x' };
      const e = new Error('not found'); e.status = 404; throw e;
    },
    async getRef() { return { object: { sha: 'mainsha' } }; },
    async createRef(branch) { calls.push({ op: 'ref', branch }); },
    async putContent(p, o) { calls.push({ op: 'put', path: p, text: Buffer.from(o.content, 'base64').toString('utf8'), branch: o.branch }); },
    async createPull(o) { calls.push({ op: 'pull', title: o.title }); return { number: 9 }; },
    async mergePull(n, o) { calls.push({ op: 'merge', n, method: o.method }); },
  };
};
const ROOT = process.cwd(); // the real checkout: these test folders have no profile.md in it
const INDEX = 'members:\n  "101": starter-a\n  "102": starter-b\n  "103": starter-c\n';
const MEMBERS = [paid('101', 'starter-a'), paid('102', 'starter-b'), paid('103', 'starter-c')];
const resolveUser = async (id) => ({ login: `starter-${{ 101: 'a', 102: 'b', 103: 'c' }[id]}`, name: id === '101' ? 'Alpha Person' : null });

test('a dry run plans and writes nothing', async () => {
  const github = fakeGithub(new Set(), { indexText: INDEX });
  const r = await syncStarterProfiles({ members: MEMBERS, root: ROOT, env: {}, github, dryRun: true, resolveUser });
  assert.equal(r.synced, false);
  assert.equal(r.reason, 'dry run');
  assert.equal(github.calls.length, 0);
});

test('an apply reads the index from main, writes every missing page as ONE PR, merges it, and never overwrites', async () => {
  const github = fakeGithub(new Set([profilePath('starter-b')]), { indexText: INDEX });
  const r = await syncStarterProfiles({ members: MEMBERS, root: ROOT, env: {}, github, dryRun: false, resolveUser, now: new Date('2026-10-02T18:00:00Z') });
  assert.equal(r.synced, true);
  assert.equal(r.prNumber, 9);
  const puts = github.calls.filter((c) => c.op === 'put');
  assert.deepEqual(puts.map((p) => p.path), ['members/starter-a/profile.md', 'members/starter-c/profile.md'], 'starter-b appeared on main meanwhile: left alone');
  assert.equal(new Set(puts.map((p) => p.branch)).size, 1, 'one branch');
  assert.equal(github.calls.filter((c) => c.op === 'pull').length, 1, 'one PR');
  assert.equal(github.calls.at(-1).op, 'merge', 'merged in the same run');
  assert.equal(fm(puts[0].text).displayName, 'Alpha Person');
  assert.equal(fm(puts[0].text).avatar, 'https://avatars.githubusercontent.com/u/101?s=460&v=4', 'the picture by account number');
  assert.equal(fm(puts[1].text).displayName, 'starter-c', 'no GitHub name: the login');
  assert.deepEqual(r.skipped, [{ folder: 'starter-b', reason: 'a profile appeared on main meanwhile' }]);
});

test('a member enrolled earlier in the same run is picked up from main, not from the checkout', async () => {
  const github = fakeGithub(new Set(), { indexText: 'members:\n  "104": starter-d\n' });
  const r = await syncStarterProfiles({ members: [paid('104', 'starter-d')], root: ROOT, env: {}, github, dryRun: false, resolveUser: async () => ({ login: 'starter-d', name: null }) });
  assert.equal(r.synced, true);
  assert.deepEqual(r.additions.map((a) => a.folder), ['starter-d']);
});

test('an unanswerable check on main writes nothing for that member', async () => {
  const github = fakeGithub(new Set(), { indexText: INDEX });
  github.getContent = async (p) => {
    if (p === 'house/members-index.yml') return { content: Buffer.from(INDEX).toString('base64') };
    const e = new Error('server error'); e.status = 502; throw e;
  };
  const r = await syncStarterProfiles({ members: MEMBERS, root: ROOT, env: {}, github, dryRun: false, resolveUser });
  assert.equal(r.synced, false);
  assert.equal(github.calls.filter((c) => c.op === 'put').length, 0);
  assert.ok(r.skipped.every((s) => s.reason === 'could not check main'));
});

test('enrollment keeps its login lookup, now sharing the one GitHub user call', async () => {
  const fetchImpl = async () => ({ ok: true, json: async () => ({ login: 'Newbie', name: 'New Person' }) });
  assert.equal(await resolveLoginById('55', { fetchImpl }), 'Newbie');
});

test('reconcile runs it right after enrollment, under the same dry-run switch', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../scripts/reconcile.mjs', import.meta.url), 'utf8');
  assert.match(src, /import \{ syncStarterProfiles \} from '\.\/lib\/starter-profiles\.mjs';/);
  const enroll = src.indexOf('await syncEnrollments({ members, overrides, root: ROOT, env, github, now, dryRun })');
  const starter = src.indexOf('await syncStarterProfiles({ members, root: ROOT, env, github, now, dryRun })');
  assert.ok(enroll > 0 && starter > enroll, 'after enrollment, so a member enrolled in the run gets a page in the run');
});
