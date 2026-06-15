// SOW-029: emits /members-index.json at build time, the minimized public member directory the extension's
// post-setup welcome view (<gbti-welcome>) fetches for its randomized "follow members" list. Same public,
// directory-opted-in filter as /members/ (src/pages/members/index.astro); data-minimized fields only (no
// github_id/email/location/links). CORS `*` so the extension can fetch it cross-origin under its gbti.network
// host permission (exactly how the new tab fetches /activity-index.json). Refreshes on each deploy.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { isPublic } from '../lib/content';
import { buildMembersDirectory } from '../lib/members-directory.mjs';
import { githubAvatarUrl } from '../lib/avatars';

export const prerender = true;

export const GET: APIRoute = async () => {
  const profiles = (await getCollection('profile'))
    .filter(isPublic)
    .filter((p) => p.data.directory);
  const members = buildMembersDirectory(profiles, (login?: string) => githubAvatarUrl(login));
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: members.length, members });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
