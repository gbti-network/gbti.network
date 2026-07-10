// Credential health check (SOW secrets-ops): probe each live credential and EMAIL the owner via Resend when one
// is failing or near expiry, so a lapsed token never breaks the system silently. Runs weekly + on demand
// (.github/workflows/credential-health.yml). Also exits non-zero on any problem, so the Action goes red as a
// backup signal even if email is unconfigured.
//
// What it checks (only credentials available as Actions secrets can be live-probed):
//   - GitHub PAT (GITHUB_BOT_TOKEN): a cheap repo read. The response header
//     `github-authentication-token-expiration` reports the token's real expiry, so the date AUTO-TRACKS rotation.
//   - Stripe read key (STRIPE_SECRET_KEY): list one customer (no expiry; liveness only).
//   - Discord bot token (DISCORD_BOT_TOKEN): GET /users/@me (no expiry; liveness only).
//   - Cloudflare token (CF_API_TOKEN): /user/tokens/verify, must be active (no expiry; liveness only).
// REGATE_DISPATCH_TOKEN is Worker-only (not an Actions secret), so it is NOT probed here; its expiry is tracked
// in .data/ops/secrets-ops/README.md (it expires ~the same time as GH_BOT_TOKEN, so this alert is the reminder).
//
// Run: node scripts/check-credentials.mjs   (with the secrets in env). Pure helpers are exported for tests.

import { createResendClient } from '../clients/resend.mjs';

const REPO = process.env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
const WARN_DAYS = Number(process.env.CRED_WARN_DAYS || 30);

/** Whole days from now until an ISO/parseable date, or null if undated/unparseable. Pure. */
export function daysUntil(when, now = new Date()) {
  if (!when) return null;
  const t = Date.parse(when);
  if (Number.isNaN(t)) return null;
  return Math.floor((t - now.getTime()) / 86400000);
}

/**
 * Turn raw probe results into a problem list. Pure (no IO). A probe result is
 * { name, ok, status, expiresAt?, detail? }. A credential is a problem when it FAILED (ok=false) or its
 * expiry is within `warnDays`. Returns { problems: [{ name, kind, message }], healthy }.
 */
export function evaluate(results, { warnDays = 30, now = new Date() } = {}) {
  const problems = [];
  for (const r of results) {
    if (!r.ok) {
      problems.push({ name: r.name, kind: 'failed', message: `${r.name} FAILED its live check (status ${r.status ?? 'n/a'}${r.detail ? `, ${r.detail}` : ''}). The credential is invalid, revoked, or expired.` });
      continue;
    }
    const d = daysUntil(r.expiresAt, now);
    if (d !== null && d <= warnDays) {
      problems.push({ name: r.name, kind: d < 0 ? 'expired' : 'expiring', message: d < 0 ? `${r.name} EXPIRED ${-d} day(s) ago (${r.expiresAt}).` : `${r.name} expires in ${d} day(s) (${r.expiresAt}). Renew it before then.` });
    }
  }
  return { problems, healthy: problems.length === 0 };
}

/** Build the alert email body. Pure. */
export function buildEmail(problems, { now = new Date() } = {}) {
  const subject = `GBTI credential alert: ${problems.length} issue${problems.length === 1 ? '' : 's'} need attention`;
  const lines = [
    `The weekly GBTI credential health check found ${problems.length} issue(s) on ${now.toISOString().slice(0, 10)}:`,
    '',
    ...problems.map((p) => `  - [${p.kind.toUpperCase()}] ${p.message}`),
    '',
    'How to renew each credential: see .data/ops/secrets-ops/README.md in the repo (the expiry calendar + the',
    'per-secret "how to obtain" steps). For a GitHub PAT: mint a new fine-grained token (owner gbti-network,',
    'Contents+PR+Statuses for GH_BOT_TOKEN), then update the GitHub Actions secret / push to the Worker.',
    '',
    'This is an automated message from the credential-health GitHub Action.',
  ];
  return { subject, text: lines.join('\n') };
}

// ---- live probes (IO; fetch injected for tests) ----
async function probe(name, fn) {
  try { return { name, ...(await fn()) }; }
  catch (err) { return { name, ok: false, status: null, detail: String(err?.message || err) }; }
}

export async function runProbes({ env = process.env, fetch = globalThis.fetch } = {}) {
  const out = [];
  const ghTok = env.GITHUB_BOT_TOKEN || env.GH_BOT_TOKEN;
  if (ghTok) out.push(await probe('GH_BOT_TOKEN (GitHub)', async () => {
    const res = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${ghTok}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-credential-health' } });
    return { ok: res.ok, status: res.status, expiresAt: res.headers.get('github-authentication-token-expiration') || null };
  }));
  if (env.STRIPE_SECRET_KEY) out.push(await probe('STRIPE_SECRET_KEY (Stripe read)', async () => {
    const res = await fetch('https://api.stripe.com/v1/customers?limit=1', { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } });
    return { ok: res.ok, status: res.status };
  }));
  if (env.DISCORD_BOT_TOKEN) out.push(await probe('DISCORD_BOT_TOKEN (Discord bot)', async () => {
    const res = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` } });
    return { ok: res.ok, status: res.status };
  }));
  // SOW-088: LinkedIn org posting. The access token dies after ~60 days, silently breaking syndication,
  // so probe a cheap org read; a 401/403 means re-run the OAuth exchange (secrets-ops runbook).
  if (env.LINKEDIN_ACCESS_TOKEN && env.LINKEDIN_ORG_URN) out.push(await probe('LINKEDIN_ACCESS_TOKEN (LinkedIn org)', async () => {
    const orgId = String(env.LINKEDIN_ORG_URN).split(':').pop();
    const res = await fetch(`https://api.linkedin.com/rest/organizations/${orgId}`, {
      headers: { Authorization: `Bearer ${env.LINKEDIN_ACCESS_TOKEN}`, 'LinkedIn-Version': '202506', 'X-Restli-Protocol-Version': '2.0.0' },
    });
    return { ok: res.ok, status: res.status, detail: res.ok ? null : 'token expired/revoked? LinkedIn tokens last ~60 days; re-run the OAuth flow (secrets-ops)' };
  }));
  if (env.CF_API_TOKEN) out.push(await probe('CF_API_TOKEN (Cloudflare)', async () => {
    const res = await fetch('https://api.cloudflare.com/client/v4/user/tokens/verify', { headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` } });
    let body = null; try { body = await res.json(); } catch { /* */ }
    return { ok: res.ok && body?.result?.status === 'active', status: res.status, detail: body?.result?.status };
  }));
  return out;
}

async function main() {
  const env = process.env;
  const results = await runProbes({ env });
  if (!results.length) { console.error('No credential secrets present in env; nothing to check.'); process.exit(0); }
  const { problems, healthy } = evaluate(results, { warnDays: WARN_DAYS, now: new Date() });

  for (const r of results) console.log(`${r.ok ? 'OK  ' : 'FAIL'} ${r.name}${r.expiresAt ? `  (expires ${r.expiresAt})` : ''}`);
  if (healthy) { console.log(`\nAll ${results.length} credentials healthy (none failing, none within ${WARN_DAYS} days of expiry).`); process.exit(0); }

  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p.message}`);

  // Email the owner via Resend (best-effort; the non-zero exit is the backup signal).
  const to = env.ALERT_EMAIL;
  const from = env.RESEND_FROM || 'noreply@gbti.network';
  if (env.RESEND_API_KEY && to) {
    try {
      const { subject, text } = buildEmail(problems, { now: new Date() });
      await createResendClient({ apiKey: env.RESEND_API_KEY }).sendEmail({ from, to, subject, text });
      console.error(`\nAlert emailed to ${to}.`);
    } catch (err) { console.error(`\nResend email FAILED: ${err?.message || err} (the red Action is still your signal).`); }
  } else {
    console.error(`\nNo email sent (set RESEND_API_KEY + ALERT_EMAIL to enable). The red Action is your signal.`);
  }
  process.exit(1);
}

// Only run main when invoked directly (so tests can import the pure helpers without probing/emailing).
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('check-credentials crashed:', e?.message || e); process.exit(1); });
