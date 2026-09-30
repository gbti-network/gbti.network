// The read-only POOL routes of the admin surface (GET, no CSRF, fail-closed): the config pools the website
// managers render (site settings, taxonomy, quotes, news sources, coupons) and the channel-map manager's six
// superadmin reads. Moved here from membership-admin-author.mjs at the 900-line limit; that file re-exports
// every route below, so workers/signup/index.mjs and the tests keep importing them from there.

import { authorizeAdmin, authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { loadHouseYaml } from './membership-admin-files.mjs';
import { readWeights } from '../../membership/news-source-weight-edits.mjs'; // sow-338: how much we take from a source
import { readBanwords } from '../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out
import { readDigestConfig, DIGEST_LIMITS } from '../../membership/digest-config-edits.mjs'; // sow-266: the digest pitch copy + the sponsor slot
import { DEFAULT_CTA, DEFAULT_SPONSOR, DEFAULT_OPTIN } from '../../membership/digest-config.mjs'; // sow-266: what an empty field falls back to
import { COUPONS_MIRROR_KEY } from '../../membership/coupons.mjs'; // sow-291 Phase 2: coupons:config is KV-native
import { readAllToggles, SITE_TOGGLES } from '../../membership/site-settings-edits.mjs'; // sow-271
import { SYNDICATION_CHANNEL_NAMES } from '../../membership/syndication-template-edits.mjs'; // sow-161 B
import { syndicationConfigFromParsed, TEMPLATE_TYPES, TEMPLATE_CHANNELS, newsEngagement, NEWS_ENGAGEMENT_TIERS, AUTO_TYPES, AUTO_CHANNELS, MATRIX_CHANNELS, AUTO_MODES, CHANNEL_CAPABILITY } from '../../membership/syndication-config-core.mjs'; // sow-161 B: the channel-map pool reads

// sow-271: the site-settings pool READ. Gated the same way as the other config reads (a GET carries no CSRF and
// is read-only); the DATA is public anyway, since the same values are baked into every built page. Returns each
// toggle resolved through readAllToggles -- the same function the build loader uses -- so the manager and the
// live site can never disagree about what a missing key means.
export async function membershipAdminSiteSettings(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/site-settings.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  let settings;
  // A corrupt stored value throws out of readAllToggles. Report it as a 500 with the reason rather than letting
  // it surface as an opaque failure: the manager showing a wrong switch position is the bad outcome here.
  try { settings = readAllToggles(load.parsed || {}); }
  catch (err) { return { status: 500, body: { error: 'bad_config', message: `house/site-settings.yml is invalid: ${err.message}` } }; }
  const toggles = Object.entries(SITE_TOGGLES).map(([key, spec]) => ({ key, label: spec.label, description: spec.description }));
  return { status: 200, body: { ok: true, settings, toggles } };
}

// sow-161 A: the taxonomy READ for the categories workspace on the WEBSITE. house/taxonomy.yml is public build
// data; this returns the same { tree } shape getTaxonomy returns on the in-process hosts, so the shared element
// renders identically. Admin-gated + read-only (a GET carries no CSRF); fail-closed on a read/parse error.
export async function membershipAdminTaxonomy(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/taxonomy.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  return { status: 200, body: { ok: true, tree: load.parsed?.tree || {} } };
}

// sow-161 increment 4: the quote-manager pool READ. Admin-gated (cookie or bearer); returns the FULL pool from
// house/quotes.yml (incl. disabled quotes, which the public splash JSON omits) so the manager can toggle them.
// Read-only + fail-closed; a GET carries no CSRF.
export async function membershipAdminQuotePool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/quotes.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  const quotes = Array.isArray(load.parsed?.quotes) ? load.parsed.quotes : [];
  return { status: 200, body: { ok: true, quotes } };
}

// sow-161 increment 4: the news-source-manager pool READ (admin-gated). The FULL pool from house/news-sources.yml
// (incl. disabled sources, so the manager can toggle them). Read-only + fail-closed; a GET carries no CSRF.
export async function membershipAdminNewsSourcePool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/news-sources.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  const sources = Array.isArray(load.parsed?.sources) ? load.parsed.sources : [];
  // sow-372: the blocked words ride back with the pool, so the one manager screen shows both without a second
  // round trip from the browser. A failure to read that file is NOT fatal here: the sources are what this route
  // is for, and an empty list plus a visible "could not read" beats a blank screen.
  let banwords = [];
  try {
    const bans = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/news-banwords.yml');
    if (bans.ok) banwords = readBanwords(bans.parsed);
  } catch { /* the pool still answers */ }
  // sow-374: and the weights, for the same reason. They live in their own file because they are a superadmin's
  // call on an admin-owned pool, but a manager showing a source without showing how hard we lean on it is asking
  // somebody to curate blind. Neutral is absence, so an unweighted source is simply missing from the map.
  let weights = {};
  try {
    const w = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/news-source-weights.yml');
    if (w.ok) weights = readWeights(w.parsed);
  } catch { /* the pool still answers */ }
  return { status: 200, body: { ok: true, sources, banwords, weights } };
}

// sow-161 increment 4 + sow-291 Phase 2: the coupon-manager CONFIG pool READ (admin-gated). The FULL registry
// now comes from KV coupons:config (house/coupons.yml has left the public repository), incl. inactive coupons so
// the manager can re-activate them. Read-only + fail-closed; a GET carries no CSRF. The runtime redemption COUNTS
// come from the separate /membership/admin/coupon-usage endpoint (KV grant records, not this config blob).
export async function membershipAdminCouponPool(request, env, deps = {}) {
  const {
    authorize = authorizeAdmin, allowCookie = false, kv = env?.SIGNUP_KV,
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  // Read the RAW blob, NOT readCouponsConfig: the manager must show the pool even when the 6-hourly sync has gone
  // stale (an admin needs to see and fix it precisely then), so the 48h freshness gate must not blank it here.
  // Fail closed on a KV error; treat an absent/malformed blob as an empty pool (a fresh namespace pre-first-sync).
  let blob;
  try { blob = await kv.get(COUPONS_MIRROR_KEY, 'json'); }
  catch (e) { return { status: 503, body: { error: 'unavailable', message: `the coupon registry could not be read (${e?.message || 'unknown'})` } }; }
  const coupons = Array.isArray(blob?.coupons) ? blob.coupons : [];
  return { status: 200, body: { ok: true, coupons } };
}

// sow-161 B: the channel-map manager's SIX pool READs, on the WEBSITE host. All SUPERADMIN-gated: the manager
// mounts superadmin-only, every write on this surface is superadmin, and moderation-flags is a moderation
// blocklist + the syndication config is operational, so read audience must not exceed write audience. Each
// mirrors the exact body shape client/src/admin-ops.mjs returns to the extension host (getContentChannelPool /
// getModerationFlagPool / getSyndicationTemplatePool / getNewsEngagementSettings /
// getSyndicationSettings), so the shared <gbti-channel-map-manager> renders identically on either host. Read-only
// + fail-closed; a GET carries no CSRF. Helper collapses the shared authorize + install-token + load boilerplate.
async function loadForSuperadminRead(request, env, deps, path) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeSuperadmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const auth = await authorize(request, env, { ...deps, allowCookie });
  if (!auth.ok) return { fail: { status: auth.status, body: auth.body } };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { fail: { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, path);
  if (!load.ok) return { fail: { status: load.status, body: load.body } };
  return { parsed: load.parsed || {} };
}

export async function membershipAdminContentChannelPool(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/content-channels.yml');
  if (r.fail) return r.fail;
  return { status: 200, body: { channels: Array.isArray(r.parsed.channels) ? r.parsed.channels : [] } };
}

export async function membershipAdminModerationFlagPool(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/moderation-flags.yml');
  if (r.fail) return r.fail;
  const lists = r.parsed.lists && typeof r.parsed.lists === 'object' && !Array.isArray(r.parsed.lists) ? r.parsed.lists : {};
  return { status: 200, body: { lists } };
}

export async function membershipAdminSyndicationTemplatePool(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/syndication-config.yml');
  if (r.fail) return r.fail;
  const cfg = syndicationConfigFromParsed(r.parsed);
  return { status: 200, body: { templates: cfg.templates, channelTemplates: cfg.channel_templates, stubTemplates: cfg.stub_templates, channelTemplatesStub: cfg.channel_templates_stub, types: [...TEMPLATE_TYPES], channels: [...TEMPLATE_CHANNELS] } };
}

export async function membershipAdminNewsEngagement(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/syndication-config.yml');
  if (r.fail) return r.fail;
  return { status: 200, body: { settings: { ...newsEngagement(syndicationConfigFromParsed(r.parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS] } };
}

// sow-266 Phase 2: the digest manager's pool READ. SUPERADMIN-gated like the five above, and for the SAME reason
// they are, which is not the reason it first looks like. This does NOT keep the settings secret: they live in
// house/digest-config.yml in a PUBLIC repository, and the pull request that changes them is public too, so a
// sponsor arrangement is readable on GitHub the moment it is saved. The extension reads the same file tokenless
// for exactly that reason. What the gate protects is GBTI's own installation token, which this route uses to
// read: an ungated route here is a free authenticated proxy onto the repository, whatever the file contains.
//
// IT RETURNS WHAT IS STORED, NOT WHAT WOULD RENDER. resolveDigestConfig fills every empty field with the copy
// compiled into the renderer, which is exactly right for sending a mail and exactly wrong for editing one: an
// editor pre-filled with a fallback invites a superadmin to save it, which pins today's default into the file
// and freezes it there the next time the default changes. `defaults` rides along separately so the manager can
// SHOW what an empty field falls back to without putting it in the box.
export async function membershipAdminDigestConfig(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/digest-config.yml');
  if (r.fail) return r.fail;
  const stored = readDigestConfig(r.parsed);
  return { status: 200, body: { ok: true, ...stored, defaults: { cta: { ...DEFAULT_CTA }, sponsor: { ...DEFAULT_SPONSOR }, optin: { ...DEFAULT_OPTIN } }, limits: { ...DIGEST_LIMITS } } };
}

export async function membershipAdminSyndicationSettings(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/syndication-config.yml');
  if (r.fail) return r.fail;
  const cfg = syndicationConfigFromParsed(r.parsed);
  const channels = {};
  for (const name of SYNDICATION_CHANNEL_NAMES) channels[name] = Boolean(cfg.channels?.[name]);
  // SOW-125: the per-type-per-channel auto-share matrix, defaulted per cell so the UI derives auto/manual/building
  // from ONE source (no stale "building" flags). Mirrors admin-ops.getSyndicationSettings exactly.
  const autoMatrix = {};
  for (const t of AUTO_TYPES) { autoMatrix[t] = {}; for (const ch of MATRIX_CHANNELS) autoMatrix[t][ch] = cfg.auto_matrix?.[t]?.[ch] ?? 'off'; }
  return {
    status: 200,
    body: {
      settings: {
        enabled: cfg.enabled, requireApproval: cfg.require_approval, holdMinutes: cfg.hold_minutes, channels,
        autoMatrix, channelHoldMinutes: { ...cfg.channel_hold_minutes },
      },
      channelNames: [...SYNDICATION_CHANNEL_NAMES],
      autoTypes: [...AUTO_TYPES], matrixChannels: [...MATRIX_CHANNELS], autoChannels: [...AUTO_CHANNELS], autoModes: [...AUTO_MODES], capability: { ...CHANNEL_CAPABILITY },
    },
  };
}
