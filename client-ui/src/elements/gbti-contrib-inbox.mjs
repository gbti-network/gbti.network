// <gbti-contrib-inbox> (SOW-028 P1): the owner's incoming-contribution review inbox. Lists the open upstream
// PRs another member opened against THIS member's folder (the gate's contribution-pending-owner set), each
// showing the contributor, the touched file(s), the +add/-del size, and when it was opened. Read-only in P1:
// the in-client diff + acceptance preview + approve/decline land in P2/P3, so for now each row links to the PR
// on GitHub. Inert on the public site (no client -> no render), like every other client-ui element.
import { GbtiElement, define, esc } from '../base.mjs';

/** Strip the members/<owner>/ prefix so a row shows the readable content path (posts/<slug>/index.md). */
export function shortPath(p) {
  return String(p || '').replace(/^members\/[^/]+\//, '');
}

/** Compact relative time ("3d ago"), browser-runtime only. Falls back to '' for an unparseable value. */
export function whenAgo(ts, now = Date.now()) {
  if (ts == null) return '';
  const t = typeof ts === 'number' ? ts : Date.parse(ts);
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 60) return 'just now';
  const units = [['d', 86400], ['h', 3600], ['m', 60]];
  for (const [label, secs] of units) {
    const n = Math.floor(s / secs);
    if (n >= 1) return `${n}${label} ago`;
  }
  return 'just now';
}

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .count { display:inline-block; min-width:20px; text-align:center; margin-left:6px; padding:1px 7px; border-radius:999px;
    background:var(--accent); color:#fff; font-size:12px; font-weight:800; vertical-align:middle; }
  ul.list { list-style:none; margin:0; padding:0; }
  .crow { border-top:1px solid var(--line); padding:13px 2px; }
  .crow:first-child { border-top:0; }
  .top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
  .top b { font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .size { flex:none; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; white-space:nowrap; }
  .size .add { color:var(--accent); font-weight:700; }
  .size .del { color:var(--danger); font-weight:700; }
  .meta { color:var(--muted); font-size:12.5px; margin-top:3px; }
  .files { margin-top:7px; display:flex; flex-wrap:wrap; gap:5px; }
  .file { font-family:var(--font-mono,ui-monospace,monospace); font-size:11.5px; padding:2px 7px; border-radius:6px;
    background:var(--hover); color:var(--fg); }
  .file.added { background:rgba(31,158,95,.14); color:var(--accent); }
  .file.removed { background:rgba(224,108,108,.16); color:var(--danger); }
  .act { margin-top:9px; display:flex; gap:8px; }
  .btn { display:inline-block; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px;
    font:inherit; font-weight:600; font-size:13px; padding:6px 13px; text-decoration:none; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:hover { color:#fff; opacity:.92; }
  .muted { color:var(--muted); }
  h2 { font-size:17px; margin:0 0 12px; }
`;

class GbtiContribInbox extends GbtiElement {
  async render() {
    if (!this.client) return; // inert on the public site
    let list = [];
    let errored = false;
    try {
      list = (await this.client.listContributions?.())?.contributions ?? [];
    } catch {
      errored = true; // unauthenticated or a read failure -> a calm empty state, never a thrown render
    }
    this.set(this.css(CSS) + this._html(list, errored));
    // A Review button opens the in-client review (P2/P3). The inbox stays decoupled from the review element:
    // it emits `contrib-open` (composed, so it crosses the shadow boundary) and the host (the workspace) swaps
    // in <gbti-contrib-review>.
    this.$$('[data-review]').forEach((b) => b.addEventListener('click', () => {
      this.dispatchEvent(new CustomEvent('contrib-open', { detail: { number: Number(b.dataset.review) }, bubbles: true, composed: true }));
    }));
  }

  _html(list, errored) {
    if (errored) {
      return `<div class="panel"><h2>Contributions to review</h2>
        <p class="muted">Sign in to see contributions other members have proposed against your content.</p></div>`;
    }
    if (list.length === 0) {
      return `<div class="panel"><h2>Contributions to review</h2>
        <p class="muted">No one has proposed a change to your content yet. When a member improves one of your
        articles, products, or prompts, it shows up here for you to review and accept.</p></div>`;
    }
    return `<div class="panel">
      <h2>Contributions to review<span class="count">${list.length}</span></h2>
      <ul class="list">${list.map((c) => this._row(c)).join('')}</ul></div>`;
  }

  _row(c) {
    const who = c.author?.login ? `@${esc(c.author.login)}` : 'a member';
    const files = (c.files || [])
      .map((f) => `<code class="file ${esc(f.status || '')}">${esc(shortPath(f.filename))}</code>`)
      .join('');
    const n = c.fileCount ?? (c.files || []).length;
    return `<li class="crow">
      <div class="top"><b>${esc(c.title || 'PR #' + c.number)}</b>
        <span class="size"><span class="add">+${c.additions | 0}</span> <span class="del">&minus;${c.deletions | 0}</span></span></div>
      <div class="meta">${who} &middot; ${esc(n)} file${n === 1 ? '' : 's'} &middot; ${esc(whenAgo(c.createdAt))}</div>
      <div class="files">${files}</div>
      <div class="act">
        <button class="btn primary" data-review="${esc(c.number)}" type="button">Review</button>
        <a class="btn" href="${esc(c.html_url || '#')}" target="_blank" rel="noopener">On GitHub</a>
      </div>
    </li>`;
  }
}

define('gbti-contrib-inbox', GbtiContribInbox);
export { GbtiContribInbox };
