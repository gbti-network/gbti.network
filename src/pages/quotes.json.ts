// SOW-063: publish the git-native quote pool (house/quotes.yml) as a build artifact the extension new tab reads to
// render the landing-splash quote. Same "static site is the published read-view" pattern as news-sources.json.ts:
// the YAML is the source of truth in the repo (portable — a fork carries its own), and this endpoint is how the
// extension consumes it without a GitHub token (a public, CDN-cached URL). The FULL pool is emitted (including
// disabled entries + the `enabled` flag) so the superadmin manager can show them; the extension filters to enabled
// and picks one on a 12-hour rotation. Metadata only (quotes are not secret). CORS `*` for the extension fetch.
import type { APIRoute } from 'astro';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

export const prerender = true;

type Quote = { text: string; author: string; enabled: boolean };

function loadQuotes(): Quote[] {
  const file = path.resolve(process.cwd(), 'house', 'quotes.yml');
  const parsed = yaml.load(fs.readFileSync(file, 'utf8')) as { quotes?: unknown } | null;
  const raw = Array.isArray(parsed?.quotes) ? parsed!.quotes : [];
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const q of raw as any[]) {
    // Validate shape at build time so a malformed edit fails the build instead of shipping a broken pool.
    const text = String(q?.text || '').trim();
    const author = String(q?.author || '').trim();
    if (!text || !author) throw new Error(`quotes.yml: each quote needs a non-empty text and author (got text="${text}", author="${author}")`);
    const key = text.toLowerCase();
    if (seen.has(key)) throw new Error(`quotes.yml: duplicate quote text "${text}"`);
    seen.add(key);
    out.push({ text, author, enabled: q?.enabled !== false });
  }
  return out;
}

export const GET: APIRoute = async () => {
  const quotes = loadQuotes();
  const body = JSON.stringify({ generatedAt: new Date().toISOString(), count: quotes.length, quotes });
  return new Response(body, { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
};
