// sow-458 (owner, 2026-10-16): "we want to disable the requirement for projects to be approved. Also all content. It is
// published when the person publishes it." Editorial review (sow-323) is retired. These pin what replaced it:
//   - a paid member's public article, project, prompt or share is accepted by the Worker (the route tests are in
//     test/membership-author.test.mjs; the merge gate's half is in test/editorial-gate.test.mjs);
//   - the editor and the share composer let every author choose Public or Members only, Public by default;
//   - the owner is still emailed when a member CREATES something ("I still want to be emailed every time a user
//     creates a project / prompt / article / share"), not on an edit, and not for a superadmin's own items;
//   - an item switched from members-only to public drops its old encrypted body in the same pull request;
//   - the review machinery (queue, approve route, Approve button, Editorial review tab) is gone, not dormant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contentItemsIn, statedVisibility } from '../membership/hosted-author.mjs';
import { newItemsNotice, newItemUrl } from '../membership/new-item-notify.mjs';
import { newItemsOnMain, sendNewItemsAlert, NEW_ITEM_SEEN_PREFIX } from '../workers/signup/new-item-alert.mjs';
import { membershipAuthor } from '../workers/signup/membership-author.mjs';
import { audienceControl } from '../client-ui/src/one-click-public-core.mjs';
import { audienceTag } from '../client-ui/src/workspace-core.mjs';
import { canSharePublicly } from '../client-ui/src/share-post-core.mjs';
import { shareVisibilityArg } from '../client/src/mcp-tools.mjs';
import { staleEncDeletes } from '../client/src/member-content.mjs';
import { publish } from '../client/src/operations-publish.mjs';
import { buildContentFile, parseContentFile } from '../client/src/content-ops.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const md = (fm, body = '') => `---\n${fm}\n---\n${body}`;

// ---- the items of a publish ------------------------------------------------------------------------------------

test('contentItemsIn lists every item a publish writes, whatever its audience', () => {
  const files = [
    { path: 'members/ada/projects/tool/index.md', content: md("title: 'IsHacked: Know a Site'\nvisibility: members\npublicStub: true") },
    { path: 'members/ada/projects/tool/images/icon.png', contentBase64: 'AA' },
    { path: 'members/ada/posts/flat.md', content: md('title: Flat post') },
    { path: 'members/ada/posts/gone/index.md', content: null },
    { path: 'members/ada/posts/dir/notes.md', content: md('title: not an item') },
    { path: 'members/ada/shares/20261016-a.md', content: md('shortDescription: >-\n  A long\n  description\nurl: https://x.test/a') },
    { path: 'members/ada/shares/20261016-b.md', content: md('title: Public share\nvisibility: public') },
    { path: 'members/ada/prompts/sk/SKILL.md', content: 'name: sk' },
    { path: 'members/ada/comments/c1.md', content: md('title: a comment') },
    { path: 'members/ada/profile.md', content: md('name: Ada') },
    { path: 'members/bob/posts/other/index.md', content: md('title: someone else') },
  ];
  assert.deepEqual(contentItemsIn(files, 'ada').map((i) => [i.type, i.slug, i.visibility, i.title]), [
    ['project', 'tool', 'members', 'IsHacked: Know a Site'],
    ['post', 'flat', 'public', 'Flat post'],
    ['share', '20261016-a', 'members', 'A long description'], // a share's default audience is members
    ['share', '20261016-b', 'public', 'Public share'],
    ['prompt', 'sk', 'public', ''], // a SKILL.md stands for its item, once
  ]);
  assert.deepEqual(contentItemsIn(files, ''), []);
  assert.deepEqual(contentItemsIn(null, 'ada'), []);
});

test('a renamed item carries the paths it had, so it is not taken for a new one', () => {
  const [item] = contentItemsIn([{ path: 'members/ada/posts/new-name/index.md', content: md('title: T\nredirectFrom:\n  - /articles/old-name/') }], 'ada');
  assert.deepEqual(item.priorPaths, ['members/ada/posts/old-name/index.md']);
});

test('statedVisibility still reads only the frontmatter (the share category check depends on it)', () => {
  assert.equal(statedVisibility(md('visibility: members')), 'members');
  assert.equal(statedVisibility(md('title: x')), 'public');
  assert.equal(statedVisibility('no frontmatter\nvisibility: members'), 'public');
  assert.equal(statedVisibility(md('title: x', 'visibility: members')), 'public', 'a body line is not the audience');
  assert.equal(statedVisibility(undefined), null);
});

// ---- is it new? ------------------------------------------------------------------------------------------------

const mainFake = (present = new Set(), failing = new Set()) => {
  const calls = [];
  const fetchImpl = async (url) => {
    const path = decodeURIComponent(/\/contents\/(.+)\?ref=main$/.exec(url)?.[1] ?? '');
    calls.push(path);
    if (failing.has(path)) throw new Error('network');
    return { status: present.has(path) ? 200 : 404 };
  };
  return { fetchImpl, calls };
};

test('an item is new only when main answers 404 for its path and every path it had', async () => {
  const items = [
    { path: 'members/ada/posts/fresh/index.md', priorPaths: [] },
    { path: 'members/ada/posts/edited/index.md', priorPaths: [] },
    { path: 'members/ada/posts/renamed/index.md', priorPaths: ['members/ada/posts/old/index.md'] },
    { path: 'members/ada/posts/unknown/index.md', priorPaths: [] },
  ];
  const { fetchImpl } = mainFake(new Set(['members/ada/posts/edited/index.md', 'members/ada/posts/old/index.md']), new Set(['members/ada/posts/unknown/index.md']));
  const out = await newItemsOnMain({ fetchImpl, instToken: 't', upstream: 'o/r', items });
  assert.deepEqual(out.map((i) => i.path), ['members/ada/posts/fresh/index.md'], 'an edit, a rename and an unanswerable read are not mailed as new');
});

// ---- the owner's email -----------------------------------------------------------------------------------------

const item = (over = {}) => ({ path: 'members/gsusi/projects/ishacked/index.md', type: 'project', slug: 'ishacked', login: 'gsusi', visibility: 'public', title: 'IsHacked', ...over });

test('the notice names what was created, by whom, its audience and its page, with no review promise', () => {
  const one = newItemsNotice([item()]);
  assert.equal(one.subject, 'New project by gsusi: IsHacked');
  assert.match(one.text, /Project: IsHacked/);
  assert.match(one.text, /Audience: Public/);
  assert.match(one.text, /https:\/\/gbti\.network\/projects\/ishacked\//);
  assert.match(one.html, /IsHacked/);
  assert.doesNotMatch(one.text + one.html, /review|approve|waiting/i);
  assert.doesNotMatch(one.text + one.html, /[–—]/, 'no dashes in what the owner reads');
  const two = newItemsNotice([item(), item({ type: 'share', slug: 's1', title: 'A link', visibility: 'members', path: 'members/gsusi/shares/s1.md' })]);
  assert.equal(two.subject, '2 new items by gsusi');
  assert.match(two.text, /Share: A link\nAudience: Members only\nAddress: \(no public page\)/);
});

test('a page address exists for public shares and for every article, project and prompt', () => {
  assert.equal(newItemUrl({ type: 'share', slug: 'x', login: 'a', visibility: 'public' }), 'https://gbti.network/shares/a/x/');
  assert.equal(newItemUrl({ type: 'share', slug: 'x', login: 'a', visibility: 'members' }), null);
  assert.equal(newItemUrl({ type: 'post', slug: 'x', visibility: 'members', publicStub: true }), 'https://gbti.network/articles/x/');
  assert.equal(newItemUrl({ type: 'post', slug: 'x', visibility: 'members' }), null, 'a members item with no stub has no page to link');
  assert.equal(newItemUrl({ type: 'prompt', slug: 'x' }), 'https://gbti.network/prompts/x/');
});

const memKv = () => { const m = new Map(); return { m, get: async (k) => m.get(k) ?? null, put: async (k, v) => { m.set(k, v); } }; };
const ENV = { COUPON_ALERT_EMAIL: 'opportunities@gbti.network', MAIL_FROM: 'noreply@gbti.network' };

test('the email goes to the owner address once per new item, and a second publish before merge is not mailed', async () => {
  const sent = [];
  const kv = memKv();
  const sendEmail = async (msg) => { sent.push(msg); };
  assert.deepEqual(await sendNewItemsAlert(ENV, [item()], { sendEmail, kv }), { sent: true });
  assert.equal(sent[0].to, 'opportunities@gbti.network');
  assert.ok(kv.m.has(`${NEW_ITEM_SEEN_PREFIX}members/gsusi/projects/ishacked/index.md`));
  assert.deepEqual(await sendNewItemsAlert(ENV, [item()], { sendEmail, kv }), { sent: false, reason: 'already_sent' });
  assert.equal(sent.length, 1);
  assert.deepEqual(await sendNewItemsAlert(ENV, [], { sendEmail, kv }), { sent: false, reason: 'nothing_new' });
});

test('the email is fail-soft: unconfigured or a failed send never throws', async () => {
  assert.equal((await sendNewItemsAlert({}, [item()], { sendEmail: async () => {}, kv: memKv() })).reason, 'unconfigured');
  const r = await sendNewItemsAlert(ENV, [item()], { sendEmail: async () => { throw new Error('resend down'); }, kv: memKv() });
  assert.equal(r.sent, false);
  assert.equal(r.reason, 'error');
});

test('the publish route sends the notice after the response, on what the route reports as created', () => {
  const routes = read('workers/signup/member-routes.mjs');
  assert.match(routes, /newItemsAlert\(env, ctx, r\.created\)/);
  assert.match(routes, /const send = sendNewItemsAlert\(env, created\);\s*if \(ctx\?\.waitUntil\) ctx\.waitUntil\(send\);/);
});

// A superadmin's own items are not mailed (owner's answer, 2026-10-16). Exercised through the route with a GitHub fake.
const INDEX_YML = 'members:\n  "2002207": atwellpub\n';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function gh() {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }; } };
    if (/\/contents\/house\/members-index\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: b64(INDEX_YML) }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url)) return { ok: true, status: 201, async json() { return {}; } };
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 7, html_url: 'https://github.com/o/r/pull/7' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const routeEnv = { MEMBERSHIP_AUTHOR_ENABLED: 'true', GITHUB_APP_ID: '1', GITHUB_APP_INSTALLATION_ID: '2', GITHUB_APP_PRIVATE_KEY: 'k', GITHUB_UPSTREAM_REPO: 'gbti-network/gbti.network' };
const routeDeps = (superadmin) => ({
  kv: { get: async () => null, put: async () => {} }, fetchImpl: gh(), signJwt: async () => 'jwt',
  authorize: async () => ({ ok: true, githubId: '2002207', tier: 'member' }),
  fetchUser: async () => ({ githubLogin: 'atwellpub', githubId: '2002207' }),
  limiter: async () => ({ allowed: true }),
  authorizeSuper: async () => ({ ok: superadmin }),
});
const shareBody = { itemId: 'share-x', title: 'A share', files: [{ path: 'members/atwellpub/shares/20261016-x.md', content: md('url: https://x.test/a\ntitle: A link\nvisibility: public\ncategory: ai') }] };

test('a member\'s new public share is accepted and reported; a superadmin\'s is accepted and not mailed', async () => {
  const member = await membershipAuthor({ headers: { get: () => 'Bearer t' }, json: async () => shareBody }, routeEnv, routeDeps(false));
  assert.equal(member.status, 200, JSON.stringify(member.body));
  assert.deepEqual(member.created.map((c) => [c.type, c.visibility]), [['share', 'public']]);
  const sa = await membershipAuthor({ headers: { get: () => 'Bearer t' }, json: async () => shareBody }, routeEnv, routeDeps(true));
  assert.equal(sa.status, 200, JSON.stringify(sa.body));
  assert.deepEqual(sa.created, []);
});

// ---- the screens -----------------------------------------------------------------------------------------------

test('every author chooses the audience, and a new item starts Public', () => {
  assert.deepEqual(audienceControl({}), { mode: 'switch', value: 'public', note: '' });
  assert.equal(audienceControl({ currentVisibility: 'members' }).value, 'members');
  assert.equal(audienceControl({ currentVisibility: 'public' }).value, 'public');
  const fields = read('client-ui/src/elements/editor-fields.mjs');
  assert.doesNotMatch(fields, /in review|vislocked|data-vislocked/, 'no locked audience control is left');
});

test('the WorkBench says who can read an item, and nothing about review', () => {
  assert.equal(audienceTag({ status: 'published', visibility: 'members' }).label, 'members only');
  assert.equal(audienceTag({ status: 'published', visibility: 'public' }).label, 'public');
  assert.equal(audienceTag({ status: 'draft', visibility: 'members' }), null);
  for (const v of ['members', 'public']) assert.doesNotMatch(JSON.stringify(audienceTag({ status: 'published', visibility: v })), /review|superadmin|approv/i);
  assert.doesNotMatch(read('client-ui/src/workspace-core.mjs'), /export function curatorBanner/);
  assert.doesNotMatch(read('client-ui/src/elements/gbti-workspace.mjs'), /curatorBanner/);
});

test('any member who may post a share may post it public, and Public is the default everywhere', () => {
  for (const m of ['paid']) assert.equal(canSharePublicly({ membership: m, role: 'member' }), true);
  for (const m of ['expired', 'cancelled', 'none', 'banned', 'trialing']) assert.equal(canSharePublicly({ membership: m, role: 'superadmin' }), false, m);
  assert.equal(shareVisibilityArg(undefined), 'public');
  assert.equal(shareVisibilityArg('members'), 'members');
  assert.throws(() => shareVisibilityArg('everyone'), /"public" \(the default\) or "members"/);
  const composer = read('client-ui/src/elements/gbti-share-composer.mjs');
  assert.match(composer, /this\._visibility = 'public'; \/\/ sow-458/);
  assert.match(composer, /<button class="audcard on" type="button" data-vis="public"/);
  assert.match(composer, /this\._selectAudience\('public'\);/, 'the composer resets to Public after a post');
});

test('members-only to public drops the old encrypted body, and ONLY when the new file no longer names it', () => {
  const enc = 'members/ada/_enc/project-tool-body.enc';
  const built = (fm = {}) => ({ path: 'members/ada/projects/tool/index.md', frontmatter: fm });
  assert.deepEqual(staleEncDeletes(enc, null, built({ visibility: 'public' })), [{ path: enc, content: null }], 'published public, nothing points at it');
  assert.deepEqual(staleEncDeletes(enc, { encPath: enc }, built()), [], 'still members-only, or a members section: the file is rewritten');
  assert.deepEqual(staleEncDeletes(enc, null, built({ encryptedBody: enc })), [], 'the frontmatter still points at it (an agent round-trip): never delete');
  assert.deepEqual(staleEncDeletes('members/bob/_enc/post-x-body.enc', null, built()), [], 'never another member\'s ciphertext');
  assert.deepEqual(staleEncDeletes(undefined, null, built()), []);
  assert.deepEqual(staleEncDeletes('members/ada/_enc/../x.enc', null, built()), []);
  assert.match(read('src/lib/workbench-client-publish.ts'), /if \(!moved\) files\.push\(\.\.\.staleEncDeletes\(oldFm\?\.encryptedBody, plan, built\)\);/);
  assert.match(read('client/src/operations-publish.mjs'), /const staleEnc = renaming \? \[\] : staleEncDeletes\(priorFm\?\.encryptedBody, plan, built\);/);
});

test('the locked-page flag is dropped from a public item by the builder, for every host', () => {
  const out = buildContentFile({ type: 'post', username: 'ada', input: { title: 'T', slug: 't', visibility: 'public', publicStub: true }, body: 'x' });
  assert.equal('publicStub' in out.frontmatter, false, 'switching back to Public after turning on the stub must not ship the pair');
  const kept = buildContentFile({ type: 'post', username: 'ada', input: { title: 'T', slug: 't', visibility: 'members', publicStub: true }, body: 'x' });
  assert.equal(kept.frontmatter.publicStub, true);
});

// The agent (npm/MCP) publish path, run for real with a fake network. Both cases were found in review.
function agentCtx(files) {
  const sent = [];
  return {
    sent,
    ctx: {
      identity: () => ({ username: 'ada', githubId: '1' }),
      getRepoClient: () => ({ getFileContent: async (rel) => files[rel] ?? null }),
      reader: { readFile: async (rel) => files[rel] ?? null },
      membershipResolved: async () => 'paid',
      store: { get: (k) => (k === 'githubToken' ? 't' : null) },
      now: () => '2026-10-16T00:00:00.000Z',
      fetch: async (url, init = {}) => {
        if (/\/membership\/author$/.test(url)) { sent.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ ok: true, number: 1, html_url: 'x' }) }; }
        if (/\/membership\/encrypt$/.test(url)) return { ok: true, status: 200, json: async () => ({ ok: true, envelope: { v: 1, iv: 'a', ct: 'b', aad: 'c' } }) };
        return { ok: true, status: 200, json: async () => ({ ok: true }) };
      },
    },
  };
}

test('an agent rewriting a members-only item without naming the audience keeps it members-only', async () => {
  const P = 'members/ada/posts/secret/index.md';
  const files = { [P]: md('title: Secret\nslug: secret\nstatus: published\nvisibility: members\npublicStub: true\nencryptedBody: members/ada/_enc/post-secret-body.enc\npublishedAt: 2026-10-01T00:00:00.000Z\ntype: post\nauthor: ada') };
  const { ctx, sent } = agentCtx(files);
  await publish(ctx, { type: 'post', input: { title: 'Secret', slug: 'secret', tags: ['x'] }, body: 'The rewritten members-only text.', path: P });
  const index = sent[0].files.find((f) => f.path === P);
  const fm = parseContentFile(index.content).frontmatter;
  assert.equal(fm.visibility, 'members');
  assert.equal(fm.publicStub, true);
  assert.doesNotMatch(index.content, /The rewritten members-only text/, 'the text is encrypted, never written in the clear');
  assert.equal(sent[0].files.some((f) => f.content === null), false, 'nothing is deleted');
});

test('an agent round-tripping a public item with a members section keeps the section and its ciphertext', async () => {
  const P = 'members/ada/posts/mixed/index.md';
  const ENC = 'members/ada/_enc/post-mixed-body.enc';
  const files = { [P]: md(`title: Mixed\nslug: mixed\nstatus: published\nvisibility: public\nencryptedBody: ${ENC}\npublishedAt: 2026-10-01T00:00:00.000Z\ntype: post\nauthor: ada`, 'The public part.'), [ENC]: '{}' };
  const { frontmatter, body } = parseContentFile(files[P]); // what get_content hands an agent: the pointer, the public part only
  const { ctx, sent } = agentCtx(files);
  await publish(ctx, { type: 'post', input: { ...frontmatter, tags: ['proxmox'] }, body, path: P });
  assert.equal(sent[0].files.some((f) => f.path === ENC && f.content === null), false, 'the members section is not deleted');
  assert.match(sent[0].files.find((f) => f.path === P).content, new RegExp(`encryptedBody: ${ENC}`));
});

// ---- the review machinery is gone ------------------------------------------------------------------------------

test('no approve route, queue, Approve button or Editorial review tab is left', () => {
  for (const f of ['workers/signup/membership-audience.mjs', 'workers/signup/membership-editorial.mjs', 'workers/signup/editorial-records.mjs',
    'workers/signup/editorial-alert.mjs', 'membership/editorial-queue.mjs', 'membership/editorial-approve.mjs', 'membership/editorial-notify.mjs',
    'src/components/ApprovePill.astro', 'client-ui/src/elements/gbti-editorial-manager.mjs', 'client-ui/src/editorial-queue-view.mjs']) {
    assert.equal(fs.existsSync(new URL(`../${f}`, import.meta.url)), false, `${f} is retired`);
  }
  assert.doesNotMatch(read('workers/signup/admin-routes.mjs'), /pathname === '\/membership\/admin\/editorial'/);
  assert.doesNotMatch(read('workers/signup/membership-author.mjs'), /audienceRefusal|recordEditorialItems|review_required/);
  assert.doesNotMatch(read('src/pages/admin.astro'), /data-tab="editorial"|gbti-editorial-manager/);
  assert.doesNotMatch(read('extension/admin.html'), /data-tab="editorial"|gbti-editorial-manager/);
  assert.doesNotMatch(read('client-ui/src/client.mjs'), /decideEditorial|editorialQueue/);
  assert.doesNotMatch(read('src/lib/workbench-client-admin.ts'), /decideEditorial|editorialQueue/);
  assert.doesNotMatch(read('client-ui/src/elements/gbti-content-editor.mjs'), /makepublic|oneClickPublicView/);
  for (const page of ['src/pages/projects/[slug].astro', 'src/pages/prompts/[slug].astro', 'src/components/blog/ArticleJournal.astro', 'src/components/blog/ArticleCard.astro', 'src/components/blog/ArticleEditorial.astro']) {
    assert.doesNotMatch(read(page), /ApprovePill/, page);
  }
});
