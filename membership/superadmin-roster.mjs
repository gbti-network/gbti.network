// SOW-038 P2: a pure roster builder for the superadmin dashboard read-view. Given the parsed override files
// (roles.yml, bans.yml, grandfathered.yml, members-index.yml), enumerate every known member and resolve each
// one's OVERRIDE-derived effective status (ban > staff > grandfather) — the part that is authoritative from the
// PUBLIC repo. Live Stripe paid/trial per member is NOT available here (it needs a Stripe-key Worker endpoint),
// so the Stripe tier resolves to 'unknown' and the dashboard labels it accordingly. Node-free; unit-tested.
import { rolesFromParsed, roleLoginsFromParsed, bansFromParsed, grandfathersFromParsed, membersIndexFromParsed, roleOf, isBanned, grandfatherActive, effectiveStatus, ROLE } from './overrides-core.mjs';

/**
 * @param {{roles?:object, bans?:object, grandfathered?:object, membersIndex?:object, stripeStatuses?:object}} parsed
 *   - parsed YAML objects + an optional { github_id -> stripe status } map (SOW-038 P2 admin endpoint). When the
 *     map is present, each row's Stripe tier is the real status and a pure-Stripe member (no override, no folder)
 *     is also enumerated; when absent, the Stripe tier is 'unknown'.
 * @returns {{ roster: Array, summary: {total:number, staff:number, grandfathered:number, banned:number, members:number} }}
 */
export function buildRoster({ roles, bans, grandfathered, membersIndex, stripeStatuses, stripeLogins } = {}, now = new Date()) {
  const roleMap = rolesFromParsed(roles);
  const roleLogins = roleLoginsFromParsed(roles); // SOW-091: staff login fallback (no members-index needed)
  const banMap = bansFromParsed(bans);
  const gfMap = grandfathersFromParsed(grandfathered);
  const idx = membersIndexFromParsed(membersIndex);
  const stripe = stripeStatuses && typeof stripeStatuses === 'object' ? stripeStatuses : {};
  const stripeLoginMap = stripeLogins && typeof stripeLogins === 'object' ? stripeLogins : {}; // SOW-091: Stripe github_login fallback
  const overrides = { bans: banMap, grandfathers: gfMap, roles: roleMap };

  // Every github_id we can see: the members index + each override map + (when the admin Stripe map is supplied)
  // every Stripe customer, so a pure-paid member with no override and no folder is no longer invisible.
  const ids = new Set([...idx.keys(), ...roleMap.keys(), ...banMap.keys(), ...gfMap.keys(), ...Object.keys(stripe)]);

  const roster = [...ids].map((id) => {
    const derived = stripe[id] || 'unknown'; // the live Stripe tier, or 'unknown' without the admin endpoint
    const eff = effectiveStatus(id, derived, overrides, now);
    const gf = gfMap.get(id);
    return {
      githubId: id,
      // SOW-091: resolve the display username through every known source before falling back to the raw id, so a
      // staff member (roles login) or a paid/trial member with no published content (Stripe github_login) is named.
      username: idx.get(id) || banMap.get(id)?.login || gf?.login || roleLogins.get(id) || stripeLoginMap[id] || null,
      role: roleOf(id, roleMap),
      banned: isBanned(id, banMap),
      grandfathered: grandfatherActive(id, gfMap, now),
      grandfatherUntil: gf?.until ?? null,
      stripeStatus: stripe[id] || null, // the raw Stripe-derived tier (null when the admin endpoint was not consulted)
      status: eff.status, // banned | paid | trialing | expired | cancelled | none | unknown
      source: eff.source, // ban | staff | grandfather | stripe
    };
  });

  // Order: staff first, then grandfathered, then banned, then plain members; alpha within each band.
  const band = (r) => (r.role !== ROLE.member ? 0 : r.grandfathered ? 1 : r.banned ? 2 : 3);
  roster.sort((a, b) => band(a) - band(b) || String(a.username || a.githubId).localeCompare(String(b.username || b.githubId)));

  const summary = {
    total: roster.length,
    staff: roster.filter((r) => r.role !== ROLE.member).length,
    grandfathered: roster.filter((r) => r.grandfathered).length,
    banned: roster.filter((r) => r.banned).length,
    members: roster.filter((r) => r.role === ROLE.member && !r.grandfathered && !r.banned).length,
  };
  return { roster, summary };
}
