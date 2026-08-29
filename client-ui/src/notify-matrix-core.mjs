// SOW-186 C3: the PURE model behind the account notifications settings (the default matrix, the per-follow
// modal, and the follows-list summary). No DOM, no client, so it is node-testable. It reuses the AUTHORITATIVE
// resolver (membership/notify-resolve.mjs) rather than duplicating the precedence, so what the UI shows as
// "effective" is exactly what delivery computes: per channel, a per-follow override wins, then the member's
// global default, then the system default (in-app ON, email OFF). The design settled the model as one global
// default with sparse per-follow overrides; this core carries that shape.
import { resolveNotify, normalizeNotify } from '../../membership/notify-resolve.mjs';

// The five rows of the settings matrix, mapping the design labels to the stored event keys. `prompt` carries
// the design's merged "Prompts and skills"; `news` (curated news) stores generically (the model is generic over
// the key), with no live delivery yet, consistent with the dormant email path.
export const MATRIX_ROWS = Object.freeze([
  { key: 'article', label: 'Articles' },
  { key: 'product', label: 'Products' },
  { key: 'prompt', label: 'Prompts and skills' },
  { key: 'share', label: 'Shares' },
  { key: 'news', label: 'News they curate' },
]);

/** Resolve the full matrix ({ [key]: { api, email } }) for a (follow, global) pair, each row via the shared
 *  resolver. `followNotify` undefined = the "use my default" case (every row falls to the global default). */
export function resolveMatrix(followNotify, globalNotify) {
  const f = normalizeNotify(followNotify);
  const g = normalizeNotify(globalNotify);
  const out = {};
  for (const r of MATRIX_ROWS) out[r.key] = resolveNotify({ event: r.key, follow: f, global: g });
  return out;
}

/** The matrix for the member's GLOBAL DEFAULT (each row = the stored global value, falling through to the
 *  system default per channel). Seeds the account page's "Default for everyone you follow" card. */
export function defaultMatrix(globalNotify) {
  return resolveMatrix(undefined, globalNotify);
}

/** Serialize an editable matrix back into the stored event-keyed notify object. Every row is written
 *  explicitly (the grid shows all rows), so a saved value is complete and does not silently drift when the
 *  global default later changes. */
export function matrixToNotify(matrix) {
  const out = {};
  for (const r of MATRIX_ROWS) {
    const cell = (matrix && matrix[r.key]) || {};
    out[r.key] = { api: !!cell.api, email: !!cell.email };
  }
  return out;
}

/** Toggle one channel of one row, returning a NEW matrix (never mutates the input). */
export function toggleCell(matrix, key, channel) {
  const next = {};
  for (const r of MATRIX_ROWS) next[r.key] = { ...((matrix && matrix[r.key]) || {}) };
  if (next[key] && (channel === 'api' || channel === 'email')) next[key][channel] = !next[key][channel];
  return next;
}

/** Whether a follow carries its own override (the Custom tag) vs following the global default. */
export function isCustomFollow(follow) {
  return !!normalizeNotify(follow && follow.notify);
}

/** The one-line summary of a follow's EFFECTIVE prefs, for the account follows list. Mirrors the design's
 *  summarise(): "Muted, nothing arrives" | "Everything, in app and by email" | "Everything, in app only" |
 *  "Articles, products, email on". `follow` may be a default-mode follow (no notify) or a custom one. */
export function summarizeFollow(follow, globalNotify) {
  const matrix = resolveMatrix(follow && follow.notify, globalNotify);
  return summarizeMatrix(matrix);
}

/** The one-line summary of a resolved matrix. */
export function summarizeMatrix(matrix) {
  const on = MATRIX_ROWS.filter((r) => matrix && matrix[r.key] && (matrix[r.key].api || matrix[r.key].email));
  if (!on.length) return 'Muted, nothing arrives';
  const anyMail = MATRIX_ROWS.some((r) => matrix && matrix[r.key] && matrix[r.key].email);
  if (on.length === MATRIX_ROWS.length) return anyMail ? 'Everything, in app and by email' : 'Everything, in app only';
  const names = on.map((r) => r.label.toLowerCase()).join(', ');
  return names.charAt(0).toUpperCase() + names.slice(1) + (anyMail ? ', email on' : '');
}

/** The notify value to save for a modal in `mode` with the given edited matrix: a full object for "custom", or
 *  null for "default" (which clears the per-follow override back to the global default, the "Use my default"
 *  action). The Worker + the pure follow core both read null/empty as "clear". */
export function notifyPayload(mode, matrix) {
  return mode === 'custom' ? matrixToNotify(matrix) : null;
}
