// sow-275: a house config edit is acknowledged with what actually happens to it. A superadmin's edit merges on its
// own (sow-108), an admin's waits for code-owner review, and the managers used to tell everyone the second thing.
// The outcome is reported by whichever side opened the PR (the Worker, or the extension's admin-ops), and one
// helper turns it into the sentence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { houseEditAck } from '../client-ui/src/workspace-core.mjs';
import { membershipAdminAuthor } from '../workers/signup/membership-admin-author.mjs';
import { addQuote } from '../client/src/admin-ops.mjs';
import { createReader } from '../client/src/repo-fs.mjs';

const MERGES = /merges automatically/;
const REVIEW = /awaiting review/;

test('the ack says "merges automatically" only for an explicit autoMerge: true', () => {
  assert.match(houseEditAck({ prNumber: 42, autoMerge: true }), MERGES);
  assert.match(houseEditAck({ prNumber: 42, autoMerge: true }), /PR #42/);
  assert.match(houseEditAck({ prNumber: 42, autoMerge: false }), REVIEW);
  // A response with no field (an older Worker) or a non-boolean truthy value never promises a merge.
  assert.match(houseEditAck({ prNumber: 42 }), REVIEW);
  assert.match(houseEditAck({ prNumber: 42, autoMerge: 'true' }), REVIEW);
});

// The Worker path (the website admin page): the same quote-add, by a superadmin and by an admin.
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
function workerGitHub() {
  return async (url, init = {}) => {
    const method = init.method || 'GET';
    const ok = (body, status = 200) => ({ ok: true, status, async json() { return body; } });
    if (/\/access_tokens$/.test(url)) return ok({ token: 'ghs_inst', expires_at: new Date(Date.now() + 3600e3).toISOString() }, 201);
    if (/\/contents\/house\/quotes\.yml\?ref=main$/.test(url) && method === 'GET') return ok({ content: b64('# quotes\nquotes: []\n') });
    if (/\/git\/ref\/heads\/main$/.test(url)) return ok({ object: { sha: 'mainsha' } });
    if (/\/git\/refs$/.test(url) && method === 'POST') return ok({}, 201);
    if (/\/contents\/.+\?ref=/.test(url) && method === 'GET') return { ok: false, status: 404, async json() { return {}; } };
    if (/\/contents\//.test(url) && method === 'PUT') return ok({}, 201);
    if (/\/pulls$/.test(url) && method === 'POST') return ok({ number: 42, html_url: 'https://x/pull/42' }, 201);
    return { ok: false, status: 500, async json() { return {}; } };
  };
}
const workerEnv = { GITHUB_APP_ID: '123', GITHUB_APP_INSTALLATION_ID: '999', GITHUB_APP_PRIVATE_KEY: 'PEM', UPSTREAM_REPO: 'gbti-network/gbti.network', MEMBERSHIP_AUTHOR_ENABLED: 'true' };
const quoteAddAs = (role) => membershipAdminAuthor(
  { headers: { get: () => 'Bearer tok' }, json: async () => ({ action: 'quote-add', text: 'Hello world', author: 'Ada' }) },
  workerEnv,
  { fetchImpl: workerGitHub(), authorize: async () => ({ ok: true, githubId: role === 'superadmin' ? '1' : '2', role }),
    kv: { async get() { return null; }, async put() {} }, limiter: async () => ({ allowed: true }), signJwt: async () => 'fake.jwt.sig' },
);

test('the Worker reports autoMerge true for a superadmin quote edit and false for an admin one', async () => {
  const sup = await quoteAddAs('superadmin');
  assert.equal(sup.status, 200, JSON.stringify(sup.body));
  assert.equal(sup.body.number, 42);
  assert.equal(sup.body.autoMerge, true);
  const adm = await quoteAddAs('admin');
  assert.equal(adm.status, 200, JSON.stringify(adm.body));
  assert.equal(adm.body.autoMerge, false);
});

// The extension / npm host path: admin-ops opens the PR with the editor's own token.
function fakeRepo() {
  return {
    upstream: 'gbti-network/gbti.network',
    async ensureFork() { return { full_name: 'hudson/gbti.network', owner: 'hudson' }; },
    async getDefaultBranch() { return 'main'; },
    async getBranchSha() { return 'sha'; },
    async ensureBranch() {},
    async getFileSha() { return null; },
    async putFile() {},
    async deleteFile() {},
    async findOpenPull() { return null; },
    async openPull() { return { number: 77, html_url: 'u' }; },
  };
}
function ctxFor(role) {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-quote-ack-'));
  fs.mkdirSync(path.join(repoPath, 'house'), { recursive: true });
  fs.writeFileSync(path.join(repoPath, 'house', 'quotes.yml'), '# quotes\nquotes: []\n');
  fs.writeFileSync(path.join(repoPath, 'house', 'roles.yml'), 'superadmins: []\nadmins: []\nmoderators: []\n');
  return {
    role: () => role, getRepoClient: () => fakeRepo(), reader: createReader(repoPath),
    store: { get: (k) => ({ repoPath, githubToken: 't' })[k] }, now: () => '2026-09-14T12:00:00Z',
    identity: () => ({ githubId: '1', login: 'hudson' }),
    fetch: async () => ({ ok: true, json: async () => ({ synced: true }) }),
  };
}

test('admin-ops reports autoMerge true for a superadmin quote edit and false for an admin one', async () => {
  const sup = await addQuote(ctxFor('superadmin'), { text: 'Hello world', author: 'Ada' });
  assert.equal(sup.prNumber, 77);
  assert.equal(sup.autoMerge, true);
  assert.match(houseEditAck(sup), MERGES);
  const adm = await addQuote(ctxFor('admin'), { text: 'Hello world', author: 'Ada' });
  assert.equal(adm.autoMerge, false);
  assert.match(houseEditAck(adm), REVIEW);
});

test('no house config manager hardcodes the review wording any more', () => {
  const dir = new URL('../client-ui/src/elements/', import.meta.url);
  const managers = ['gbti-category-manager.mjs', 'gbti-channel-map-manager.mjs', 'gbti-news-source-manager.mjs', 'gbti-quote-manager.mjs', 'gbti-site-settings-manager.mjs'];
  for (const m of managers) {
    const src = fs.readFileSync(new URL(m, dir), 'utf8');
    assert.doesNotMatch(src, /autoMerge:\s*false/, `${m} still passes a hardcoded autoMerge: false`);
    assert.match(src, /houseEditAck\(r\)/, `${m} does not acknowledge through houseEditAck`);
  }
});
