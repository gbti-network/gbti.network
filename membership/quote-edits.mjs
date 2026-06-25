// SOW-063 Phase 3: the PURE quote-pool edit core. Given the PARSED house/quotes.yml ({ quotes: [{ text, author,
// enabled }] }) plus an action, each function returns { next, changed, audit } — `next` is the new parsed doc (the
// caller serializes + commits it via the SOW-005 PR flow, exactly like news-source-edits.mjs), `changed` is false
// when the action is already satisfied (idempotent), and `audit` is an identity-minimal log entry folded into the PR
// body. Node-free (no fs / no yaml) so it runs in the client, the Worker, and node tests. Quotes have no id, so they
// are identified by their (normalized, case-insensitive) text — which is also the dedupe key.
//
// SECURITY: this only COMPUTES the file edit. Authorization is enforced by CODEOWNERS (house/** is admin-owned) +
// no-bypass branch protection + the metadata-only gate, exactly like roles/bans/news-source edits. A non-admin PR
// touching house/quotes.yml is auto-rejected regardless of what this computes.

export class QuoteEditError extends Error {}

const MAX_TEXT = 280;
const MAX_AUTHOR = 80;

const normText = (t) => String(t || '').trim();
const keyOf = (t) => normText(t).toLowerCase();

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new QuoteEditError('invalid timestamp');
  return d.toISOString();
}
/** Identity-minimal audit entry (the SOW-024/038/055/056 shape), keyed by the quote text rather than a github_id. */
function auditEntry(ctx, action, text, detail) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action,
    target: { text },
    detail: detail ?? null,
  };
}

function clean(doc) {
  const d = structuredClone(doc && typeof doc === 'object' ? doc : {});
  if (!Array.isArray(d.quotes)) d.quotes = [];
  return d;
}

/**
 * ADD a quote. Idempotent: re-adding the same text (case-insensitive) is a no-op. New quotes default to enabled.
 * Validates a non-empty text + author.
 */
export function addQuote(doc, { text, author, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const t = normText(text).slice(0, MAX_TEXT);
  const a = normText(author).slice(0, MAX_AUTHOR);
  if (!t) throw new QuoteEditError('a quote needs text');
  if (!a) throw new QuoteEditError('a quote needs an author');
  const exists = d.quotes.find((q) => keyOf(q.text) === keyOf(t));
  if (exists) return { next: d, changed: false, audit: auditEntry(ctx, 'quote.add', t, { noop: true }) };
  d.quotes.push({ text: t, author: a, enabled: enabled !== false });
  return { next: d, changed: true, audit: auditEntry(ctx, 'quote.add', t, { author: a }) };
}

/** ENABLE / DISABLE a quote (the preferred way to retire a quote — kept for history). Idempotent. */
export function setQuoteEnabled(doc, { text, enabled } = {}, ctx = {}) {
  const d = clean(doc);
  const want = enabled !== false;
  const q = d.quotes.find((x) => keyOf(x.text) === keyOf(text));
  if (!q) throw new QuoteEditError(`quote not found: ${normText(text)}`);
  if ((q.enabled !== false) === want) return { next: d, changed: false, audit: auditEntry(ctx, 'quote.enable', q.text, { enabled: want, noop: true }) };
  q.enabled = want;
  return { next: d, changed: true, audit: auditEntry(ctx, 'quote.enable', q.text, { enabled: want }) };
}

/** REMOVE a quote outright (prefer setQuoteEnabled(false) to keep history; remove is for genuinely bad entries). */
export function removeQuote(doc, { text } = {}, ctx = {}) {
  const d = clean(doc);
  const i = d.quotes.findIndex((x) => keyOf(x.text) === keyOf(text));
  if (i < 0) throw new QuoteEditError(`quote not found: ${normText(text)}`);
  const [gone] = d.quotes.splice(i, 1);
  return { next: d, changed: true, audit: auditEntry(ctx, 'quote.remove', gone?.text ?? normText(text), null) };
}
