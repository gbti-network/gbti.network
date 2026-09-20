// sow-359: the Worker half of the tracked partner link store (house/outbound-links.yml): the input validators
// for the three write ops (outbound-add / outbound-update / outbound-status). The ops themselves are rows in
// membership-admin-author.mjs's CONFIG_OP table with rank: ROLE_RANK.superadmin, which is the tier the owner
// named in the request ("managed tracked links from superadmin"); the second authority is the CODEOWNERS pin
// on house/outbound-links.yml, and the third is SUPERADMIN_HOUSE_FILES, which the CONFIG_OP drift guard
// requires to agree with the hand-set rank here.
//
// These validators bound the WIRE shape only, so a malformed request costs no GitHub read. What a destination
// may look like is the pure core's call (membership/outbound-link-edits.mjs): it is the one place that knows
// a destination needs an explicit path before its query, and it refuses a duplicate path and an unknown one.
//
// There is no outbound-remove, and that is deliberate rather than unfinished: deleting a row turns a link in
// an old post into a 404. `outbound-status` with `retired` takes a link out of use while its redirect keeps
// answering.
import { LINK_STATUSES } from '../../membership/outbound-link-edits.mjs';

export const OUTBOUND_LINKS_PATH = 'house/outbound-links.yml';

const bad = (message) => ({ ok: false, status: 400, body: { error: 'bad_request', message } });

// The caps are the store's own shapes, kept loose here on purpose: the core owns the real rules and is the
// only place they should be stated, so these exist to keep a hostile payload from reaching a GitHub read.
const LIMITS = Object.freeze({ path: 200, destination: 500, partner: 40, note: 2000 });
const PATH_RE = /^\/[^\s?#]*$/;

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** The path a row is addressed by. Every op takes one, and it is never editable. */
function pathOf(p) {
  const v = text(p?.path);
  if (!v || !PATH_RE.test(v) || v.length > LIMITS.path) return null;
  return v;
}

/** The optional text fields an add or update may carry, each bounded. `null` on an update clears a note. */
function fieldsOf(p, { required }) {
  const out = {};
  for (const k of ['destination', 'partner', 'note']) {
    if (p?.[k] === undefined) continue;
    if (p[k] === null) {
      if (k !== 'note') return bad(`${k} cannot be cleared`);
      out.note = '';
      continue;
    }
    if (typeof p[k] !== 'string') return bad(`${k} must be text`);
    const v = p[k].trim();
    if (v.length > LIMITS[k]) return bad(`${k} is too long (max ${LIMITS[k]} chars)`);
    out[k] = v;
  }
  if (required) {
    if (!out.destination) return bad('a destination is required');
    if (!out.partner) return bad('a partner is required');
  }
  return { ok: true, fields: out };
}

/** outbound-add: a site path, a destination, a partner, an optional note and status. */
export function outboundAddInput(p) {
  const path = pathOf(p);
  if (!path) return bad('a site path is required, starting with / and carrying no query or fragment');
  const f = fieldsOf(p, { required: true });
  if (!f.ok) return f;
  if (p?.status !== undefined && !LINK_STATUSES.includes(p.status)) {
    return bad(`status must be one of ${LINK_STATUSES.join(', ')}`);
  }
  return { ok: true, args: { path, ...f.fields, ...(p?.status ? { status: p.status } : {}) } };
}

/** outbound-update: the path, plus whatever is being repointed or relabelled. The path itself never changes. */
export function outboundUpdateInput(p) {
  const path = pathOf(p);
  if (!path) return bad('a site path is required');
  const f = fieldsOf(p, { required: false });
  if (!f.ok) return f;
  // The specific message first: a caller reaching for `status` here wants the other op, and telling them
  // "nothing to update" would send them looking for a field that does not exist.
  if (p?.status !== undefined) return bad('use outbound-status to retire or restore a link');
  if (!Object.keys(f.fields).length) return bad('nothing to update');
  return { ok: true, args: { path, ...f.fields } };
}

/** outbound-status: the path plus one of the three statuses. Retiring keeps the redirect answering. */
export function outboundStatusInput(p) {
  const path = pathOf(p);
  if (!path) return bad('a site path is required');
  if (!LINK_STATUSES.includes(p?.status)) return bad(`status must be one of ${LINK_STATUSES.join(', ')}`);
  return { ok: true, args: { path, status: p.status } };
}
