// sow-191: the Shop Talk .ics writer. Pure, no network, no filesystem.
//
// The failures this file exists to catch are all SILENT ones. An .ics can be well-formed and still import at
// the wrong hour, or as a single occurrence instead of a series, and the member does not report a bug, they
// just arrive at the wrong time or stop getting reminders. So the assertions here are on the emitted bytes,
// not on whether a function returned something.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  escapeIcsText,
  foldIcsLine,
  normalizeShoptalk,
  timezoneLabel,
  displayWhen,
  displayTimeShort,
  buildShoptalkIcs,
  googleCalendarUrl,
  outlookCalendarUrl,
  providerCarriesRecurrence,
} from '../src/lib/shoptalk-core.mjs';

const BASE = {
  title: 'GBTI Shop Talk call',
  card_title: 'Shop Talk call',
  start_time: '11:00',
  duration_minutes: 120,
  timezone: 'America/Chicago',
  recurrence: 'FREQ=WEEKLY;BYDAY=SA',
  starts_on: '2026-07-25',
  card_description: 'Our weekly open call.',
  calendar_description: 'The GBTI Network weekly open call.',
  join_url: 'https://discord.gg/EXAMPLEJOIN',
  publish_join_url: false,
};

const STAMP = { uid: 'shoptalk@gbti.network', stamp: '20260101T000000Z' };
const build = (over = {}) => buildShoptalkIcs(normalizeShoptalk({ ...BASE, ...over }), STAMP);

test('escapeIcsText escapes the four RFC 5545 specials, backslash first', () => {
  assert.equal(escapeIcsText('a,b'), 'a\\,b');
  assert.equal(escapeIcsText('a;b'), 'a\\;b');
  assert.equal(escapeIcsText('a\nb'), 'a\\nb');
  assert.equal(escapeIcsText('a\r\nb'), 'a\\nb');
  // Backslash must be escaped BEFORE the others, or `\,` would become `\\,` and render as a stray backslash.
  assert.equal(escapeIcsText('a\\b'), 'a\\\\b');
  assert.equal(escapeIcsText('a\\,b'), 'a\\\\\\,b');
});

test('escapeIcsText never emits a raw newline, which would terminate the property', () => {
  const out = escapeIcsText('one\ntwo\r\nthree');
  assert.ok(!/[\r\n]/.test(out), `escaped text still contains a real line break: ${JSON.stringify(out)}`);
});

test('foldIcsLine folds past 75 octets and continues with one leading space', () => {
  const short = 'DESCRIPTION:hello';
  assert.equal(foldIcsLine(short), short, 'a short line must not be folded');

  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const folded = foldIcsLine(long);
  const parts = folded.split('\r\n');
  assert.ok(parts.length > 1, 'a 212-character line must fold');
  assert.ok(Buffer.from(parts[0], 'utf8').length <= 75, 'first segment exceeds 75 octets');
  for (const p of parts.slice(1)) {
    assert.equal(p[0], ' ', 'a continuation line must begin with a single space');
    assert.ok(Buffer.from(p, 'utf8').length <= 75, 'continuation segment exceeds 75 octets');
  }
  // Unfolding must reproduce the original exactly, or we corrupted the payload while formatting it.
  assert.equal(parts.map((p, i) => (i === 0 ? p : p.slice(1))).join(''), long);
});

test('foldIcsLine never splits a multi-byte character in half', () => {
  // 100 three-byte characters: a naive character-count fold would cut mid-sequence and emit invalid UTF-8.
  const long = 'DESCRIPTION:' + '中'.repeat(100);
  const folded = foldIcsLine(long);
  for (const p of folded.split('\r\n')) {
    assert.ok(!p.includes('�'), 'fold produced a replacement character, so a code point was cut in half');
  }
  assert.equal(
    folded.split('\r\n').map((p, i) => (i === 0 ? p : p.slice(1))).join(''),
    long,
    'unfolding a multi-byte line did not reproduce the original',
  );
});

test('the document uses CRLF everywhere, which several clients require to import at all', () => {
  const ics = build();
  const bare = ics.replace(/\r\n/g, '');
  assert.ok(!/[\r\n]/.test(bare), 'the document contains an LF that is not part of a CRLF pair');
  assert.ok(ics.endsWith('\r\n'), 'the document must end with CRLF');
});

test('DTSTART and DTEND carry the TZID and the configured local times', () => {
  const ics = build();
  assert.match(ics, /^DTSTART;TZID=America\/Chicago:20260725T110000$/m);
  // 11:00 plus 120 minutes is 13:00, not 12:00 and not 13:00 UTC.
  assert.match(ics, /^DTEND;TZID=America\/Chicago:20260725T130000$/m);
});

test('the RRULE is the configured recurrence, so the event imports as a SERIES not one occurrence', () => {
  const ics = build();
  const eventBlock = ics.slice(ics.indexOf('BEGIN:VEVENT'));
  assert.match(eventBlock, /^RRULE:FREQ=WEEKLY;BYDAY=SA$/m);
});

test('a VTIMEZONE is emitted, so the client resolves DST rather than us guessing', () => {
  const ics = build();
  assert.match(ics, /BEGIN:VTIMEZONE[\s\S]*TZID:America\/Chicago[\s\S]*END:VTIMEZONE/);
  assert.match(ics, /TZNAME:CDT/);
  assert.match(ics, /TZNAME:CST/);
});

test('FAIL-CLOSED: the join URL is absent by default and present only when explicitly enabled', () => {
  // Both directions. Asserting only the absence would pass if the field were never emitted at all, which
  // would make the guard vacuous rather than protective.
  const off = build({ publish_join_url: false });
  assert.ok(!off.includes('EXAMPLEJOIN'), 'the join URL leaked into the published file while publishing is off');
  assert.ok(!/^URL:/m.test(off), 'a URL property was emitted while publishing is off');
  assert.ok(!/^LOCATION:/m.test(off), 'a LOCATION property was emitted while publishing is off');

  const on = build({ publish_join_url: true });
  assert.ok(on.includes('EXAMPLEJOIN'), 'the join URL is missing even though publishing is ON, so the off-case proves nothing');
  assert.match(on, /^URL:https:\/\/discord\.gg\/EXAMPLEJOIN$/m);
});

test('FAIL-CLOSED: only a real boolean true publishes; truthy lookalikes do not', () => {
  for (const sneaky of ['true', 'yes', 1, {}, [], 'TRUE']) {
    const ics = build({ publish_join_url: sneaky });
    assert.ok(
      !ics.includes('EXAMPLEJOIN'),
      `publish_join_url=${JSON.stringify(sneaky)} published the join URL; only boolean true may`,
    );
  }
});

test('the timezone label is derived and is never the season-wrong literal CST', () => {
  assert.equal(timezoneLabel('America/Chicago'), 'Central Time');
  const ev = normalizeShoptalk(BASE);
  assert.equal(displayWhen(ev), 'Saturdays \u00b7 11:00 AM Central Time');
  assert.equal(displayTimeShort(ev), 'Sat \u00b7 11:00 AM CT');
  // The specific regression: America/Chicago is CDT for about eight months, so a hardcoded CST misleads a
  // member converting from another zone into arriving an hour early.
  assert.ok(!displayWhen(ev).includes('CST'), 'the display line hardcodes CST, which is wrong March to November');
  assert.ok(!displayTimeShort(ev).includes('CST'), 'the short time chip hardcodes CST');
});

test('normalizeShoptalk rejects a malformed edit rather than shipping a broken event', () => {
  assert.throws(() => normalizeShoptalk({ ...BASE, start_time: '11am' }), /start_time must be 24-hour/);
  assert.throws(() => normalizeShoptalk({ ...BASE, start_time: '25:00' }), /start_time must be 24-hour/);
  assert.throws(() => normalizeShoptalk({ ...BASE, starts_on: '07-25-2026' }), /starts_on must be/);
  assert.throws(() => normalizeShoptalk({ ...BASE, duration_minutes: 0 }), /duration_minutes must be a positive/);
  assert.throws(() => normalizeShoptalk({ ...BASE, duration_minutes: 1.5 }), /duration_minutes must be a positive/);
  assert.throws(() => normalizeShoptalk({ ...BASE, title: '   ' }), /"title" is required/);
  assert.throws(() => normalizeShoptalk({ ...BASE, recurrence: 'RRULE:FREQ=WEEKLY' }), /must omit the "RRULE:" prefix/);
  assert.throws(() => normalizeShoptalk({ ...BASE, timezone: 'Mars/Olympus' }), /has no VTIMEZONE rules/);
});

test('an event running past midnight is refused, not silently emitted with a wrong DTEND', () => {
  assert.throws(() => build({ start_time: '23:00', duration_minutes: 120 }), /runs past midnight/);
});

test('the REAL house/shoptalk.yml is valid and its published form leaks no join URL', () => {
  // A corpus check against the live config, so an edit to the YAML that breaks the build is caught here
  // rather than at deploy time. Uses a temp-free read: the file is input, never written by the code under test.
  const file = path.resolve(process.cwd(), 'house', 'shoptalk.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8'));
  const ev = normalizeShoptalk(parsed?.shoptalk);
  const ics = buildShoptalkIcs(ev, STAMP);

  assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
  assert.match(ics, /^RRULE:FREQ=WEEKLY;BYDAY=SA$/m);
  assert.equal(ev.publishJoinUrl, false, 'the shipped config must keep publish_join_url false unless deliberately flipped');
  assert.ok(!/^URL:/m.test(ics), 'the shipped config publishes a URL property');
});

// ---------------------------------------------------------------------------------------------------------
// sow-302: provider deep links, so a member adds the call from the browser instead of downloading a file.
// These read the SAME normalized event as the .ics, and the agreement test below is the point: a chooser
// whose Google link disagrees with the file beside it is worse than either alone.
// ---------------------------------------------------------------------------------------------------------

test('sow-302 google: carries the RRULE, the IANA zone, and the local range', () => {
  const url = new URL(googleCalendarUrl(normalizeShoptalk(BASE)));
  const q = url.searchParams;
  assert.equal(url.origin + url.pathname, 'https://calendar.google.com/calendar/render');
  assert.equal(q.get('action'), 'TEMPLATE');
  assert.equal(q.get('text'), 'GBTI Shop Talk call');
  // The SERIES, not one occurrence. Without recur, the member gets a single Saturday and never notices.
  assert.equal(q.get('recur'), 'RRULE:FREQ=WEEKLY;BYDAY=SA');
  // An IANA zone, never a fixed offset: Google resolves DST from it.
  assert.equal(q.get('ctz'), 'America/Chicago');
  assert.equal(q.get('dates'), '20260725T110000/20260725T130000');
});

test('sow-302 google and the .ics AGREE on time and recurrence', () => {
  // The anti-drift assertion. Both are built from one normalized event, and this is what proves it stayed
  // that way. A second hardcoded time in a URL builder is the defect this whole design exists to prevent.
  const ev = normalizeShoptalk(BASE);
  const q = new URL(googleCalendarUrl(ev)).searchParams;
  const ics = buildShoptalkIcs(ev, STAMP);
  const [gStart, gEnd] = q.get('dates').split('/');
  assert.ok(ics.includes(`DTSTART;TZID=America/Chicago:${gStart}`), 'google start disagrees with the .ics DTSTART');
  assert.ok(ics.includes(`DTEND;TZID=America/Chicago:${gEnd}`), 'google end disagrees with the .ics DTEND');
  assert.ok(ics.includes(`RRULE:${q.get('recur').replace('RRULE:', '')}`), 'google recurrence disagrees with the .ics');
});

test('sow-302 outlook: absolute times with the RIGHT offset, and NO recurrence', () => {
  const q = new URL(outlookCalendarUrl(normalizeShoptalk(BASE))).searchParams;
  assert.equal(q.get('rru'), 'addevent');
  assert.equal(q.get('startdt'), '2026-07-25T11:00:00-05:00'); // July: CDT
  assert.equal(q.get('enddt'), '2026-07-25T13:00:00-05:00');
  // Outlook's compose deep link HAS no recurrence parameter. Asserting its absence pins a real limitation so
  // nobody "fixes" it by inventing a parameter, and so the chooser UI keeps saying so next to the row.
  assert.equal(q.get('recur'), null);
  assert.equal(providerCarriesRecurrence('outlook'), false);
  assert.equal(providerCarriesRecurrence('google'), true);
  assert.equal(providerCarriesRecurrence('ics'), true);
});

test('sow-302 outlook: the offset comes from real tzdata, including BOTH transition boundaries', () => {
  // The first implementation guessed DST as `month > 3 && month < 11`, which is wrong for 1 to 8 March and
  // 1 to 7 November and reads as correct all summer. These four dates are the ones that catch it, verified
  // against the system zone database.
  const at = (starts_on) => new URL(outlookCalendarUrl(normalizeShoptalk({ ...BASE, starts_on })))
    .searchParams.get('startdt').slice(-6);
  assert.equal(at('2026-07-25'), '-05:00', 'mid-summer should be CDT');
  assert.equal(at('2026-01-10'), '-06:00', 'mid-winter should be CST');
  assert.equal(at('2026-03-01'), '-06:00', '1 March is BEFORE the second Sunday, so still CST');
  // 2026-11-01 IS the first Sunday, and the switch happens at 02:00, so an 11:00 event is already CST.
  assert.equal(at('2026-11-01'), '-06:00', '1 November 2026 is the transition Sunday; 11:00 is after it');
  assert.equal(at('2026-10-25'), '-05:00', 'a week earlier is still CDT');
  // THE ONE THAT ACTUALLY DISCRIMINATES, and the first version of this test did not have it. Every date
  // above happens to agree with the naive `month > 3 && month < 11` guess, so the test named the bug and
  // could not detect it. Mid-to-late March is the only window where the two answers differ: the naive rule
  // says CST because the month is 3, and the real zone says CDT because the second Sunday has passed.
  // Verified against the system zone database: TZ=America/Chicago date -d '2026-03-20 11:00' reports CDT.
  assert.equal(at('2026-03-20'), '-05:00', '20 March is AFTER the second Sunday, so CDT; this is the case the naive guess gets wrong');
});

test('sow-302: the join URL stays fail-closed in provider links too', () => {
  // The .ics guard would be pointless if a provider link leaked the same URL by another route.
  const off = googleCalendarUrl(normalizeShoptalk({ ...BASE, publish_join_url: false }));
  assert.ok(!off.includes('EXAMPLEJOIN'), 'the google link leaked the join URL while publishing is off');
  assert.ok(!outlookCalendarUrl(normalizeShoptalk({ ...BASE, publish_join_url: false })).includes('EXAMPLEJOIN'));
  const on = googleCalendarUrl(normalizeShoptalk({ ...BASE, publish_join_url: true }));
  assert.ok(on.includes('EXAMPLEJOIN'), 'publishing ON must include it, or the off-case proves nothing');
});
