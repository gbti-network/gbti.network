// sow-295: the production Worker trusts exactly two origins for signed-in calls, the apex and the preview address.
//
// Adding preview.gbti.network was an owner decision (2026-09-14) so an unmerged branch can be tested signed in without
// touching the live site. It works because the preview is a gbti.network subdomain: the SameSite=Lax session cookie and
// the Domain=gbti.network csrf cookie both reach it. A pages.dev preview is a different site, would not receive those
// cookies, and would widen trust to every preview deployment, so it must never appear here. This pins the pair so a
// later widening is a deliberate, visible test change rather than a quiet edit to a config line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseAllowedOrigins, corsHeaders } from '../workers/signup/cors.mjs';
import { requireOrigin } from '../workers/signup/csrf.mjs';

/** One var from one toml section, so the production value cannot be confused with the bare [vars] one. */
function tomlVar(text, section, name) {
  let cur = '';
  for (const line of text.split('\n')) {
    const s = /^\s*(\[[^\]]+\])/.exec(line);
    if (s) { cur = s[1]; continue; }
    const m = new RegExp(`^\\s*${name}\\s*=\\s*"([^"]*)"`).exec(line);
    if (m && cur === section) return m[1];
  }
  return null;
}

const toml = fs.readFileSync(new URL('../workers/signup/wrangler.toml', import.meta.url), 'utf8');
const PROD = { CORS_ALLOWED_ORIGINS: tomlVar(toml, '[env.production.vars]', 'CORS_ALLOWED_ORIGINS') };

test('production trusts exactly the apex and the preview address', () => {
  assert.notEqual(PROD.CORS_ALLOWED_ORIGINS, null, 'CORS_ALLOWED_ORIGINS is missing from [env.production.vars]');
  assert.deepEqual([...parseAllowedOrigins(PROD)], ['https://gbti.network', 'https://preview.gbti.network']);
  assert.doesNotMatch(PROD.CORS_ALLOWED_ORIGINS, /\*|pages\.dev|http:\/\//, 'no wildcard, no pages.dev, no plain http');
});

test('the preview address gets credentialed CORS and passes the Origin check; a pages.dev preview gets neither', () => {
  const at = (origin) => new Request('https://signup.gbti.network/membership/me', { method: 'POST', headers: { Origin: origin } });
  const preview = corsHeaders(at('https://preview.gbti.network'), PROD, { credentials: true });
  assert.equal(preview['Access-Control-Allow-Origin'], 'https://preview.gbti.network');
  assert.equal(preview['Access-Control-Allow-Credentials'], 'true');
  assert.equal(requireOrigin(at('https://preview.gbti.network'), PROD).ok, true);

  for (const outsider of ['https://preview.gbti-network.pages.dev', 'https://abc123.gbti-network.pages.dev', 'https://evil.example']) {
    const h = corsHeaders(at(outsider), PROD, { credentials: true });
    assert.equal(h['Access-Control-Allow-Origin'], undefined, `${outsider} must not be reflected`);
    assert.equal(requireOrigin(at(outsider), PROD).ok, false, `${outsider} must fail the Origin check`);
  }
});
