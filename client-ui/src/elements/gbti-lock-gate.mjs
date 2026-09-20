// <gbti-lock-gate> (SOW-018): wraps an extension surface and LOCKS it behind a splash when the member's
// account has lapsed. The owner directive: "once the trial is up, their extension will be locked in a splash
// screen." It checks client.status().membership and, for a Locked account (expired / cancelled / banned /
// none), renders a full lock splash and does NOT project its light-DOM children (the shadow root has no <slot>,
// so the gated UI never shows). For paid / trial / unknown (oracle down -> fail OPEN) it reveals the children.
// No flash of gated content: the shadow root starts with a thin "checking" state (no slot), so children stay
// hidden until the status resolves.
import { GbtiElement, define, esc } from '../base.mjs';
import { isLockedMembership, lockedAccountCopy } from '../../../client/src/membership.mjs';

const CSS = `
  :host { display: block; }
  .checking { color: var(--muted); font-size: 13px; padding: 12px 0; }
  .splash { text-align: center; padding: 56px 20px; }
  .splash .lock { font-size: 34px; line-height: 1; }
  /* sow-360: an explicit --fg. The heading carried no colour and inherited the muted tone the body uses, so in
     dark mode the two read at the same weight and the heading stopped looking like one. */
  .splash h2 { margin: 12px 0 6px; font-family: var(--font-display, var(--font-body)); color: var(--fg); }
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
      // sow-360: three messages, not one. This splash used to tell EVERY locked account that its membership had
      // lapsed and offer a Renew button. Since the trial was retired the largest group meeting it is a free
      // account, which has never had a membership and so has nothing to renew and has lost nothing; and a
      // restricted account was being offered a payment that would not lift the restriction. The wording and the
      // no-button-when-restricted rule are the owner's, and they live in client/src/membership.mjs so that this
      // splash and the new-tab upgrade banner cannot describe the tiers differently again.
      const c = lockedAccountCopy(membership);
      this.set(this.css(CSS) + `<div class="splash">
        <div class="lock">${c.kind === 'restricted' ? '&#9888;&#65039;' : '&#128274;'}</div>
        <h2>${esc(c.heading)}</h2>
        <p>${esc(c.body)}</p>
        ${c.cta ? `<a class="cta" href="${esc(c.cta.href)}">${esc(c.cta.label)}</a>` : ''}
      </div>`);
      return;
    }
    // Not locked (paid / trial / unknown): reveal the wrapped surface.
    this.set(this.css(CSS) + `<slot></slot>`);
  }
}

define('gbti-lock-gate', GbtiLockGate);
export { GbtiLockGate };
