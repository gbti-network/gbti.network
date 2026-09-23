// sow-388: the full-screen digest invitation. The decision (src/lib/digest-invite-core.mjs) is tested directly; the
// wiring in the .astro files, which a unit test cannot import, is pinned by reading their source.
//
// The owner's rules, 2026-09-23: once per visit, one minute in; not again for 24 hours; never for a signed-in
// reader; never on the sales and account pages; never again once subscribed; after two dismissals, 90 days.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  INVITE_DELAY_MS, INVITE_QUIET_MS, INVITE_LONG_QUIET_MS, INVITE_DISMISS_LIMIT, INVITE_PAGE_FLOOR_MS,
  INVITE_VISIT_KEY, INVITE_STATE_KEY, INVITE_QUIET_PATHS,
  readInviteState, serializeInviteState, readInviteVisit, serializeInviteVisit, inviteDelayRemaining,
  isQuietPath, carriesCoupon, inviteBlocker, shouldOpenInvite, afterInvite,
} from '../src/lib/digest-invite-core.mjs';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const NOW = Date.parse('2026-09-23T15:00:00Z');

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const INVITE = src('src/components/mail/DigestInvite.astro');
const SUBSCRIBE = src('src/components/mail/DigestSubscribe.astro');
const LAYOUT = src('src/layouts/BaseLayout.astro');

/** A signed-out reader on an ordinary page, never invited before: the one context in which it opens. */
const base = (over = {}) => ({
  state: readInviteState(null),
  visit: readInviteVisit(null, NOW),
  signedIn: false,
  path: '/articles/some-post/',
  search: '',
  now: NOW,
  ...over,
});

test('the numbers are the owner\'s: one minute, 24 hours, two dismissals, 90 days', () => {
  assert.equal(INVITE_DELAY_MS, 60 * 1000);
  assert.equal(INVITE_QUIET_MS, DAY);
  assert.equal(INVITE_DISMISS_LIMIT, 2);
  assert.equal(INVITE_LONG_QUIET_MS, 90 * DAY);
  assert.equal(INVITE_VISIT_KEY, 'gbti_digest_invite_visit');
  assert.equal(INVITE_STATE_KEY, 'gbti-digest-invite');
});

test('a signed-out reader on an ordinary page, never invited, is invited', () => {
  assert.equal(inviteBlocker(base()), '');
  assert.equal(shouldOpenInvite(base()), true);
});

test('each rule on its own keeps it closed, and names itself', () => {
  const cases = [
    ['signed-in', { signedIn: true }],
    ['subscribed', { state: { n: 0, until: 0, done: true } }],
    ['shown-this-visit', { visit: { start: NOW - 5 * 60 * 1000, shown: true } }],
    ['quiet-page', { path: '/membership/' }],
    ['coupon', { search: '?coupon=HUDSINVITE' }],
    ['quiet-window', { state: { n: 0, until: NOW + HOUR, done: false } }],
  ];
  for (const [reason, over] of cases) {
    assert.equal(inviteBlocker(base(over)), reason, reason);
    assert.equal(shouldOpenInvite(base(over)), false, reason);
  }
});

test('signed in wins over everything, even a reader who has never been invited on an ordinary page', () => {
  assert.equal(inviteBlocker(base({ signedIn: true, path: '/', state: readInviteState(null) })), 'signed-in');
});

test('the sales, sign-in and account pages stay quiet, with or without the slash and below them', () => {
  for (const p of INVITE_QUIET_PATHS) {
    assert.equal(isQuietPath(p), true, p);
    assert.equal(isQuietPath(p.slice(0, -1)), true, `${p} without its slash`);
    assert.equal(isQuietPath(`${p}deeper/`), true, `${p} and below`);
  }
  assert.equal(isQuietPath('/account/notifications/'), true);
  assert.equal(isQuietPath('/MEMBERSHIP/'), true, 'case');
  for (const p of ['/', '/articles/x/', '/feeds/', '/privacy/', '/membershipx/', '/news/item/1/', '', null]) {
    assert.equal(isQuietPath(p), false, String(p));
  }
  // The owner named the kinds of page; this is the list that answers it. Changing it is a decision, so it is pinned.
  assert.deepEqual([...INVITE_QUIET_PATHS], [
    '/membership/', '/member-invite/', '/curator-invite/', '/codeable-invite/', '/sponsorship/',
    '/login/', '/welcome/', '/account/', '/workbench/', '/admin/',
  ]);
});

test('an invitation link (a coupon in the address) keeps it closed on any page', () => {
  assert.equal(carriesCoupon('?coupon=X'), true);
  assert.equal(carriesCoupon('?a=1&coupon='), true);
  assert.equal(carriesCoupon('?coup=1'), false);
  assert.equal(carriesCoupon(''), false);
  assert.equal(carriesCoupon(undefined), false);
});

test('the quiet window: closed until the moment it ends, open from then', () => {
  const at = (until) => inviteBlocker(base({ state: { n: 0, until, done: false } }));
  assert.equal(at(NOW + 1), 'quiet-window');
  assert.equal(at(NOW), '');
  assert.equal(at(NOW - 1), '');
  assert.equal(at(NOW + INVITE_LONG_QUIET_MS), 'quiet-window', 'the longest window this code writes is honoured');
});

test('a quiet window longer than any this code writes is treated as corrupt, not as a year of silence', () => {
  assert.equal(inviteBlocker(base({ state: { n: 0, until: NOW + INVITE_LONG_QUIET_MS + DAY, done: false } })), '');
});

test('opening quiets it for 24 hours whatever the reader does next', () => {
  const s = afterInvite(readInviteState(null), 'shown', NOW);
  assert.deepEqual(s, { n: 0, until: NOW + DAY, done: false });
});

test('the first dismissal quiets it for 24 hours; the second for 90 days, and the count starts again', () => {
  const one = afterInvite(afterInvite(readInviteState(null), 'shown', NOW), 'dismissed', NOW);
  assert.deepEqual(one, { n: 1, until: NOW + DAY, done: false });
  const later = NOW + DAY + HOUR;
  const two = afterInvite(afterInvite(one, 'shown', later), 'dismissed', later);
  assert.deepEqual(two, { n: 0, until: later + 90 * DAY, done: false });
  const muchLater = later + 91 * DAY;
  const three = afterInvite(afterInvite(two, 'shown', muchLater), 'dismissed', muchLater);
  assert.deepEqual(three, { n: 1, until: muchLater + DAY, done: false }, 'after the 90 days the cycle begins again');
});

test('subscribing ends it on this browser, and nothing afterwards brings it back', () => {
  let s = afterInvite(readInviteState(null), 'subscribed', NOW);
  assert.equal(s.done, true);
  s = afterInvite(afterInvite(s, 'shown', NOW + 400 * DAY), 'dismissed', NOW + 400 * DAY);
  assert.equal(s.done, true);
  assert.equal(inviteBlocker(base({ state: s, now: NOW + 800 * DAY })), 'subscribed');
});

test('a reader over time: open, dismiss, a day of quiet, open, dismiss, 90 days of quiet', () => {
  let state = readInviteState(null);
  const step = (outcome, t) => { state = readInviteState(serializeInviteState(afterInvite(state, outcome, t))); };
  const opens = (t) => shouldOpenInvite(base({ state, now: t, visit: readInviteVisit(null, t) }));

  assert.equal(opens(NOW), true);
  step('shown', NOW); step('dismissed', NOW + 30 * 1000);
  assert.equal(opens(NOW + DAY - 1000), false, 'still inside the first 24 hours');
  const t2 = NOW + 30 * 1000 + DAY;
  assert.equal(opens(t2), true, 'a day after the dismissal');
  step('shown', t2); step('dismissed', t2 + 5000);
  assert.equal(opens(t2 + 5000 + 89 * DAY), false, 'second dismissal: 89 days later is still quiet');
  assert.equal(opens(t2 + 5000 + 90 * DAY), true, 'and 90 days later it may ask again');
});

test('stored state that cannot be read counts as never invited, never as subscribed', () => {
  for (const raw of [null, '', 'x', '[]', '42', '{"done":"true"}', '{"n":"1","until":"9"}', '{"until":-5}']) {
    const s = readInviteState(raw);
    assert.equal(s.done, false, raw);
    assert.equal(s.until, 0, raw);
    assert.equal(s.n, 0, raw);
  }
  assert.equal(readInviteState('{"n":7}').n, 0, 'a count past the limit is not trusted');
  assert.deepEqual(readInviteState(serializeInviteState({ n: 1, until: NOW, done: true })), { n: 1, until: NOW, done: true });
});

test('the visit record: a new visit starts now, an old one keeps its start, a future start is not trusted', () => {
  assert.deepEqual(readInviteVisit(null, NOW), { start: NOW, shown: false });
  assert.deepEqual(readInviteVisit('nonsense', NOW), { start: NOW, shown: false });
  const earlier = NOW - 45 * 1000;
  assert.deepEqual(readInviteVisit(serializeInviteVisit({ start: earlier, shown: false }), NOW), { start: earlier, shown: false });
  assert.deepEqual(readInviteVisit(serializeInviteVisit({ start: earlier, shown: true }), NOW), { start: earlier, shown: true });
  assert.equal(readInviteVisit(JSON.stringify({ t: NOW + DAY }), NOW).start, NOW);
});

test('the minute runs across pages, and no page opens it sooner than ten seconds after it loads', () => {
  assert.equal(INVITE_PAGE_FLOOR_MS, 10 * 1000);
  const visitAt = (secondsAgo) => ({ start: NOW - secondsAgo * 1000, shown: false });
  assert.equal(inviteDelayRemaining(visitAt(0), NOW), 60 * 1000, 'the first page waits the whole minute');
  assert.equal(inviteDelayRemaining(visitAt(35), NOW), 25 * 1000, 'a second page waits only what is left');
  assert.equal(inviteDelayRemaining(visitAt(55), NOW), 10 * 1000, 'five seconds left still waits ten');
  assert.equal(inviteDelayRemaining(visitAt(600), NOW), 10 * 1000, 'long past the minute still waits ten');
});

test('the layout renders the invitation on every ordinary page', () => {
  assert.match(LAYOUT, /\nimport DigestInvite from '\.\.\/components\/mail\/DigestInvite\.astro';\n/);
  assert.match(LAYOUT, /\n\s*\{!bare && <DigestInvite \/>\}\n/);
});

test('the invitation embeds the one subscribe form rather than a copy of it', () => {
  assert.match(INVITE, /<DigestSubscribe\s+variant="invite"[\s\S]*?turnstileOnDemand\s*\/>/);
  assert.doesNotMatch(INVITE, /<form\b/, 'no second form');
  assert.doesNotMatch(INVITE, /\/mail\/subscribe/, 'no second route to the Worker');
  // The dialog is labelled by the form's own heading, whose id the component derives from the variant.
  assert.match(INVITE, /<dialog class="dinv" data-digest-invite aria-labelledby="dsub-h-invite">/);
  assert.match(SUBSCRIBE, /id=\{`dsub-h-\$\{variant\}`\}/);
  assert.match(SUBSCRIBE, /variant\?: 'band' \| 'inline' \| 'rail' \| 'invite';/);
});

test('the decision in the page is the tested one, and it waits for a prerendered page to be shown', () => {
  assert.match(INVITE, /from '\.\.\/\.\.\/lib\/digest-invite-core\.mjs';/);
  assert.match(INVITE, /if \(!shouldOpenInvite\(context\(now\)\)\) return;/);
  assert.match(INVITE, /if \(!shouldOpenInvite\(context\(Date\.now\(\)\)\)\) return;/, 're-checked when the timer fires');
  assert.match(INVITE, /document\.addEventListener\('prerenderingchange', start, \{ once: true \}\);/);
  // It opens only once the "seen" record has stuck, so a browser that cannot store it is never asked on every page.
  assert.match(INVITE, /if \(!visit\(t\)\.shown \|\| state\(\)\.until <= t\) return;\n/);
});

test('the bot check in the invitation loads on demand, and the other boxes keep loading theirs at once', () => {
  assert.match(SUBSCRIBE, /class:list=\{\[\{ 'cf-turnstile': !turnstileOnDemand \}, 'dsub-ts'\]\}/);
  assert.match(SUBSCRIBE, /document\.addEventListener\('gbti:load-turnstile', function \(\) \{/);
  assert.match(INVITE, /document\.dispatchEvent\(new Event\('gbti:load-turnstile'\)\);/);
  // The immediate loader is still the default branch, unchanged in what it does.
  assert.match(SUBSCRIBE, /\) : \(\n  <script is:inline>\n    \/\/ Load Turnstile's api\.js exactly once per document\./);
});

test('a successful subscribe from any box tells the page, and the invitation listens', () => {
  const ok = SUBSCRIBE.indexOf("say(subscribeSuccessMessage(body), 'ok');");
  const evt = SUBSCRIBE.indexOf("new CustomEvent('gbti:digest-subscribed'");
  assert.ok(ok > 0 && evt > ok && evt - ok < 400, 'the event is sent in the success branch, right after the message');
  assert.match(INVITE, /document\.addEventListener\('gbti:digest-subscribed', \(e\) => \{\n\s*subscribed = true;\n\s*record\('subscribed'\);/);
});

test('the copy follows the writing rules: no dashes, no contractions', () => {
  const visible = INVITE.replace(/^---[\s\S]*?---/, '').replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, ' ');
  assert.match(visible, /God bless the internet/);
  assert.match(visible, /Not now/);
  assert.doesNotMatch(visible, /[–—]/);
  assert.doesNotMatch(visible, /\b\w+'(t|re|s|ll|ve|d)\b/i);
  const note = /note="([^"]+)"/.exec(INVITE)[1];
  assert.doesNotMatch(note, /[–—]|\b\w+'(t|re|s|ll|ve|d)\b/i);
});

test('the pitch is the owner\'s wording, and only the invitation carries it', () => {
  const pitch = /const PITCH = '([^']+)';/.exec(INVITE)?.[1];
  assert.equal(pitch, 'Member articles, projects, skills & prompts, curated shares sent weekly to your inbox.');
  assert.match(INVITE, /blurb=\{PITCH\}/);
  assert.doesNotMatch(pitch, /[–—]|\b\w+'(t|re|s|ll|ve|d)\b/i);
  // The shared blurb is untouched: the other boxes and the web edition still say what they said.
  assert.doesNotMatch(src('src/lib/digest-subscribe-copy.mjs'), /curated shares sent weekly/);
});
