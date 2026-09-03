// SOW-186 C3: the pure matrix model behind the account notifications settings. No DOM; node-testable.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MATRIX_ROWS,
  resolveMatrix,
  defaultMatrix,
  matrixToNotify,
  toggleCell,
  isCustomFollow,
  summarizeFollow,
  summarizeMatrix,
  notifyPayload,
} from '../client-ui/src/notify-matrix-core.mjs';

test('MATRIX_ROWS carries the five design rows in order', () => {
  assert.deepEqual(
    MATRIX_ROWS.map((r) => r.key),
    ['article', 'project', 'prompt', 'share', 'news'],
  );
  assert.equal(MATRIX_ROWS.find((r) => r.key === 'prompt').label, 'Prompts and skills');
  assert.equal(MATRIX_ROWS.find((r) => r.key === 'news').label, 'News they curate');
});

test('an absent global default resolves every row to the system default (api on, email off)', () => {
  const m = defaultMatrix(undefined);
  for (const r of MATRIX_ROWS) assert.deepEqual(m[r.key], { api: true, email: false }, r.key);
});

test('the global default is read per row and email stays off unless the member set it', () => {
  const m = defaultMatrix({ share: { api: false }, article: { email: true } });
  assert.deepEqual(m.share, { api: false, email: false }); // api overridden off, email fails closed off
  assert.deepEqual(m.article, { api: true, email: true }); // api falls through to system on, email turned on
  assert.deepEqual(m.project, { api: true, email: false }); // untouched -> system default
});

test('a per-follow override wins per channel, then the global default, then the system default', () => {
  const global = { article: { api: false, email: true } };
  const follow = { article: { api: true } }; // override only api; email must fall through to the global
  const m = resolveMatrix(follow, global);
  assert.deepEqual(m.article, { api: true, email: true });
  assert.deepEqual(m.project, { api: true, email: false }); // neither set -> system default
});

test('matrixToNotify serializes all five rows explicitly, coercing to booleans', () => {
  const notify = matrixToNotify({ article: { api: true, email: true }, share: { email: true } });
  assert.deepEqual(notify, {
    article: { api: true, email: true },
    project: { api: false, email: false },
    prompt: { api: false, email: false },
    share: { api: false, email: true },
    news: { api: false, email: false },
  });
});

test('toggleCell flips one channel and never mutates the input', () => {
  const base = matrixToNotify({}); // all off
  const next = toggleCell(base, 'article', 'email');
  assert.equal(next.article.email, true);
  assert.equal(base.article.email, false, 'input untouched');
  assert.equal(next.project.email, false, 'other rows untouched');
  const back = toggleCell(next, 'article', 'email');
  assert.equal(back.article.email, false);
});

test('isCustomFollow distinguishes an override from a default-mode follow', () => {
  assert.equal(isCustomFollow({ notify: { article: { api: false } } }), true);
  assert.equal(isCustomFollow({ notify: null }), false);
  assert.equal(isCustomFollow({ notify: {} }), false);
  assert.equal(isCustomFollow({}), false);
  assert.equal(isCustomFollow(undefined), false);
});

test('summarizeMatrix reads the muted, everything, and partial cases', () => {
  const allOff = matrixToNotify({}); // every cell false
  assert.equal(summarizeMatrix(allOff), 'Muted, nothing arrives');

  const allApi = {};
  for (const r of MATRIX_ROWS) allApi[r.key] = { api: true, email: false };
  assert.equal(summarizeMatrix(allApi), 'Everything, in app only');

  const allBoth = {};
  for (const r of MATRIX_ROWS) allBoth[r.key] = { api: true, email: true };
  assert.equal(summarizeMatrix(allBoth), 'Everything, in app and by email');

  const partial = matrixToNotify({ article: { api: true }, project: { api: true } });
  assert.equal(summarizeMatrix(partial), 'Articles, projects');

  const partialMail = matrixToNotify({ article: { api: true, email: true }, project: { api: true } });
  assert.equal(summarizeMatrix(partialMail), 'Articles, projects, email on');
});

test('summarizeFollow resolves a default-mode follow against the global default', () => {
  // A follow with no override inherits the global default; here the global mutes everything.
  const global = {};
  for (const r of MATRIX_ROWS) global[r.key] = { api: false, email: false };
  assert.equal(summarizeFollow({ notify: null }, global), 'Muted, nothing arrives');
  // With no global set, the system default (api on) applies to every row.
  assert.equal(summarizeFollow({ notify: null }, undefined), 'Everything, in app only');
});

test('notifyPayload returns a full object for custom and null for default (clears the override)', () => {
  const matrix = matrixToNotify({ article: { api: true } });
  assert.deepEqual(notifyPayload('custom', matrix).article, { api: true, email: false });
  assert.equal(notifyPayload('default', matrix), null);
});
