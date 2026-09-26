// <gbti-signin-splash> (sow-387): the extension's sign-in screen, and nothing else.
//
// It was a MODE of <gbti-welcome> (SOW-048, the `auth-gate` attribute), and that coupling failed open: the welcome
// decided which of its two faces to show from its OWN status read, so when the shell's read said signed out and
// the element's read a moment later said signed in, the whole setup wizard rendered inside the opaque sign-in wall
// with no way out but a reload. The owner then ruled that the welcome belongs to the website (2026-09-22), so the
// extension keeps only this screen. It takes no client and reads no status: whether to show it is the shell's
// decision alone (shouldGate in extension/src/shell.mjs), and it cannot turn into anything else.
//
// The host drives it. `gbti:signin-start` carries { method: 'web' } (the Sign in button, sow-393): the host opens the
// website sign-in in Chrome's sign-in window and calls setWaiting(true) until it ends. setNote(text) explains a sign-in
// that did not finish. The `expired` attribute explains a re-sign-in after the previous session's token lapsed, and
// `known-login` (set by the host when the member is already signed in on the website) turns the button into
// "Continue as @login". It still reads nothing itself.
//
// sow-410 (owner, 2026-09-25): the code sign-in fallback is gone. It was the old device flow, the only reason the
// extension asked for github.com, and it carried the note about the wording on GitHub's app authorize page, which the
// profile-only sign-in's page never shows.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';

const check = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;

// Moved from welcome-css.mjs with the splash (the SOW-048 block), plus the base `.note` size and spacing it relied
// on there.
const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .splashwrap { max-width:680px; margin:0 auto; padding:32px 28px; }
  .head { text-align:center; margin-bottom:22px; }
  .head .ic { display:inline-grid; place-items:center; }
  .head h2 { font-family:var(--font-display); font-size:24px; margin:8px 0 6px; }
  .head p { color:var(--muted); margin:0 auto; max-width:46ch; line-height:1.5; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:9px;
    background:var(--brand); color:#fff; text-decoration:none; font:inherit; font-weight:700; font-size:14px; padding:10px 16px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn.signin { width:100%; box-sizing:border-box; padding:13px; font-size:15px; }
  .note { color:var(--muted); font-size:12.5px; line-height:1.5; margin:0; }
  .note a { color:var(--accent); }
  .waitbox { text-align:center; }
  .waitbox .sub { color:var(--fg); font-size:14px; line-height:1.5; margin:0 0 12px; }
  .problem { color:var(--danger, #c0392b); font-size:13px; line-height:1.5; margin:0 0 12px; }
`;

const LOGIN_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;

class GbtiSigninSplash extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this.render();
  }

  /** sow-393: a website sign-in is open in another tab (true), or it ended (false). */
  setWaiting(on) {
    this._waiting = Boolean(on);
    this.render();
  }

  /** sow-393: why the last sign-in did not finish ('' clears it). */
  setNote(text) {
    this._note = text ? String(text) : '';
    this.render();
  }

  static get observedAttributes() { return ['known-login']; }
  attributeChangedCallback() { if (this.isConnected) this.render(); }

  render() {
    const known = this.getAttribute('known-login') || '';
    const who = LOGIN_RE.test(known) ? known : '';
    const action = this._waiting
      ? `<div class="waitbox">
           <p class="sub">Finish signing in using the GitHub window that just opened. It closes by itself when you are done.</p>
           <p class="note">Waiting for GitHub&hellip;</p>
         </div>`
      : `<button class="btn signin" data-auth-signin type="button">${githubIco} ${who ? `Continue as @${esc(who)}` : 'Sign in with GitHub'}</button>`;
    // When the host gates BECAUSE the prior session's token expired (not a fresh sign-in), say so, so the member
    // understands why they are back here instead of in their hub.
    const expired = this.hasAttribute('expired')
      ? `<p class="note" style="margin:0 0 12px; color:var(--accent)">Your session expired. Please sign in again to pick up where you left off.</p>`
      : '';
    this.set(this.css(CSS) + `<div class="splashwrap">
      <div class="head">
        <span class="ic">${check}</span>
        <h2>Sign in to GBTI Network</h2>
        <p>The developer co-op. Sign in with your GitHub account to publish articles, projects, and prompts, follow members, read the members-only news, and join the community.</p>
      </div>
      <div class="card">
        ${expired}${this._note ? `<p class="problem" role="alert">${esc(this._note)}</p>` : ''}${action}
        <p class="note" style="margin-top:14px">New here? <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a>. Reading is free, and an account costs nothing.</p>
      </div></div>`);
    this.on('[data-auth-signin]', 'click', () => this.emit('gbti:signin-start', { method: 'web' }));
  }
}

define('gbti-signin-splash', GbtiSigninSplash);
export { GbtiSigninSplash };
