// sow-271 Phase 1: the PURE site-settings edit core. Given the PARSED house/site-settings.yml
// ({ settings: { <key>: <boolean> } }) plus an action, returns { next, changed, audit } -- `next` is the new
// parsed doc (the caller serializes + commits it through the SOW-005 PR flow), `changed` is false when the
// action is already satisfied (idempotent), and `audit` is an identity-minimal log entry folded into the PR
// body. Node-free (no fs / no yaml) so it runs in the client, the Worker, and node tests. This is the same
// shape as membership/quote-edits.mjs and membership/news-source-edits.mjs; deliberately not a new mechanism.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (house/site-settings.yml
// is pinned to the two superadmins) + no-bypass branch protection + the metadata-only gate. A non-superadmin PR
// touching this file is auto-rejected regardless of what this computes, so the UI's superadmin check is a
// convenience and the gate is the boundary.

export class SiteSettingsEditError extends Error {}

// THE registry of valid site toggles. A key absent from here is REJECTED rather than written, because a
// typo'd toggle silently reads as its default and is indistinguishable from one that works -- the failure mode
// is a setting the owner believes they flipped. `fallback` is what the site does when the key is missing from
// the file entirely, and each is set to the behaviour that predates the toggle, so adding a key to this
// registry never changes the site until someone actually writes a value.
export const SITE_TOGGLES = {
  extension_cta: {
    label: 'Chrome extension call to action',
    // Shown in the manager UI. Says what the switch governs AND what it deliberately does not, because the
    // distinction is the whole reason this toggle is narrow (see sow-271: adverts are not capability notices).
    description: 'The header nav item, the homepage Add-to-Chrome banner, the sign-in modal footnote, and the archived v1 homepage button. Does NOT hide the "Extension required" notices that explain a control the extension implements, and does not take the /extension/ install page down.',
    fallback: true,
  },
};

export const TOGGLE_KEYS = Object.keys(SITE_TOGGLES);

const normKey = (k) => String(k || '').trim().toLowerCase();

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new SiteSettingsEditError('invalid timestamp');
  return d.toISOString();
}

/** Identity-minimal audit entry (the SOW-024/038/055/056/063 shape), keyed by the toggle rather than a github_id. */
function auditEntry(ctx, action, key, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { key },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.settings || typeof d.settings !== 'object' || Array.isArray(d.settings)) d.settings = {};
  return d;
}

/**
 * Read one toggle out of a parsed doc, falling back to the registry default when the key is absent. Shared by
 * the build loader and the manager so the two can never disagree about what "not set" means. A NON-BOOLEAN
 * stored value is a hard error rather than a coercion: `enabled: "false"` is truthy in JS, so coercing it would
 * silently leave a surface switched ON while the file reads as OFF, which is the exact failure this guards.
 */
export function readToggle(doc, key) {
  const k = normKey(key);
  const spec = SITE_TOGGLES[k];
  if (!spec) throw new SiteSettingsEditError(`unknown site setting: ${key}`);
  const raw = clean(doc).settings[k];
  if (raw === undefined || raw === null) return spec.fallback;
  if (typeof raw !== 'boolean') throw new SiteSettingsEditError(`site setting ${k} must be true or false, got ${typeof raw}`);
  return raw;
}

/** Every toggle resolved to a boolean, for the manager UI and the build. */
export function readAllToggles(doc) {
  return Object.fromEntries(TOGGLE_KEYS.map((k) => [k, readToggle(doc, k)]));
}

/**
 * Reject any key in the file that this build does not know about. Called by the build loader so a stale or
 * hand-edited file fails LOUDLY instead of carrying a setting nothing reads.
 */
export function unknownKeys(doc) {
  return Object.keys(clean(doc).settings).filter((k) => !SITE_TOGGLES[normKey(k)]);
}

/** SET a toggle on or off. Idempotent: setting it to the value it already has is a no-op. */
export function setSiteToggle(doc, { key, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const k = normKey(key);
  if (!SITE_TOGGLES[k]) throw new SiteSettingsEditError(`unknown site setting: ${key || '(none)'}`);
  if (typeof enabled !== 'boolean') throw new SiteSettingsEditError('enabled must be true or false');
  // Compare against the RESOLVED current value, not the raw stored one, so writing the fallback explicitly
  // into a file that omitted the key still counts as a change (it pins the value) while a genuine repeat does
  // not. readToggle also throws here on a corrupt stored value, which is the right moment to find out.
  const current = readToggle(d, k);
  const alreadyPinned = Object.prototype.hasOwnProperty.call(d.settings, k);
  if (current === enabled && alreadyPinned) {
    return { next: d, changed: false, audit: auditEntry(ctx, 'site-setting.set', k, { noop: true, enabled }) };
  }
  d.settings[k] = enabled;
  return { next: d, changed: true, audit: auditEntry(ctx, 'site-setting.set', k, { enabled, was: current }) };
}
