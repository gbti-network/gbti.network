// The network's own content identities (sow-195): `gbtilabs` is the real member folder holding what used to live
// in `house/`, and `gbti` is the retired pseudo-author kept so older content still renders the same. Both display
// as "GBTI Network".
//
// Node-free so the node tests can import it; src/lib/authors.ts holds the display rules and re-exports this.
export const NETWORK_AUTHORS = new Set(['gbti', 'gbtilabs']);

/** Is this content the network's own, rather than a member's? */
export function isNetworkAuthor(username) {
  return NETWORK_AUTHORS.has(String(username ?? '').trim().toLowerCase());
}
