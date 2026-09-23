// The day the digest goes out, as the deployed cron says it, against every sentence that tells a subscriber.
//
// WHY THIS EXISTS. The digest cron was written `0 12 * * 2` and commented "Tuesday" everywhere, and for a month
// every issue went out on a Monday. Cloudflare numbers cron weekdays from Sunday = 1, so `2` is Monday; the
// standard (Vixie) reading, where `2` is Tuesday, does not apply to Cloudflare Workers. The evidence is the issue
// ids, which are the UTC compile date: weekly-2026-09-07, -14 and -21 are all Mondays. Copy shipped on
// 2026-09-20 then promised subscribers "Tuesday mornings". Nothing compared the two, so nothing failed.
//
// The same day, the owner moved the send to TUESDAY, which under Cloudflare's numbering is `3`.
//
// This reads the cron from wrangler.toml (the file that is deployed), converts it with Cloudflare's numbering,
// and requires each subscriber-facing sentence to name that day and no other. Change either side alone and it
// goes red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveCronJob } from '../workers/signup/index.mjs';
import { renderConfirmationEmail } from '../membership/mail-transactional-render.mjs';
import { handleConfirm } from '../workers/signup/mail-subscribe.mjs';
import { optinKey, buildPendingOptIn } from '../membership/mail-optin.mjs';
import { renderIssue } from '../membership/mail-render.mjs';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Cloudflare cron: day-of-week is 1-7 with Sunday = 1, or SUN-SAT.
const CLOUDFLARE_DOW = Object.fromEntries([
  ...WEEKDAYS.map((d, i) => [String(i + 1), d]),
  ...WEEKDAYS.map((d) => [d.slice(0, 3).toUpperCase(), d]),
]);

function productionCrons() {
  const toml = fs.readFileSync(new URL('../workers/signup/wrangler.toml', import.meta.url), 'utf8');
  // The TABLE HEADER, at the start of a line: a comment higher up names the same table in prose.
  const block = /^\[env\.production\.triggers\]\s*$([\s\S]*?)(?=^\[)/m.exec(`${toml}\n[`)?.[1];
  assert.ok(block, 'wrangler.toml must carry an [env.production.triggers] table');
  const list = /^crons\s*=\s*\[([^\]]*)\]/m.exec(block)?.[1];
  assert.ok(list, 'the production triggers block must declare crons');
  return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

/** The one weekday the digest compile cron runs on, read with Cloudflare's numbering. */
function digestSendDay() {
  const digest = productionCrons().filter((c) => resolveCronJob(c)?.label === 'weekly digest compile');
  assert.ok(digest.length > 0, 'no production cron resolves to the weekly digest compile');
  const days = new Set(digest.map((c) => CLOUDFLARE_DOW[c.trim().split(/\s+/)[4]?.toUpperCase()]));
  assert.equal(days.size, 1, `the digest crons disagree on the day: ${digest.join(', ')}`);
  const [day] = days;
  assert.ok(WEEKDAYS.includes(day), `the digest cron day-of-week is not one Cloudflare accepts: ${digest.join(', ')}`);
  return day;
}

const namedDays = (text) => WEEKDAYS.filter((d) => new RegExp(`\\b${d}s?\\b`).test(text));

test('the digest cron reads as Tuesday under Cloudflare numbering', () => {
  // Pinned as well as derived: the owner set Tuesday on 2026-09-21. Moving the send day is a decision, and this
  // line is where it gets written down.
  assert.equal(digestSendDay(), 'Tuesday');
});

test('the confirmation email names the day the cron sends, and no other', () => {
  const day = digestSendDay();
  const msg = renderConfirmationEmail({ confirmUrl: 'https://signup.gbti.network/mail/confirm?h=x&t=y' });
  for (const [part, body] of [['html', msg.html], ['text', msg.text]]) {
    assert.deepEqual(namedDays(body), [day], `the confirmation email ${part} body must name ${day} only`);
  }
});

test('the page a reader lands on after confirming names the day the cron sends, and no other', async () => {
  const day = digestSendDay();
  const hash = 'b'.repeat(64);
  const nonce = 'daytestnonce_1';
  const store = new Map([[optinKey(hash), JSON.stringify(
    buildPendingOptIn({ hash, emailEnc: JSON.stringify({ v: 1, ct: 'x' }), nonce }, { now: () => Date.now() }),
  )]]);
  const kv = {
    get: async (k, type) => { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  };
  const url = `https://signup.gbti.network/mail/confirm?h=${hash}&t=${nonce}`;
  const res = await handleConfirm(new Request(url, { method: 'POST' }), {}, { kv, sendAdminAlert: async () => true });
  const html = await res.text();
  assert.match(html, /Thank you, and welcome/, 'the test must reach the full stop page, or it checks nothing');
  assert.deepEqual(namedDays(html), [day], `the full stop page must name ${day} only`);
});

test('the web edition footer names the day the cron sends, and no other', () => {
  const day = digestSendDay();
  const issue = { issueId: 'weekly-2026-09-21', generatedAt: Date.parse('2026-09-21T12:00:00Z'), layout: [] };
  const { html } = renderIssue(issue, { edition: 'web', siteUrl: 'https://gbti.network' });
  assert.ok(html.includes('This is the web edition'), 'the test must reach the web footer, or it checks nothing');
  const footer = html.slice(html.indexOf('This is the web edition'));
  assert.deepEqual(namedDays(footer.slice(0, 200)), [day]);
});

test('sow-388: the invitation\'s small print and its confirmation headline name the day the cron sends, and no other', async () => {
  const day = digestSendDay();
  const invite = fs.readFileSync(new URL('../src/components/mail/DigestInvite.astro', import.meta.url), 'utf8');
  const note = /note="([^"]+)"/.exec(invite)?.[1];
  assert.ok(note, 'the invitation passes its sentence to the form as `note`, or this checks nothing');
  assert.deepEqual(namedDays(note), [day]);
  const { inviteSuccessHeading } = await import('../src/lib/digest-subscribe-copy.mjs');
  assert.deepEqual(namedDays(inviteSuccessHeading({ direct: true })), [day]);
  assert.deepEqual(namedDays(inviteSuccessHeading({ direct: false })), [], 'no promise of a day before the address is confirmed');
});
