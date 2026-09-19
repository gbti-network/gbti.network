// sow-372: the words that keep a story out of the news stream. Superadmin-owned, read by the ingest and by the
// feed, node-free so the Worker, the site build, the client and the tests all apply the SAME rule.
//
// WHAT BREAKS WITHOUT IT: the pool is 126 general technology and security feeds, and several of them carry
// national politics. Measured on 60 live stories on 2026-09-19, three were American election coverage under a
// technology headline tag. A reader came to a developer co-op's feed and got campaign news.
//
// TWO ENFORCEMENT POINTS, AND THEY ARE NOT THE SAME GUARD (the same reasoning as the sow-338 removals beside
// them in store.mjs):
//   - INGEST drops the story before it is stored, so it is never classified, never summarised (an AI call we
//     would have paid for) and never reaches the day shard.
//   - READ drops it on the way out, so a word added TODAY hides the stories already sitting in the 30-day
//     window. Without this half, seeding this list would have taken a month to take effect.
// A story dropped at ingest is NOT tombstoned, deliberately: nothing records that we refused it, so removing a
// word from the list lets the story flow in on the next run with no un-removal step.
//
// WHOLE WORD, NOT SUBSTRING. "trump" must not silence a story about a trumpet, and "maga" must not silence one
// about magazines. The boundary is any character that is not a letter or a digit, which is what lets "covid"
// still catch "COVID-19" and "#MAGA" and "Trump's".
//
// THIS IS EDITORIAL SCOPE, NOT MODERATION. It decides what an aggregator republishes, and it is applied to
// stories from other publications, never to anything a member wrote.

export class NewsBanwordError extends Error {}

export const BANWORD_MIN = 2;
export const BANWORD_MAX = 40;
// A ceiling on the list, because every stored word joins one alternation that runs over every story's title and
// both summaries on every ingest and every feed read. Two hundred literals is nothing; twenty thousand pasted in
// by accident would not be.
export const BANWORD_LIMIT = 200;

// Letters, digits, single inner spaces and hyphens, so a phrase ("white house") works and a regular expression
// cannot. Stored lowercase, because the match is case-insensitive and two cases of one word are one word.
const WORD_RE = /^[a-z0-9]+(?:[ -][a-z0-9]+)*$/;

/**
 * A word in its stored form, or '' when it is not one. Pure.
 *
 * AT LEAST ONE LETTER IS REQUIRED, which digits alone do not satisfy. Digits are allowed inside a word, because
 * "covid-19" and "web3" need them, but a list entry of "42" is a YAML number somebody typed by accident and it
 * would silence every story that mentions the number. There is no editorial intent a bare number expresses.
 */
export function normalizeBanword(raw) {
  const w = String(raw ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (w.length < BANWORD_MIN || w.length > BANWORD_MAX) return '';
  if (!/[a-z]/.test(w)) return '';
  return WORD_RE.test(w) ? w : '';
}

/**
 * The word list of a parsed document, defensively: lowercased, de-duplicated, sorted, malformed entries dropped.
 *
 * DROPPED RATHER THAN THROWN, on purpose. This runs inside the ingest cron and the feed read, where the only
 * alternatives to ignoring one bad line are blocking everything or blocking nothing, and both are worse than
 * honouring the lines that are fine. The place a malformed line IS an error is the build validator, which fails
 * the pull request before it can reach here.
 */
export function readBanwords(doc) {
  const raw = doc?.words ?? doc?.banwords;
  const list = Array.isArray(raw) ? raw : [];
  const out = new Set();
  for (const entry of list) {
    const w = normalizeBanword(entry);
    if (w) out.add(w);
    if (out.size >= BANWORD_LIMIT) break;
  }
  return [...out].sort();
}

/** One regular expression over the whole list, or null for an empty list. Pure; built once per run, not per story. */
export function banwordMatcher(words) {
  const list = Array.isArray(words) ? words.map(normalizeBanword).filter(Boolean) : [];
  if (!list.length) return null;
  // Longest first so the reported word is the most specific one that matched, and escaped even though the shape
  // above already excludes every metacharacter: the guard has to survive somebody widening WORD_RE later.
  const alts = [...new Set(list)].sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, 'iu');
}

/**
 * The word that blocks this story, or null when none does. Matches the headline and BOTH summaries: the
 * publisher's blurb and ours.
 *
 * WHY BOTH SUMMARIES AND NOT THE HEADLINE ALONE. A headline-only rule misses "The chip tariffs explained", whose
 * blurb is entirely about the election. The cost of reading the summaries is over-blocking a technology story
 * that mentions a banned word in passing, so every block is LOGGED with the word and the headline: over-blocking
 * shows up in the ingest log rather than as stories silently missing. Measured over 60 live stories on
 * 2026-09-19 with the seeded six words, matching the summaries blocked nothing the headline had not already
 * blocked, so the wider rule cost nothing on that sample.
 */
export function blockedBy(item, matcher) {
  if (!matcher) return null;
  const text = (v) => (typeof v === 'string' ? v : '');
  const hay = `${text(item?.title)}\n${text(item?.summary)}\n${text(item?.digest)}`;
  const m = matcher.exec(hay);
  return m ? m[0].toLowerCase() : null;
}

// ---------------------------------------------------------------------------
// Editing the list, through the same pull-request flow as every other house file
// ---------------------------------------------------------------------------

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new NewsBanwordError('invalid timestamp');
  return d.toISOString();
}

/** Identity-minimal audit entry, keyed by the word rather than by a person. */
function auditEntry(ctx, word, action) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { word },
    detail: null,
  };
}

function withWords(doc, words) {
  const next = { ...(doc || {}) };
  delete next.banwords; // the tolerated alias never becomes the stored key
  next.words = words;
  return next;
}

/** Add a word. Throws on one that is not a word; idempotent when it is already listed. */
export function addBanword(doc, { word } = {}, ctx = {}) {
  const w = normalizeBanword(word);
  if (!w) throw new NewsBanwordError(`a blocked word is ${BANWORD_MIN} to ${BANWORD_MAX} characters, letters and digits with at least one letter, single spaces or hyphens between them`);
  const words = readBanwords(doc);
  if (words.includes(w)) return { next: withWords(doc, words), changed: false, audit: null };
  if (words.length >= BANWORD_LIMIT) throw new NewsBanwordError(`the blocked word list is full at ${BANWORD_LIMIT} words`);
  return { next: withWords(doc, [...words, w].sort()), changed: true, audit: auditEntry(ctx, w, 'news-banword-add') };
}

/** Remove a word. Idempotent when it is not listed. */
export function removeBanword(doc, { word } = {}, ctx = {}) {
  const w = normalizeBanword(word);
  if (!w) throw new NewsBanwordError('a blocked word is required');
  const words = readBanwords(doc);
  if (!words.includes(w)) return { next: withWords(doc, words), changed: false, audit: null };
  return { next: withWords(doc, words.filter((x) => x !== w)), changed: true, audit: auditEntry(ctx, w, 'news-banword-remove') };
}

/** Validate the action payload the Worker received. Throws, like the other config-action inputs. */
export function banwordInput(payload) {
  const word = normalizeBanword(payload?.word);
  if (!word) throw new NewsBanwordError(`a blocked word is ${BANWORD_MIN} to ${BANWORD_MAX} characters, letters and digits with at least one letter, single spaces or hyphens between them`);
  return { word };
}
