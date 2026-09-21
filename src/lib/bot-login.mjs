// A GitHub App's bot account signs its commits `<app>[bot]` (ours is gbti-network-publisher[bot], which authors
// every change the network publishes since sow-274). It has no profile page and NO avatar at github.com/<login>.png:
// GitHub answers 404, which a site crawl reported as a broken image on every article history (2026-09-21).
// Node-free so the node tests can import it; src/lib/avatars.ts re-exports it for the site.
export function isBotLogin(login) {
  return /\[bot\]$/i.test(String(login ?? '').trim());
}
