// <gbti-auth> (SOW-006 v2): shows the signed-in identity + role, or a sign-in affordance. Device-flow login
// is a HOST capability (the worker/server runs the polling), surfaced as the optional client.login(onPrompt);
// when absent, the component just shows status. Pure presentation over the GbtiClient.

import { GbtiElement, define, getIdentity, esc } from '../base.mjs';

class GbtiAuth extends GbtiElement {
  async render() {
    if (!this.client) {
      this.set(this.css() + `<div class="panel muted">Connecting to the local client…</div>`);
      return;
    }
    let status = null;
    try {
      status = await this.client.status();
    } catch {
      /* unauthenticated or unreachable */
    }
    const id = status?.identity ?? null;
    const role = status?.role ?? 'member';
    const authed = Boolean(status?.authenticated);

    if (id && authed) {
      this.set(
        this.css() +
          `<div class="panel row" style="justify-content:space-between">
             <div>Signed in as <strong>@${esc(id.login)}</strong> ${role !== 'member' ? `<span class="tag ok">${esc(role)}</span>` : ''}</div>
             <button class="ghost" id="out">Sign out</button>
           </div>`,
      );
      this.on('#out', 'click', () => this.emit('gbti-signout'));
      return;
    }

    const canLogin = typeof this.client.login === 'function';
    this.set(
      this.css() +
        `<div class="panel">
           <h2>Sign in</h2>
           <p class="muted">Authorize with GitHub to author + publish your content as pull requests.</p>
           ${canLogin ? `<button id="in">Sign in with GitHub</button>` : `<p class="muted">Run <code>gbti login</code> in your terminal to connect this client.</p>`}
           <div id="prompt" class="muted" style="margin-top:10px"></div>
         </div>`,
    );
    if (canLogin) {
      this.on('#in', 'click', async () => {
        const slot = this.$('#prompt');
        try {
          await this.client.login(({ userCode, verificationUri }) => {
            slot.innerHTML = `Enter code <strong>${esc(userCode)}</strong> at <a href="${esc(verificationUri)}" target="_blank" rel="noopener">${esc(verificationUri)}</a>`;
          });
          getIdentity();
          this.render();
          this.emit('gbti-signin');
        } catch (err) {
          slot.innerHTML = `<span class="danger">${esc(err.message || 'sign-in failed')}</span>`;
        }
      });
    }
  }
}

define('gbti-auth', GbtiAuth);
export { GbtiAuth };
