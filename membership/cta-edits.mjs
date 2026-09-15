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
//
// sow-337 adds a layout to each card (membership/cta-card-render.mjs draws the six) and the optional parts a layout
// uses: an image (a file name under house/images/ctas/, checked as a metadata-free WebP by membership/cta-image.mjs),
// a button icon (inline SVG shapes, allowlisted by membership/cta-icon.mjs), and an HTML block with the partner
// hosts its code loads from (scripts/compose-headers.mjs opens the page policy to exactly those hosts). What a
// layout REQUIRES comes from layoutUses, the same table the renderer and the admin read, so the three cannot
// disagree about which fields a card needs. A part the layout does not use may stay stored (switching a card from
// Image below to Text only and back keeps its image); it is still validated, and it is never drawn.
import { CTA_LAYOUTS, layoutUses } from './cta-card-render.mjs';
import { iconProblems } from './cta-icon.mjs';
import { CTA_IMAGE_FILE_RE } from './cta-image.mjs';

export class CtaEditError extends Error {}

export const CTA_ITEM_TYPES = Object.freeze(['prompt', 'post', 'project', 'share']);
export const CTA_LIMITS = Object.freeze({ id: 64, label: 80, line: 200, button: 40, destination: 500, partner: 24, note: 1000, ref: 160, html: 20000, image: 80, hosts: 8, host: 200 });

const ID_RE = /^[a-z0-9][a-z0-9-]*$/;
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const SHARE_REF_RE = /^[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9-]*$/;
const AMAZON_HOST_RE = /(^|\.)amazon\.[a-z.]+$/;
// A partner host, as it goes into the page policy: a bare https origin, lowercase, optionally one leading "*." label
// and a port, nothing else. No path, no quote, no semicolon, no space: any of those could end the policy list and
// start a new directive, so the pattern is the whole defence and it is deliberately narrow.
const LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
export const CTA_HOST_RE = new RegExp(`^https://(?:\\*\\.)?${LABEL}(?:\\.${LABEL})+(?::\\d{1,5})?$`);

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

/** Every href written in an HTML block: quoted or bare attribute values, in source order. */
export function htmlHrefs(html) {
  const out = [];
  const re = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  let m;
  while ((m = re.exec(String(html || '')))) out.push((m[1] ?? m[2] ?? m[3] ?? '').replace(/&amp;/g, '&').trim());
  return out;
}

/**
 * The Amazon rule applied to an HTML block of an amazon card, as reason strings. Every amazon link written in the
 * code must carry the tag, and no link may go through the site's /outbound/ redirect. A link a script builds at run
 * time cannot be read here; the admin says so.
 */
export function amazonHtmlProblems(html) {
  const problems = [];
  for (const href of htmlHrefs(html)) {
    let u = null;
    try { u = new URL(href, 'https://gbti.network'); } catch { continue; }
    if (/(^|\/)outbound\//.test(u.pathname) && (u.hostname === 'gbti.network' || u.hostname.endsWith('.gbti.network'))) {
      problems.push(`the HTML links through /outbound/ (${href}); an amazon link must go straight to amazon`);
    } else if (AMAZON_HOST_RE.test(u.hostname) && !u.searchParams.get('tag')) {
      problems.push(`the HTML links to amazon without the Associates tag= parameter (${href})`);
    }
  }
  return problems;
}

/** Every problem with one CTA entry, prefixed with its position. Pure. */
export function validateCta(e, where = 'cta') {
  const problems = [];
  if (!e || typeof e !== 'object' || Array.isArray(e)) return [`${where}: must be a map`];
  const id = str(e.id);
  if (!id || !ID_RE.test(id) || id.length > CTA_LIMITS.id) problems.push(`${where}: id must be kebab-case (a-z, 0-9, hyphens; max ${CTA_LIMITS.id} chars), got ${JSON.stringify(e.id ?? null)}`);
  if (e.layout !== undefined && !CTA_LAYOUTS.includes(e.layout)) problems.push(`${where}: layout must be one of ${CTA_LAYOUTS.join(', ')}, got ${JSON.stringify(e.layout)}`);
  const layout = CTA_LAYOUTS.includes(e.layout) ? e.layout : 'text';
  const uses = layoutUses(layout);
  for (const [k, max, need] of [['label', CTA_LIMITS.label, true], ['line', CTA_LIMITS.line, uses.line], ['button', CTA_LIMITS.button, uses.button]]) {
    if (e[k] !== undefined && e[k] !== null && typeof e[k] !== 'string') { problems.push(`${where}: ${k} must be text`); continue; }
    const v = str(e[k]);
    if (!v) { if (need) problems.push(`${where}: ${k} is required${k === 'label' ? '' : ` for the ${layout} layout`}`); }
    else if (v.length > max) problems.push(`${where}: ${k} is too long (max ${max} chars)`);
  }
  const dest = str(e.destination);
  let u = null;
  if (dest || uses.link) {
    try { u = new URL(dest); } catch { u = null; }
    if (!u || u.protocol !== 'https:' || !u.hostname) { u = null; problems.push(`${where}: destination must be an absolute https URL, got ${JSON.stringify(e.destination ?? null)}`); }
    else if (dest.length > CTA_LIMITS.destination) problems.push(`${where}: destination is too long (max ${CTA_LIMITS.destination} chars)`);
  }
  if (e.image !== undefined) {
    if (typeof e.image !== 'string' || !CTA_IMAGE_FILE_RE.test(e.image) || e.image.length > CTA_LIMITS.image) problems.push(`${where}: image must be a WebP file name in house/images/ctas/ (like ${id || 'my-card'}.webp), got ${JSON.stringify(e.image)}`);
  } else if (uses.image) problems.push(`${where}: image is required for the ${layout} layout`);
  if (e.icon !== undefined) problems.push(...iconProblems(e.icon, `${where}.icon`));
  if (e.html !== undefined) {
    if (typeof e.html !== 'string') problems.push(`${where}: html must be text`);
    else if (e.html.length > CTA_LIMITS.html) problems.push(`${where}: html is too long (max ${CTA_LIMITS.html} chars)`);
  }
  if (uses.html && !str(e.html)) problems.push(`${where}: html is required for the html layout`);
  if (e.showTitle !== undefined && typeof e.showTitle !== 'boolean') problems.push(`${where}: showTitle must be true or false`);
  if (e.hosts !== undefined) {
    if (!Array.isArray(e.hosts)) problems.push(`${where}: hosts must be a list of https origins`);
    else {
      if (e.hosts.length > CTA_LIMITS.hosts) problems.push(`${where}: at most ${CTA_LIMITS.hosts} hosts`);
      const seenHost = new Set();
      e.hosts.forEach((h, i) => {
        if (typeof h !== 'string' || h.length > CTA_LIMITS.host || !CTA_HOST_RE.test(h)) problems.push(`${where}.hosts[${i}]: must be a bare https origin like https://widgets.example.com (no path, quotes, spaces or semicolons), got ${JSON.stringify(h)}`);
        else if (seenHost.has(h)) problems.push(`${where}.hosts[${i}]: ${h} is listed twice`);
        else seenHost.add(h);
      });
    }
  }
  const partner = str(e.partner);
  if (!partner || !ID_RE.test(partner) || partner.length > CTA_LIMITS.partner) problems.push(`${where}: partner must be a short kebab label (max ${CTA_LIMITS.partner} chars), got ${JSON.stringify(e.partner ?? null)}`);
  if (partner === 'amazon' && u) {
    const why = amazonDestinationProblem(dest);
    if (why) problems.push(`${where}: ${why}`);
  }
  if (partner === 'amazon' && typeof e.html === 'string') for (const why of amazonHtmlProblems(e.html)) problems.push(`${where}: ${why}`);
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
const EDITABLE = ['label', 'line', 'button', 'destination', 'partner', 'note', 'layout', 'html'];
// Text a card may leave out: clearing one removes the key, and the layout decides whether it was needed.
const CLEARABLE = ['line', 'button', 'destination', 'note', 'layout', 'html'];
// The structured parts: null clears, anything else is stored as given (validated below).
const STRUCTURED = ['image', 'icon', 'showTitle', 'hosts'];
export const CTA_FIELDS = Object.freeze([...EDITABLE, ...STRUCTURED]);
const KEY_ORDER = ['id', 'label', 'layout', 'line', 'button', 'destination', 'partner', 'image', 'icon', 'html', 'showTitle', 'hosts', 'enabled', 'note', 'items'];

/** The entry with its keys in the order the file is written in, so an edit never reshuffles the YAML. */
function canonical(e) {
  const out = {};
  for (const k of KEY_ORDER) if (e[k] !== undefined) out[k] = e[k];
  for (const k of Object.keys(e)) if (!(k in out)) out[k] = e[k];
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** ADD a CTA. A second CTA with the same id is refused (update it instead). New CTAs default to disabled. */
export function addCta(doc, fields = {}, ctx = {}) {
  const d = clean(doc);
  const id = str(fields.id);
  if (!id) throw new CtaEditError('a CTA needs an id');
  if (d.ctas.some((x) => x && str(x.id) === id)) throw new CtaEditError(`a CTA with id "${id}" already exists`);
  let entry = { id };
  for (const k of EDITABLE) {
    if (fields[k] === undefined || fields[k] === null) continue;
    const v = String(fields[k]).trim();
    if (v || !CLEARABLE.includes(k)) entry[k] = v;
  }
  for (const k of STRUCTURED) if (fields[k] !== undefined && fields[k] !== null) entry[k] = structuredClone(fields[k]);
  entry.enabled = fields.enabled === true;
  entry.items = [];
  entry = canonical(entry);
  d.ctas.push(entry);
  assertValid(d, 'add');
  return { next: d, changed: true, audit: auditEntry(ctx, 'cta.add', id, { partner: entry.partner, destination: entry.destination }) };
}

/** UPDATE the editable fields of a CTA (CTA_FIELDS). Omitted fields are left alone; an empty text field that a card
 *  may leave out (a note, a sentence on an image-only card) and a null structured part are removed. Idempotent:
 *  identical values are a no-op. */
export function updateCta(doc, fields = {}, ctx = {}) {
  const d = clean(doc);
  const i = d.ctas.indexOf(findCta(d, fields.id));
  const e = d.ctas[i];
  const changed = [];
  for (const k of EDITABLE) {
    if (fields[k] === undefined) continue;
    const v = fields[k] === null ? '' : String(fields[k]).trim();
    if (CLEARABLE.includes(k) && !v) { if (e[k] !== undefined) { delete e[k]; changed.push(k); } continue; }
    if (typeof e[k] === 'string' && e[k].trim() === v) continue;
    e[k] = v; changed.push(k);
  }
  for (const k of STRUCTURED) {
    if (fields[k] === undefined) continue;
    if (fields[k] === null) { if (e[k] !== undefined) { delete e[k]; changed.push(k); } continue; }
    if (same(e[k], fields[k])) continue;
    e[k] = structuredClone(fields[k]); changed.push(k);
  }
  if (!changed.length) return { next: d, changed: false, audit: auditEntry(ctx, 'cta.update', e.id, { noop: true }) };
  d.ctas[i] = canonical(e);
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
