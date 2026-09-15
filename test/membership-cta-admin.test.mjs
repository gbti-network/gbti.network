// sow-281: the Worker half of the CTA registry. The five write ops are CONFIG_OP rows ranked SUPERADMIN; the pool
// read is superadmin-gated; the validators bound the wire to the core's caps; and both hosts route the same actions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { membershipAdminCtaPool, ctaAddInput, ctaUpdateInput, ctaToggleInput, ctaAssignInput } from '../workers/signup/membership-admin-ctas.mjs';
import { CTA_LIMITS } from '../membership/cta-edits.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const staffAdmin = async () => ({ ok: true, githubId: '2', role: 'admin' });
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const denied = async () => ({ ok: false, status: 403, body: { error: 'forbidden' } });
const allow = async () => ({ allowed: true });
const signJwt = async () => 'fake.jwt.sig';
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const deB64 = (s) => Buffer.from(String(s), 'base64').toString('utf8');
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const REGISTRY = '# leading comment\n# kept across edits\nctas:\n  - id: book\n    label: A book\n    line: One sentence.\n    button: Get the book on Amazon\n    destination: ' + AMZ + '\n    partner: amazon\n    enabled: false\n    items:\n      - type: prompt\n        ref: grok\n';

/** A fake GitHub: the app token, main's ref, the registry on main, the branch + PUT + PR recorded. */
function ghFetch(record, { govFile = REGISTRY } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'inst' }; } };
    if (/\/contents\/house\/ctas\.yml\?ref=main$/.test(url) && method === 'GET') return { ok: true, status: 200, async json() { return { content: b64(govFile), sha: 'abc' }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'PUT') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return {}; } }; }
    if (/\/pulls$/.test(url) && method === 'POST') { record.push({ method, url, body: JSON.parse(init.body) }); return { ok: true, status: 201, async json() { return { number: 7, html_url: 'https://x/pull/7' }; } }; }
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const kv = { async get() { return null; }, async put() {} };
const run = (body, { fetchImpl, authorize = staffSuper } = {}) =>
  membershipAdminAuthor(req(body), env, { fetchImpl, authorize, kv, limiter: allow, signJwt });
const putContent = (record) => deB64(record.find((r) => r.method === 'PUT').body.content);

test('an ADMIN cannot touch the CTA registry (403 on every op) and writes NOTHING', async () => {
  for (const body of [
    { action: 'cta-add', id: 'x', label: 'L', line: 'l', button: 'b', destination: AMZ, partner: 'amazon' },
    { action: 'cta-update', id: 'book', line: 'new' },
    { action: 'cta-toggle', id: 'book', enabled: true },
    { action: 'cta-assign', id: 'book', type: 'post', ref: 'p' },
    { action: 'cta-unassign', id: 'book', type: 'prompt', ref: 'grok' },
  ]) {
    const record = [];
    const r = await run(body, { fetchImpl: ghFetch(record), authorize: staffAdmin });
    assert.equal(r.status, 403, `${body.action} must be refused for an admin`);
    assert.equal(record.length, 0, `${body.action} must write nothing`);
  }
});

test('a superadmin cta-add writes house/ctas.yml on a caller-keyed branch, preserving the leading comment; the new CTA is disabled', async () => {
  const record = [];
  const r = await run({ action: 'cta-add', id: 'codeable', label: 'Codeable', line: 'Hire a WordPress expert.', button: 'Find an expert on Codeable', destination: 'https://codeable.io/?ref=gbti', partner: 'codeable' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 7);
  assert.equal(r.body.autoMerge, true, 'a superadmin house PR merges on its own');
  const createRef = record.find((x) => /\/git\/refs$/.test(x.url));
  assert.equal(createRef.body.ref, 'refs/heads/hosted-admin/1/cta-add-codeable');
  const content = putContent(record);
  assert.ok(content.startsWith('# leading comment\n# kept across edits\n'), 'the leading comment survives the re-serialize');
  assert.match(content, /id: codeable/);
  assert.match(content, /enabled: false/);
  assert.match(content, /id: book/, 'the existing CTA is kept');
});

test('a superadmin cta-assign / cta-toggle / cta-update / cta-unassign each land as one file write; a satisfied op is a clean no-op', async () => {
  let record = [];
  let r = await run({ action: 'cta-assign', id: 'book', type: 'share', ref: 'atwellpub/20260610-astro-content-layer' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(putContent(record), /type: share\n\s+ref: atwellpub\/20260610-astro-content-layer/);
  assert.equal(record.find((x) => /\/git\/refs$/.test(x.url)).body.ref, 'refs/heads/hosted-admin/1/cta-assign-book-share-atwellpub-20260610-astro-content-laye', 'the branch slug is idSlug(id-type-ref), cut at 48 chars');

  record = [];
  r = await run({ action: 'cta-assign', id: 'book', type: 'prompt', ref: 'grok' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.equal(r.body.noop, true, 'already assigned');
  assert.equal(record.length, 0);

  record = [];
  r = await run({ action: 'cta-toggle', id: 'book', enabled: true }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.match(putContent(record), /enabled: true/);

  record = [];
  r = await run({ action: 'cta-toggle', id: 'book', enabled: false }, { fetchImpl: ghFetch(record) });
  assert.equal(r.body.noop, true, 'already disabled');

  record = [];
  r = await run({ action: 'cta-update', id: 'book', line: 'A new line.', note: 'why' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.match(putContent(record), /line: A new line\./);
  assert.match(putContent(record), /note: why/);

  record = [];
  r = await run({ action: 'cta-unassign', id: 'book', type: 'prompt', ref: 'grok' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.status, 200);
  assert.doesNotMatch(putContent(record), /ref: grok/);
  record = [];
  r = await run({ action: 'cta-unassign', id: 'book', type: 'prompt', ref: 'never' }, { fetchImpl: ghFetch(record) });
  assert.equal(r.body.noop, true);
});

test('the core rules reach the wire as 400s: the Amazon rule, a duplicate id, an unknown id, a bad ref', async () => {
  const cases = [
    [{ action: 'cta-add', id: 'x', label: 'L', line: 'l', button: 'b', destination: 'https://www.amazon.com/dp/1', partner: 'amazon' }, /tag= parameter/],
    [{ action: 'cta-add', id: 'x', label: 'L', line: 'l', button: 'b', destination: 'https://gbti.network/outbound/book?tag=x', partner: 'amazon' }, /straight to an amazon domain/],
    [{ action: 'cta-add', id: 'book', label: 'L', line: 'l', button: 'b', destination: AMZ, partner: 'amazon' }, /already exists/],
    [{ action: 'cta-update', id: 'nope', line: 'x' }, /no CTA with id/],
    [{ action: 'cta-update', id: 'book', destination: 'http://www.amazon.com/dp/1?tag=x' }, /absolute https URL/],
    [{ action: 'cta-assign', id: 'book', type: 'page', ref: 'x' }, /type must be one of/],
    [{ action: 'cta-assign', id: 'book', type: 'share', ref: 'no-author' }, /author\/id/],
    [{ action: 'cta-assign', id: 'book', type: 'post', ref: '../x' }, /slug/],
    [{ action: 'cta-toggle', id: 'book', enabled: 'true' }, /true or false/],
    [{ action: 'cta-add', id: 'a'.repeat(CTA_LIMITS.id + 1), label: 'L', line: 'l', button: 'b', destination: AMZ, partner: 'amazon' }, /kebab-case id/],
    [{ action: 'cta-add', id: 'x', label: 'L'.repeat(CTA_LIMITS.label + 1), line: 'l', button: 'b', destination: AMZ, partner: 'amazon' }, /label is too long/],
    [{ action: 'cta-update', id: 'book' }, /nothing to update/],
  ];
  for (const [body, re] of cases) {
    const record = [];
    const r = await run(body, { fetchImpl: ghFetch(record) });
    assert.equal(r.status, 400, `${JSON.stringify(body)} -> ${JSON.stringify(r.body)}`);
    assert.match(r.body.message, re);
    assert.equal(record.length, 0, 'a refused op writes nothing');
  }
});

test('the validators bound every text field by the core caps, exactly', () => {
  const base = { id: 'x', label: 'L', line: 'l', button: 'b', destination: AMZ, partner: 'amazon' };
  for (const k of ['label', 'line', 'button', 'destination', 'partner', 'note']) {
    const over = ctaAddInput({ ...base, [k]: 'a'.repeat(CTA_LIMITS[k] + 1) });
    assert.equal(over.ok, false, `${k} over the cap is refused`);
    assert.match(over.body.message, new RegExp(`${k} is too long`));
    const at = ctaAddInput({ ...base, [k]: 'a'.repeat(CTA_LIMITS[k]) });
    assert.equal(at.ok, true, `${k} at the cap passes the validator (the core decides the rest)`);
  }
  assert.equal(ctaAddInput({ ...base, note: undefined }).ok, true, 'note is optional');
  assert.equal(ctaAddInput({ ...base, label: undefined }).ok, false, 'the rest are required on add');
  assert.equal(ctaAddInput({ ...base, enabled: 'yes' }).ok, false);
  assert.deepEqual(ctaAddInput({ ...base, enabled: true }).args.enabled, true);
  assert.deepEqual(ctaAddInput(base).args.enabled, false, 'absent enabled is false');
  assert.equal(ctaUpdateInput({ id: 'x', note: '' }).ok, true, 'an empty note clears it on update');
  assert.equal(ctaUpdateInput({ id: 'x', label: 42 }).ok, false);
  assert.equal(ctaToggleInput({ id: 'x', enabled: true }).ok, true);
  assert.equal(ctaToggleInput({ id: 'x', enabled: 1 }).ok, false);
  assert.deepEqual(ctaAssignInput({ id: 'x', type: 'prompt', ref: ' grok ' }).args, { id: 'x', type: 'prompt', ref: 'grok' });
  assert.equal(ctaAssignInput({ id: 'x', type: 'prompt' }).ok, false);
});

test('the pool read is superadmin-gated by default and returns the FULL registry (disabled CTAs included)', async () => {
  const ok = await membershipAdminCtaPool(req({}), env, { fetchImpl: ghFetch([]), authorize: staffSuper, signJwt });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.ctas.length, 1);
  assert.equal(ok.body.ctas[0].enabled, false);
  assert.deepEqual(ok.body.types, ['prompt', 'post', 'project', 'share']);
  const no = await membershipAdminCtaPool(req({}), env, { fetchImpl: ghFetch([]), authorize: denied, signJwt });
  assert.equal(no.status, 403);
  // The DEFAULT authorizer is the superadmin one, not the admin one: pinned by source, because a deps override in
  // a test cannot see which default the route falls back to.
  const src = fs.readFileSync(path.join(ROOT, 'workers/signup/membership-admin-ctas.mjs'), 'utf8');
  assert.match(src, /authorize = authorizeSuperadmin/);
  assert.doesNotMatch(src, /authorize = authorizeAdmin\b/);
});

test('every CTA op row in the Worker is ranked superadmin and points at house/ctas.yml; the route is no-store', () => {
  const src = fs.readFileSync(path.join(ROOT, 'workers/signup/membership-admin-author.mjs'), 'utf8');
  for (const op of ['cta-add', 'cta-update', 'cta-toggle', 'cta-assign', 'cta-unassign']) {
    const m = new RegExp(`'${op}': \\{ path: 'house/ctas\\.yml', rank: ROLE_RANK\\.(\\w+)`).exec(src);
    assert.ok(m, `${op} row present in CONFIG_OP with the house/ctas.yml path`);
    assert.equal(m[1], 'superadmin', `${op} must be superadmin`);
  }
  const idx = fs.readFileSync(path.join(ROOT, 'workers/signup/index.mjs'), 'utf8');
  const at = idx.indexOf("pathname === '/membership/admin/cta-pool'");
  assert.ok(at > 0, 'the cta-pool route exists');
  assert.match(idx.slice(at, at + 600), /'Cache-Control': 'no-store'/);
});

test('both hosts route the five write actions and the pool read (npm api.mjs + extension ext-dispatch.mjs)', () => {
  for (const rel of ['client/src/api.mjs', 'extension/src/ext-dispatch.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    for (const op of ['cta-add', 'cta-update', 'cta-toggle', 'cta-assign', 'cta-unassign']) assert.match(src, new RegExp(`'${op}':\\s*\\w+`), `${rel} routes ${op}`);
    assert.match(src, /'\/api\/cta-pool'/, `${rel} serves the pool read`);
  }
  const wb = fs.readFileSync(path.join(ROOT, 'src/lib/workbench-client.ts'), 'utf8');
  for (const fn of ['ctaPool', 'addCta', 'updateCta', 'setCtaEnabled', 'assignCta', 'unassignCta']) assert.match(wb, new RegExp(`\\b${fn}\\(`), `workbench client has ${fn}`);
  const cl = fs.readFileSync(path.join(ROOT, 'client-ui/src/client.mjs'), 'utf8');
  for (const fn of ['ctaPool', 'addCta', 'updateCta', 'setCtaEnabled', 'assignCta', 'unassignCta']) assert.match(cl, new RegExp(`\\b${fn}:`), `shared client has ${fn}`);
});
