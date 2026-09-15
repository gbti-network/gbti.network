// sow-337: the extension and npm writer (client/src/admin-ops.mjs) commits a card image beside house/ctas.yml in
// the same pull request, as raw bytes, under the same check and file name the Worker route uses. A fake repo
// records every put and delete; a temp clone supplies the registry through the real reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createReader } from '../client/src/repo-fs.mjs';
import { addCta, updateCta } from '../client/src/admin-ops.mjs';
import { OperationError } from '../client/src/operations.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const COVER = fs.readFileSync(path.join(ROOT, 'house/images/ctas/stranger-in-a-strange-land.webp'));
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';

function fakeRepo({ existing = [] } = {}) {
  const writes = [], pulls = [];
  return {
    upstream: 'gbti-network/gbti.network', writes, pulls,
    async ensureFork() { return { full_name: 'hudson/gbti.network', owner: 'hudson' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha(r, p) { return existing.includes(p) ? `sha-${p}` : null; },
    async putFile(r, p, opts) { writes.push({ op: 'put', path: p, contentBase64: opts.contentBase64, branch: opts.branch }); },
    async deleteFile(r, p, opts) { writes.push({ op: 'delete', path: p, sha: opts.sha }); },
    async findOpenPull() { return null; },
    async forceBranch() {},
    async openPull(opts) { pulls.push(opts); return { number: 5, html_url: 'u' }; },
  };
}
function seed(card = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-cta-img-'));
  fs.mkdirSync(path.join(dir, 'house'), { recursive: true });
  const doc = { ctas: [{ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get it', destination: AMZ, partner: 'amazon', enabled: true, items: [], ...card }] };
  fs.writeFileSync(path.join(dir, 'house', 'ctas.yml'), `# header\n${yaml.dump(doc)}`);
  return dir;
}
const ctxFor = (repoPath, repo, role = 'superadmin') => ({
  role: () => role, getRepoClient: () => repo, reader: createReader(repoPath),
  store: { get: (k) => ({ repoPath, githubToken: 't' })[k] }, now: () => '2026-09-15T20:00:00Z',
  identity: () => ({ githubId: '1', login: 'hudson' }),
  fetch: async () => ({ ok: true, json: async () => ({ synced: true }) }),
});

test('an update with an image writes the registry and the image in one PR, the image as raw bytes', async () => {
  const repo = fakeRepo();
  const r = await updateCta(ctxFor(seed(), repo), { id: 'book', layout: 'below', imageBase64: COVER.toString('base64') });
  assert.equal(r.changed, true);
  assert.deepEqual(repo.writes.map((w) => `${w.op} ${w.path}`), ['put house/ctas.yml', 'put house/images/ctas/book.webp']);
  // .equals, not deepEqual: a failing deepEqual on two large buffers builds a diff big enough to kill the runner.
  assert.ok(Buffer.from(repo.writes[1].contentBase64, 'base64').equals(COVER), 'the image bytes arrive unchanged, not re-encoded as text');
  const reg = Buffer.from(repo.writes[0].contentBase64, 'base64').toString('utf8');
  assert.match(reg, /^# header\n/);
  assert.equal(yaml.load(reg).ctas[0].image, 'book.webp');
  assert.equal(repo.pulls.length, 1);
});

test('a replaced image alone still publishes; a removed image is deleted with its sha', async () => {
  let repo = fakeRepo({ existing: ['house/images/ctas/book.webp'] });
  await updateCta(ctxFor(seed({ layout: 'below', image: 'book.webp' }), repo), { id: 'book', imageBase64: COVER.toString('base64') });
  assert.deepEqual(repo.writes.map((w) => `${w.op} ${w.path}`), ['put house/images/ctas/book.webp']);
  repo = fakeRepo({ existing: ['house/images/ctas/book.webp'] });
  await updateCta(ctxFor(seed({ image: 'book.webp' }), repo), { id: 'book', removeImage: true });
  assert.deepEqual(repo.writes.map((w) => `${w.op} ${w.path}`), ['put house/ctas.yml', 'delete house/images/ctas/book.webp']);
  assert.equal(repo.writes[1].sha, 'sha-house/images/ctas/book.webp');
});

test('the same refusals as the Worker, before anything is written; a caller-named file is ignored', async () => {
  const exif = 'UklGRjABAABXRUJQVlA4WAoAAAAIAAAACAAABgAAVlA4ICYAAABwAQCdASoJAAcAAsBMJaACdAFAAAD+3FFB8XL/+QY/wa/zD5rgAEVYSUbkAAAARXhpZgAASUkqAAgAAAAIAA8BAgARAAAAfgAAABABAgADAAAAVDEAABIBAwABAAAAAQAAABoBBQABAAAAbgAAABsBBQABAAAAdgAAACgBAwABAAAAAgAAABMCAwABAAAAAQAAAGmHBAABAAAAkAAAAAAAAAA4YwAA6AMAADhjAADoAwAAR0JUSSB0ZXN0IGNhbWVyYQAABgAAkAcABAAAADAyMTABkQcABAAAAAECAwAAoAcABAAAADAxMDABoAMAAQAAAP//AAACoAQAAQAAAAkAAAADoAQAAQAAAAcAAAAAAAAA';
  for (const [call, re] of [
    [(ctx) => updateCta(ctx, { id: 'book', imageBase64: exif }), /metadata/],
    [(ctx) => updateCta(ctx, { id: 'book', imageBase64: 'nope!' }), /not valid base64/],
    [(ctx) => updateCta(ctx, { id: 'book', imageBase64: COVER.toString('base64'), removeImage: true }), /not both/],
    [(ctx) => addCta(ctx, { id: 'x', label: 'L', line: 'l', button: 'b', destination: AMZ, partner: 'amazon', removeImage: true }), /no image to remove/],
    [(ctx) => updateCta(ctx, { id: 'book', layout: 'image' }), /image is required for the image layout/],
  ]) {
    const repo = fakeRepo();
    await assert.rejects(call(ctxFor(seed(), repo)), (e) => e instanceof OperationError && e.code === 'bad-request' && re.test(e.message));
    assert.equal(repo.writes.length, 0);
  }
  const repo = fakeRepo();
  const r = await updateCta(ctxFor(seed(), repo), { id: 'book', image: 'other-card.webp' });
  assert.equal(r.changed, false, 'a file name from the caller is not an edit');
  assert.equal(repo.writes.length, 0);
  await assert.rejects(updateCta(ctxFor(seed(), fakeRepo(), 'admin'), { id: 'book', imageBase64: COVER.toString('base64') }), (e) => e.code === 'forbidden');
});
