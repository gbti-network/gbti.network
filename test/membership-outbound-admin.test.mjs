// sow-359: the Worker half of the tracked partner link store. Three write ops as CONFIG_OP rows ranked
// SUPERADMIN, the validators bounding the wire, and the two rules the store exists to protect surviving a
// round trip through the route rather than only through the pure core.
//
// Modelled on test/membership-cta-admin.test.mjs, including the part that matters most: a refusal is asserted
// by what was WRITTEN, not only by the status code. A 403 that still PUT a file is the failure this shape
// catches and a status-only assertion would not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import yaml from 'js-yaml';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { outboundAddInput, outboundUpdateInput, outboundStatusInput } from '../workers/signup/membership-admin-outbound.mjs';
import { WORKER_ADMIN_ACTIONS } from '../client/src/admin-worker-actions.mjs';

const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' });
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const allow = async () => ({ allowed: true });
const signJwt = async () => 'fake.jwt.sig';
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');

const STORE = [
  '# the tracked partner links',
  '# provenance kept as each note',
  'links:',
  '  - path: /outbound/codeable',
  '    destination: https://codeable.io/?ref=MzT91',
  '    partner: codeable',
  '    status: live',
  '    note: why codeable',
  '',
].join('\n');

function ghFetch(record, { file = STORE } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'inst' }; } };
    if (/\/contents\/house\/outbound-links\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(file), sha: 'abc' }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 9, html_url: 'https://x/pull/9' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const kv = { async get() { return null; }, async put() {} };
const run = (body, { fetchImpl, authorize = staffSuper } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv, limiter: allow, signJwt });
const written = (record) => yaml.load(deB64(record.find((r) => r.method === 'PUT').body.content));

test('sow-359: an ADMIN cannot touch the tracked links, on any op, and writes NOTHING', async () => {
  for (const body of [
    { action: 'outbound-add', path: '/outbound/new', destination: 'https://new.example.com/a', partner: 'new' },
    { action: 'outbound-update', path: '/outbound/codeable', destination: 'https://codeable.io/x?ref=Z' },
    { action: 'outbound-status', path: '/outbound/codeable', status: 'retired' },
  ]) {
    const record = [];
    const r = await run(body, { fetchImpl: ghFetch(record), authorize: staffAdmin });
    assert.equal(r.status, 403, `${body.action} must be refused for an admin`);
    assert.equal(record.length, 0, `${body.action} must write nothing at all`);
  }
});

test('sow-359: a superadmin mints a link, and the file keeps its leading comment', async () => {
  const record = [];
  const r = await run({ action: 'outbound-add', path: '/outbound/acme', destination: 'https://acme.example.com/join?ref=A1', partner: 'acme', note: 'why acme' },
    { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const put = record.find((x) => x.method === 'PUT');
  assert.match(put.url, /contents\/house\/outbound-links\.yml/, 'the registry is the file written');
  const text = deB64(put.body.content);
  assert.match(text, /^# the tracked partner links/, 'the leading comment was dropped');
  const doc = written(record);
  assert.equal(doc.links.length, 2);
  assert.deepEqual(doc.links[1], { path: '/outbound/acme', destination: 'https://acme.example.com/join?ref=A1', partner: 'acme', status: 'live', note: 'why acme' });
  assert.ok(record.some((x) => /\/pulls$/.test(x.url)), 'one pull request is opened');
});

test('sow-359: a repoint keeps the path, and a retire keeps the row', async () => {
  const rec1 = [];
  const r1 = await run({ action: 'outbound-update', path: '/outbound/codeable', destination: 'https://codeable.io/new?ref=MzT91' }, { fetchImpl: ghFetch(rec1) });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  const after = written(rec1);
  assert.equal(after.links.length, 1, 'a repoint through the route must not mint a second row');
  assert.equal(after.links[0].path, '/outbound/codeable');
  assert.equal(after.links[0].destination, 'https://codeable.io/new?ref=MzT91');

  const rec2 = [];
  const r2 = await run({ action: 'outbound-status', path: '/outbound/codeable', status: 'retired' }, { fetchImpl: ghFetch(rec2) });
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const retired = written(rec2);
  assert.equal(retired.links.length, 1, 'retiring must not remove the row, or an old post starts 404ing');
  assert.equal(retired.links[0].status, 'retired');
  assert.equal(retired.links[0].destination, 'https://codeable.io/?ref=MzT91', 'retiring must not disturb the destination');
});

test('sow-359: the core still refuses through the route, and a refused edit writes nothing', async () => {
  for (const [body, why] of [
    [{ action: 'outbound-add', path: '/outbound/codeable', destination: 'https://x.example.com/y', partner: 'x' }, 'duplicate path'],
    // The Cloudways lesson: a pathless destination gets a slash appended by Cloudflare, inside the query.
    [{ action: 'outbound-add', path: '/outbound/x', destination: 'https://x.example.com?id=1', partner: 'x' }, 'pathless destination'],
    [{ action: 'outbound-update', path: '/outbound/missing', destination: 'https://x.example.com/y' }, 'unknown path'],
  ]) {
    const record = [];
    const r = await run(body, { fetchImpl: ghFetch(record) });
    assert.equal(r.status, 400, `${why} must be refused`);
    assert.equal(record.some((x) => x.method === 'PUT'), false, `${why} must write nothing`);
  }
});

test('sow-359: the wire validators refuse before any GitHub read', () => {
  assert.equal(outboundAddInput({ path: '/outbound/x', destination: 'https://x.example.com/a' }).ok, false, 'a partner is required');
  assert.equal(outboundAddInput({ path: '/outbound/x?q=1', destination: 'https://x.example.com/a', partner: 'x' }).ok, false, 'a path carrying a query is refused');
  assert.equal(outboundAddInput({ path: 'no-slash', destination: 'https://x.example.com/a', partner: 'x' }).ok, false);
  assert.equal(outboundUpdateInput({ path: '/outbound/x' }).ok, false, 'an update with nothing in it is refused');
  // Reaching for status here points at the other op rather than reporting an empty update.
  assert.match(outboundUpdateInput({ path: '/outbound/x', status: 'retired' }).body.message, /use outbound-status/);
  assert.equal(outboundUpdateInput({ path: '/outbound/x', partner: null }).ok, false, 'a partner cannot be cleared');
  assert.equal(outboundStatusInput({ path: '/outbound/x', status: 'deleted' }).ok, false);
  assert.equal(outboundStatusInput({ path: '/outbound/x', status: 'retired' }).ok, true);
});

test('sow-359: both hosts serve the three actions, and neither serves a remove', () => {
  for (const a of ['outbound-add', 'outbound-update', 'outbound-status']) {
    assert.ok(WORKER_ADMIN_ACTIONS.has(a), `${a} is not in the shared action table, so one host cannot reach it`);
  }
  // Deleting a row turns a live link in an old post into a 404. If a remove action ever appears, this is the
  // test that should have to be argued with first.
  const removers = [...WORKER_ADMIN_ACTIONS].filter((a) => /^outbound-(remove|delete|drop)/.test(a));
  assert.deepEqual(removers, [], `a remove action appeared: ${removers.join(', ')}`);
});
