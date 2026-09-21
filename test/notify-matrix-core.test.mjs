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
  channelBlocked,
  EMAIL_DISABLED_TIP,
  EMAIL_NOTIFICATIONS_ENABLED,
} from '../client-ui/src/notify-matrix-core.mjs';

// sow-385: email notifications are switched off for now. The tests of email-ON behaviour below pass this so they keep
// proving the model for the day email returns; the sow-385 tests at the bottom prove the off state.
const EMAIL_ON = { emailEnabled: true };

test('MATRIX_ROWS carries the five design rows in order', () => {
  assert.deepEqual(
    MATRIX_ROWS.map((r) => r.key),
    ['article', 'project', 'prompt', 'share', 'news'],
  );
  assert.equal(MATRIX_ROWS.find((r) => r.key === 'prompt').label, 'Prompts and skills');
  assert.equal(MATRIX_ROWS.find((r) => r.key === 'news').label, 'News'); // sow-385: was "News they curate"
});

test('an absent global default resolves every row to the system default (api on, email off)', () => {
  const m = defaultMatrix(undefined);
  for (const r of MATRIX_ROWS) assert.deepEqual(m[r.key], { api: true, email: false }, r.key);
});

test('the global default is read per row and email stays off unless the member set it (email switched on)', () => {
  const m = defaultMatrix({ share: { api: false }, article: { email: true } }, EMAIL_ON);
  assert.deepEqual(m.share, { api: false, email: false }); // api overridden off, email fails closed off
  assert.deepEqual(m.article, { api: true, email: true }); // api falls through to system on, email turned on
  assert.deepEqual(m.project, { api: true, email: false }); // untouched -> system default
});

test('a per-follow override wins per channel, then the global default, then the system default (email switched on)', () => {
  const global = { article: { api: false, email: true } };
  const follow = { article: { api: true } }; // override only api; email must fall through to the global
  const m = resolveMatrix(follow, global, EMAIL_ON);
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

test('toggleCell flips one channel and never mutates the input (email switched on)', () => {
  const base = matrixToNotify({}); // all off
  const next = toggleCell(base, 'article', 'email', EMAIL_ON);
  assert.equal(next.article.email, true);
  assert.equal(base.article.email, false, 'input untouched');
  assert.equal(next.project.email, false, 'other rows untouched');
  const back = toggleCell(next, 'article', 'email', EMAIL_ON);
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

// sow-385 (owner, 2026-09-21): "We are not going to support email based notifications right now."

test('sow-385: email notifications are switched off, and the tooltip is the owner\'s wording verbatim', () => {
  assert.equal(EMAIL_NOTIFICATIONS_ENABLED, false);
  assert.equal(EMAIL_DISABLED_TIP, 'Email Notifications Disabled at this time');
});

test('sow-385: a member who stored email ON reads OFF, in the default grid and in a per-follow override', () => {
  const global = { article: { api: true, email: true }, share: { email: true } };
  const d = defaultMatrix(global);
  for (const r of MATRIX_ROWS) assert.equal(d[r.key].email, false, `${r.key} email reads off`);
  assert.equal(d.article.api, true, 'in app is untouched');
  const f = resolveMatrix({ project: { email: true } }, global);
  for (const r of MATRIX_ROWS) assert.equal(f[r.key].email, false, `override ${r.key} email reads off`);
  // Control: the same stored values with email switched on DO read on, so the mask is what made them off.
  assert.equal(defaultMatrix(global, EMAIL_ON).article.email, true);
});

test('sow-385: the email channel does not toggle, and in app still does', () => {
  const base = defaultMatrix(undefined);
  const tried = toggleCell(base, 'article', 'email');
  assert.equal(tried.article.email, false, 'email stays off');
  assert.notEqual(tried, base, 'still a new matrix, never the input');
  assert.equal(toggleCell(base, 'article', 'api').article.api, false, 'in app toggles as before');
});

test('sow-385: only email is blocked, and only while it is switched off', () => {
  assert.equal(channelBlocked('email'), true);
  assert.equal(channelBlocked('api'), false);
  assert.equal(channelBlocked('email', EMAIL_ON), false);
});

test('sow-385: follow summaries never mention email while it is off, whatever was stored', () => {
  const global = { article: { email: true }, share: { email: true } };
  assert.equal(summarizeFollow({}, global), 'Everything, in app only');
  assert.equal(summarizeFollow({ notify: { news: { api: false, email: true } } }, global).includes('email'), false);
  assert.equal(summarizeFollow({}, global, EMAIL_ON), 'Everything, in app and by email', 'control: with email on it would');
});
