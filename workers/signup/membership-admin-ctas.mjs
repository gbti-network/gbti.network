// sow-281: the Worker half of the CTA registry (house/ctas.yml): the SUPERADMIN pool read and the input validators
// for the five write ops (cta-add / cta-update / cta-toggle / cta-assign / cta-unassign). The ops themselves are
// rows in membership-admin-author.mjs's CONFIG_OP table (the file is at the size cap, so the validators live here)
// with rank: ROLE_RANK.superadmin; the second authority is the CODEOWNERS pin on house/ctas.yml. The validators
// bound the wire shapes to exactly the caps the pure core enforces (CTA_LIMITS), so a malformed request costs no
// GitHub read; the core (membership/cta-edits.mjs) is what refuses a bad destination or the Amazon rule.
//
// sow-337: add and update also take the card's layout and parts (layout, html, icon, showTitle, hosts) and its
// image, sent as `imageBase64` (the admin's in-browser WebP re-encode) or `removeImage: true`. The client never
// names the image file: membership/cta-image.mjs checks the bytes and names the file after the card, and
// ctaImageFiles below turns that into the files the route commits beside the registry. Which parts a layout
// requires is the core's call, so add requires only the id, label and partner here.
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { loadHouseYaml } from './membership-admin-author.mjs';
import { CTA_ITEM_TYPES, CTA_LIMITS, validRef, ctasOf } from '../../membership/cta-edits.mjs';
import { ctaImageUpload, ctaImageFileChanges } from '../../membership/cta-image.mjs';
import { ICON_LIMITS } from '../../membership/cta-icon.mjs';

export const CTAS_PATH = 'house/ctas.yml';

const bad = (message) => ({ ok: false, status: 400, body: { error: 'bad_request', message } });
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function idOf(p) {
  const id = typeof p?.id === 'string' ? p.id.trim() : '';
  if (!id || !ID_RE.test(id) || id.length > CTA_LIMITS.id) return null;
  return id;
}
// The text fields, each bounded by the core's cap. `null`/'' on an update clears an optional one. On add only
// the label and partner are required here; the core decides what else the card's layout needs.
const TEXT_FIELDS = ['label', 'line', 'button', 'destination', 'partner', 'note', 'layout', 'html'];
const REQUIRED_ON_ADD = ['label', 'partner'];
const LAYOUT_MAX = 16;
function textFields(p, { required }) {
  const out = {};
  for (const k of TEXT_FIELDS) {
    const v = p?.[k];
    const need = required && REQUIRED_ON_ADD.includes(k);
    if (v === undefined || v === null) { if (need) return bad(`${k} is required`); if (v === null && !required) out[k] = null; continue; }
    if (typeof v !== 'string') return bad(`${k} must be a string`);
    const t = v.trim();
    const max = k === 'layout' ? LAYOUT_MAX : CTA_LIMITS[k];
    if (t.length > max) return bad(`${k} is too long (max ${max} chars)`);
    if (!t && need) return bad(`${k} is required`);
    out[k] = t;
  }
  return { ok: true, fields: out };
}
// The structured parts. Shape and size are bounded here so an oversized body is refused before any GitHub read;
// what an icon may contain and what a host may look like is the core's rule. `null` on an update clears the part.
function partFields(p, { required }) {
  const out = {};
  if (p?.icon !== undefined) {
    if (p.icon === null) { if (!required) out.icon = null; }
    else if (typeof p.icon !== 'object' || Array.isArray(p.icon)) return bad('icon must be an icon object');
    else if (JSON.stringify(p.icon).length > ICON_LIMITS.total + 4000) return bad('the icon is too large');
    else out.icon = p.icon;
  }
  if (p?.hosts !== undefined) {
    if (p.hosts === null) { if (!required) out.hosts = null; }
    else if (!Array.isArray(p.hosts) || p.hosts.length > CTA_LIMITS.hosts || p.hosts.some((h) => typeof h !== 'string' || h.length > CTA_LIMITS.host)) return bad(`hosts must be a list of at most ${CTA_LIMITS.hosts} https origins`);
    else out.hosts = p.hosts.map((h) => h.trim());
  }
  if (p?.showTitle !== undefined) {
    if (p.showTitle === null) { if (!required) out.showTitle = null; }
    else if (typeof p.showTitle !== 'boolean') return bad('showTitle must be true or false');
    else out.showTitle = p.showTitle;
  }
  return { ok: true, fields: out };
}
/** The text, parts and image of an add or update, merged into one { args, upload } or a 400. */
function cardFields(p, id, { required }) {
  const t = textFields(p, { required });
  if (!t.ok) return t;
  const parts = partFields(p, { required });
  if (!parts.ok) return parts;
  const img = ctaImageUpload({ id, imageBase64: p?.imageBase64, removeImage: p?.removeImage });
  if (!img.ok) return bad(img.problem);
  if (required && img.fields.image === null) return bad('a new CTA has no image to remove');
  return { ok: true, fields: { ...t.fields, ...parts.fields, ...img.fields }, upload: img.upload };
}

/** cta-add: the id, label and partner, any other field or part, an optional image, an optional boolean enabled. */
export function ctaAddInput(p) {
  const id = idOf(p);
  if (!id) return bad(`a kebab-case id is required (max ${CTA_LIMITS.id} chars)`);
  const c = cardFields(p, id, { required: true });
  if (!c.ok) return c;
  if (p?.enabled !== undefined && typeof p.enabled !== 'boolean') return bad('enabled must be true or false');
  return { ok: true, args: { id, ...c.fields, enabled: p?.enabled === true }, upload: c.upload };
}
/** cta-update: the id plus any field, part or image change. */
export function ctaUpdateInput(p) {
  const id = idOf(p);
  if (!id) return bad('a CTA id is required');
  const c = cardFields(p, id, { required: false });
  if (!c.ok) return c;
  if (!Object.keys(c.fields).length && !c.upload) return bad('nothing to update');
  return { ok: true, args: { id, ...c.fields }, upload: c.upload };
}
/** The files an add or update commits beside house/ctas.yml: the uploaded image, and the delete of an image no
 *  card names after the edit. The route rank-checks every path before it writes. */
export function ctaImageFiles(built, before, after) {
  return ctaImageFileChanges(before, after, built?.upload || null);
}
/** cta-toggle: the id plus a real boolean. */
export function ctaToggleInput(p) {
  const id = idOf(p);
  if (!id) return bad('a CTA id is required');
  if (typeof p?.enabled !== 'boolean') return bad('enabled must be true or false');
  return { ok: true, args: { id, enabled: p.enabled } };
}
/** cta-assign / cta-unassign: the id, a known item type, a well-formed ref. */
export function ctaAssignInput(p) {
  const id = idOf(p);
  if (!id) return bad('a CTA id is required');
  const type = typeof p?.type === 'string' ? p.type.trim() : '';
  if (!CTA_ITEM_TYPES.includes(type)) return bad(`type must be one of ${CTA_ITEM_TYPES.join(', ')}`);
  const ref = typeof p?.ref === 'string' ? p.ref.trim() : '';
  if (!validRef(type, ref)) return bad(type === 'share' ? 'ref must be author/id for a share' : 'ref must be the item slug');
  return { ok: true, args: { id, type, ref } };
}

/** The pool READ: the full registry from house/ctas.yml, disabled CTAs included. SUPERADMIN (cookie or bearer),
 *  read-only, fail-closed; a GET carries no CSRF. */
export async function membershipAdminCtaPool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeSuperadmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const who = await authorize(request, env, { ...deps, allowCookie });
  if (!who.ok) return { status: who.status, body: who.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, CTAS_PATH);
  if (!load.ok) return { status: load.status, body: load.body };
  return { status: 200, body: { ok: true, ctas: ctasOf(load.parsed), types: [...CTA_ITEM_TYPES] } };
}
