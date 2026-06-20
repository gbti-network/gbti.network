// <gbti-superadmin-dashboard> (SOW-038 P2): the admin read-view. Calls client.overrides() (GET /api/overrides,
// admin-gated) for a roster of every known member with their OVERRIDE-derived effective status (ban > staff >
// grandfather), computed from the public house/*.yml. Self-gates: a non-admin caller gets a quiet notice (the
// route is the real boundary). Live per-member Stripe paid/trial is NOT shown here — that needs a Stripe-key
// Worker endpoint (called out in the footnote). Inert in public (no client). The token never reaches the page.
import { GbtiElement, define, esc } from '../base.mjs';
import { indexFileFor, SAVED_TYPES } from '../saved-core.mjs';

const SITE = 'https://gbti.network';

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
  .sec-h { font-size:14px; font-weight:700; margin:26px 0 10px; display:flex; align-items:center; gap:8px; }
  .sec-h .ct { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); font-weight:600; }
  ul.prs { list-style:none; margin:0; padding:0; }
  .pr { display:flex; align-items:center; gap:10px; padding:8px 8px; border-top:1px solid var(--line); }
  .pr:first-child { border-top:0; }
  .pr-t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; font-weight:600; font-size:13.5px; }
  a.pr-t:hover { color:var(--accent); }
  .pr-m { flex:none; color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .muted { color:var(--muted); font-size:14px; }
  .note { color:var(--muted); font-size:12.5px; margin:14px 0 0; line-height:1.5; }
  /* SOW-038 P3: operations triggers */
  .ops { display:flex; flex-wrap:wrap; gap:10px; }
  .opbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 15px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .opbtn:hover { border-color:var(--accent); color:var(--accent); }
  .opbtn[disabled] { opacity:.6; cursor:default; }
  .opnote { font-size:12.5px; margin:10px 0 0; } .opnote.ok { color:var(--accent); } .opnote.err { color:var(--danger); }
`;

const ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

class GbtiSuperadminDashboard extends GbtiElement {
  connectedCallback() {
    this._data = null; // { roster, summary }
    this._pulls = null; // open content-PR queue, or null when unavailable
    this._counts = null; // { username(lower) -> published content count }, or null
    this._error = null; // 'forbidden' | 'auth' | 'error'
    super.connectedCallback?.();
    this._load();
  }

  // Per-member published content counts, from the PUBLIC per-type index JSONs (no auth, no new endpoint). Author
  // is the folder username; house/gbti content does not map to a member. Best-effort; a failure leaves it null.
  async _loadCounts() {
    const counts = {};
    await Promise.all(SAVED_TYPES.map(async (t) => {
      try {
        const res = await fetch(`${SITE}/${indexFileFor(t)}`, { cache: 'no-cache' });
        const items = res.ok ? ((await res.json()).items || []) : [];
        for (const it of items) { const a = String(it?.author || '').toLowerCase(); if (a && a !== 'gbti' && a !== 'house') counts[a] = (counts[a] || 0) + 1; }
      } catch { /* skip this type */ }
    }));
    this._counts = counts;
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    try {
      const r = await this.client.overrides();
      this._data = { roster: r?.roster || [], summary: r?.summary || {} };
    } catch (err) {
      const code = err?.code;
      this._error = code === 'forbidden' ? 'forbidden' : (code === 'no-identity' || code === 'not-authenticated') ? 'auth' : 'error';
      this.render();
      return;
    }
    // Admin confirmed (the roster loaded): also load the open content-PR queue + per-member content counts,
    // both best-effort (a failure just hides that column / panel).
    try { this._pulls = (await this.client.openPulls())?.pulls || []; } catch { this._pulls = null; }
    await this._loadCounts();
    this.render();
  }

  // The open content-PR queue (admin overview of what is awaiting the gate / review). null = not loaded.
  _pullsSection() {
    if (this._pulls === null) return '';
    if (!this._pulls.length) return `<h3 class="sec-h">Open pull requests</h3><p class="muted">No open pull requests right now.</p>`;
    const rows = this._pulls.map((p) => {
      const author = p.author?.login ? `@${esc(p.author.login)}` : 'unknown';
      const when = p.createdAt ? esc(String(p.createdAt).slice(0, 10)) : '';
      return `<li class="pr"><a class="pr-t" href="${esc(p.html_url || '#')}" target="_blank" rel="noopener">#${esc(p.number)} ${esc(p.title || '')}</a><span class="pr-m">${author}${when ? ` · ${when}` : ''}</span></li>`;
    }).join('');
    return `<h3 class="sec-h">Open pull requests <span class="ct">${this._pulls.length}</span></h3><ul class="prs">${rows}</ul>`;
  }

  // SOW-038 P3: the operations section (reconcile / E2E-smoke triggers). The dashboard is admin-gated (the roster
  // loaded), so these show only to a confirmed admin; the Worker re-checks + holds the dispatch token.
  _opsSection() {
    const note = this._opNote ? `<p class="opnote ${this._opNote.ok ? 'ok' : 'err'}">${esc(this._opNote.msg)}</p>` : '';
    return `<h3 class="sec-h">Operations</h3>
      <div class="ops">
        <button class="opbtn" data-op="reconcile" type="button">Run reconcile (apply)</button>
        <button class="opbtn" data-op="e2e" type="button">Run E2E smoke</button>
      </div>${note}
      <p class="note">Reconcile brings published content + Discord roles in line with Stripe + overrides (full <code>--apply</code>; idempotent). E2E smoke runs the live authenticated create &rarr; confirm &rarr; scrub cycle. Both kick off a GitHub Actions run; results appear in the repo's Actions tab.</p>`;
  }

  async _runOp(action, btn) {
    if (btn) btn.disabled = true;
    this._opNote = { ok: true, msg: 'Triggering&hellip;' };
    this.render();
    try {
      await this.client.adminOp(action);
      this._opNote = { ok: true, msg: `Triggered "${action}". Watch the run in the repo's Actions tab.` };
    } catch (err) {
      this._opNote = { ok: false, msg: err?.message || 'Could not trigger the operation.' };
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
      const n = this._counts && m.username ? (this._counts[m.username.toLowerCase()] || 0) : null;
      const content = n == null ? `<span class="dash">—</span>` : esc(n);
      return `<tr><td><div class="who">${av}${who}</div></td><td>${this._statusCell(m)}</td><td><div class="tags">${tags.join('')}</div></td><td class="id">${content}</td><td class="id">${esc(m.githubId)}</td></tr>`;
    }).join('');

    this.set(this.css(CSS) + `${chips}
      <table><thead><tr><th>Member</th><th>Status</th><th>Overrides</th><th>Content</th><th>github_id</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No members known yet.</td></tr>'}</tbody></table>
      <p class="note">Effective status follows ban &gt; staff &gt; grandfather &gt; Stripe. The live Stripe tier is shown when the admin Stripe endpoint is reachable (otherwise it reads "unknown"); the override tiers (ban / staff / grandfather) are always authoritative from the public repo.</p>
      ${this._pullsSection()}
      ${this._opsSection()}`);

    this.$$('[data-avfor]').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
    this.$$('[data-op]').forEach((b) => b.addEventListener('click', () => this._runOp(b.dataset.op, b))); // SOW-038 P3
  }
}

define('gbti-superadmin-dashboard', GbtiSuperadminDashboard);
export { GbtiSuperadminDashboard };
