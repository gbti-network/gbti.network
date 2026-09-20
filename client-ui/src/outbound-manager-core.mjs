// sow-359: the pure half of the superadmin's tracked-link board. Node-free, no DOM, so every decision below is
// a unit test rather than a browser.
//
// sow-289 built the board read-only and said editing "enters its own plan mode". This is that editing: mint a
// link, repoint or relabel one, and retire or restore one. What a destination may look like is NOT decided
// here; membership/outbound-link-edits.mjs owns that and is the one place that knows a destination needs an
// explicit path before its query. This module decides what the form sends and what it refuses to send empty.
import { LINK_STATUSES } from '../../membership/outbound-link-edits.mjs';

export const STATUS_LABELS = Object.freeze({ live: 'Live', placeholder: 'Placeholder', retired: 'Retired' });
export { LINK_STATUSES };

const text = (v) => (typeof v === 'string' ? v.trim() : '');

/** A partner label turned into the path we suggest for it. A suggestion only: the field stays editable. */
export function suggestPath(partner) {
  const slug = text(partner).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `/outbound/${slug}` : '';
}

/** The editable fields of an existing row, as the inline editor holds them. */
export function draftFromLink(link) {
  return { path: text(link?.path), destination: text(link?.destination), partner: text(link?.partner), note: text(link?.note) };
}

/**
 * What "Add" sends, or `{ problem }`. Only the obvious emptiness is caught here so the form can say it without
 * a round trip; everything else is the core's call, and its message is what the board shows on refusal.
 */
export function addPayload(draft = {}) {
  const path = text(draft.path);
  const destination = text(draft.destination);
  const partner = text(draft.partner);
  if (!path) return { problem: 'A site path is needed, for example /outbound/acme.' };
  if (!path.startsWith('/')) return { problem: 'The path must start with a slash.' };
  if (!destination) return { problem: 'A destination is needed: where the link sends the reader.' };
  if (!partner) return { problem: 'A partner label is needed, for example acme.' };
  const note = text(draft.note);
  return { payload: { path, destination, partner, ...(note ? { note } : {}) } };
}

/**
 * What "Save" sends for an existing row: only what actually changed, or `{ noop: true }`. Sending the whole
 * row every time would turn a no-op into a pull request, and the store's history is the audit trail.
 */
export function updatePayload(link, draft = {}) {
  const before = draftFromLink(link);
  const out = { path: before.path };
  let changed = false;
  for (const k of ['destination', 'partner', 'note']) {
    const v = text(draft[k]);
    if (v === before[k]) continue;
    if (k !== 'note' && !v) return { problem: `${k === 'destination' ? 'A destination' : 'A partner label'} cannot be emptied.` };
    out[k] = v;
    changed = true;
  }
  if (!changed) return { noop: true };
  return { payload: out };
}

/** What a status button sends, or `{ noop: true }` when the row already has that status. */
export function statusPayload(link, status) {
  if (!LINK_STATUSES.includes(status)) return { problem: `Unknown status ${JSON.stringify(status)}.` };
  if (text(link?.status || 'live') === status) return { noop: true };
  return { payload: { path: text(link?.path), status } };
}

/**
 * What to tell the superadmin after a write lands. The change is a pull request that auto-merges and reaches
 * the edge at the next deploy, so saying "saved" alone invites them to refresh, see the old value in the
 * public artifact this board reads, and conclude it failed.
 */
export function savedMessage(what, result) {
  const n = result && (result.prNumber ?? result.number ?? result.pr);
  const where = n ? ` (pull request #${n})` : '';
  return `${what}${where}. It reaches the live site at the next deploy, in about two to three minutes.`;
}

/** The board's own optimistic copy of a row after a write, so the list shows the change before the deploy. */
export function applyLocally(links, action, payload) {
  const list = Array.isArray(links) ? links.map((l) => ({ ...l })) : [];
  if (action === 'add') return [...list, { status: 'live', note: '', ...payload }];
  const row = list.find((l) => text(l.path) === text(payload?.path));
  if (!row) return list;
  for (const k of ['destination', 'partner', 'note', 'status']) if (payload[k] !== undefined) row[k] = payload[k];
  return list;
}

// ---------------------------------------------------------------------------------------------------------
// sow-289, moved here by sow-359 so both managers share one copy.
export const WINDOWS = Object.freeze([7, 30]);

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .btn { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn[disabled] { opacity:.45; cursor:default; }
  .btn[disabled]:hover { border-color:var(--line); color:var(--fg); }
  /* sow-359: the write controls. BASE_CSS styles a bare button and input inside every shadow root, and its
     rules beat a single class on hover, so anything interactive here states its own hover and width. */
  .acts { display:flex; gap:6px; flex-wrap:wrap; margin-top:8px; }
  .btn.on { border-color:var(--accent); color:var(--accent); }
  .edit { margin-top:10px; padding:10px; border:1px solid var(--line); border-radius:8px; display:grid; gap:8px; }
  .edit label { display:grid; gap:3px; font-size:12px; color:var(--muted); }
  .edit input { width:100%; box-sizing:border-box; font:inherit; font-size:13px; padding:6px 8px; border:1px solid var(--line); border-radius:6px; background:var(--paper, transparent); color:var(--fg); }
  .edit input:focus { outline:2px solid var(--accent); outline-offset:1px; }
  .newlink { margin:0 0 16px; }
  .err { color:var(--danger, #e06c6c); font-size:12.5px; }
  .list { list-style:none; margin:0; padding:0; }
  .lnk { border-top:1px solid var(--line); padding:12px 2px; }
  .lnk:first-child { border-top:0; }
  .top { display:flex; align-items:baseline; gap:10px; flex-wrap:wrap; }
  .path { font-family:var(--font-mono, monospace); font-size:13.5px; color:var(--fg); font-weight:700; overflow-wrap:anywhere; }
  .partner { font-size:12.5px; color:var(--muted); }
  .badge { font-size:11px; font-weight:700; letter-spacing:.02em; text-transform:uppercase; border-radius:999px; padding:2px 8px; border:1px solid var(--line); color:var(--muted); }
  .badge.placeholder { border-color:var(--warn, #c98a12); color:var(--warn, #c98a12); }
  .badge.retired { opacity:.7; }
  .dest { display:block; font-size:12.5px; margin-top:3px; overflow-wrap:anywhere; }
  .dest a { color:var(--accent); }
  .stats { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px 14px; margin-top:8px; }
  .stat { font-size:13px; }
  .stat b { font-size:16px; }
  .stat .sub { display:block; font-size:12px; color:var(--muted); }
  .gap { color:var(--warn, #c98a12); }
  details { margin-top:6px; }
  summary { cursor:pointer; font-size:12.5px; color:var(--muted); }
  .note { font-size:13px; line-height:1.5; color:var(--fg); margin:6px 0 0; white-space:pre-line; }
  table { border-collapse:collapse; margin-top:6px; font-size:12.5px; }
  th, td { text-align:right; padding:2px 10px 2px 0; }
  th:first-child, td:first-child { text-align:left; font-family:var(--font-mono, monospace); }
  td.gap { text-align:left; }
  .muted { color:var(--muted); }
`;

const day = (now, n) => new Date(now.getTime() - n * 86400000).toISOString().slice(0, 10);

/**
 * The last `days` complete days (yesterday back), each either measured (with its cell) or not. Pure; exported for
 * the tests. `coverage` decides measured, so a covered date with no row for this path is an explicit zero.
 */
export function windowFor(store, path, days, now = new Date()) {
  const coverage = new Set(Array.isArray(store?.coverage) ? store.coverage : []);
  const rows = store?.clicks?.[path] || {};
  const out = { days, clicks: 0, crawlers: 0, other: 0, measured: 0, unmeasured: 0, list: [] };
  for (let n = 1; n <= days; n += 1) {
    const d = day(now, n);
    if (!coverage.has(d)) { out.unmeasured += 1; out.list.push({ date: d, measured: false }); continue; }
    const c = rows[d] || { clicks: 0, crawlers: 0, other: 0 };
    out.measured += 1;
    out.clicks += Number(c.clicks) || 0;
    out.crawlers += Number(c.crawlers) || 0;
    out.other += Number(c.other) || 0;
    out.list.push({ date: d, measured: true, clicks: Number(c.clicks) || 0, crawlers: Number(c.crawlers) || 0, other: Number(c.other) || 0 });
  }
  return out;
}

/**
 * sow-359: the one-line click summary shown beside a CARD that points at a tracked link, or null when the card
 * is not tracked. A card with its own path is already counted by the daily rollup, so this reads the same
 * artifact the link board reads.
 *
 * It inherits the board's rule and must keep it: A DAY NOBODY MEASURED IS NOT A ZERO. If the window has no
 * measured days the count is not shown at all, because "0 clicks in 30 days" about a link nobody counted is a
 * false statement that reads exactly like a true one.
 */
export function cardClicksLine(cta, clicks, now = new Date(), days = 30) {
  const path = typeof cta?.trackedPath === 'string' ? cta.trackedPath.trim() : '';
  if (!path) return null;
  const w = windowFor(clicks, path, days, now);
  if (!w.measured) return `${path} · not measured yet`;
  const gap = w.unmeasured ? `, ${w.unmeasured} of ${days} days not measured` : '';
  return `${path} · ${w.clicks} click${w.clicks === 1 ? '' : 's'} in ${days} days${gap}`;
}
