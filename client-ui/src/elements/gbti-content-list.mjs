// <gbti-content-list> (SOW-006 v2): the member's own content (posts/products/prompts/profile). Each row
// opens the item in the editor (emits `gbti-edit` with the loaded item so <gbti-app> seeds the editor).

import { GbtiElement, define, esc } from '../base.mjs';

class GbtiContentList extends GbtiElement {
  async render() {
    if (!this.client) return;
    let items = [];
    try {
      items = (await this.client.listContent({}))?.items ?? [];
    } catch {
      /* unauthenticated */
    }
    this.set(
      this.css() +
        `<div class="panel">
           <h2>My content</h2>
           ${items.length === 0 ? `<p class="muted">No content yet. Use the Author tab to create your first post.</p>` : ''}
           <ul class="list">${items.map((it, i) => this.rowHtml(it, i)).join('')}</ul>
         </div>`,
    );
    this.$$('button[data-i]').forEach((b) =>
      b.addEventListener('click', async () => {
        const it = items[Number(b.dataset.i)];
        try {
          const full = await this.client.getContentItem({ path: it.path });
          this.emit('gbti-edit', { type: it.type, ...full });
        } catch (err) {
          b.textContent = err.message;
        }
      }),
    );
  }

  rowHtml(it, i) {
    const status = it.status ? `<span class="tag ${it.status === 'published' ? 'ok' : ''}">${esc(it.status)}</span>` : '';
    const vis = it.visibility === 'members' ? `<span class="tag">members</span>` : '';
    return `<li class="row" style="justify-content:space-between">
      <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || '')}</span> ${status} ${vis}</span>
      <button class="ghost" data-i="${i}">Edit</button>
    </li>`;
  }
}

define('gbti-content-list', GbtiContentList);
export { GbtiContentList };
