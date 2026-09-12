// sow-185: the PURE parser + validator for the tier DISPLAY data (house/membership-tiers.yml). Node-free and
// dependency-free (like membership/tiers.mjs and membership/topics-vocab.mjs), so the Astro build
// (src/lib/tiers.ts) AND scripts/validate-content.mjs share ONE shape definition and never disagree. This carries
// ONLY presentation data (label, tagline, prices, benefit bullets, revenue copy) plus the price-id ENV VAR NAMES
// for the phase-3b checkout allowlist. The tier IDENTITY + ranking + price-id->tier resolution live in
// membership/tiers.mjs (the gating axis), and the actual Stripe price ids live in the Worker env. The benefit
// copy is governed by sow-185 section 7: a tier may ship with unbuilt benefits removed, but it must never
// advertise a benefit that does not exist.
import { TIER, isTier } from './tiers.mjs';

// Every axis tier must appear, in canonical display order (free -> member -> creator).
export const TIER_ORDER = Object.freeze([TIER.none, TIER.member, TIER.creator]);

export class TierDisplayError extends Error {
  constructor(message) { super(message); this.name = 'TierDisplayError'; }
}

/**
 * A benefit is either a bare string or `{ label, description }`, and BOTH normalize to the object form so
 * every consumer reads one shape. The string form stays valid on purpose: most surfaces (the pricing
 * accordion, the membership table) render a one-line bullet and have nothing to do with a description, so
 * requiring one everywhere would be churn for no reader.
 *
 * WHY A DESCRIPTION BELONGS HERE AND NOT ON THE PAGE THAT SHOWS IT. sow-230: a member-tier invite went live
 * advertising Creator benefits because its benefit prose was hand-written into the page and inherited from
 * the page it was copied from. The fix was to render benefits from this file, so no page types a benefit
 * sentence. A design then asked for a headline plus a supporting line per benefit, and the tempting shortcut
 * was to write those lines into the template, which would have reopened exactly that hole one field over.
 * The description is benefit copy, it is a legal line under this file's own header rule, and it lives where
 * the rest of the benefit copy is reviewed.
 */
function normalizeBenefit(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return Object.freeze({
      label: String(raw.label ?? '').trim(),
      description: String(raw.description ?? '').trim(),
    });
  }
  return Object.freeze({ label: String(raw ?? '').trim(), description: '' });
}

function normalizeTier(raw, i) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new TierDisplayError(`tiers[${i}] must be an object`);
  const key = String(raw.key ?? '');
  if (!isTier(key)) throw new TierDisplayError(`tiers[${i}].key "${key}" is not a valid tier (none|member|creator)`);
  const label = String(raw.label ?? '').trim();
  if (!label) throw new TierDisplayError(`${key}: label is required`);
  const priceMonthly = Number(raw.priceMonthly);
  const priceAnnual = Number(raw.priceAnnual);
  if (!Number.isFinite(priceMonthly) || priceMonthly < 0) throw new TierDisplayError(`${key}: priceMonthly must be a number >= 0`);
  if (!Number.isFinite(priceAnnual) || priceAnnual < 0) throw new TierDisplayError(`${key}: priceAnnual must be a number >= 0`);
  const benefits = Array.isArray(raw.benefits) ? raw.benefits.map(normalizeBenefit).filter((b) => b.label) : [];
  if (benefits.length === 0) throw new TierDisplayError(`${key}: benefits[] must be a non-empty list`);
  const rawEnv = raw.priceEnv && typeof raw.priceEnv === 'object' && !Array.isArray(raw.priceEnv) ? raw.priceEnv : {};
  const priceEnv = Object.freeze({
    ...(rawEnv.monthly ? { monthly: String(rawEnv.monthly) } : {}),
    ...(rawEnv.annual ? { annual: String(rawEnv.annual) } : {}),
  });
  // A purchasable price MUST name its Stripe price-id env var, or the checkout allowlist (phase 3b) has no id to
  // validate the requested tier+period against.
  if (priceMonthly > 0 && !priceEnv.monthly) throw new TierDisplayError(`${key}: priceMonthly is set but priceEnv.monthly is missing`);
  if (priceAnnual > 0 && !priceEnv.annual) throw new TierDisplayError(`${key}: priceAnnual is set but priceEnv.annual is missing`);
  return Object.freeze({
    key,
    label,
    tagline: String(raw.tagline ?? '').trim(),
    priceMonthly,
    priceAnnual,
    priceEnv,
    benefits: Object.freeze(benefits),
    revenue: String(raw.revenue ?? '').trim(),
    // sow-323: is this tier OFFERED for sale today? The owner collapsed the two paid plans into one on
    // 2026-09-12, so `creator` stays in the file (its label still names the tier existing grants carry, staff
    // resolve to it, and the legacy Stripe price maps to it) but no card offers it. Default TRUE, so every
    // existing entry and every future one is offered unless it says otherwise.
    //
    // It has to be read HERE or it does nothing: this function builds a frozen record from a fixed field list,
    // so an `offered:` key in the yaml that the normaliser does not know about is dropped without a word, and
    // the cards would keep selling a plan nobody can buy while the file said otherwise.
    offered: raw.offered !== false,
  });
}

/**
 * Parse the raw yaml object (`{ tiers: [...] }`) into a frozen, canonically-ordered array of tier display
 * records. Pure. Throws TierDisplayError when the file lacks a `tiers:` list, a tier is duplicated or unknown, an
 * axis tier is missing, or a field is malformed.
 */
export function parseTierDisplay(raw) {
  const list = raw && Array.isArray(raw.tiers) ? raw.tiers : null;
  if (!list) throw new TierDisplayError('the tier file must have a top-level `tiers:` list');
  const byKey = new Map();
  list.forEach((t, i) => {
    const rec = normalizeTier(t, i);
    if (byKey.has(rec.key)) throw new TierDisplayError(`duplicate tier key "${rec.key}"`);
    byKey.set(rec.key, rec);
  });
  for (const k of TIER_ORDER) {
    if (!byKey.has(k)) throw new TierDisplayError(`the tier file is missing the "${k}" tier`);
  }
  return Object.freeze(TIER_ORDER.map((k) => byKey.get(k)));
}

/**
 * sow-323: a revenue line split into plain text and at most one inline [text](url) link.
 *
 * MOVED HERE from src/components/membership/MembershipTiers.astro, which had it while the homepage pricing
 * accordion rendered the same registry string as plain text. The Curator card's line is
 * `Curators participate in the greater [revenue program](/revenue-model/).`, so the live homepage showed the
 * brackets and the URL to every visitor. One function, both renderers, and the copy still lives in the yaml.
 *
 * @returns Array<{ text: string, href?: string }>
 */
export function revenueFragments(s) {
  const str = String(s ?? '');
  const m = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(str);
  if (!m) return str ? [{ text: str }] : [];
  const out = [];
  if (m.index > 0) out.push({ text: str.slice(0, m.index) });
  out.push({ text: m[1], href: m[2] });
  const tail = str.slice(m.index + m[0].length);
  if (tail) out.push({ text: tail });
  return out;
}

/**
 * sow-323: the tiers a PRICING surface may offer, in canonical order. Every axis tier still has to be present
 * in the file (parseTierDisplay enforces that, because the axis is what gates), but only these are for sale.
 *
 * At least one paid tier must be offered, or the site would show a Free card and nothing to buy. That is a
 * configuration mistake rather than a design, so it throws instead of rendering an empty pricing section.
 */
export function offeredTiers(parsed) {
  const list = Array.isArray(parsed) ? parsed.filter((t) => t && t.offered !== false) : [];
  const paid = list.filter((t) => t.priceAnnual > 0 || t.priceMonthly > 0);
  if (!paid.length) throw new TierDisplayError('no paid tier is offered: at least one must have `offered` unset or true');
  return Object.freeze(list);
}

/** Boolean form for CI (scripts/validate-content.mjs): { ok, error }. Never throws. */
export function validateTierDisplay(raw) {
  try { parseTierDisplay(raw); return { ok: true, error: null }; }
  catch (e) { return { ok: false, error: e instanceof TierDisplayError ? e.message : String(e?.message || e) }; }
}

/**
 * Proper nouns a benefit label may legitimately start with. `leadLower` leaves these alone, because
 * "discord access" and "gitHub" are wrong in a way a reader notices immediately.
 */
const PROPER_LEAD = /^(Discord|GitHub|Stripe|Shares|AI|MCP)\b/;

/**
 * Lower the first character so a label reads inside a sentence: "Full Discord access" -> "full Discord access".
 * Only when the label starts capital-then-lowercase and does not open with a proper noun, so an acronym
 * ("AI review") and a brand ("Discord access") both survive untouched.
 */
function leadLower(s) {
  if (PROPER_LEAD.test(s)) return s;
  return /^[A-Z][a-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s;
}

/**
 * One tier's benefit LABELS as a clause for a sentence, e.g.
 *   "post comments across the network; full Discord access; and see the member-only Shares stream"
 *
 * WHY THIS IS HERE AND NOT IN THE PAGE THAT SHOWS IT. Exactly the reason the `description` field above gives,
 * one field over. The membership FAQ hand-wrote this sentence, and it went on selling "Curate your feed" as a
 * Network Member benefit for eight days after the owner ruled it out (2026-08-18), on a page whose other two
 * answers tell the reader the personalized feed is free. A page that TYPES a benefit sentence is a page that
 * can contradict this file; a page that composes one from here cannot. sow-201 / sow-185 section 7.
 *
 * The separator is a SEMICOLON, not a comma: benefit labels carry their own internal commas ("Publish
 * articles, projects, and prompts"), so a comma-joined list reads as one long undifferentiated run.
 */
export function benefitProse(tier) {
  const items = (tier?.benefits || [])
    .map((b) => leadLower(String(b?.label ?? '').trim()))
    .filter(Boolean);
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  return `${items.slice(0, -1).join('; ')}; and ${items[items.length - 1]}`;
}
