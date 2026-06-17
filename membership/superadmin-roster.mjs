// SOW-038 P2: a pure roster builder for the superadmin dashboard read-view. Given the parsed override files
// (roles.yml, bans.yml, grandfathered.yml, members-index.yml), enumerate every known member and resolve each
// one's OVERRIDE-derived effective status (ban > staff > grandfather) — the part that is authoritative from the
// PUBLIC repo. Live Stripe paid/trial per member is NOT available here (it needs a Stripe-key Worker endpoint),
// so the Stripe tier resolves to 'unknown' and the dashboard labels it accordingly. Node-free; unit-tested.
import { rolesFromParsed, bansFromParsed, grandfathersFromParsed, membersIndexFromParsed, roleOf, isBanned, grandfatherActive, effectiveStatus, ROLE } from './overrides-core.mjs';

/**
 * @param {{roles?:object, bans?:object, grandfathered?:object, membersIndex?:object}} parsed - parsed YAML objects
 * @returns {{ roster: Array, summary: {total:number, staff:number, grandfathered:number, banned:number, members:number} }}
 */
export function buildRoster({ roles, bans, grandfathered, membersIndex } = {}, now = new Date()) {
  const roleMap = rolesFromParsed(roles);
  const banMap = bansFromParsed(bans);
  const gfMap = grandfathersFromParsed(grandfathered);
  const idx = membersIndexFromParsed(membersIndex);
  const overrides = { bans: banMap, grandfathers: gfMap, roles: roleMap };

  // Every github_id we can see, from the members index + each override map (a pure-Stripe member with no
  // override and no folder is invisible here — documented gap until the Stripe-key endpoint lands).
  const ids = new Set([...idx.keys(), ...roleMap.keys(), ...banMap.keys(), ...gfMap.keys()]);

  const roster = [...ids].map((id) => {
    const eff = effectiveStatus(id, 'unknown', overrides, now); // derived='unknown': no live Stripe here
    const gf = gfMap.get(id);
    return {
      githubId: id,
      username: idx.get(id) || banMap.get(id)?.login || gf?.login || null,
      role: roleOf(id, roleMap),
      banned: isBanned(id, banMap),
      grandfathered: grandfatherActive(id, gfMap, now),
      grandfatherUntil: gf?.until ?? null,
      status: eff.status, // banned | paid | unknown
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
