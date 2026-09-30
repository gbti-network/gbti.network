// sow-425: an extension admin save said "awaiting review" even when its pull request merged on its own. Every admin
// write in the extension goes through governanceAdminOp, which dropped the Worker's autoMerge flag, so houseEditAck
// never saw true. The flag is now relayed exactly as sent, and absent stays absent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { governanceAdminOp } from '../client/src/operations-admin.mjs';
import { houseEditAck } from '../client-ui/src/workspace-core.mjs';

const ROLES_YML = "superadmins:\n  - github_id: '1'\nadmins: []\nmoderators: []\n";
const ctxFor = (response) => ({
  identity: () => ({ username: 'root', githubId: '1' }),
  reader: { readFile: async (p) => (p === 'house/roles.yml' ? ROLES_YML : '') },
  store: { get: (k) => (k === 'githubToken' ? 'tok' : null) },
  fetch: async () => ({ ok: true, status: 200, async json() { return response; } }),
});
const PR = { ok: true, number: 12, html_url: 'https://github.com/x/pull/12' };

test('a superadmin save that merges on its own says so', async () => {
  const r = await governanceAdminOp(ctxFor({ ...PR, autoMerge: true }), { action: 'quote-add', text: 'x' });
  assert.equal(r.autoMerge, true);
  assert.equal(houseEditAck(r), 'Submitted (PR #12). It merges automatically and appears shortly.');
});

test('a save that waits for review still says so', async () => {
  const r = await governanceAdminOp(ctxFor({ ...PR, autoMerge: false }), { action: 'quote-add', text: 'x' });
  assert.equal(r.autoMerge, false);
  assert.equal(houseEditAck(r), 'Submitted (PR #12). It is awaiting review.');
});

test('a reply without the flag (an older Worker) is not promised a merge', async () => {
  const r = await governanceAdminOp(ctxFor(PR), { action: 'quote-add', text: 'x' });
  assert.equal('autoMerge' in r, false);
  assert.equal(houseEditAck(r), 'Submitted (PR #12). It is awaiting review.');
  const odd = await governanceAdminOp(ctxFor({ ...PR, autoMerge: 'yes' }), { action: 'quote-add', text: 'x' });
  assert.equal('autoMerge' in odd, false, 'only a real boolean is relayed');
});

test('the extension hands the op result to the admin screens unchanged', () => {
  assert.match(readFileSync(new URL('../extension/src/ext-dispatch.mjs', import.meta.url), 'utf8'),
    /return ok\(await governanceAdminOp\(ctx, \{ action: wreq\.action, \.\.\.wreq\.payload \}\)\);/);
});

// sow-425 item 3, the website half: the Worker's `membership_required` becomes `membership-required`, the code every
// decrypting component shows its members message for (the extension host already maps a 403 to it).
test('the website turns the Worker\'s members code into the one its components read', () => {
  const src = readFileSync(new URL('../src/lib/workbench-client.ts', import.meta.url), 'utf8');
  assert.match(src, /if \(e\?\.code === 'membership_required'\) throw err\('membership-required', e\.message \|\| 'This is for members\.'\);/);
  for (const f of ['gbti-locked-content', 'gbti-discussion', 'gbti-shares-feed', 'gbti-reader']) {
    assert.match(readFileSync(new URL(`../client-ui/src/elements/${f}.mjs`, import.meta.url), 'utf8'), /err\?\.code === 'membership-required'/, f);
  }
});
