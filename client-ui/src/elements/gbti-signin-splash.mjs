// <gbti-signin-splash> (sow-387): the extension's sign-in screen, and nothing else.
//
// It was a MODE of <gbti-welcome> (SOW-048, the `auth-gate` attribute), and that coupling failed open: the welcome
// decided which of its two faces to show from its OWN status read, so when the shell's read said signed out and
// the element's read a moment later said signed in, the whole setup wizard rendered inside the opaque sign-in wall
// with no way out but a reload. The owner then ruled that the welcome belongs to the website (2026-09-22), so the
// extension keeps only this screen. It takes no client and reads no status: whether to show it is the shell's
// decision alone (shouldGate in extension/src/shell.mjs), and it cannot turn into anything else.
//
// The host drives it. `gbti:signin-start` carries { method }: 'web' (the Sign in button, sow-393) opens the website
// sign-in in Chrome's sign-in window and the host calls setWaiting(true) until it ends; 'code' (the "Use a code instead" link, the old
// device flow kept as a fallback) makes the host call setCode(userCode, verificationUri), or setCode(null) to go back.
// setNote(text) explains a sign-in that did not finish. The `expired` attribute explains a re-sign-in after the
// previous session's token lapsed, and `known-login` (set by the host when the member is already signed in on the
// website) turns the button into "Continue as @login". It still reads nothing itself.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';

const check = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;
// The shield beside the reassurance, as it appeared on the retired toolbar sign-in page.
const shield = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`;

// sow-387: moved verbatim from the retired toolbar sign-in page (<gbti-onboarding>), because this screen is now the
// only place a member signs in to the extension, and GitHub's authorize page says "Act on your behalf", which alarms
// people out of context. test/sign-in-scope.test.mjs pins that it still says no repository access is requested.
// sow-393: it now shows only beside the device CODE, which still signs in through GBTI's GitHub App. The website
// sign-in uses the normal profile-only GitHub sign-in, whose page never says "Act on your behalf", so it needs none.
export const REASSURANCE = `<b>"Act on your behalf" is GitHub's standard wording for any app you connect, not full account access.</b> GBTI Network uses your sign-in only to know who you are. It does not ask for access to your repositories, and it cannot read your private code or change your account. You can remove it at any time in your GitHub settings.`;

// Moved from welcome-css.mjs with the splash (the SOW-048 block), plus the base `.note` size and spacing it relied
// on there, and the reassurance styles from the retired toolbar page. One deliberate difference: the ghost button
// named --fg-soft and --line-2, which the client-ui tokens never define, so it rendered in the inherited text colour
// and lost its border colour on hover. It now names --fg and --line, which is what it already looked like at rest.
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
  .btn.ghost { background:transparent; color:var(--fg); border:1.5px solid var(--line); }
  .btn.ghost:hover { background:var(--hover); color:var(--fg); }
  .btn.signin { width:100%; box-sizing:border-box; padding:13px; font-size:15px; }
  .note { color:var(--muted); font-size:12.5px; line-height:1.5; margin:0; }
  .note a { color:var(--accent); }
  .codebox { text-align:center; }
  .codebox .sub { color:var(--muted); font-size:13.5px; margin:0 0 8px; }
  .codeval { display:flex; align-items:center; justify-content:center; gap:10px; margin:8px 0 14px; flex-wrap:wrap; }
  .codeval code { font-family:var(--font-mono, monospace); font-size:22px; font-weight:700; letter-spacing:.14em; background:var(--hover); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .codeval .btn { padding:8px 13px; font-size:13px; }
  .reassure { display:flex; gap:8px; align-items:flex-start; margin:0 0 14px; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:var(--hover); text-align:left; }
  .reassure svg { flex:none; margin-top:1px; color:var(--accent); }
  .reassure p { margin:0; font-size:12px; line-height:1.5; color:var(--fg); }
  .reassure b { font-weight:700; }
  .alt { display:block; margin:12px auto 0; background:none; border:0; padding:4px; font:inherit; font-size:12.5px; color:var(--accent); text-decoration:underline; cursor:pointer; }
  .alt:hover { background:none; color:var(--accent); }
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

  /** The host hands back the device-flow code (or null to return to the Sign in button). */
  setCode(userCode, verificationUri) {
    this._code = userCode || null;
    if (this._code) this._waiting = false; // a code shown replaces the website sign-in's waiting box
    if (verificationUri) this._verifyUri = verificationUri;
    this.render();
  }

  /** sow-393: a website sign-in is open in another tab (true), or it ended (false). */
  setWaiting(on) {
    this._waiting = Boolean(on);
    if (this._waiting) this._code = null;
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
    const code = this._code;
    const verify = this._verifyUri || 'https://github.com/login/device';
    const known = this.getAttribute('known-login') || '';
    const who = LOGIN_RE.test(known) ? known : '';
    const useCode = `<button class="alt" data-auth-code type="button">Use a code instead</button>`;
    const action = this._waiting
      ? `<div class="waitbox">
           <p class="sub">Finish signing in using the GitHub window that just opened. It closes by itself when you are done.</p>
           <p class="note">Waiting for GitHub&hellip;</p>
           ${useCode}
         </div>`
      : code
      ? `<div class="codebox">
           <p class="sub">Enter this code at GitHub to finish signing in:</p>
           <div class="codeval"><code>${esc(code)}</code><button class="btn ghost" data-copy type="button">Copy</button></div>
           <div class="reassure">${shield}<p>${REASSURANCE}</p></div>
           <a class="btn" href="${esc(verify)}" target="_blank" rel="noopener">Open github.com/login/device</a>
           <p class="note" style="margin-top:12px">Waiting for you to authorize&hellip;</p>
         </div>`
      : `<button class="btn signin" data-auth-signin type="button">${githubIco} ${who ? `Continue as @${esc(who)}` : 'Sign in with GitHub'}</button>${useCode}`;
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
    this.on('[data-auth-code]', 'click', () => this.emit('gbti:signin-start', { method: 'code' }));
    this.on('[data-copy]', 'click', () => { try { navigator.clipboard?.writeText(code); } catch { /* clipboard blocked */ } });
  }
}

define('gbti-signin-splash', GbtiSigninSplash);
export { GbtiSigninSplash };
