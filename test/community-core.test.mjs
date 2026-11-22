// sow-494: the labels and rules the Community pages show, pinned. Everything a member reads on the list and the entry
// page comes through client-ui/src/community-core.mjs, so the copy rules (no dashes, no contractions) are checked here
// too, on the strings as they render.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  faceSrc, faceHtml, runSheet, memberStatusLine, listOverview, liveCountLine, nextShoptalk, peopleLine, profileHref, joinHref, cardPeopleLine, meetingDate, meetingText, statusPill, rowMeta, discussionCell, resultLine, entryHref, barRows, answerState,
  pollDelay, formatBytes, uploadProblem, imageSrc, sharedLine, threadCounts, answeredLine, shoptalkMeetings, plural,
} from '../client-ui/src/community-core.mjs';

const clean = (s) => assert.doesNotMatch(String(s), /[—–]|n't|'re|'ll|'ve/, `shipped copy: ${s}`);

test('meetings read the way the boards show them', () => {
  assert.equal(meetingDate('2026-11-07'), 'November 7');
  assert.equal(meetingDate('2026-13-01'), '');
  assert.equal(meetingText({ label: 'Shop Talk', date: '2026-11-07' }), 'Shop Talk, November 7');
  assert.equal(meetingText({ label: 'Circle', date: '' }), 'Circle');
  assert.equal(meetingText({ label: '', date: '2026-11-07' }), 'Between meetings');
  assert.equal(meetingText(null), 'Between meetings');
});

test('a row says where its entry stands, and who it is shared with', () => {
  const base = { kind: 'poll', author: { login: 'gbtilabs' }, meeting: { label: 'Shop Talk', date: '2026-11-07' }, access: { mode: 'all', count: null } };
  // sow-498: the state is the pill and the host is always a superadmin, so the line is the meeting and the audience.
  assert.equal(rowMeta({ ...base, status: 'live' }), 'Shop Talk, November 7');
  assert.equal(rowMeta({ ...base, status: 'draft' }), 'Shop Talk, November 7');
  assert.equal(rowMeta({ ...base, status: 'published' }), 'Shop Talk, November 7');
  assert.equal(rowMeta({ ...base, status: 'live', access: { mode: 'chosen', count: 1 } }), 'Shop Talk, November 7 · Shared with 1 member');
  assert.equal(rowMeta({ ...base, meeting: null, access: { mode: 'chosen', count: 5 } }), 'Between meetings · Shared with 5 members');
  assert.deepEqual(statusPill({ kind: 'poll', status: 'closed' }), { tone: 'muted', text: 'Voting closed' });
  assert.deepEqual(statusPill({ kind: 'topic', status: 'closed' }), { tone: 'muted', text: 'Closed' });
  assert.equal(statusPill({ kind: 'topic', status: 'live' }).text, 'Live');
  assert.deepEqual(discussionCell({ kind: 'typed', status: 'live', counts: { posts: 6, answers: 14 } }), { primary: '14 answers', secondary: '6 posts', quiet: false });
  assert.deepEqual(discussionCell({ kind: 'poll', status: 'closed', counts: { posts: 1, answers: 1 } }), { primary: '1 answer', secondary: '1 post', quiet: false });
  assert.deepEqual(discussionCell({ kind: 'topic', status: 'live', counts: { posts: 32, withImages: 9 } }), { primary: '32 posts', secondary: '9 with photos', quiet: false });
  assert.deepEqual(discussionCell({ kind: 'topic', status: 'closed', counts: { posts: 15, withImages: 0 } }), { primary: '15 posts', secondary: '', quiet: false });
  assert.deepEqual(discussionCell({ kind: 'typed', status: 'draft', counts: { posts: 0, answers: 0 } }), { primary: 'Not open yet', secondary: '', quiet: true }, 'a draft shows no zeros');
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

// ---- sow-498: real faces and the host's run sheet ---------------------------------------------------------------

test('a face is GitHub\'s picture for the account NUMBER, the network Gravatar for the house account, else the blobatar alone', () => {
  assert.equal(faceSrc({ githubId: '583231', login: 'octocat' }), 'https://avatars.githubusercontent.com/u/583231?s=96&v=4');
  assert.match(faceSrc({ githubId: '125175036', login: 'gbtilabs' }), /^https:\/\/secure\.gravatar\.com\/avatar\//);
  assert.match(faceSrc({ githubId: '1', username: 'GBTILabs' }), /gravatar/, 'the picker passes username, case-folded');
  assert.equal(faceSrc({ login: 'priya' }), '', 'no account number: no picture, never a lookup by name');
  assert.equal(faceSrc({ githubId: 'not-a-number', login: 'priya' }), '');
  const html = faceHtml({ githubId: '583231', login: 'octocat' }, 'lg');
  assert.match(html, /^<span class="cm-av lg" aria-hidden="true">/);
  assert.match(html, /<img data-blob /, 'the blobatar is always underneath');
  assert.match(html, /<img data-avphoto src="https:\/\/avatars\.githubusercontent\.com\/u\/583231\?s=96&amp;v=4"/);
  assert.doesNotMatch(faceHtml({ login: 'priya' }), /data-avphoto/);
  assert.doesNotMatch(faceHtml({ githubId: '1', login: '"><script>' }), /<script>/, 'the seed is escaped');
  assert.doesNotMatch(faceHtml({ githubId: '1', login: 'x' }), /github\.com\/x\.png/);
});

const sheet = (kind, status, extra = {}) => runSheet({ kind, status, access: { mode: 'chosen', count: 5 }, ...extra }, { total: 14, openedText: '11:04' });
const states = (r) => r.steps.map((s) => s.status).join(',');

test('the run sheet: a poll has five steps and one next step at a time, in the words of the board', () => {
  const draft = sheet('typed', 'draft');
  assert.equal(draft.title, 'Run this poll');
  assert.deepEqual(draft.steps.map((s) => s.title), ['Choose who can see it', 'Share the link in the call chat', 'Open the poll', 'Close voting', 'Publish the results']);
  assert.equal(states(draft), 'done,ready,current,next,next');
  assert.equal(draft.done, 1);
  assert.deepEqual([draft.steps[2].op, draft.steps[2].label], ['open', 'Open the poll']);
  assert.equal(draft.steps[1].link, true, 'the link shows before the poll opens');
  assert.equal(draft.steps[0].detail, '5 chosen members. Change it at any time.');
  assert.deepEqual(draft.steps[0].quiet, { action: 'access', label: 'Change who can see it' });

  const live = sheet('poll', 'live');
  assert.equal(states(live), 'done,current,done,current,next', 'live: share now, and close is the button');
  assert.deepEqual([live.steps[3].op, live.steps[3].label], ['close', 'Close voting']);
  assert.equal(live.steps[3].detail, '14 answers so far. Answers stay hidden from members.');
  assert.equal(live.steps[2].detail, 'Opened at 11:04.');
  assert.equal(live.steps.filter((s) => s.op).length, 1, 'one button at a time');

  const closed = sheet('typed', 'closed');
  assert.equal(states(closed), 'done,done,done,done,current');
  assert.deepEqual([closed.steps[4].op, closed.steps[4].label], ['publish', 'Publish results']);
  assert.deepEqual(closed.steps[3].quiet, { op: 'open', label: 'Reopen voting' });
  assert.equal(closed.steps[1].detail, 'The link keeps working. Only the 5 chosen members can open it.');

  const pub = sheet('poll', 'published');
  assert.equal(states(pub), 'done,done,done,done,done');
  assert.equal(pub.done, 5);
  assert.equal(pub.steps.filter((s) => s.op).length, 0);
  assert.deepEqual(pub.steps[4].quiet, { op: 'unpublish', label: 'Unpublish results' });
  assert.equal(runSheet({ kind: 'poll', status: 'closed' }, { total: 1 }).steps[3].detail, '1 answer is in.');
});

test('the run sheet: a topic has four steps and closes instead of publishing', () => {
  assert.equal(sheet('topic', 'draft').title, 'Run this topic');
  assert.deepEqual(sheet('topic', 'draft').steps.map((s) => s.title), ['Choose who can see it', 'Share the link in the call chat', 'Open the topic', 'Close the topic']);
  assert.equal(states(sheet('topic', 'draft')), 'done,ready,current,next');
  assert.equal(states(sheet('topic', 'live')), 'done,current,done,current');
  assert.deepEqual([sheet('topic', 'live').steps[3].op, sheet('topic', 'live').steps[3].label], ['close', 'Close the topic']);
  const closed = sheet('topic', 'closed');
  assert.equal(states(closed), 'done,done,done,done');
  assert.deepEqual(closed.steps[3].quiet, { op: 'open', label: 'Reopen topic' });
});

test('the run sheet names who can open the link, and every string is shippable copy', () => {
  const all = runSheet({ kind: 'poll', status: 'draft', access: { mode: 'all' } });
  assert.equal(all.steps[0].detail, 'All members. Change it at any time.');
  assert.match(all.steps[1].detail, /Every member can open it\.$/);
  assert.match(sheet('poll', 'draft').steps[1].detail, /Only the 5 chosen members can open it\.$/);
  assert.match(runSheet({ kind: 'poll', status: 'draft', access: { mode: 'chosen', members: [{}] } }).steps[1].detail, /Only the 1 chosen member can/);
  for (const kind of ['poll', 'typed', 'topic']) {
    for (const status of ['draft', 'live', 'closed', 'published']) {
      const r = sheet(kind, status);
      clean(r.title);
      for (const s of r.steps) { clean(s.title); clean(s.detail); if (s.label) clean(s.label); if (s.quiet) clean(s.quiet.label); }
      clean(memberStatusLine({ kind, status }));
    }
  }
});

test('a member\'s status line follows the state, and never promises a change the host turned off', () => {
  assert.equal(memberStatusLine({ kind: 'typed', status: 'live' }), 'Open now. You can change your answer until the host closes voting.');
  assert.equal(memberStatusLine({ kind: 'poll', status: 'live', settings: { changeable: false } }), 'Open now. Your first answer is the one that counts.');
  assert.equal(memberStatusLine({ kind: 'topic', status: 'live' }), 'Open now. Post and reply below.');
  assert.equal(memberStatusLine({ kind: 'poll', status: 'closed' }), 'Voting is closed. The host publishes the results soon.');
  assert.equal(memberStatusLine({ kind: 'topic', status: 'closed' }), 'This topic is closed. Everything posted stays to read.');
  assert.equal(memberStatusLine({ kind: 'poll', status: 'published' }), 'The results are published.');
  assert.equal(memberStatusLine({ kind: 'poll', status: 'draft' }), '');
});

// ---- sow-498: the list page's sidebar (round 4b, L1) -----------------------------------------------------------

test('the list sidebar: what is live, and what waits on a host', () => {
  const e = (id, kind, status, counts = {}) => ({ id, kind, status, counts, title: id });
  const o = listOverview([e('a', 'typed', 'live', { answers: 14 }), e('b', 'topic', 'live', { posts: 1 }), e('c', 'poll', 'draft'), e('d', 'poll', 'closed'), e('f', 'topic', 'closed'), e('g', 'poll', 'published')]);
  assert.deepEqual(o.live.map((x) => x.id), ['a', 'b']);
  assert.deepEqual(o.drafts.map((x) => x.id), ['c']);
  assert.deepEqual(o.toPublish.map((x) => x.id), ['d'], 'a closed topic has nothing to publish');
  assert.deepEqual(listOverview(undefined), { live: [], drafts: [], toPublish: [] });
  assert.equal(liveCountLine(o.live[0]), '14 answers');
  assert.equal(liveCountLine(o.live[1]), '1 post');
  assert.equal(liveCountLine({ kind: 'poll' }), '0 answers');
});

test('the next Shop Talk is the coming Saturday on the viewer\'s calendar, and Today on the day', () => {
  assert.deepEqual(nextShoptalk(new Date(2026, 10, 19, 15)), { date: '2026-11-21', today: false, day: 'Saturday, November 21' });
  assert.deepEqual(nextShoptalk(new Date(2026, 10, 21, 9)), { date: '2026-11-21', today: true, day: 'Today' });
  assert.equal(nextShoptalk(new Date(2026, 10, 22, 9)).day, 'Saturday, November 28');
  assert.equal(nextShoptalk(new Date(2026, 11, 31, 9)).day, 'Saturday, January 2', 'across the year');
});

// ---- sow-499: anonymous or public answers ------------------------------------------------------------------------

test('under each bar: the anonymous count beside the public names', () => {
  const p = (n) => Array.from({ length: n }, (_, i) => ({ githubId: String(i), login: `m${i}` }));
  assert.equal(peopleLine({ count: 5, people: p(2) }), '3 anonymous');
  assert.equal(peopleLine({ count: 3, people: [] }), 'All 3 anonymous');
  assert.equal(peopleLine({ count: 1, people: [] }), '1 anonymous');
  assert.equal(peopleLine({ count: 2, people: p(2) }), '', 'everyone public: no line');
  assert.equal(peopleLine({ count: 0 }), '');
  for (const g of [{ count: 5, people: p(2) }, { count: 3, people: [] }]) clean(peopleLine(g));
});

test('a public answer links to a profile only when that GBTI name has a profile page', () => {
  const known = new Set(['priya-dev']);
  assert.equal(profileHref('priya-dev', known), '/members/priya-dev/');
  assert.equal(profileHref('Priya-Dev', known), '/members/priya-dev/', 'folders are lowercase');
  assert.equal(profileHref('ben', known), '', 'no profile page: no link');
  assert.equal(profileHref('', known), '');
  assert.equal(profileHref('priya-dev', null), '', 'the profile list did not load: no link');
});

test('the anonymous-or-public copy says Anonymous and Public, and never mentions a face (owner ruling)', async () => {
  const fs = await import('node:fs');
  const src = fs.readFileSync(new URL('../client-ui/src/elements/community-entry-answer.mjs', import.meta.url), 'utf8');
  for (const s of ['Anonymous', 'Public', 'Counted. Nobody sees it was you.', 'Members see it was you once the results are published.', 'Make it anonymous', 'Make it public']) {
    assert.ok(src.includes(s), `copy present: ${s}`);
    clean(s);
  }
  const code = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n').replace(/faceHtml/g, '');
  assert.doesNotMatch(code, /face/i, 'no face in the shipped strings');
});

// ---- sow-500: the share link adds a signed-in member who opens it ------------------------------------------------

test('the join link: the address carries the code, and the plain address when there is none', () => {
  assert.equal(joinHref('7x7s47n23wtsrn94', 'k3m9q2wdabcdefgh'), '/community/entry/?id=7x7s47n23wtsrn94&join=k3m9q2wdabcdefgh');
  assert.equal(joinHref('7x7s47n23wtsrn94', null), '/community/entry/?id=7x7s47n23wtsrn94');
  assert.equal(joinHref('7x7s47n23wtsrn94', ''), '/community/entry/?id=7x7s47n23wtsrn94');
});

test('step 2 says who the link lets in, in every state, with the join link on and off', () => {
  const step = (status, joinCode, kind = 'topic') => runSheet({ kind, status, joinCode, access: { mode: 'chosen', count: 6 } }).steps[1];
  assert.equal(step('live', 'c').detail, 'The topic is open, so paste it now. Anyone signed in who opens this link is added to who can see it.');
  assert.equal(step('draft', 'c').detail, 'Paste it once the topic is open. Anyone signed in who opens it then is added to who can see it.');
  assert.equal(step('closed', 'c').detail, 'The link keeps working, and still adds anyone signed in who opens it.');
  assert.equal(step('published', 'c', 'poll').detail, 'The link keeps working, and still adds anyone signed in who opens it.');
  assert.equal(step('live', 'c').joinLink, 'on');
  assert.equal(step('live', null).detail, 'The topic is open, so paste it now. Only the 6 chosen members can open it.');
  assert.equal(step('live', null).joinLink, 'off');
  const all = runSheet({ kind: 'topic', status: 'live', access: { mode: 'all' } }).steps[1];
  assert.equal(all.joinLink, undefined, 'an all-members entry has no join link controls');
  for (const s of ['live', 'draft', 'closed']) for (const c of ['c', null]) clean(step(s, c).detail);
});

// ---- sow-501: faces on the list cards ------------------------------------------------------------------------------

test('the card line: who it is shared with, or who took part; the meta drops "Shared with" once the faces carry it', () => {
  const base = { meeting: { label: 'Shop Talk', date: '2026-11-21' } };
  const shared = { ...base, access: { mode: 'chosen', count: 6 }, people: { mode: 'shared', count: 6, list: [] } };
  assert.equal(cardPeopleLine(shared), 'Shared with 6 members');
  assert.equal(rowMeta(shared), 'Shop Talk, November 21', 'said once, on the faces line');
  assert.equal(rowMeta({ ...base, access: { mode: 'chosen', count: 6 } }), 'Shop Talk, November 21 · Shared with 6 members', 'a row without faces keeps it');
  assert.equal(cardPeopleLine({ people: { mode: 'took-part', count: 4, list: [] } }), '4 members took part');
  assert.equal(cardPeopleLine({ people: { mode: 'took-part', count: 1, list: [] } }), '1 member took part');
  assert.equal(cardPeopleLine({ people: { mode: 'took-part', count: 0, list: [] } }), '', 'nobody yet: no faces line');
  assert.equal(cardPeopleLine({}), '');
  for (const t of ['Shared with 6 members', '4 members took part', '1 member took part']) clean(t);
});
