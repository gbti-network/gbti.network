// sow-312 follow-up (owner request, 2026-09-04): the mail SEND RATE settings, as a plain config file rather
// than a Worker redeploy.
//
// WHY IT MOVED. The caps were readable only from `workers/signup/wrangler.toml` (MAIL_DAILY_CAP and friends),
// so changing how fast we send meant editing the Worker config and redeploying it. The owner asked to control
// it "from our env file or superadmin, whichever is more appropriate". There is no superadmin mail screen at
// all today, and the env file already worked but needed the deploy, so this takes the third route the codebase
// already uses for four other settings: a git-native house file that reconcile mirrors into KV, which the
// Worker reads live. Edit one line, push, and the next reconcile applies it with no redeploy.
//
// WHAT THE NUMBERS ARE FOR. Resend, which actually sends the mail, allows 100 a day and 3,000 a month on the
// free plan. We stay under that with headroom for retries. Raising the Resend plan and then raising these is
// the whole procedure.
//
// THE RESOLUTION ORDER, and each step exists for a reason:
//   1. the KV mirror   the live value, what this module is for
//   2. the env var     wrangler.toml, still honoured so an emergency change without a reconcile works
//   3. the code floor  because an UNSET value must never mean "no limit" (see mail-drain.mjs)
//
// NO STALENESS BOUND, DELIBERATELY, AND THE NEIGHBOURING MIRROR HAS ONE. `overrides:mirror` denies when it
// ages out, because it carries DERIVED state: who is banned changes without anyone touching the file, so an
// old copy is a wrong copy. A send cap is not derived. It is a number a person chose, and it is still that
// number a month later. Expiring it would fall back to the env var, which would silently RESUME SENDING after
// an owner set the cap to 0 to pause. That is the one fail-open this file must not have.

/** Hard bounds. Not policy, a typo guard: an extra zero on a paid plan is a real bill and a real suspension. */
export const MAIL_SETTINGS_LIMITS = Object.freeze({
  daily: { min: 0, max: 10000 },
  monthly: { min: 0, max: 300000 },
  perTick: { min: 0, max: 100 },
});

/** The KV key reconcile writes and the Worker drain reads. */
export const MAIL_SETTINGS_KV_KEY = 'mail:config';

/**
 * Coerce one cap. Returns null for anything that is not a usable number, so the caller falls through to the
 * next source rather than adopting a broken value.
 *
 * ZERO IS VALID AND IS THE PAUSE. `0` means send nothing, which is a setting a person may deliberately want,
 * so it must survive every check here. A negative, a fraction, a string, a NaN and an absent value are all
 * "not a setting" and return null. Out-of-range CLAMPS rather than rejecting, because the intent of `900000`
 * is clearly "as fast as possible" and silently reverting to 90 would be more surprising than capping it.
 */
export function coerceCap(value, bounds) {
  if (value === null || value === undefined || value === '') return null;
  // TYPE FIRST, THEN Number(). `Number([])` is 0 and `Number(true)` is 1, so a bare `Number(value)` would
  // ADOPT an empty list or a boolean from the config as a real cap. `[]` adopting as 0 is the worst of them,
  // because 0 is the pause switch: a malformed line would silently stop the newsletter. Found by the test
  // below rather than by reading this, which is the argument for writing the rejection cases out.
  const t = typeof value;
  if (t !== 'number' && t !== 'string') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const floored = Math.floor(n);
  if (floored < bounds.min) return null; // a negative is a mistake, not a request for zero
  return Math.min(floored, bounds.max);
}

/**
 * Project the parsed house/mail-settings.yml into the mirror body. Every field is optional; an absent or
 * unusable one is simply omitted, so the Worker falls through to its env var for that one cap alone rather
 * than for all three.
 */
export function buildMailSettingsMirror(raw, now = new Date()) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw.mail ?? raw) : {};
  const out = { generatedAt: now.toISOString() };
  const daily = coerceCap(src.daily_cap, MAIL_SETTINGS_LIMITS.daily);
  const monthly = coerceCap(src.monthly_cap, MAIL_SETTINGS_LIMITS.monthly);
  const perTick = coerceCap(src.per_tick_cap, MAIL_SETTINGS_LIMITS.perTick);
  if (daily !== null) out.dailyCap = daily;
  if (monthly !== null) out.monthlyCap = monthly;
  if (perTick !== null) out.perTickCap = perTick;
  return out;
}

/**
 * Resolve the three caps from the mirror, falling back per-cap. PURE: the caller supplies the already-read
 * mirror object and the env, so this is unit-tested with plain objects and no KV.
 *
 * PER-CAP, NOT ALL-OR-NOTHING. A mirror that carries only `dailyCap` leaves the other two on their env values.
 * The alternative, treating a partial mirror as absent, would mean setting one cap silently reset the others.
 */
export function resolveMailCaps({ mirror = null, env = {}, defaults } = {}) {
  const m = mirror && typeof mirror === 'object' && !Array.isArray(mirror) ? mirror : {};
  const pick = (mirrorKey, envKey, bounds, fallback) => {
    const fromMirror = coerceCap(m[mirrorKey], bounds);
    if (fromMirror !== null) return { value: fromMirror, source: 'mirror' };
    const fromEnv = coerceCap(env?.[envKey], bounds);
    if (fromEnv !== null) return { value: fromEnv, source: 'env' };
    return { value: fallback, source: 'default' };
  };
  return {
    daily: pick('dailyCap', 'MAIL_DAILY_CAP', MAIL_SETTINGS_LIMITS.daily, defaults.daily),
    monthly: pick('monthlyCap', 'MAIL_MONTHLY_CAP', MAIL_SETTINGS_LIMITS.monthly, defaults.monthly),
    perTick: pick('perTickCap', 'MAIL_MAX_PER_TICK', MAIL_SETTINGS_LIMITS.perTick, defaults.perTick),
  };
}
