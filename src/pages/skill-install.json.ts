// sow-109: emits /skill-install.json at build time, the install steps per tool (house/skill-install.yml) with each
// tool's label, for the extension's reader. The steps are templates: {name} is filled in by the reader from the
// skill's own SKILL.md. Public data, CORS `*` for the extension (like /topics.json).
import type { APIRoute } from 'astro';
import { skillInstallTools } from '../lib/skill-install';

export const prerender = true;

export const GET: APIRoute = async () => {
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), tools: skillInstallTools() });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
