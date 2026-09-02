#!/usr/bin/env node
// Weekly KV usage report. Pulls Workers KV operations from Cloudflare's GraphQL analytics (by namespace, by
// day) and emails a short digest to the admin address, so we can see where KV writes are going and catch a
// trend before it matters. Also prints the report to stdout, so the Actions log always carries it even if
// email is unconfigured. See .data/ops/cloudflare-ops/kv-worker-ops.md.
//
// WHY THIS EXISTS: KV free-tier writes are ACCOUNT-LEVEL (1,000/day shared across every namespace). The
// account blew that on 2026-08-25 and we moved to Workers Paid (1,000,000/day). We keep no itemized KV usage
// store of our own; Cloudflare's analytics is the source, and this is the recurring read of it.
//
// SHAPE OF THIS FILE: the logic lives in exported, dependency-injected functions and the top-level run is
// guarded at the bottom, the same arrangement scripts/check-credentials.mjs uses. That guard is what lets the
// test suite drive main() with a fake fetch and assert on the message that actually reaches Resend, rather
// than testing a body builder that nothing is proven to call. The email carries BOTH a plain-text part (the
// fixed-width report, unchanged) and an html part rendered through the shared ops layout.
//
// ENV:
//   CF_ANALYTICS_TOKEN   REQUIRED. A Cloudflare token with "Account Analytics: Read". (CF_API_TOKEN, the
//                        reconcile KV token, does NOT have analytics scope; confirmed 2026-08-26.)
//   CF_ACCOUNT_ID        optional, defaults to the GBTI account tag.
//   KV_REPORT_DAYS       optional, days of history to report (default 8, clamped 1..90). A manual run may
//                        pass --days N on the command line, which overrides this.
//   KV_WRITE_WARN        optional, per-day write threshold to flag as elevated (default 1000, the old free cap
//                        that a paid-plan day still worth noticing would cross).
//   RESEND_API_KEY       the Resend key. Email is OPT-IN: it sends ONLY with the --email flag (or
//                        KV_REPORT_SEND=true), so a manual run just prints. The scheduled workflow passes it.
//   ALERT_EMAIL          the recipient (the admin address). Reuses the credential-health alert var.
//   RESEND_FROM / MAIL_FROM  the verified from-address.
//
// Exit code: 1 on a hard failure (no analytics token, or a GraphQL/auth error) so a scheduled run goes RED as
// a backstop signal. An email-send failure is soft (logged, never fatal): the numbers are already in the log.

import { createResendClient } from '../clients/resend.mjs';
import { opsEmail } from '../membership/mail-ops.mjs';

// The GBTI account tag. Not a secret (it appears in every dashboard url); the token beside it is.
const DEFAULT_ACCOUNT = 'd42b12e969229c5187ad0f7289536487';

// Namespace ids are opaque hex. This is the local map to the names we actually say out loud.
const NAMED = { '49432379e11844ac81b6fdaf22d3937a': 'SIGNUP_KV', '64b09b4d03764c979447cc008ffe528c': 'NEWS_KV' };

const DOC = '.data/ops/cloudflare-ops/kv-worker-ops.md';

const QUERY = `query($tag:String!,$geq:Date!,$leq:Date!){
  viewer{accounts(filter:{accountTag:$tag}){
    kvOperationsAdaptiveGroups(limit:10000,filter:{date_geq:$geq,date_leq:$leq}){
      sum{requests} dimensions{actionType namespaceId date}
    }
  }}
}`;

const fmtDate = (d) => d.toISOString().slice(0, 10);

// Write and delete both draw on the account write cap, so the number that matters is their sum.
const wd = (x) => (x.write || 0) + (x.delete || 0);

/**
 * Everything the run needs, read from env and argv in one place so a test can hand main() a whole
 * configuration without touching the real process. Precedence is unchanged: --days N (a manual run) beats
 * KV_REPORT_DAYS (the workflow) beats the default of 8, clamped to 1..90.
 */
/** The Workers Paid per-day account write cap. A REAL constant, not prose: the report used to state it in a
 *  sentence and compute nothing from it, so a reader had to divide in their head to learn the one thing the
 *  report exists to tell them. Every quota claim below is derived from this. */
export const DAILY_WRITE_CAP = 1_000_000;

/** The spike rule's floor. A purely relative rule alarms on noise at low volume (a median of 2 makes 7 a
 *  "3.5x spike"), so a day must ALSO clear this to count. Tied to the cap at 0.05% rather than hardcoded, so
 *  it keeps its meaning if the plan changes. */
export const SPIKE_FLOOR = Math.round(DAILY_WRITE_CAP * 0.0005);

/** Default multiple of the range median that counts as a spike.
 *
 *  2.5 rather than 3, and the difference was MEASURED rather than picked. Against the real 2026-08-25 to
 *  09-02 range the median is 351 and the spike day is 1,042, which is 2.97x: a threshold of 3x misses the one
 *  day this rule exists to catch, by one percent. The next-busiest day is 446 (1.27x), so 2.5 separates the
 *  spike from ordinary days with room on both sides. Re-check this if the traffic shape changes.
 */
export const SPIKE_RATIO = 2.5;

/** Thousands separators without a locale dependency (CI locales vary and a report should not). */
export const fmt = (n) => String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** Percentage of the daily cap, to two places. Small numbers matter here: 0.10% is the honest answer and
 *  rounding it to 0% would delete the report's point. */
export const pctOfCap = (n) => `${((Number(n) || 0) / DAILY_WRITE_CAP * 100).toFixed(2)}%`;

/** Median of a numeric list. Median rather than mean, deliberately: one spike day drags a mean upward and
 *  raises the very threshold meant to catch it, so a second spike of the same size would pass. */
export function median(values) {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!v.length) return 0;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function resolveConfig({ env = {}, argv = [] } = {}) {
  const daysArgIdx = argv.indexOf('--days');
  const daysArg = daysArgIdx !== -1 ? argv[daysArgIdx + 1] : '';
  return {
    token: env.CF_ANALYTICS_TOKEN || '',
    account: env.CF_ACCOUNT_ID || DEFAULT_ACCOUNT,
    days: Math.max(1, Math.min(90, parseInt(daysArg || env.KV_REPORT_DAYS || '8', 10) || 8)),
    // KV_WRITE_WARN is now an OPTIONAL ABSOLUTE OVERRIDE and defaults to unset. It used to default to
    // 1000, the OLD FREE cap, so the report's only alarm fired at 0.1% of the actual paid limit and
    // called a day that was never near trouble 'elevated'. The default rule is relative now (see summarize).
    warn: env.KV_WRITE_WARN ? Math.max(1, parseInt(env.KV_WRITE_WARN, 10) || 1) : null,
    spikeRatio: Math.max(1, parseFloat(env.KV_WRITE_SPIKE_RATIO || '') || SPIKE_RATIO),
    floor: Math.max(1, parseInt(env.KV_WRITE_FLOOR || '', 10) || SPIKE_FLOOR),
    wantEmail: argv.includes('--email') || env.KV_REPORT_SEND === 'true',
    apiKey: env.RESEND_API_KEY || '',
    from: env.RESEND_FROM || env.MAIL_FROM || '',
    to: env.ALERT_EMAIL || '',
  };
}

/**
 * Fold the analytics rows into the two views the report shows: per day (all four action types) and per
 * namespace (writes and deletes only, since a read costs nothing against the cap). Pure, so the arithmetic
 * is testable without a network call. The numbers here are unchanged from the first version of this script.
 */
export function summarize(rows, { warn = null, spikeRatio = SPIKE_RATIO, floor = SPIKE_FLOOR } = {}) {
  const byDay = {}, byNs = {};
  for (const r of rows) {
    const { date: d, actionType: a, namespaceId: ns } = r.dimensions;
    const n = r.sum.requests;
    (byDay[d] ||= { read: 0, write: 0, delete: 0, list: 0 });
    byDay[d][a] = (byDay[d][a] || 0) + n;
    if (a === 'write' || a === 'delete') { (byNs[ns] ||= { write: 0, delete: 0 }); byNs[ns][a] += n; }
  }
  const dayKeys = Object.keys(byDay).sort();
  const peak = dayKeys.reduce((m, d) => Math.max(m, wd(byDay[d])), 0);
  const med = median(dayKeys.map((d) => wd(byDay[d])));
  const spikeAt = warn != null ? warn : Math.max(floor, Math.ceil(spikeRatio * med));
  const nsKeys = Object.entries(byNs).sort((a, b) => wd(b[1]) - wd(a[1]));
  return {
    byDay,
    byNs,
    dayKeys,
    nsKeys,
    lastDay: dayKeys[dayKeys.length - 1],
    peak,
    median: med,
    spikeAt,
    // A day is worth a look when it BREAKS FROM ITS OWN TREND, not when it passes a number. At a thousandth
    // of the cap an absolute quota threshold cannot fire until something is already badly wrong, whereas a
    // runaway writer shows up immediately as a multiple of the median. The floor stops a quiet range from
    // manufacturing spikes out of noise.
    elevated: dayKeys.filter((d) => wd(byDay[d]) >= spikeAt),
  };
}

/** The quota sentence, in one place because the html and the text parts must not drift apart. This is the
 *  line the report exists for and it never existed before: the old version stated the cap and the counts and
 *  left the division to the reader. */
export function capLine(summary) {
  const { peak, dayKeys, byDay } = summary;
  if (!dayKeys.length) return `Daily write cap ${fmt(DAILY_WRITE_CAP)}.`;
  const peakDay = dayKeys.reduce((best, d) => (wd(byDay[d]) > wd(byDay[best]) ? d : best), dayKeys[0]);
  return `Peak ${fmt(peak)} on ${peakDay} used ${pctOfCap(peak)} of the ${fmt(DAILY_WRITE_CAP)}/day write cap.`;
}

/** The spike sentence. Names the multiple and the median it is measured against, because "elevated" on its
 *  own tells the reader nothing about whether to care. */
export function spikeLine(summary) {
  const { elevated, byDay, median: med, dayKeys, spikeAt } = summary;
  if (!elevated.length) {
    return `No day broke from trend. Median ${fmt(med)} a day over ${dayKeys.length} day(s), `
      + `and the spike line sits at ${fmt(spikeAt)}.`;
  }
  const parts = elevated.map((d) => {
    const t = wd(byDay[d]);
    const x = med > 0 ? `${(t / med).toFixed(1)}x` : 'well above';
    return `${d} ran ${fmt(t)} writes, ${x} the ${dayKeys.length}-day median of ${fmt(med)}`;
  });
  return `${parts.join('; ')}. Worth a look at what ran.`;
}

/**
 * The plain-text report. It is BOTH the stdout copy (so the Actions log always carries the numbers, even
 * when email is off or fails) and the text part of the email, which is why it keeps its fixed-width columns
 * rather than following the html. Do not reflow it to match the html body; the two parts are read in
 * different places by different tools.
 */
export function reportText(summary, { geq, leq, account, warn }) {
  const { byDay, dayKeys, nsKeys, peak, elevated } = summary;
  const lines = [];
  lines.push(`GBTI Workers KV usage, ${geq} to ${leq} (account ${account}).`);
  lines.push(`Plan: Workers Paid, write cap ${fmt(DAILY_WRITE_CAP)}/day.`);
  lines.push(capLine(summary));
  lines.push('');
  lines.push('per DAY (write + delete both draw on the cap):');
  lines.push('date         read      write     delete    list      WRITE+DEL');
  for (const d of dayKeys) {
    const x = byDay[d];
    const t = wd(x);
    const flag = summary.elevated.includes(d) ? '  <- spike' : '';
    lines.push([d.padEnd(12), String(x.read || 0).padEnd(9), String(x.write || 0).padEnd(9),
      String(x.delete || 0).padEnd(9), String(x.list || 0).padEnd(9), String(t).padEnd(9) + flag].join(' '));
  }
  lines.push('');
  lines.push('per NAMESPACE (write + delete, whole range):');
  for (const [ns, x] of nsKeys) {
    lines.push(`  ${ns}${NAMED[ns] ? ' (' + NAMED[ns] + ')' : ''}  write=${x.write}  delete=${x.delete}  total=${wd(x)}`);
  }
  lines.push('');
  lines.push((elevated.length ? 'NOTE: ' : '') + spikeLine(summary));
  return lines.join('\n');
}

/**
 * The html body, through the shared ops layout. Real tables rather than the console dump this used to paste
 * into a <pre>: the point of a table is that the owner can compare DOWN a column on a phone, which
 * fixed-width text in a proportional mail font cannot do.
 *
 * WHY THE PER-DAY FIGURES ARE SPLIT ACROSS TWO TABLES rather than reproducing the six columns of the text
 * report. An email table cannot scroll sideways, so every column has to fit the narrowest screen it will be
 * read on. At 375px the card is about 297px wide, and six columns leave roughly twelve pixels of content
 * each: the shared layout then wraps inside the number itself, and "42434" renders as three stacked
 * fragments that a reader can easily take for three separate figures. Four columns leave about thirty four
 * pixels and three leave about sixty, which is why the wide read counts sit in the three-column table and
 * the cap draw, the actual subject of this report, gets its own four-column one. Do not merge them back
 * into one table without re-checking it at 375px.
 *
 * The elevated marker rides in the DATE cell, not next to the total, for the same width reason: a
 * parenthetical in a numeric column would wrap in the middle of a number. The alert band below names the
 * same days again.
 */
export function reportHtml(summary, { geq, leq, account, warn }) {
  const { byDay, dayKeys, nsKeys, peak, elevated } = summary;
  const sections = [];

  if (dayKeys.length) {
    sections.push({ kind: 'paragraph', text: 'Per day, writes and deletes. Both draw on the account write cap.' });
    // The chart leads and the table follows, because they answer different questions: the bars show the SHAPE
    // of the week at a glance, the table gives the digits for the day the shape makes you look at. Scaled to
    // the busiest day, with the quota stated in the caption; see barsHtml for why not scaled to the cap.
    sections.push({
      kind: 'bars',
      caption: capLine(summary),
      rows: dayKeys.map((d) => [d, wd(byDay[d]), fmt(wd(byDay[d]))]),
    });
    sections.push({
      kind: 'table',
      columns: ['Date', 'Write', 'Delete', 'Total'],
      rows: dayKeys.map((d) => {
        const x = byDay[d];
        const total = wd(x);
        return [elevated.includes(d) ? `${d} (spike)` : d, x.write || 0, x.delete || 0, total];
      }),
    });
    sections.push({ kind: 'paragraph', text: 'Per day, reads and lists. Neither draws on the write cap.' });
    sections.push({
      kind: 'table',
      columns: ['Date', 'Read', 'List'],
      rows: dayKeys.map((d) => [d, byDay[d].read || 0, byDay[d].list || 0]),
    });
  } else {
    // A bare header row with nothing under it reads as a broken report, so say plainly that the range was
    // empty. An empty range is normal for a narrow --days window, not a failure.
    sections.push({ kind: 'paragraph', text: `Cloudflare reported no KV operations between ${geq} and ${leq}.` });
  }

  if (nsKeys.length) {
    sections.push({ kind: 'paragraph', text: 'Per namespace, writes and deletes across the whole range.' });
    sections.push({
      kind: 'table',
      columns: ['Namespace', 'Write', 'Delete', 'Total'],
      // Friendly name first, opaque id in parentheses: the name is what identifies the namespace to a
      // reader, and the id is only needed when it is one we have not mapped.
      rows: nsKeys.map(([ns, x]) => [NAMED[ns] ? `${NAMED[ns]} (${ns})` : ns, x.write, x.delete, wd(x)]),
    });
  }

  sections.push(elevated.length
    ? { kind: 'alert', text: spikeLine(summary) }
    : { kind: 'note', text: spikeLine(summary) });

  const { html } = opsEmail({
    title: 'Workers KV usage',
    // The lead states the quota AS USED, not merely as a number. The old wording gave the cap and then the
    // OLD FREE cap, which invited the reader to measure today against a limit that no longer applies.
    lead: `${geq} to ${leq}, account ${account}. Plan: Workers Paid, write cap `
      + `${fmt(DAILY_WRITE_CAP)} a day. ${capLine(summary)}`,
    sections,
    footer: `Weekly report from the kv-usage-report workflow. Details in ${DOC}.`,
  });
  return html;
}

/** The whole message: subject, the plain-text fallback, and the html body. */
export function buildEmail(summary, cfg) {
  const { byDay, lastDay, elevated } = summary;
  return {
    subject: `GBTI KV usage: ${wd(byDay[lastDay] || {})} writes on ${lastDay}`
      + `${elevated.length ? ` (${elevated.length} day[s] above trend)` : ''}`,
    text: reportText(summary, cfg),
    html: reportHtml(summary, cfg),
  };
}

/**
 * Fetch, report, and (opt-in) email. Returns the process exit code rather than calling process.exit, so the
 * test suite can run it; the guard at the bottom of the file does the exiting for a real invocation.
 *
 * `fetch` is injected all the way through, including into the Resend client, so a test observes the actual
 * outbound request instead of a stub standing in for the send.
 */
export async function main({
  env = process.env,
  argv = process.argv,
  fetch = globalThis.fetch,
  now = Date.now(),
  log = console.log,
  errorLog = console.error,
} = {}) {
  const cfg = resolveConfig({ env, argv });
  if (!cfg.token) {
    errorLog('kv-usage-report: CF_ANALYTICS_TOKEN is not set (needs Account Analytics Read). No report produced.');
    return { code: 1, sent: false };
  }

  const geq = fmtDate(new Date(now - cfg.days * 864e5));
  const leq = fmtDate(new Date(now));

  let j;
  try {
    const res = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: QUERY, variables: { tag: cfg.account, geq, leq } }),
    });
    j = JSON.parse(await res.text());
  } catch (err) {
    errorLog('kv-usage-report: the analytics request failed: ' + (err?.message || err));
    return { code: 1, sent: false };
  }
  if (j.errors && j.errors.length) {
    errorLog('kv-usage-report: GraphQL error: ' + JSON.stringify(j.errors).slice(0, 400));
    return { code: 1, sent: false };
  }

  const rows = j.data?.viewer?.accounts?.[0]?.kvOperationsAdaptiveGroups || [];
  const summary = summarize(rows, { warn: cfg.warn });
  const { subject, text, html } = buildEmail(summary, { geq, leq, account: cfg.account, warn: cfg.warn });
  log(text);

  // Email is OPT-IN, so a manual run just prints. The scheduled workflow passes --email (or KV_REPORT_SEND=true).
  if (!cfg.wantEmail) {
    log('\n(print only; pass --email to send)');
    return { code: 0, sent: false };
  }
  if (!cfg.apiKey || !cfg.from || !cfg.to) {
    const missing = !cfg.apiKey ? 'no RESEND_API_KEY' : !cfg.from ? 'no RESEND_FROM/MAIL_FROM' : 'no ALERT_EMAIL';
    log(`\n(email skipped: ${missing})`);
    return { code: 0, sent: false };
  }
  try {
    await createResendClient({ apiKey: cfg.apiKey, fetch })
      .sendEmail({ from: cfg.from, to: cfg.to, subject, text, html });
    log(`\n(emailed to ${cfg.to})`);
    return { code: 0, sent: true };
  } catch (err) {
    errorLog(`\n(email failed, not fatal: ${err?.message || err})`);
    return { code: 0, sent: false };
  }
}

// Only run when invoked directly, so the tests can import main and the helpers without fetching or emailing.
if (import.meta.url === `file://${process.argv[1]}`) {
  main()
    .then(({ code }) => process.exit(code))
    .catch((err) => { console.error('kv-usage-report: crashed: ' + (err?.message || err)); process.exit(1); });
}
