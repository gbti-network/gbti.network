// The ISO 8601 calendar week of a moment, read in UTC. Shared by the weekly email (its "WEEK 44, 2026" date line
// and subject, membership/mail-render.mjs) and the Social Queue post that announces the same issue ("Week 44 Digest
// is out!", the {week} template token in membership/syndication-format.mjs), so the post and the email it links to
// can never name different weeks. Pure, and small on purpose: the syndication renderer ships in the admin bundle.
//
// ISO 8601 weeks start on Monday, and week 1 is the week holding January 4th. The year returned is the ISO
// WEEK-YEAR, not the calendar year of the date. Those disagree for a few days at each turn of the year:
// 2026-12-31 sits in week 1 of 2027.

const DAY_MS = 24 * 3600 * 1000;

/** { week, year } for a millisecond timestamp, or null for anything that is not a real moment after 1970. */
export function isoWeek(ms) {
  const n = Number(ms);
  // `> 0` and not merely finite, because Number(null) is 0, not NaN, and "Week 1, 1970" is never a real issue.
  if (!Number.isFinite(n) || n <= 0) return null;
  const d = new Date(n);
  if (!Number.isFinite(d.getTime())) return null;
  // Move to the Thursday of this week: the ISO year is whichever year that Thursday falls in.
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const mondayIndex = (thursday.getUTCDay() + 6) % 7; // Monday 0 ... Sunday 6
  thursday.setUTCDate(thursday.getUTCDate() - mondayIndex + 3);
  const year = thursday.getUTCFullYear();
  // January 4th is always in ISO week 1, so the Thursday of ITS week anchors the count.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Index = (jan4.getUTCDay() + 6) % 7;
  const week1Thursday = new Date(Date.UTC(year, 0, 4 - jan4Index + 3));
  const week = 1 + Math.round((thursday.getTime() - week1Thursday.getTime()) / (7 * DAY_MS));
  return { week, year };
}
