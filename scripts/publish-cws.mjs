// SOW-133: publish the extension to the Chrome Web Store via the Publish API, so a new BUILD ships without the
// dashboard. This uploads the packaged zip (public/extension/gbti-network-extension.zip) to the existing item and
// publishes it. It is INERT until the owner provisions the OAuth credentials (see .data/ops/extension-ops/
// chrome-web-store.md): a missing credential is a clean skip, never a hard failure in CI.
//
// The API does NOT manage the store LISTING (screenshots, marquee, description, privacy) — those stay dashboard
// only. This script only pushes the code package + flips it to published.
//
// Credentials (env, never committed): CWS_CLIENT_ID, CWS_CLIENT_SECRET, CWS_REFRESH_TOKEN. CWS_APP_ID defaults to
// the live item id. Optional: CWS_PUBLISH_TARGET (default 'default' = everyone; 'trustedTesters' for a draft).
//
// Usage:
//   node scripts/publish-cws.mjs            # upload + publish (skips cleanly if creds are unset)
//   node scripts/publish-cws.mjs --check    # only verify creds + the zip; do not upload or publish
//   node scripts/publish-cws.mjs --upload-only   # upload the new package but do NOT publish (review it first)
//
// No SDK: plain fetch against the documented endpoints, matching the repo's injectable-fetch client style.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ZIP = path.join(ROOT, 'public/extension/gbti-network-extension.zip');
const DEFAULT_APP_ID = 'iffjdmifgnjgkdjoodapjciddibmifka'; // the live GBTI Network Extension item

const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has('--check');
const UPLOAD_ONLY = args.has('--upload-only');

function env(name) { const v = process.env[name]; return typeof v === 'string' && v.trim() ? v.trim() : ''; }

async function accessTokenFrom({ clientId, clientSecret, refreshToken, fetchImpl }) {
  const res = await fetchImpl('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: 'refresh_token' }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new Error(`OAuth token exchange failed (${res.status}): ${body.error_description || body.error || 'no access_token'}`);
  return body.access_token;
}

async function uploadPackage({ appId, token, zipBuf, fetchImpl }) {
  const res = await fetchImpl(`https://www.googleapis.com/upload/chromewebstore/v1.1/items/${appId}?uploadType=media`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2' },
    body: zipBuf,
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.uploadState === 'FAILURE') {
    const detail = (body.itemError || []).map((e) => e.error_detail).join('; ') || body.error?.message || `status ${res.status}`;
    throw new Error(`Chrome Web Store upload failed: ${detail}`);
  }
  return body; // { uploadState: 'SUCCESS' | 'IN_PROGRESS', ... }
}

async function publishItem({ appId, token, target, fetchImpl }) {
  const res = await fetchImpl(`https://www.googleapis.com/chromewebstore/v1.1/items/${appId}/publish?publishTarget=${encodeURIComponent(target)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'x-goog-api-version': '2', 'Content-Length': '0' },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Chrome Web Store publish failed (${res.status}): ${(body.error?.message) || JSON.stringify(body).slice(0, 200)}`);
  return body; // { status: ['OK'] | ['ITEM_PENDING_REVIEW'], statusDetail: [...] }
}

export async function main({ env: e = process.env, fetchImpl = globalThis.fetch, checkOnly = CHECK_ONLY, uploadOnly = UPLOAD_ONLY } = {}) {
  const clientId = (e.CWS_CLIENT_ID || '').trim();
  const clientSecret = (e.CWS_CLIENT_SECRET || '').trim();
  const refreshToken = (e.CWS_REFRESH_TOKEN || '').trim();
  const appId = (e.CWS_APP_ID || '').trim() || DEFAULT_APP_ID;
  const target = (e.CWS_PUBLISH_TARGET || '').trim() || 'default';

  if (!fs.existsSync(ZIP)) { console.error(`publish-cws: missing package ${path.relative(ROOT, ZIP)} (run \`npm run build:extension\` first).`); process.exit(1); }

  if (!clientId || !clientSecret || !refreshToken) {
    console.log('publish-cws: Chrome Web Store credentials are not set (CWS_CLIENT_ID / CWS_CLIENT_SECRET / CWS_REFRESH_TOKEN); skipping. Publish manually from the dashboard, or provision the creds (see .data/ops/extension-ops/chrome-web-store.md).');
    return { skipped: true };
  }

  const zipBuf = fs.readFileSync(ZIP);
  console.log(`publish-cws: item ${appId}, package ${(zipBuf.length / 1024).toFixed(0)} KB, target ${target}${uploadOnly ? ' (upload only)' : ''}${checkOnly ? ' (check only)' : ''}.`);

  const token = await accessTokenFrom({ clientId, clientSecret, refreshToken, fetchImpl });
  if (checkOnly) { console.log('publish-cws: credentials valid and package present. No upload/publish performed (--check).'); return { ok: true, checked: true }; }

  const up = await uploadPackage({ appId, token, zipBuf, fetchImpl });
  console.log(`publish-cws: uploaded (uploadState=${up.uploadState || 'unknown'}).`);
  if (uploadOnly) { console.log('publish-cws: --upload-only, not publishing. Review the draft in the dashboard, then publish.'); return { ok: true, uploaded: true }; }

  const pub = await publishItem({ appId, token, target, fetchImpl });
  const status = Array.isArray(pub.status) ? pub.status.join(', ') : String(pub.status ?? 'unknown');
  console.log(`publish-cws: publish requested (status=${status}). A code change may re-enter review; the listing updates once it clears.`);
  return { ok: true, published: true, status };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((r) => { if (r?.skipped) process.exit(0); }).catch((err) => { console.error(`publish-cws: ${err.message}`); process.exit(1); });
}
