// <gbti-members-portal> (SOW-006 v2): browse visibility:members content. This content lives in the public
// repo but is excluded from the public build, so the client portal is how a member reads it (soft-gated).

import { GbtiElement, define, esc } from '../base.mjs';

class GbtiMembersPortal extends GbtiElement {
  async render() {
    if (!this.client) return;
    let items = [];
    try {
      items = (await this.client.listMembersOnly())?.items ?? [];
    } catch {
      /* unauthenticated */
    }
    this.set(
      this.css() +
        `<div class="panel">
           <h2>Members-only</h2>
           <p class="muted">Content marked <code>visibility: members</code>, surfaced here (excluded from the public site).</p>
           ${items.length === 0 ? `<p class="muted">Nothing members-only yet.</p>` : ''}
           <ul class="list">${items.map((it) => `<li class="row" style="justify-content:space-between">
             <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || '')}</span></span>
             <span class="muted">${esc(it.author || '')}</span>
           </li>`).join('')}</ul>
         </div>`,
    );
  }
}

define('gbti-members-portal', GbtiMembersPortal);
export { GbtiMembersPortal };
