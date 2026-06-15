// <gbti-app> (SOW-006 v2): the full standalone CMS shell (used by the npm host's served page). Composes the
// other components as tabs over the SAME GbtiClient. The extension host does NOT use this shell (it mounts
// <gbti-edit-panel> in place on the live site); this is the "open the CMS" surface.

import { GbtiElement, define, esc } from '../base.mjs';
import './gbti-auth.mjs';
import './gbti-content-editor.mjs';
import './gbti-shares.mjs';
import './gbti-content-list.mjs';
import './gbti-pr-list.mjs';
import './gbti-members-portal.mjs';
import './gbti-settings.mjs';
import './gbti-admin.mjs';

const TABS = [
  { id: 'author', label: 'Author', tag: 'gbti-content-editor' },
  { id: 'shares', label: 'Shares', tag: 'gbti-shares' }, // SOW-018: composer + co-op reading feed (extension/client-only)
  { id: 'content', label: 'My Content', tag: 'gbti-content-list' },
  { id: 'prs', label: 'PRs', tag: 'gbti-pr-list' },
  { id: 'members', label: 'Members-only', tag: 'gbti-members-portal' },
  { id: 'settings', label: 'Settings', tag: 'gbti-settings' },
  { id: 'admin', label: 'Admin', tag: 'gbti-admin', minRole: 'moderator' },
];
const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

class GbtiApp extends GbtiElement {
  constructor() {
    super();
    this.active = 'author';
    this.role = 'member';
  }

  async render() {
    if (!this.client) {
      this.set(this.css() + `<div class="panel muted">Connecting…</div>`);
      return;
    }
    try {
      this.role = (await this.client.status())?.role ?? 'member';
    } catch {
      this.role = 'member';
    }
    const tabs = TABS.filter((t) => !t.minRole || RANK[this.role] >= RANK[t.minRole]);
    const active = tabs.find((t) => t.id === this.active) ? this.active : 'author';

    this.set(
      this.css(`
        header { display:flex; align-items:center; justify-content:space-between; padding:14px 0; }
        header h1 { font-size:20px; } header h1 span { color: var(--brand); }
        nav { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--line); margin-bottom:16px; }
        nav button { background:transparent; color:var(--muted); border:0; border-bottom:2px solid transparent; padding:9px 14px; font-weight:500; }
        nav button.active { color:var(--text); border-bottom-color: var(--brand); }
        .wrap { max-width: 860px; margin: 0 auto; }
      `) +
        `<div class="wrap">
           <header><h1>GBTI <span>Network</span> · local CMS</h1></header>
           <gbti-auth></gbti-auth>
           <nav>${tabs.map((t) => `<button data-id="${t.id}" class="${t.id === active ? 'active' : ''}">${esc(t.label)}</button>`).join('')}</nav>
           <div id="pane"></div>
         </div>`,
    );

    const pane = this.$('#pane');
    const el = document.createElement(tabs.find((t) => t.id === active).tag);
    if (active === 'author') this.editor = el;
    pane.replaceChildren(el);

    this.$$('nav button').forEach((b) =>
      b.addEventListener('click', () => {
        this.active = b.dataset.id;
        this.render();
      }),
    );

    // Editing an item from "My Content" seeds the Author editor in place.
    this.addEventListener('gbti-edit', (e) => {
      this.active = 'author';
      this.render();
      queueMicrotask(() => this.editor?.load?.(e.detail.type, e.detail.frontmatter, e.detail.body));
    });
  }
}

define('gbti-app', GbtiApp);
export { GbtiApp };
