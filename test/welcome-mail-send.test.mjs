// sow-478: sending the new member's welcome (workers/signup/welcome-mail-send.mjs), the two keys that decide
// whether it goes out, and the sweep that covers a send nobody made.
//
// The property every test here guards: ONE welcome, to a member who actually just joined, and never a second.
// The failure that matters most is the quiet one in the other direction, a member who is owed a welcome and
// never gets it, which is the hole this whole SOW exists to close, so the sweep is tested as hard as the stamp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  sendWelcomeMail, markWelcomeOwed, readWelcomeStamp, sweepOwedWelcomes,
  welcomeOwedKey, welcomeStampKey, WELCOME_OWED_PREFIX, OWED_GRACE_MS, SENDING_STALE_MS,
} from '../workers/signup/welcome-mail-send.mjs';
import { isClaimReturn, signinLanding } from '../workers/signup/signin-landing.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SIGNUP = path.join(HERE, '..', 'workers', 'signup');
const NOW = new Date('2026-10-26T12:00:00.000Z');
const ID = '5551234';

function fakeKv(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    store,
    get: async (k, t) => (store.has(k) ? (t === 'json' ? JSON.parse(store.get(k)) : store.get(k)) : null),
    put: async (k, v) => { store.set(k, v); },
    delete: async (k) => { store.delete(k); },
    list: async ({ prefix = '' } = {}) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
  };
}

const ENV = { MAIL_FROM: 'GBTI <hello@example.test>' };
const outbox = () => { const sent = []; return { sent, sendEmail: async (m) => { sent.push(m); } }; };

test('a welcome goes out ONCE, and the two keys end where they should', async () => {
  const kv = fakeKv();
  const box = outbox();
  assert.ok(await markWelcomeOwed(kv, ID, { now: NOW }));
  assert.equal(kv.store.has(welcomeOwedKey(ID)), true);

  const first = await sendWelcomeMail(ENV, { githubId: ID, email: 'member@example.test' }, { kv, now: NOW, ...box });
  assert.deepEqual(first, { sent: true });
  assert.equal(box.sent.length, 1);
  assert.equal(box.sent[0].to, 'member@example.test');
  assert.equal(box.sent[0].from, 'GBTI <hello@example.test>');
  assert.ok(box.sent[0].text.length > 50 && box.sent[0].html.length > 50, 'text AND html reach the sender');
  assert.equal((await readWelcomeStamp(kv, ID)).state, 'sent');
  assert.equal(kv.store.has(welcomeOwedKey(ID)), false, 'the entitlement is spent');

  const second = await sendWelcomeMail(ENV, { githubId: ID, email: 'member@example.test' }, { kv, now: NOW, ...box });
  assert.equal(second.sent, false);
  assert.equal(box.sent.length, 1, 'still one email');
});

test('a sent stamp stops a second welcome even when the entitlement comes back', async () => {
  const kv = fakeKv();
  const box = outbox();
  await markWelcomeOwed(kv, ID, { now: NOW });
  await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  // Force the owed key back, as a replayed trigger or a stale sweep would.
  kv.store.set(welcomeOwedKey(ID), JSON.stringify({ at: NOW.toISOString() }));
  const again = await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  assert.deepEqual(again, { sent: false, reason: 'already' });
  assert.equal(box.sent.length, 1);
  // And markWelcomeOwed itself refuses to re-owe somebody already welcomed.
  assert.equal(await markWelcomeOwed(kv, ID, { now: NOW }), false);
});

test('removing the stamp check is what makes a second welcome possible', async () => {
  // The mutation that proves the test above is testing the stamp and not something adjacent: a sibling copy of
  // the sender with the suppression line deleted must send twice.
  const copy = path.join(SIGNUP, '__wms-mutant.mjs');
  try {
    const src = fs.readFileSync(path.join(SIGNUP, 'welcome-mail-send.mjs'), 'utf8');
    const line = '    if (stop) return { sent: false, reason: stop };';
    assert.ok(src.includes(line), 'the suppression line is where the mutation expects it');
    fs.writeFileSync(copy, src.replace(line, '    void stop;'));
    const mutant = await import('../workers/signup/__wms-mutant.mjs');
    const kv = fakeKv();
    const box = outbox();
    await markWelcomeOwed(kv, ID, { now: NOW });
    await mutant.sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
    kv.store.set(welcomeOwedKey(ID), JSON.stringify({ at: NOW.toISOString() }));
    await mutant.sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
    assert.equal(box.sent.length, 2, 'without the check the member is welcomed twice');
  } finally {
    if (fs.existsSync(copy)) fs.unlinkSync(copy);
  }
  assert.match(fs.readFileSync(path.join(SIGNUP, 'welcome-mail-send.mjs'), 'utf8'), /if \(stop\) return/);
});

test('nobody who was not owed a welcome is sent one', async () => {
  const kv = fakeKv();
  const box = outbox();
  const r = await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  assert.deepEqual(r, { sent: false, reason: 'not_owed' });
  assert.equal(box.sent.length, 0);
  assert.equal(await readWelcomeStamp(kv, ID), null, 'and no record is invented for them');
});

test('a crashed send stops suppressing, so the sweep can still deliver it', async () => {
  const kv = fakeKv({
    [welcomeOwedKey(ID)]: JSON.stringify({ at: new Date(NOW.getTime() - 2 * OWED_GRACE_MS).toISOString() }),
    [welcomeStampKey(ID)]: JSON.stringify({ state: 'sending', at: NOW.toISOString() }),
  });
  const box = outbox();
  const inFlight = await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  assert.deepEqual(inFlight, { sent: false, reason: 'in_flight' }, 'a concurrent trigger backs off');
  const later = new Date(NOW.getTime() + SENDING_STALE_MS + 1000);
  const r = await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: later, ...box });
  assert.deepEqual(r, { sent: true });
  assert.equal(box.sent.length, 1);
});

test('unprovisioned is a no-op and KEEPS the entitlement, so nothing is lost', async () => {
  const kv = fakeKv();
  await markWelcomeOwed(kv, ID, { now: NOW });
  const r = await sendWelcomeMail({}, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW });
  assert.deepEqual(r, { sent: false, reason: 'unconfigured' });
  assert.equal(kv.store.has(welcomeOwedKey(ID)), true, 'still owed when the mail path is configured');
  assert.equal(await readWelcomeStamp(kv, ID), null);
});

test('with no address in hand it reads the member\'s Stripe customer, and sends nothing without one', async () => {
  const kv = fakeKv();
  const box = outbox();
  await markWelcomeOwed(kv, ID, { now: NOW });
  const stripe = { searchCustomerByGithubId: async () => ({ email: 'billing@example.test' }) };
  const r = await sendWelcomeMail(ENV, { githubId: ID }, { kv, now: NOW, stripe, ...box });
  assert.deepEqual(r, { sent: true });
  assert.equal(box.sent[0].to, 'billing@example.test');

  const kv2 = fakeKv();
  await markWelcomeOwed(kv2, '7', { now: NOW });
  const none = await sendWelcomeMail(ENV, { githubId: '7' }, {
    kv: kv2, now: NOW, stripe: { searchCustomerByGithubId: async () => null }, ...outbox(),
  });
  assert.deepEqual(none, { sent: false, reason: 'no_address' });
  assert.equal(kv2.store.has(welcomeOwedKey('7')), true, 'an unreachable member stays owed');
});

test('a claimer reads as paid from their coupon grant alone, with no status passed in', async () => {
  const kv = fakeKv({
    [`coupon-grant:${ID}`]: JSON.stringify({ until: new Date(NOW.getTime() + 86400e3 * 365).toISOString() }),
  });
  const box = outbox();
  await markWelcomeOwed(kv, ID, { viaClaim: true, now: NOW });
  await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  assert.match(box.sent[0].html, /Join the Discord/, 'the free year opens the community');
  assert.match(box.sent[0].html, /Add your social handles/, 'and publishing, so the handles step is theirs');
  assert.equal((await readWelcomeStamp(kv, ID)).viaClaim, true, 'and the record says where it came from');
});

test('a plain new sign-in reads as free, and is never shown a door it cannot open', async () => {
  const kv = fakeKv();
  const box = outbox();
  await markWelcomeOwed(kv, ID, { now: NOW });
  await sendWelcomeMail(ENV, { githubId: ID, email: 'm@example.test' }, { kv, now: NOW, ...box });
  assert.doesNotMatch(box.sent[0].html, /Join the Discord/);
  assert.match(box.sent[0].html, /come with a paid membership/);
});

test('a claimer\'s receipt names the item and links to the page it published to', async () => {
  const kv = fakeKv();
  const box = outbox();
  await markWelcomeOwed(kv, ID, { viaClaim: true, now: NOW });
  await sendWelcomeMail(ENV, {
    githubId: ID, email: 'm@example.test', name: 'Sean', status: 'paid',
    item: { type: 'prompt', title: 'Pedro Monkey Puppet Portrait', slug: 'pedro-monkey-puppet-portrait', folder: 'sbalger75', image: './images/result.jpg', creditTo: 'atwellpub' },
  }, { kv, now: NOW, ...box });
  assert.equal(box.sent[0].subject, 'Your prompt is live on GBTI Network \u2022 COMPLETE ONBOARDING INSIDE');
  assert.match(box.sent[0].html, /https:\/\/gbti\.network\/prompts\/pedro-monkey-puppet-portrait\//);
  assert.doesNotMatch(box.sent[0].html, /\/projects\/pedro-monkey-puppet-portrait/, 'a prompt is not addressed as a project');
});

test('the sweep leaves a fresh entitlement alone and delivers a stale one', async () => {
  const fresh = new Date(NOW.getTime() - 60e3).toISOString();
  const stale = new Date(NOW.getTime() - OWED_GRACE_MS - 60e3).toISOString();
  const kv = fakeKv({
    [welcomeOwedKey('111')]: JSON.stringify({ at: fresh, viaClaim: true }),
    [welcomeOwedKey('222')]: JSON.stringify({ at: stale, viaClaim: true }),
    [welcomeOwedKey('333')]: JSON.stringify({ at: 'not a date' }),
  });
  const seen = [];
  const r = await sweepOwedWelcomes({}, { kv, now: NOW, send: async (_e, rec) => { seen.push(rec.githubId); return { sent: true }; } });
  assert.deepEqual(seen, ['222'], 'only the one past its grace, and never the undated one');
  assert.equal(r.owed, 3);
  assert.equal(r.due, 1);
  assert.equal(r.sent, 1);
});

test('the sweep is bounded, and an unreadable store is reported rather than guessed at', async () => {
  const seed = {};
  for (let i = 0; i < 25; i++) seed[welcomeOwedKey(String(1000 + i))] = JSON.stringify({ at: new Date(NOW.getTime() - 2 * OWED_GRACE_MS).toISOString() });
  const kv = fakeKv(seed);
  const r = await sweepOwedWelcomes({}, { kv, now: NOW, send: async () => ({ sent: true }) });
  assert.equal(r.sent, 10, 'a backlog drains over ticks instead of in one');

  const broken = { list: async () => { throw new Error('kv down'); } };
  assert.deepEqual(await sweepOwedWelcomes({}, { kv: broken, now: NOW }), { ran: true, unavailable: true });
  assert.deepEqual(await sweepOwedWelcomes({}, { kv: null }), { ran: true, unavailable: true });
});

test('an empty store costs one list and nothing else', async () => {
  let lists = 0;
  let gets = 0;
  const kv = { list: async () => { lists += 1; return { keys: [] }; }, get: async () => { gets += 1; return null; } };
  const r = await sweepOwedWelcomes({}, { kv, now: NOW });
  assert.deepEqual(r, { ran: true, owed: 0, due: 0, sent: 0, errors: 0 });
  assert.equal(lists, 1);
  assert.equal(gets, 0, 'the common tick reads nothing');
});

test('the sign-in trigger and the landing decide a claim return with the SAME rule', () => {
  const claim = '/claim/?code=HDSNVTECRP3KNN655';
  assert.equal(isClaimReturn(claim), true);
  assert.equal(signinLanding({ created: true, returnTo: claim }), `${claim}&welcome=1`);
  for (const other of ['/account/', '/welcome/', '/claim/', '/claim/?code=lowercase', '', null, undefined]) {
    assert.equal(isClaimReturn(other), false, `${JSON.stringify(other)} is not a claim return`);
  }
});

test('a malformed id is refused rather than keyed on', async () => {
  const kv = fakeKv();
  for (const bad of ['', 'abc', '../x', '1'.repeat(30), null, undefined]) {
    assert.equal(await markWelcomeOwed(kv, bad, { now: NOW }), false);
    assert.equal(await readWelcomeStamp(kv, bad), null);
    const r = await sendWelcomeMail(ENV, { githubId: bad }, { kv, now: NOW, ...outbox() });
    assert.equal(r.sent, false);
  }
  assert.equal(kv.store.size, 0, 'and nothing was written under a key of that shape');
});

test('a failed send says so out loud, and says nothing about the person', async () => {
  const kv = fakeKv();
  await markWelcomeOwed(kv, ID, { now: NOW });
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...a) => warned.push(a.join(' '));
  try {
    const r = await sendWelcomeMail(ENV, { githubId: ID, email: 'secret@example.test', name: 'Sean' }, {
      kv, now: NOW, sendEmail: async () => { throw new Error('resend said no to secret@example.test'); },
    });
    assert.deepEqual(r, { sent: false, reason: 'error' });
  } finally {
    console.warn = realWarn;
  }
  assert.equal(warned.length, 1);
  assert.doesNotMatch(warned[0], /secret@example\.test|Sean|5551234|resend said no/);
  assert.equal(kv.store.has(welcomeOwedKey(ID)), true, 'still owed, so the sweep retries');
});

test('the sign-in leg owes a welcome ONLY to a new account, and defers a claim sign-in', () => {
  // The other half of the wiring. Everything else here is testable by calling a function; whether anybody is ever
  // OWED a welcome is decided by one guarded block in the OAuth callback, and a sender nothing calls welcomes
  // nobody. Bounded read with a control that the slice was found.
  const src = fs.readFileSync(path.join(SIGNUP, 'signup-routes.mjs'), 'utf8');
  const start = src.indexOf('if (signup.created === true) {');
  assert.ok(start > -1, 'control: the new-account block is found');
  const block = src.slice(start, src.indexOf('const session = await signSession', start));
  assert.match(block, /markWelcomeOwed\(env\.SIGNUP_KV, githubId/, 'a new account is owed one');
  assert.match(block, /isClaimReturn\(safeReturnTo\(state\.returnTo\)\)/, 'through the same predicate that picks the landing');
  assert.match(block, /owed && !viaClaim/, 'and a claim sign-in waits for its item to be published');
  assert.match(block, /if \(ctx\?\.waitUntil\) ctx\.waitUntil\(welcome\)/, 'never delaying the redirect');
  assert.match(src, /import \{ markWelcomeOwed, sendWelcomeMail \} from '\.\/welcome-mail-send\.mjs'/);
  // And it is called in ONE place, inside that guard, so a returning member re-running signup is owed nothing.
  // (The import line also names it, which is why this counts calls rather than mentions.)
  assert.equal(src.split('markWelcomeOwed(').length - 1, 1, 'exactly one call site, and it is the one above');
});

test('the five-minute drain actually RUNS the sweep, fail-soft, and reports it', () => {
  // The sweep is the safety net, so the line that schedules it is the line worth pinning: a correct sweep that
  // nothing calls is the same outcome as no sweep. Read from the drain function itself, bounded, with a control
  // that the slice was found, in the shape test/shares-tab-load.test.mjs already uses for its own warm-up.
  const src = fs.readFileSync(path.join(SIGNUP, 'cron.mjs'), 'utf8');
  const start = src.indexOf('async function drainFiveMinute');
  const end = src.indexOf('const CRON_JOBS');
  assert.ok(start > -1 && end > start, 'control: the drain function is found and bounded');
  const drain = src.slice(start, end);
  assert.match(drain, /try \{ welcomeMail = await sweepOwedWelcomes\(env\); \} catch/, 'it runs, and a failure never suppresses the drain');
  assert.match(drain, /return \{[^}]*\bwelcomeMail\b[^}]*\}/, 'and says what it did');
  assert.match(src, /import \{ sweepOwedWelcomes \} from '\.\/welcome-mail-send\.mjs'/, 'from the real module');
});

test('the owed prefix is its own, so the sweep never walks every member\'s record', () => {
  assert.ok(!welcomeStampKey(ID).startsWith(WELCOME_OWED_PREFIX),
    'a permanent stamp must not be listed by the sweep: that set grows by one key per member for ever');
});
