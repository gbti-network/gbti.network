// SOW-118: publish the git-native changelog (house/changelog.yml) as a build artifact. Same "static site is
// the published read-view" pattern as quotes.json.ts: the YAML is the source of truth in the repo (a fork
// carries its own), and this endpoint is how the extension new-tab version indicator reads the current build
// number without a GitHub token (a public, CDN-cached URL). The FULL list is emitted (releases + dev build
// notes); the public /changelog page hides build notes behind a client filter. Metadata only, not secret.
// CORS `*` for the extension fetch.
import type { APIRoute } from 'astro';
import { allEntries, currentBuild, currentVersion } from '../lib/changelog.mjs';

export const prerender = true;

export const GET: APIRoute = async () => {
  const entries = allEntries();
  const body = JSON.stringify({
    generatedAt: new Date().toISOString(),
    version: currentVersion(),
    build: currentBuild(),
    count: entries.length,
    entries,
  });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
