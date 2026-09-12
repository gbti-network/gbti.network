// sow-185: tier access for the site, in ONE import. Mirrors src/lib/taxonomy.ts: reads house/membership-tiers.yml
// once at build via js-yaml, through the shared pure parser membership/tiers-display.mjs, AND re-exports the tier
// AXIS (identity + ranking + membership test) from membership/tiers.mjs so a component gets both "what tiers
// exist / how they rank" and "how to display them" from a single module. The sow-192 homepage pricing accordion
// and the Your-membership / Upgrade rail cards bind to TIER_DISPLAY; the gating side (sow-185) consumes the same
// yml + axis, so the site and the server can never disagree on the tier model.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseTierDisplay, offeredTiers as sharedOfferedTiers } from '../../membership/tiers-display.mjs';

// sow-201: benefit copy composed into a SENTENCE, for prose surfaces (the membership FAQ) that would otherwise
// hand-write it and drift from the registry. Re-exported here so a page gets display data and prose in one import.
export { benefitProse } from '../../membership/tiers-display.mjs';

// sow-323: revenueFragments splits a revenue line into text plus at most one inline link. It used to live inside
// MembershipTiers.astro while the homepage accordion rendered the same registry string as plain text, so the
// live homepage showed the raw brackets and URL to every visitor. One function, both renderers.
export { revenueFragments } from '../../membership/tiers-display.mjs';

// Re-export the AXIS (bind, do NOT rebuild): TIER identity, ranking, and the fail-closed membership test.
export { TIER, tierRank, meetsTier, isTier, tierLabel } from '../../membership/tiers.mjs';

export interface TierDisplay {
  key: string;
  label: string;
  tagline: string;
  priceMonthly: number;
  priceAnnual: number;
  priceEnv: { monthly?: string; annual?: string };
  /** sow-230: a benefit is `{label, description}`. `description` is '' unless the yml gives one. */
  benefits: readonly { label: string; description: string }[];
  revenue: string;
  /** sow-323: is this tier for sale today? Only offered tiers get a pricing card. Defaults to true. */
  offered: boolean;
}

const file = path.resolve(process.cwd(), 'house/membership-tiers.yml');
const RAW = yaml.load(fs.readFileSync(file, 'utf8'));

/** The three tiers (free, member, creator) in canonical display order, from the single source of truth. */
export const TIER_DISPLAY: readonly TierDisplay[] = parseTierDisplay(RAW) as readonly TierDisplay[];

/** One tier's display record by key (none | member | creator), or undefined. */
export function tierDisplay(key: string): TierDisplay | undefined {
  return TIER_DISPLAY.find((t) => t.key === key);
}

/** The purchasable tiers (a monthly or annual price above zero), in display order. */
export function paidTiers(): readonly TierDisplay[] {
  return TIER_DISPLAY.filter((t) => t.priceMonthly > 0 || t.priceAnnual > 0);
}

/**
 * sow-323: the tiers a PRICING surface may show, in display order.
 *
 * Every axis tier is still in the registry, because the axis is what gates and parseTierDisplay requires all
 * three. Only these are OFFERED. Since 2026-09-12 that is Free and Network Supporter: the Curator entry stays
 * for the grants, the staff resolution and the legacy Stripe price it still names, and shows on no card.
 */
export function offeredTiers(): readonly TierDisplay[] {
  // Calls the shared helper rather than repeating its filter. The first version reimplemented it here and so
  // lost its "at least one paid tier must be offered" throw, which is the one thing that stops a malformed
  // registry rendering a pricing section with nothing to buy. Two copies of one rule is how the homepage
  // accordion ended up printing raw markdown while the membership page rendered a proper link.
  return sharedOfferedTiers(TIER_DISPLAY) as readonly TierDisplay[];
}
