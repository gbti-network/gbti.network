// <gbti-account> (SOW-040): the member-facing Account / Settings surface. Host-agnostic — it talks ONLY to the
// injected client and reuses endpoints that already exist (status, getBilling -> the Stripe customer portal,
// getReferral, discordInvite). Distinct from <gbti-settings> (npm-CMS-only local dev config). Inert in public (no
// client -> a sign-in nudge). Four sections: Account (sign out + reset welcome), Membership & billing, Referrals &
// invites, and a visually-separated Danger zone (cancel via the Stripe portal; delete = a type-to-confirm that
// clears local data + files a GDPR erasure request — the full self-service KV/Stripe erase is the SOW-024-aligned
// follow-up, legal-parked, so v1 surfaces the entry point + does the safe parts only).
import { GbtiElement, define, esc } from '../base.mjs';
import { currentLayout, currentTheme, applyLayout, applyTheme } from '../display-prefs.mjs'; // SOW-070: the Appearance segment

const SITE = 'https://gbti.network';
const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);
// SOW-029: the welcome view's localStorage keys all share this prefix; "reset welcome" clears them so the
// post-setup welcome (join Discord + follow discovery) runs fresh.
const WELCOME_PREFIX = 'gbti-welcome';

const STATUS_LABEL = {
  paid: 'Paid member', trialing: 'Free trial', expired: 'Trial expired',
  cancelled: 'Cancelled', none: 'Not a member', banned: 'Suspended', unknown: 'Unknown',
};

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:0 0 16px; background:var(--panel); -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .sec h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sec .hint { margin:0 0 14px; color:var(--muted); font-size:13px; }
  /* SOW-070: a 3-column grid (label | description | control) so the right-hand control (a button, or the Appearance
     segmented toggle) keeps its own column and the description never crushes/wraps into it. Stacks on small screens. */
  .row { display:grid; grid-template-columns:140px 1fr auto; align-items:center; gap:8px 14px; padding:10px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .row .lbl { font-weight:600; font-size:14px; }
  .row .val { color:var(--muted); font-size:13.5px; min-width:0; overflow-wrap:anywhere; }
  @media (max-width:560px) { .row { grid-template-columns:1fr; } }
  .badge { display:inline-block; font-family:var(--font-mono, monospace); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:2px 9px; background:var(--hover); color:var(--fg); }
  .badge.paid { background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); }
  .badge.warn { background:#fdecea; color:#b3261e; }
  button, a.btn { font:inherit; font-weight:600; font-size:13.5px; padding:8px 14px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none; display:inline-block; }
  button:hover, a.btn:hover { border-color:var(--accent); color:var(--accent); }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button.primary:hover { background:var(--brand-dark, var(--brand)); color:#fff; }
  /* SOW-070: the Appearance segmented controls (Layout + Theme). */
  .seg { display:inline-flex; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .segbtn { font:inherit; font-weight:600; font-size:13px; padding:7px 14px; border:0; border-radius:0; background:transparent; color:var(--muted); cursor:pointer; }
  .segbtn + .segbtn { border-left:1px solid var(--line); }
  .segbtn.on { background:var(--brand); color:#fff; }
  .segbtn:not(.on):hover { background:var(--hover); color:var(--fg); }
  .copyrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .copyrow input { flex:1; min-width:220px; font:inherit; font-size:13px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg, var(--panel)); color:var(--fg); }
  .nudge { padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  .msg { font-size:13px; margin-top:8px; } .msg.ok { color:var(--green-700, #0f6f40); } .msg.err { color:#b3261e; }
  /* danger zone */
  .danger { border:1.5px solid #f0c2bd; border-radius:14px; padding:16px 18px; background:#fff8f7; }
  [data-theme="dark"] .danger { background:rgba(179,38,30,.08); border-color:rgba(179,38,30,.4); }
  .danger h3 { color:#b3261e; }
  .danger .row { border-top-color:#f3d4d0; }
  [data-theme="dark"] .danger .row { border-top-color:rgba(179,38,30,.25); }
  button.danger-btn { border-color:#e0a39d; color:#b3261e; }
  button.danger-btn:hover { background:#b3261e; border-color:#b3261e; color:#fff; }
  .confirm { margin-top:10px; }
  .confirm input { font:inherit; font-size:13px; padding:7px 10px; border:1px solid #e0a39d; border-radius:8px; background:var(--panel); color:var(--fg); width:200px; }
`;

class GbtiAccount extends GbtiElement {
  _loaded = false;
  _loading = false; // SOW-070 fix: guards the client-ready-triggered load against re-entry

  // The injected client may not exist yet: this element is in account.html's STATIC markup, so it upgrades when
  // dist/account.js defines the elements -- BEFORE account.mjs calls mountPageClient()/setClient(). So we no longer
  // load eagerly here; render() -> _maybeLoad() runs the load the moment the client arrives (setClient re-renders
  // every subscriber via _onClient), which fixes the permanent "Loading your account…" with the client present.
  connectedCallback() {
    super.connectedCallback();
  }

  // Idempotent: kick the account-data load exactly once, as soon as the client is available.
  _maybeLoad() {
    if (this.client && !this._loaded && !this._loading) { this._loading = true; this._load(); }
  }

  async _load() {
    // Reached only via _maybeLoad (client present). SOW-040 follow-up: never hang on "Loading your account…". Each
    // call is caught to null AND raced against an 8s
    // timeout, so a background worker that goes idle, or an unsettling fetch (e.g. an expired token whose refresh
    // never resolves), degrades to the signed-out nudge / partial data instead of a permanent spinner.
    const guard = (p) => Promise.race([
      Promise.resolve(p).then((v) => v, () => null),
      new Promise((res) => { setTimeout(() => res(null), 8000); }),
    ]);
    try {
      const [status, billing, referral, invite] = await Promise.all([
        guard(this.client.status?.()),
        guard(this.client.getBilling?.()),
        guard(this.client.getReferral?.()),
        guard(this.client.discordInvite?.()),
      ]);
      this._status = status; this._billing = billing; this._referral = referral; this._invite = invite;
    } catch { /* fall through and render whatever resolved */ }
    this._loaded = true; this._loading = false;
    this.render();
  }

  get _signedIn() { return Boolean(this._status?.authenticated && this._status?.identity?.login); }
  get _login() { return this._status?.identity?.login || null; }
  get _membership() { return this._status?.membership || 'unknown'; }

  render() {
    this._maybeLoad(); // SOW-070 fix: start the load the moment the client is injected (setClient -> _onClient -> render)
    if (!this.client) { this.set(this.css(CSS) + `<div class="nudge">Open this in the GBTI client or extension to manage your account.</div>`); return; }
    // SOW-070: the Appearance segment (Layout Flat/Glass + Theme) is device-local (localStorage only), so it renders
    // in EVERY state and is NEVER gated behind the account-data load -- a slow or failed status/billing fetch must
    // not hide the display controls. Guarded so it can never itself break the page.
    let appearance = '';
    try { appearance = this._appearance(); } catch { /* never let the display controls break the render */ }
    if (!this._loaded) { this.set(this.css(CSS) + appearance + `<section class="sec"><p class="hint">Loading your account…</p></section>`); this._wire(); return; }
    if (!this._signedIn) {
      this.set(this.css(CSS) + appearance + `<div class="nudge">Sign in with the GBTI client to manage your account. <a href="${SITE}/membership/">Become a member</a>.</div>`);
      this._wire();
      return;
    }
    // Fail-safe: a throw in any account-data section must never leave the page stuck on "Loading your account…".
    let sections;
    try { sections = this._account() + appearance + this._billingSec() + this._referrals() + this._dangerZone(); }
    catch { sections = appearance + `<section class="sec"><h3>Account</h3><p class="hint">Some account details could not load. Reopen this page to retry.</p></section>`; }
    this.set(this.css(CSS) + sections);
    this._wire();
  }

  _account() {
    return `<section class="sec">
      <h3>Account</h3>
      <p class="hint">Signed in as <b>@${esc(this._login)}</b>.</p>
      <div class="row"><span class="lbl">Sign out</span><span class="val">End this session on this device.</span><button data-signout type="button">Sign out</button></div>
      <div class="row"><span class="lbl">Welcome tour</span><span class="val">Show the post-setup welcome (join Discord + discover members) again.</span><button data-reset-welcome type="button">Reset</button></div>
      <div class="msg" data-account-msg aria-live="polite"></div>
    </section>`;
  }

  // SOW-070: Appearance — Layout (Flat/Glass) + Theme (Light/Dark/System), device-local display prefs applied as
  // data-layout / data-theme on the document (tokens.mjs + shell.css react live). Theme shares the gbti-theme key with
  // the header quick-toggle so the two never disagree. Flat + System are the defaults.
  _appearance() {
    const layout = currentLayout();
    const theme = currentTheme();
    const seg = (name, options, active) => `<div class="seg">` + options
      .map(([v, lbl]) => `<button type="button" class="segbtn${v === active ? ' on' : ''}" data-set-${name}="${v}">${esc(lbl)}</button>`)
      .join('') + `</div>`;
    return `<section class="sec">
      <h3>Appearance</h3>
      <p class="hint">Display preferences for this device. Glass is an experimental frosted layout; Flat is the classic solid look.</p>
      <div class="row"><span class="lbl">Layout</span><span class="val">Frosted glass surfaces over an ambient backdrop, or the classic flat look.</span>${seg('layout', [['flat', 'Flat'], ['glass', 'Glass']], layout)}</div>
      <div class="row"><span class="lbl">Theme</span><span class="val">Light, dark, or follow your system.</span>${seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], theme)}</div>
    </section>`;
  }

  _billingSec() {
    const m = this._membership;
    const cls = m === 'paid' ? 'paid' : (LOCKED.has(m) ? 'warn' : '');
    const portal = this._billing?.portal;
    return `<section class="sec">
      <h3>Membership & billing</h3>
      <p class="hint">Your plan, invoices, and payment method.</p>
      <div class="row"><span class="lbl">Status</span><span class="val"><span class="badge ${cls}">${esc(STATUS_LABEL[m] || m)}</span></span></div>
      <div class="row"><span class="lbl">Invoices & receipts</span><span class="val">Manage your card, see invoices, and download receipts in the Stripe customer portal.</span>
        ${portal ? `<a class="btn" href="${esc(portal)}" target="_blank" rel="noopener">Open billing portal</a>` : `<span class="val">Billing portal unavailable.</span>`}</div>
    </section>`;
  }

  _referrals() {
    const r = this._referral || {};
    // The invite link keys on the immutable github_id, so a rename never misroutes a payout (SOW-007). A
    // human-friendly ?ref=<username> vanity link is a noted follow-up: it needs a join-side username->github_id
    // resolver (the members-index), and shipping it without one would break referral attribution.
    const canonical = r.link || (r.code ? `${SITE}/join?ref=${r.code}` : null);
    const invite = this._invite?.url || null;
    const copyField = (id, value, label) => `<div class="row"><span class="lbl">${esc(label)}</span><div class="copyrow"><input id="${id}" type="text" readonly value="${esc(value)}" /><button data-copy="${id}" type="button">Copy</button></div></div>`;
    return `<section class="sec">
      <h3>Referrals & invites</h3>
      <p class="hint">Share your invite link to earn a flat ${esc(r.invitePct || '10%')} lifetime commission on every member who joins through it (paid from the platform share, so it never reduces what content owners earn). You also earn from your published work, separately.</p>
      ${canonical ? copyField('ref-canonical', canonical, 'Your invite link') : ''}
      ${invite ? copyField('discord-invite', invite, 'Discord invite') : ''}
      ${!canonical && !invite ? `<p class="hint">No referral link yet. Sign in as a member to generate one.</p>` : ''}
      <div class="msg" data-ref-msg aria-live="polite"></div>
    </section>`;
  }

  _dangerZone() {
    const portal = this._billing?.portal;
    return `<section class="danger">
      <h3>Danger zone</h3>
      <p class="hint">These actions end your access or remove your data. They cannot be undone here.</p>
      <div class="row"><span class="lbl">Cancel membership</span><span class="val">Cancel in the Stripe portal (it handles proration + the period-end choice). Your paid access ends and your published content is set to draft on lapse.</span>
        ${portal ? `<a class="btn danger-btn" href="${esc(portal)}" target="_blank" rel="noopener">Cancel in portal</a>` : ''}</div>
      <div class="row"><span class="lbl">Delete account</span><span class="val">Request erasure of your account + data (GDPR). Type <b>DELETE</b> to confirm. Your private data is cleared on this device immediately; your published content + billing are removed by our erasure process.</span>
        <div class="confirm"><input data-delete-confirm type="text" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autocomplete="off" /> <button data-delete type="button" class="danger-btn" disabled>Request deletion</button></div>
      </div>
      <div class="msg" data-danger-msg aria-live="polite"></div>
    </section>`;
  }

  _wire() {
    // Sign out: emit the established request event; the host (account page / content script) performs the actual
    // chrome signout + reload. Host-agnostic — this element never touches chrome.* directly.
    this.on('[data-signout]', 'click', () => this.emit('gbti:request-signout'));
    this.on('[data-reset-welcome]', 'click', () => this._resetWelcome());
    this.$$('[data-copy]').forEach((b) => b.addEventListener('click', () => this._copy(b.dataset.copy)));
    // SOW-070: Appearance — apply + re-render so the active segment updates (tokens.mjs + shell.css re-skin live).
    this.$$('[data-set-layout]').forEach((b) => b.addEventListener('click', () => { applyLayout(b.dataset.setLayout); this.render(); }));
    this.$$('[data-set-theme]').forEach((b) => b.addEventListener('click', () => { applyTheme(b.dataset.setTheme); this.render(); }));
    // Delete: type-to-confirm enables the button only on exactly "DELETE".
    const confirm = this.$('[data-delete-confirm]');
    const delBtn = this.$('[data-delete]');
    if (confirm && delBtn) confirm.addEventListener('input', () => { delBtn.disabled = confirm.value.trim() !== 'DELETE'; });
    this.on('[data-delete]', 'click', () => this._requestDeletion());
  }

  _resetWelcome() {
    let n = 0;
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && k.startsWith(WELCOME_PREFIX)) { localStorage.removeItem(k); n++; }
      }
    } catch { /* storage blocked */ }
    this._say('[data-account-msg]', n ? 'Welcome tour reset. It will run again next time you open onboarding.' : 'Nothing to reset — the welcome tour has not run yet.', 'ok');
  }

  async _copy(id) {
    const el = this.$(`#${id}`);
    if (!el) return;
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(el.value);
      else { el.select(); document.execCommand?.('copy'); }
      this._say('[data-ref-msg]', 'Copied to your clipboard.', 'ok');
    } catch { this._say('[data-ref-msg]', 'Could not copy. Select the text and copy manually.', 'err'); }
  }

  // SOW-040 v1: the SAFE, legal-park-respecting parts of erasure. Clear the member's instant-deletable LOCAL data
  // (welcome flags) and FILE the request (sign out so the device session ends). The full self-service KV/Stripe
  // erase + content removal is the SOW-024-aligned follow-up (a Worker erase endpoint, owner-adjudicated content
  // removal) — deliberately NOT a one-click member action while the GDPR process is owner-run.
  _requestDeletion() {
    const confirm = this.$('[data-delete-confirm]');
    if (!confirm || confirm.value.trim() !== 'DELETE') { this._say('[data-danger-msg]', 'Type DELETE to confirm.', 'err'); return; }
    try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (k && k.startsWith(WELCOME_PREFIX)) localStorage.removeItem(k); } } catch { /* ignore */ }
    this._say('[data-danger-msg]', 'Deletion requested. Your private data on this device is cleared. Email privacy@gbti.network to complete erasure of your published content + billing (processed within 30 days). Signing you out…', 'ok');
    // File-and-sign-out: end the session; the owner-run erasure SOP (SOW-024) processes content + billing.
    setTimeout(() => this.emit('gbti:request-signout'), 2500);
  }

  _say(sel, text, kind) { const el = this.$(sel); if (el) { el.textContent = text; el.className = `msg ${kind || ''}`; } }
}

define('gbti-account', GbtiAccount);
export { GbtiAccount };
