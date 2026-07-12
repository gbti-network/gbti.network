// SOW-087 (+ SOW-111): the PURE house/syndication-config.yml edit cores. setTemplate writes
// syndication.templates[type] (an EMPTY template deletes the key so the type falls back to its default or the
// built-in message); setNewsEngagement writes the SOW-111 news auto-share settings. Both return
// { next, changed, audit } (the news-source-edits shape). Node-free.
//
// SECURITY: this only COMPUTES the file edit. CODEOWNERS + the gate are the real boundary.

import { TEMPLATE_TYPES, NEWS_ENGAGEMENT_TIERS, newsEngagement, syndicationConfigFromParsed } from './syndication-config-core.mjs';

export class TemplateEditError extends Error {}

const MAX_TEMPLATE = 500;

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new TemplateEditError('invalid timestamp');
  return d.toISOString();
}

function auditEntry(ctx, type, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action: 'syndication-template.set',
    target: { type },
    detail: detail ?? null,
  };
}

/**
 * SOW-111: SET the news engagement auto-share settings (a partial patch: only the supplied fields change).
 * Values are validated hard (a bad tier or threshold is an error, never silently coerced into policy).
 * Idempotent against the CURRENT normalized settings.
 */
export function setNewsEngagement(doc, { enabled, openThreshold, tier, commentAutopost } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const cur = newsEngagement({ news_engagement: d.syndication.news_engagement });
  const next = { ...cur };
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new TemplateEditError('enabled must be true or false');
    next.enabled = enabled;
  }
  if (openThreshold !== undefined) {
    const n = Number(openThreshold);
    if (!Number.isInteger(n) || n < 1 || n > 1000) throw new TemplateEditError('openThreshold must be an integer from 1 to 1000');
    next.open_threshold = n;
  }
  if (tier !== undefined) {
    const t = String(tier || '').trim().toLowerCase();
    if (!NEWS_ENGAGEMENT_TIERS.includes(t)) throw new TemplateEditError(`tier must be one of: ${NEWS_ENGAGEMENT_TIERS.join(', ')}`);
    next.tier = t;
  }
  if (commentAutopost !== undefined) {
    if (typeof commentAutopost !== 'boolean') throw new TemplateEditError('commentAutopost must be true or false');
    next.comment_autopost = commentAutopost;
  }
  const audit = (detail) => {
    const a = ctx?.actor || null;
    return {
      at: isoOf(ctx?.now),
      actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
      action: 'news-engagement.set',
      target: { file: 'house/syndication-config.yml' },
      detail,
    };
  };
  const same = next.enabled === cur.enabled && next.open_threshold === cur.open_threshold
    && next.tier === cur.tier && next.comment_autopost === cur.comment_autopost;
  if (same) return { next: d, changed: false, audit: audit({ ...next, noop: true }) };
  d.syndication.news_engagement = {
    enabled: next.enabled,
    open_threshold: next.open_threshold,
    tier: next.tier,
    comment_autopost: next.comment_autopost,
  };
  return { next: d, changed: true, audit: audit({ ...next }) };
}

/** SET (or clear, with an empty string) the Discord template for one content type. Idempotent. */
export function setTemplate(doc, { type, template, channel, stub } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const t = String(type || '').trim();
  if (!TEMPLATE_TYPES.includes(t)) throw new TemplateEditError(`the type must be one of: ${TEMPLATE_TYPES.join(', ')}`);
  const value = String(template ?? '').trim();
  if (value.length > MAX_TEMPLATE) throw new TemplateEditError(`a template is capped at ${MAX_TEMPLATE} characters`);
  // SOW-088: with a channel, the edit targets syndication.channel_templates[channel][type] (an empty value
  // deletes the override so the field falls back to the shared map, then the built-in default).
  // SOW-088 Proposal A: stub=true targets the MEMBERS-stub maps with identical semantics.
  const isStub = stub === true;
  const chField = isStub ? 'channel_templates_stub' : 'channel_templates';
  const sharedField = isStub ? 'stub_templates' : 'templates';
  const ch = String(channel || '').trim();
  if (ch) {
    if (!SYNDICATION_CHANNEL_NAMES.includes(ch)) throw new TemplateEditError(`unknown channel "${ch}"`);
    const all = d.syndication[chField] && typeof d.syndication[chField] === 'object' && !Array.isArray(d.syndication[chField])
      ? d.syndication[chField] : {};
    const curCh = all[ch] && typeof all[ch] === 'object' && !Array.isArray(all[ch]) ? all[ch] : {};
    const existing = typeof curCh[t] === 'string' ? curCh[t].trim() : '';
    if (existing === value) return { next: d, changed: false, audit: auditEntry(ctx, t, { channel: ch, stub: isStub || undefined, template: value || null, noop: true }) };
    const nextCh = { ...curCh };
    if (value) nextCh[t] = value;
    else delete nextCh[t];
    const nextAll = { ...all };
    if (Object.keys(nextCh).length) nextAll[ch] = nextCh;
    else delete nextAll[ch]; // no overrides left for this channel
    if (Object.keys(nextAll).length) d.syndication[chField] = nextAll;
    else delete d.syndication[chField];
    return { next: d, changed: true, audit: auditEntry(ctx, t, { channel: ch, stub: isStub || undefined, template: value || null }) };
  }
  const cur = d.syndication[sharedField] && typeof d.syndication[sharedField] === 'object' && !Array.isArray(d.syndication[sharedField])
    ? d.syndication[sharedField] : {};
  const existing = typeof cur[t] === 'string' ? cur[t].trim() : '';
  if (existing === value) return { next: d, changed: false, audit: auditEntry(ctx, t, { stub: isStub || undefined, template: value || null, noop: true }) };
  const nextTemplates = { ...cur };
  if (value) nextTemplates[t] = value;
  else delete nextTemplates[t]; // fall back to the type default / the built-in message
  d.syndication[sharedField] = nextTemplates;
  return { next: d, changed: true, audit: auditEntry(ctx, t, { stub: isStub || undefined, template: value || null }) };
}

// SOW-088: the syndication PIPELINE settings (master switch, approval mode, hold window, per-channel
// switches), so the admin UI can run these without hand-editing the yml. Partial patch; hard validation;
// idempotent against the normalized current values.
export const SYNDICATION_CHANNEL_NAMES = Object.freeze(['discord', 'discord-category', 'x', 'linkedin', 'mastodon', 'bluesky', 'reddit', 'devto']);

export function setSyndicationSettings(doc, { enabled, requireApproval, holdMinutes, channels } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const cur = syndicationConfigFromParsed(doc);
  let changed = false;
  const detail = {};
  if (enabled !== undefined) {
    if (typeof enabled !== 'boolean') throw new TemplateEditError('enabled must be a boolean');
    if (enabled !== cur.enabled) { d.syndication.enabled = enabled; changed = true; detail.enabled = enabled; }
  }
  if (requireApproval !== undefined) {
    if (typeof requireApproval !== 'boolean') throw new TemplateEditError('requireApproval must be a boolean');
    if (requireApproval !== cur.require_approval) { d.syndication.require_approval = requireApproval; changed = true; detail.require_approval = requireApproval; }
  }
  if (holdMinutes !== undefined) {
    const h = Number(holdMinutes);
    if (!Number.isInteger(h) || h < 0 || h > 1440) throw new TemplateEditError('holdMinutes must be an integer between 0 and 1440');
    if (h !== cur.hold_minutes) { d.syndication.hold_minutes = h; changed = true; detail.hold_minutes = h; }
  }
  if (channels !== undefined) {
    if (!channels || typeof channels !== 'object' || Array.isArray(channels)) throw new TemplateEditError('channels must be an object of { name: boolean }');
    for (const [name, on] of Object.entries(channels)) {
      if (!SYNDICATION_CHANNEL_NAMES.includes(name)) throw new TemplateEditError(`unknown channel "${name}"`);
      if (typeof on !== 'boolean') throw new TemplateEditError(`channel "${name}" must be a boolean`);
      if (Boolean(cur.channels?.[name]) !== on) {
        if (!d.syndication.channels || typeof d.syndication.channels !== 'object') d.syndication.channels = {};
        d.syndication.channels[name] = on;
        changed = true;
        (detail.channels ??= {})[name] = on;
      }
    }
  }
  if (!changed) return { next: doc, changed: false, audit: null };
  return { next: d, changed: true, audit: { ...auditEntry(ctx, 'settings', detail), action: 'syndication-settings.set' } };
}
