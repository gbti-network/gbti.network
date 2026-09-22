// sow-386: the settings side of the News row. News is new stories from the news sources a member follows, members
// only (owner ruling 2026-09-22), so a free account sees it locked with the tooltip "News alerts are for members",
// and the per-person settings (one followed member) have no News row at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MATRIX_ROWS, PERSON_ROWS, NEWS_MEMBERS_TIP, EMAIL_DISABLED_TIP, cellBlockedTip, resolveMatrix, defaultMatrix,
  toggleCell, matrixToNotify, summarizeFollow, notifyPayload,
} from '../client-ui/src/notify-matrix-core.mjs';
import { notifyPillHtml } from '../client-ui/src/elements/notify-pill.mjs';

test('the tooltip is the owner\'s wording', () => {
  assert.equal(NEWS_MEMBERS_TIP, 'News alerts are for members');
});

test('the per-person rows are the grid minus News', () => {
  assert.deepEqual(PERSON_ROWS.map((r) => r.key), ['article', 'project', 'prompt', 'share']);
  assert.ok(MATRIX_ROWS.some((r) => r.key === 'news'), 'the account grid keeps its News row');
});

test('News is blocked for a free account only, and Email stays blocked for everyone', () => {
  assert.equal(cellBlockedTip('news', 'api', { paid: false }), NEWS_MEMBERS_TIP);
  assert.equal(cellBlockedTip('news', 'api', { paid: true }), '');
  assert.equal(cellBlockedTip('article', 'api', { paid: false }), '', 'a free account keeps every person row');
  assert.equal(cellBlockedTip('news', 'email', { paid: false }), EMAIL_DISABLED_TIP, 'email says why email is off');
  assert.equal(cellBlockedTip('news', 'email', { paid: true }), EMAIL_DISABLED_TIP);
});

test('a free account\'s News row reads OFF whatever is stored; a paying one reads what is stored', () => {
  assert.deepEqual(defaultMatrix({}, { paid: false }).news, { api: false, email: false });
  assert.equal(defaultMatrix({}, { paid: true }).news.api, true, 'on by default, like every row');
  assert.equal(defaultMatrix({ news: { api: false } }, { paid: true }).news.api, false);
});

test('a free account cannot toggle News; a paying one can', () => {
  const free = defaultMatrix({}, { paid: false });
  assert.deepEqual(toggleCell(free, 'news', 'api', { paid: false }).news, free.news);
  const paid = defaultMatrix({}, { paid: true });
  assert.equal(toggleCell(paid, 'news', 'api', { paid: true }).news.api, false);
});

test('saving another row as a free account keeps the stored News value instead of writing the locked display', () => {
  const stored = { news: { api: true, email: false }, article: { api: true, email: false } };
  const m = toggleCell(defaultMatrix(stored, { paid: false }), 'article', 'api', { paid: false });
  const saved = matrixToNotify(m, { paid: false, global: stored });
  assert.deepEqual(saved.news, { api: true, email: false }, 'the member who pays later still has News on');
  assert.equal(saved.article.api, false, 'the row they changed is saved');
  const none = matrixToNotify(defaultMatrix({}, { paid: false }), { paid: false, global: {} });
  assert.equal('news' in none, false, 'nothing stored stays absent, so it keeps falling to the default');
});

test('a paying member saves News like any other row', () => {
  const m = toggleCell(defaultMatrix({}, { paid: true }), 'news', 'api', { paid: true });
  assert.deepEqual(matrixToNotify(m, { paid: true }).news, { api: false, email: false });
});

test('the per-person modal writes only the person rows', () => {
  const m = resolveMatrix({ article: { api: false } }, {}, { rows: PERSON_ROWS });
  assert.deepEqual(Object.keys(m), ['article', 'project', 'prompt', 'share']);
  assert.deepEqual(Object.keys(notifyPayload('custom', m, { rows: PERSON_ROWS })), ['article', 'project', 'prompt', 'share']);
});

test('a follow summary is about the person, so a page-wide News setting never changes it', () => {
  assert.equal(summarizeFollow({ username: 'a' }, { news: { api: false } }), 'Everything, in app only');
  assert.equal(summarizeFollow({ username: 'a', notify: { share: { api: false } } }, {}), 'Articles, projects, prompts and skills');
});

test('the News pill renders locked with the members tooltip for a free account, live for a paying one', () => {
  const free = notifyPillHtml({ rowKey: 'news', channel: 'api', label: 'In app', on: false, paid: false });
  assert.match(free, /class="pill blocked"/);
  assert.match(free, /aria-disabled="true"/);
  assert.match(free, /data-tip="News alerts are for members"/);
  const live = notifyPillHtml({ rowKey: 'news', channel: 'api', label: 'In app', on: true, paid: true });
  assert.doesNotMatch(live, /blocked|aria-disabled/);
  assert.match(live, /class="pill on"/);
  const person = notifyPillHtml({ rowKey: 'article', channel: 'api', label: 'In app', on: true, paid: false });
  assert.doesNotMatch(person, /blocked/, 'a free account keeps the person rows');
});
