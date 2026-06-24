// <gbti-settings> (SOW-006 v2): local settings (port, repo path, MCP, autostart) + billing + referral panes.
// Billing/referrals are deep-links only (Stripe-hosted portal + Connect onboarding); no card handling here.

import { GbtiElement, define, esc } from '../base.mjs';

class GbtiSettings extends GbtiElement {
  async render() {
    if (!this.client) return;
    const [settings, billing, referral] = await Promise.all([
      this.client.getSettings().catch(() => ({})),
      this.client.getBilling().catch(() => ({})),
      this.client.getReferral().catch(() => ({})),
    ]);
    this.set(
      this.css() +
        `<div class="panel">
           <h2>Settings</h2>
           <label>Local repo path</label><input id="repoPath" value="${esc(settings.repoPath || '')}" />
           <label>Preferred port</label><input id="preferredPort" type="number" value="${esc(settings.preferredPort || '')}" />
           <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input id="mcpEnabled" type="checkbox" ${settings.mcpEnabled ? 'checked' : ''} style="width:auto" /> Enable the MCP HTTP endpoint</label>
           <label style="display:flex;gap:8px;align-items:center"><input id="autostart" type="checkbox" ${settings.autostart ? 'checked' : ''} style="width:auto" /> Start on login (peg-startup)</label>
           <div class="row" style="margin-top:12px"><button id="save">Save</button><span id="out" class="muted"></span></div>
         </div>
         <div class="panel" style="margin-top:14px">
           <h2>Billing</h2>
           <p class="muted">${esc(billing.note || 'Manage your membership in the Stripe customer portal.')}</p>
           ${billing.portal ? `<a href="${esc(billing.portal)}" target="_blank" rel="noopener"><button class="ghost">Open billing portal</button></a>` : ''}
         </div>
         <div class="panel" style="margin-top:14px">
           <h2>Referrals + revenue</h2>
           ${referral.link ? `<p>Your link: <code>${esc(referral.link)}</code></p>` : ''}
           <p class="muted">${esc(referral.note || '')}</p>
           <p class="muted">When a member converts after touching your content, you earn the first-touch (30%) or last-touch (10%) share. Contributors and commenters on those items are rewarded automatically from the 5% collaboration mix. You do not set a split.</p>
           ${referral.connectOnboarding ? `<a href="${esc(referral.connectOnboarding)}" target="_blank" rel="noopener"><button class="ghost">Set up payouts (Stripe Connect)</button></a>` : ''}
           ${referral.terms ? `<a href="${esc(referral.terms)}" target="_blank" rel="noopener" class="muted" style="margin-left:8px">Terms</a>` : ''}
         </div>`,
    );
    this.on('#save', 'click', async () => {
      const patch = {
        repoPath: this.$('#repoPath').value.trim(),
        preferredPort: Number(this.$('#preferredPort').value) || undefined,
        mcpEnabled: this.$('#mcpEnabled').checked,
        autostart: this.$('#autostart').checked,
      };
      try {
        await this.client.updateSettings(patch);
        this.$('#out').textContent = 'Saved.';
      } catch (err) {
        this.$('#out').innerHTML = `<span class="danger">${esc(err.message)}</span>`;
      }
    });
  }
}

define('gbti-settings', GbtiSettings);
export { GbtiSettings };
