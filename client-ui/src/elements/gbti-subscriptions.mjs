// <gbti-subscriptions> (SOW-037): the member's subscriptions management surface, shown in the workspace
// "Subscriptions" tab. Two parts: (1) a compact "Your membership" card (the Stripe-derived status from
// client.status(), with a manage-membership link), and (2) the follow graph (SOW-023) read from client.getFollows()
// with an unfollow control per member + a "find members" entry point. Follows are effective-paid (the Worker is
// the authority, fail-closed); a non-paid caller sees the become-a-member state. Host-agnostic + inert in public.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
const MEMBERSHIP = { paid: 'Paid member', trial: 'Trial', trialing: 'Trial' };
const followList = (r) => (Array.isArray(r) ? r : (r?.following ?? []));

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { margin:0 0 26px; }
  .sec h3 { font-size:15px; margin:0 0 12px; }
  .card { display:flex; align-items:center; gap:12px; border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card .who { flex:1; min-width:0; }
  .card .who b { display:block; font-size:14.5px; }
  .card .who span { font-size:13px; color:var(--muted); }
  .tag { flex:none; font-size:12px; font-weight:700; border-radius:999px; padding:3px 11px; background:var(--hover); color:var(--muted); }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .btn { flex:none; font:inherit; font-weight:600; font-size:13px; padding:8px 14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:11px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .av { width:30px; height:30px; border-radius:50%; flex:none; object-fit:cover; background:var(--hover); }
  .row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; font-size:14px; color:var(--fg); text-decoration:none; }
  a.nm:hover { color:var(--accent); }
  .lk { flex:none; background:none; border:0; font:inherit; font-size:13px; font-weight:600; color:var(--danger); cursor:pointer; padding:4px 6px; border-radius:6px; }
  .lk:hover { background:var(--hover); }
  .muted { color:var(--muted); font-size:14px; }
  .find { margin-top:12px; }
  .find a { color:var(--accent); font-weight:600; font-size:13.5px; text-decoration:none; }
  .busy { opacity:.6; pointer-events:none; }
`;

class GbtiSubscriptions extends GbtiElement {
  connectedCallback() {
    this._membership = null; // 'paid' | 'trial' | ... | null
    this._follows = null; // array, or null when not loaded / paid-denied
    this._followsError = false;
    this._busy = false;
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    try { this._membership = (await this.client.status())?.membership ?? 'unknown'; } catch { this._membership = 'unknown'; }
    await this._reloadFollows(false);
    this.render();
  }

  async _reloadFollows(rerender = true) {
    try {
      this._follows = followList(await this.client.getFollows()).filter((f) => f && f.username);
      this._followsError = false;
    } catch {
      this._follows = null; // the paid-only Worker denied the read (trial/visitor), or it was unreachable
      this._followsError = true;
    }
    if (rerender) this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to manage your subscriptions.</p>`); return; }
    if (this._membership === null) { this.set(this.css(CSS) + `<p class="muted">Loading your subscriptions...</p>`); return; }

    const m = this._membership;
    const label = MEMBERSHIP[m] || (m === 'unknown' ? 'Not signed in' : 'Inactive');
    const card = `<div class="card">
      <div class="who"><b>Your membership</b><span>GBTI Network</span></div>
      <span class="tag ${m === 'paid' ? 'ok' : ''}">${esc(label)}</span>
      <a class="btn" href="${SITE}/membership/" target="_blank" rel="noopener">Manage</a>
    </div>`;

    let followHtml;
    if (this._follows === null) {
      followHtml = `<p class="muted">Following is a paid member feature. <a href="${SITE}/membership/" style="color:var(--accent)">Become a member</a> to subscribe to other members' activity.</p>`;
    } else if (!this._follows.length) {
      followHtml = `<p class="muted">You are not following anyone yet.</p>`;
    } else {
      followHtml = `<ul class="rows">${this._follows.map((f) => {
        const u = esc(f.username);
        return `<li class="row">
          <img class="av" src="https://github.com/${encodeURIComponent(f.username)}.png?size=60" alt="" loading="lazy" data-avfor="${u}" />
          <a class="nm" href="${SITE}/members/${u}/" target="_blank" rel="noopener">@${u}</a>
          <button class="lk" data-unfollow="${u}" type="button">Unfollow</button>
        </li>`;
      }).join('')}</ul>`;
    }

    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <section class="sec"><h3>Membership</h3>${card}</section>
      <section class="sec"><h3>Following</h3>${followHtml}
        <div class="find"><a href="${SITE}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>
      </section></div>`);
    // CSP-safe avatar fallback (inline onerror is blocked under the extension CSP).
    this.$$('[data-avfor]').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
    this.$$('[data-unfollow]').forEach((b) => b.addEventListener('click', () => this._unfollow(b.dataset.unfollow)));
  }

  async _unfollow(username) {
    this._busy = true; this.render();
    try { this._follows = followList(await this.client.setFollow({ username, on: false })).filter((f) => f && f.username); }
    catch { await this._reloadFollows(false); }
    this._busy = false; this.render();
  }
}

define('gbti-subscriptions', GbtiSubscriptions);
export { GbtiSubscriptions };
