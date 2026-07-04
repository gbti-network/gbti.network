// SOW-087: the PURE Discord-template edit core over the PARSED house/syndication-config.yml. setTemplate
// writes syndication.templates[type]; an EMPTY template deletes the key so the type falls back to its default
// (or the built-in message). Returns { next, changed, audit } (the news-source-edits shape). Node-free.
//
// SECURITY: this only COMPUTES the file edit. CODEOWNERS + the gate are the real boundary.

import { TEMPLATE_TYPES } from './syndication-config.mjs';

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

/** SET (or clear, with an empty string) the Discord template for one content type. Idempotent. */
export function setTemplate(doc, { type, template } = {}, ctx = {}) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!d.syndication || typeof d.syndication !== 'object' || Array.isArray(d.syndication)) d.syndication = {};
  const t = String(type || '').trim();
  if (!TEMPLATE_TYPES.includes(t)) throw new TemplateEditError(`the type must be one of: ${TEMPLATE_TYPES.join(', ')}`);
  const value = String(template ?? '').trim();
  if (value.length > MAX_TEMPLATE) throw new TemplateEditError(`a template is capped at ${MAX_TEMPLATE} characters`);
  const cur = d.syndication.templates && typeof d.syndication.templates === 'object' && !Array.isArray(d.syndication.templates)
    ? d.syndication.templates : {};
  const existing = typeof cur[t] === 'string' ? cur[t].trim() : '';
  if (existing === value) return { next: d, changed: false, audit: auditEntry(ctx, t, { template: value || null, noop: true }) };
  const nextTemplates = { ...cur };
  if (value) nextTemplates[t] = value;
  else delete nextTemplates[t]; // fall back to the type default / the built-in message
  d.syndication.templates = nextTemplates;
  return { next: d, changed: true, audit: auditEntry(ctx, t, { template: value || null }) };
}
