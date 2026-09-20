// sow-266 Phase 4: the sponsorship inquiry form, its route, and the superadmin read of what came in.
//
// THE THING THAT MUST NOT HAPPEN is a person filling in the form, being thanked, and the inquiry going nowhere.
// So the route has TWO outputs (a stored record and an email to the owner) and it reports failure only when
// BOTH fell over. Most of what is below is that rule from each side, because the ordinary way to write this
// route is to await the send and let a Resend outage turn a received inquiry into a 500.
//
// THE SECOND THING is a raw address in the store. The record is asserted to hold none, in both the configured
// and the unconfigured branch, the same guard the subscriber and queue records carry.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  inquiryProblems, buildInquiry, inquiryKey, inquiryNotice, isEmailShape, isWebsiteShape,
  INQUIRY_LIMITS, INQUIRY_TTL_SECONDS, INQUIRY_PREFIX,
} from '../membership/sponsor-inquiry.mjs';
import { handleSponsorInquiry, listSponsorInquiries } from '../workers/signup/sponsor-inquiry.mjs';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => fs.readFileSync(at(rel), 'utf8');

const GOOD = {
  name: 'Ada Lovelace', email: 'ada@example.com', organization: 'Analytical Engines',
  website: 'https://example.com', message: 'We would like to sponsor the weekly email for a quarter.',
};

/** A KV double that records what was written and can be made to throw. */
function fakeKv({ failPut = false, failList = false, seed = {} } = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    puts: [],
    async put(key, value, opts) { if (failPut) throw new Error('kv down'); this.puts.push({ key, value, opts }); store.set(key, value); },
    async get(key, type) { const v = store.get(key); if (v == null) return null; return type === 'json' || type?.type === 'json' ? JSON.parse(v) : v; },
    async list({ prefix, limit } = {}) {
      if (failList) throw new Error('kv down');
      return { keys: [...store.keys()].filter((k) => k.startsWith(prefix || '')).slice(0, limit || 1000).map((name) => ({ name })) };
    },
  };
}

const post = (body, headers = {}) => new Request('https://x/sponsorship/inquiry', {
  method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
});

const deps = (over = {}) => ({
  rateLimitFn: async () => ({ allowed: true }),
  verifyTurnstileFn: async () => true,
  newId: () => 'aaaaaaaabbbbbbbbcccccccc',
  now: () => Date.parse('2026-09-19T12:00:00Z'),
  ...over,
});

// ---- the pure core -------------------------------------------------------------------------------------

test('every problem is reported at once, not one per submit', () => {
  const problems = inquiryProblems({ name: '', email: 'nope', website: 'ftp://x', message: '' });
  assert.equal(problems.length, 4, problems.join(' | '));
  // A form that reveals its objections one at a time is how somebody gives up on the third try.
  assert.ok(problems.some((p) => p.includes('name')));
  assert.ok(problems.some((p) => p.includes('email')));
  assert.ok(problems.some((p) => p.includes('website')));
  assert.ok(problems.some((p) => p.includes('sponsor')));
});

test('a complete inquiry has no problems, and an optional field may be empty', () => {
  assert.deepEqual(inquiryProblems(GOOD), []);
  assert.deepEqual(inquiryProblems({ ...GOOD, organization: '', website: '' }), []);
});

test('the address shape is checked the way the subscribe route checks it', () => {
  for (const ok of ['a@b.co', 'first.last+tag@sub.example.com']) assert.equal(isEmailShape(ok), true, ok);
  for (const bad of ['', 'a@b', '@b.co', 'a@@b.co', 'a b@c.co', 'a@b..co', 'a@.co', 'a@b.co.']) {
    assert.equal(isEmailShape(bad), false, bad);
  }
});

test('a website must be a real address, and is optional', () => {
  assert.equal(isWebsiteShape(''), true);
  assert.equal(isWebsiteShape('https://a.example/x'), true);
  assert.equal(isWebsiteShape('http://a.example'), true);
  for (const bad of ['javascript:alert(1)', 'a.example', 'https://nodot', 'ftp://a.example']) {
    assert.equal(isWebsiteShape(bad), false, bad);
  }
});

test('THE RECORD HOLDS NO ADDRESS, in either branch', () => {
  const withKeys = buildInquiry({ ...GOOD, id: 'x'.repeat(12), emailHash: 'a'.repeat(64), emailEnvelope: { v: 1, ct: 'opaque' } });
  assert.ok(!JSON.stringify(withKeys).includes('@'), 'no raw address may appear in a stored inquiry');
  const withoutKeys = buildInquiry({ ...GOOD, id: 'x'.repeat(12) });
  assert.ok(!JSON.stringify(withoutKeys).includes('@'), 'the unconfigured branch must not store one either');
  // The domain IS kept, deliberately: it tells a real company from a throwaway without holding an address.
  assert.equal(withKeys.emailDomain, 'example.com');
  assert.equal(withKeys.emailEnvelope.ct, 'opaque');
  assert.equal(withoutKeys.emailEnvelope, null);
});

test('a key is only built from an id that could be one', () => {
  assert.equal(inquiryKey('abcd1234abcd'), `${INQUIRY_PREFIX}abcd1234abcd`);
  for (const bad of ['', 'short', '../escape', 'UPPER1234567', 'x'.repeat(65)]) {
    assert.equal(inquiryKey(bad), '', JSON.stringify(bad));
  }
});

test('fields are bounded and a message keeps its paragraphs', () => {
  const r = buildInquiry({ ...GOOD, id: 'abcd1234abcd', name: 'x'.repeat(500), message: 'one\r\n\r\n\r\n\r\ntwo' });
  assert.equal(r.name.length, INQUIRY_LIMITS.name);
  assert.equal(r.message, 'one\n\ntwo', 'runs of blank lines collapse, one blank line survives');
});

test('the owner notice carries the address, because that mail is the primary channel', () => {
  const rec = buildInquiry({ ...GOOD, id: 'abcd1234abcd' });
  const n = inquiryNotice(rec, { email: 'ada@example.com' });
  assert.ok(n.text.includes('ada@example.com'));
  assert.ok(n.text.includes('Analytical Engines'));
  assert.ok(n.text.includes(GOOD.message));
  assert.ok(n.subject.includes('Ada Lovelace'));
});

// ---- the route -----------------------------------------------------------------------------------------

test('a good submission is stored with a TTL and emailed, and answers with a reference', async () => {
  const kv = fakeKv();
  const sent = [];
  const res = await handleSponsorInquiry(post(GOOD), {}, deps({ kv, sendEmail: async (m) => sent.push(m) }));
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.reference, 'aaaaaaaabbbbbbbbcccccccc');
  assert.equal(kv.puts.length, 1);
  assert.equal(kv.puts[0].key, `${INQUIRY_PREFIX}aaaaaaaabbbbbbbbcccccccc`);
  assert.equal(kv.puts[0].opts.expirationTtl, INQUIRY_TTL_SECONDS, 'without a TTL nothing prunes this store');
  assert.ok(!kv.puts[0].value.includes('@'), 'no raw address may reach the store');
});

test('the owner email carries a reply-to, so answering it answers the sponsor', async () => {
  const sent = [];
  await handleSponsorInquiry(post(GOOD), { ADMIN_ALERT_EMAIL: 'owner@gbti.network', MAIL_FROM: 'digest@gbti.network' },
    deps({ kv: fakeKv(), sendEmail: async (m) => sent.push(m) }));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].replyTo, 'ada@example.com');
  assert.equal(sent[0].to, 'owner@gbti.network');
});

test('A FAILED EMAIL STILL SUCCEEDS, because the record has it', async () => {
  const kv = fakeKv();
  const res = await handleSponsorInquiry(post(GOOD), { ADMIN_ALERT_EMAIL: 'o@x.co', MAIL_FROM: 'd@x.co' },
    deps({ kv, sendEmail: async () => { throw new Error('resend down'); } }));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
  assert.equal(kv.puts.length, 1);
});

test('A FAILED WRITE STILL SUCCEEDS, because the email has it', async () => {
  const sent = [];
  const res = await handleSponsorInquiry(post(GOOD), { ADMIN_ALERT_EMAIL: 'o@x.co', MAIL_FROM: 'd@x.co' },
    deps({ kv: fakeKv({ failPut: true }), sendEmail: async (m) => sent.push(m) }));
  assert.equal(res.status, 200);
  assert.equal(sent.length, 1);
});

test('BOTH failing is the one case that reports failure, rather than thanking somebody for nothing', async () => {
  const res = await handleSponsorInquiry(post(GOOD), {}, // no alert recipient configured, so no email either
    deps({ kv: fakeKv({ failPut: true }) }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).error, 'unavailable');
});

test('a bad submission names its problems and is never stored', async () => {
  const kv = fakeKv();
  const res = await handleSponsorInquiry(post({ ...GOOD, email: 'nope', message: '' }), {}, deps({ kv }));
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.error, 'invalid');
  assert.equal(body.problems.length, 2);
  assert.equal(kv.puts.length, 0);
});

test('the rate limit and the challenge each refuse, and the challenge is checked AFTER the shape', async () => {
  const limited = await handleSponsorInquiry(post(GOOD), {}, deps({ kv: fakeKv(), rateLimitFn: async () => ({ allowed: false }) }));
  assert.equal(limited.status, 429);

  let challengeCalls = 0;
  const failed = await handleSponsorInquiry(post(GOOD), { TURNSTILE_SECRET_KEY: 's' },
    deps({ kv: fakeKv(), verifyTurnstileFn: async () => { challengeCalls += 1; return false; } }));
  assert.equal(failed.status, 403);
  assert.equal(challengeCalls, 1);

  // A submission that is going to be refused for an empty message must not spend a round trip to Cloudflare.
  challengeCalls = 0;
  await handleSponsorInquiry(post({ ...GOOD, message: '' }), { TURNSTILE_SECRET_KEY: 's' },
    deps({ kv: fakeKv(), verifyTurnstileFn: async () => { challengeCalls += 1; return true; } }));
  assert.equal(challengeCalls, 0, 'the shape check comes first, so a broken form costs no challenge');
});

test('with no Turnstile secret the challenge is skipped, and the rate limit still holds', async () => {
  // Local and test runs have no secret. The route must still work, and must still be limited.
  const ok = await handleSponsorInquiry(post(GOOD), {}, deps({ kv: fakeKv(), verifyTurnstileFn: async () => false }));
  assert.equal(ok.status, 200);
});

test('a form post works as well as JSON, so the page works with scripting off', async () => {
  const form = new URLSearchParams(GOOD);
  const req = new Request('https://x/sponsorship/inquiry', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form.toString(),
  });
  const kv = fakeKv();
  const res = await handleSponsorInquiry(req, {}, deps({ kv }));
  assert.equal(res.status, 200);
  assert.equal(kv.puts.length, 1);
});

test('anything but POST is refused, and a preflight is answered', async () => {
  const get = await handleSponsorInquiry(new Request('https://x/sponsorship/inquiry'), {}, deps({ kv: fakeKv() }));
  assert.equal(get.status, 405);
  const pre = await handleSponsorInquiry(new Request('https://x/sponsorship/inquiry', { method: 'OPTIONS' }), {}, deps({ kv: fakeKv() }));
  assert.equal(pre.status, 204);
});

// ---- the superadmin read -------------------------------------------------------------------------------

test('the read refuses anyone the gate refuses, and never touches the store', async () => {
  const kv = fakeKv();
  let listed = 0;
  kv.list = async () => { listed += 1; return { keys: [] }; };
  const r = await listSponsorInquiries(new Request('https://x/'), {}, {
    kv, authorize: async () => ({ ok: false, status: 403, body: { error: 'forbidden' } }),
  });
  assert.equal(r.status, 403);
  assert.equal(listed, 0, 'a refused caller must not cause a store read');
});

test('the read lists what came in, newest first, saying so when an address was never stored', async () => {
  const older = buildInquiry({ ...GOOD, id: 'a'.repeat(12), at: '2026-09-01T00:00:00Z' });
  const newer = buildInquiry({ ...GOOD, name: 'Grace', id: 'b'.repeat(12), at: '2026-09-18T00:00:00Z' });
  const kv = fakeKv({ seed: {
    [`${INQUIRY_PREFIX}${older.id}`]: JSON.stringify(older),
    [`${INQUIRY_PREFIX}${newer.id}`]: JSON.stringify(newer),
  } });
  const r = await listSponsorInquiries(new Request('https://x/'), {}, { kv, authorize: async () => ({ ok: true }) });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.inquiries.map((i) => i.name), ['Grace', 'Ada Lovelace']);
  // Neither envelope nor hash reaches the caller, and emailStored says plainly that there was nothing to read.
  for (const i of r.body.inquiries) {
    assert.equal(i.emailEnvelope, undefined);
    assert.equal(i.emailHash, undefined);
    assert.equal(i.emailStored, false);
    assert.equal(i.email, '');
  }
});

test('an unreadable store reports that rather than an empty list', async () => {
  // An empty list and a broken store look identical to a reader, and one of them means "go and fix something".
  const r = await listSponsorInquiries(new Request('https://x/'), {}, { kv: fakeKv({ failList: true }), authorize: async () => ({ ok: true }) });
  assert.equal(r.status, 503);
});

// ---- wiring --------------------------------------------------------------------------------------------

test('WIRING: both routes are registered and the read is superadmin', () => {
  const idx = read('../workers/signup/index.mjs');
  assert.match(idx, /pathname === '\/sponsorship\/inquiry'/);
  assert.match(idx, /'\/membership\/admin\/sponsor-inquiries': listSponsorInquiries/);
  assert.match(read('../workers/signup/sponsor-inquiry.mjs'), /authorize = authorizeSuperadmin/);
});

test('WIRING: the page posts to the route, is unindexed, and names no price', () => {
  const page = read('../src/pages/sponsorship/index.astro');
  assert.match(page, /noindex=\{true\}/);
  assert.match(page, /\/sponsorship\/inquiry/);
  assert.match(page, /cf-turnstile/);
  // There is one slot and the terms are set per conversation. A number typed here is a commitment nobody made.
  assert.doesNotMatch(page.replace(/maxlength="\d+"|rows="\d+"/g, ''), /\$\s?\d/, 'the page must not name a price');
});

test('WIRING: the inquiries are reachable from every host, and the manager shows them', () => {
  assert.match(read('../src/lib/workbench-client.ts'), /workerGet\('\/membership\/admin\/sponsor-inquiries'\)/);
  assert.match(read('../client-ui/src/client.mjs'), /sponsorInquiries: \(\) => request\('GET', '\/api\/sponsor-inquiries'\)/);
  assert.match(read('../client/src/api.mjs'), /'\/api\/sponsor-inquiries'/);
  assert.match(read('../extension/src/ext-dispatch.mjs'), /case '\/api\/sponsor-inquiries'/);
  assert.match(read('../client-ui/src/elements/gbti-digest-manager.mjs'), /sponsorInquiries\(\)/);
});

test('WIRING: neither public form can send twice, and the guard is on the HANDLER', () => {
  // Found by driving the built pages: after a success the `finally` block re-enabled the button, so a second
  // click sent a second inquiry, and the digest subscribe form shipped with the same line. Disabling every
  // control is NOT the same property, which the same drive proved: a submit event dispatched at a fully
  // disabled form still went through. The flag has to be read at the top of the listener.
  for (const [name, rel] of [['the sponsorship page', '../src/pages/sponsorship/index.astro'], ['the digest subscribe form', '../src/components/mail/DigestSubscribe.astro']]) {
    const src = read(rel);
    assert.match(src, /let done = false;/, `${name} has no one-send flag`);
    assert.match(src, /if \(done\) return;/, `${name} does not check the flag on the way into the handler`);
    assert.match(src, /done = true;/, `${name} never sets the flag`);
    assert.match(src, /if \(!done\) \{ btn\.disabled = false;/, `${name} re-enables its button unconditionally in finally`);
    // The flag must be declared OUTSIDE the listener. Inside it, it is a new variable on every submit and
    // guards nothing, which is exactly the shape this started as.
    const declared = src.indexOf('let done = false;');
    const listener = src.indexOf("addEventListener('submit'");
    assert.ok(declared > -1 && listener > -1 && declared < listener, `${name} declares its flag inside the listener, where it resets on every submit`);
  }
});
