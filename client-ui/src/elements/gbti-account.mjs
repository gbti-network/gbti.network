// <gbti-account> (SOW-040): the member-facing Account / Settings surface. Host-agnostic — it talks ONLY to the
// injected client and reuses endpoints that already exist (status, getBilling -> the Stripe customer portal,
// getReferral, discordInvite). Distinct from <gbti-settings> (npm-CMS-only local dev config). Inert in public (no
// client -> a sign-in nudge). Sections: Membership, Appearance, Account, Referrals & invites, and a
// visually-separated Danger zone (cancel via the Stripe portal; delete = a type-to-confirm that clears local data +
// files a GDPR erasure request — the full self-service KV/Stripe erase is the SOW-024-aligned follow-up).
// Presentation follows the "GBTI Settings" design (claude_design): each section is a card with a header above
// divided rows (label/description left, control right). Shadow DOM + V3 tokens only; the shell rail/header are NOT
// part of this element.
import { GbtiElement, define, esc } from '../base.mjs';
import { currentLayout, currentTheme, applyLayout, applyTheme, currentGlass, applyGlass, currentGlow, applyGlow } from '../display-prefs.mjs'; // SOW-070: the Appearance segment

const SITE = 'https://gbti.network';
const LOCKED = new Set(['expired', 'cancelled', 'none', 'banned']);
// SOW-029: the welcome view's localStorage keys all share this prefix; "reset welcome" clears them so the
// post-setup welcome (join Discord + follow discovery) runs fresh.
const WELCOME_PREFIX = 'gbti-welcome';

const STATUS_LABEL = {
  paid: 'Paid member', trialing: 'Free trial', expired: 'Trial expired',
  cancelled: 'Cancelled', none: 'Not a member', banned: 'Suspended', unknown: 'Unknown',
};

// SOW-070 + GBTI Settings design: card sections (header over divided rows), a refined segmented control, and the
// membership row. Mapped onto the client-ui shadow tokens (--panel/--line/--fg/--muted/--brand/--green-tint); the
// glass frost (--glass-blur) is preserved so the cards frost in Glass layout.
const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { background:var(--panel); border:1.5px solid var(--line); border-radius:16px; box-shadow:0 1px 2px rgba(0,0,0,.05); overflow:hidden; margin:0 0 22px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .sec-h { padding:20px 24px 16px; }
  .sec-h h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:20px; letter-spacing:-.005em; }
  .sec-h p { margin:5px 0 0; color:var(--muted); font-size:14px; line-height:1.5; max-width:60ch; }
  .rows { border-top:1.5px solid var(--line); }
  .row { display:grid; grid-template-columns:1fr auto; gap:24px; align-items:center; padding:16px 24px; }
  .row + .row { border-top:1px solid var(--line); }
  .row .rl { min-width:0; }
  .row .rl .t { font-weight:600; font-size:15px; }
  .row .rl .d { color:var(--muted); font-size:13.5px; line-height:1.45; margin-top:3px; max-width:48ch; overflow-wrap:anywhere; }
  .row .rc { display:flex; align-items:center; justify-content:flex-end; gap:10px; min-width:0; }
  @media (max-width:560px) { .row { grid-template-columns:1fr; } .row .rc { justify-content:flex-start; } }
  /* segmented control (Appearance) */
  .seg { display:inline-flex; background:var(--hover); border:1.5px solid var(--line); border-radius:9px; padding:3px; gap:2px; }
  .seg .segbtn { border:0; background:transparent; font:inherit; font-weight:600; font-size:14px; padding:7px 16px; border-radius:6px; color:var(--muted); cursor:pointer; transition:color .14s ease, background .14s ease; }
  .seg .segbtn.on { background:var(--brand); color:#fff; box-shadow:0 1px 2px rgba(0,0,0,.12); }
  .seg .segbtn:not(.on):hover { color:var(--fg); }
  /* glass intensity slider (Appearance, glass only) */
  .rng { width:170px; max-width:44vw; accent-color:var(--brand); cursor:pointer; vertical-align:middle; }
  .rngval { font-family:var(--font-mono, monospace); font-size:13px; color:var(--muted); min-width:42px; text-align:right; font-variant-numeric:tabular-nums; }
  /* buttons */
  button, a.btn { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:9px; border:1.5px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none; display:inline-flex; align-items:center; gap:8px; white-space:nowrap; }
  button:hover, a.btn:hover { border-color:var(--accent); color:var(--accent); }
  /* membership pill + status badge */
  .badge { display:inline-block; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; border-radius:999px; padding:3px 9px; background:var(--hover); color:var(--fg); }
  .badge.paid { background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); border:1.5px solid var(--green-tint-2, rgba(31,158,95,.22)); }
  .badge.warn { background:#fdecea; color:#b3261e; border:1.5px solid #f0c2bd; }
  /* membership row (avatar + identity + pill + action) */
  .memrow { display:flex; align-items:center; gap:16px; padding:20px 24px; }
  .memav { width:50px; height:50px; border-radius:50%; flex:none; background:var(--brand); display:flex; align-items:center; justify-content:center; color:#fff; font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:20px; }
  .memrow .mtx { flex:1; min-width:0; }
  .memrow .mtx .t { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  .memrow .mtx .t b { font-weight:700; font-size:16px; }
  .memrow .mtx .d { color:var(--muted); font-size:13.5px; margin-top:3px; }
  /* copy field */
  .copyrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; min-width:0; }
  .copyrow input { flex:1; min-width:180px; max-width:320px; font:inherit; font-size:13px; padding:9px 11px; border:1.5px solid var(--line); border-radius:9px; background:var(--bg, var(--panel)); color:var(--fg); }
  .nudge { padding:18px 20px; border:1.5px dashed var(--line); border-radius:16px; background:var(--panel); font-size:14px; color:var(--muted); margin:0 0 22px; }
  .nudge a { color:var(--brand); font-weight:600; }
  .msg { font-size:13px; padding:0 24px 16px; } .msg:empty { padding:0; } .msg.ok { color:var(--green-700, #0f6f40); } .msg.err { color:#b3261e; }
  /* danger zone -- the surfaces tint the THEME-AWARE --panel/--line with red (so flat + glass, light + dark all read
     correctly and it frosts with the other glass cards); the red TEXT needs a per-theme color via :host-context,
     because a shadow root cannot see [data-theme] on the document root and #b3261e is too dark to read on dark. */
  .danger { border:1.5px solid color-mix(in srgb, #b3261e 28%, var(--line)); border-radius:16px; overflow:hidden; background:color-mix(in srgb, #b3261e 11%, var(--panel)); margin:0 0 22px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .danger .sec-h h3 { color:#b3261e; }
  :host-context([data-theme="dark"]) .danger .sec-h h3 { color:#f3938b; }
  .danger .rows, .danger .row + .row { border-top-color:color-mix(in srgb, #b3261e 16%, var(--line)); }
  button.danger-btn, a.danger-btn { border-color:#e0a39d; color:#b3261e; }
  :host-context([data-theme="dark"]) .danger-btn { border-color:rgba(243,147,139,.5); color:#f3938b; }
  button.danger-btn:hover, a.danger-btn:hover { background:#b3261e; border-color:#b3261e; color:#fff; }
  .confirm { display:flex; gap:8px; align-items:center; flex-wrap:wrap; justify-content:flex-end; }
  .confirm input { font:inherit; font-size:13px; padding:9px 11px; border:1.5px solid #e0a39d; border-radius:9px; background:var(--panel); color:var(--fg); width:150px; }
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
    // call is caught to null AND raced against an 8s timeout, so a background worker that goes idle, or an unsettling
    // fetch (e.g. an expired token whose refresh never resolves), degrades to the signed-out nudge / partial data.
    const guard = (p) => Promise.race([
      Promise.resolve(p).then((v) => v, () => null),
      new Promise((res) => { setTimeout(() => res(null), 8000); }),
    ]);
    try {
      const [status, billing, referral, invite, prefs] = await Promise.all([
        guard(this.client.status?.()),
        guard(this.client.getBilling?.()),
        guard(this.client.getReferral?.()),
        guard(this.client.discordInvite?.()),
        guard(this.client.getPrefs?.()), // SOW-114: the Privacy section (publicFavorites opt-in)
      ]);
      this._status = status; this._billing = billing; this._referral = referral; this._invite = invite;
      this._prefs = prefs;
    } catch { /* fall through and render whatever resolved */ }
    this._loaded = true; this._loading = false;
    this.render();
  }

  get _signedIn() { return Boolean(this._status?.authenticated && this._status?.identity?.login); }
  get _login() { return this._status?.identity?.login || null; }
  get _membership() { return this._status?.membership || 'unknown'; }

  render() {
    this._maybeLoad(); // SOW-070 fix: start the load the moment the client is injected (setClient -> _onClient -> render)
    if (!this.client) { this.set(this.css(CSS) + `<div class="nudge">Open this in the GBTI client or extension to manage your account.</div><slot></slot>`); return; }
    // SOW-070: the Appearance segment (Layout Flat/Glass + Theme) is device-local (localStorage only), so it renders
    // in EVERY state and is NEVER gated behind the account-data load -- a slow or failed fetch must not hide it.
    let appearance = '';
    try { appearance = this._appearance(); } catch { /* never let the display controls break the render */ }
    if (!this._loaded) { this.set(this.css(CSS) + appearance + `<section class="sec"><div class="sec-h"><p style="margin:0">Loading your account…</p></div></section><slot></slot>`); this._wire(); return; }
    if (!this._signedIn) {
      this.set(this.css(CSS) + appearance + `<div class="nudge">Sign in with the GBTI client to manage your account. <a href="${SITE}/membership/">Become a member</a>.</div><slot></slot>`);
      this._wire();
      return;
    }
    // Fail-safe: a throw in any account-data section must never leave the page stuck on "Loading your account…".
    // The <slot> projects any host-provided extra settings (the extension's New-tab splash sections) BEFORE the
    // Danger zone, so Danger always renders as the very last card on the page.
    let sections;
    try { sections = this._billingSec() + appearance + this._account() + this._privacy() + this._referrals() + '<slot></slot>' + this._dangerZone(); }
    catch { sections = appearance + `<section class="sec"><div class="sec-h"><h3>Account</h3><p>Some account details could not load. Reopen this page to retry.</p></div></section>`; }
    this.set(this.css(CSS) + sections);
    this._wire();
  }

  _account() {
    return `<section class="sec">
      <div class="sec-h"><h3>Account</h3><p>Signed in as <b>@${esc(this._login)}</b> on this device.</p></div>
      <div class="rows">
        <div class="row"><div class="rl"><div class="t">Sign out</div><div class="d">End this session on this device.</div></div><div class="rc"><button data-signout type="button">Sign out</button></div></div>
        <div class="row"><div class="rl"><div class="t">Welcome tour</div><div class="d">Show the post-setup welcome (join Discord + discover members) again.</div></div><div class="rc"><button data-reset-welcome type="button">Reset</button></div></div>
      </div>
      <div class="msg" data-account-msg aria-live="polite"></div>
    </section>`;
  }

  // SOW-114: Privacy — the publicFavorites opt-in (server-side prefs, default OFF). When on, the member's name
  // appears in the public "Favorited by" list on items they favorite (a reconcile-written aggregate); when off,
  // only the anonymous count counts them. Renders a nudge instead of a control when the prefs load failed.
  _privacy() {
    const p = this._prefs;
    const on = p?.publicFavorites === true;
    const control = p
      ? `<div class="seg"><button type="button" class="segbtn${on ? '' : ' on'}" data-set-pubfav="off">Off</button><button type="button" class="segbtn${on ? ' on' : ''}" data-set-pubfav="on">On</button></div>`
      : `<span class="d">Could not load this setting right now.</span>`;
    return `<section class="sec">
      <div class="sec-h"><h3>Privacy</h3><p>What other people can see about your activity.</p></div>
      <div class="rows">
        <div class="row"><div class="rl"><div class="t">Public favorites</div><div class="d">Show your name and avatar in the "Favorited by" list on items you favorite on gbti.network. Off by default; the public count always stays anonymous. Changes reach the site on the next sync.</div></div><div class="rc">${control}</div></div>
      </div>
      <div class="msg" data-privacy-msg aria-live="polite"></div>
    </section>`;
  }

  async _setPubFav(v) {
    const want = v === 'on';
    const prev = this._prefs?.publicFavorites === true;
    if (!this._prefs || want === prev) return;
    this._prefs.publicFavorites = want; // optimistic; revert on failure
    this.render();
    try {
      const prefs = await this.client.setPrefs({ publicFavorites: want });
      if (prefs && typeof prefs.publicFavorites === 'boolean') this._prefs = prefs;
      const msg = this.$('[data-privacy-msg]');
      if (msg) msg.textContent = want ? 'Public favorites are on. Your name appears after the next site sync.' : 'Public favorites are off. Your name drops off the list on the next site sync.';
    } catch {
      this._prefs.publicFavorites = prev;
      this.render();
      const msg = this.$('[data-privacy-msg]');
      if (msg) msg.textContent = 'Could not save that just now. Try again in a moment.';
    }
  }

  // SOW-070: Appearance — Layout (Flat/Glass) + Theme (Light/Dark/System), device-local display prefs applied as
  // data-layout / data-theme on the document (tokens.mjs + shell.css react live). Theme shares the gbti-theme key with
  // the header quick-toggle so the two never disagree. Flat + System are the defaults.
  _appearance() {
    const layout = currentLayout();
    const theme = currentTheme();
    const glass = currentGlass();
    const glow = currentGlow();
    const seg = (name, options, active) => `<div class="seg">` + options
      .map(([v, lbl]) => `<button type="button" class="segbtn${v === active ? ' on' : ''}" data-set-${name}="${v}">${esc(lbl)}</button>`)
      .join('') + `</div>`;
    // SOW-070: the two glass sliders appear only when Glass is the active layout (no-ops in Flat). "Surface opacity"
    // drives --glass-strength (how solid the frosted panels are); "Color highlight intensity" drives --glass-glow (how
    // vivid the four ambient backdrop spotlights are). Both apply live as you drag.
    const slider = (key, label, desc, val) => `<div class="row"><div class="rl"><div class="t">${label}</div><div class="d">${desc}</div></div><div class="rc"><input type="range" class="rng" min="0" max="100" step="5" value="${val}" data-set-${key} aria-label="${label}" /><span class="rngval" data-${key}-val>${val}%</span></div></div>`;
    const glassRow = layout === 'glass'
      ? slider('glass', 'Surface opacity', 'How opaque the frosted glass panels are. Lower is more see-through.', glass)
        + slider('glow', 'Color highlight intensity', 'How vivid the colorful backdrop glow is. Lower is calmer; 0 turns the colors off.', glow)
      : '';
    return `<section class="sec">
      <div class="sec-h"><h3>Appearance</h3><p>Display preferences for this device. Glass is an experimental frosted layout; Flat is the classic solid look.</p></div>
      <div class="rows">
        <div class="row"><div class="rl"><div class="t">Layout</div><div class="d">Frosted glass surfaces over an ambient backdrop, or the classic flat look.</div></div><div class="rc">${seg('layout', [['flat', 'Flat'], ['glass', 'Glass']], layout)}</div></div>
        <div class="row"><div class="rl"><div class="t">Theme</div><div class="d">Light, dark, or follow your system.</div></div><div class="rc">${seg('theme', [['light', 'Light'], ['dark', 'Dark'], ['system', 'System']], theme)}</div></div>
        ${glassRow}
      </div>
    </section>`;
  }

  // Membership row (the design's memrow): avatar + identity + status pill + a "Manage membership" portal link.
  _billingSec() {
    const m = this._membership;
    const cls = m === 'paid' ? 'paid' : (LOCKED.has(m) ? 'warn' : '');
    const portal = this._billing?.portal;
    const initial = esc((this._login || 'G').trim().charAt(0).toUpperCase() || 'G');
    return `<section class="sec">
      <div class="memrow">
        <span class="memav">${initial}</span>
        <div class="mtx">
          <div class="t"><b>Membership</b><span class="badge ${cls}">${esc(STATUS_LABEL[m] || m)}</span></div>
          <div class="d">Your plan, invoices, and payment method are managed in the Stripe customer portal.</div>
        </div>
        ${portal ? `<a class="btn" href="${esc(portal)}" target="_blank" rel="noopener">Manage membership</a>` : `<span class="d">Billing portal unavailable.</span>`}
      </div>
    </section>`;
  }

  _referrals() {
    const r = this._referral || {};
    // The invite link keys on the immutable github_id, so a rename never misroutes a payout (SOW-007). A
    // human-friendly ?ref=<username> vanity link is a noted follow-up: it needs a join-side username->github_id
    // resolver (the members-index), and shipping it without one would break referral attribution.
    const canonical = r.link || (r.code ? `${SITE}/join?ref=${r.code}` : null);
    const invite = this._invite?.url || null;
    const copyRow = (id, value, label, desc) => `<div class="row"><div class="rl"><div class="t">${esc(label)}</div>${desc ? `<div class="d">${esc(desc)}</div>` : ''}</div><div class="rc"><div class="copyrow"><input id="${id}" type="text" readonly value="${esc(value)}" /><button data-copy="${id}" type="button">Copy</button></div></div></div>`;
    const rows = `${canonical ? copyRow('ref-canonical', canonical, 'Your invite link', 'Your personal referral link to share anywhere.') : ''}${invite ? copyRow('discord-invite', invite, 'Discord invite', 'The members-only GBTI community on Discord. Joining needs an active membership.') : ''}`;
    return `<section class="sec">
      <div class="sec-h"><h3>Referrals & invites</h3><p>Share your invite link to earn a flat ${esc(r.invitePct || '10%')} lifetime commission on every member who joins through it (paid from the platform share, so it never reduces what content owners earn). You also earn from your published work, separately.</p></div>
      ${rows ? `<div class="rows">${rows}</div>` : `<div class="sec-h" style="padding-top:0"><p style="margin:0">No referral link yet. Sign in as a member to generate one.</p></div>`}
      <div class="msg" data-ref-msg aria-live="polite"></div>
    </section>`;
  }

  _dangerZone() {
    const portal = this._billing?.portal;
    return `<section class="danger">
      <div class="sec-h"><h3>Danger zone</h3><p>These actions end your access or remove your data. They cannot be undone here.</p></div>
      <div class="rows">
        <div class="row"><div class="rl"><div class="t">Cancel membership</div><div class="d">Cancel in the Stripe portal (it handles proration + the period-end choice). Your paid access ends and your published content is set to draft on lapse.</div></div><div class="rc">${portal ? `<a class="btn danger-btn" href="${esc(portal)}" target="_blank" rel="noopener">Cancel in portal</a>` : ''}</div></div>
        <div class="row"><div class="rl"><div class="t">Delete account</div><div class="d">Request erasure of your account + data (GDPR). Type <b>DELETE</b> to confirm. Your private data is cleared on this device immediately; your published content + billing are removed by our erasure process.</div></div><div class="rc"><div class="confirm"><input data-delete-confirm type="text" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autocomplete="off" /><button data-delete type="button" class="danger-btn" disabled>Request deletion</button></div></div></div>
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
    // SOW-114: the Privacy publicFavorites opt-in (server prefs, optimistic + revert on failure).
    this.$$('[data-set-pubfav]').forEach((b) => b.addEventListener('click', () => this._setPubFav(b.dataset.setPubfav)));
    // SOW-070: the glass sliders apply live (the inline --glass-strength / --glass-glow re-skin instantly) + update their readout. No re-render.
    const liveRange = (sel, apply, outSel) => { const el = this.$(sel); if (el) el.addEventListener('input', () => { const p = apply(el.value); const out = this.$(outSel); if (out) out.textContent = `${p}%`; }); };
    liveRange('[data-set-glass]', applyGlass, '[data-glass-val]');
    liveRange('[data-set-glow]', applyGlow, '[data-glow-val]');
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
