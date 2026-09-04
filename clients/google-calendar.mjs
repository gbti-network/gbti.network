// sow-314: thin Google Calendar REST client for managing the guest list on the Shop Talk event.
// Injectable fetch, no SDK, matching clients/discord.mjs and clients/stripe.mjs.
//
// WHY THIS EXISTS. The owner adds each member's email address to the recurring Saturday event BY HAND, so the
// member receives the invitation and can enter the Google Meet without knocking. Meet admits people without a
// knock by reading the guest list on the event, which is why a downloaded .ics does not help: an import is a
// COPY, and a copy puts the event in somebody's calendar while leaving them outside the meeting.
//
// AUTHENTICATION IS THE PROVEN PATTERN, NOT A NEW ONE. scripts/publish-cws.mjs already trades a client id,
// secret and refresh token at oauth2.googleapis.com/token for an access token, against the owner's own
// account, to publish the Chrome extension. This is the same exchange with a calendar scope. It deliberately
// does NOT use a service account: Google restricts service accounts from inviting guests unless they belong to
// a Workspace organisation, and the owner's is a consumer account, so that route would create events happily
// and fail silently at the only thing we need.
//
// THREE THINGS HERE ARE LOAD-BEARING AND EACH NAMES SOMETHING THAT BREAKS:
//
//   1. sendUpdates=all ON EVERY ATTENDEE MUTATION. Without it Google records the attendee and mails nobody.
//      The member is on the list, never hears about it, does not attend, and has no reason to report a fault.
//      That is the whole feature failing silently, so the parameter is applied HERE rather than left to each
//      caller to remember.
//
//   2. IF-MATCH ON EVERY WRITE. Adding one guest means reading the attendee array, appending, and writing the
//      whole array back. Two of those racing (a reconcile sweep and a member pressing the button) would have
//      the second write clobber the first, silently dropping a guest who was told they were added. The event's
//      etag turns that into a 412 the caller can retry instead of a lost update nobody sees.
//
//   3. NEVER SEND THE WHOLE EVENT BACK ON A PATCH. Only the fields being changed. A full-object write would
//      carry back whatever we happened to read, so any field this client does not model (a description edit
//      made on a phone, a conferencing change) would be reverted by the next sweep.

export class GoogleCalendarError extends Error {
  constructor(status, body) {
    super(`google calendar error ${status}: ${body}`);
    this.status = status;
    this.body = body;
  }
}

/** Thrown when a write loses the If-Match race. Callers re-read and retry rather than forcing. */
export class GoogleCalendarConflict extends GoogleCalendarError {
  constructor(body) {
    super(412, body);
    this.name = 'GoogleCalendarConflict';
  }
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';

/** Refresh a little early. A token that expires between the check and the request reads as an auth failure. */
const EXPIRY_SKEW_MS = 60_000;

/** Compare addresses the way Google does for attendee identity: case-insensitively, trimmed. */
export function sameAddress(a, b) {
  return normalizeAddress(a) !== '' && normalizeAddress(a) === normalizeAddress(b);
}

export function normalizeAddress(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

export function createGoogleCalendarClient({
  clientId,
  clientSecret,
  refreshToken,
  calendarId = 'primary',
  fetch = globalThis.fetch,
  tokenUrl = TOKEN_URL,
  baseUrl = API_BASE,
  now = Date.now,
}) {
  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('createGoogleCalendarClient: clientId, clientSecret and refreshToken are all required');
  }

  // Cached across calls within a run. A sweep touching fifty members should not perform fifty token exchanges.
  let cachedToken = null;
  let cachedUntil = 0;

  async function accessToken() {
    if (cachedToken && now() < cachedUntil) return cachedToken;
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }).toString(),
    });
    const text = await res.text();
    let body = {};
    try { body = text ? JSON.parse(text) : {}; } catch { body = {}; }
    if (!res.ok || !body.access_token) {
      // Do NOT echo the response body: a token endpoint's error payload can carry the credential back.
      throw new GoogleCalendarError(res.status, `token exchange failed: ${body.error || 'no access_token'}`);
    }
    cachedToken = body.access_token;
    const lifetimeMs = (Number(body.expires_in) || 3600) * 1000;
    cachedUntil = now() + Math.max(0, lifetimeMs - EXPIRY_SKEW_MS);
    return cachedToken;
  }

  async function req(method, path, { body, etag, query } = {}) {
    const token = await accessToken();
    const qs = query ? `?${new URLSearchParams(query).toString()}` : '';
    const headers = { Authorization: `Bearer ${token}` };
    if (body) headers['Content-Type'] = 'application/json';
    // If-Match is how a read-modify-write stops being a lost update. It is passed per call rather than
    // defaulted, because a read has nothing to match against.
    if (etag) headers['If-Match'] = etag;
    const res = await fetch(baseUrl + path + qs, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    if (res.status === 412) throw new GoogleCalendarConflict(text);
    if (!res.ok) throw new GoogleCalendarError(res.status, text);
    return text ? JSON.parse(text) : null;
  }

  const eventPath = (eventId) => `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

  return {
    _req: req,
    _accessToken: accessToken,
    calendarId,

    /** List upcoming events, so the owner can CONFIRM which one is the Shop Talk series rather than
     *  transcribing an id by hand. Returns the raw items; the caller decides what to show. */
    async listEvents({ maxResults = 25, timeMin = null } = {}) {
      const query = { maxResults: String(maxResults), singleEvents: 'false', orderBy: 'updated' };
      if (timeMin) query.timeMin = timeMin;
      const out = await req('GET', `/calendars/${encodeURIComponent(calendarId)}/events`, { query });
      return Array.isArray(out?.items) ? out.items : [];
    },

    /** Read the event. Returns null on 404 so a wrong or deleted id is a decision the caller makes rather
     *  than an exception it has to classify. */
    getEvent(eventId) {
      return req('GET', eventPath(eventId)).catch((e) => {
        if (e instanceof GoogleCalendarError && e.status === 404) return null;
        throw e;
      });
    },

    /** The guest list as plain lowercased addresses. This is the ONLY honest source for "is this member
     *  already on the call": our own record cannot see the people the owner added by hand. */
    async listAttendees(eventId) {
      const event = await this.getEvent(eventId);
      if (!event) return null;
      return (Array.isArray(event.attendees) ? event.attendees : [])
        .map((a) => normalizeAddress(a?.email))
        .filter(Boolean);
    },

    /**
     * Replace the attendee list wholesale, guarded by the event's etag.
     *
     * The whole-list shape is Google's, not a choice: the API has no add-one-guest verb, so every change is a
     * read, a modify and a write of the entire array. `expectedEtag` is what stops two of those racing.
     */
    setAttendees(eventId, addresses, { expectedEtag, sendUpdates = 'all' } = {}) {
      const seen = new Set();
      const attendees = [];
      for (const a of Array.isArray(addresses) ? addresses : []) {
        const email = normalizeAddress(a);
        if (!email || seen.has(email)) continue;
        seen.add(email);
        attendees.push({ email });
      }
      // PATCH, not PUT: only `attendees` is sent, so nothing else on the event can be reverted by a sweep.
      return req('PATCH', eventPath(eventId), {
        body: { attendees },
        etag: expectedEtag,
        query: { sendUpdates },
      });
    },

    /** Hide the guest list, so joining the call does not disclose a member's address to every other member.
     *  A property of the EVENT rather than of each add, which is why it is set once and not per member. */
    hideGuestList(eventId, { expectedEtag } = {}) {
      return req('PATCH', eventPath(eventId), {
        body: { guestsCanSeeOtherGuests: false },
        etag: expectedEtag,
        query: { sendUpdates: 'none' },
      });
    },
  };
}
