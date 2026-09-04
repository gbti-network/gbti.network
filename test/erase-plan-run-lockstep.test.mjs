// sow-313 follow-up: THE ERASURE PLAN AND THE ERASURE RUN MUST DESCRIBE THE SAME THING.
//
// `planErasure` is the written procedure: what a person reads before running an erasure, and what stands as
// the documented answer to "what does this delete". `runErasure` is what actually happens. Nothing held them
// together, and they had drifted: four steps (follows, prefs, drafts, redeemed-invites) ran while the plan
// listed none of them, and one retired step ran with no plan entry at all for as long as it existed.
//
// TO BE PRECISE ABOUT THE SEVERITY, because over-stating it would be its own error: the AUDIT record was never
// wrong. buildAuditRecord is fed the steps runStep accumulated, not the plan, so what an erasure REPORTED
// having done was always accurate. What was short is the PLAN. An erasure that deletes somebody's follows,
// prefs and drafts while the documented procedure mentions none of them is a gap in the description.
//
// The drift is invisible without a check: nothing fails when the plan falls behind, and the plan is read by
// people rather than by code.
//
// A NEIGHBOURING CLAIM OF MINE WAS WRONG AND IS WITHDRAWN HERE, so nobody builds on it. Commit 569d0799 said
// "a broken erasure step survives a dry run". It does not. runErasure returns at erase-member.mjs:992 when
// `apply` is false and executes NO step, so a dry run was never going to catch a broken call; the probe that
// produced that claim was measuring the plan path and being read as the run path. A real apply is properly
// guarded: runStep records the throw as `outcome: 'error'` with its reason, and scripts/erase-member.mjs:89
// prints it and sets a non-zero exit. Driven to confirm before withdrawing it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { planErasure } from '../scripts/lib/erase-member.mjs';

const SRC = fs.readFileSync(fileURLToPath(new URL('../scripts/lib/erase-member.mjs', import.meta.url)), 'utf8');

/** The steps runErasure actually executes, read from the source: there is no way to enumerate them at runtime
 *  without performing an erasure. */
function executedSteps() {
  // Anchor inside runErasure, so a `runStep` mentioned anywhere else cannot be miscounted.
  const start = SRC.indexOf('export async function runErasure');
  assert.ok(start > 0, 'runErasure was not found: this check is broken, not the subject');
  const body = SRC.slice(start);
  return new Set([...body.matchAll(/runStep\('([a-z-]+)'/g)].map((m) => m[1]));
}

/**
 * Steps the plan declares `auto` but that runErasure does not call BY NAME, with the reason each is legitimate.
 * A step here is executed inside another one rather than as its own runStep, so the plan is accurate and the
 * name simply does not appear. Anything not listed here that is auto-and-not-run is a real finding.
 */
const BUNDLED_INTO_ANOTHER_STEP = new Map([
  // eraseContent rewrites house/members-index.yml inside the same pull request it opens for the content
  // flip, so there is nothing separate to call. The plan entry says so in its own text.
  ['members-index', 'performed inside the content step (eraseContent rewrites members-index.yml in the same PR)'],
]);

test('every AUTO step the plan promises is actually executed', () => {
  // The alarming direction: the procedure tells a reader something happens automatically and it does not.
  const run = executedSteps();
  const plan = planErasure({ githubId: '9', username: 'alice' });
  const missing = plan
    .filter((s) => s.auto && !run.has(s.step) && !BUNDLED_INTO_ANOTHER_STEP.has(s.step))
    .map((s) => s.step);
  assert.deepEqual(missing, [],
    `the plan declares these as automatic but runErasure never calls them: ${missing.join(', ')}. `
    + 'Either wire them into runErasure, mark them auto: false, or add them to BUNDLED_INTO_ANOTHER_STEP with a reason.');
});

test('every step that RUNS is declared in the plan', () => {
  // The direction that had actually drifted. An erasure doing more than its written procedure admits is not a
  // data leak, but the plan is the thing a person reads to know what an erasure touches.
  const run = executedSteps();
  const declared = new Set(planErasure({ githubId: '9', username: 'alice' }).map((s) => s.step));
  const undeclared = [...run].filter((s) => !declared.has(s));
  assert.deepEqual(undeclared, [],
    `runErasure performs these and planErasure never lists them: ${undeclared.join(', ')}. `
    + 'Add a plan entry saying what each one deletes.');
});

test('the bundled exemptions are REAL, not a place to hide a missing step', () => {
  // An exemption list is only as good as the claims in it. Each entry must name a step the plan still declares
  // (a stale exemption for a deleted step silently widens the guard) and must carry a stated reason.
  const declared = new Set(planErasure({ githubId: '9', username: 'alice' }).map((s) => s.step));
  for (const [step, reason] of BUNDLED_INTO_ANOTHER_STEP) {
    assert.ok(declared.has(step), `${step} is exempted here but the plan no longer declares it: remove the exemption`);
    assert.ok(reason && reason.length > 20, `${step}'s exemption has no real reason attached`);
  }
  // And the exemption must be justified in the SOURCE too, not only here: members-index is claimed to happen
  // inside eraseContent, so eraseContent must actually touch the members index.
  const fn = /export async function eraseContent[\s\S]*?\n}\n/.exec(SRC);
  assert.ok(fn, 'eraseContent was not found: this check is broken, not the subject');
  assert.match(fn[0], /MEMBERS_INDEX_PATH/,
    'members-index is exempted as "bundled into the content step", but eraseContent does not touch the members index');
});

test('the check can SEE the steps at all, so a green result means something', () => {
  // Both assertions above pass trivially on an empty set. This is the control: if the source shape changes and
  // either reader silently returns nothing, the guard would report a clean erasure path forever.
  const run = executedSteps();
  const plan = planErasure({ githubId: '9', username: 'alice' });
  assert.ok(run.size >= 12, `only ${run.size} executed steps found: the runStep reader is broken`);
  assert.ok(plan.length >= 15, `only ${plan.length} plan steps found: planErasure returned almost nothing`);
  // And the two readers must be looking at overlapping things, or they could each be reading a different file
  // and agreeing about nothing.
  const declared = new Set(plan.map((s) => s.step));
  const overlap = [...run].filter((s) => declared.has(s));
  assert.ok(overlap.length >= 10, `only ${overlap.length} steps appear in both: the two readers disagree about what a step is`);
});
