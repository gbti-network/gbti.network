// sow-266 Phase 1: the digest's editable settings. The membership pitch copy, and the sponsor slot.
//
// WHY THIS EXISTS. Both were hardcoded: the pitch as a string literal inside the renderer, the sponsor as an
// absence three shipped artifacts asserted. The owner asked to control the copy, fill a sponsor slot, and
// switch the whole sponsorship side off, without a deploy each time.
//
// THE PATTERN IS house/mail-settings.yml, EXACTLY. A git-native house file, superadmin-owned through
// CODEOWNERS and membership/path-rank.mjs, mirrored to KV by reconcile (and on demand by the sync-mirror
// action), read live by the Worker at compile time. Edit, push, and the next sync applies it with no redeploy.
//
// FAIL-SAFE MEANS "WHAT SHIPS TODAY", NOT "NOTHING". A missing mirror, a malformed one, or a blank field
// resolves to the copy currently compiled into the renderer, because an issue that goes out with no pitch at
// all is a worse failure than one that goes out with last month's wording. The sponsor is the opposite
// direction and for the same reason: absent means OFF, because rendering someone's advertisement by accident
// is not recoverable.
//
// Node-free: the Worker, the client and the tests all run this same module.

/** The KV key reconcile writes and the Worker's compile reads. */
export const DIGEST_CONFIG_KV_KEY = 'digest:config';

/**
 * The pitch copy that ships in the renderer today, reproduced here as the fail-safe.
 *
 * `{plan}` IS A BINDING, NOT A WORD. sow-323 collapsed the two paid plans and the copy names the plan by
 * binding to the tier table rather than spelling it, so a rename cannot leave a stale name in the mail. The
 * renderer substitutes it. A superadmin who deletes the token gets a warning (see ctaWarnings) rather than a
 * refusal, because the owner ruled on 2026-09-19 that these limits warn and do not block.
 */
export const DEFAULT_CTA = Object.freeze({
  enabled: true,
  body: 'A {plan} membership adds comments on any item, the members Discord, and publishing your own articles, projects and prompts: members first, public after editorial review.',
  linkLabel: 'What membership includes',
  linkUrl: '/membership/',
});

/** Absent means OFF. Rendering an advertisement by accident is not a recoverable mistake. */
export const DEFAULT_SPONSOR = Object.freeze({ enabled: false, html: '' });

/**
 * The three rules the pitch is held to. They were assertions on a literal; now that the copy is typed, they
 * are ALSO checks on what gets typed. Owner 2026-09-19: warn, do not block.
 *
 *   maxVisibleChars  the rendered pitch stays small beside the editorial content
 *   maxLinks         one link, so the pitch reads as a note rather than a menu
 *   forbiddenClaims  a benefit a FREE signed-in account already has is not a membership benefit. Collections
 *                    and favourites are free (the activity route authorizes any signed-in member), and the
 *                    design mockup claims them in two places, so a re-derivation reintroduces the error.
 */
export const CTA_RULES = Object.freeze({
  maxVisibleChars: 220,
  maxLinks: 1,
  forbiddenClaims: Object.freeze(['collections', 'favorites', 'favourites']),
});

const str = (v) => (typeof v === 'string' ? v : '');
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);

/** Visible characters of a pitch body: what a reader sees, with the plan token counted as the word it becomes. */
export function ctaVisibleLength(body, planLabel = 'Network Supporter') {
  return str(body).replace(/\{plan\}/g, planLabel).trim().length;
}

/**
 * What is wrong with this pitch copy, as a list of plain sentences. Empty means nothing is wrong.
 *
 * PURE, and shared by the manager (which shows them as you type) and the tests (which assert the shipped
 * default has none). One implementation, so the warning a superadmin reads is the rule the tests check.
 */
export function ctaWarnings(cta = {}, { planLabel = 'Network Supporter' } = {}) {
  const out = [];
  const body = str(cta.body);
  const label = str(cta.linkLabel);
  const url = str(cta.linkUrl);

  if (!body.trim()) out.push('The pitch has no text, so nothing will render.');
  const visible = ctaVisibleLength(body, planLabel) + label.trim().length;
  if (visible > CTA_RULES.maxVisibleChars) {
    out.push(`The pitch is ${visible} characters and the limit is ${CTA_RULES.maxVisibleChars}. It will render longer than intended beside the articles.`);
  }
  // A second link in the BODY. The one link is the label beside it, so any markup or bare URL here is extra.
  const bodyLinks = (body.match(/<a\b/gi) || []).length + (body.match(/https?:\/\//gi) || []).length;
  if (bodyLinks > 0) out.push('The pitch body carries its own link. There is one link already, the one beside it, so this makes two.');
  if (!label.trim()) out.push('The link has no label, so there is nothing for a reader to click.');
  if (!url.trim()) out.push('The link has no destination.');
  else if (!/^(\/|https:\/\/)/.test(url.trim())) out.push('The link must start with / or https://.');

  const lower = `${body} ${label}`.toLowerCase();
  for (const claim of CTA_RULES.forbiddenClaims) {
    if (lower.includes(claim)) {
      out.push(`"${claim}" is something a free account already has, so naming it as a membership benefit is not true.`);
      break;
    }
  }
  // The project's own writing convention, and a superadmin can now type one straight into an email.
  if (/[—–]/.test(`${body}${label}`)) out.push('There is a dash here that our writing conventions do not use. A comma, a colon or a full stop reads better.');
  return out;
}

/**
 * Project the parsed house/digest-config.yml into the mirror body.
 *
 * Every field is optional and an unusable one is simply omitted, so the Worker falls through to the shipped
 * default for THAT field alone rather than for the whole block. Same reasoning as the mail caps: setting one
 * thing must not silently reset the others.
 */
export function buildDigestConfigMirror(raw, now = new Date()) {
  const src = isObj(raw) ? raw : {};
  const cta = isObj(src.cta) ? src.cta : {};
  const sponsor = isObj(src.sponsor) ? src.sponsor : {};
  const out = { generatedAt: now.toISOString(), cta: {}, sponsor: {} };

  if (typeof cta.enabled === 'boolean') out.cta.enabled = cta.enabled;
  for (const [from, to] of [['body', 'body'], ['link_label', 'linkLabel'], ['link_url', 'linkUrl']]) {
    const v = str(cta[from]).trim();
    if (v) out.cta[to] = v;
  }
  // The sponsor switch is carried even when false, because false is the setting that turns it OFF and an
  // omitted one would resolve to the default, which is also off. Carrying it makes the state legible in KV.
  if (typeof sponsor.enabled === 'boolean') out.sponsor.enabled = sponsor.enabled;
  const html = str(sponsor.html).trim();
  if (html) out.sponsor.html = html;
  return out;
}

/**
 * Resolve the live settings from the mirror, per field, with the shipped copy as the floor. PURE: the caller
 * passes the already-read mirror, so this is tested with plain objects and no KV.
 *
 * NO STALENESS BOUND, deliberately, for the reason house/mail-settings.yml has none: this is not derived
 * state. It is wording a person chose, and it is still that wording a month later. Expiring it would revert
 * an owner's edit silently.
 */
export function resolveDigestConfig({ mirror = null } = {}) {
  const m = isObj(mirror) ? mirror : {};
  const c = isObj(m.cta) ? m.cta : {};
  const s = isObj(m.sponsor) ? m.sponsor : {};
  const body = str(c.body).trim();
  const linkLabel = str(c.linkLabel).trim();
  const linkUrl = str(c.linkUrl).trim();
  const html = str(s.html).trim();
  return {
    cta: {
      enabled: bool(c.enabled, DEFAULT_CTA.enabled),
      body: body || DEFAULT_CTA.body,
      linkLabel: linkLabel || DEFAULT_CTA.linkLabel,
      linkUrl: linkUrl || DEFAULT_CTA.linkUrl,
      // Which fields came from the owner rather than the floor, so a diagnostic can say so without guessing.
      source: body || linkLabel || linkUrl || typeof c.enabled === 'boolean' ? 'config' : 'default',
    },
    sponsor: {
      // FAIL CLOSED, and this is the one field that must: enabled only when the mirror says true AND there is
      // something to render. `enabled: true` with empty markup renders a bare "Sponsored" label over nothing.
      enabled: bool(s.enabled, DEFAULT_SPONSOR.enabled) === true && html.length > 0,
      html,
    },
  };
}
