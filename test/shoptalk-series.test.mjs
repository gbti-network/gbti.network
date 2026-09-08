// sow-314: choosing the recurring series to enroll into.
//
// The defect this guards is silent by construction: writing guests to a series that has ENDED returns 200,
// reports success, and adds nobody to the call. So the tests below care most about the cases where a wrong
// answer would still look like a right one.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  seriesFromInstances, isSeriesProblem, describeSeries, SERIES_PROBLEM,
} from '../membership/shoptalk-series.mjs';

const inst = (id, seriesId, start, status = 'confirmed') => ({
  id, recurringEventId: seriesId, status, start: { dateTime: start },
});

test('takes the series that owns the NEXT occurrence', () => {
  const r = seriesFromInstances([
    inst('e_20260912', 'series_R20260912', '2026-09-12T11:00:00-05:00'),
    inst('e_20260919', 'series_R20260912', '2026-09-19T11:00:00-05:00'),
  ]);
  assert.equal(isSeriesProblem(r), false);
  assert.equal(r.seriesId, 'series_R20260912');
  assert.equal(r.startsAt, '2026-09-12T11:00:00-05:00');
});

test('a CANCELLED next occurrence is skipped, and the series after it wins', () => {
  // The real hazard: the first Saturday is called off and belongs to the OLD segment. Taking items[0]
  // blindly would enroll everyone into a series that has ended, and report success doing it.
  const r = seriesFromInstances([
    inst('e_old', 'series_OLD', '2026-09-12T11:00:00-05:00', 'cancelled'),
    inst('e_new', 'series_NEW', '2026-09-19T11:00:00-05:00'),
  ]);
  assert.equal(r.seriesId, 'series_NEW', 'a cancelled instance must not decide the series');
});

test('an EMPTY list is a problem, never a quiet no-op', () => {
  const r = seriesFromInstances([]);
  assert.equal(isSeriesProblem(r), true);
  assert.equal(r.problem, SERIES_PROBLEM.NO_INSTANCES);
  assert.equal(r.seriesId, undefined, 'there must be no id to accidentally use');
});

test('ALL cancelled is its own problem, distinct from an empty list', () => {
  // Two different causes with two different fixes: nothing scheduled, versus everything called off.
  const r = seriesFromInstances([inst('a', 's', '2026-09-12T11:00:00-05:00', 'cancelled')]);
  assert.equal(r.problem, SERIES_PROBLEM.ALL_CANCELLED);
});

test('a ONE-OFF event is refused rather than enrolled into', () => {
  // No recurringEventId means a standalone event. Adding every future member to it forever is wrong, and it
  // is the shape a "someone made a single meeting called Shop Talk" mistake takes.
  const r = seriesFromInstances([{ id: 'once', status: 'confirmed', start: { dateTime: '2026-09-12T11:00:00-05:00' } }]);
  assert.equal(r.problem, SERIES_PROBLEM.NO_SERIES_ID);
});

test('malformed input never throws and never yields an id', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const r = seriesFromInstances(bad);
    assert.equal(isSeriesProblem(r), true, `${JSON.stringify(bad)} must be a problem`);
    assert.equal(r.seriesId, undefined);
  }
  assert.equal(isSeriesProblem(seriesFromInstances([null, null])), true);
});

test('the failure message says nobody was enrolled, not that nothing was found', () => {
  // A sweep that enrolls nobody while reading as healthy is the whole failure mode. The wording is the
  // control, so it is pinned.
  const msg = describeSeries(seriesFromInstances([]));
  assert.match(msg, /CANNOT RUN/);
  assert.match(msg, /Nobody was added or removed/);
  assert.doesNotMatch(msg, /^Shop Talk series /, 'a failure must not read like a success line');
});

test('the success message names the series and the next occurrence', () => {
  const msg = describeSeries(seriesFromInstances([inst('e', 'series_X', '2026-09-12T11:00:00-05:00')]));
  assert.match(msg, /series_X/);
  assert.match(msg, /2026-09-12/);
});

test('isSeriesProblem is not fooled by a successful result', () => {
  assert.equal(isSeriesProblem({ seriesId: 'x', startsAt: 'y' }), false);
  assert.equal(isSeriesProblem(null), false);
  assert.equal(isSeriesProblem({ problem: 'x' }), true);
});
