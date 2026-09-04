// sow-314: the Google Calendar client.
//
// Every test here pins a property whose absence is SILENT. A missing sendUpdates flag adds the guest and
// mails nobody; a missing If-Match turns a concurrent write into a lost guest; a full-object PATCH reverts
// whatever the owner changed on their phone. None of those throw, none of them show up in a status code, and
// none of them would be noticed by a person watching the feature appear to work.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGoogleCalendarClient,
  GoogleCalendarError,
  GoogleCalendarConflict,
  normalizeAddress,
  sameAddress,
} from '../clients/google-calendar.mjs';

const TOKEN_OK = JSON.stringify({ access_token: 'at-1', expires_in: 3600 });

/** A fetch double that records every call and replies from a queue keyed by URL prefix. */
function fakeFetch(handlers) {
  const calls = [];
  const impl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    for (const [match, reply] of handlers) {
      if (String(url).includes(match)) return reply(String(url), init);
    }
    throw new Error(`unexpected fetch: ${url}`);
  };
  impl.calls = calls;
  return impl;
}

const ok = (bodyText, status = 200) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => bodyText,
});

function client(fetchImpl, extra = {}) {
  return createGoogleCalendarClient({
    clientId: 'cid', clientSecret: 'csec', refreshToken: 'rtok',
    calendarId: 'cal@group.calendar.google.com',
    fetch: fetchImpl,
    ...extra,
  });
}

test('an attendee write carries sendUpdates=all, or the guest is added and nobody is told', () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok(JSON.stringify({ id: 'ev1' }))],
  ]);
  return client(f).setAttendees('ev1', ['a@example.com']).then(() => {
    const write = f.calls.find((c) => c.init.method === 'PATCH');
    assert.ok(write, 'the write must have happened at all');
    assert.match(write.url, /sendUpdates=all/,
      'without this Google records the attendee and sends no invitation');
  });
});

test('hiding the guest list does NOT mail everyone', () => {
  // sendUpdates=all on a settings change would spam every existing guest with a pointless update.
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('{}')],
  ]);
  return client(f).hideGuestList('ev1').then(() => {
    const write = f.calls.find((c) => c.init.method === 'PATCH');
    assert.match(write.url, /sendUpdates=none/);
    assert.deepEqual(JSON.parse(write.init.body), { guestsCanSeeOtherGuests: false });
  });
});

test('a write sends If-Match when given an etag, and omits it when not', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('{}')],
  ]);
  const c = client(f);
  await c.setAttendees('ev1', ['a@example.com'], { expectedEtag: '"etag-7"' });
  const guarded = f.calls.filter((x) => x.init.method === 'PATCH').pop();
  assert.equal(guarded.init.headers['If-Match'], '"etag-7"',
    'without If-Match a concurrent write silently drops a guest who was told they were added');

  await c.setAttendees('ev1', ['b@example.com']);
  const bare = f.calls.filter((x) => x.init.method === 'PATCH').pop();
  assert.ok(!('If-Match' in bare.init.headers), 'no etag means no header, not an empty one');
});

test('a PATCH sends ONLY the attendees field', () => {
  // A full-object write would carry back whatever we read, reverting any field this client does not model.
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('{}')],
  ]);
  return client(f).setAttendees('ev1', ['a@example.com']).then(() => {
    const body = JSON.parse(f.calls.find((c) => c.init.method === 'PATCH').init.body);
    assert.deepEqual(Object.keys(body), ['attendees'], 'nothing but the guest list may be written');
    assert.deepEqual(body.attendees, [{ email: 'a@example.com' }]);
  });
});

test('the attendee list is normalized and deduped before it is written', () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('{}')],
  ]);
  return client(f).setAttendees('ev1', ['  A@Example.com ', 'a@example.com', '', null, 'b@example.com']).then(() => {
    const body = JSON.parse(f.calls.find((c) => c.init.method === 'PATCH').init.body);
    assert.deepEqual(body.attendees, [{ email: 'a@example.com' }, { email: 'b@example.com' }],
      'a duplicate would mail the same person a second invitation');
  });
});

test('a 412 becomes a typed conflict the caller can retry', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('etag mismatch', 412)],
  ]);
  await assert.rejects(
    () => client(f).setAttendees('ev1', ['a@example.com']),
    (e) => e instanceof GoogleCalendarConflict && e.status === 412,
  );
});

test('a token failure never echoes the response body, which can carry the credential back', async () => {
  const leaky = JSON.stringify({ error: 'invalid_grant', refresh_token: 'SUPER-SECRET-TOKEN' });
  const f = fakeFetch([['oauth2.googleapis.com/token', ok(leaky, 400)]]);
  await assert.rejects(
    () => client(f).getEvent('ev1'),
    (e) => {
      assert.ok(e instanceof GoogleCalendarError);
      assert.ok(!e.message.includes('SUPER-SECRET-TOKEN'), 'the credential must not reach an error message');
      assert.ok(!String(e.body).includes('SUPER-SECRET-TOKEN'), 'nor the attached body');
      assert.match(e.message, /invalid_grant/, 'but the CAUSE must survive, or the error is undiagnosable');
      return true;
    },
  );
});

test('the access token is exchanged once and reused across calls', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events', ok('{}')],
  ]);
  const c = client(f);
  await c.getEvent('ev1');
  await c.getEvent('ev2');
  await c.setAttendees('ev1', ['a@example.com']);
  const exchanges = f.calls.filter((x) => x.url.includes('oauth2.googleapis.com/token')).length;
  assert.equal(exchanges, 1, 'a sweep over fifty members must not perform fifty token exchanges');
});

test('an expired cached token is re-exchanged', async () => {
  let clock = 1_000_000;
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(JSON.stringify({ access_token: 'at', expires_in: 120 }))],
    ['/events', ok('{}')],
  ]);
  const c = client(f, { now: () => clock });
  await c.getEvent('ev1');
  clock += 121_000;
  await c.getEvent('ev2');
  assert.equal(f.calls.filter((x) => x.url.includes('/token')).length, 2);
});

test('a missing event reads as null rather than an exception to classify', async () => {
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok('not found', 404)],
  ]);
  assert.equal(await client(f).getEvent('nope'), null);
  assert.equal(await client(f).listAttendees('nope'), null);
});

test('listAttendees returns the live guest list, lowercased', async () => {
  const event = JSON.stringify({ id: 'ev1', attendees: [{ email: 'A@Example.com' }, { email: 'b@x.org' }, {}] });
  const f = fakeFetch([
    ['oauth2.googleapis.com/token', ok(TOKEN_OK)],
    ['/events/', ok(event)],
  ]);
  assert.deepEqual(await client(f).listAttendees('ev1'), ['a@example.com', 'b@x.org']);
});

test('the constructor refuses to build without a full credential', () => {
  for (const missing of ['clientId', 'clientSecret', 'refreshToken']) {
    const args = { clientId: 'a', clientSecret: 'b', refreshToken: 'c' };
    delete args[missing];
    assert.throws(() => createGoogleCalendarClient(args), /required/, `missing ${missing} must throw`);
  }
});

test('address comparison matches Google: case-insensitive, and a blank never matches', () => {
  assert.ok(sameAddress('A@B.com', 'a@b.com'));
  assert.ok(!sameAddress('', ''), 'two blanks are not the same guest');
  assert.ok(!sameAddress(null, undefined));
  assert.equal(normalizeAddress('  X@Y.COM '), 'x@y.com');
  assert.equal(normalizeAddress(42), '');
});
