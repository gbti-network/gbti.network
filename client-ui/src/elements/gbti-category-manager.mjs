// <gbti-category-manager> (SOW-055): the superadmin category manager. Renders the canonical taxonomy tree
// (client.taxonomy() -> { tree }) and offers: ADD a category/subcategory, RENAME a node's LABEL (auto-merged house
// PR via client.addCategory / client.renameCategory), and the SOW-055 Phase 2 PATH-CHANGING ops -- MOVE (re-parent),
// rename KEY, and REMOVE -- which run as a CI migration that rewrites every affected content item in ONE review-gated
// PR (client.adminOp('category-migrate', ...), with orphan protection). MOVE uses an inline parent PICKER (no path
// typing). Admin-only by where it is mounted + the server-side gate; inert without a client.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const CHEVRON = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2384818c' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E";

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; line-height:1.5; }
  .muted { color:var(--muted); font-size:13.5px; }
  .add-top { display:flex; gap:8px; margin:0 0 16px; flex-wrap:wrap; align-items:center; }
  input, select { font:inherit; font-size:13.5px; padding:9px 11px; border:1.5px solid var(--line); border-radius:9px; background:var(--bg, var(--panel)); color:var(--fg); }
  input:focus-visible, select:focus-visible { outline:2px solid var(--brand); outline-offset:1px; border-color:var(--brand); }
  input.key { width:170px; } input.lab { flex:1; min-width:140px; }
  select { appearance:none; -webkit-appearance:none; cursor:pointer; padding-right:36px; background-image:url("${CHEVRON}"); background-repeat:no-repeat; background-position:right 11px center; }
  .btn { font:inherit; font-weight:600; font-size:13px; padding:9px 14px; border:0; border-radius:9px; background:var(--brand); color:#fff; cursor:pointer; white-space:nowrap; }
  .btn:hover { filter:brightness(1.06); }
  .lk { font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:none; border:0; cursor:pointer; padding:5px 9px; border-radius:7px; white-space:nowrap; }
  .lk:hover { background:var(--hover); color:var(--fg); }
  .lk.danger:hover { color:var(--danger); background:var(--hover); }
  .lk.go { color:#fff; background:var(--brand); } .lk.go:hover { color:#fff; filter:brightness(1.06); }
  ul.tree { list-style:none; margin:0; padding:0 0 0 16px; } ul.tree.root { padding-left:0; }
  .node { border-top:1px solid var(--line); }
  .node:first-child { border-top:0; }
  .row { display:flex; align-items:center; gap:6px; padding:8px 2px; flex-wrap:wrap; }
  code.key { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); min-width:120px; }
  .moverow { display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin:2px 0 10px 8px; padding:11px 13px; border-left:2px solid var(--brand); background:var(--hover); border-radius:0 10px 10px 0; }
  .moverow .mlbl { font-size:13px; font-weight:600; }
  .moverow select { min-width:220px; max-width:360px; }
  .busy { opacity:.55; pointer-events:none; }
`;

class GbtiCategoryManager extends GbtiElement {
  // SOW-070 fix: in admin.html's static markup, so it upgrades BEFORE admin.mjs injects the client. render() retries
  // the load the moment the client arrives (setClient re-renders subscribers) -- no eager load() that early-returns.
  connectedCallback() {
    super.connectedCallback();
    this._tree = null;
    this._msg = '';
    this._busy = false;
    this._moving = null; // the path whose inline move-picker is open, or null
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._tree = (await this.client.taxonomy())?.tree || {}; }
    catch { this._tree = {}; this._msg = 'Could not load the taxonomy.'; }
    this._loading = false;
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage categories.</p>`); return; }
    if (!this._tree) { if (!this._loading) { this._loading = true; this.load(); } this.set(this.css(CSS) + `<p class="muted">Loading categories...</p>`); return; }
    this._paths = this._flatten(this._tree); // [path, label] for every node -> the move-picker options
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      <div class="add-top">
        <input class="key" data-newtop-key type="text" placeholder="new-key (kebab-case)" />
        <input class="lab" data-newtop-label type="text" placeholder="Display label" />
        <button class="btn" type="button" data-addtop>Add top-level</button>
      </div>
      <ul class="tree root">${this._renderLevel(this._tree, []) || '<li class="muted">No categories yet.</li>'}</ul>
    </div>`);
    this._wire();
  }

  // Flatten the tree to [path, label] pairs (depth-first) -- the source for the move-picker destinations.
  _flatten(map, path = [], acc = []) {
    for (const [key, node] of Object.entries(map || {})) {
      const p = [...path, key];
      acc.push([p.join('/'), (node && node.label) || key]);
      if (node && node.children) this._flatten(node.children, p, acc);
    }
    return acc;
  }

  _renderLevel(map, path) {
    return Object.entries(map || {}).map(([key, node]) => {
      const p = [...path, key];
      const ps = p.join('/');
      const kids = node && node.children ? this._renderLevel(node.children, p) : '';
      return `<li class="node">
        <div class="row">
          <code class="key">${esc(key)}</code>
          <input class="lab" data-path="${esc(ps)}" type="text" value="${esc((node && node.label) || '')}" />
          <button class="lk" type="button" data-rename="${esc(ps)}">Label</button>
          <button class="lk" type="button" data-addsub="${esc(ps)}">+ Sub</button>
          <button class="lk" type="button" data-key="${esc(ps)}">Key</button>
          <button class="lk" type="button" data-move="${esc(ps)}">Move</button>
          <button class="lk danger" type="button" data-remove="${esc(ps)}">Remove</button>
        </div>
        ${this._moving === ps ? this._movePicker(ps) : ''}
        ${kids ? `<ul class="tree">${kids}</ul>` : ''}
      </li>`;
    }).join('');
  }

  // Inline destination picker for a move: every node EXCEPT the node itself, its descendants (would create a cycle),
  // and its current parent (a no-op), plus "Top level" when it is not already top-level.
  _movePicker(ps) {
    const parent = ps.split('/').slice(0, -1).join('/');
    const opts = (this._paths || [])
      .filter(([vp]) => vp !== ps && !vp.startsWith(`${ps}/`) && vp !== parent)
      .map(([vp, lbl]) => `<option value="${esc(vp)}">${esc(lbl)} &middot; ${esc(vp)}</option>`)
      .join('');
    const top = parent === '' ? '' : `<option value="">Top level</option>`;
    return `<div class="moverow">
      <span class="mlbl">Move under</span>
      <select data-moveto>${top}${opts || '<option value="" disabled>No valid destination</option>'}</select>
      <button class="lk go" type="button" data-moveconfirm="${esc(ps)}">Move here</button>
      <button class="lk" type="button" data-movecancel>Cancel</button>
    </div>`;
  }

  _wire() {
    this.on('[data-addtop]', 'click', () => {
      const key = (this.$('[data-newtop-key]')?.value || '').trim();
      const label = (this.$('[data-newtop-label]')?.value || '').trim();
      if (key && label) this._run(() => this.client.addCategory({ parentPath: [], key, label }));
    });
    this.$$('[data-rename]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.rename;
      const label = (this.$(`input.lab[data-path="${ps}"]`)?.value || '').trim();
      if (label) this._run(() => this.client.renameCategory({ path: ps.split('/'), label }));
    }));
    this.$$('[data-addsub]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.addsub;
      const key = (typeof prompt === 'function' ? prompt(`New subcategory key under "${ps}" (kebab-case)`) : '') || '';
      if (!key.trim()) return;
      const label = (typeof prompt === 'function' ? prompt('Display label') : '') || '';
      if (!label.trim()) return;
      this._run(() => this.client.addCategory({ parentPath: ps.split('/'), key: key.trim(), label: label.trim() }));
    }));
    // SOW-055 Phase 2: the PATH-CHANGING ops run as a CI migration (rewrites affected content in one review-gated PR).
    this.$$('[data-key]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.key;
      const newKey = (typeof prompt === 'function' ? prompt(`Rename the KEY of "${ps}" (kebab-case). This rewrites every content item under it.`) : '') || '';
      if (newKey.trim()) this._migrate('rename', ps, { newKey: newKey.trim() });
    }));
    // Move: an INLINE parent picker (no path typing). The button toggles the picker open under the node.
    this.$$('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.move;
      this._moving = this._moving === ps ? null : ps;
      this.render();
    }));
    this.$$('[data-moveconfirm]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.moveconfirm;
      const toParent = this.$('[data-moveto]')?.value ?? '';
      this._moving = null;
      this._migrate('move', ps, { toParent });
    }));
    this.on('[data-movecancel]', 'click', () => { this._moving = null; this.render(); });
    this.$$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.remove;
      if (typeof confirm === 'function' && !confirm(`Remove "${ps}"? If content uses it, the migration is REFUSED unless you reassign.`)) return;
      const reassign = typeof confirm === 'function' ? confirm('Reassign affected content to the PARENT category? OK = reassign, Cancel = only remove if nothing uses it.') : false;
      this._migrate('remove', ps, { reassign });
    }));
  }

  async _migrate(action, ps, extra) {
    this._busy = true; this._msg = ''; this.render();
    try {
      await this.client.adminOp('category-migrate', { action, from: ps, ...extra, apply: true });
      this._msg = `Migration triggered (${action} ${ps}). A review-gated PR opens via CI (merge it once content-check is green; it is not auto-merged). A would-orphan remove is refused — see the repo Actions tab. The tree updates after the PR merges.`;
    } catch (err) {
      this._msg = err?.message || 'Could not trigger the migration.';
    }
    this._busy = false; this.render();
  }

  async _run(fn) {
    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await fn();
      this._msg = r?.noop ? 'No change (already in that state).' : (r?.prNumber ? submitAck({ prNumber: r.prNumber, autoMerge: false }) : 'Done.'); // SOW-072 P2: consistent ack (house edit -> code-owner review)
    } catch (err) {
      this._msg = err?.message || 'The edit failed.';
    }
    this._busy = false;
    await this.load(); // re-read the tree (reflects once the PR merges + the CDN propagates)
  }
}

define('gbti-category-manager', GbtiCategoryManager);
export { GbtiCategoryManager };
