// SOW-124: the devlog pure core. Injected sink + clock, no chrome/fs/network. Locks in the four contracts:
// no-op when disabled, secret REDACTION, the bounded ring + recent() order, and clear(). A regression here
// could either leak a token into a log or break a real path, so these are the guardrail tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createDevlog, redactDeep } from '../membership/devlog-core.mjs';

function collector() {
  const lines = [];
  return { lines, log: (...a) => lines.push(a) };
}
const at = (t) => () => t;

test('devlog: a disabled log is a strict no-op (no sink, no ring)', () => {
  const sink = collector();
  const devlog = createDevlog({ enabled: false, sink, now: at(1) });
  devlog('reader', 'should not appear', { a: 1 });
  assert.equal(sink.lines.length, 0);
  assert.equal(devlog.recent().length, 0);
  assert.equal(devlog.enabled(), false);
});

test('devlog: an enabled log emits a formatted line and rings the entry', () => {
  const sink = collector();
  const devlog = createDevlog({ enabled: true, sink, now: at(42) });
  devlog('shares', 'loaded', { count: 8 });
  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0][0], '[gbti:shares] loaded');
  assert.deepEqual(sink.lines[0][1], { count: 8 });
  const recent = devlog.recent();
  assert.equal(recent.length, 1);
  assert.deepEqual(recent[0], { t: 42, area: 'shares', msg: 'loaded', data: { count: 8 } });
});

test('devlog: an enabled log with no data omits the data field and second arg', () => {
  const sink = collector();
  const devlog = createDevlog({ enabled: true, sink, now: at(1) });
  devlog('dispatch', 'entry');
  assert.deepEqual(sink.lines[0], ['[gbti:dispatch] entry']);
  assert.deepEqual(devlog.recent()[0], { t: 1, area: 'dispatch', msg: 'entry' });
});

test('devlog: a thunk gate is re-evaluated on every call', () => {
  const sink = collector();
  let on = false;
  const devlog = createDevlog({ enabled: () => on, sink, now: at(1) });
  devlog('a', 'off');
  on = true;
  devlog('a', 'on');
  assert.equal(sink.lines.length, 1);
  assert.equal(sink.lines[0][0], '[gbti:a] on');
});

test('redactDeep: secret-named keys are masked, present-but-empty flagged', () => {
  const out = redactDeep({
    githubToken: 'ghu_supersecret', refresh_token: 'r', Authorization: 'Bearer x', apiKey: 'k',
    membership: 'paid', nested: { client_secret: 'z', ok: true }, emptyToken: '',
  });
  assert.equal(out.githubToken, '<redacted>');
  assert.equal(out.refresh_token, '<redacted>');
  assert.equal(out.Authorization, '<redacted>');
  assert.equal(out.apiKey, '<redacted>');
  assert.equal(out.membership, 'paid');
  assert.equal(out.nested.client_secret, '<redacted>');
  assert.equal(out.nested.ok, true);
  assert.equal(out.emptyToken, '<empty>');
});

test('redactDeep: a long string is clipped and the original is never mutated', () => {
  const big = 'x'.repeat(500);
  const input = { body: big };
  const out = redactDeep(input);
  assert.ok(out.body.length < big.length);
  assert.ok(out.body.includes('…(500)'));
  assert.equal(input.body, big); // input untouched
});

test('redactDeep: depth is bounded so a deep tree collapses to a marker', () => {
  const out = redactDeep({ a: { b: { c: { d: { e: 1 } } } } });
  assert.equal(out.a.b.c, '[object]');
});

test('devlog: the ring is bounded to ringSize, keeping the newest', () => {
  const devlog = createDevlog({ enabled: true, sink: () => {}, now: at(0), ringSize: 3 });
  for (let i = 0; i < 5; i++) devlog('x', `m${i}`);
  const recent = devlog.recent();
  assert.equal(recent.length, 3);
  assert.deepEqual(recent.map((e) => e.msg), ['m2', 'm3', 'm4']);
});

test('devlog: clear() empties the ring; setEnabled toggles the gate', () => {
  const devlog = createDevlog({ enabled: true, sink: () => {}, now: at(0) });
  devlog('x', 'a');
  assert.equal(devlog.recent().length, 1);
  devlog.clear();
  assert.equal(devlog.recent().length, 0);
  devlog.setEnabled(false);
  devlog('x', 'b');
  assert.equal(devlog.recent().length, 0);
});

test('devlog: a throwing sink never propagates to the caller', () => {
  const devlog = createDevlog({ enabled: true, sink: () => { throw new Error('boom'); }, now: at(0) });
  assert.doesNotThrow(() => devlog('x', 'a', { ok: 1 }));
  assert.equal(devlog.recent().length, 1); // the entry still ringed before the sink threw
});
