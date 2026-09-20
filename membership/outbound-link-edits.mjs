// sow-289: the PURE core for the outbound partner link store (house/outbound-links.yml). Node-free, no IO: the
// redirect generator, the build artifact, the board and the tests all validate the store through this one place, so
// a malformed edit fails the build instead of shipping a broken redirect.
//
// One entry per path: { path, destination, partner, status, note }.
//   path         the site path that redirects (ten today, five of them legacy WordPress paths outside /outbound/)
//   destination  the partner URL, ABSOLUTE, with an explicit path before any query (see the rule below)
//   partner      a short label for the board (codeable, bugherd, cloudways, tailscale)
//   status       live | placeholder | retired. A placeholder carries no referral parameter and credits nobody; a
//                retired link is STILL EMITTED as a redirect (an old post may link it), retired is a board label.
//   note         provenance prose shown on the board: where the destination came from and what went wrong before
//
// THE EXPLICIT SLASH RULE IS ENFORCED HERE BECAUSE IT WAS FOUND LIVE. A destination with no path before its query
// (`https://cloudways.com?id=1`) is served by Cloudflare Pages with a trailing slash appended, and with no path to
// land on it lands at the END of the query, turning `chan=gbti` into `chan=gbti/`. `new URL()` normalises that shape
// to a `/` pathname, so the check reads the raw string: the host must be followed by a slash.

export const LINK_STATUSES = Object.freeze(['live', 'placeholder', 'retired']);

const PATH_RE = /^\/[^\s?#]*$/;
const DESTINATION_RE = /^https?:\/\/[^/?#\s]+\/[^\s]*$/i;
const PARTNER_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

/** Coerce a parsed store to its list of entries, or an empty list. Never throws. */
export function linksOf(parsed) {
  return Array.isArray(parsed?.links) ? parsed.links : [];
}

/**
 * Every problem with a parsed store, as strings; an empty list means valid. Checks the whole file rather than
 * stopping at the first fault so an edit can be fixed in one pass.
 */
export function validateOutboundLinks(parsed) {
  const problems = [];
  if (!parsed || typeof parsed !== 'object') return ['outbound-links: the file did not parse to an object'];
  if (!Array.isArray(parsed.links)) return ['outbound-links: `links` must be a list'];
  const seen = new Set();
  parsed.links.forEach((e, i) => {
    const at = `outbound-links: entry ${i + 1}`;
    if (!e || typeof e !== 'object') { problems.push(`${at} is not an object`); return; }
    const p = typeof e.path === 'string' ? e.path : '';
    if (!PATH_RE.test(p)) problems.push(`${at} has an invalid path "${p}" (must start with / and carry no whitespace, query or fragment)`);
    else if (seen.has(p)) problems.push(`${at} repeats the path "${p}"`);
    else seen.add(p);
    const d = typeof e.destination === 'string' ? e.destination : '';
    if (!DESTINATION_RE.test(d)) problems.push(`${at} (${p}) has an invalid destination "${d}" (must be an absolute http(s) URL with an explicit path before any query, for example https://example.com/?ref=x)`);
    if (!PARTNER_RE.test(String(e.partner ?? ''))) problems.push(`${at} (${p}) has an invalid partner "${e.partner}" (a short lowercase label)`);
    if (!LINK_STATUSES.includes(e.status)) problems.push(`${at} (${p}) has an invalid status "${e.status}" (one of ${LINK_STATUSES.join(', ')})`);
    if (e.note != null && typeof e.note !== 'string') problems.push(`${at} (${p}) has a note that is not text`);
  });
  return problems;
}

/** The redirect rows the generator emits for a valid store, in file order: [path, destination] pairs. */
export function redirectRowsOf(parsed) {
  return linksOf(parsed).map((e) => [String(e.path), String(e.destination)]);
}

/** The board's view of one entry: the fields, with the note defaulting to an empty string. */
export function linkSummary(e) {
  return {
    path: String(e?.path ?? ''),
    destination: String(e?.destination ?? ''),
    partner: String(e?.partner ?? ''),
    status: LINK_STATUSES.includes(e?.status) ? e.status : 'live',
    note: typeof e?.note === 'string' ? e.note.trim() : '',
  };
}

// ---------------------------------------------------------------------------------------------------------
// sow-359: where the tracked links reach the served redirect file.
//
// THE PROBLEM THIS SOLVES. `public/_redirects` is COMMITTED, and the only thing that regenerated its partner
// rows from this store was `scripts/gen-redirects.mjs`, run BY HAND: not in `npm run build`, not in
// `build:pages`, not in any workflow. So the store and the file that actually serves could disagree, silently
// and indefinitely, and an edit to the store alone would put a link on the board and a masked path on a card
// while that path 404s. The rows now leave the committed file and are emitted at build instead, from here, so
// there is ONE source and the two cannot drift.
//
// Pure string work on purpose: this module is Node-free and is imported by the build, the client bundles and
// the Worker alike.

/** The line in `public/_redirects` that the store's rows replace. A comment, so the file stays valid without it. */
export const OUTBOUND_MARKER =
  '# sow-359: the tracked partner links from house/outbound-links.yml are emitted here by scripts/compose-redirects.mjs.';

/**
 * Replace the marker line with one `<path> <destination> 301` per row, in store order, at exactly the
 * position the marker holds. Position is not cosmetic: Cloudflare takes the FIRST matching rule, so a row
 * moved below a splat stops working.
 *
 * A text with no marker comes back unchanged. That is the safe direction (the committed file is served as it
 * stands) and it is why the caller asserts the rows landed rather than trusting this to have found anything.
 *
 * `retired` rows are emitted like any other: a path an old post links to must never start 404ing.
 */
export function spliceOutboundRows(text, rows = []) {
  const lines = String(text ?? '').split('\n');
  const at = lines.indexOf(OUTBOUND_MARKER);
  if (at === -1) return String(text ?? '');
  const emitted = rows.map(([p, dest]) => `${p} ${dest} 301`);
  return [...lines.slice(0, at), ...emitted, ...lines.slice(at + 1)].join('\n');
}

// ---------------------------------------------------------------------------------------------------------
// sow-359: EDITING the store. sow-289 shipped the readers and deliberately left this to its own plan mode.
//
// Shape follows membership/cta-edits.mjs exactly: every operation takes the parsed document, returns a NEW
// one with `{ next, changed, audit }`, never mutates its input, is idempotent, and revalidates the whole store
// before returning so a bad edit throws here instead of shipping a broken 301.
//
// TWO RULES THAT ARE NOT PREFERENCES, because getting either wrong costs money:
//
//   A REPOINT KEEPS THE PATH. Changing where a link goes edits the existing row. The path is the key and
//   cannot be edited, so one partner's click history stays in one place. Retiring a path and minting a
//   replacement would split that history across two paths and earn nothing extra.
//
//   A RETIRE KEEPS ANSWERING. `retired` is a label on a row that still emits its 301, because an old post
//   somewhere links to it. Deleting the row is what turns a live link into a 404, so there is no delete here.

export class OutboundLinkEditError extends Error {}

const FIELD_ORDER = ['path', 'destination', 'partner', 'status', 'note'];
const EDITABLE_LINK_FIELDS = Object.freeze(['destination', 'partner', 'note']);

const linkText = (v) => (v == null ? '' : String(v).trim());

/** A deep-enough copy with a `links` array, so no operation can write through to the caller's document. */
function cleanStore(doc) {
  const d = doc && typeof doc === 'object' ? structuredClone(doc) : {};
  d.links = Array.isArray(d.links) ? d.links : [];
  return d;
}

/** The entry for a path, or throw. The path is the key: every operation addresses a row by it. */
function findLink(d, path) {
  const want = linkText(path);
  const e = d.links.find((x) => x && linkText(x.path) === want);
  if (!e) throw new OutboundLinkEditError(`no tracked link at "${want}"`);
  return e;
}

/** Key order as the file writes it, so an edit does not reshuffle a row and produce a noisy diff. */
function canonicalLink(e) {
  const out = {};
  for (const k of FIELD_ORDER) if (e[k] !== undefined) out[k] = e[k];
  for (const k of Object.keys(e)) if (!FIELD_ORDER.includes(k)) out[k] = e[k];
  return out;
}

function assertStoreValid(d, where) {
  const problems = validateOutboundLinks(d);
  if (problems.length) throw new OutboundLinkEditError(`${where}: ${problems[0]}`);
}

function linkAudit(ctx, action, path, detail) {
  const a = ctx?.actor || null;
  return {
    at: ctx?.now ? new Date(ctx.now).toISOString() : new Date().toISOString(),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { path },
    detail: detail ?? null,
  };
}

/** MINT a tracked link. Refuses a duplicate path: two rows for one path means the second never runs. */
export function addOutboundLink(doc, fields = {}, ctx = {}) {
  const d = cleanStore(doc);
  const path = linkText(fields.path);
  if (!path) throw new OutboundLinkEditError('a tracked link needs a path');
  if (d.links.some((x) => x && linkText(x.path) === path)) {
    throw new OutboundLinkEditError(`a tracked link at "${path}" already exists`);
  }
  const entry = canonicalLink({
    path,
    destination: linkText(fields.destination),
    partner: linkText(fields.partner),
    status: LINK_STATUSES.includes(fields.status) ? fields.status : 'live',
    ...(linkText(fields.note) ? { note: linkText(fields.note) } : {}),
  });
  d.links.push(entry);
  assertStoreValid(d, 'add');
  return { next: d, changed: true, audit: linkAudit(ctx, 'outbound.add', path, { destination: entry.destination, partner: entry.partner, status: entry.status }) };
}

/**
 * REPOINT or re-label a tracked link. `destination`, `partner` and `note` only: the path is the key and is
 * deliberately not editable here. Omitted fields are left alone; an empty `note` clears it. Idempotent.
 */
export function updateOutboundLink(doc, fields = {}, ctx = {}) {
  const d = cleanStore(doc);
  const e = findLink(d, fields.path);
  const i = d.links.indexOf(e);
  const changed = [];
  for (const k of EDITABLE_LINK_FIELDS) {
    if (fields[k] === undefined) continue;
    const v = fields[k] === null ? '' : linkText(fields[k]);
    if (k === 'note' && !v) { if (e.note !== undefined) { delete e.note; changed.push('note'); } continue; }
    if (linkText(e[k]) === v) continue;
    e[k] = v; changed.push(k);
  }
  if (!changed.length) return { next: d, changed: false, audit: linkAudit(ctx, 'outbound.update', e.path, { noop: true }) };
  const before = linkText(doc?.links?.find?.((x) => linkText(x?.path) === linkText(fields.path))?.destination);
  d.links[i] = canonicalLink(e);
  assertStoreValid(d, 'update');
  return { next: d, changed: true, audit: linkAudit(ctx, 'outbound.update', e.path, { fields: changed, ...(changed.includes('destination') ? { from: before, to: e.destination } : {}) }) };
}

/**
 * RETIRE a link, or bring one back. The row and its redirect survive either way; only the board's label
 * changes. Idempotent, and refuses a status outside the three the store knows.
 */
export function setOutboundLinkStatus(doc, { path, status } = {}, ctx = {}) {
  const d = cleanStore(doc);
  const e = findLink(d, path);
  if (!LINK_STATUSES.includes(status)) {
    throw new OutboundLinkEditError(`status must be one of ${LINK_STATUSES.join(', ')}, got ${JSON.stringify(status ?? null)}`);
  }
  if (linkText(e.status) === status) {
    return { next: d, changed: false, audit: linkAudit(ctx, 'outbound.status', e.path, { status, noop: true }) };
  }
  e.status = status;
  d.links[d.links.indexOf(e)] = canonicalLink(e);
  assertStoreValid(d, 'status');
  return { next: d, changed: true, audit: linkAudit(ctx, 'outbound.status', e.path, { status }) };
}
