// sow-270 Phase 2: the edge copy refreshes when a config change LANDS, not six hours later.
//
// THE BUG THIS FILE EXISTS FOR. house/digest-config.yml said a save from the digest manager "calls the sync
// itself", and the sync function's own docstring said the same. Neither was true. The immediate refresh has
// exactly one caller, a role change, so every digest edit waited for the next 6-hourly tick. For copy that is
// merely embarrassing. For the sow-270 confirmation switch, which decides what a stranger consented to, a
// silent six-hour lag is the wrong behaviour and a comment claiming otherwise is worse.
//
// WHY A PUSH TRIGGER AND NOT A CALL FROM THE SAVE. The admin endpoint saves by opening a pull request, so a
// refresh fired at save time reads main BEFORE the merge. Worker-opened pull requests merged in a median of
// about 25 seconds over the last 40 merges, and a dispatched runner reaches its checkout in about the same
// time, so that refresh is a coin flip: lose it and the OLD value is written over the mirror, leaving the
// setting stale until the next tick. A push trigger runs on the merge commit, so it cannot read a pre-merge
// file. That is why this guard is about the workflow and not about the endpoint.
//
// The check is EMPIRICAL rather than a text scan. It runs the sync's three dry runs with fs instrumented and
// records which house/ files were actually opened, so a new source added to the job without a matching trigger
// path fails here instead of silently going stale for six hours. A text scan was tried first and was wrong: it
// matched a members-index.yml read that belongs to a different function and that this job never performs.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const WORKFLOW = path.join(ROOT, '.github/workflows/sync-overrides-mirror.yml');

/** Every house/*.yml the sync job opens, observed rather than parsed out of the source. */
async function housesActuallyRead() {
  const seen = new Set();
  const originals = {};
  for (const k of ['readFileSync', 'existsSync']) {
    originals[k] = fs[k];
    const orig = originals[k].bind(fs);
    fs[k] = (p, ...rest) => {
      const m = String(p).replace(/\\/g, '/').match(/house\/([a-z0-9-]+\.yml)$/);
      if (m) seen.add(m[1]);
      return orig(p, ...rest);
    };
  }
  try {
    const sync = await import('../scripts/sync-overrides-mirror.mjs');
    const { loadCouponsRaw } = await import('../scripts/lib/kv-mirror.mjs');
    await sync.syncOverridesMirror({ root: ROOT, dryRun: true });
    await sync.syncSyndicationConfigMirror({ root: ROOT, dryRun: true });
    await sync.syncDigestConfigMirror({ root: ROOT, dryRun: true });
    try { loadCouponsRaw(ROOT); } catch { /* absent is a state this job handles; the read still counts */ }
  } finally {
    for (const k of Object.keys(originals)) fs[k] = originals[k];
  }
  return seen;
}

const workflow = () => yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));
// `on:` parses as the boolean true in YAML 1.1, which js-yaml follows. Read both spellings rather than
// assuming, so this guard cannot quietly pass by reading an undefined key.
const triggers = (doc) => doc.on ?? doc[true];

test('the mirror sync runs on a push to main, so a merged config change does not wait for the cron', () => {
  const on = triggers(workflow());
  assert.ok(on, 'the workflow has no trigger block at all');
  assert.ok(on.push, 'no push trigger: a config save would wait up to six hours to reach the edge');
  assert.deepEqual(on.push.branches, ['main'], 'only main writes to live systems');
  assert.ok(Array.isArray(on.push.paths) && on.push.paths.length, 'an unscoped push trigger would run on every commit');
  assert.ok(on.schedule, 'the 6-hourly cron stays as the backstop; the push trigger is the fast path, not the only one');
});

test('every house file the sync actually reads is a push path, or its edits go stale silently', async () => {
  const read = await housesActuallyRead();
  assert.ok(read.size >= 5, `the probe observed only ${read.size} reads, so it is measuring nothing useful`);
  assert.ok(read.has('digest-config.yml'), 'the probe must see the file sow-270 is about');

  const paths = new Set(triggers(workflow()).push.paths);
  for (const file of [...read].sort()) {
    assert.ok(paths.has(`house/${file}`),
      `house/${file} is read by the sync but is not a push path, so a change to it waits for the cron`);
  }
});

test('the push trigger does not claim files the job never reads', async () => {
  const read = await housesActuallyRead();
  for (const p of triggers(workflow()).push.paths) {
    const file = p.replace(/^house\//, '');
    assert.ok(read.has(file),
      `${p} is a push trigger path but nothing in the sync reads it: it would run the job for nothing`);
  }
});

test('the main-only refusal still covers the manual path, and does not block the push one', () => {
  const doc = workflow();
  const first = doc.jobs.sync.steps[0];
  assert.match(first.name, /Refuse a manual run/, 'sow-295 requires the refusal as the first step of every job');
  // Scoped to workflow_dispatch on purpose. A push trigger is already branch-scoped by the trigger itself, and
  // widening this condition to every event would refuse the push runs this phase depends on.
  assert.match(first.if, /workflow_dispatch/);
  assert.doesNotMatch(first.if, /github\.event_name\s*!=\s*'push'/);
});
