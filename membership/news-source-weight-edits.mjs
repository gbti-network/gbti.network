// sow-338: the PURE edit core for house/news-source-weights.yml, the superadmin's "take more from this source,
// take less from that one" setting.
//
// Given the parsed document ({ weights: { <source id>: <step> } }) and an action, it returns { next, changed,
// audit }, exactly like membership/news-source-edits.mjs: the caller serializes `next` and commits it through the
// pull-request flow, `changed` is false when the action is already satisfied, and `audit` is folded into the PR
// body. Node-free, so the Worker, the client and the tests all run the same code.
//
// NEUTRAL IS ABSENCE. Setting a source back to 0 removes its key rather than writing a zero, so the file lists
// only the sources somebody has actually weighted, and a fork inherits a short, readable record of the curation
// rather than 125 zeroes.
//
// SECURITY: this only COMPUTES the edit. The file is pinned to the superadmins in CODEOWNERS and in
// membership/path-rank.mjs, so a pull request touching it from anyone else is rejected by the gate whatever this
// returns, and the Worker's action table ranks the action superadmin as well.

export class NewsWeightEditError extends Error {}

export const WEIGHT_MIN = -2;
export const WEIGHT_MAX = 2;

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // the same kebab-case id rule the source pool uses

function isoOf(now) {
  const d = now instanceof Date ? now : new Date(now ?? Date.now());
  if (Number.isNaN(d.getTime())) throw new NewsWeightEditError('invalid timestamp');
  return d.toISOString();
}

/** Identity-minimal audit entry, keyed by the source id rather than by a person. */
function auditEntry(ctx, id, from, to) {
  const a = ctx?.actor || null;
  return {
    at: isoOf(ctx?.now),
    actor: a ? { github_id: a.githubId != null ? String(a.githubId) : (a.github_id != null ? String(a.github_id) : null), login: a.login ?? null } : null,
    action: 'news-source-weight',
    target: { id },
    detail: { from, to },
  };
}

/** The weights map of a parsed document, defensively. Pure. */
export function readWeights(doc) {
  const raw = doc?.weights;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [id, v] of Object.entries(raw)) {
    const n = Math.round(Number(v));
    if (!ID_RE.test(String(id)) || !Number.isFinite(n) || n === 0) continue;
    out[id] = Math.min(WEIGHT_MAX, Math.max(WEIGHT_MIN, n));
  }
  return out;
}

/** The step a source currently carries, 0 when it carries none. Pure. */
export const weightOf = (doc, id) => readWeights(doc)[id] ?? 0;

/**
 * Set one source's weight. Throws on an id or a step that is not one; idempotent when the value already stands.
 *
 * The step is validated rather than clamped: a caller asking for 5 has a bug or is probing, and silently writing
 * 2 would hide both.
 */
export function setSourceWeight(doc, { id, weight } = {}, ctx = {}) {
  const sourceId = String(id ?? '').trim();
  if (!sourceId || !ID_RE.test(sourceId)) throw new NewsWeightEditError('a source id is required');
  const n = Number(weight);
  if (!Number.isInteger(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) {
    throw new NewsWeightEditError(`weight must be a whole step from ${WEIGHT_MIN} to ${WEIGHT_MAX}`);
  }
  const weights = readWeights(doc);
  const from = weights[sourceId] ?? 0;
  if (from === n) return { next: { ...(doc || {}), weights }, changed: false, audit: null };

  if (n === 0) delete weights[sourceId];
  else weights[sourceId] = n;
  // Sorted, so a pull request diff shows the one line that changed rather than a reordered map.
  const sorted = {};
  for (const key of Object.keys(weights).sort()) sorted[key] = weights[key];
  return { next: { ...(doc || {}), weights: sorted }, changed: true, audit: auditEntry(ctx, sourceId, from, n) };
}

/** Validate the action payload the Worker received. Throws, like the other config-action inputs. */
export function weightInput(payload) {
  const id = String(payload?.id ?? '').trim();
  if (!id || !ID_RE.test(id)) throw new NewsWeightEditError('a source id is required');
  const n = Number(payload?.weight);
  if (!Number.isInteger(n) || n < WEIGHT_MIN || n > WEIGHT_MAX) {
    throw new NewsWeightEditError(`weight must be a whole step from ${WEIGHT_MIN} to ${WEIGHT_MAX}`);
  }
  return { id, weight: n };
}
