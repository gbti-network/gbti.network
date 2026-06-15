// <gbti-lock-gate> (SOW-018): wraps an extension surface and LOCKS it behind a splash when the member's
// account has lapsed. The owner directive: "once the trial is up, their extension will be locked in a splash
// screen." It checks client.status().membership and, for a Locked account (expired / cancelled / banned /
// none), renders a full lock splash and does NOT project its light-DOM children (the shadow root has no <slot>,
// so the gated UI never shows). For paid / trial / unknown (oracle down -> fail OPEN) it reveals the children.
// No flash of gated content: the shadow root starts with a thin "checking" state (no slot), so children stay
// hidden until the status resolves.
import { GbtiElement, define } from '../base.mjs';
import { isLockedMembership } from '../../../client/src/membership.mjs';

const CSS = `
  :host { display: block; }
  .checking { color: var(--muted); font-size: 13px; padding: 12px 0; }
  .splash { text-align: center; padding: 56px 20px; }
  .splash .lock { font-size: 34px; line-height: 1; }
  .splash h2 { margin: 12px 0 6px; font-family: var(--font-display, var(--font-body)); }
  .splash p { color: var(--muted); margin: 0 auto; max-width: 380px; font-size: 14px; line-height: 1.5; }
  .splash a.cta { display: inline-block; margin-top: 18px; background: var(--brand); color: #fff; font-weight: 700;
    text-decoration: none; padding: 10px 20px; border-radius: 10px; }
`;

class GbtiLockGate extends GbtiElement {
  connectedCallback() {
    super.connectedCallback();
    this._check();
  }

  async _check() {
    // Start hidden (no <slot>) so gated children never flash before the membership check resolves.
    this.set(this.css(CSS) + `<div class="checking">Checking your membership…</div>`);
    let membership = 'unknown';
    try { membership = (await this.client?.status())?.membership ?? 'unknown'; } catch { membership = 'unknown'; }
    if (isLockedMembership(membership)) {
      this.set(this.css(CSS) + `<div class="splash">
        <div class="lock">🔒</div>
        <h2>Your access is locked</h2>
        <p>Your GBTI membership has lapsed, so the extension is locked. Renew to rejoin the co-op, read the
           community stream, and publish again.</p>
        <a class="cta" href="https://gbti.network/membership/">Renew membership</a>
      </div>`);
      return;
    }
    // Not locked (paid / trial / unknown): reveal the wrapped surface.
    this.set(this.css(CSS) + `<slot></slot>`);
  }
}

define('gbti-lock-gate', GbtiLockGate);
export { GbtiLockGate };
