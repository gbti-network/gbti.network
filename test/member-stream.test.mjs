// sow-312: who sees the members-only Shares stream, and the assertion that keeps three surfaces in step.
//
// The Worker route is the BOUNDARY. The website surfaces are affordances. Drift between them leaks nothing,
// but it shows somebody the wrong thing: a paid member told to "join to see them" (the bug this fixes), or an
// empty stream shell for a free reader. The last test reads the Worker's own set so a change on either side
// fails here rather than drifting quietly.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canReadMemberStream, MEMBER_STREAM_STATES } from '../src/lib/member-stream.mjs';

test('paid and trialing read the member stream; a trial reads even though it cannot post', () => {
  // Trial is deliberately included: the tier table gives a trial READ access to the community stream while
  // POSTING stays paid-only. Getting this wrong would lock trials out of the thing they are evaluating.
  assert.equal(canReadMemberStream({ membership: 'paid' }), true);
  assert.equal(canReadMemberStream({ membership: 'trialing' }), true);
});

test('everyone else gets the locked card, including every unresolved state', () => {
  for (const m of ['none', 'expired', 'cancelled', 'banned', 'unknown', '', 'Paid', 'PAID', 'member', 'creator']) {
    assert.equal(canReadMemberStream({ membership: m }), false, `membership ${JSON.stringify(m)} must not see the stream`);
  }
  // An absent signal is the signed-out case and the pre-hydration case; both must show the locked card.
  for (const s of [null, undefined, {}, 0, false, [], 'nonsense']) {
    assert.equal(canReadMemberStream(s), false, `signal ${JSON.stringify(s)} must fail closed`);
  }
});

test('a bare membership string works too, so a caller cannot pass the wrong shape and silently get false', () => {
  // The predicate accepts a signal OR a bare state. Without this, `canReadMemberStream(s.membership)` would
  // return false for a paid member and look like a correct denial.
  assert.equal(canReadMemberStream('paid'), true);
  assert.equal(canReadMemberStream('trialing'), true);
  assert.equal(canReadMemberStream('none'), false);
});

test('the website predicate and the WORKER gate admit exactly the same states', () => {
  // The Worker is the boundary. This reads its set from source rather than restating it, so widening either
  // side without the other fails here. A restated copy is how two guards drift while both look correct.
  const src = readFileSync(new URL('../workers/signup/membership-shares.mjs', import.meta.url), 'utf8');
  const m = /const READ_MEMBERS = new Set\(\[([^\]]*)\]\)/.exec(src);
  assert.ok(m, 'READ_MEMBERS not found in membership-shares.mjs: this check is broken, not the subject');
  const workerStates = [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]).sort();
  assert.ok(workerStates.length > 0, 'parsed zero states from READ_MEMBERS; a clean result would be vacuous');
  assert.deepEqual([...MEMBER_STREAM_STATES].sort(), workerStates,
    'the website affordance and the Worker gate disagree about who may read the member stream');
});
