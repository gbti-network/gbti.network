// sow-316 Phase 4: a coupon redemption nudges a targeted reconcile, so the member's Discord role arrives now.
//
// Measured 2026-09-08: a new member sat wearing the LOCKED role (reserved for lapsed and banned accounts)
// for most of a day after redeeming a coupon, because the role sync only ran nightly and nothing asked it to
// run sooner. The sync was correct. This pins the ask.
//
// Source guard, on the executable lines only. The completion path is not driven by any harness in this
// suite, so what is pinned is that the nudge exists, fires inside the once-per-member block, reads the same
// two env names checkout's nudge reads, and cannot throw out of the member's redirect.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const SRC = readFileSync(new URL('../workers/signup/index.mjs', import.meta.url), 'utf8');
const code = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
const C = code(SRC);

/** The once-per-member block. Its own comment says the deferred Discord leg re-runs as `already`. */
function couponBlock() {
  const start = C.indexOf('if (signup.couponRedeemed) {');
  assert.ok(start > 0, 'the couponRedeemed block was not found: this test is broken, not the subject');
  let depth = 0, i = start;
  for (; i < C.length; i++) { if (C[i] === '{') depth++; else if (C[i] === '}') { depth--; if (depth === 0) break; } }
  return C.slice(start, i + 1);
}

test('the nudge fires INSIDE the once-per-member coupon block', () => {
  const block = couponBlock();
  // Bound to the INVOCATION that feeds waitUntil, not to the token. A first version matched /kickRegate\(/ and
  // a mutation that left the name in a dead arrow function survived it.
  assert.match(block, /const nudge = import\('\.\/checkout\.mjs'\)\.then\(\(\{ kickRegate \}\) => kickRegate\(/,
    'the targeted reconcile must be the promise that is deferred, not a name that happens to appear');
  // And only there. A nudge outside the block would fire on every signup completion, including the deferred
  // Discord leg, which is the double-fire the block exists to prevent.
  const outside = C.replace(block, '');
  const inCouponPath = outside.slice(outside.indexOf('funnel(\'complete\''), outside.indexOf('const session = await signSession'));
  assert.doesNotMatch(inCouponPath, /kickRegate\(/, 'the nudge must not also fire outside the coupon block');
});

test('it reads the SAME env names checkout uses, so one provisioning covers both nudges', () => {
  const block = couponBlock();
  assert.match(block, /dispatchToken: env\.REGATE_DISPATCH_TOKEN/);
  assert.match(block, /contentRepo: env\.GITHUB_CONTENT_REPO/);
  assert.match(block, /githubId,?\s/, 'it must nudge THIS member');
});

test('it is fail-soft and deferred, so it can neither block nor break the redirect', () => {
  const block = couponBlock();
  assert.match(block, /\.catch\(\(\) => false\)/, 'a rejected import or dispatch must resolve, never throw into signup');
  assert.match(block, /ctx\?\.waitUntil\) ctx\.waitUntil\(nudge\)/, 'it must ride waitUntil like the alert beside it');
});

test('the workflow accepts the event this nudge sends', () => {
  const wf = readFileSync(new URL('../.github/workflows/reconcile.yml', import.meta.url), 'utf8');
  const types = (wf.match(/repository_dispatch:\s*\n\s*types:\s*\[([^\]]+)\]/) || [])[1] || '';
  assert.ok(types.split(',').map((t) => t.trim()).includes('regate'),
    'reconcile.yml must list regate under repository_dispatch types, or the nudge is accepted by GitHub and runs nothing');
});
