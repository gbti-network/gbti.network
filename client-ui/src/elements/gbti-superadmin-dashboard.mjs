// <gbti-superadmin-dashboard> (SOW-038 P2): the admin read-view. Calls client.overrides() (GET /api/overrides,
// admin-gated) for a roster of every known member with their OVERRIDE-derived effective status (ban > staff >
// grandfather), computed from the public house/*.yml. Self-gates: a non-admin caller gets a quiet notice (the
// route is the real boundary). Live per-member Stripe paid/trial is NOT shown here — that needs a Stripe-key
// Worker endpoint (called out in the footnote). Inert in public (no client). The token never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 16px; }
  .chip { font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; }
  .chip b { color:var(--fg); }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:700; padding:0 8px 8px; border-bottom:1px solid var(--line); }
  td { padding:9px 8px; border-top:1px solid var(--line); vertical-align:middle; }
  tr:first-child td { border-top:0; }
  .who { display:flex; align-items:center; gap:9px; min-width:0; }
  .av { width:26px; height:26px; border-radius:50%; flex:none; object-fit:cover; background:var(--hover); }
  .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; }
  a.nm:hover { color:var(--accent); }
  .id { color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .tags { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
  .tag { font-size:11px; font-weight:700; border-radius:999px; padding:2px 9px; background:var(--hover); color:var(--muted); white-space:nowrap; }
  .tag.staff { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.gf { background:rgba(201,150,43,.16); color:#a1741a; }
  .tag.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .stat { font-size:11.5px; font-weight:700; border-radius:999px; padding:2px 10px; white-space:nowrap; background:var(--hover); color:var(--muted); }
  .stat.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .stat.tr { background:rgba(201,150,43,.16); color:#a1741a; }
  .stat.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .src { color:var(--muted); font-size:11px; margin-left:6px; }
  .dash { color:var(--muted); }
  .muted { color:var(--muted); font-size:14px; }
  .note { color:var(--muted); font-size:12.5px; margin:14px 0 0; line-height:1.5; }
`;

const ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

class GbtiSuperadminDashboard extends GbtiElement {
  connectedCallback() {
    this._data = null; // { roster, summary }
    this._error = null; // 'forbidden' | 'auth' | 'error'
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    try {
      const r = await this.client.overrides();
      this._data = { roster: r?.roster || [], summary: r?.summary || {} };
    } catch (err) {
      const code = err?.code;
      this._error = code === 'forbidden' ? 'forbidden' : (code === 'no-identity' || code === 'not-authenticated') ? 'auth' : 'error';
    }
    this.render();
  }

  // The effective-status cell: the resolved status badge + the override source when it overrode Stripe.
  _statusCell(m) {
    const LABEL = { paid: 'paid', trialing: 'trial', expired: 'expired', cancelled: 'cancelled', none: 'none', banned: 'banned', unknown: 'unknown' };
    const cls = m.status === 'paid' ? 'ok' : m.status === 'banned' ? 'ban' : m.status === 'trialing' ? 'tr' : '';
    const src = m.source && m.source !== 'stripe' ? `<span class="src">via ${esc(m.source)}</span>` : '';
    return `<span class="stat ${cls}">${esc(LABEL[m.status] || m.status)}</span>${src}`;
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to view the member roster.</p>`); return; }
    if (this._error === 'forbidden') { this.set(this.css(CSS) + `<p class="muted">The superadmin dashboard is available to admins and superadmins.</p>`); return; }
    if (this._error === 'auth') { this.set(this.css(CSS) + `<p class="muted">Sign in to view the member roster.</p>`); return; }
    if (this._error) { this.set(this.css(CSS) + `<p class="muted">Could not load the member roster. Try again shortly.</p>`); return; }
    if (!this._data) { this.set(this.css(CSS) + `<p class="muted">Loading the member roster...</p>`); return; }

    const s = this._data.summary || {};
    const chips = `<div class="chips">
      <span class="chip"><b>${esc(s.total ?? 0)}</b> known</span>
      <span class="chip"><b>${esc(s.staff ?? 0)}</b> staff</span>
      <span class="chip"><b>${esc(s.grandfathered ?? 0)}</b> grandfathered</span>
      <span class="chip"><b>${esc(s.banned ?? 0)}</b> banned</span>
    </div>`;

    const rows = (this._data.roster || []).map((m) => {
      const u = m.username ? esc(m.username) : '';
      const who = m.username
        ? `<a class="nm" href="https://gbti.network/members/${u}/" target="_blank" rel="noopener">@${u}</a>`
        : `<span class="nm id">id ${esc(m.githubId)}</span>`;
      const av = m.username
        ? `<img class="av" src="https://github.com/${encodeURIComponent(m.username)}.png?size=52" alt="" loading="lazy" data-avfor="${u}" />`
        : `<span class="av"></span>`;
      const tags = [];
      if (m.banned) tags.push(`<span class="tag ban">banned</span>`);
      if ((ROLE_RANK[m.role] ?? 0) > 0) tags.push(`<span class="tag staff">${esc(m.role)}</span>`);
      if (m.grandfathered) tags.push(`<span class="tag gf">grandfathered${m.grandfatherUntil ? ` · until ${esc(String(m.grandfatherUntil).slice(0, 10))}` : ''}</span>`);
      if (!tags.length) tags.push(`<span class="dash">—</span>`);
      return `<tr><td><div class="who">${av}${who}</div></td><td>${this._statusCell(m)}</td><td><div class="tags">${tags.join('')}</div></td><td class="id">${esc(m.githubId)}</td></tr>`;
    }).join('');

    this.set(this.css(CSS) + `${chips}
      <table><thead><tr><th>Member</th><th>Status</th><th>Overrides</th><th>github_id</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="muted">No members known yet.</td></tr>'}</tbody></table>
      <p class="note">Effective status follows ban &gt; staff &gt; grandfather &gt; Stripe. The live Stripe tier is shown when the admin Stripe endpoint is reachable (otherwise it reads "unknown"); the override tiers (ban / staff / grandfather) are always authoritative from the public repo.</p>`);

    this.$$('[data-avfor]').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
  }
}

define('gbti-superadmin-dashboard', GbtiSuperadminDashboard);
export { GbtiSuperadminDashboard };
