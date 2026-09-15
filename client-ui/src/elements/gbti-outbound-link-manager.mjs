// <gbti-outbound-link-manager> (sow-289 Phase 1): the superadmin's READ-ONLY board of the outbound partner links.
// Every link in house/outbound-links.yml (path, partner, destination, status, its provenance note) beside its
// estimated click history from house/outbound-clicks.yml, which reconcile rolls up daily from Cloudflare zone
// analytics. No write path: editing links is Phase 4 and enters its own plan mode.
//
// It reads the two PUBLIC build artifacts (/outbound-links.json, /outbound-clicks.json) directly, the way
// <gbti-welcome> reads /members-index.json: the data is git-native and public, so it needs no Worker route, no client
// method and no change to the routing chokepoint (client.mjs). It renders with or without an injected client; the host
// page decides who sees the tab.
//
// TWO RULES THE BOARD HOLDS. A date the rollup did not query is "not measured", never 0: the store's `coverage` says
// which dates were queried, and the board counts a window's unmeasured days out loud. And a failed load is its own
// state (sow-334): it shows the failure and a Try again button and does NOT retry on its own, so a bad answer cannot
// become a storm of requests.
//
// Numbers are ESTIMATES (the analytics dataset samples). clicks = 301 answers; crawlers = the subset of clicks from a
// well-known crawler agent (owner decision 2026-09-15: shown beside the clicks, neither dropped nor blended);
// other = every answer that was not a 301 (Cloudflare's own Early Hints probes land there), shown so a fault is visible.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
export const WINDOWS = Object.freeze([7, 30]);

const CSS = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .btn { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
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

class GbtiOutboundLinkManager extends GbtiElement {
  connectedCallback() { super.connectedCallback?.(); if (!this._links && !this._loading && !this._failed) this.load(); }

  async load() {
    this._loading = true; this._failed = false; this._msg = '';
    this.render();
    try {
      const [links, clicks] = await Promise.all([
        fetch(`${SITE}/outbound-links.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`links ${r.status}`); return r.json(); }),
        fetch(`${SITE}/outbound-clicks.json`, { cache: 'no-cache' }).then((r) => { if (!r.ok) throw new Error(`clicks ${r.status}`); return r.json(); }),
      ]);
      this._links = Array.isArray(links?.links) ? links.links : [];
      this._clicks = { coverage: Array.isArray(clicks?.coverage) ? clicks.coverage : [], clicks: clicks?.clicks && typeof clicks.clicks === 'object' ? clicks.clicks : {} };
    } catch {
      // sow-334: a failed load waits for Try again. No automatic retry, or a bad answer becomes a request storm.
      this._links = null; this._clicks = null; this._failed = true;
      this._msg = 'Could not load the outbound links or their click history.';
    }
    this._loading = false;
    this.render();
  }

  render() {
    if (this._failed) {
      this.set(this.css(CSS) + `<p class="msg">${esc(this._msg)}</p><button class="btn" type="button" data-retry-load>Try again</button>`);
      this.$('[data-retry-load]')?.addEventListener('click', () => this.load());
      return;
    }
    if (!this._links) { this.set(this.css(CSS) + `<p class="muted">Loading the outbound links...</p>`); return; }
    const now = new Date();
    const coverage = this._clicks.coverage;
    const latest = coverage.length ? [...coverage].sort().pop() : null; // never trust the artifact's order
    const rows = this._links.map((l) => {
      const stats = WINDOWS.map((d) => {
        const w = windowFor(this._clicks, l.path, d, now);
        const gap = w.unmeasured ? `<span class="sub gap">${w.unmeasured} of ${d} days not measured</span>` : `<span class="sub">${w.other} other answers</span>`;
        return `<div class="stat"><b>${w.measured ? w.clicks : '?'}</b> clicks in ${d} days <span class="sub">${w.measured ? `${w.crawlers} from known crawlers` : 'nothing measured yet'}</span> ${gap}</div>`;
      }).join('');
      const w30 = windowFor(this._clicks, l.path, 30, now);
      const history = w30.list.map((x) => x.measured
        ? `<tr><td>${x.date}</td><td>${x.clicks}</td><td>${x.crawlers}</td><td>${x.other}</td></tr>`
        : `<tr><td>${x.date}</td><td class="gap" colspan="3">not measured</td></tr>`).join('');
      return `<li class="lnk">
        <div class="top"><span class="path">${esc(l.path)}</span> <span class="partner">${esc(l.partner)}</span> <span class="badge ${esc(l.status)}">${esc(l.status)}</span></div>
        <span class="dest">to <a href="${esc(l.destination)}" target="_blank" rel="noopener noreferrer">${esc(l.destination)}</a></span>
        <div class="stats">${stats}</div>
        ${l.note ? `<details><summary>Where this destination came from</summary><p class="note">${esc(l.note)}</p></details>` : ''}
        <details><summary>Last 30 days, by day</summary><table><thead><tr><th>Day</th><th>Clicks</th><th>Crawlers</th><th>Other</th></tr></thead><tbody>${history}</tbody></table></details>
      </li>`;
    }).join('');
    this.set(this.css(CSS) + `
      <div class="head"><span class="hint">${this._links.length} links. Clicks are estimates from Cloudflare zone analytics: 301 answers only, rolled up daily by reconcile. ${latest ? `Measured through ${esc(latest)}.` : 'Nothing measured yet: the first rollup lands with the next daily reconcile.'}</span></div>
      <ul class="list">${rows || '<li class="muted">No outbound links in the store.</li>'}</ul>
    `);
  }
}

define('gbti-outbound-link-manager', GbtiOutboundLinkManager);
export { GbtiOutboundLinkManager };
