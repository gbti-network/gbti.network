// The scheduled side of the signup Worker: the cron map, the jobs it runs, and the mail drain's composition root
// (mailDrainDeps). Moved out of index.mjs at the 900-line limit (owner, 2026-09-30). The Worker's `scheduled`
// handler delegates to runScheduled here, and index.mjs re-exports mailDrainDeps and resolveCronJob.

import { createStripeClient } from '../../clients/stripe.mjs';
import { sweepPreparedClaims } from './prepared-claim-sweep.mjs'; // sow-427: finalize claims nobody is watching
import { drainSyndication } from './syndication-drain.mjs';
import { ingest } from './news/src/ingest.mjs'; // UnifiedWorker: the hourly news RSS fetch + AI classify (was the gbti-news worker)
import { backfillImages } from './news/src/backfill.mjs'; // UnifiedWorker: the :30 og:image backfill
import { maybeSendWeeklyReport } from './mail-stats-report.mjs'; // after-send admin stats email (4-week rollup)
import { resolveSiteUrl, resolveClickBase } from '../../membership/mail-click.mjs';
import { isCentralDigestHour } from '../../membership/mail-compile-core.mjs'; // sow-166: which of the two Tuesday triggers is 7 AM Central today
import { compileWeeklyIssue, compileWelcomeIssue } from './mail-compile.mjs'; // SOW-166: weekly compile (freeze one issue + enqueue), sends nothing
import { drainMail } from './mail-drain.mjs'; // SOW-166: smoothed send drain on the shared 5-minute tick, behind the fail-closed gate
import { renderMailIssue } from '../../membership/mail-render-dispatch.mjs'; // SOW-166 digest + SOW-186 phase 4 follow template, routed by issue.kind (exported so this exact dispatcher is the line under test)
import { readDigestAudience } from './mail-audience.mjs'; // which closing a digest recipient reads
import { resolveDigestConfig, DIGEST_CONFIG_KV_KEY } from '../../membership/digest-config.mjs'; // sow-266: the owner's pitch copy + sponsor slot
import { resolveSubscriberEmail } from '../../membership/mail-address.mjs'; // SOW-166: anon decrypt / member-from-Stripe address resolution
import { createResendClient } from '../../clients/resend.mjs'; // SOW-166: transactional send (injected into the drain)

/**
 * UnifiedWorker cron dispatch. `workers/signup/wrangler.toml` must carry these strings EXACTLY, in BOTH
 * [triggers] and [env.production.triggers] (wrangler does not inherit triggers into a named env).
 *
 * A MAP, NOT A TERNARY CHAIN, AND THE REASON IS WORTH KEEPING. This dispatch used to end in a bare else that
 * ran the syndication drain, so it was never really a three-way choice: it was two recognised crons and a
 * CATCH-ALL. Any fourth cron string would have silently run drainSyndication instead of its own job.
 *
 * The fourth string is not hypothetical. The obvious next one is the SOW-166 weekly digest, and that is the
 * worst possible case for a catch-all: the digest would appear to do nothing while an unscheduled syndication
 * drain fired in its place, which reads as "the digest is broken" rather than as a misroute, and sends posts
 * to live channels at a time nobody is watching for them. An unrecognised schedule now runs NOTHING and says
 * so loudly, which is the failure a person can actually find.
 */
/**
 * SOW-166: the injected IO the mail drain needs. Address resolution is bi-modal (mail-address.mjs): an anon
 * subscriber's emailEnc is decrypted under MAIL_EMAIL_KEY; a member's address is fetched from their Stripe
 * Customer (the platform stores no member address of its own). renderIssue is the pure template. sendEmail is
 * the Resend transactional send, constructed lazily so an unset key never throws at wiring time. Every path is
 * fail-closed inside the drain: a null address or a thrown send is treated as "no usable address" / retryable,
 * never a silent success.
 */
// EXPORTED so a test can exercise THIS wiring rather than rebuilding it by hand. The same argument the SOW-186
// comment below makes about the kind dispatcher applies to the click counter: the ctx this function assembles is
// what decides whether a real digest link goes through the counter at all, and a test that reconstructs that ctx
// itself passes just as happily when this line stops passing it. That was measured, not assumed: with the wiring
// tested only by a hand-built ctx, deleting `clickBase` from this exact line left the whole suite green.
export async function mailDrainDeps(env) {
  const fetchMemberEmail = async ({ githubId, customerId }) => {
    if (!env.STRIPE_SECRET_KEY) return null;
    const stripe = createStripeClient({ apiKey: env.STRIPE_SECRET_KEY });
    const customer = customerId ? await stripe.getCustomer(customerId) : await stripe.searchCustomerByGithubId(githubId);
    return customer?.email || null;
  };
  const resolveAddress = (subscriber) => resolveSubscriberEmail(subscriber, { key: env.MAIL_EMAIL_KEY, fetchMemberEmail });
  const sendEmail = (message) => {
    if (!env.RESEND_API_KEY) throw new Error('RESEND_API_KEY not configured');
    return createResendClient({ apiKey: env.RESEND_API_KEY }).sendEmail(message);
  };
  // SOW-186 phase 4: the ONLY notification-delivery change to the Worker. The mail drain reads a single renderer
  // through this injected seam and never a kind-specific field, so kind dispatch belongs HERE at the composition
  // root, not in the drain. renderMailIssue routes a notification-kind issue to the lean follow template and every
  // other kind (the weekly digest) to the unchanged digest renderer. drainMail / mail-drain.mjs are untouched, so
  // a notification rides the exact same fail-closed send gate, rate budget, suppression re-check and one-click
  // unsubscribe as the digest. The dispatcher is a SHARED, EXPORTED function so this production line is the one the
  // tests exercise, not a hand-copy that can drift (QAmaster, 2026-08-22).
  // sow-273 follow-up: the click counter is wired HERE, at the composition root, for the same reason kind
  // dispatch is. The drain is pure over an injected renderer and must not learn about env; the renderer is a
  // pure template and must not either. This is the one place that holds both.
  //
  // BOTH SIDES OF THE ROUND TRIP READ THE SAME EXPRESSION. The renderer hashes a destination here and the /c/
  // route re-hashes it there, so resolveSiteUrl is called by both rather than each carrying its own default.
  // clickBase is PUBLIC_BASE_URL, which the drain already refuses to send without, so a message that goes out
  // always has a working counter, and an unset one means nothing was sent rather than links quietly degrading.
  const siteUrl = resolveSiteUrl(env);
  const clickBase = resolveClickBase(env);
  // sow-266 Phase 3: the owner's pitch copy and sponsor slot, read ONCE per drain rather than per recipient,
  // and closed over by the renderer. This is the composition root, so it is the only place that knows both the
  // key and the template; the drain stays pure over an injected renderer and the renderer stays pure over a ctx.
  //
  // FAIL-SAFE, NOT FAIL-CLOSED, and deliberately: an unreadable mirror resolves to the copy compiled into the
  // renderer, because an issue that goes out with last month's wording beats one that goes out with no pitch.
  // The sponsor is the opposite and resolves OFF, because rendering an advertisement by accident is the one
  // mistake here that cannot be taken back.
  //
  // A FROZEN ISSUE RENDERS WITH TODAY'S COPY. The settings are a standing decision, not part of the issue, so
  // an issue compiled last week and sent now carries the wording in force now. That is the intent: it is how
  // switching the sponsor off stops the next send rather than only the next compile.
  let digestConfig;
  try {
    const raw = await env.SIGNUP_KV?.get(DIGEST_CONFIG_KV_KEY, 'json');
    digestConfig = resolveDigestConfig({ mirror: raw ?? null });
  } catch {
    digestConfig = resolveDigestConfig({ mirror: null });
  }
  // sow-383: webBase builds the "View this issue on the web" link; the web edition is served from this Worker.
  // Owner, 2026-09-29: the closing message's audience, per recipient, from the members-edition entitlement list.
  const audienceOf = await readDigestAudience(env);
  const renderIssue = (issue, ctx = {}) => renderMailIssue(issue, { siteUrl, clickBase, webBase: clickBase, digestConfig, audience: audienceOf(ctx.subscriber), ...ctx });
  return { resolveAddress, renderIssue, sendEmail };
}

/**
 * SOW-166: the shared 5-minute tick runs the syndication drain AND the smoothed mail drain. The mail drain is
 * independently fail-closed (it sends nothing until the owner opens the send gate), so the two COMPOSE on one
 * schedule rather than the mail drain replacing the syndication drain (the old catch-all bug in reverse).
 * allSettled so a failure in one never suppresses the other, and both outcomes are logged by scheduled().
 */
async function drainFiveMinute(env) {
  // sow-166: sweep for unwelcomed subscribers BEFORE draining, and sequentially rather than alongside. Running
  // it in the allSettled pair would race the drain's read of the pending index, so a subscriber enqueued this
  // tick would usually wait for the next one. Sweeping first means somebody who confirms their subscription is
  // sent their 90-day welcome on this same tick. It short-circuits to a single KV list when nobody is waiting,
  // which is almost every tick, and a failure here must never suppress the drain below.
  let welcome;
  try {
    welcome = await compileWelcomeIssue(env);
  } catch (e) {
    welcome = { error: String(e?.message ?? e) };
  }

  const [syndication, mail] = await Promise.allSettled([
    drainSyndication(env),
    drainMail(env, await mailDrainDeps(env)),
  ]);
  const settle = (r) => (r.status === 'fulfilled' ? r.value : { error: String(r.reason?.message ?? r.reason) });

  // AFTER the drain: if a weekly issue just finished sending, snapshot its totals, and on Friday from 09:00
  // Chicago email the owner the 4-week performance report (once per issue). Runs after drainMail so this tick's
  // terminal send records are counted. Fail-soft, so it never suppresses the drain result above.
  let report;
  try { report = await maybeSendWeeklyReport(env); }
  catch (e) { report = { error: String(e?.message ?? e) }; }

  // sow-427 amendment 2: finalize prepared-listing claims nobody is watching (bounded, quarter-hourly, COUNTS ONLY).
  let prepared;
  try { prepared = await sweepPreparedClaims(env); } catch { prepared = { error: true }; }

  return { syndication: settle(syndication), mail: settle(mail), welcome, report, prepared };
}

// Shared by both Tuesday triggers. The guard is inside `run` rather than in the map so an out-of-hour tick still
// RESOLVES (the dispatcher treats an unresolved cron as a configuration error and shouts), it simply does no work.
const WEEKLY_DIGEST_JOB = {
  // minGapDays: the SCHEDULED compile never sends an issue within six days of the last one, so moving the send
  // day (Monday to Tuesday, 2026-09-21) cannot mail two issues on consecutive days. Only the cron passes it;
  // the admin's manual compile is a deliberate act and is not held back.
  run: (env) => (isCentralDigestHour(Date.now())
    ? compileWeeklyIssue(env, { minGapDays: 6 })
    : Promise.resolve({ ok: true, skipped: 'not the 07:00 America/Chicago hour' })),
  label: 'weekly digest compile',
};

const CRON_JOBS = new Map([
  ['0 * * * *', { run: ingest, label: 'news ingest' }],                 // fetch sources, dedupe, AI-classify, prune -> NEWS_KV
  ['30 * * * *', { run: backfillImages, label: 'news image backfill' }], // scrape og:images for stored items lacking one (SOW-050)
  // SOW-166 + owner rulings 2026-08-25 and 2026-09-21: 7 AM Central every TUESDAY. Cloudflare numbers weekdays
  // from Sunday = 1, so Tuesday is `3` (the `2` this carried until 2026-09-21 was Monday; test/digest-send-day
  // holds the subscriber copy to whatever day this is). Cloudflare
  // cron is UTC with no daylight handling, so that hour is 12:00 UTC in summer and 13:00 UTC in winter; BOTH are
  // declared and isCentralDigestHour picks the real one. They share a job, which is why the dispatch test now
  // pins five schedules onto four distinct jobs rather than a one-to-one map. Freezes one issue + enqueues it,
  // and sends nothing: the 5-minute drain is what sends.
  ['0 12 * * 3', WEEKLY_DIGEST_JOB], // 07:00 America/Chicago while daylight time is in effect (Mar-Nov)
  ['0 13 * * 3', WEEKLY_DIGEST_JOB], // 07:00 America/Chicago while standard time is in effect (Nov-Mar)
  ['*/5 * * * *', { run: drainFiveMinute, label: 'syndication + mail drain' }], // SOW-058 syndication + SOW-166 mail drain
]);

/**
 * Resolve a cron string to the job it runs. PURE and exported so the routing is testable without invoking the
 * jobs themselves. An unknown schedule resolves to null. It MUST NOT resolve to a default: a default here is
 * precisely the catch-all this exists to remove.
 */
export function resolveCronJob(cron) {
  return CRON_JOBS.get(cron) ?? null;
}

// Each job is fail-closed + best-effort (a failure never breaks the cron) and runs via ctx.waitUntil so the
// handler returns immediately. ingest (dedupe by guid) + backfillImages (imgTried flag) are idempotent, so an
// overlap with the still-deployed gbti-news worker during cutover is safe. Routing lives in CRON_JOBS above.
export async function runScheduled(controller, env, ctx) {
  const cron = controller?.cron;
  const entry = resolveCronJob(cron);
  if (!entry) {
    // Loud and specific, because the whole point is that this stops being invisible. Nothing is run: a
    // schedule we do not recognise is a configuration error, and guessing at it is what caused the problem.
    console.error('cron dispatch: UNRECOGNISED schedule, no job run', JSON.stringify({ cron: cron ?? null }));
    return;
  }
  ctx.waitUntil(entry.run(env).then(
    (r) => console.log(entry.label, JSON.stringify(r)),
    (e) => console.error(`${entry.label} failed`, e?.message ?? e),
  ));
}
