// <gbti-upvote> (SOW-057): an upvote toggle for a Share. Mirrors <gbti-favorite>, but a click calls
// client.toggleUpvote(), which (effective-paid) records the per-member upvote in the DELETABLE edge store (KV)
// and the per-target voter set; when two DISTINCT non-author members upvote, the Worker enqueues the share for
// SOW-058 syndication. The displayed count is the live distinct count the Worker returns. The token never reaches
// the page (the host holds it). Shares are extension-only, so there is no inert static fallback to upgrade.
import { GbtiElement, define } from '../base.mjs';

// Up-arrow inlined (a Shadow-DOM <use> cannot reach the page sprite).
const arrow = (filled) =>
  `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4l8 9h-5v7h-6v-7H4z" fill="${filled ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;

const CSS = `
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  .pill svg { flex:none; }
  .pill .c { font-variant-numeric: tabular-nums; }
`;

class GbtiUpvote extends GbtiElement {
  render() {
    const targetType = this.dataset?.gbtiTargetType || 'share';
    const targetSlug = this.dataset?.gbtiTargetSlug;
    if (this._count === undefined) {
      const n = parseInt(this.dataset?.gbtiCount || '0', 10);
      this._count = Number.isFinite(n) && n > 0 ? n : 0;
    }
    if (this._voted === undefined) this._voted = this.dataset?.gbtiVoted === 'true';
    const c = Math.max(0, this._count);
    const label = !this.client ? 'Sign in to upvote' : this._voted ? 'Remove upvote' : 'Upvote';
    this.set(
      this.css(CSS) +
        `<button class="pill ${this._voted ? 'on' : ''}" type="button" aria-pressed="${this._voted}" aria-label="${label}" title="${label}">${arrow(this._voted)}<span class="c">${c}</span></button>`,
    );
    this.on('.pill', 'click', () => this._onClick(targetType, targetSlug));
  }

  _onClick(targetType, targetSlug) {
    if (!this.client) { window.location.href = '/membership/'; return; }
    this._toggle(targetType, targetSlug);
  }

  async _toggle(targetType, targetSlug) {
    const next = !this._voted;
    this._voted = next;
    this._count = Math.max(0, this._count + (next ? 1 : -1));
    this.render();
    try {
      const res = await this.client.toggleUpvote({ targetType, targetSlug, on: next });
      // Adopt the Worker's truth: the live distinct count and the resulting voted state.
      if (res && typeof res.count === 'number') this._count = Math.max(0, res.count);
      if (res && typeof res.upvoted === 'boolean') this._voted = res.upvoted;
      this.render();
    } catch (err) {
      this._voted = !next; // revert
      this._count = Math.max(0, this._count + (next ? -1 : 1));
      this.render();
      if (err?.code === 'not-authenticated' || err?.code === 'membership-required' || err?.code === 'upvote-failed') {
        // a paid-gate denial: nudge to membership (the Worker is the real boundary)
        if (err.code !== 'upvote-failed') window.location.href = '/membership/';
      }
    }
  }
}

define('gbti-upvote', GbtiUpvote);
export { GbtiUpvote };
