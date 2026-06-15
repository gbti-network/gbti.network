// <gbti-pr-list> (SOW-006 v2): the member's open upstream PRs with the live gate status (the SOW-005
// membership-gate check). Read-only; the gate is authoritative on what merges.

import { GbtiElement, define, esc } from '../base.mjs';

class GbtiPrList extends GbtiElement {
  async render() {
    if (!this.client) return;
    let prs = [];
    try {
      prs = (await this.client.listPRs())?.prs ?? [];
    } catch {
      /* unauthenticated */
    }
    this.set(
      this.css() +
        `<div class="panel">
           <h2>My pull requests</h2>
           ${prs.length === 0 ? `<p class="muted">No open PRs.</p>` : ''}
           <ul class="list">${prs.map((pr) => `<li class="row" style="justify-content:space-between" data-n="${esc(pr.number)}">
             <span><a href="${esc(pr.html_url)}" target="_blank" rel="noopener">#${esc(pr.number)}</a> ${esc(pr.title)}</span>
             <span class="gate tag" data-n="${esc(pr.number)}">checking…</span>
           </li>`).join('')}</ul>
         </div>`,
    );
    for (const pr of prs) this.loadStatus(pr.number);
  }

  async loadStatus(number) {
    const tag = this.$(`.gate[data-n="${number}"]`);
    if (!tag) return;
    try {
      const s = await this.client.prStatus({ number });
      const ok = s.state === 'success';
      const bad = s.state === 'failure' || s.state === 'error';
      tag.className = `gate tag ${ok ? 'ok' : bad ? 'bad' : ''}`;
      tag.textContent = s.meaning || s.state || 'unknown';
      if (s.description) tag.title = s.description;
    } catch {
      tag.textContent = 'unknown';
    }
  }
}

define('gbti-pr-list', GbtiPrList);
export { GbtiPrList };
