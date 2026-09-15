// sow-281: the PURE edit core for house/ctas.yml, the registered content CTAs. Given the PARSED registry
// ({ ctas: [{ id, label, line, button, destination, partner, enabled, note, items: [{ type, ref }] }] }) plus an
// action, each function returns { next, changed, audit }: `next` is the new parsed doc (the caller serializes and
// commits it through the house PR flow, exactly like quote-edits.mjs), `changed` is false when the action is already
// satisfied, and `audit` is an identity-minimal log entry folded into the PR body. Node-free (no fs, no yaml) so it
// runs in the client, the Worker, the build and the tests. `validateCtas` is the one rule set every reader shares:
// the build, the content check and the write ops all refuse the same shapes.
//
// SECURITY: this only COMPUTES the file edit. Authorization is CODEOWNERS (house/ctas.yml is superadmin-pinned) +
// no-bypass branch protection + the metadata-only gate, plus ROLE_RANK.superadmin on the Worker ops.
//
// THE AMAZON RULE: an Amazon Associates purchase reached through an intermediate site ("a Redirecting Link") is
// disqualified, and a placement must not hide that the link leads to Amazon. So a `partner: amazon` destination
// must be an amazon domain itself (no /outbound/ path, no other redirect) and must carry the tag= parameter.

export class CtaEditError extends Error {}

export const CTA_ITEM_TYPES = Object.freeze(['prompt', 'post', 'project', 'share']);
export const CTA_LIMITS = Object.freeze({ id: 64, label: 80, line: 200, button: 40, destination: 500, partner: 24, note: 1000, ref: 160 });

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHARE_REF_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z.]+$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new CtaEditError('invalid timestamp');
  return d.toISOString();
}
function auditEntry(ctx, action, id, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { id },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!Array.isArray(d.ctas)) d.ctas = [];
  return d;
}

/** The registry's CTA list, or [] for anything that is not a list. */
export function ctasOf(parsed) {
  return Array.isArray(parsed?.ctas) ? parsed.ctas : [];
}

/** Is `ref` a well-formed item reference for `type`? A share ref is author/id; the rest are slugs. */
export function validRef(type, ref) {
  const r = str(ref);
  if (!r || r.length > CTA_LIMITS.ref) return false;
  return type === 'share' ? SHARE_REF_RE.test(r) : SLUG_RE.test(r);
}

/** The Amazon rule, as one reason string or null. Exported so the tests can name each half. */
export function amazonDestinationProblem(destination) {
  let u;
  try { u = new URL(String(destination || '')); } catch { return 'an amazon destination must be an absolute URL'; }
  if (!AMAZON_HOST_RE.test(u.hostname)) return 'an amazon CTA must link straight to an amazon domain (no /outbound/ path or other intermediate site: a redirected purchase earns nothing)';
  if (!u.searchParams.get('tag')) return 'an amazon destination must carry the Associates tag= parameter (without it the purchase earns nothing)';
  return null;
}

/** Every problem with one CTA entry, prefixed with its position. Pure. */
export function validateCta(e, where = 'cta') {
  const problems = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return [`${where}: must be a map`];
  const id = str(e.id);
  if (!id || !ID_RE.test(id) || id.length > CTA_LIMITS.id) problems.push(`${where}: id must be kebab-case (a-z, 0-9, hyphens; max ${CTA_LIMITS.id} chars), got ${JSON.stringify(e.id ?? null)}`);
  for (const [k, max] of [['label', CTA_LIMITS.label], ['line', CTA_LIMITS.line], ['button', CTA_LIMITS.button]]) {
    const v = str(e[k]);
    if (!v) problems.push(`${where}: ${k} is required`);
    else if (v.length > max) problems.push(`${where}: ${k} is too long (max ${max} chars)`);
  }
  const dest = str(e.destination);
  let u = null;
  try { u = new URL(dest); } catch { u = null; }
  if (!u || u.protocol !== 'https:' || !u.hostname) problems.push(`${where}: destination must be an absolute https URL, got ${JSON.stringify(e.destination ?? null)}`);
  else if (dest.length > CTA_LIMITS.destination) problems.push(`${where}: destination is too long (max ${CTA_LIMITS.destination} chars)`);
  const partner = str(e.partner);
  if (!partner || !ID_RE.test(partner) || partner.length > CTA_LIMITS.partner) problems.push(`${where}: partner must be a short kebab label (max ${CTA_LIMITS.partner} chars), got ${JSON.stringify(e.partner ?? null)}`);
  if (partner === 'amazon' && u) {
    const why = amazonDestinationProblem(dest);
    if (why) problems.push(`${where}: ${why}`);
  }
  if (e.enabled !== undefined && typeof e.enabled !== 'boolean') problems.push(`${where}: enabled must be true or false`);
  if (e.note !== undefined && e.note !== null && (typeof e.note !== 'string' || e.note.length > CTA_LIMITS.note)) problems.push(`${where}: note must be a string (max ${CTA_LIMITS.note} chars)`);
  if (e.items !== undefined && !Array.isArray(e.items)) problems.push(`${where}: items must be a list of { type, ref }`);
  const seen = new Set();
  for (const [i, it] of (Array.isArray(e.items) ? e.items : []).entries()) {
    const at = `${where}.items[${i}]`;
    if (!it || typeof it !== 'object') { problems.push(`${at}: must be a map of { type, ref }`); continue; }
    if (!CTA_ITEM_TYPES.includes(it.type)) { problems.push(`${at}: type must be one of ${CTA_ITEM_TYPES.join(', ')}, got ${JSON.stringify(it.type ?? null)}`); continue; }
    if (!validRef(it.type, it.ref)) { problems.push(`${at}: ref must be a ${it.type === 'share' ? 'author/id pair' : 'slug'}, got ${JSON.stringify(it.ref ?? null)}`); continue; }
    const key = `${it.type}:${str(it.ref)}`;
    if (seen.has(key)) problems.push(`${at}: ${key} is assigned to this CTA twice`);
    seen.add(key);
  }
  return problems;
}

/** Every problem with the whole registry (shape, each entry, duplicate ids). [] means valid. Pure. */
export function validateCtas(parsed) {
  if (parsed === null || parsed === undefined) return ['the registry is empty (expected a ctas: list)'];
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return ['the registry must be a map with a ctas: list'];
  if (parsed.ctas !== undefined && !Array.isArray(parsed.ctas)) return ['ctas must be a list'];
  const problems = [];
  const ids = new Map();
  ctasOf(parsed).forEach((e, i) => {
    const where = `ctas[${i}]`;
    problems.push(...validateCta(e, where));
    const id = str(e?.id);
    if (id) {
      if (ids.has(id)) problems.push(`${where}: duplicate id "${id}" (also ${ids.get(id)})`);
      else ids.set(id, where);
    }
  });
  return problems;
}

function findCta(d, id) {
  const k = str(id);
  const e = d.ctas.find((x) => x && typeof x === 'object' && str(x.id) === k);
  if (!e) throw new CtaEditError(`no CTA with id "${k}"`);
  return e;
}
function assertValid(d, where) {
  const problems = validateCtas(d);
  if (problems.length) throw new CtaEditError(`${where}: ${problems[0]}`);
}
const EDITABLE = ['label', 'line', 'button', 'destination', 'partner', 'note'];

/** ADD a CTA. A second CTA with the same id is refused (update it instead). New CTAs default to disabled. */
export function addCta(doc, fields = {}, ctx = {}) {
  const d = clean(doc);
  const id = str(fields.id);
  if (!id) throw new CtaEditError('a CTA needs an id');
  if (d.ctas.some((x) => x && str(x.id) === id)) throw new CtaEditError(`a CTA with id "${id}" already exists`);
  const entry = { id };
  for (const k of EDITABLE) if (fields[k] !== undefined && fields[k] !== null) entry[k] = String(fields[k]).trim();
  entry.enabled = fields.enabled === true;
  entry.items = [];
  d.ctas.push(entry);
  assertValid(d, 'add');
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.add', id, { partner: entry.partner, destination: entry.destination }) };
}

/** UPDATE the editable fields of a CTA (label, line, button, destination, partner, note). Omitted fields are left
 *  alone; an empty note clears it. Idempotent: identical values are a no-op. */
export function updateCta(doc, fields = {}, ctx = {}) {
  const d = clean(doc);
  const e = findCta(d, fields.id);
  const changed = [];
  for (const k of EDITABLE) {
    if (fields[k] === undefined) continue;
    const v = fields[k] === null ? '' : String(fields[k]).trim();
    if (k === 'note' && !v) { if (e.note !== undefined) { delete e.note; changed.push(k); } continue; }
    if (str(e[k]) === v) continue;
    e[k] = v; changed.push(k);
  }
  if (!changed.length) return { next: d, changed: false, audit: auditEntry(ctx, 'cta.update', e.id, { noop: true }) };
  assertValid(d, 'update');
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.update', e.id, { fields: changed }) };
}

/** ENABLE / DISABLE a CTA (the way to retire one: history is kept). Idempotent. */
export function setCtaEnabled(doc, { id, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const e = findCta(d, id);
  const want = enabled === true;
  if ((e.enabled === true) === want) return { next: d, changed: false, audit: auditEntry(ctx, 'cta.enable', e.id, { enabled: want, noop: true }) };
  e.enabled = want;
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.enable', e.id, { enabled: want }) };
}

/** ASSIGN a CTA to an item. Idempotent. Refuses a bad type or ref. */
export function assignCta(doc, { id, type, ref } = {}, ctx = {}) {
  const d = clean(doc);
  const e = findCta(d, id);
  if (!CTA_ITEM_TYPES.includes(type)) throw new CtaEditError(`type must be one of ${CTA_ITEM_TYPES.join(', ')}`);
  const r = str(ref);
  if (!validRef(type, r)) throw new CtaEditError(`ref must be a ${type === 'share' ? 'author/id pair' : 'slug'}`);
  if (!Array.isArray(e.items)) e.items = [];
  if (e.items.some((it) => it && it.type === type && str(it.ref) === r)) return { next: d, changed: false, audit: auditEntry(ctx, 'cta.assign', e.id, { type, ref: r, noop: true }) };
  e.items.push({ type, ref: r });
  assertValid(d, 'assign');
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.assign', e.id, { type, ref: r }) };
}

/** UNASSIGN a CTA from an item. An assignment that is not there is a no-op. */
export function unassignCta(doc, { id, type, ref } = {}, ctx = {}) {
  const d = clean(doc);
  const e = findCta(d, id);
  const r = str(ref);
  const i = Array.isArray(e.items) ? e.items.findIndex((it) => it && it.type === type && str(it.ref) === r) : -1;
  if (i < 0) return { next: d, changed: false, audit: auditEntry(ctx, 'cta.unassign', e.id, { type, ref: r, noop: true }) };
  e.items.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.unassign', e.id, { type, ref: r }) };
}
