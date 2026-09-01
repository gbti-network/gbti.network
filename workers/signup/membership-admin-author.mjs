// sow-161: POST /membership/admin/author — server-side admin mutations.
//   Increment 1 (moderator+): content moderation — deplatform (status -> draft), republish (-> published), remove.
//   Increment 2 (admin+):     member status — ban / unban / grandfather / ungrandfather (house/bans.yml,
//                             house/grandfathered.yml), via the pure superadmin-actions cores.
//   Increment 3 (superadmin): role assignment — role (house/roles.yml, the ROOT OF TRUST, Tier S).
//   Increment 4 (admin+):     config managers — quotes (house/quotes.yml) + news sources (house/news-sources.yml);
//                             leading comment preserved, table-driven per-action input/slug. More managers extend
//                             the CONFIG_OP table. Reads: membershipAdminQuotePool / membershipAdminNewsSourcePool.
//
// The cookie session has no GitHub token, so the Worker applies the change and opens the PR with GBTI's
// INSTALLATION token; the SOW-005 gate is the only merger. Two properties keep this safe:
//   1. The mutation is computed SERVER-SIDE. The caller names an ACTION + a target PATH, never file content, so a
//      moderator can only flip status or remove, never rewrite another member's words.
//   2. The PR is committed to `hosted-admin/<callerGithubId>/<action-slug>` with the github_id ALWAYS taken from
//      the verified session/token (never the body). The gate resolves that id -> its git-native role and re-checks
//      it against the touched path (decide()), so even a bug here cannot merge beyond the caller's real role.
//
// CSRF: the cookie path enforces the double-submit token inside resolveIdentity (a POST is a non-safe method); the
// bearer path (extension) needs none. Everything is injectable (fetchImpl, authorize, kv, limiter) for unit tests.

import { authorizeStaff, authorizeAdmin, authorizeSuperadmin } from './membership-admin.mjs';
import { getInstallationToken } from './github-app.mjs';
import { rateLimit } from './abuse.mjs';
import { flipContentStatus, retagContent } from '../../client/src/content-ops.mjs'; // already in the Worker bundle (membership-shares); sow-161 A: retag for tag-edit
import { isCleanPath } from '../../membership/classify-pr.mjs';
import { adminHostedBranchFor } from '../../membership/hosted-author.mjs';
import { ban, unban, grandfather, revokeGrandfather, grantRole } from '../../membership/superadmin-actions.mjs'; // sow-161 increments 2-3
import { PAID_GRANT_TIERS } from '../../membership/tier-gate.mjs'; // sow-213: the paid tiers a grandfather grant may name
import { writeOverrideToKv, appendModerationLog } from './membership-override-kv.mjs'; // sow-213 Phase 2b + 2c
import { fireRepositoryDispatch } from './membership-admin-ops.mjs'; // sow-213 Phase 2b: the post-role-change mirror refresh
import { addQuote, removeQuote, setQuoteEnabled } from '../../membership/quote-edits.mjs'; // sow-161 increment 4
import { addSource, removeSource, setSourceEnabled } from '../../membership/news-source-edits.mjs'; // sow-161 increment 4
import { addCouponEdit, updateCouponEdit } from '../../membership/coupon-edits.mjs'; // sow-161 increment 4 (coupons)
import { normalizeCouponCode, COUPON_CODE_RE } from '../../membership/coupons.mjs'; // sow-161 increment 4 (coupons)
import { setSiteToggle, readAllToggles, SITE_TOGGLES } from '../../membership/site-settings-edits.mjs'; // sow-271
import { addCategory as addCategoryEdit, renameLabel as renameLabelEdit, TaxonomyEditError } from '../../membership/taxonomy-edits.mjs'; // sow-161 A: category-batch taxonomy ops
import { setChannel as setChannelEdit, removeChannel as removeChannelEdit, ContentChannelEditError } from '../../membership/content-channels-edits.mjs'; // sow-161 A: category-batch channel ops
import { rankForPath, maxRankForPaths } from '../../membership/path-rank.mjs'; // sow-161 A: the multi-file max-rank gate (matches CODEOWNERS, unlike classify-pr)
// sow-161 B (channel-map manager, superadmin): the moderation-flags + syndication config write cores + the read
// helpers. All three files (moderation-flags.yml, syndication-config.yml) are superadmin-pinned in CODEOWNERS +
// SUPERADMIN_HOUSE_FILES, so every write row below is superadmin and the drift guard agrees with rankForPath.
import { addFlagTerm, removeFlagTerm } from '../../membership/moderation-flags-edits.mjs'; // sow-161 B
import { setTemplate as setTemplateEdit, setNewsEngagement as setNewsEngagementEdit, setContentEngagement as setContentEngagementEdit, setSyndicationSettings as setSyndicationSettingsEdit, SYNDICATION_CHANNEL_NAMES } from '../../membership/syndication-template-edits.mjs'; // sow-161 B
import { syndicationConfigFromParsed, TEMPLATE_TYPES, TEMPLATE_CHANNELS, newsEngagement, NEWS_ENGAGEMENT_TIERS, contentEngagement, CONTENT_ENGAGEMENT_SIGNALS, AUTO_TYPES, AUTO_CHANNELS, MATRIX_CHANNELS, AUTO_MODES, CHANNEL_CAPABILITY } from '../../membership/syndication-config-core.mjs'; // sow-161 B: the channel-map pool reads
import yaml from 'js-yaml'; // already in the Worker bundle (content-ops)

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });
const ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

// Increment 1: content moderation (moderator+). remove is a delete; the others flip status.
const CONTENT_ACTIONS = new Set(['deplatform', 'republish', 'remove']);
const STATUS_FOR = { deplatform: 'draft', republish: 'published' };
// A content item index.md under a member OR house content folder (posts/products/prompts). The gate re-checks the
// caller's authority over this path; this regex only bounds the shape (a clean content item, never a config file).
const CONTENT_ITEM_RE = /^(?:members\/[a-z0-9][a-z0-9-]*|house)\/(?:posts|products|prompts)\/[a-z0-9][a-z0-9-]*\/index\.md$/;

// Increments 2-3: governance mutations. Each action targets a FIXED governance file (never derived from input) and
// applies a pure, node-free core from superadmin-actions.mjs. github_id-keyed. Per-action REQUIRED rank: member
// status is ADMIN+ (Tier A: house/bans.yml, house/grandfathered.yml); ROLE ASSIGNMENT is SUPERADMIN+ (Tier S:
// house/roles.yml, the ROOT OF TRUST). The gate independently re-checks the branch id's role vs the touched Tier,
// so an under-privileged caller cannot mutate even if the endpoint rank check erred (two-authority model).
const GITHUB_ID_RE = /^\d{1,20}$/;
const VALID_ROLES = new Set(['member', 'moderator', 'admin', 'superadmin']);
const GOV_ACTIONS = new Set(['ban', 'unban', 'grandfather', 'ungrandfather', 'role']);
// sow-213 Phase 2b: the overrides-mirror section each governance action dual-writes. `role` is null on
// purpose: house/roles.yml stays git-native by owner ruling as the root of trust, so it has no KV half.
const GOV_KV_SECTION = { ban: 'bans', unban: 'bans', grandfather: 'grandfathered', ungrandfather: 'grandfathered', role: null };
const GOV_KV_REMOVES = new Set(['unban', 'ungrandfather']);
const GOV_OP = {
  ban: { path: 'house/bans.yml', rank: ROLE_RANK.admin, fn: ban, args: (t) => ({ githubId: t.targetId, reason: t.reason }) },
  unban: { path: 'house/bans.yml', rank: ROLE_RANK.admin, fn: unban, args: (t) => ({ githubId: t.targetId }) },
  grandfather: { path: 'house/grandfathered.yml', rank: ROLE_RANK.admin, fn: grandfather, args: (t) => ({ githubId: t.targetId, reason: t.reason, until: t.until, tier: t.tier }) },
  ungrandfather: { path: 'house/grandfathered.yml', rank: ROLE_RANK.admin, fn: revokeGrandfather, args: (t) => ({ githubId: t.targetId }) },
  role: { path: 'house/roles.yml', rank: ROLE_RANK.superadmin, fn: grantRole, args: (t) => ({ githubId: t.targetId, role: t.role }) },
};
// Increment 4: config-manager mutations. Same fixed-path + pure-core + fail-closed-parse + hosted-admin-branch +
// gate-recheck pattern as the governance actions, with TWO differences: the target is a text/string key (not a
// github_id), and the config file carries a LEADING COMMENT that must be PRESERVED across the edit (governance
// files have none). Sub-slice 1: quotes (house/quotes.yml, admin-tier). More managers extend this table.
// Each config action is table-driven: `input(payload)` validates + extracts the action's fields (returning
// { ok, args } or a { ok:false, status, body } rejection), `fn` is the pure edit core, `slug(args)` names the
// branch. The key differs by manager (a quote's text vs a source's id), so validation is per-action, never a
// path from the body. `SOURCE_ID_RE` bounds a source id; `idSlug` bounds the branch segment.
// Kebab-case, matching membership/news-source-edits.mjs ID_RE (no trailing/consecutive hyphens); length-capped so
// the endpoint rejects an invalid id with a clear message rather than letting the pure core throw.
const SOURCE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const idSlug = (s) => (String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'item');
// Match the pure quote-edits caps (MAX_TEXT=280, MAX_AUTHOR=80) EXACTLY, so the endpoint rejects an over-long
// value instead of the core SILENTLY truncating it (a real UX bug the review caught).
const QUOTE_MAX_TEXT = 280;
const QUOTE_MAX_AUTHOR = 80;
// Match the pure news-source-edits caps (MAX_NAME=80, MAX_DESC=120) EXACTLY, same reason: reject an over-long
// value at the endpoint instead of the core SILENTLY truncating it (the endpoint used to slice at 120 / 500).
const SOURCE_MAX_NAME = 80;
const SOURCE_MAX_DESC = 120;
// quotes: a required text key (+ optional author / enabled).
function quoteInput(p) {
  const text = typeof p?.text === 'string' ? p.text.trim() : '';
  if (!text || text.length > QUOTE_MAX_TEXT) return { ok: false, status: 400, body: { error: 'bad_request', message: `a quote text is required (max ${QUOTE_MAX_TEXT} chars)` } };
  const author = typeof p?.author === 'string' ? p.author.trim() : undefined;
  if (author && author.length > QUOTE_MAX_AUTHOR) return { ok: false, status: 400, body: { error: 'bad_request', message: `the author is too long (max ${QUOTE_MAX_AUTHOR} chars)` } };
  const enabled = p?.enabled === undefined ? undefined : Boolean(p.enabled);
  return { ok: true, args: { text, author, enabled } };
}
// news sources: an add with { name, url(http/s), optional id/description }, or a remove/toggle by id.
function sourceAddInput(p) {
  const name = typeof p?.name === 'string' ? p.name.trim() : '';
  const id = typeof p?.id === 'string' ? p.id.trim().toLowerCase() : '';
  const url = typeof p?.url === 'string' ? p.url.trim() : '';
  const description = typeof p?.description === 'string' ? p.description.trim() : undefined;
  let u; try { u = new URL(url); } catch { u = null; }
  if (!u || !/^https?:$/.test(u.protocol)) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a valid http(s) feed URL is required' } };
  if (id && (id.length > 64 || !SOURCE_ID_RE.test(id))) return { ok: false, status: 400, body: { error: 'bad_request', message: 'an invalid source id was given' } };
  if (!name && !id) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a source name or id is required' } };
  if (name.length > SOURCE_MAX_NAME) return { ok: false, status: 400, body: { error: 'bad_request', message: `the source name is too long (max ${SOURCE_MAX_NAME} chars)` } };
  if (description && description.length > SOURCE_MAX_DESC) return { ok: false, status: 400, body: { error: 'bad_request', message: `the description is too long (max ${SOURCE_MAX_DESC} chars)` } };
  return { ok: true, args: { ...(id ? { id } : {}), name, url, description } };
}
function sourceIdInput(p, { enabled = false } = {}) {
  const id = typeof p?.id === 'string' ? p.id.trim().toLowerCase() : '';
  if (!id || id.length > 64 || !SOURCE_ID_RE.test(id)) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a valid source id is required' } };
  return { ok: true, args: enabled ? { id, enabled: Boolean(p?.enabled) } : { id } };
}
// coupons (SOW-119 registry): the coupon-edits core validates freeDays / maxRedemptions / expiresAt and THROWS a
// clean CouponEditError on a bad value (surfaced as a 400 by the config branch), so the endpoint only pre-checks
// the code shape (a valid branch slug depends on it) and the ONE field the core would SILENTLY truncate: the note
// (MAX_NOTE=160). Match that cap here so an over-long note is rejected, not quietly cut.
const COUPON_MAX_NOTE = 160;
function couponAddInput(p) {
  const code = normalizeCouponCode(p?.code);
  if (!COUPON_CODE_RE.test(code)) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a coupon code is 3-32 chars A-Z 0-9' } };
  if (p?.freeDays === undefined || p?.freeDays === null || p?.freeDays === '') return { ok: false, status: 400, body: { error: 'bad_request', message: 'freeDays is required' } };
  const note = typeof p?.note === 'string' ? p.note : undefined;
  if (note && note.length > COUPON_MAX_NOTE) return { ok: false, status: 400, body: { error: 'bad_request', message: `the note is too long (max ${COUPON_MAX_NOTE} chars)` } };
  // freeDays / maxRedemptions / expiresAt are validated (and thrown on) by addCouponEdit; pass them through.
  return { ok: true, args: { code, freeDays: p.freeDays, note, maxRedemptions: p?.maxRedemptions ?? null, expiresAt: p?.expiresAt ?? null } };
}
function couponUpdateInput(p) {
  const code = normalizeCouponCode(p?.code);
  if (!COUPON_CODE_RE.test(code)) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a coupon code is 3-32 chars A-Z 0-9' } };
  const patch = (p?.patch && typeof p.patch === 'object' && !Array.isArray(p.patch)) ? p.patch : null;
  if (!patch) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a patch object is required' } };
  if (typeof patch.note === 'string' && patch.note.length > COUPON_MAX_NOTE) return { ok: false, status: 400, body: { error: 'bad_request', message: `the note is too long (max ${COUPON_MAX_NOTE} chars)` } };
  // The core (updateCouponEdit) validates each patched field and throws on an empty/invalid patch -> a clean 400.
  return { ok: true, args: { code, patch } };
}

// sow-271: a site toggle names a KEY from the shared SITE_TOGGLES registry and a boolean. The key is validated
// against the registry HERE as well as in the core, so an unknown key is a clean 400 rather than a 500 out of the
// edit function. `enabled` must be a real boolean on the wire: accepting "false" would set the toggle ON.
function siteToggleInput(p) {
  const key = typeof p?.key === 'string' ? p.key.trim().toLowerCase() : '';
  if (!key || !SITE_TOGGLES[key]) {
    return { ok: false, status: 400, body: { error: 'bad_request', message: `unknown site setting (known: ${Object.keys(SITE_TOGGLES).join(', ')})` } };
  }
  if (typeof p?.enabled !== 'boolean') return { ok: false, status: 400, body: { error: 'bad_request', message: 'enabled must be true or false' } };
  return { ok: true, args: { key, enabled: p.enabled } };
}

// sow-161 B (channel-map manager, superadmin). Every input below is a THIN shape check: the pure cores
// (addFlagTerm / setTemplate / setNewsEngagement / setContentEngagement / setSyndicationSettings) validate every
// value exhaustively and throw ModerationFlagEditError / TemplateEditError, which the config branch catches as a
// clean 400. So these only reject a value the core would ACCEPT-BUT-MISREAD (a missing required key, a non-array
// batch), and otherwise pass the payload through unchanged, preserving undefined-vs-explicit (the cores leave an
// omitted key alone). A flagged word list + syndication templates are superadmin data; the ROUTES are
// superadmin-gated, and these rows are pinned superadmin so the multi-file gate and CODEOWNERS agree.
function flagTermInput(p) {
  const list = typeof p?.list === 'string' ? p.list.trim() : '';
  const term = typeof p?.term === 'string' ? p.term : '';
  if (!list) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a flag list name is required' } };
  if (!term.trim()) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a non-empty term is required' } };
  return { ok: true, args: { list, term } };
}
function newsEngagementInput(p) {
  // Every field is optional; the core distinguishes undefined (leave alone) from an explicit value and validates
  // types + ranges. An all-undefined edit is a legitimate no-op (the core returns changed:false).
  return { ok: true, args: { enabled: p?.enabled, openThreshold: p?.openThreshold, tier: p?.tier, commentAutopost: p?.commentAutopost } };
}
function contentEngagementInput(p) {
  return { ok: true, args: { enabled: p?.enabled, threshold: p?.threshold, tier: p?.tier, signals: p?.signals } };
}
function syndicationSettingsInput(p) {
  return { ok: true, args: { enabled: p?.enabled, requireApproval: p?.requireApproval, holdMinutes: p?.holdMinutes, channels: p?.channels, autoMatrix: p?.autoMatrix, channelHoldMinutes: p?.channelHoldMinutes } };
}
const TEMPLATE_BATCH_MAX = 200; // types x channels x {shared,stub} is well under this; the cap only bounds abuse
function templatesBatchInput(p) {
  const edits = Array.isArray(p?.edits) ? p.edits : null;
  if (!edits || !edits.length) return { ok: false, status: 400, body: { error: 'bad_request', message: 'a non-empty edits array is required' } };
  if (edits.length > TEMPLATE_BATCH_MAX) return { ok: false, status: 400, body: { error: 'bad_request', message: `too many template edits (max ${TEMPLATE_BATCH_MAX})` } };
  return { ok: true, args: { edits } };
}

// sow-161 B: the syndication-template BATCH as ONE single-file CONFIG_OP fn. Unlike the other config fns (one
// edit), this loops setTemplate over the edits array against ONE doc (house/syndication-config.yml), mirroring
// client/src/admin-ops.mjs setSyndicationTemplates. Any bad edit throws TemplateEditError -> the config branch
// turns it into a 400, and the whole batch is refused (no partial write, since the file is serialized once after).
function setTemplatesBatch(parsed, { edits } = {}, ctx = {}) {
  let doc = parsed;
  let changed = false;
  for (const e of (Array.isArray(edits) ? edits : [])) {
    const r = setTemplateEdit(doc, { type: e?.type, template: e?.template, channel: e?.channel, stub: e?.stub === true }, ctx);
    doc = r.next;
    if (r.changed) changed = true;
  }
  return { next: doc, changed };
}

const CONFIG_ACTIONS = new Set([
  'quote-add', 'quote-remove', 'quote-toggle',
  'news-source-add', 'news-source-remove', 'news-source-toggle',
  'coupon-add', 'coupon-update',
  'site-setting-set',
  // sow-161 B (channel-map manager, superadmin): moderation flag terms + the syndication config surfaces.
  'flag-term-add', 'flag-term-remove',
  'syndication-templates-set', 'news-engagement-set', 'content-engagement-set', 'syndication-settings-set',
]);
const CONFIG_OP = {
  'quote-add': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: addQuote, input: quoteInput, slug: (a) => idSlug(a.text) },
  'quote-remove': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: removeQuote, input: quoteInput, slug: (a) => idSlug(a.text) },
  'quote-toggle': { path: 'house/quotes.yml', rank: ROLE_RANK.admin, fn: setQuoteEnabled, input: quoteInput, slug: (a) => idSlug(a.text) },
  'news-source-add': { path: 'house/news-sources.yml', rank: ROLE_RANK.admin, fn: addSource, input: sourceAddInput, slug: (a) => idSlug(a.id || a.name) },
  'news-source-remove': { path: 'house/news-sources.yml', rank: ROLE_RANK.admin, fn: removeSource, input: (p) => sourceIdInput(p), slug: (a) => idSlug(a.id) },
  'news-source-toggle': { path: 'house/news-sources.yml', rank: ROLE_RANK.admin, fn: setSourceEnabled, input: (p) => sourceIdInput(p, { enabled: true }), slug: (a) => idSlug(a.id) },
  // Coupons (house/coupons.yml, admin-owned). Add creates a code; update patches freeDays/active/note/etc. A coupon
  // is deactivated (active:false), never deleted, so redemption history + the git audit stay intact (no -remove).
  'coupon-add': { path: 'house/coupons.yml', rank: ROLE_RANK.admin, fn: addCouponEdit, input: couponAddInput, slug: (a) => idSlug(a.code) },
  'coupon-update': { path: 'house/coupons.yml', rank: ROLE_RANK.admin, fn: updateCouponEdit, input: couponUpdateInput, slug: (a) => idSlug(a.code) },
  // sow-271: site-wide presentation toggles. SUPERADMIN, unlike every other row in this table, and pinned to
  // the two superadmins in CODEOWNERS so the gate rejects anyone else's PR even if this rank were wrong. It
  // lives in the WORKER table (not extension-relay only, the way content-channels does) specifically so the
  // WEBSITE admin page can flip it, which is the direction sow-271 is moving the site.
  'site-setting-set': { path: 'house/site-settings.yml', rank: ROLE_RANK.superadmin, fn: setSiteToggle, input: siteToggleInput, slug: (a) => idSlug(a.key) },
  // sow-161 B: the channel-map manager's config writes. moderation-flags.yml + syndication-config.yml are both
  // superadmin-pinned in CODEOWNERS + SUPERADMIN_HOUSE_FILES, so rankForPath returns superadmin for each and the
  // DRIFT guard (test/path-rank.test.mjs) requires this hardcode to say superadmin too. A fixed per-surface slug
  // reuses ONE branch per surface (force-reset), matching admin-ops' fixed gbti/syndication-* branches; the flag
  // rows slug per (list, term) so distinct term edits do not clobber each other's open PR.
  'flag-term-add': { path: 'house/moderation-flags.yml', rank: ROLE_RANK.superadmin, fn: addFlagTerm, input: flagTermInput, slug: (a) => idSlug(`${a.list}-${a.term}`) },
  'flag-term-remove': { path: 'house/moderation-flags.yml', rank: ROLE_RANK.superadmin, fn: removeFlagTerm, input: flagTermInput, slug: (a) => idSlug(`${a.list}-${a.term}`) },
  'syndication-templates-set': { path: 'house/syndication-config.yml', rank: ROLE_RANK.superadmin, fn: setTemplatesBatch, input: templatesBatchInput, slug: () => 'syndication-templates' },
  'news-engagement-set': { path: 'house/syndication-config.yml', rank: ROLE_RANK.superadmin, fn: setNewsEngagementEdit, input: newsEngagementInput, slug: () => 'news-engagement' },
  'content-engagement-set': { path: 'house/syndication-config.yml', rank: ROLE_RANK.superadmin, fn: setContentEngagementEdit, input: contentEngagementInput, slug: () => 'content-engagement' },
  'syndication-settings-set': { path: 'house/syndication-config.yml', rank: ROLE_RANK.superadmin, fn: setSyndicationSettingsEdit, input: syndicationSettingsInput, slug: () => 'syndication-settings' },
};
// sow-161 A: MULTI-FILE ops. Unlike a single-file CONFIG_OP (one {path, rank} pair), these can touch several
// files at different tiers in one PR, so a single declared rank cannot express their real requirement. The
// `rank` here is only the FLOOR (the endpoint pre-check); the true requirement is computed at request time as
// maxRankForPaths over the RESOLVED file set (see the dispatch), which is why category-batch becomes superadmin
// the moment it carries a channel op even though its floor is admin. The build fn reads the affected files and
// applies the shared pure cores, returning { files } or a { response } short-circuit (error or clean no-op).
const MULTI_ACTIONS = new Set(['tag-edit', 'category-batch']);
const MULTI_OP = {
  'tag-edit': { rank: ROLE_RANK.admin, build: buildTagEdit },
  'category-batch': { rank: ROLE_RANK.admin, build: buildCategoryBatch },
};

// The minimum role rank an action requires at the endpoint (the gate is the independent backstop). For a
// multi-file op this is the FLOOR only; the dispatch re-checks the resolved file set against maxRankForPaths.
const requiredRank = (action) =>
  GOV_ACTIONS.has(action) ? GOV_OP[action].rank
    : CONFIG_ACTIONS.has(action) ? CONFIG_OP[action].rank
    : MULTI_ACTIONS.has(action) ? MULTI_OP[action].rank
    : ROLE_RANK.moderator;

// Preserve the leading comment block (a run of `#`/blank lines at the top) of a config file across a re-serialize,
// mirroring client/src/admin-ops.mjs leadingComment. Governance files have none, so this is config-only.
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}

// Read + parse a house YAML file from canonical main, FAIL CLOSED. Shared by the governance + config branches so
// they cannot disagree about "malformed = 502, not a silent reset". Returns { ok:true, parsed, raw } (raw kept for
// the config leading-comment preserve), or { ok:false, status, body }. A 404 is a legitimate empty fresh start.
async function loadHouseYaml(fetchImpl, instToken, upstream, path) {
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { ok: true, parsed: {}, raw: '' };
  if (!cur.ok) return { ok: false, status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  const raw = decodeContent((await cur.json().catch(() => ({})))?.content) ?? '';
  let loaded;
  try { loaded = raw ? yaml.load(raw) : {}; }
  catch { return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } }; }
  if (loaded === undefined || loaded === null) return { ok: true, parsed: {}, raw };
  if (typeof loaded !== 'object' || Array.isArray(loaded)) return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } };
  return { ok: true, parsed: loaded, raw };
}

// sow-161 A: read a RAW file (a content .md, which is not YAML). 404 -> { ok, raw: null } so a stale path in a
// batch is skipped, not fatal. Same contents API + App token loadHouseYaml uses.
async function loadRawFile(fetchImpl, instToken, upstream, path) {
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { ok: true, raw: null };
  if (!cur.ok) return { ok: false, status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  return { ok: true, raw: decodeContent((await cur.json().catch(() => ({})))?.content) ?? '' };
}

// sow-161 A: tag curation (rename / merge / retire a free-form tag across content items). A multi-FILE write:
// each path is read fresh and retagged with the SHARED pure core (retagContent), and only files that actually
// carry the tag are rewritten (retagContent no-ops otherwise), so the `paths` list from the client is a hint,
// never trusted. The path filter (CONTENT_ITEM_RE, the SAME regex the content-moderation route uses) is the
// first defence, keeping the op to members/house content items; the max-rank gate in the dispatch is the second
// (a non-content path would resolve to a higher tier and be refused). Mirrors client/src/admin-ops applyTagEdit.
async function buildTagEdit(payload, { fetchImpl, instToken, upstream }) {
  const mode = String(payload?.mode || payload?.action || '');
  if (!['rename', 'merge', 'retire'].includes(mode)) return { response: { status: 400, body: { error: 'bad_request', message: 'mode must be rename, merge, or retire' } } };
  const src = String(payload?.tag || '').trim().toLowerCase();
  if (!src) return { response: { status: 400, body: { error: 'bad_request', message: 'a tag is required' } } };
  const dest = mode === 'retire' ? null : String(payload?.to || '').trim().toLowerCase();
  if (mode !== 'retire' && !dest) return { response: { status: 400, body: { error: 'bad_request', message: `${mode} needs a destination tag` } } };
  if (dest && dest === src) return { response: { status: 400, body: { error: 'bad_request', message: 'the destination equals the source' } } };
  const list = (Array.isArray(payload?.paths) ? payload.paths : []).filter((p) => CONTENT_ITEM_RE.test(String(p)));
  if (!list.length || list.length > 100) return { response: { status: 400, body: { error: 'bad_request', message: 'between 1 and 100 content paths are required' } } };
  const files = [];
  for (const rel of list) {
    const r = await loadRawFile(fetchImpl, instToken, upstream, rel);
    if (!r.ok) return { response: { status: r.status, body: r.body } };
    if (r.raw == null) continue; // the file is gone since the client indexed it; skip, do not fail the batch
    const out = retagContent(r.raw, { tag: src, to: dest });
    if (out.changed) files.push({ path: rel, content: out.content });
  }
  if (!files.length) return { response: { status: 200, body: { ok: true, noop: true, message: `no item carries the tag "${src}"` } } };
  const verb = mode === 'retire' ? `Retire tag ${src}` : `${mode === 'merge' ? 'Merge' : 'Rename'} tag ${src} -> ${dest}`;
  return { files, slug: `tag-${mode}-${idSlug(src)}`, title: `${verb} (${files.length} item${files.length === 1 ? '' : 's'})` };
}

// sow-161 A: a batch of category-workspace edits as ONE PR. `label`/`add` edit house/taxonomy.yml (admin);
// `channel-set`/`channel-remove` edit house/content-channels.yml (superadmin-pinned in CODEOWNERS). A key rename
// / move / merge is NOT accepted here (those are review-gated `category-migrate` dispatches). The security is the
// max-rank gate: a batch carrying any channel op resolves to superadmin over the file set and an admin is refused.
// Mirrors client/src/admin-ops applyCategoryBatch, using the shared pure edit cores.
async function buildCategoryBatch(payload, { fetchImpl, instToken, upstream, githubId }) {
  const ops = Array.isArray(payload?.ops) ? payload.ops : [];
  if (!ops.length) return { response: { status: 400, body: { error: 'bad_request', message: 'the batch is empty' } } };
  for (const o of ops) {
    if (!['label', 'add', 'channel-set', 'channel-remove'].includes(o?.kind)) {
      return { response: { status: 400, body: { error: 'bad_request', message: `op kind "${o?.kind}" cannot batch (key rename/move/merge are review-gated migrations)` } } };
    }
  }
  const now = Date.now();
  const ctx = { actor: { githubId }, now };
  const files = [];
  const applyTo = async (path, opsForFile, applyOne, ErrType) => {
    if (!opsForFile.length) return null;
    const load = await loadHouseYaml(fetchImpl, instToken, upstream, path);
    if (!load.ok) return { response: { status: load.status, body: load.body } };
    let parsed = load.parsed; let changed = false;
    try {
      for (const op of opsForFile) {
        const r = applyOne(parsed, op);
        if (r.changed) { parsed = r.next; changed = true; }
      }
    } catch (e) {
      if (e instanceof ErrType) return { response: { status: 400, body: { error: 'bad_request', message: e.message } } };
      throw e;
    }
    if (changed) files.push({ path, content: leadingComment(load.raw) + yaml.dump(parsed, { lineWidth: 100, noRefs: true }) });
    return null;
  };
  const taxErr = await applyTo('house/taxonomy.yml', ops.filter((o) => o.kind === 'label' || o.kind === 'add'), (parsed, op) => (
    op.kind === 'add'
      ? addCategoryEdit(parsed, { parentPath: op.args?.parentPath ?? [], key: op.args?.key, label: op.args?.label }, ctx)
      : renameLabelEdit(parsed, { path: op.args?.path, label: op.args?.label }, ctx)
  ), TaxonomyEditError);
  if (taxErr) return taxErr;
  const chErr = await applyTo('house/content-channels.yml', ops.filter((o) => o.kind === 'channel-set' || o.kind === 'channel-remove'), (parsed, op) => (
    op.kind === 'channel-set'
      ? setChannelEdit(parsed, { category: op.args?.category, channelId: op.args?.channelId }, ctx)
      : removeChannelEdit(parsed, { category: op.args?.category }, ctx)
  ), ContentChannelEditError);
  if (chErr) return chErr;
  if (!files.length) return { response: { status: 200, body: { ok: true, noop: true, message: 'every batched edit was already applied' } } };
  const stamp = String(now).slice(-14);
  return { files, slug: `category-batch-${stamp}`, title: `Categories: ${files.length} file${files.length === 1 ? '' : 's'} updated` };
}

/** Standard base64 of a UTF-8 string, chunked. */
function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
/** Decode a GitHub Contents API base64 blob to a UTF-8 string, or null. */
function decodeContent(b64) {
  try {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}
/** A bounded, git-safe action slug for the branch (`deplatform-my-post`), from the item slug. */
function actionSlug(action, path) {
  const m = /\/([a-z0-9][a-z0-9-]*)\/index\.md$/.exec(path);
  return `${action}-${m ? m[1] : 'item'}`.slice(0, 80);
}

export async function membershipAdminAuthor(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeStaff, kv = env?.SIGNUP_KV, limiter = rateLimit,
    allowCookie = false, upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;

  if (env?.MEMBERSHIP_AUTHOR_ENABLED !== 'true') {
    return { status: 403, body: { error: 'author_disabled', message: 'hosted authoring is not enabled' } };
  }

  // Staff gate (moderator+). The cookie path verifies the session HMAC + enforces CSRF (POST) inside resolveIdentity;
  // the bearer path re-verifies the token. Fail-closed: a non-staff caller never reaches the mutation.
  const staff = await authorize(request, env, { ...deps, allowCookie });
  if (!staff.ok) return { status: staff.status, body: staff.body };
  const githubId = String(staff.githubId);

  const rl = await limiter({ kv, ip: githubId, limit: 20, windowSeconds: 600, prefix: 'rl:admin-author:' });
  if (!rl.allowed) return { status: 429, body: { error: 'rate_limited', message: 'too many admin actions; try again shortly' } };

  let payload;
  try { payload = await request.json(); } catch { return { status: 400, body: { error: 'bad_request', message: 'a JSON body is required' } }; }
  const action = String(payload?.action || '');
  const isContent = CONTENT_ACTIONS.has(action);
  const isGov = GOV_ACTIONS.has(action);
  const isConfig = CONFIG_ACTIONS.has(action);
  const isMulti = MULTI_ACTIONS.has(action); // sow-161 A
  if (!isContent && !isGov && !isConfig && !isMulti) return { status: 400, body: { error: 'bad_request', message: 'unsupported admin action' } };

  // Per-action tier: content moderation is moderator+ (the endpoint floor), member status + config are admin+, role
  // assignment is superadmin+. Reject an under-privileged caller BEFORE any read/write. The SOW-005 gate re-checks
  // the branch id's role vs the touched Tier, so this is the endpoint half of the two-authority model.
  if ((ROLE_RANK[staff.role] ?? 0) < requiredRank(action)) {
    return { status: 403, body: { error: 'forbidden', message: 'a higher role is required for this action' } };
  }

  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }

  // Compute the file change + the branch slug SERVER-SIDE, per action category.
  let file, branchSlug;
  let files = null; // sow-161 A: a MULTI-FILE op sets this instead of `file`; the apply step below handles either
  let multiTitle = null; // sow-161 A: a multi-file op's own PR title
  let govKv = null; // sow-213 Phase 2b: the KV half of a governance dual-write, applied after the git write lands
  let govRefresh = false; // sow-213 Phase 2b: a role change has no KV half, so it asks the mirror workflow to re-derive from git
  if (isContent) {
    const path = String(payload?.path || '');
    if (!isCleanPath(path) || !CONTENT_ITEM_RE.test(path)) {
      return { status: 400, body: { error: 'bad_request', message: 'a clean content item path is required' } };
    }
    const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
    if (cur.status === 404) return { status: 404, body: { error: 'not_found', message: 'no such content item on the network' } };
    if (!cur.ok) return { status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
    const curData = await cur.json().catch(() => ({}));
    if (action === 'remove') {
      file = { path, content: null };
    } else {
      const text = decodeContent(curData?.content);
      if (text == null) return { status: 502, body: { error: 'read_failed', message: 'could not read the content item' } };
      const flip = flipContentStatus(text, STATUS_FOR[action]);
      if (!flip.changed) return { status: 200, body: { ok: true, noop: true, message: `already ${STATUS_FOR[action]}` } };
      file = { path, content: flip.content };
    }
    branchSlug = actionSlug(action, path);
  } else if (isGov) {
    // Governance (member status + role assignment): the target is a github_id, NEVER a path. The governance file is
    // a FIXED constant per action (no path injection). Read it (fail-closed), apply the pure core, re-serialize; an
    // already-satisfied action is a clean no-op (no PR). Governance files carry no leading comment.
    const targetId = String(payload?.githubId || '');
    if (!GITHUB_ID_RE.test(targetId)) return { status: 400, body: { error: 'bad_request', message: 'a numeric github_id is required' } };
    const reason = typeof payload?.reason === 'string' ? payload.reason.slice(0, 500) : undefined;
    // Role assignment (Tier S) carries a role value; reject anything outside the fixed set before touching roles.yml.
    let roleVal;
    if (action === 'role') {
      roleVal = String(payload?.role || '');
      if (!VALID_ROLES.has(roleVal)) return { status: 400, body: { error: 'bad_request', message: 'an invalid role was requested' } };
    }
    // sow-213: a grandfather grant may name the paid TIER it confers and an expiry. Both are OPTIONAL and both
    // distinguish absent from explicit: a key the caller did not send is left alone by the pure core, so an
    // omitted tier does not silently reset a hand-set one. An explicit `until: null` still means permanent.
    // Validate here, before the branch/write/PR, so a bad value costs nothing and never reaches the repo.
    const hasUntil = payload != null && Object.prototype.hasOwnProperty.call(payload, 'until');
    const until = hasUntil ? payload.until : undefined;
    if (until !== undefined && until !== null && until !== '' && Number.isNaN(new Date(until).getTime())) {
      return { status: 400, body: { error: 'bad_request', message: 'an invalid until date was requested' } };
    }
    const tier = payload?.tier ?? undefined;
    if (tier !== undefined && !PAID_GRANT_TIERS.includes(tier)) {
      return { status: 400, body: { error: 'bad_request', message: 'an invalid grant tier was requested' } };
    }
    const op = GOV_OP[action];
    const load = await loadHouseYaml(fetchImpl, instToken, upstream, op.path);
    if (!load.ok) return { status: load.status, body: load.body };
    let result;
    try { result = op.fn(load.parsed, op.args({ targetId, reason, role: roleVal, until, tier }), { actor: { githubId }, now: Date.now() }); }
    catch (e) { return { status: 400, body: { error: 'bad_request', message: e?.message || 'invalid action' } }; }
    if (!result.changed) return { status: 200, body: { ok: true, noop: true, message: `no change (${action})` } };

    // sow-213 Phase 2c: THE MODERATION LOG IS WRITTEN BEFORE THE ACTION IS ENACTED, and a failure REFUSES the
    // action. Owner decision 2026-08-27: no window may exist in which a ban is enacted with no record of who
    // did it and why. Logging afterwards cannot satisfy that, because the action has already landed by then.
    // The consequence, stated rather than buried: while KV is unreachable, no governance action can be taken
    // at all. That is the fail-closed direction and it is the same posture as every other membership check
    // here. The record is of the ATTEMPT: the git write below can still fail, leaving a logged action that did
    // not land, which is the safe way round.
    const logged = await appendModerationLog({ kv, audit: result.audit });
    if (!logged.written) {
      return { status: 503, body: { error: 'unavailable', message: `the action was refused because the moderation log could not be written (${logged.reason})` } };
    }

    govRefresh = action === 'role';
    govKv = GOV_KV_SECTION[action]
      ? { section: GOV_KV_SECTION[action], githubId: targetId, remove: GOV_KV_REMOVES.has(action),
          entry: (result.next?.[GOV_KV_SECTION[action]] ?? []).find((e) => String(e?.github_id) === targetId) ?? null }
      : null;
    file = { path: op.path, content: yaml.dump(result.next, { lineWidth: 100, noRefs: true }) };
    branchSlug = `${action}-${targetId}`;
  } else if (isConfig) {
    // Config manager (increment 4): the key is a text/id string (validated per action by op.input, NEVER a path),
    // the file is a FIXED constant per action, and its LEADING COMMENT is preserved across the edit. Read
    // fail-closed, apply the pure core, re-serialize with the comment; an already-satisfied action is a clean no-op.
    const op = CONFIG_OP[action];
    const built = op.input(payload);
    if (!built.ok) return { status: built.status, body: built.body };
    const load = await loadHouseYaml(fetchImpl, instToken, upstream, op.path);
    if (!load.ok) return { status: load.status, body: load.body };
    let result;
    try { result = op.fn(load.parsed, built.args, { actor: { githubId }, now: Date.now() }); }
    catch (e) { return { status: 400, body: { error: 'bad_request', message: e?.message || 'invalid action' } }; }
    if (!result.changed) return { status: 200, body: { ok: true, noop: true, message: `no change (${action})` } };
    file = { path: op.path, content: leadingComment(load.raw) + yaml.dump(result.next, { lineWidth: 100, noRefs: true }) };
    branchSlug = `${action}-${op.slug(built.args)}`;
  } else {
    // sow-161 A: a MULTI-FILE op (tag-edit, category-batch). The build fn reads the affected files + applies the
    // shared pure cores, returning { files } or a { response } short-circuit (a validation error or a clean
    // no-op). THE SECURITY GATE: the required rank is the MAX rankForPath over the RESOLVED file set, re-checked
    // HERE after the files are known -- the requiredRank() floor above cannot see them. So an admin batch that
    // slips in a superadmin-pinned file (content-channels.yml, say) is refused even though its floor is admin.
    const op = MULTI_OP[action];
    const built = await op.build(payload, { fetchImpl, instToken, upstream, githubId });
    if (built.response) return built.response;
    const need = maxRankForPaths(built.files.map((f) => f.path), op.rank);
    if ((ROLE_RANK[staff.role] ?? 0) < need) {
      return { status: 403, body: { error: 'forbidden', message: 'this change touches a file that requires a higher role' } };
    }
    files = built.files;
    branchSlug = built.slug;
    multiTitle = built.title;
  }

  const branch = adminHostedBranchFor(githubId, branchSlug);
  if (!branch) return { status: 500, body: { error: 'internal', message: 'could not build the admin branch' } };

  // Fresh-base the branch on live main (create, or force-reset if it exists), then apply the single file, then open
  // the auto-gated PR. Mirrors the membership-author git flow; a later refactor can share it (the security is in the
  // authorize + the branch id + the gate, not this generic plumbing).
  const main = await fetchImpl(`${GH}/repos/${upstream}/git/ref/heads/main`, { headers: GH_HEADERS(instToken) });
  const mainData = await main.json().catch(() => ({}));
  const mainSha = mainData?.object?.sha;
  if (!main.ok || !mainSha) return { status: 502, body: { error: 'git_failed', message: 'could not read the main branch' } };
  const create = await fetchImpl(`${GH}/repos/${upstream}/git/refs`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!create.ok) {
    if (create.status !== 422) return { status: 502, body: { error: 'git_failed', message: 'could not create the branch' } };
    const reset = await fetchImpl(`${GH}/repos/${upstream}/git/refs/heads/${branch}`, {
      method: 'PATCH', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ sha: mainSha, force: true }),
    });
    if (!reset.ok) return { status: 502, body: { error: 'git_failed', message: 'could not reset the branch' } };
  }

  // sow-161 A: apply the single-file `file` or the multi-file `files` set on the fresh branch, one PUT/DELETE each.
  const toApply = files || [file];
  for (const f of toApply) {
    const applied = await applyFile(fetchImpl, instToken, upstream, branch, f);
    if (!applied.ok) return { status: 502, body: { error: 'git_failed', message: `could not write ${f.path}` } };
  }

  const title = (multiTitle || `Admin: ${action} ${branchSlug.slice(action.length + 1)}`).slice(0, 256);
  const body = `Admin action (${action}) by github_id ${githubId} via the GBTI admin surface (sow-161).`;
  const pr = await fetchImpl(`${GH}/repos/${upstream}/pulls`, {
    method: 'POST', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, head: branch, base: 'main', body, maintainer_can_modify: false }),
  });
  const prData = await pr.json().catch(() => ({}));
  const post = { ...(await dualWrite(kv, govKv)), ...(await refreshMirror(env, govRefresh, fetchImpl)) };
  if (pr.status === 422) return { status: 200, body: { ok: true, branch, number: null, html_url: null, already: true, ...post } };
  if (!pr.ok) return { status: 502, body: { error: 'open_pr_failed', message: `GitHub returned ${pr.status}` } };
  return { status: 200, body: { ok: true, branch, number: prData.number, html_url: prData.html_url, ...post } };
}

/**
 * sow-213 Phase 2b: the KV half of the governance dual-write, run only after the git half has landed.
 *
 * A FAILURE HERE IS REPORTED, NOT THROWN, and it never discards the git write. Git is authoritative through
 * the transition, so a failed KV write degrades to exactly the pre-Phase-2 behaviour: the ban is real, it is
 * in the file, and it reaches KV at the next scheduled mirror sync instead of within the second. Throwing
 * would turn a narrowed window into a refused moderation action, which is strictly worse.
 *
 * It is reported rather than swallowed because a silent false here reopens the window this phase exists to
 * close, and a caller that cannot see the difference cannot tell a dual-write from a git-only write.
 */
/**
 * sow-213 Phase 2b: a ROLE change has no KV half, deliberately. house/roles.yml is the root of trust for the
 * anti-escalation model, and letting this endpoint write staff status into KV would create an escalation path
 * that bypasses CODEOWNERS and does not exist today. So the role lands in git and we ask the mirror workflow
 * to re-derive from git, which drops the lag from six hours to about a second WITHOUT moving the authority.
 *
 * BEST EFFORT, and reported. The role change is already committed; a failed refresh only means the edge picks
 * it up on the next 6-hourly tick, which is the pre-existing behaviour. Reported rather than swallowed so an
 * admin can tell "live now" from "live within six hours".
 */
async function refreshMirror(env, wanted, fetchImpl) {
  if (!wanted) return {};
  const r = await fireRepositoryDispatch({ env, eventType: 'sync-mirror', clientPayload: { reason: 'role-change' }, fetchImpl });
  return { mirrorRefreshed: r.fired, mirrorReason: r.reason };
}

async function dualWrite(kv, plan) {
  if (!plan) return {}; // a role change has no KV half
  const r = await writeOverrideToKv({ kv, ...plan });
  return { kvWritten: r.written, kvReason: r.reason };
}

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
  return { status: 200, body: { ok: true, sources } };
}

// sow-161 increment 4: the coupon-manager CONFIG pool READ (admin-gated). The FULL registry from house/coupons.yml
// (incl. inactive coupons, so the manager can re-activate them). Read-only + fail-closed; a GET carries no CSRF.
// The runtime redemption COUNTS come from the separate /membership/admin/coupon-usage endpoint (KV, not git).
export async function membershipAdminCouponPool(request, env, deps = {}) {
  const {
    fetchImpl = globalThis.fetch, authorize = authorizeAdmin, allowCookie = false,
    upstream = env?.UPSTREAM_REPO || 'gbti-network/gbti.network',
  } = deps;
  const admin = await authorize(request, env, { ...deps, allowCookie });
  if (!admin.ok) return { status: admin.status, body: admin.body };
  let instToken;
  try { instToken = await getInstallationToken(env, deps); } catch { return { status: 500, body: { error: 'misconfigured', message: 'the publishing app is not configured' } }; }
  const load = await loadHouseYaml(fetchImpl, instToken, upstream, 'house/coupons.yml');
  if (!load.ok) return { status: load.status, body: load.body };
  const coupons = Array.isArray(load.parsed?.coupons) ? load.parsed.coupons : [];
  return { status: 200, body: { ok: true, coupons } };
}

// sow-161 B: the channel-map manager's SIX pool READs, on the WEBSITE host. All SUPERADMIN-gated: the manager
// mounts superadmin-only, every write on this surface is superadmin, and moderation-flags is a moderation
// blocklist + the syndication config is operational, so read audience must not exceed write audience. Each
// mirrors the exact body shape client/src/admin-ops.mjs returns to the extension host (getContentChannelPool /
// getModerationFlagPool / getSyndicationTemplatePool / getNewsEngagementSettings / getContentEngagementSettings /
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

export async function membershipAdminContentEngagement(request, env, deps = {}) {
  const r = await loadForSuperadminRead(request, env, deps, 'house/syndication-config.yml');
  if (r.fail) return r.fail;
  return { status: 200, body: { settings: { ...contentEngagement(syndicationConfigFromParsed(r.parsed)) }, tiers: [...NEWS_ENGAGEMENT_TIERS], signals: [...CONTENT_ENGAGEMENT_SIGNALS] } };
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

/** PUT (or DELETE for content:null) one file on the branch; one retry on a 409 sha race. Mirrors membership-author. */
async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
  const url = `${GH}/repos/${upstream}/contents/${f.path}`;
  const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(branch)}`, { headers: GH_HEADERS(instToken) });
  const exData = await existing.json().catch(() => ({}));
  const sha = existing.ok ? exData?.sha : undefined;
  if (f.content === null) {
    if (!sha) return { ok: true, skipped: true }; // deleting a file that is already gone is a no-op
    const res = await fetchImpl(url, {
      method: 'DELETE', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `content: remove ${f.path}`, sha, branch }),
    });
    if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
    return { ok: res.ok };
  }
  const res = await fetchImpl(url, {
    method: 'PUT', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `content: update ${f.path}`, content: b64utf8(f.content), branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
  return { ok: res.ok };
}
