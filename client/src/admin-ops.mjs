// Admin/superadmin READS for the manager screens (SOW-006; SOW-038 P4).
//
// sow-274: THIS MODULE NO LONGER WRITES ANYTHING. Every admin write it used to perform (roles, content flags,
// moderation, taxonomy, news sources, quotes, site toggles, call-to-action cards, channel maps, moderation
// terms, syndication templates and settings, tag curation, category batches) now goes to the signup Worker,
// which commits with GBTI's own App installation token. The client's own writers are gone, along with the
// `adminPublish` helper that force-reset a branch on the acting member's copy of the repository.
//
// WHY THE WRITERS WENT, stated as what broke rather than as a principle. The old write path based its branch on
// the fork's main, which is stale the moment upstream moves. The merge then conflicts, the gate refuses to
// auto-merge a conflicted pull request, and the change sits open with nobody told. That is not hypothetical:
// the owner's syndication settings and templates stalled exactly that way on 13 and 14 September, and the
// mitigation in front of it was fail-soft, so the write proceeded onto the stale base anyway. The Worker path
// commits on upstream directly and has no fork in it to go stale.
//
// What is LEFT here is the read half, and only the read half. Each function reads one house file through
// ctx.reader (working copy on the command line tool, GitHub Contents API in the extension) and normalizes it
// for a manager screen. None of them needs a token, a role beyond the screen's own gate, or a branch. The one
// exception is the coupon pool, which is admin-gated because coupon codes are bearer credentials and the
// registry lives in the edge store rather than in git.

import yaml from 'js-yaml';

import { OperationError } from './operations.mjs';
import { SIGNUP_BASE } from './signup-base.mjs'; // sow-291 Phase 2: the coupon pool read proxies the Worker (KV-native)
import { getCouponPool as workerGetCouponPool, getSponsorInquiries as workerGetSponsorInquiries } from './member-admin-client.mjs'; // sow-291 Phase 2; sow-266 Phase 4
import { requireAdmin } from './operations-core.mjs'; // sow-291 Phase 2: async role resolution for the Worker-proxy read
import { readAllToggles, SITE_TOGGLES } from '../../membership/site-settings-edits.mjs'; // sow-271
import { readDigestConfig, DIGEST_LIMITS } from '../../membership/digest-config-edits.mjs'; // sow-266: the digest pitch + sponsor slot, as stored
import { DEFAULT_CTA, DEFAULT_SPONSOR } from '../../membership/digest-config.mjs'; // sow-266: what an empty field falls back to
import { ctasOf, CTA_ITEM_TYPES } from '../../membership/cta-edits.mjs'; // sow-281
import { readBanwords } from '../../membership/news-banwords.mjs'; // sow-372: the words that keep a story out
import { readWeights } from '../../membership/news-source-weight-edits.mjs'; // sow-338/sow-374: the per-source weights
import { SYNDICATION_CHANNEL_NAMES } from '../../membership/syndication-template-edits.mjs'; // SOW-088
import { syndicationConfigFromParsed, TEMPLATE_TYPES, TEMPLATE_CHANNELS, newsEngagement, NEWS_ENGAGEMENT_TIERS, AUTO_TYPES, AUTO_CHANNELS, MATRIX_CHANNELS, AUTO_MODES, CHANNEL_CAPABILITY } from '../../membership/syndication-config-core.mjs'; // SOW-087 + SOW-111 + SOW-088 + SOW-125 + SOW-126

const TAXONOMY_PATH = 'house/taxonomy.yml';
const NEWS_SOURCES_PATH = 'house/news-sources.yml';
const NEWS_BANWORDS_PATH = 'house/news-banwords.yml'; // sow-372: the words that keep a story out of the stream
const NEWS_SOURCE_WEIGHTS_PATH = 'house/news-source-weights.yml'; // sow-338/sow-374: how hard we lean on each source
const QUOTES_PATH = 'house/quotes.yml';
const CONTENT_CHANNELS_PATH = 'house/content-channels.yml';
const MODERATION_FLAGS_PATH = 'house/moderation-flags.yml';
const SYNDICATION_CONFIG_PATH = 'house/syndication-config.yml';
const SITE_SETTINGS_PATH = 'house/site-settings.yml';
const DIGEST_CONFIG_PATH = 'house/digest-config.yml'; // sow-266
const CTAS_PATH = 'house/ctas.yml';

// Host-portable read: the npm host's reader.readFile is sync (returns a string); the extension's is async
// (GitHub Contents API). `await` handles both (awaiting a plain string yields the string), so the same reads
// run in either host. A missing or unparseable file reads as empty rather than throwing: a manager screen
// showing an empty pool is the honest answer, and every one of these files is optional.
const readYaml = async (ctx, rel) => {
  try {
    return yaml.load((await ctx.reader?.readFile?.(rel)) || '') ?? {};
  } catch {
    return {};
  }
};

/** Read the current canonical taxonomy ({ tree }) for the category-manager UI. Public data; read-only. */
export async function getTaxonomy(ctx) {
  const parsed = await readYaml(ctx, TAXONOMY_PATH);
  return { tree: parsed.tree || {} };
}

/** Read the current news-source pool for the manager UI. Public data; read-only. */
export async function getNewsSourcePool(ctx) {
  const parsed = await readYaml(ctx, NEWS_SOURCES_PATH);
  // sow-372: the blocked words ride back with the pool so one manager screen shows both. readYaml answers {} for
  // a file that is not there, and readBanwords answers [] for that, which is the state a fork starts in.
  const bans = await readYaml(ctx, NEWS_BANWORDS_PATH).catch(() => ({}));
  // sow-374: the weights ride along too, so the manager can show how hard we lean on each source.
  const w = await readYaml(ctx, NEWS_SOURCE_WEIGHTS_PATH).catch(() => ({}));
  return { sources: Array.isArray(parsed.sources) ? parsed.sources : [], banwords: readBanwords(bans), weights: readWeights(w) };
}

// SOW-119 + sow-291 Phase 2: the coupon registry has MOVED OFF the public repository. house/coupons.yml was a
// tracked file and a coupon code is a bearer credential, so the registry now lives in KV coupons:config. This
// READ proxies the Worker's admin coupon-pool route, which reads the RAW blob so a stale mirror sync does not
// blank the manager.

/** Read the current coupon pool (incl. inactive) for the manager UI, from KV via the Worker. Admin-gated. */
export async function getCouponPool(ctx) {
  await requireAdmin(ctx); // async role resolution via the reader (the sync role getter is unpopulated on a GET ctx)
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  try {
    return await workerGetCouponPool({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not read the coupon pool');
  }
}

/** Read the current quote pool for the manager UI. Public data; read-only. Quotes are keyed by their text. */
export async function getQuotePool(ctx) {
  const parsed = await readYaml(ctx, QUOTES_PATH);
  return { quotes: Array.isArray(parsed.quotes) ? parsed.quotes : [] };
}

/** Read the category -> Discord-channel map for the manager UI. Public data; read-only. */
export async function getContentChannelPool(ctx) {
  const parsed = await readYaml(ctx, CONTENT_CHANNELS_PATH);
  return { channels: Array.isArray(parsed.channels) ? parsed.channels : [] };
}

/** Read the moderation word lists for the manager UI. Public data (the file is in the public repo); read-only. */
export async function getModerationFlagPool(ctx) {
  const parsed = await readYaml(ctx, MODERATION_FLAGS_PATH);
  const lists = parsed.lists && typeof parsed.lists === 'object' && !Array.isArray(parsed.lists) ? parsed.lists : {};
  return { lists };
}

/**
 * Read the site-wide presentation toggles for the manager UI (sow-271). Public data; read-only. Returns every
 * known toggle RESOLVED to a boolean plus its registry metadata, so the UI never has to decide what a missing
 * key means -- readAllToggles owns that, and the build loader uses the same function.
 */
export async function getSiteSettings(ctx) {
  const parsed = await readYaml(ctx, SITE_SETTINGS_PATH);
  return {
    settings: readAllToggles(parsed),
    toggles: Object.entries(SITE_TOGGLES).map(([key, spec]) => ({ key, label: spec.label, description: spec.description })),
  };
}

/**
 * sow-266: read the weekly digest's membership pitch and sponsor slot for the manager UI.
 *
 * WHAT IS STORED, NOT WHAT WOULD RENDER. resolveDigestConfig fills every empty field with the copy compiled
 * into the renderer, which is right for sending a mail and wrong for editing one: an editor pre-filled with a
 * fallback invites a superadmin to save it, which pins today's default into the file and freezes it there the
 * next time the default changes. The defaults ride alongside so the manager can show what an empty field falls
 * back to without putting it in the box. Mirrors membershipAdminDigestConfig in the Worker exactly, so the one
 * shared element renders the same on either host.
 */
export async function getDigestConfig(ctx) {
  const parsed = await readYaml(ctx, DIGEST_CONFIG_PATH);
  return { ok: true, ...readDigestConfig(parsed), defaults: { cta: { ...DEFAULT_CTA }, sponsor: { ...DEFAULT_SPONSOR } }, limits: { ...DIGEST_LIMITS } };
}

/**
 * sow-266 Phase 4: the sponsorship inquiries, read through the Worker.
 *
 * NOT FROM THE CHECKOUT, unlike every other read in this file: an inquiry is a private message with a TTL and
 * it lives in KV, so there is nothing in git to read. Same shape as getCouponPool above, and the Worker's
 * superadmin gate is the real boundary.
 */
export async function getSponsorInquiries(ctx) {
  await requireAdmin(ctx); // async role resolution via the reader, as the coupon pool does
  const token = ctx.store?.get?.('githubToken');
  if (!token) throw new OperationError('not-authenticated', 'sign in first');
  try {
    return await workerGetSponsorInquiries({ token, signupBase: SIGNUP_BASE, fetch: ctx.fetch ?? globalThis.fetch });
  } catch (err) {
    throw new OperationError('admin-op-failed', err?.message || 'could not read the sponsorship inquiries');
  }
}

/** Read the call-to-action registry for the manager UI. Public git data (the site publishes /ctas.json). */
export async function getCtaPool(ctx) {
  const parsed = await readYaml(ctx, CTAS_PATH);
  return { ctas: ctasOf(parsed), types: [...CTA_ITEM_TYPES] };
}

/** Read the per-type templates (+ SOW-088 per-channel overrides) for the manager UI. Read-only. */
export async function getSyndicationTemplatePool(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  return { templates: cfg.templates, channelTemplates: cfg.channel_templates, stubTemplates: cfg.stub_templates, channelTemplatesStub: cfg.channel_templates_stub, types: [...TEMPLATE_TYPES], channels: [...TEMPLATE_CHANNELS] };
}

/** Read the normalized pipeline settings for the manager UI. Public house data; read-only. */
export async function getSyndicationSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  const cfg = syndicationConfigFromParsed(parsed);
  const channels = {};
  for (const name of SYNDICATION_CHANNEL_NAMES) channels[name] = Boolean(cfg.channels?.[name]);
  // SOW-125: the per-type-per-channel auto-share matrix, the per-channel delay overrides, and the
  // channel-capability map so the UI derives auto/manual/building from ONE source (no stale "building" flags).
  const autoMatrix = {};
  for (const t of AUTO_TYPES) { autoMatrix[t] = {}; for (const ch of MATRIX_CHANNELS) autoMatrix[t][ch] = cfg.auto_matrix?.[t]?.[ch] ?? 'off'; }
  return {
    settings: {
      enabled: cfg.enabled, requireApproval: cfg.require_approval, holdMinutes: cfg.hold_minutes, channels,
      autoMatrix, channelHoldMinutes: { ...cfg.channel_hold_minutes },
    },
    channelNames: [...SYNDICATION_CHANNEL_NAMES],
    // SOW-125: matrixChannels (auto + manual) drive the matrix columns; autoChannels (auto-only) drive the
    // per-channel delay inputs; capability lets the UI derive auto/manual/building from ONE source.
    autoTypes: [...AUTO_TYPES], matrixChannels: [...MATRIX_CHANNELS], autoChannels: [...AUTO_CHANNELS], autoModes: [...AUTO_MODES], capability: { ...CHANNEL_CAPABILITY },
  };
}

/** Read the normalized news engagement settings for the manager UI. Public data; read-only. */
export async function getNewsEngagementSettings(ctx) {
  const parsed = await readYaml(ctx, SYNDICATION_CONFIG_PATH);
  return { settings: { ...newsEngagement(syndicationConfigFromParsed(parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS] };
}
