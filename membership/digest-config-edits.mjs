// sow-266 Phase 2: the PURE edit core for house/digest-config.yml, the digest's membership pitch and its
// sponsor slot. Given the PARSED document plus an action, returns { next, changed, audit }: `next` is the new
// parsed doc (the caller serializes it and commits it through the SOW-005 PR flow), `changed` is false when the
// action is already satisfied, and `audit` is an identity-minimal entry folded into the PR body. Node-free, so
// the Worker, the client and the tests all run this one module. The same shape as
// membership/site-settings-edits.mjs beside it; deliberately not a new mechanism.
//
// SECURITY: this only COMPUTES the edit. Authorization is CODEOWNERS (house/digest-config.yml is pinned to the
// two superadmins), no-bypass branch protection, and the metadata-only gate. A non-superadmin PR touching this
// file is auto-rejected whatever this computes, so the manager's superadmin check is a convenience and the gate
// is the boundary.
//
// THE COPY RULES WARN, THEY DO NOT REFUSE (owner, 2026-09-19). Length, link count and claiming a free feature
// as a membership benefit are all reported by ctaWarnings and SAVED ANYWAY. So nothing here rejects copy for
// being bad copy. What it does reject is copy that is not copy: a non-string, or a value so long that it is an
// attempt at something else. Those caps are abuse bounds on a file that lands in a public repository, not
// editorial judgement, and they sit far above anything a person would type.
//
// A BAD LINK CANNOT REACH AN INBOX EITHER WAY. The renderer resolves the destination through safeUrl, which
// accepts a site-relative path or http(s) and returns nothing for anything else, so a `javascript:` value
// renders an empty href rather than a live one. It is still reported as a warning, because a link that silently
// goes nowhere is its own defect.
//
// THE KEYS IN THE FILE ARE snake_case AND THE KEYS ON THE WIRE ARE camelCase. house/digest-config.yml is read
// by a person, and the resolved settings are read by code, so the two spellings exist on purpose and this
// module is the one place that translates between them. Getting it wrong silently writes a field nothing reads.

export class DigestConfigEditError extends Error {}

/** Abuse bounds, not editorial limits. See the note above: the editorial limits warn and do not block. */
export const DIGEST_LIMITS = Object.freeze({
  body: 1000,
  linkLabel: 120,
  linkUrl: 500,
  sponsorHtml: 4000,
});

/** Wire field -> file field, for the pitch. The one place the two spellings meet. */
const CTA_FIELDS = Object.freeze([
  ['body', 'body', DIGEST_LIMITS.body],
  ['linkLabel', 'link_label', DIGEST_LIMITS.linkLabel],
  ['linkUrl', 'link_url', DIGEST_LIMITS.linkUrl],
]);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new DigestConfigEditError('invalid timestamp');
  return d.toISOString();
}

/** Identity-minimal audit entry, the SOW-024/038/055/056/063/271 shape. Keyed by the block, not by a person. */
function auditEntry(ctx, action, block, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a
      ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null }
      : null,
    action,
    target: { block },
    detail: detail ?? null,
  };
}

/** A parsed doc with both blocks present, so an edit never has to care whether the file was empty. */
function clean(doc) {
  const d = structuredClone(isObj(doc) ? doc : {});
  if (!isObj(d.cta)) d.cta = {};
  if (!isObj(d.sponsor)) d.sponsor = {};
  if (!isObj(d.optin)) d.optin = {}; // sow-270
  return d;
}

/**
 * Normalize one text field. `undefined` means LEAVE IT ALONE, which is what makes these edits patches and lets
 * the manager save the switch without resending the copy. An empty string is a real value and means "fall back
 * to the shipped wording for this field", which resolveDigestConfig implements, so it is kept rather than
 * treated as absent.
 */
function textField(value, label, max) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new DigestConfigEditError(`${label} must be text`);
  const trimmed = value.trim();
  if (trimmed.length > max) throw new DigestConfigEditError(`${label} is ${trimmed.length} characters and the limit is ${max}`);
  return trimmed;
}

function boolField(value, label) {
  if (value === undefined) return undefined;
  // NOT a coercion. "false" is truthy in JavaScript, so accepting a string here is how a switch reads as OFF in
  // the file and renders ON in the mail, which is the exact failure the sponsor slot must never have.
  if (typeof value !== 'boolean') throw new DigestConfigEditError(`${label} must be true or false`);
  return value;
}

/**
 * SET the membership pitch: any of the switch, the body, the link label and the link destination.
 *
 * Idempotent per field, and idempotent as a whole: an edit that changes nothing returns changed:false and the
 * caller opens no pull request. That matters more here than for a toggle, because the manager saves all four
 * fields together and three of them are usually untouched.
 */
export function setDigestCta(doc, args = {}, ctx = {}) {
  const d = clean(doc);
  const enabled = boolField(args.enabled, 'The pitch switch');
  const text = CTA_FIELDS.map(([wire, file, max]) => [file, textField(args[wire], labelFor(wire), max)]);
  if (enabled === undefined && text.every(([, v]) => v === undefined)) {
    throw new DigestConfigEditError('nothing to change: send at least one of enabled, body, linkLabel or linkUrl');
  }

  const before = { enabled: d.cta.enabled, ...Object.fromEntries(CTA_FIELDS.map(([, file]) => [file, d.cta[file]])) };
  let changed = false;
  if (enabled !== undefined && d.cta.enabled !== enabled) { d.cta.enabled = enabled; changed = true; }
  for (const [file, value] of text) {
    if (value === undefined) continue;
    if (d.cta[file] === value) continue;
    d.cta[file] = value;
    changed = true;
  }
  const after = { enabled: d.cta.enabled, ...Object.fromEntries(CTA_FIELDS.map(([, file]) => [file, d.cta[file]])) };
  return { next: d, changed, audit: auditEntry(ctx, 'digest-cta.set', 'cta', changed ? { fields: changedFields(before, after) } : { noop: true }) };
}

/**
 * SET the sponsor slot: the switch, the markup, or both.
 *
 * THE SWITCH IS WRITTEN EVEN WHEN IT IS FALSE, which is why this does not treat false as absent. False is the
 * setting that turns the slot off, an omitted key resolves to the same thing, and the difference matters to the
 * person reading the file: an explicit `enabled: false` says somebody decided, and a missing key says nobody
 * has looked. The mirror carries it for the same reason.
 *
 * The markup is NOT sanitized here. It is sanitized at render (membership/mail-sponsor-sanitize.mjs), because
 * what is stored is what the sponsor supplied and what is sent is what survives the allowlist. Sanitizing on
 * the way in would make the stored value a lie about what was agreed, and would silently rewrite the file under
 * a superadmin who pasted something and then could not find it again.
 */
export function setDigestSponsor(doc, args = {}, ctx = {}) {
  const d = clean(doc);
  const enabled = boolField(args.enabled, 'The sponsor switch');
  const html = textField(args.html, 'The sponsor markup', DIGEST_LIMITS.sponsorHtml);
  if (enabled === undefined && html === undefined) {
    throw new DigestConfigEditError('nothing to change: send at least one of enabled or html');
  }

  let changed = false;
  const was = { enabled: d.sponsor.enabled, html: d.sponsor.html };
  if (enabled !== undefined && d.sponsor.enabled !== enabled) { d.sponsor.enabled = enabled; changed = true; }
  if (html !== undefined && d.sponsor.html !== html) { d.sponsor.html = html; changed = true; }
  return {
    next: d,
    changed,
    audit: auditEntry(ctx, 'digest-sponsor.set', 'sponsor', changed
      // The markup itself is NOT in the audit. It is a third party's copy, the PR diff already shows it, and a
      // log line is the wrong place to duplicate something that can be long.
      ? { enabled: d.sponsor.enabled === true, markupChanged: html !== undefined && html !== was.html, markupLength: String(d.sponsor.html ?? '').length }
      : { noop: true }),
  };
}

/**
 * sow-270: turn the subscribe confirmation on or off.
 *
 * WHAT THIS SWITCH ACTUALLY DECIDES, because it is not a display preference. With it ON a new address is held
 * unconfirmed for 48 hours and is enrolled only if somebody clicks the link in a confirmation email. With it
 * OFF the address is enrolled the moment the form is submitted, and no confirmation is sent. It is the record
 * of what a stranger consented to, which is why it is superadmin and why the audit carries the value.
 *
 * Written even when it does not change the effective behaviour, for the reason the sponsor switch is: an
 * explicit `double: false` says somebody decided, and a missing key says nobody has looked. They resolve the
 * same and they read differently, and the reading is the point.
 */
export function setDigestOptin(doc, args = {}, ctx = {}) {
  const d = clean(doc);
  const double = boolField(args.double, 'The confirmation switch');
  if (double === undefined) throw new DigestConfigEditError('nothing to change: send double as true or false');
  const changed = d.optin.double !== double;
  if (changed) d.optin.double = double;
  return {
    next: d,
    changed,
    audit: auditEntry(ctx, 'digest-optin.set', 'optin', changed ? { double } : { noop: true }),
  };
}

function labelFor(wire) {
  return { body: 'The pitch body', linkLabel: 'The link label', linkUrl: 'The link destination' }[wire] || wire;
}

/** Which keys actually moved, for the audit. Names only, so the entry stays short whatever the copy is. */
function changedFields(before, after) {
  return Object.keys(after).filter((k) => before[k] !== after[k]);
}

/**
 * Read the two blocks back out for the manager, in the WIRE spelling, exactly as stored.
 *
 * NOT resolveDigestConfig: that one applies the shipped fallbacks, which is right for rendering and wrong for
 * an editor. A superadmin opening an empty body needs to see it empty, so that saving does not silently pin
 * today's default copy into the file and freeze it there the next time the default changes.
 */
export function readDigestConfig(doc) {
  const d = clean(doc);
  const cta = { enabled: typeof d.cta.enabled === 'boolean' ? d.cta.enabled : null };
  for (const [wire, file] of CTA_FIELDS) cta[wire] = typeof d.cta[file] === 'string' ? d.cta[file] : '';
  return {
    cta,
    sponsor: {
      enabled: typeof d.sponsor.enabled === 'boolean' ? d.sponsor.enabled : null,
      html: typeof d.sponsor.html === 'string' ? d.sponsor.html : '',
    },
    // sow-270: null means nobody has set it, which the manager shows differently from a chosen off. Both
    // behave as off; only the label differs.
    optin: { double: typeof d.optin.double === 'boolean' ? d.optin.double : null },
  };
}
