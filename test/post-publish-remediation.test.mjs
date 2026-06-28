// SOW-076 Phase 3: the pure post-publish remediation planner. No IO.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseError, planRemediation, flipFilesToDraft } from '../scripts/lib/post-publish-remediation.mjs';

const POST = 'members/alice/posts/x/index.md';
const HOUSE = 'house/products/y/index.md';

test('parseError extracts a content-path file prefix; a global error has no file', () => {
  assert.deepEqual(parseError(`${POST}: categories must be an array path`), { file: POST, message: 'categories must be an array path' });
  assert.deepEqual(parseError(HOUSE + ': bad'), { file: HOUSE, message: 'bad' });
  assert.deepEqual(parseError('duplicate slug "x" across two folders'), { file: '', message: 'duplicate slug "x" across two folders' });
  // a colon in the message does not confuse the split (file = the path before the FIRST ": ")
  assert.deepEqual(parseError(`${POST}: bad value: see SOW-016`), { file: POST, message: 'bad value: see SOW-016' });
  // a non-content path (not flippable) is treated as global
  assert.equal(parseError('README.md: x').file, '');
});

test('planRemediation flips only PUBLISHED content items; everything else is alert-only', () => {
  const errors = [
    `${POST}: invalid category`,                 // published content -> flip
    `${HOUSE}: bad status`,                       // a DRAFT content item -> alert only (already not public)
    'duplicate slug "z" across folders',          // global -> alert only
    'members/bob/posts/q/index.md: x',            // not in publishedFiles -> alert only
  ];
  const out = planRemediation({ errors, publishedFiles: [POST] });
  assert.deepEqual(out.flip, [POST]);
  assert.equal(out.alertOnly.length, 3);
  assert.ok(out.alertOnly.some((e) => e.file === HOUSE));
  assert.ok(out.alertOnly.some((e) => e.file === '' && /duplicate/.test(e.message)));
});

test('planRemediation dedupes multiple errors on one file + accepts pre-parsed objects', () => {
  const out = planRemediation({
    errors: [`${POST}: a`, { file: POST, message: 'b' }, `${POST}: c`],
    publishedFiles: new Set([POST]),
  });
  assert.deepEqual(out.flip, [POST]); // one flip despite three errors
  assert.equal(out.alertOnly.length, 0);
});

test('empty / all-valid -> nothing to do', () => {
  assert.deepEqual(planRemediation({ errors: [], publishedFiles: [POST] }), { flip: [], alertOnly: [] });
});

// ---- the flip-to-draft IO (fake github) ----

function fakeGithub(initial = {}) {
  const store = new Map(Object.entries(initial));
  const calls = { put: [], pulls: [], merged: [], branch: null };
  const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
  return {
    store, calls,
    async getContent(path) { const v = store.get(path); return v == null ? null : { content: b64(v), sha: 'sha-' + path }; },
    async getRef() { return { object: { sha: 'base-sha' } }; },
    async createRef(branch) { calls.branch = branch; },
    async putContent(path, { content, message }) { store.set(path, Buffer.from(content, 'base64').toString('utf8')); calls.put.push({ path, message }); },
    async createPull(p) { calls.pulls.push(p); return { number: 99, html_url: 'u' }; },
    async mergePull(n) { calls.merged.push(n); },
  };
}
const published = '---\ntitle: x\nstatus: published\n---\nbody';
const draftItem = '---\ntitle: x\nstatus: draft\n---\nbody';

test('flipFilesToDraft opens ONE auto-merged PR flipping published items to draft', async () => {
  const gh = fakeGithub({ [POST]: published });
  const r = await flipFilesToDraft({ github: gh, files: [POST], now: new Date(1000) });
  assert.equal(r.flipped, 1);
  assert.equal(r.pr, 99);
  assert.equal(gh.calls.merged.length, 1);
  assert.match(gh.store.get(POST), /status: draft/); // the published item is now draft
});

test('flipFilesToDraft is a no-op (no PR) when the file is already draft or missing', async () => {
  const gh = fakeGithub({ [POST]: draftItem });
  const r = await flipFilesToDraft({ github: gh, files: [POST, 'members/bob/posts/q/index.md'] });
  assert.equal(r.flipped, 0);
  assert.equal(gh.calls.pulls.length, 0); // nothing changed -> no diff-less PR
});

test('flipFilesToDraft is a reported no-op without a github client', async () => {
  assert.match((await flipFilesToDraft({ github: null, files: [POST] })).reason, /no GitHub client/);
});
