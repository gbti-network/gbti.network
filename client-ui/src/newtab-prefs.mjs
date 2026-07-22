// SOW-105: the pure, node-testable new-tab prefs core. Two device-local memories for the extension new tab:
// the LAST SECTION viewed (so a bare new tab lands where you left off) and a PER-SECTION view mode with
// per-type defaults (so Prompts can stay compact while Articles stay cards). This module owns the key names
// and the resolution rules ONLY; newtab.mjs owns every localStorage read/write (nothing here touches storage
// or the DOM, so `node --test` imports it directly).
import { TYPE_FILTERS, parseTypeFromHash, typeForHash } from './feed-route.mjs';
import { splashDestHash } from './splash.mjs';

/** The last section the member viewed (a TYPE_FILTERS value), written on every selectType switch. */
export const LAST_SECTION_KEY = 'gbti-nt-last-section';

/** SOW-039's single GLOBAL view mode. Retired by the per-type keys: removed on boot, never seeded from
 *  (the owner-specified per-type defaults win over whatever one global value a member had). */
export const LEGACY_MODE_KEY = 'gbti-nt-mode';

/** The three list densities (mirrors gbti-card-list's MODES set). */
export const VIEW_MODES = new Set(['compact', 'detailed', 'card']);

/** Per-type view defaults (owner-specified for post/product/prompt/share; all + news follow the
 *  "Cards is the new default" direction). Every TYPE_FILTERS value has an entry (unit-enforced). */
export const DEFAULT_VIEW = Object.freeze({
  all: 'card',
  post: 'card',
  product: 'detailed',
  prompt: 'compact',
  share: 'detailed',
  news: 'card',
});

/** The per-section localStorage key, e.g. viewKey('prompt') -> 'gbti-nt-view-prompt'. */
export function viewKey(type) {
  return `gbti-nt-view-${type}`;
}

/** Resolve a section's view mode: a valid stored value wins, else the per-type default, else 'compact'. */
export function viewModeFor(type, stored) {
  return VIEW_MODES.has(stored) ? stored : DEFAULT_VIEW[type] || 'compact';
}

/**
 * The boot landing section for the new tab. Precedence: an explicit hash (a rail click or a deep link
 * MUST land where it points) > the remembered last section (validated against TYPE_FILTERS, so a stale
 * value from a removed type falls through) > the snoozed splash destination (its activity/news/workbench
 * vocabulary maps through splashDestHash, so anything non-news lands on 'all') > 'all'.
 */
export function landingType({ hash, remembered, splashDest } = {}) {
  const fromHash = parseTypeFromHash(hash);
  if (fromHash) return fromHash;
  if (TYPE_FILTERS.has(remembered)) return remembered;
  if (splashDest) return typeForHash(splashDestHash(splashDest));
  return 'all';
}
