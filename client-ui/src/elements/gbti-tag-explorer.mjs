// <gbti-tag-explorer> (SOW-100 follow-on, owner-directed): the Admin -> Tags surface. Tags are the free-form
// cross-cutting labels on posts/prompts/products (`tags: []`), distinct from the canonical category taxonomy.
// This explorer aggregates them from the public index JSONs (one CDN fetch per type, no auth): a searchable
// table of tags with per-type counts, and a click-through list of the items carrying a tag. Read-only v1 —
// tag curation (rename/merge/retire) is a follow-up once usage patterns are visible. Inert without a client
// only in the sense of consistency; the data is public, but the surface lives on the admin page.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
const INDEXES = { post: 'blog-index.json', prompt: 'prompts-index.json', product: 'products-index.json' };
const TYPE_LABEL = { post: 'Articles', prompt: 'Prompts', product: 'Products' };

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); --r7:7px; }
  .muted { color:var(--muted); font-size:13.5px; }
  .bar { display:flex; gap:10px; align-items:center; margin-bottom:12px; flex-wrap:wrap; }
  .bar input { flex:1; min-width:200px; font:inherit; font-size:13.5px; padding:9px 12px; border:1.5px solid var(--line); border-radius:var(--r7); background:var(--bg, transparent); color:var(--fg); }
  .bar input:focus-visible { outline:2px solid var(--brand); outline-offset:1px; }
  .count { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); padding:8px 10px; border-bottom:1.5px solid var(--line); cursor:pointer; user-select:none; }
  th.num, td.num { text-align:right; font-family:var(--font-mono, monospace); font-size:12.5px; }
  td { padding:8px 10px; border-bottom:1px solid var(--line); }
  tr.tag { cursor:pointer; }
  tr.tag:hover td { background:var(--hover); }
  tr.tag.on td { background:var(--hover); color:var(--brand); font-weight:600; }
  .tagname { font-family:var(--font-mono, monospace); }
  .items { margin-top:14px; border:1.5px solid var(--line); border-radius:var(--r7); padding:12px 14px; background:var(--panel); backdrop-filter:var(--glass-blur); }
  .items h4 { margin:0 0 8px; font-size:14px; }
  .irow { display:flex; align-items:center; gap:9px; padding:7px 2px; border-top:1px solid var(--line); }
  .irow:first-of-type { border-top:0; }
  .irow a { color:var(--fg); text-decoration:none; font-weight:600; font-size:13.5px; }
  .irow a:hover { color:var(--brand); }
  .irow .ty { font-family:var(--font-mono, monospace); font-size:10.5px; text-transform:uppercase; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; flex:none; }
  .irow .au { margin-left:auto; font-family:var(--font-mono, monospace); font-size:11.5px; color:var(--muted); }
`;

class GbtiTagExplorer extends GbtiElement {
  connectedCallback() {
    this._rows = null;   // [{tag, post, prompt, product, total, items:[]}]
    this._q = '';
    this._sort = 'total';
    this._sel = null;    // selected tag
    super.connectedCallback?.();
  }

  async load() {
    const byTag = new Map();
    await Promise.all(Object.entries(INDEXES).map(async ([type, file]) => {
      try {
        const res = await fetch(`${SITE}/${file}`, { cache: 'no-cache' });
        const data = await res.json();
        for (const it of (Array.isArray(data) ? data : data?.items || [])) {
          for (const raw of it.tags || []) {
            const tag = String(raw).trim().toLowerCase();
            if (!tag) continue;
            let row = byTag.get(tag);
            if (!row) { row = { tag, post: 0, prompt: 0, product: 0, total: 0, items: [] }; byTag.set(tag, row); }
            row[type] += 1; row.total += 1;
            row.items.push({ type, title: it.title || it.slug, url: it.url, author: it.author });
          }
        }
      } catch { /* a missing index leaves its type at zero */ }
    }));
    this._rows = [...byTag.values()];
    this._loading = false;
    this.render();
  }

  render() {
    if (!this._rows) {
      if (!this._loading) { this._loading = true; this.load(); }
      this.set(this.css(CSS) + `<p class="muted">Aggregating tags from the content indexes…</p>`);
      return;
    }
    const q = this._q.trim().toLowerCase();
    const rows = this._rows
      .filter((r) => !q || r.tag.includes(q))
      .sort((a, b) => (this._sort === 'tag' ? a.tag.localeCompare(b.tag) : (b[this._sort] ?? 0) - (a[this._sort] ?? 0) || a.tag.localeCompare(b.tag)));
    const sel = this._sel ? this._rows.find((r) => r.tag === this._sel) : null;
    this.set(this.css(CSS) + `
      <div class="bar"><input id="q" type="search" placeholder="Filter tags…" value="${esc(this._q)}" /><span class="count">${rows.length} of ${this._rows.length} tags</span></div>
      <table><thead><tr>
        <th data-sort="tag">Tag</th><th class="num" data-sort="post">Articles</th><th class="num" data-sort="prompt">Prompts</th><th class="num" data-sort="product">Products</th><th class="num" data-sort="total">Total</th>
      </tr></thead><tbody>
        ${rows.map((r) => `<tr class="tag${r.tag === this._sel ? ' on' : ''}" data-tag="${esc(r.tag)}"><td class="tagname">${esc(r.tag)}</td><td class="num">${r.post}</td><td class="num">${r.prompt}</td><td class="num">${r.product}</td><td class="num">${r.total}</td></tr>`).join('')}
      </tbody></table>
      ${sel ? `<div class="items"><h4>Items tagged <code>${esc(sel.tag)}</code></h4>
        ${sel.items.map((i) => `<div class="irow"><span class="ty">${esc(TYPE_LABEL[i.type] || i.type)}</span><a href="${SITE}${esc(i.url || '')}" target="_blank" rel="noopener">${esc(i.title)}</a><span class="au">@${esc(i.author || '')}</span></div>`).join('')}
      </div>` : ''}
    `);
    this.$('#q')?.addEventListener('input', (e) => { this._q = e.target.value; this.render(); const el = this.$('#q'); el?.focus(); el?.setSelectionRange(el.value.length, el.value.length); });
    this.$$('th[data-sort]').forEach((h) => h.addEventListener('click', () => { this._sort = h.dataset.sort; this.render(); }));
    this.$$('tr[data-tag]').forEach((tr) => tr.addEventListener('click', () => { this._sel = this._sel === tr.dataset.tag ? null : tr.dataset.tag; this.render(); }));
  }
}

define('gbti-tag-explorer', GbtiTagExplorer);
