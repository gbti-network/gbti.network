// sow-494: the labels and rules the Community pages show, pinned. Everything a member reads on the list and the entry
// page comes through client-ui/src/community-core.mjs, so the copy rules (no dashes, no contractions) are checked here
// too, on the strings as they render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  initials, meetingDate, meetingText, statusPill, rowMeta, discussionCell, resultLine, entryHref, barRows, answerState,
  pollDelay, formatBytes, uploadProblem, imageSrc, sharedLine, threadCounts, answeredLine, shoptalkMeetings, plural,
} from '../client-ui/src/community-core.mjs';

const clean = (s) => assert.doesNotMatch(String(s), /[—–]|n't|'re|'ll|'ve/, `shipped copy: ${s}`);

test('names and meetings read the way the boards show them', () => {
  assert.equal(initials('priya'), 'PR');
  assert.equal(initials('kai-dev'), 'KD');
  assert.equal(initials('@gbtilabs'), 'GB');
  assert.equal(initials(''), '?');
  assert.equal(meetingDate('2026-11-07'), 'November 7');
  assert.equal(meetingDate('2026-13-01'), '');
  assert.equal(meetingText({ label: 'Shop Talk', date: '2026-11-07' }), 'Shop Talk, November 7');
  assert.equal(meetingText({ label: 'Circle', date: '' }), 'Circle');
  assert.equal(meetingText({ label: '', date: '2026-11-07' }), 'Between meetings');
  assert.equal(meetingText(null), 'Between meetings');
});

test('a row says where its entry stands, and who it is shared with', () => {
  const base = { kind: 'poll', author: { login: 'gbtilabs' }, meeting: { label: 'Shop Talk', date: '2026-11-07' }, access: { mode: 'all', count: null } };
  assert.equal(rowMeta({ ...base, status: 'live' }), 'Shop Talk, November 7 · gbtilabs');
  assert.equal(rowMeta({ ...base, status: 'published' }), 'Shop Talk, November 7 · gbtilabs · results published');
  assert.equal(rowMeta({ ...base, status: 'closed' }), 'Shop Talk, November 7 · gbtilabs · voting closed');
  assert.equal(rowMeta({ ...base, kind: 'topic', status: 'closed' }), 'Shop Talk, November 7 · gbtilabs');
  assert.equal(rowMeta({ ...base, status: 'live', access: { mode: 'chosen', count: 1 } }), 'Shop Talk, November 7 · gbtilabs · shared with 1 member');
  assert.deepEqual(statusPill({ kind: 'poll', status: 'closed' }), { tone: 'muted', text: 'Voting closed' });
  assert.deepEqual(statusPill({ kind: 'topic', status: 'closed' }), { tone: 'muted', text: 'Closed' });
  assert.equal(statusPill({ kind: 'topic', status: 'live' }).text, 'Live');
  assert.deepEqual(discussionCell({ kind: 'typed', counts: { posts: 6, answers: 14 } }), { count: 6, sub: '14 answers' });
  assert.deepEqual(discussionCell({ kind: 'topic', counts: { posts: 32, withImages: 9 } }), { count: 32, sub: '9 with photos' });
  assert.deepEqual(discussionCell({ kind: 'topic', counts: { posts: 15, withImages: 0 } }), { count: 15, sub: '' });
  assert.equal(resultLine({ status: 'published', lead: { label: 'Agents', count: 12, total: 23 } }), 'Results: Agents led with 52% of 23 answers');
  assert.equal(resultLine({ status: 'live', lead: { label: 'Agents', count: 12, total: 23 } }), '', 'a live tally is never on the list');
  assert.equal(entryHref('abc def'), '/community/entry/?id=abc%20def');
  for (const s of ['live', 'closed', 'published', 'draft']) clean(rowMeta({ ...base, status: s }));
});

test('result bars carry whole percents, mark the leader (ties included) and the viewer', () => {
  const rows = barRows({ total: 4, groups: [{ key: '0', label: 'a', count: 2, mine: true }, { key: '1', label: 'b', count: 2 }, { key: '2', label: 'c', count: 0 }] });
  assert.deepEqual(rows.map((r) => [r.label, r.pct, r.lead, r.mine]), [['a', 50, true, true], ['b', 50, true, false], ['c', 0, false, false]]);
  assert.deepEqual(barRows({ total: 0, groups: [{ key: '0', label: 'a', count: 0 }] }).map((r) => r.lead), [false], 'an empty poll leads with nothing');
  assert.deepEqual(barRows(null), []);
});

test('a member stands in one state at a time on a poll', () => {
  assert.equal(answerState({ status: 'live' }, null), 'open');
  assert.equal(answerState({ status: 'live' }, { choice: 1 }), 'answered');
  assert.equal(answerState({ status: 'closed' }, { choice: 1 }), 'closed');
  assert.equal(answerState({ status: 'published' }, null), 'published');
  assert.equal(answerState({ status: 'draft' }, null), 'draft');
  assert.equal(answerState(null, null), 'missing');
  assert.equal(answeredLine({ status: 'live', counts: { answers: 1 } }), '1 member has answered. Results appear here once they are published.');
  assert.equal(answeredLine({ status: 'live', counts: { answers: 14 } }), '14 members have answered. Results appear here once they are published.');
  clean(answeredLine({ status: 'live', counts: { answers: 2 } }));
});

test('the live poll asks often while live and in view, rarely otherwise, and never while hidden', () => {
  assert.equal(pollDelay({ live: true, visible: true }), 4000);
  assert.equal(pollDelay({ live: false, visible: true }), 20000);
  assert.equal(pollDelay({ live: true, visible: false }), null);
});

test('an upload is refused before it is sent when it is too large or not a picture, in the words the board uses', () => {
  assert.equal(uploadProblem({ name: 'desk.jpg', size: 640 * 1024, type: 'image/jpeg' }), null);
  const big = uploadProblem({ name: 'desk-full.jpg', size: 2.4 * 1024 * 1024, type: 'image/jpeg' });
  assert.equal(big.title, 'desk-full.jpg is 2.4 MB.');
  assert.equal(big.detail, 'Images can be up to 1 MB. Save a smaller copy and add it again.');
  const svg = uploadProblem({ name: 'logo.svg', size: 100, type: 'image/svg+xml' });
  assert.match(svg.detail, /PNG, JPG, WebP or GIF/);
  assert.ok(uploadProblem({ name: 'x', size: 1048577, type: 'image/png' }), 'one byte over is over');
  assert.equal(uploadProblem({ name: 'x', size: 1048576, type: 'image/png' }), null, 'exactly 1 MB is allowed');
  assert.equal(formatBytes(880 * 1024), '880 KB');
  assert.equal(formatBytes(10), '1 KB');
  for (const p of [big, svg]) { clean(p.title); clean(p.detail); }
});

test('an image address, the shared line and the thread counts', () => {
  assert.equal(imageSrc('https://signup.gbti.network/', 'e1', 'i 2'), 'https://signup.gbti.network/membership/community/image?id=e1&img=i%202');
  assert.equal(sharedLine({ mode: 'all' }), 'Shared with all members');
  assert.equal(sharedLine({ mode: 'chosen', count: 6 }), 'Shared with 6 members');
  assert.equal(sharedLine({ mode: 'chosen', members: [{}] }), 'Shared with 1 member');
  const d = { posts: [{ deleted: false, replies: [{ deleted: false }, { deleted: true }] }, { deleted: true, replies: [{ deleted: false }] }] };
  assert.deepEqual(threadCounts(d), { posts: 1, replies: 2 });
  assert.equal(plural(1, 'reply', 'replies'), '1 reply');
});

test('the meeting picker offers this Saturday and the weeks around it', () => {
  const list = shoptalkMeetings(new Date(2026, 10, 4)); // a Wednesday
  assert.deepEqual(list.map((m) => m.date), ['2026-10-24', '2026-10-31', '2026-11-07', '2026-11-14', '2026-11-21', '2026-11-28']);
  assert.equal(list.find((m) => m.next).text, 'Shop Talk, Saturday November 7');
  const sat = shoptalkMeetings(new Date(2026, 10, 7, 23, 0));
  assert.equal(sat.find((m) => m.next).date, '2026-11-07', 'on the day itself, the call that day is next');
});
