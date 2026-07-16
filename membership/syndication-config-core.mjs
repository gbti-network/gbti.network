// SOW-058 (+ SOW-057/087/111): the NODE-FREE syndication configuration core, shared by the signup Worker
// drain, the extension background (via admin-ops), the adapters, and the reconcile mirror. Pure functions
// operate on already-parsed objects (fixture-testable); the node-side file loader lives in
// membership/syndication-config.mjs (the SOW-015 overrides-core split pattern: this module must never import
// node builtins, or the MV3 extension bundle breaks).
//
// Everything fails closed to the SAFE default:
//   enabled            master switch. A missing/unparseable file or key leaves this false, so nothing is ever
//                      auto-syndicated by accident.
//   hold_minutes       the deliberate delay before a queued item goes out (default 60). The superadmin can
//                      cancel during this window. Coerced to a non-negative integer.
//   upvote_threshold   SOW-057: distinct non-author members required to enqueue a share (default 2). Coerced
//                      to an integer >= 1; a smaller/invalid value falls back to the default (never below 1).
//   channels           per-channel master switches. Default false. A channel still also requires its secret
//                      to be present at drain time (a flag-on channel with no secret is recorded "skipped").
//
// The config carries NO secrets; channel API tokens live only in the Worker secret store. Reconcile mirrors the
// normalized config (minus nothing sensitive) to the KV key `synd:config` so the Worker reads the live values
// without a redeploy (the overrides:mirror precedent).

export const SYNDICATION_CONFIG_PATH = 'house/syndication-config.yml';
export const SYNDICATION_MIRROR_KEY = 'synd:config';

// The canonical channel set. Adding a channel here makes it a recognized, normalizable flag.
// SOW-087: `discord-category` is the SECOND Discord post — the same item posted again to the channel mapped to
// its category in house/content-channels.yml (the featured per-type `discord` post is unchanged). A first-class
// channel so it gets its own on/off switch and its own per-channel idempotency in the queue.
export const CHANNELS = Object.freeze(['discord', 'discord-category', 'x', 'linkedin', 'mastodon', 'bluesky', 'reddit', 'devto']);
// SOW-088: the channels a per-channel TEMPLATE override may target (the admin Channels tab tiles). Same set
// as the pipeline switches; blank/missing overrides fall back to the shared `templates` map, then built-ins.
export const TEMPLATE_CHANNELS = CHANNELS;

// SOW-087: how a share's topic category is suggested at compose time. `ai` = Workers AI with a keyword
// fallback; `keyword` = the free keyword match only; `off` = no suggestion (the member picks by hand).
export const CLASSIFY_MODES = Object.freeze(['ai', 'keyword', 'off']);

// SOW-111: which membership tiers count toward the news engagement auto-share. Banned is ALWAYS excluded
// (the Worker gates by effective status, and a banned account is denied before any KV write).
export const NEWS_ENGAGEMENT_TIERS = Object.freeze(['paid', 'paid-trial', 'signed-in']);

export const DEFAULT_NEWS_ENGAGEMENT = Object.freeze({
  enabled: false, // fail-closed: nothing auto-posts until the owner flips it in house/syndication-config.yml
  open_threshold: 2, // distinct members opening the detail view before the item auto-posts
  tier: 'paid', // whose engagement counts (owner-toggleable in the admin Channels tab)
  comment_autopost: true, // one comment posts immediately (deliberate engagement)
});

// SOW-087: per-type Discord post templates. Variables: {memberdiscord} (the resolved <@id> mention, falling
// back to the no-ping full name when none resolves), {member-discord-username} (the mention, else the public
// profile Discord handle, else the GitHub username; SOW-088), {content-type} (article/product/prompt/link),
// {fullName}, {author}, {shareurl}/{url}, {title}, {category}. A type with no template gets its default.
export const TEMPLATE_TYPES = Object.freeze(['share', 'post', 'product', 'prompt', 'reddit-body', 'reddit-comment', 'devto-intro', 'devto-footer', 'devto-stub']);
// SOW-088 (owner-directed): ONE default Discord format for every type.
const DEFAULT_FORMAT = 'New {content-type} published by {member-discord-username}: "{title}" {url}';
// SOW-088: the Reddit BODY template = the DESCRIPTION under the title on the link post (the embed card
// comes from the item URL automatically); the COMMENT template = the separately-controlled first comment
// (owner-directed 2026-07-10: keep both, templated independently). Editable in the admin templates card.
const DEFAULT_REDDIT_BODY = '{short-description}';
// SOW-088: the dev.to byline prepended to the full-body crosspost (the owner's example post shape).
const DEFAULT_DEVTO_INTRO = '**By [{fullName}]({member-url}), GBTI Network Member.** Originally published on [gbti.network]({url}).';
// The CTA appended to EVERY dev.to post, full and stub alike (owner-authored, mirroring the Reddit
// first-comment closing).
const DEFAULT_DEVTO_FOOTER = '---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}\'s work more closely, consider joining our network and subscribing to them directly: {member-url}';
const DEFAULT_REDDIT_COMMENT = 'The resource shared in this post is a new {content-type} published by GBTI Network member {fullName}. More information provided in the following author note:\n\n"{author-note-italic}"\n\n---\n\nAre you a writer, musician, or product developer? We would love to support your work on the GBTI Network. For more information about how to join our community visit https://gbti.network\n\nTo follow {fullName}\'s work more closely, consider joining our network and subscribing to them directly: {member-url}';
export const DEFAULT_TEMPLATES = Object.freeze({
  share: DEFAULT_FORMAT,
  post: DEFAULT_FORMAT,
  product: DEFAULT_FORMAT,
  prompt: DEFAULT_FORMAT,
  'reddit-body': DEFAULT_REDDIT_BODY,
  'reddit-comment': DEFAULT_REDDIT_COMMENT,
  'devto-intro': DEFAULT_DEVTO_INTRO,
  'devto-footer': DEFAULT_DEVTO_FOOTER,
});

// SOW-088 Proposal A (owner-approved 2026-07-11): every channel gets a distinct template SET for
// MEMBERS-ONLY (stub) items. Built-in defaults carry tasteful per-channel differentiation (the owner
// rider): each channel's default stub reads native to that channel with no configuration. Keys with no
// stub built-in (reddit-comment, devto-intro, devto-footer) inherit the public chain.
const STUB_FORMAT = 'Members-only on the GBTI Network: "{title}" by {fullName}. {short-description} {url}';
export const DEFAULT_STUB_TEMPLATES = Object.freeze({
  share: STUB_FORMAT,
  post: STUB_FORMAT,
  product: STUB_FORMAT,
  prompt: STUB_FORMAT,
  'reddit-body': '{short-description}\n\nThis {content-type} is part of the GBTI Network members library. Membership unlocks the full piece: {url}',
  'devto-stub': '{short-description}\n\n**[Read the full {content-type} on gbti.network]({url}).** Membership unlocks it, and members earn from the work they publish.',
});
const DISCORD_STUB = '{member-discord-username} published a members-only {content-type}: "{title}". Members can read it on gbti.network. {url}';
// A members SHARE is just an external link, so it posts the destination directly (no "read it on
// gbti.network", which points off-site): owner-directed 2026-07-13.
const DISCORD_SHARE_STUB = '{member-discord-username} shared the following link: "{title}" {url}';
const DISCORD_CAT_STUB = 'A members-only {content-type} landed in {category}: "{title}" by {member-discord-username}. {url}';
const DISCORD_CAT_SHARE_STUB = '{member-discord-username} shared a link in {category}: "{title}" {url}';
const REDDIT_TITLE_STUB = '{title} (a members-only {content-type} from the GBTI Network)';
// SOW-120: X is 280 chars, so the stub is a tight hook plus the link (X auto-cards the URL). A members
// share posts the destination directly; a members post/product/prompt invites the reader to unlock it.
const X_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
const X_SHARE_STUB = '{fullName} shared a members-only link: "{title}". Join the GBTI Network to open it. {url}';
// SOW-122: Bluesky stubs omit {url} because the adapter attaches an external embed card for the link.
const BLUESKY_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it.';
const BLUESKY_SHARE_STUB = '{fullName} shared a members-only link: "{title}". Join the GBTI Network to open it.';
// SOW-123: Mastodon includes {url} (Mastodon auto-links + builds a preview card from it).
const MASTODON_STUB = 'Members-only on the GBTI Network: "{title}" by {fullName}. Membership unlocks it. {url}';
const MASTODON_SHARE_STUB = '{fullName} shared a members-only link: "{title}". Join the GBTI Network to open it. {url}';
export const DEFAULT_CHANNEL_STUB_TEMPLATES = Object.freeze({
  discord: Object.freeze({ share: DISCORD_SHARE_STUB, post: DISCORD_STUB, product: DISCORD_STUB, prompt: DISCORD_STUB }),
  'discord-category': Object.freeze({ share: DISCORD_CAT_SHARE_STUB, post: DISCORD_CAT_STUB, product: DISCORD_CAT_STUB, prompt: DISCORD_CAT_STUB }),
  reddit: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  // dev.to titles are article titles: a clean suffix, never the sentence-shaped shared stub.
  devto: Object.freeze({ share: REDDIT_TITLE_STUB, post: REDDIT_TITLE_STUB, product: REDDIT_TITLE_STUB, prompt: REDDIT_TITLE_STUB }),
  x: Object.freeze({ share: X_SHARE_STUB, post: X_STUB, product: X_STUB, prompt: X_STUB }),
  bluesky: Object.freeze({ share: BLUESKY_SHARE_STUB, post: BLUESKY_STUB, product: BLUESKY_STUB, prompt: BLUESKY_STUB }),
  mastodon: Object.freeze({ share: MASTODON_SHARE_STUB, post: MASTODON_STUB, product: MASTODON_STUB, prompt: MASTODON_STUB }),
});

export const DEFAULT_SYNDICATION_CONFIG = Object.freeze({
  enabled: false,
  require_approval: true, // SOW-058: opt-IN by default — NOTHING posts until a superadmin approves it
  hold_minutes: 60,
  upvote_threshold: 2,
  classify: 'ai', // SOW-087: the share category suggestion mode
  templates: DEFAULT_TEMPLATES, // SOW-087: per-type Discord templates (missing/empty type = its default)
  channel_templates: Object.freeze({}), // SOW-088: per-channel template OVERRIDES (channel -> type -> template)
  stub_templates: Object.freeze({}), // SOW-088 Proposal A: the shared MEMBERS-stub set (configured only)
  channel_templates_stub: Object.freeze({}), // SOW-088 Proposal A: per-channel stub overrides
  news_engagement: DEFAULT_NEWS_ENGAGEMENT, // SOW-111: engagement-triggered news auto-share
  channels: Object.freeze({ discord: false, 'discord-category': false, x: false, linkedin: false, mastodon: false, bluesky: false, reddit: false, devto: false }),
  // SOW-121: channels the system NEVER auto-posts to (their adapter is never called). Instead a
  // superadmin manual-assist task is enqueued (Social Queue) and a human posts it by hand. Used for
  // pay-to-post channels like X after the free API tier was deprecated. A channel here should be OFF in
  // `channels` (the two are mutually exclusive: auto-post vs manual-assist).
  manual_assist_channels: Object.freeze([]),
});

function asBool(v, fallback) {
  if (v === true || v === false) return v;
  if (v === 1 || v === 0) return v === 1; // YAML may parse a bare 1/0 as a number
  if (typeof v === 'string') {
    const s = v.trim().toLowerCase();
    if (s === 'true' || s === 'yes' || s === 'on' || s === '1') return true;
    if (s === 'false' || s === 'no' || s === 'off' || s === '0') return false;
  }
  return fallback;
}

function asHoldMinutes(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.floor(n));
}

function asThreshold(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i >= 1 ? i : fallback; // never below 1 (a threshold of 0 would syndicate on any single vote)
}

function asClassifyMode(v, fallback) {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : '';
  return CLASSIFY_MODES.includes(s) ? s : fallback;
}

// SOW-111: normalize the news engagement block; every field falls back to its fail-closed default.
function normalizeNewsEngagement(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const d = DEFAULT_NEWS_ENGAGEMENT;
  const tier = typeof src.tier === 'string' && NEWS_ENGAGEMENT_TIERS.includes(src.tier.trim().toLowerCase())
    ? src.tier.trim().toLowerCase() : d.tier;
  return Object.freeze({
    enabled: asBool(src.enabled, d.enabled),
    open_threshold: asThreshold(src.open_threshold, d.open_threshold),
    tier,
    comment_autopost: asBool(src.comment_autopost, d.comment_autopost),
  });
}

// SOW-087: a missing/blank per-type template falls back to its default (an absent default = built-in message).
function normalizeTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === 'string' ? src[t].trim() : '';
    const d = DEFAULT_TEMPLATES[t];
    if (v) out[t] = v;
    else if (d) out[t] = d;
  }
  return Object.freeze(out);
}

// SOW-088: per-channel template overrides. Only known channels and types survive; blanks are dropped (they
// mean "fall back"), and a channel with no surviving overrides is omitted entirely.
function normalizeChannelTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const ch of TEMPLATE_CHANNELS) {
    const block = src[ch];
    if (!block || typeof block !== 'object' || Array.isArray(block)) continue;
    const kept = {};
    for (const t of TEMPLATE_TYPES) {
      const v = typeof block[t] === 'string' ? block[t].trim() : '';
      if (v) kept[t] = v;
    }
    if (Object.keys(kept).length) out[ch] = Object.freeze(kept);
  }
  return Object.freeze(out);
}

// The stub maps are CONFIGURED-ONLY (never fold defaults in; the 2026-07-10 mirror lesson): resolution
// consults the defaults at read time so code-default changes track deploys.
function normalizeConfiguredTemplates(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const out = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof src[t] === 'string' ? src[t].trim() : '';
    if (v) out[t] = v;
  }
  return Object.freeze(out);
}

function normalizeChannels(raw) {
  const out = {};
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  for (const name of CHANNELS) out[name] = asBool(src[name], DEFAULT_SYNDICATION_CONFIG.channels[name]);
  return Object.freeze(out);
}

// SOW-121: the manual-assist channel list (only known channel names, de-duplicated).
function normalizeManualAssist(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const out = [];
  for (const v of list) { const s = String(v ?? '').trim(); if (CHANNELS.includes(s) && !out.includes(s)) out.push(s); }
  return Object.freeze(out);
}

/**
 * Normalize a parsed syndication-config.yml ({ syndication: {...} } or a bare {...}) into a validated config.
 * Unknown/missing keys fall back to DEFAULT_SYNDICATION_CONFIG. Never throws.
 */
export function syndicationConfigFromParsed(parsed) {
  const raw = parsed?.syndication ?? parsed ?? {};
  const d = DEFAULT_SYNDICATION_CONFIG;
  return Object.freeze({
    enabled: asBool(raw.enabled, d.enabled),
    require_approval: asBool(raw.require_approval, d.require_approval),
    hold_minutes: asHoldMinutes(raw.hold_minutes, d.hold_minutes),
    upvote_threshold: asThreshold(raw.upvote_threshold, d.upvote_threshold),
    classify: asClassifyMode(raw.classify, d.classify),
    templates: normalizeTemplates(raw.templates),
    channel_templates: normalizeChannelTemplates(raw.channel_templates),
    stub_templates: normalizeConfiguredTemplates(raw.stub_templates),
    channel_templates_stub: normalizeChannelTemplates(raw.channel_templates_stub),
    news_engagement: normalizeNewsEngagement(raw.news_engagement),
    channels: normalizeChannels(raw.channels),
    manual_assist_channels: normalizeManualAssist(raw.manual_assist_channels), // SOW-121
  });
}

/** Master switch: may anything be enqueued/syndicated at all? */
export function isSyndicationEnabled(cfg) {
  return cfg?.enabled === true;
}

/** SOW-058: when true (the default), the drain posts ONLY superadmin-approved items; a pending item never posts on
 *  its own. Fail-safe: anything other than an explicit false means approval IS required. */
export function requiresApproval(cfg) {
  return cfg?.require_approval !== false;
}

/** The hold window in milliseconds (hold_minutes * 60000). */
export function holdMs(cfg) {
  return asHoldMinutes(cfg?.hold_minutes, DEFAULT_SYNDICATION_CONFIG.hold_minutes) * 60_000;
}

/** The SOW-057 distinct-non-author-voter threshold. */
export function upvoteThreshold(cfg) {
  return asThreshold(cfg?.upvote_threshold, DEFAULT_SYNDICATION_CONFIG.upvote_threshold);
}

/** SOW-087: the share category suggestion mode (`ai` | `keyword` | `off`). Invalid/missing = `ai`. */
export function classifyMode(cfg) {
  return asClassifyMode(cfg?.classify, DEFAULT_SYNDICATION_CONFIG.classify);
}

/** SOW-111: the normalized news engagement settings ({ enabled, open_threshold, tier, comment_autopost }). */
export function newsEngagement(cfg) {
  return normalizeNewsEngagement(cfg?.news_engagement);
}

/** SOW-087 (+ SOW-088): the configured template for a source type, or null (= the built-in message).
 *  With a channel, the chain is channel override -> the shared map -> the built-in default. With
 *  { stub: true } (a members-only item) the STUB chain runs first: channel stub override -> shared stub
 *  -> the per-channel built-in stub -> the shared built-in stub -> then the full public chain. */
export function templateFor(cfg, source, channel, { stub = false, channelOnly = false } = {}) {
  if (stub) {
    const cs = channel ? cfg?.channel_templates_stub?.[channel]?.[source] : null;
    if (typeof cs === 'string' && cs.trim()) return cs.trim();
    if (!channelOnly) {
      const ss = cfg?.stub_templates?.[source];
      if (typeof ss === 'string' && ss.trim()) return ss.trim();
    }
    const dc = channel ? DEFAULT_CHANNEL_STUB_TEMPLATES[channel]?.[source] : null;
    if (dc) return dc;
    if (!channelOnly && DEFAULT_STUB_TEMPLATES[source]) return DEFAULT_STUB_TEMPLATES[source];
    // no stub-specific template anywhere: fall through to the public chain
  }
  const o = channel ? cfg?.channel_templates?.[channel]?.[source] : null;
  if (typeof o === 'string' && o.trim()) return o.trim();
  // channelOnly (SOW-088: reddit/devto TITLES): the shared per-type map is Discord-voiced message copy
  // and must never become a post title; the caller supplies its own fallback (usually {title}).
  if (channelOnly) return null;
  const t = cfg?.templates?.[source];
  return typeof t === 'string' && t.trim() ? t.trim() : (DEFAULT_TEMPLATES[source] ?? null);
}

/** Is a given channel switched on in config? (Its secret presence is checked separately at drain time.) */
export function isChannelEnabled(cfg, name) {
  return cfg?.channels?.[name] === true;
}

/** The list of channel names switched on in config (still subject to secret presence at drain time). */
export function enabledChannelNames(cfg) {
  return CHANNELS.filter((name) => isChannelEnabled(cfg, name));
}

/** SOW-121: is this channel manual-assist (never auto-posted; enqueues a Social Queue task instead)? */
export function isManualAssist(cfg, name) {
  return Array.isArray(cfg?.manual_assist_channels) && cfg.manual_assist_channels.includes(name);
}

/** SOW-121: the manual-assist channel names (a copy). */
export function manualAssistChannels(cfg) {
  return Array.isArray(cfg?.manual_assist_channels) ? [...cfg.manual_assist_channels] : [];
}

/** The small, secret-free object reconcile writes to the KV mirror (synd:config) and the Worker reads back. */
export function toSyndicationMirror(cfg) {
  const c = syndicationConfigFromParsed(cfg);
  // Templates carry ONLY the CONFIGURED values (never the folded-in defaults): every mirror reader
  // re-normalizes via syndicationConfigFromParsed, so code-default changes apply on deploy instead of
  // being frozen into KV as if an admin had configured them (hit live 2026-07-10: the old reddit-body
  // default kept pre-filling after the default changed).
  const raw = (cfg?.syndication ?? cfg ?? {});
  const rawTemplates = raw.templates && typeof raw.templates === 'object' && !Array.isArray(raw.templates) ? raw.templates : {};
  const configured = {};
  for (const t of TEMPLATE_TYPES) {
    const v = typeof rawTemplates[t] === 'string' ? rawTemplates[t].trim() : '';
    if (v) configured[t] = v;
  }
  return { enabled: c.enabled, require_approval: c.require_approval, hold_minutes: c.hold_minutes, upvote_threshold: c.upvote_threshold, classify: c.classify, templates: configured, channel_templates: JSON.parse(JSON.stringify(c.channel_templates)), stub_templates: { ...c.stub_templates }, channel_templates_stub: JSON.parse(JSON.stringify(c.channel_templates_stub)), news_engagement: { ...c.news_engagement }, channels: { ...c.channels }, manual_assist_channels: [...c.manual_assist_channels] };
}
