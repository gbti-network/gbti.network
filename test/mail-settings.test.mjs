// sow-312 follow-up: the send-rate caps become a config file the owner edits, instead of a Worker redeploy.
//
// The behaviours worth pinning are the ones that decide whether the owner can TRUST the knob, and one of them
// is a fail-open that would be invisible: setting the cap to 0 to PAUSE sending, and then having sending
// quietly resume because something fell back to the env var.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';

import { coerceCap, buildMailSettingsMirror, resolveMailCaps, MAIL_SETTINGS_LIMITS, MAIL_SETTINGS_KV_KEY } from '../membership/mail-settings.mjs';
import { drainMail, MAIL_CAP_DEFAULTS } from '../workers/signup/mail-drain.mjs';

const D = MAIL_CAP_DEFAULTS;

test('ZERO IS A SETTING, and it survives every layer', () => {
  // The pause switch. If any check here treats 0 as "absent" and falls through, an owner who paused sending
  // gets it resumed for them, which is the one failure this whole file has to prevent.
  assert.equal(coerceCap(0, MAIL_SETTINGS_LIMITS.daily), 0);
  assert.equal(coerceCap('0', MAIL_SETTINGS_LIMITS.daily), 0);
  assert.deepEqual(buildMailSettingsMirror({ mail: { daily_cap: 0 } }).dailyCap, 0);
  const r = resolveMailCaps({ mirror: { dailyCap: 0 }, env: { MAIL_DAILY_CAP: '90' }, defaults: D });
  assert.equal(r.daily.value, 0, 'a paused cap must not fall through to the env var');
  assert.equal(r.daily.source, 'mirror');
});

test('the resolution order is mirror, then env, then the built-in floor', () => {
  assert.deepEqual(resolveMailCaps({ mirror: { dailyCap: 200 }, env: { MAIL_DAILY_CAP: '90' }, defaults: D }).daily,
    { value: 200, source: 'mirror' });
  assert.deepEqual(resolveMailCaps({ mirror: null, env: { MAIL_DAILY_CAP: '55' }, defaults: D }).daily,
    { value: 55, source: 'env' });
  assert.deepEqual(resolveMailCaps({ mirror: null, env: {}, defaults: D }).daily,
    { value: D.daily, source: 'default' });
});

test('a PARTIAL config leaves the other caps alone', () => {
  // Setting one number must not silently reset the other two. Treating a partial mirror as absent would do
  // exactly that, and the owner would have no way to tell from the outside.
  const r = resolveMailCaps({ mirror: { dailyCap: 40 }, env: { MAIL_MONTHLY_CAP: '1500', MAIL_MAX_PER_TICK: '4' }, defaults: D });
  assert.equal(r.daily.value, 40);
  assert.equal(r.monthly.value, 1500, 'the monthly cap keeps its env value');
  assert.equal(r.perTick.value, 4, 'the per-run cap keeps its env value');
});

test('a broken value falls THROUGH rather than being adopted', () => {
  // Anything that is not a usable number is "not a setting". Adopting it is the fail-open: NaN, null and a
  // negative all become 0 or Infinity somewhere downstream if they are let past.
  for (const bad of [null, undefined, '', 'lots', NaN, -1, {}, [], true]) {
    assert.equal(coerceCap(bad, MAIL_SETTINGS_LIMITS.daily), null, `${JSON.stringify(bad)} must not be adopted`);
  }
  const r = resolveMailCaps({ mirror: { dailyCap: 'lots' }, env: { MAIL_DAILY_CAP: '70' }, defaults: D });
  assert.equal(r.daily.value, 70, 'a broken mirror value falls through to the env');
});

test('an absurd number is CLAMPED, because an extra zero is a bill', () => {
  assert.equal(coerceCap(900000, MAIL_SETTINGS_LIMITS.daily), MAIL_SETTINGS_LIMITS.daily.max);
  assert.equal(coerceCap(500, MAIL_SETTINGS_LIMITS.perTick), MAIL_SETTINGS_LIMITS.perTick.max);
  assert.equal(coerceCap(99, MAIL_SETTINGS_LIMITS.perTick), 99, 'a value UNDER the ceiling passes through untouched');
  // But a plausible raise for a paid plan passes straight through, or the clamp would make the knob useless.
  assert.equal(coerceCap(5000, MAIL_SETTINGS_LIMITS.daily), 5000);
});

test('the committed config file parses and yields sane caps', () => {
  // A guard on the real file, not a fixture: a typo in house/mail-settings.yml is exactly the mistake this
  // feature invites, and it would otherwise show up as sending stopping for a week.
  const raw = yaml.load(fs.readFileSync(fileURLToPath(new URL('../house/mail-settings.yml', import.meta.url)), 'utf8'));
  const mirror = buildMailSettingsMirror(raw);
  assert.ok(Number.isInteger(mirror.dailyCap), 'daily_cap is missing or not a number');
  assert.ok(Number.isInteger(mirror.monthlyCap), 'monthly_cap is missing or not a number');
  assert.ok(Number.isInteger(mirror.perTickCap), 'per_tick_cap is missing or not a number');
  // Resend's free tier is 100/day and 3,000/month. The committed values must sit under it, because that is
  // the plan we are on; raising them is a deliberate act that should fail here and be re-read.
  assert.ok(mirror.dailyCap <= 100, `daily_cap ${mirror.dailyCap} exceeds the Resend free tier (100). Raise the plan first.`);
  assert.ok(mirror.monthlyCap <= 3000, `monthly_cap ${mirror.monthlyCap} exceeds the Resend free tier (3000). Raise the plan first.`);
});

test('the DRAIN reads the live config, and an explicit argument still wins', async () => {
  // The end of the chain. Without this the resolver could be perfect and never consulted.
  const bounds = [];
  const log = console.log;
  console.log = (line) => { try { const o = JSON.parse(line); if (o.evt === 'mail-drain-bounds') bounds.push(o); } catch { /* not ours */ } };
  try {
    const kv = { get: async () => null, list: async () => ({ keys: [], list_complete: true }) };
    // MAIL_SEND_UNRESTRICTED, not MAIL_SEND_GATE. The bounds line only logs when the gate is not closed,
    // so with the wrong name every assertion below reads undefined and the test fails for the wrong reason.
    const env = { MAIL_SEND_UNRESTRICTED: 'true', MAIL_DAILY_CAP: '90' };

    // A mirror carrying 7 must beat the env's 90.
    await drainMail(env, { kv, issueId: 'weekly-2026-09-08', readSettings: async () => ({ dailyCap: 7 }) });
    assert.equal(bounds.at(-1)?.dailyCap, 7, 'the drain ignored the live config');
    assert.equal(bounds.at(-1)?.capSource?.daily, 'mirror');

    // An explicit caller argument overrides even the mirror, which is how the admin trigger and the existing
    // tests keep working. `=== undefined` rather than a falsy test is what makes an explicit 0 work too.
    await drainMail(env, { kv, issueId: 'weekly-2026-09-08', dailyCap: 3, readSettings: async () => ({ dailyCap: 7 }) });
    assert.equal(bounds.at(-1)?.dailyCap, 3);
    assert.equal(bounds.at(-1)?.capSource?.daily, 'arg');

    // A KV failure must not stop the send: it falls back to the env.
    await drainMail(env, { kv, issueId: 'weekly-2026-09-08', readSettings: async () => { throw new Error('kv down'); } });
    assert.equal(bounds.at(-1)?.dailyCap, 90, 'a failed config read must fall back, not halt');
  } finally {
    console.log = log;
  }
});

test('the mirror key is stated once and reconcile writes THAT key', async () => {
  // The two halves are in different processes, so nothing else would catch a typo on either side: reconcile
  // would write happily and the drain would read nothing, forever, with no error anywhere.
  assert.equal(MAIL_SETTINGS_KV_KEY, 'mail:config');
  const mirror = await import('../scripts/lib/kv-mirror.mjs');
  assert.equal(mirror.MAIL_SETTINGS_KEY, MAIL_SETTINGS_KV_KEY, 'reconcile and the drain disagree about the key');
});
