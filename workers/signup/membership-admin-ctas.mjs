// sow-281: the Worker half of the CTA registry (house/ctas.yml): the SUPERADMIN pool read and the input validators
// for the five write ops (cta-add / cta-update / cta-toggle / cta-assign / cta-unassign). The ops themselves are
// rows in membership-admin-author.mjs's CONFIG_OP table (the file is at the size cap, so the validators live here)
// with rank: ROLE_RANK.superadmin; the second authority is the CODEOWNERS pin on house/ctas.yml. The validators
// bound the wire shapes to exactly the caps the pure core enforces (CTA_LIMITS), so a malformed request costs no
// GitHub read; the core (membership/cta-edits.mjs) is what refuses a bad destination or the Amazon rule.
import { authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { loadHouseYaml } from './membership-admin-author.mjs';
import { CTA_ITEM_TYPES, CTA_LIMITS, validRef, ctasOf } from '../../membership/cta-edits.mjs';

export const CTAS_PATH = 'house/ctas.yml';

const bad = (message) => ({ ok: false, status: 400, body: { error: 'bad_request', message } });
const ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function idOf(p) {
  const id = typeof p?.id === 'string' ? p.id.trim() : '';
  if (!id || !ID_RE.test(id) || id.length > CTA_LIMITS.id) return null;
  return id;
}
// The optional text fields, each bounded by the core's cap. `null`/'' on an update clears the note.
const TEXT_FIELDS = ['label', 'line', 'button', 'destination', 'partner', 'note'];
function textFields(p, { required }) {
  const out = {};
  for (const k of TEXT_FIELDS) {
    const v = p?.[k];
    if (v === undefined || v === null) { if (required && k !== 'note') return bad(`${k} is required`); continue; }
    if (typeof v !== 'string') return bad(`${k} must be a string`);
    const t = v.trim();
    if (t.length > CTA_LIMITS[k]) return bad(`${k} is too long (max ${CTA_LIMITS[k]} chars)`);
    if (!t && required && k !== 'note') return bad(`${k} is required`);
    out[k] = t;
  }
  return { ok: true, fields: out };
}

/** cta-add: every text field, an optional boolean enabled. */
export function ctaAddInput(p) {
  const id = idOf(p);
  if (!id) return bad(`a kebab-case id is required (max ${CTA_LIMITS.id} chars)`);
  const t = textFields(p, { required: true });
  if (!t.ok) return t;
  if (p?.enabled !== undefined && typeof p.enabled !== 'boolean') return bad('enabled must be true or false');
  return { ok: true, args: { id, ...t.fields, enabled: p?.enabled === true } };
}
/** cta-update: the id plus any of the text fields. */
export function ctaUpdateInput(p) {
  const id = idOf(p);
  if (!id) return bad('a CTA id is required');
  const t = textFields(p, { required: false });
  if (!t.ok) return t;
  if (!Object.keys(t.fields).length) return bad('nothing to update');
  return { ok: true, args: { id, ...t.fields } };
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
