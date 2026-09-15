// <gbti-cta-assignment type="prompt" ref="the-slug"> (sow-281): the READ-ONLY line in the content editor's Links
// section that says which registered CTA this item carries, or that it carries none and where a superadmin assigns
// one. It reads the built /ctas.json artifact (public, git-native, no client method needed) so it works in every
// host the editor runs in. Nothing here writes: the assignment belongs to the registry and to the superadmin
// CTAs tab, not to the member editing the item. A failed load shows the failure and a Try again button and does
// not retry on its own (sow-334).
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
const ADMIN = `${SITE}/admin/`;

const CSS = `
  :host { display:block; margin-top:10px; padding-top:10px; border-top:1px dashed var(--line); font-size:12.5px; color:var(--muted); line-height:1.5; }
  b { color:var(--fg); font-weight:600; }
  a { color:var(--accent); }
  .off { color:var(--warn, #c98a12); }
  .lk { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12px; font-weight:600; padding:3px 9px; cursor:pointer; margin-left:6px; }
`;

class GbtiCtaAssignment extends GbtiElement {
  static get observedAttributes() { return ['type', 'ref']; }
  attributeChangedCallback() { this._ctas = null; this._failed = false; if (this.isConnected) this.render(); }
  connectedCallback() { super.connectedCallback?.(); this.render(); }

  async load() {
    this._loading = true; this._failed = false;
    try {
      const r = await fetch(`${SITE}/ctas.json`, { cache: 'no-cache' });
      if (!r.ok) throw new Error(`ctas.json ${r.status}`);
      const j = await r.json();
      this._ctas = Array.isArray(j?.ctas) ? j.ctas : [];
    } catch (e) {
      this._ctas = null; this._failed = true; this._msg = `Could not read the CTA registry (${e?.message || 'unknown error'}).`;
    }
    this._loading = false;
    this.render();
  }

  /** The CTAs assigned to this item, enabled first. Exported logic for the tests via matchesFor. */
  get matches() { return matchesFor(this._ctas, this.getAttribute('type'), this.getAttribute('ref')); }

  render() {
    const type = this.getAttribute('type') || '';
    const ref = (this.getAttribute('ref') || '').trim();
    if (!type || !ref) { this.set(this.css(CSS) + `<span>CTA: none yet. Save the item with a permalink first; a superadmin assigns a CTA in <a href="${ADMIN}" target="_blank" rel="noopener">Admin, CTAs</a>.</span>`); return; }
    if (this._failed) {
      this.set(this.css(CSS) + `<span>${esc(this._msg)}</span><button class="lk" type="button" data-retry-load>Try again</button>`);
      this.$('[data-retry-load]')?.addEventListener('click', () => this.load());
      return;
    }
    if (!this._ctas) { if (!this._loading) this.load(); this.set(this.css(CSS) + `<span>CTA: checking...</span>`); return; }
    const m = this.matches;
    if (!m.length) { this.set(this.css(CSS) + `<span>CTA: <b>none</b>. A superadmin assigns one in <a href="${ADMIN}" target="_blank" rel="noopener">Admin, CTAs</a>.</span>`); return; }
    const parts = m.map((c) => `<b>${esc(c.label || c.id)}</b>${c.enabled ? '' : ' <span class="off">(disabled, so it does not render)</span>'}`);
    this.set(this.css(CSS) + `<span>CTA: ${parts.join(', ')}. Managed by a superadmin in <a href="${ADMIN}" target="_blank" rel="noopener">Admin, CTAs</a>.</span>`);
  }
}

/** The CTAs (from /ctas.json) assigned to one item, enabled first. Pure; exported for the tests. */
export function matchesFor(ctas, type, ref) {
  const r = String(ref || '').trim();
  if (!Array.isArray(ctas) || !type || !r) return [];
  return ctas
    .filter((c) => Array.isArray(c?.items) && c.items.some((it) => it && it.type === type && it.ref === r))
    .sort((a, b) => (b.enabled === true) - (a.enabled === true));
}

define('gbti-cta-assignment', GbtiCtaAssignment);
export { GbtiCtaAssignment };
