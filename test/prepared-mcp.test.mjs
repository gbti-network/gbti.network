// sow-427 F: the `prepare_listing` agent tool. A superadmin's agent prepares a project listing for someone who is
// not a member yet and gets back the invitation link.
//
// What this pins, and why each matters:
// - The tool is LISTED (an agent cannot call what tools/list does not advertise) and takes no author note, because
//   the note is the recipient's own (decision 4) and a schema field for it would invite an agent to ghostwrite one.
// - Anyone below superadmin is refused BEFORE any network call. The Worker is the boundary, but a 403 per attempt
//   is a worse answer than a local one, and a staged image would be left behind in the caller's store.
// - A superadmin stages every image through the ordinary draft-image route FIRST and saves SECOND, because the
//   Worker's save copies the staged bytes and refuses a reference it cannot find.
// - A Worker 403 surfaces as `forbidden`, not as a generic failure: the status has to survive the transport.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

import { dispatch, TOOLS } from '../client/src/mcp-tools.mjs';
import { prepareListingOp } from '../client/src/operations.mjs';
import { preparedAdminRequest, stagePreparedImage, PreparedAdminError, AdminClientError } from '../client/src/member-admin-client.mjs';
import { SITE_BASE } from '../client/src/account-ops.mjs';
import { SIGNUP_BASE } from '../client/src/signup-base.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

const ROLES = "superadmins:\n  - github_id: '1'\nadmins:\n  - github_id: '2'\nmoderators:\n  - github_id: '3'\n";
const LISTING_ID = '23456789ABCDEFGH';
const CODE = 'SPRING26X7K2M9Q4TR';

const call = (name, args, ctx) => dispatch({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, ctx);
const textOf = (res) => JSON.parse(res.result.content[0].text);

/** The Worker as the tool sees it: a staged-image put answers ok, a prepared save answers a created listing. */
function workerOk(c) {
  if (c.path === '/membership/draft-image') return [200, { ok: true, name: c.body?.name, bytes: 3 }];
  if (c.path === '/membership/admin/prepared') {
    return [200, {
      // The Worker's own link is on another host here ON PURPOSE: the tool builds the link from the client's
      // SITE_BASE (claimLink), so a tool that relayed this value verbatim would fail the link assertion below.
      ok: true, created: !c.body?.id, changed: true, code: CODE, link: `https://worker-site.example/claim/?code=${CODE}`,
      listing: { id: LISTING_ID, type: 'project', slug: c.body?.draft?.slug, state: 'prepared', bound: !!c.body?.githubLogin },
    }];
  }
  return [404, { error: 'not_found' }];
}

/**
 * A ctx whose reader answers house/roles.yml from ROLES and whose `fetch` records every call. `calls` is what
 * "zero fetches" is measured against, so a refusal is proven to have sent nothing rather than assumed to.
 */
function ctxFor({ githubId = '1', token = 'tok', identity = true, responder = workerOk } = {}) {
  const calls = [];
  const ctx = {
    identity: () => (identity ? { login: 'owner', githubId, username: 'owner' } : null),
    reader: { readFile: async (p) => (p === 'house/roles.yml' ? ROLES : null) },
    store: { get: (k) => (k === 'githubToken' ? token : null) },
    fetch: async (url, init = {}) => {
      const u = new URL(String(url));
      const c = { url: String(url), path: u.pathname, search: u.search, method: init.method || 'GET', auth: init.headers?.Authorization, body: init.body ? JSON.parse(init.body) : null };
      calls.push(c);
      const [status, data] = responder(c, calls);
      return { ok: status < 400, status, json: async () => data };
    },
  };
  return { ctx, calls };
}

const INPUT = Object.freeze({
  title: 'SurfacedBy',
  slug: 'surfacedby',
  shortDescription: 'Finds where a page is cited.',
  icon: './images/icon.png',
  featuredImage: './images/cover.webp',
});
const baseArgs = (over = {}) => ({
  input: { ...INPUT },
  body: 'SurfacedBy finds where a page is cited.',
  recipientName: 'Sam',
  message: 'Hi Sam,\nI put your project together.',
  campaign: 'SPRING26',
  githubLogin: 'sam-example',
  images: [
    { name: 'icon.png', dataBase64: 'iVBORw0KGgo=' },
    { name: './images/cover.webp', dataBase64: 'data:image/webp;base64,UklGRg==' },
  ],
  ...over,
});

// ---- listed, with the schema the spec names ---------------------------------------------------------------------

test('tools/list advertises prepare_listing with the required fields and no author note', async () => {
  const { ctx } = ctxFor();
  const res = await dispatch({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, ctx);
  const tool = res.result.tools.find((t) => t.name === 'prepare_listing');
  assert.ok(tool, 'prepare_listing is listed');
  assert.equal(res.result.tools.length, TOOLS.length);
  assert.deepEqual([...tool.inputSchema.required].sort(), ['campaign', 'input', 'message', 'recipientName']);
  for (const p of ['input', 'body', 'recipientName', 'message', 'githubLogin', 'campaign', 'images', 'id']) {
    assert.ok(tool.inputSchema.properties[p], `schema property ${p}`);
  }
  assert.equal(tool.inputSchema.properties.images.type, 'array');
  assert.deepEqual(tool.inputSchema.properties.images.items.required, ['name', 'dataBase64']);
  assert.equal('authorNote' in tool.inputSchema.properties, false, 'the note is the recipient, never the agent');
  assert.match(tool.description, /SUPERADMIN ONLY/);
  assert.match(tool.description, /author note belongs to the recipient/);
});

test('the tool copy follows the writing rules', () => {
  const tool = TOOLS.find((t) => t.name === 'prepare_listing');
  const texts = [tool.description, ...Object.values(tool.inputSchema.properties).map((p) => p.description || '')];
  const contraction = /\b(?:can't|won't|don't|doesn't|isn't|aren't|wasn't|weren't|didn't|hasn't|haven't|hadn't|couldn't|wouldn't|shouldn't|it's|that's|there's|you're|we're|they're|you've|we've|let's)\b/i;
  for (const t of texts) {
    assert.doesNotMatch(t, /—|–/, 'no em or en dash');
    assert.doesNotMatch(t, /[A-Za-z0-9,.)] - [A-Za-z0-9(]/, 'no spaced hyphen standing in for a dash');
    assert.doesNotMatch(t, /\btrial\b/i, '"free year", never "trial"');
    assert.doesNotMatch(t, contraction, 'no contractions');
  }
  // A control: each scan fires on a line that breaks it, or the green above proves nothing.
  assert.match('a — b', /—|–/);
  assert.match('word - word', /[A-Za-z0-9,.)] - [A-Za-z0-9(]/);
  assert.match('your trial', /\btrial\b/i);
  assert.match('you don\'t', contraction);
});

test('the WorkBench guide groups prepare_listing under Invitations', () => {
  const src = read('src/lib/mcp-guide.ts');
  assert.match(src, /\['Invitations', \['prepare_listing'\]\]/);
  // The guide reads names from mcp-tools.mjs by this exact regex, so the tool must match it to be grouped at all.
  const names = [...read('client/src/mcp-tools.mjs').matchAll(/^\s*name: '([a-z_]+)',/gm)].map((m) => m[1]);
  assert.ok(names.includes('prepare_listing'));
});

// ---- the local superadmin gate: refused with zero fetches ------------------------------------------------------

test('anyone below superadmin gets forbidden with ZERO fetches', async () => {
  for (const githubId of ['2', '3', '99']) { // admin, moderator, member
    const { ctx, calls } = ctxFor({ githubId });
    const res = await call('prepare_listing', baseArgs(), ctx);
    assert.equal(res.result.isError, true, `role of ${githubId} is refused`);
    assert.equal(textOf(res).error, 'forbidden');
    assert.match(textOf(res).message, /superadmins only/);
    assert.equal(calls.length, 0, `no network call for ${githubId}`);
  }
});

test('no signed-in identity, or no token, is refused with zero fetches', async () => {
  const a = ctxFor({ identity: false });
  const r1 = await call('prepare_listing', baseArgs(), a.ctx);
  assert.equal(textOf(r1).error, 'no-identity');
  assert.equal(a.calls.length, 0);

  const b = ctxFor({ token: null });
  const r2 = await call('prepare_listing', baseArgs(), b.ctx);
  assert.equal(textOf(r2).error, 'not-authenticated');
  assert.equal(b.calls.length, 0);
});

// ---- the superadmin path: stage, then save, then the link ------------------------------------------------------

test('a superadmin stages every image, THEN saves, and gets a /claim/?code= link back', async () => {
  const { ctx, calls } = ctxFor();
  const res = await call('prepare_listing', baseArgs(), ctx);
  assert.notEqual(res.result.isError, true, JSON.stringify(textOf(res)));

  assert.deepEqual(calls.map((c) => c.path), ['/membership/draft-image', '/membership/draft-image', '/membership/admin/prepared']);
  for (const c of calls) {
    assert.ok(c.url.startsWith(SIGNUP_BASE), 'the signup Worker');
    assert.equal(c.method, 'POST');
    assert.equal(c.auth, 'Bearer tok', 'the superadmin bearer token, so the Worker checks the role itself');
  }
  assert.deepEqual(calls[0].body, { op: 'put', item: 'project:surfacedby', name: 'icon.png', dataBase64: 'iVBORw0KGgo=' });
  assert.deepEqual(calls[1].body, { op: 'put', item: 'project:surfacedby', name: 'cover.webp', dataBase64: 'UklGRg==' },
    'a ./images/ prefix and a data URL header are both accepted and stripped');

  const save = calls[2].body;
  assert.equal(save.op, 'save');
  assert.equal('id' in save, false, 'a create sends no id');
  assert.equal(save.campaign, 'SPRING26');
  assert.equal(save.recipientName, 'Sam');
  assert.equal(save.message, 'Hi Sam,\nI put your project together.');
  assert.equal(save.githubLogin, 'sam-example');
  assert.equal(save.stagedItem, 'project:surfacedby', 'the save names the item the images were staged under');
  assert.deepEqual(save.draft, { type: 'project', slug: 'surfacedby', frontmatter: { ...INPUT }, body: 'SurfacedBy finds where a page is cited.' });
  for (const k of ['authorNote', 'authorTarget', 'path', 'images']) assert.equal(k in save, false, `the save never carries ${k}`);

  const out = textOf(res);
  assert.deepEqual(out, { id: LISTING_ID, code: CODE, link: `${SITE_BASE.replace(/\/+$/, '')}/claim/?code=${CODE}`, state: 'prepared', bound: true });
  assert.match(out.link, /\/claim\/\?code=SPRING26X7K2M9Q4TR$/);
});

test('a listing with no images makes exactly one call, the save', async () => {
  const { ctx, calls } = ctxFor();
  const out = await prepareListingOp(ctx, baseArgs({ images: undefined, githubLogin: undefined }));
  assert.deepEqual(calls.map((c) => c.path), ['/membership/admin/prepared']);
  assert.equal('githubLogin' in calls[0].body, false, 'an absent login is left out (first-come)');
  assert.equal(out.bound, false);
});

test('an edit sends the id, leaves out what was not given, and passes an empty login through to untie', async () => {
  const { ctx, calls } = ctxFor();
  const out = await prepareListingOp(ctx, {
    id: LISTING_ID, input: { ...INPUT }, body: 'new body', githubLogin: '', recipientName: undefined, message: '', campaign: null,
  });
  const save = calls[0].body;
  assert.equal(save.id, LISTING_ID);
  for (const k of ['recipientName', 'message', 'campaign']) assert.equal(k in save, false, `${k} absent means unchanged`);
  assert.equal(save.githubLogin, '', 'an empty login unties the invitation');
  assert.equal(out.id, LISTING_ID);
});

// ---- Worker refusals keep their meaning -------------------------------------------------------------------------

test('a Worker 403 on the save surfaces as forbidden', async () => {
  const { ctx, calls } = ctxFor({
    responder: (c) => (c.path === '/membership/admin/prepared' ? [403, { error: 'forbidden', message: 'superadmin access is required' }] : workerOk(c)),
  });
  const res = await call('prepare_listing', baseArgs(), ctx);
  assert.equal(res.result.isError, true);
  assert.deepEqual(textOf(res), { error: 'forbidden', message: 'superadmin access is required' });
  assert.equal(calls.at(-1).path, '/membership/admin/prepared');
});

test('a Worker 403 on an image stops before the save and surfaces as forbidden', async () => {
  const { ctx, calls } = ctxFor({ responder: () => [403, { error: 'forbidden', message: 'banned' }] });
  const res = await call('prepare_listing', baseArgs(), ctx);
  assert.equal(textOf(res).error, 'forbidden');
  assert.match(textOf(res).message, /icon\.png/, 'the refusal names the image');
  assert.deepEqual(calls.map((c) => c.path), ['/membership/draft-image'], 'nothing is saved after a refused image');
});

test('a content refusal is invalid-content with its issues; any other refusal is admin-op-failed', async () => {
  const invalid = ctxFor({
    responder: (c) => (c.path === '/membership/admin/prepared'
      ? [400, { ok: false, error: 'invalid', message: 'The project is not valid.', issues: ['links.0.url: must be http or https'] }]
      : workerOk(c)),
  });
  const r1 = textOf(await call('prepare_listing', baseArgs(), invalid.ctx));
  assert.deepEqual(r1, { error: 'invalid-content', message: 'The project is not valid.', issues: ['links.0.url: must be http or https'] });

  const taken = ctxFor({
    responder: (c) => (c.path === '/membership/admin/prepared'
      ? [409, { ok: false, error: 'slug_taken', message: 'A project on the site already uses the permalink surfacedby. Choose another one.' }]
      : workerOk(c)),
  });
  const r2 = textOf(await call('prepare_listing', baseArgs(), taken.ctx));
  assert.equal(r2.error, 'admin-op-failed');
  assert.match(r2.message, /already uses the permalink surfacedby/);

  const missing = ctxFor({
    responder: (c) => (c.path === '/membership/admin/prepared'
      ? [400, { ok: false, error: 'image_missing', message: 'An image is missing.', missing: ['shot.png'] }]
      : workerOk(c)),
  });
  const r3 = textOf(await call('prepare_listing', baseArgs(), missing.ctx));
  assert.deepEqual(r3, { error: 'admin-op-failed', message: 'An image is missing.', issues: ['shot.png'] });
});

test('a 200 without the listing or the code is a failure, never a link built from nothing', async () => {
  const { ctx } = ctxFor({ responder: (c) => (c.path === '/membership/admin/prepared' ? [200, { ok: true }] : workerOk(c)) });
  await assert.rejects(() => prepareListingOp(ctx, baseArgs()), (err) => err.code === 'admin-op-failed');
});

// ---- the shape checks the staging step needs, refused before any network call -------------------------------------

test('malformed arguments are bad-request with zero fetches', async () => {
  const cases = {
    'an author note (the recipient writes it)': { authorNote: 'I built this because' },
    'no input': { input: undefined },
    'input not an object': { input: ['x'] },
    'no slug': { input: { ...INPUT, slug: '' } },
    'an uppercase slug': { input: { ...INPUT, slug: 'SurfacedBy' } },
    'a slug over 64 characters': { input: { ...INPUT, slug: 'a'.repeat(65) } },
    'an uppercase image name': { images: [{ name: 'Icon.png', dataBase64: 'x' }] },
    'an svg image': { images: [{ name: 'icon.svg', dataBase64: 'x' }] },
    'an image path, not a name': { images: [{ name: 'members/x/images/icon.png', dataBase64: 'x' }] },
    'an image with no data': { images: [{ name: 'icon.png', dataBase64: '' }] },
    'the same image twice': { images: [{ name: 'icon.png', dataBase64: 'x' }, { name: './images/icon.png', dataBase64: 'y' }] },
    'thirteen images': { images: Array.from({ length: 13 }, (_, i) => ({ name: `s${i}.png`, dataBase64: 'x' })) },
    'images not an array': { images: { name: 'icon.png' } },
    'a malformed id': { id: 'not-a-listing' },
    'no campaign on a create': { campaign: '' },
    'no greeting on a create': { recipientName: '  ' },
    'no message on a create': { message: undefined },
  };
  for (const [label, over] of Object.entries(cases)) {
    const { ctx, calls } = ctxFor();
    const res = await call('prepare_listing', baseArgs(over), ctx);
    assert.equal(res.result.isError, true, label);
    assert.equal(textOf(res).error, 'bad-request', label);
    assert.equal(calls.length, 0, `${label}: nothing sent`);
  }
});

// ---- the transport ----------------------------------------------------------------------------------------------

test('preparedAdminRequest builds the query, and its refusal keeps the status, the code and the list', async () => {
  const seen = [];
  const fetch = async (url, init = {}) => {
    seen.push({ url: String(url), method: init.method || 'GET', auth: init.headers?.Authorization });
    return { ok: false, status: 404, json: async () => ({ ok: false, error: 'not_found', message: 'No such listing.' }) };
  };
  const err = await preparedAdminRequest({ token: 't', signupBase: 'https://w.example/', query: { id: LISTING_ID, image: 'icon.png', skip: null }, fetch })
    .then(() => null, (e) => e);
  assert.equal(seen[0].url, `https://w.example/membership/admin/prepared?id=${LISTING_ID}&image=icon.png`);
  assert.equal(seen[0].auth, 'Bearer t');
  assert.ok(err instanceof PreparedAdminError && err instanceof AdminClientError);
  assert.equal(err.status, 404);
  assert.equal(err.code, 'not_found');
  assert.equal(err.message, 'No such listing.');

  const issues = await preparedAdminRequest({
    token: 't', signupBase: 'https://w.example', method: 'POST', body: { op: 'save' },
    fetch: async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid', issues: ['a', 'b'] }) }),
  }).then(() => null, (e) => e);
  assert.deepEqual(issues.details, ['a', 'b']);
});

test('the transports refuse without a token and send nothing', async () => {
  let sent = 0;
  const fetch = async () => { sent += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  const a = await preparedAdminRequest({ token: null, signupBase: 'https://w.example', fetch }).then(() => null, (e) => e);
  const b = await stagePreparedImage({ token: '', signupBase: 'https://w.example', item: 'project:x', name: 'a.png', dataBase64: 'x', fetch }).then(() => null, (e) => e);
  assert.equal(a.status, 401);
  assert.equal(b.status, 401);
  assert.equal(sent, 0);
});

// ---- source guards ----------------------------------------------------------------------------------------------

test('the touched client modules and this test stay at or under 900 lines', () => {
  for (const f of ['client/src/member-admin-client.mjs', 'client/src/operations-admin.mjs', 'client/src/mcp-tools.mjs', 'client/src/operations.mjs', 'src/lib/mcp-guide.ts', 'test/prepared-mcp.test.mjs']) {
    const n = read(f).split('\n').length;
    assert.ok(n > 20, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

test('the new client code never logs: the invitation code is a bearer secret and the message is about a person', () => {
  const ops = read('client/src/operations-admin.mjs');
  const from = ops.indexOf('export async function prepareListingOp');
  const to = ops.indexOf('export async function refreshCouponUntil');
  assert.ok(from > 0 && to > from, 'the prepare block was found');
  assert.doesNotMatch(ops.slice(from, to), /\bconsole\./);
  const tx = read('client/src/member-admin-client.mjs');
  const tFrom = tx.indexOf('export class PreparedAdminError');
  const tTo = tx.indexOf('export async function getSyndicationQueue');
  assert.ok(tFrom > 0 && tTo > tFrom, 'the transport block was found');
  assert.doesNotMatch(tx.slice(tFrom, tTo), /\bconsole\./);
  assert.match('console.log(code)', /\bconsole\./, 'control');
});

test('the operation bundles for the browser: nothing node-only reaches the MV3 extension', async () => {
  // extension/build.mjs bundles the ops with platform 'browser'; a node: import (or a module that needs one)
  // fails to resolve there, so a clean in-memory build of the module is the check, not a grep of its imports.
  const r = await build({
    entryPoints: [path.join(ROOT, 'client/src/operations-admin.mjs')],
    bundle: true, write: false, format: 'esm', target: 'es2022', platform: 'browser', preserveSymlinks: true, logLevel: 'silent',
  });
  assert.equal(r.errors.length, 0);
  const text = r.outputFiles[0].text;
  assert.ok(text.includes('/membership/admin/prepared'), 'the bundle carries the prepared transport');
  assert.doesNotMatch(text, /from ["']node:/, 'no node builtin import');
});
