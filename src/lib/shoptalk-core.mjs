// sow-191: the Shop Talk event, as pure functions over a plain config object.
//
// Pure and node-free ON PURPOSE. The .ics generation lives here rather than inline in the Astro endpoint
// because logic inside an .astro page or a .ts route is unreachable from `node --test`, and this repo has
// already shipped a real data-loss defect that way: a commit path with no importable surface passed 2767
// green tests and was found by reading, not by running. An RFC 5545 writer is exactly the kind of code where
// the failure is silent (an event imports at the wrong hour, or as a single occurrence instead of a series)
// and the member never reports it, so it needs to be testable.
//
// Nothing here touches the filesystem. src/lib/shoptalk.ts reads the YAML and hands it in.

/** IANA zones we can emit a correct VTIMEZONE for. Adding one means adding its DST rules below, deliberately:
 *  a zone with no rules would silently emit a floating time, which is the failure this whole module avoids. */
const TZ_RULES = {
  // United States rules since 2007: DST starts the second Sunday in March, ends the first Sunday in November.
  'America/Chicago': {
    standard: { name: 'CST', offsetFrom: '-0500', offsetTo: '-0600', rule: 'FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', start: '19701101T020000' },
    daylight: { name: 'CDT', offsetFrom: '-0600', offsetTo: '-0500', rule: 'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', start: '19700308T020000' },
    label: 'Central Time',
  },
};

/**
 * Escape a text value for RFC 5545 section 3.3.11.
 *
 * The order is load-bearing: backslash MUST be escaped first, or escaping a comma to `\,` would then have its
 * own backslash escaped again and ship `\\,`, which renders as a literal backslash next to a comma. Newlines
 * become the two-character sequence `\n`, never a real line break, because a raw newline inside a property
 * value terminates the property and corrupts every line after it.
 */
export function escapeIcsText(value) {
  return String(value == null ? '' : value)
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/**
 * Fold a content line to 75 octets per RFC 5545 section 3.1, continuing with a single leading space.
 *
 * Measured in BYTES, not characters. A multi-byte character split across a fold boundary produces invalid
 * UTF-8 and some clients drop the whole event rather than the line, so the split point is chosen by encoded
 * length rather than by `String.length`.
 */
export function foldIcsLine(line) {
  const bytes = Buffer.from(String(line), 'utf8');
  if (bytes.length <= 75) return String(line);
  const out = [];
  let start = 0;
  let limit = 75;
  while (start < bytes.length) {
    let end = Math.min(start + limit, bytes.length);
    // Walk back off a continuation byte (10xxxxxx) so a character is never cut in half.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    out.push((start === 0 ? '' : ' ') + bytes.slice(start, end).toString('utf8'));
    start = end;
    limit = 74; // subsequent lines spend one octet on the leading space
  }
  return out.join('\r\n');
}

/** Validate the config and normalize it. Throws with a specific message naming the field, so a bad edit fails
 *  the build loudly rather than shipping an event nobody can trust. */
export function normalizeShoptalk(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {};
  const req = (key) => {
    const v = String(cfg[key] == null ? '' : cfg[key]).trim();
    if (!v) throw new Error(`house/shoptalk.yml: "${key}" is required and must be a non-empty string`);
    return v;
  };

  const timezone = req('timezone');
  if (!TZ_RULES[timezone]) {
    throw new Error(
      `house/shoptalk.yml: timezone "${timezone}" has no VTIMEZONE rules in src/lib/shoptalk-core.mjs. ` +
        `Add its DST rules there rather than emitting a floating time.`,
    );
  }

  const startTime = req('start_time');
  const hm = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(startTime);
  if (!hm) throw new Error(`house/shoptalk.yml: start_time must be 24-hour "HH:MM" (got "${startTime}")`);

  const startsOn = String(cfg.starts_on instanceof Date ? cfg.starts_on.toISOString().slice(0, 10) : req('starts_on'));
  const ymd = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsOn);
  if (!ymd) throw new Error(`house/shoptalk.yml: starts_on must be "YYYY-MM-DD" (got "${startsOn}")`);

  const duration = Number(cfg.duration_minutes);
  if (!Number.isInteger(duration) || duration <= 0) {
    throw new Error(`house/shoptalk.yml: duration_minutes must be a positive whole number of minutes (got "${cfg.duration_minutes}")`);
  }

  const recurrence = req('recurrence');
  if (/^RRULE:/i.test(recurrence)) {
    throw new Error(`house/shoptalk.yml: recurrence must omit the "RRULE:" prefix (got "${recurrence}")`);
  }

  // publish_join_url is fail-closed: anything other than an explicit `true` means do not publish. A typo, a
  // missing key or the string "yes" all resolve to false, because the failure that matters is publishing a
  // private link by accident, never withholding a public one.
  const publishJoinUrl = cfg.publish_join_url === true;

  return {
    title: req('title'),
    cardTitle: req('card_title'),
    startTime,
    startHour: hm[1],
    startMinute: hm[2],
    durationMinutes: duration,
    timezone,
    recurrence,
    startsOn,
    startsOnCompact: `${ymd[1]}${ymd[2]}${ymd[3]}`,
    cardDescription: req('card_description'),
    calendarDescription: req('calendar_description'),
    joinUrl: String(cfg.join_url == null ? '' : cfg.join_url).trim(),
    publishJoinUrl,
  };
}

/** The human-readable timezone label. Derived, never hardcoded: "CST" is wrong from March to November, and a
 *  member converting from another zone off a wrong label arrives an hour early without ever knowing why. */
export function timezoneLabel(timezone) {
  return TZ_RULES[timezone] ? TZ_RULES[timezone].label : timezone;
}

/** The card's "when" line, for example "Saturdays \u00b7 11:00 AM Central Time". The middle dot matches the
 *  separator the homepage card already uses for this field. */
export function displayWhen(event) {
  const h = Number(event.startHour);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const day = /BYDAY=SA/i.test(event.recurrence) ? 'Saturdays' : 'Weekly';
  return `${day} \u00b7 ${h12}:${event.startMinute} ${suffix} ${timezoneLabel(event.timezone)}`;
}

/** The short time chip, for example "Sat \u00b7 11:00 AM CT". */
export function displayTimeShort(event) {
  const h = Number(event.startHour);
  const suffix = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  const day = /BYDAY=SA/i.test(event.recurrence) ? 'Sat' : 'Weekly';
  const short = timezoneLabel(event.timezone).split(' ').map((w) => w[0]).join('');
  return `${day} \u00b7 ${h12}:${event.startMinute} ${suffix} ${short}`;
}

/** Local end time as HHMMSS, wrapping past midnight is refused rather than silently wrong. */
function endTimeCompact(event) {
  const mins = Number(event.startHour) * 60 + Number(event.startMinute) + event.durationMinutes;
  if (mins >= 24 * 60) {
    throw new Error(
      `house/shoptalk.yml: start_time ${event.startTime} plus duration_minutes ${event.durationMinutes} runs past midnight. ` +
        `A same-day DTEND cannot express that; split the event or shorten it.`,
    );
  }
  const hh = String(Math.floor(mins / 60)).padStart(2, '0');
  const mm = String(mins % 60).padStart(2, '0');
  return `${hh}${mm}00`;
}

/**
 * Build the full .ics document.
 *
 * `uid` and `stamp` are injected rather than generated so the output is deterministic and testable. A UID that
 * changed on every build would make each deploy look like a NEW event to a calendar client that already has
 * the old one, which is how a member ends up with eleven copies of the same call.
 */
export function buildShoptalkIcs(event, { uid, stamp }) {
  const tz = TZ_RULES[event.timezone];
  const description = event.publishJoinUrl && event.joinUrl
    ? `${event.calendarDescription}\n\nJoin: ${event.joinUrl}`
    : event.calendarDescription;

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//GBTI Network//Shop Talk//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    `TZID:${event.timezone}`,
    'BEGIN:DAYLIGHT',
    `TZOFFSETFROM:${tz.daylight.offsetFrom}`,
    `TZOFFSETTO:${tz.daylight.offsetTo}`,
    `TZNAME:${tz.daylight.name}`,
    `DTSTART:${tz.daylight.start}`,
    `RRULE:${tz.daylight.rule}`,
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    `TZOFFSETFROM:${tz.standard.offsetFrom}`,
    `TZOFFSETTO:${tz.standard.offsetTo}`,
    `TZNAME:${tz.standard.name}`,
    `DTSTART:${tz.standard.start}`,
    `RRULE:${tz.standard.rule}`,
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=${event.timezone}:${event.startsOnCompact}T${event.startHour}${event.startMinute}00`,
    `DTEND;TZID=${event.timezone}:${event.startsOnCompact}T${endTimeCompact(event)}`,
    `RRULE:${event.recurrence}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
    `DESCRIPTION:${escapeIcsText(description)}`,
    ...(event.publishJoinUrl && event.joinUrl ? [`URL:${escapeIcsText(event.joinUrl)}`] : []),
    ...(event.publishJoinUrl && event.joinUrl ? [`LOCATION:${escapeIcsText(event.joinUrl)}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:OPAQUE',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF is required by RFC 5545 section 3.1 and is not cosmetic: several clients reject an LF-only file
  // outright, so a locally-readable .ics can still fail to import for the member.
  return lines.map(foldIcsLine).join('\r\n') + '\r\n';
}
