// <gbti-onboarding> (SOW-026, reduced by sow-274): the first-run setup card. Setup is ONE step now, signing in:
// publishing goes through the network, so the old second and third steps (make a copy of the repository, give
// the App access to it) are gone. The source of truth is still the host's client.onboardingStatus(), polled until
// it reports ready, so the card checks itself off when the member comes back from GitHub. Detection advances
// ONLY on a positive status, never on a click or timer (fail closed). Sign-in is delegated to the host, which
// holds the token and runs the device flow.
import { GbtiElement, define, esc } from '../base.mjs';

// The one step's copy. It lives here because the host sends no step metadata for it.
const SIGNIN_META = {
  title: 'Sign in with GitHub',
  why: 'Your GitHub account is your identity on the network. No repository access is requested, and the network publishes on your behalf.',
  doneLabel: 'Signed in',
};
// White check on the filled (done) green circle, to match the white-on-green buttons.
const check = (filled) =>
  `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${filled ? 'var(--brand)' : 'none'}" stroke="${filled ? 'var(--brand)' : 'var(--line)'}" stroke-width="2"/>${filled ? '<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : ''}</svg>`;

// The sign-in button glyph (the GitHub mark; currentColor = the button's white text).
const BTN_ICON = {
  signin: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
};

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .head h2 { font-family:var(--font-display); font-size:16px; margin:0; text-transform:none; letter-spacing:0; color:var(--fg); }
  .count { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .bar { height:3px; border-radius:999px; background:var(--line); overflow:hidden; margin-bottom:14px; }
  .bar > i { display:block; height:100%; background:var(--brand); transition:width .25s ease; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .row .ic { flex:none; margin-top:1px; }
  .row.done .t { color:var(--muted); font-size:13px; padding-top:1px; }
  .card { flex:1; min-width:0; border:1px solid var(--line); border-radius:10px; padding:12px 13px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .card .title { font-family:var(--font-display); font-size:16px; font-weight:700; margin:0 0 3px; }
  .card .why { font-size:12.5px; color:var(--muted); margin:0 0 7px; line-height:1.45; }
  /* Primary action. Used as BOTH a <button> (Sign in) and an <a> (Open github.com/login/device), so it must be a
     block-level flex box (an inline <a> let its green background wrap mid-text into two ragged pieces) with WHITE
     text to match the site's green CTA. */
  .btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; box-sizing:border-box;
    border:0; border-radius:9px; background:var(--brand); color:#fff; text-decoration:none; text-align:center;
    font:inherit; font-weight:700; font-size:14px; padding:11px 14px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn svg { flex:none; }
  .again { display:block; margin-top:8px; text-align:right; font-size:12px; color:var(--accent); background:none; border:0; cursor:pointer; margin-left:auto; }
  .again[disabled] { opacity:.6; cursor:default; }
  .code { display:inline-flex; align-items:center; gap:8px; margin:2px 0 10px; font-family:ui-monospace,monospace; font-size:18px; font-weight:700; letter-spacing:.06em; background:var(--hover); padding:7px 11px; border-radius:8px; }
  .copy { font-family:var(--font-body); font-size:11px; font-weight:600; letter-spacing:0; border:1px solid var(--line); background:var(--panel); color:var(--accent); border-radius:6px; padding:3px 8px; cursor:pointer; }
  .copy:hover { border-color:var(--accent); }
  .note { font-size:12px; color:var(--muted); margin:8px 0 0; }
  /* Decodes GitHub's scary-sounding "Act on your behalf" wording on the authorize screen. */
  .reassure { display:flex; gap:8px; align-items:flex-start; margin:0 0 11px; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:var(--hover); }
  .reassure svg { flex:none; margin-top:1px; color:var(--accent); }
  .reassure p { margin:0; font-size:12px; line-height:1.5; color:var(--fg); }
  .reassure b { font-weight:700; }
  .ready { text-align:center; padding:6px 0 2px; }
  .ready .big { font-family:var(--font-display); font-size:17px; font-weight:700; margin:8px 0 4px; }
  .foot { margin-top:12px; font-size:11.5px; color:var(--muted); text-align:center; }
  .foot.err { color:var(--danger); }
`;

class GbtiOnboarding extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._onVis = () => { if (!document.hidden) this.refresh(); };
    document.addEventListener('visibilitychange', this._onVis);
    window.addEventListener('focus', this._onVis);
    this.refresh();
  }
  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopPolling();
    document.removeEventListener('visibilitychange', this._onVis);
    window.removeEventListener('focus', this._onVis);
  }

  _startPolling() { if (!this._timer) this._timer = setInterval(() => { if (!document.hidden) this.refresh(); }, 5000); }
  _stopPolling() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }

  /** The host (which runs the device flow) feeds the user code in so the sign-in card can show it. */
  setCode(code, url) { this._code = code ? { code, url } : null; this.render(); }

  /** Re-probe durable GitHub state and re-render. Never advances on an error (the probe returns reachedGithub:false).
   *  A manual check (the Check again button) gets visible feedback: the button flips to "Checking...", and when the
   *  probe returns unchanged we say so instead of silently re-rendering the same card (which reads as a dead click). */
  async refresh({ manual = false } = {}) {
    if (this._busy) return;
    this._busy = true;
    if (manual) { this._checking = true; this.render(); }
    const sig = (s) => (s ? [s.signedIn, s.activeStep].join('|') : '');
    const before = sig(this._status);
    try {
      const s = await this.client?.onboardingStatus?.();
      if (s) {
        const becameReady = s.ready && !(this._status && this._status.ready);
        this._status = s;
        this._staleNote = manual && !s.ready && sig(s) === before;
        if (s.signedIn) this._code = null; // the device code is spent once we are signed in
        if (s.ready) { this._stopPolling(); if (becameReady) this.emit('gbti:onboarding-ready', { login: s.login }); }
        else this._startPolling();
      }
    } catch {
      this._status = { ...(this._status || {}), reachedGithub: false };
    } finally {
      this._busy = false;
      this._checking = false;
      this.render();
    }
  }

  render() {
    const s = this._status;
    if (!s) { this.set(this.css(CSS) + `<p class="note">Checking your setup...</p>`); return; }

    if (s.ready) {
      this.set(this.css(CSS) + `<div class="ready">${check(true)}<div class="big">You are ready to publish</div>
        <p class="note">Sign-in is all it takes: your drafts save privately, and the network publishes for you.</p>
        <button class="btn" data-start style="margin-top:12px">Complete Integration</button></div>`);
      this.on('[data-start]', 'click', () => this.emit('gbti:onboarding-start'));
      return;
    }

    // One step. A status the host could not resolve still shows the sign-in card rather than a dead end.
    const row = s.signedIn
      ? `<li class="row done"><span class="ic">${check(true)}</span><span class="t">${esc(SIGNIN_META.doneLabel)}</span></li>`
      : `<li class="row"><span class="ic">${check(false)}</span>${this._card()}</li>`;

    const reached = s.reachedGithub !== false;
    const nDone = s.signedIn ? 1 : 0;
    this.set(this.css(CSS) + `
      <div class="head"><h2>Sign in to publish</h2><span class="count">${nDone} of 1</span></div>
      <div class="bar"><i style="width:${nDone * 100}%"></i></div>
      <ul>${row}</ul>
      <p class="foot${reached ? '' : ' err'}">${reached ? 'Reached GitHub just now.' : 'We could not reach GitHub. Trying again.'}</p>`);

    this.on('[data-again]', 'click', () => this.refresh({ manual: true }));
    this.on('[data-signin]', 'click', () => this.emit('gbti:onboarding-signin'));
    const copy = this.$('[data-copy]');
    if (copy) copy.addEventListener('click', () => { try { navigator.clipboard?.writeText?.(this._code?.code || ''); copy.textContent = 'Copied'; } catch { /* clipboard blocked */ } });
  }

  _card() {
    const meta = SIGNIN_META;
    const why = `<p class="why">${esc(meta.why)}</p>`;
    const again = `<button class="again" data-again type="button"${this._checking ? ' disabled' : ''}>${this._checking ? 'Checking...' : 'Check again'}</button>${
      this._staleNote && !this._checking
        ? `<p class="note">Checked just now, no change yet. GitHub can take a minute to reflect updates, and this step re-checks itself every few seconds.</p>`
        : ''
    }`;
    const verifyUrl = this._code?.url || 'https://github.com/login/device';
    // Plain-language decode of GitHub's "Act on your behalf" authorize line, which alarms members out of context.
    const shield = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`;
    const reassure = `<div class="reassure">${shield}<p><b>"Act on your behalf" is GitHub's standard wording for any app you connect, not full account access.</b> GBTI Network uses your sign-in only to know who you are. It does not ask for access to your repositories, and it cannot read your private code or change your account. You can remove it at any time in your GitHub settings.</p></div>`;
    const code = this._code
      ? `<div class="code"><span data-codeval>${esc(this._code.code)}</span><button class="copy" data-copy type="button" title="Copy the code">Copy</button></div>
         <a class="btn" href="${esc(verifyUrl)}" target="_blank" rel="noopener">${BTN_ICON.signin}<span>Open github.com/login/device</span></a>
         <p class="note">Copy the code, open the GitHub page, paste it there, and Authorize. Leave this tab open: it checks off on its own when you come back.</p>`
      : `<button class="btn" data-signin type="button">${BTN_ICON.signin}<span>Sign in with GitHub</span></button>`;
    return `<div class="card"><p class="title">${esc(meta.title)}</p>${why}${reassure}${code}${again}</div>`;
  }
}

define('gbti-onboarding', GbtiOnboarding);
export { GbtiOnboarding };
