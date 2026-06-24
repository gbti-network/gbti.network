// SOW-061 P2: the recordUsage seam. No-op when unbound, exact aggregate shape, closed vocabulary, bounded
// version cardinality, and a structural NO-LEAK guard (no PII ever reaches a data point). Never throws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordUsage } from '../workers/signup/analytics.mjs';

function fakeDataset() {
  const points = [];
  return { points, writeDataPoint: (p) => points.push(p) };
}
const req = (version) => ({ headers: { get: (h) => (h === 'X-GBTI-Ext-Version' ? version : null) } });
const ENV = (ds) => ({ EXT_ANALYTICS: ds, PUBLIC_BASE_URL: 'https://signup.gbti.network' });

test('no-op when EXT_ANALYTICS is unbound (never throws)', () => {
  assert.doesNotThrow(() => recordUsage({}, { tier: 'paid', event: 'status_check' }));
  assert.doesNotThrow(() => recordUsage(undefined, { tier: 'paid', event: 'status_check' }));
});

test('writes one data point with the exact aggregate shape', () => {
  const ds = fakeDataset();
  recordUsage(ENV(ds), { tier: 'paid', event: 'status_check', request: req('1.4.2') });
  assert.equal(ds.points.length, 1);
  assert.deepEqual(ds.points[0].blobs, ['paid', 'status_check', '1.4.2', 'production']);
  assert.deepEqual(ds.points[0].doubles, [1]);
  assert.deepEqual(ds.points[0].indexes, ['paid']);
});

test('drops an out-of-vocabulary tier or event (no junk dimensions)', () => {
  const ds = fakeDataset();
  recordUsage(ENV(ds), { tier: 'vip', event: 'status_check' });    // bad tier
  recordUsage(ENV(ds), { tier: 'paid', event: 'rage_click' });     // bad event
  recordUsage(ENV(ds), { tier: 'anonymous', event: 'news_view' }); // ok
  assert.equal(ds.points.length, 1);
  assert.equal(ds.points[0].blobs[0], 'anonymous');
});

test('a garbage / spoofed ext-version collapses to "unknown" (bounded cardinality)', () => {
  const ds = fakeDataset();
  recordUsage(ENV(ds), { tier: 'paid', event: 'save', request: req('not a version; DROP TABLE') });
  assert.equal(ds.points[0].blobs[2], 'unknown');
  const ds2 = fakeDataset();
  recordUsage(ENV(ds2), { tier: 'paid', event: 'save', request: req(null) });
  assert.equal(ds2.points[0].blobs[2], 'unknown');
});

test('environment is sandbox when not the prod signup host', () => {
  const ds = fakeDataset();
  recordUsage({ EXT_ANALYTICS: ds, PUBLIC_BASE_URL: 'http://localhost:8787' }, { tier: 'none', event: 'follow' });
  assert.equal(ds.points[0].blobs[3], 'sandbox');
});

test('NO-LEAK GUARD: a recorded point holds only tier/event/version/environment, never an id/login/url', () => {
  const ds = fakeDataset();
  recordUsage(ENV(ds), { tier: 'paid', event: 'status_check', request: req('1.0.0') });
  const flat = JSON.stringify(ds.points[0]);
  assert.ok(!/@[a-z0-9]/i.test(flat), 'no login/email');
  assert.ok(!/https?:\/\//.test(flat), 'no url');
  assert.ok(!/[0-9]{6,}/.test(flat), 'no github_id-like number');
  for (const b of ds.points[0].blobs) assert.equal(typeof b, 'string');
});

test('a throwing dataset never breaks the request', () => {
  const ds = { writeDataPoint: () => { throw new Error('AE down'); } };
  assert.doesNotThrow(() => recordUsage({ EXT_ANALYTICS: ds, PUBLIC_BASE_URL: 'https://signup.gbti.network' }, { tier: 'paid', event: 'status_check' }));
});
