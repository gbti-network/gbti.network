// sow-337: the Worker's card writes with an image. A card add or update may carry the admin's re-encoded WebP; the
// route checks the bytes before any GitHub read, names the file after the card, and commits the image beside
// house/ctas.yml in the same PR, byte for byte. Removing an image deletes the file no card names any more. The
// sow-281 behaviour of the text-only writes is in membership-cta-admin.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { ctaAddInput, ctaUpdateInput } from '../workers/signup/membership-admin-ctas.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const env = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const staffSuper = async () => ({ ok: true, githubId: '1', role: 'superadmin' });
const allow = async () => ({ allowed: true });
const signJwt = async () => 'fake.jwt.sig';
const req = (body) => ({ headers: { get: () => 'Bearer tok' }, json: async () => body });
const kv = { async get() { return null; }, async put() {} };
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const COVER = fs.readFileSync(path.join(ROOT, 'house/images/ctas/stranger-in-a-strange-land.webp'));
const COVER_B64 = COVER.toString('base64');
// A real sharp encode carrying an EXIF block (the sample test/cta-image.test.mjs reads chunk by chunk).
const EXIF_B64 = 'UklGRjABAABXRUJQVlA4WAoAAAAIAAAACAAABgAAVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAEVYSUbkAAAARXhpZgAASUkqAAgAAAAIAA8BAgARAAAAfgAAABABAgADAAAAVDEAABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAkAAAAAAAAAA4YwAA6AMAADhjAADoAwAAR0JUSSB0ZXN0IGNhbWVyYQAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAkAAAADoAQAAQAAAAcAAAAAAAAA';
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADklEQVR4nGP4DwYMEAoAU7oL9ZisIGcAAAAASUVORK5CYII=';

const registry = (card = {}) => `# leading comment\n${yaml.dump({ ctas: [{ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get the book on Amazon', destination: AMZ, partner: 'amazon', enabled: true, items: [], ...card }] }, { lineWidth: 100 })}`;

/** A fake GitHub. Every request is recorded; `existing` names the branch files that already have a blob sha. */
function ghFetch(record, { file = registry(), existing = [] } = {}) {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    record.push({ method, url, body: init.body ? JSON.parse(init.body) : null });
    if (/\/app\/installations\/\d+\/access_tokens$/.test(url)) return { ok: true, status: 201, async json() { return { token: 'inst' }; } };
    if (/\/contents\/house\/ctas\.yml\?ref=main$/.test(url)) return { ok: true, status: 200, async json() { return { content: Buffer.from(file).toString('base64'), sha: 'abc' }; } };
    if (/\/git\/ref\/heads\/main$/.test(url)) return { ok: true, status: 200, async json() { return { object: { sha: 'mainsha' } }; } };
    if (/\/git\/refs$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return {}; } };
    const m = /\/contents\/(.+)\?ref=/.exec(url);
    if (m && method === 'GET') return existing.includes(m[1]) ? { ok: true, status: 200, async json() { return { sha: `sha-${m[1]}` }; } } : { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && (method === 'PUT' || method === 'DELETE')) return { ok: true, status: 200, async json() { return {}; } };
    if (/\/pulls$/.test(url) && method === 'POST') return { ok: true, status: 201, async json() { return { number: 9, html_url: 'https://x/pull/9' }; } };
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const run = (body, fetchImpl) => membershipAdminAuthor(req(body), env, { fetchImpl, authorize: staffSuper, kv, limiter: allow, signJwt });
const writes = (record) => record.filter((r) => r.method === 'PUT' || r.method === 'DELETE').map((r) => ({ method: r.method, path: /\/contents\/(.+)$/.exec(r.url)[1], body: r.body }));
const githubReads = (record) => record.filter((r) => /api\.github\.com\/repos\//.test(r.url));

test('an update with an image commits the registry and the image in one PR, the image byte for byte as sent', async () => {
  const record = [];
  const r = await run({ action: 'cta-update', id: 'book', layout: 'below', imageBase64: COVER_B64 }, ghFetch(record));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.number, 9);
  const w = writes(record);
  assert.deepEqual(w.map((x) => `${x.method} ${x.path}`), ['PUT house/ctas.yml', 'PUT house/images/ctas/book.webp']);
  const reg = Buffer.from(w[0].body.content, 'base64').toString('utf8');
  assert.match(reg, /^# leading comment\n/);
  assert.match(reg, /layout: below\n[\s\S]*image: book\.webp\n/);
  // .equals and a boolean, not a string or buffer diff: a failing diff this large can kill the runner.
  assert.ok(w[1].body.content === COVER_B64, 'the image is passed through, not re-encoded as text');
  assert.ok(Buffer.from(w[1].body.content, 'base64').equals(COVER));
  assert.equal(w[1].body.branch, 'hosted-admin/1/cta-update-book');
  assert.equal(record.filter((x) => /\/pulls$/.test(x.url)).length, 1, 'one PR');
});

test('replacing the image of a card that already names it writes only the image, and is not a no-op', async () => {
  const record = [];
  const r = await run({ action: 'cta-update', id: 'book', imageBase64: COVER_B64 }, ghFetch(record, { file: registry({ layout: 'below', image: 'book.webp' }), existing: ['house/images/ctas/book.webp'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.noop, undefined);
  const w = writes(record);
  assert.deepEqual(w.map((x) => `${x.method} ${x.path}`), ['PUT house/images/ctas/book.webp']);
  assert.equal(w[0].body.sha, 'sha-house/images/ctas/book.webp', 'an overwrite carries the existing blob sha');
});

test('removing the image clears it from the card and deletes the file no card names any more', async () => {
  const record = [];
  const r = await run({ action: 'cta-update', id: 'book', removeImage: true }, ghFetch(record, { file: registry({ image: 'book.webp' }), existing: ['house/images/ctas/book.webp'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = writes(record);
  assert.deepEqual(w.map((x) => `${x.method} ${x.path}`), ['PUT house/ctas.yml', 'DELETE house/images/ctas/book.webp']);
  assert.doesNotMatch(Buffer.from(w[0].body.content, 'base64').toString('utf8'), /image:/);
  assert.equal(w[1].body.sha, 'sha-house/images/ctas/book.webp');
});

test('an image another card still names is kept when one card drops it', async () => {
  const two = `ctas:\n${yaml.dump([{ id: 'book', label: 'A', line: 'l', button: 'b', destination: AMZ, partner: 'amazon', image: 'book.webp' }, { id: 'other', label: 'B', line: 'l', button: 'b', destination: AMZ, partner: 'amazon', layout: 'below', image: 'book.webp' }]).replace(/^/gm, '  ')}`;
  const record = [];
  const r = await run({ action: 'cta-update', id: 'book', removeImage: true }, ghFetch(record, { file: two, existing: ['house/images/ctas/book.webp'] }));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(writes(record).map((x) => `${x.method} ${x.path}`), ['PUT house/ctas.yml']);
});

test('an add with an image names the file after the new card', async () => {
  const record = [];
  const r = await run({ action: 'cta-add', id: 'cover-card', label: 'Cover', layout: 'image', destination: AMZ, partner: 'amazon', imageBase64: COVER_B64 }, ghFetch(record));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(writes(record).map((x) => `${x.method} ${x.path}`), ['PUT house/ctas.yml', 'PUT house/images/ctas/cover-card.webp']);
});

test('a refused image costs no GitHub read: metadata, not a WebP, oversize, not base64, both upload and remove', async () => {
  const cases = [
    [{ action: 'cta-update', id: 'book', imageBase64: EXIF_B64 }, /metadata/],
    [{ action: 'cta-update', id: 'book', imageBase64: PNG_B64 }, /not a WebP/],
    [{ action: 'cta-update', id: 'book', imageBase64: 'A'.repeat(540_000) }, /over the 400 KB limit/],
    [{ action: 'cta-update', id: 'book', imageBase64: 'not base64!' }, /not valid base64/],
    [{ action: 'cta-update', id: 'book', imageBase64: 42 }, /base64 text/],
    [{ action: 'cta-update', id: 'book', imageBase64: COVER_B64, removeImage: true }, /not both/],
    [{ action: 'cta-update', id: 'book', removeImage: 'yes' }, /removeImage must be true or false/],
    [{ action: 'cta-add', id: 'x', label: 'L', partner: 'amazon', destination: AMZ, removeImage: true }, /no image to remove/],
    [{ action: 'cta-update', id: 'book', icon: 'FaAmazon' }, /icon must be an icon object/],
    [{ action: 'cta-update', id: 'book', hosts: 'https://a.example.com' }, /hosts must be a list/],
    [{ action: 'cta-update', id: 'book', showTitle: 'no' }, /showTitle must be true or false/],
    [{ action: 'cta-update', id: 'book', layout: 'x'.repeat(17) }, /layout is too long/],
  ];
  for (const [body, re] of cases) {
    const record = [];
    const r = await run(body, ghFetch(record));
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 120)} -> ${JSON.stringify(r.body)}`);
    assert.match(r.body.message, re);
    assert.equal(githubReads(record).length, 0, 'refused before any GitHub read');
  }
});

test('the core rules for the new parts reach the wire as 400s, and nothing is written', async () => {
  const cases = [
    [{ action: 'cta-update', id: 'book', layout: 'below' }, /image is required for the below layout/],
    [{ action: 'cta-update', id: 'book', line: null }, /line is required for the text layout/],
    [{ action: 'cta-update', id: 'book', hosts: ['https://a.example.com; script-src *'] }, /bare https origin/],
    [{ action: 'cta-update', id: 'book', icon: { name: 'FaX', set: 'Font Awesome 5', viewBox: '0 0 1 1', shapes: [{ tag: 'script' }] } }, /element "script" is not allowed/],
    [{ action: 'cta-update', id: 'book', layout: 'html', html: '<a href="https://www.amazon.com/dp/1">x</a>' }, /without the Associates tag/],
    [{ action: 'cta-add', id: 'x', label: 'L', partner: 'example', destination: 'https://example.com/' }, /line is required for the text layout/],
  ];
  for (const [body, re] of cases) {
    const record = [];
    const r = await run(body, ghFetch(record));
    assert.equal(r.status, 400, `${JSON.stringify(body).slice(0, 120)} -> ${JSON.stringify(r.body)}`);
    assert.match(r.body.message, re);
    assert.equal(writes(record).length, 0, 'a refused edit writes nothing');
  }
});

test('the validators carry the parts through and never take a file name from the client', () => {
  const icon = { name: 'FaAmazon', set: 'Font Awesome 5', viewBox: '0 0 1 1', shapes: [{ tag: 'path', attrs: { d: 'M0 0' } }] };
  const add = ctaAddInput({ id: 'x', label: 'L', partner: 'amazon', layout: ' html ', html: '<b>x</b>', icon, hosts: [' https://a.example.com '], showTitle: false, image: '../roles.yml' });
  assert.equal(add.ok, true, JSON.stringify(add));
  assert.deepEqual(add.args, { id: 'x', label: 'L', partner: 'amazon', layout: 'html', html: '<b>x</b>', icon, hosts: ['https://a.example.com'], showTitle: false, enabled: false });
  assert.equal(add.upload, null);
  const clear = ctaUpdateInput({ id: 'x', icon: null, hosts: null, showTitle: null, layout: null });
  assert.deepEqual(clear.args, { id: 'x', layout: null, icon: null, hosts: null, showTitle: null });
  const img = ctaUpdateInput({ id: 'x', imageBase64: COVER_B64 });
  assert.deepEqual(img.args, { id: 'x', image: 'x.webp' });
  assert.equal(img.upload.path, 'house/images/ctas/x.webp');
  assert.equal(ctaUpdateInput({ id: 'x', image: 'x.webp' }).ok, false, 'a bare file name is not an update');
});

test('an update carries the pages and the enabled state in the same one-file PR', async () => {
  const record = [];
  const r = await run({ action: 'cta-update', id: 'book', enabled: false, items: [{ type: 'post', ref: 'an-article' }, { type: 'share', ref: 'atwellpub/20260610-x' }] }, ghFetch(record));
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const w = writes(record);
  assert.deepEqual(w.map((x) => `${x.method} ${x.path}`), ['PUT house/ctas.yml']);
  const card = yaml.load(Buffer.from(w[0].body.content, 'base64').toString('utf8')).ctas[0];
  assert.equal(card.enabled, false);
  assert.deepEqual(card.items, [{ type: 'post', ref: 'an-article' }, { type: 'share', ref: 'atwellpub/20260610-x' }]);
  for (const [body, re] of [
    [{ action: 'cta-update', id: 'book', items: 'post:x' }, /items must be a list/],
    [{ action: 'cta-update', id: 'book', items: [{ type: 'post', ref: '../x' }] }, /well-formed ref/],
    [{ action: 'cta-update', id: 'book', enabled: 'yes' }, /enabled must be true or false/],
  ]) {
    const rec = [];
    const bad = await run(body, ghFetch(rec));
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    assert.match(bad.body.message, re);
    assert.equal(githubReads(rec).length, 0);
  }
});
