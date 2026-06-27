// <gbti-category-manager> (SOW-055 v1): the superadmin category manager. Renders the canonical taxonomy tree
// (client.taxonomy() -> { tree }) and offers the two SAFE edits — ADD a category/subcategory and RENAME a node's
// LABEL. Each edit calls the admin op (client.addCategory / client.renameCategory), which opens an auto-merged
// house PR (the SOW-038 governance model); the tree refreshes after the PR merges + the CDN propagates. The
// path-changing ops (move/remove/key-rename) are SOW-055 Phase 2 (they need the content migration) and are not
// offered here. Admin-only by where it is mounted + the server-side gate; inert without a client.
import { GbtiElement, define, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; gap:10px; margin:0 0 6px; }
  .head h3 { margin:0; font-size:15px; }
  .hint { color:var(--muted); font-size:12px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0 10px; }
  .muted { color:var(--muted); font-size:13.5px; }
  .add-top { display:flex; gap:6px; margin:10px 0 14px; flex-wrap:wrap; }
  input { font:inherit; font-size:13px; padding:6px 9px; border:1px solid var(--line); border-radius:2px; background:var(--panel); color:var(--fg); }
  input.key { width:150px; } input.lab { flex:1; min-width:120px; }
  .btn { font:inherit; font-weight:600; font-size:13px; padding:6px 12px; border:0; border-radius:2px; background:var(--accent); color:#fff; cursor:pointer; }
  .lk { font:inherit; font-size:12.5px; font-weight:600; color:var(--accent); background:none; border:0; cursor:pointer; padding:4px 6px; border-radius:2px; }
  .lk:hover { background:var(--hover); }
  .lk.danger { color:var(--danger); }
  ul.tree { list-style:none; margin:0; padding:0 0 0 16px; } ul.tree.root { padding-left:0; }
  .node { border-top:1px solid var(--line); }
  .node:first-child { border-top:0; }
  .row { display:flex; align-items:center; gap:8px; padding:7px 2px; }
  code.key { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); min-width:120px; }
  .busy { opacity:.55; pointer-events:none; }
`;

class GbtiCategoryManager extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._tree = null;
    this._msg = '';
    this._busy = false;
    this.load();
  }

  async load() {
    if (!this.client) { this.render(); return; }
    try { this._tree = (await this.client.taxonomy())?.tree || {}; }
    catch { this._tree = {}; this._msg = 'Could not load the taxonomy.'; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (admin) to manage categories.</p>`); return; }
    if (!this._tree) { this.set(this.css(CSS) + `<p class="muted">Loading categories...</p>`); return; }
    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <div class="head"><h3>Category manager</h3><span class="hint">Edits open an auto-merged house PR.</span></div>
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
        ${kids ? `<ul class="tree">${kids}</ul>` : ''}
      </li>`;
    }).join('');
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
    // SOW-055 Phase 2: the PATH-CHANGING ops run as a CI migration (rewrites affected content in one PR). They
    // are triggered via the admin-ops dispatch (fire-and-forget); the result lands as a PR / an Actions run.
    this.$$('[data-key]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.key;
      const newKey = (typeof prompt === 'function' ? prompt(`Rename the KEY of "${ps}" (kebab-case). This rewrites every content item under it.`) : '') || '';
      if (newKey.trim()) this._migrate('rename', ps, { newKey: newKey.trim() });
    }));
    this.$$('[data-move]').forEach((b) => b.addEventListener('click', () => {
      const ps = b.dataset.move;
      const toParent = (typeof prompt === 'function' ? prompt(`Move "${ps}" under which parent path? (slash-joined, blank = top level). This rewrites content under it.`) : null);
      if (toParent !== null) this._migrate('move', ps, { toParent: toParent.trim() });
    }));
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
      this._msg = r?.noop ? 'No change (already in that state).' : (r?.number ? submitAck({ prNumber: r.number, autoMerge: true }) : 'Done.'); // SOW-072 P2: consistent ack
    } catch (err) {
      this._msg = err?.message || 'The edit failed.';
    }
    this._busy = false;
    await this.load(); // re-read the tree (reflects once the PR merges + the CDN propagates)
  }
}

define('gbti-category-manager', GbtiCategoryManager);
export { GbtiCategoryManager };
