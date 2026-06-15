// <gbti-admin> (SOW-006 v2): role-gated moderation/admin tools. The visible actions follow the signed-in
// role (moderator -> deplatform/remove; admin -> ban/grandfather; superadmin -> roles). UX gating only: every
// action opens a house/content PR and the SOW-005 gate + CODEOWNERS are the real boundary.

import { GbtiElement, define, esc } from '../base.mjs';

const RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };

class GbtiAdmin extends GbtiElement {
  async render() {
    if (!this.client) return;
    let role = 'member';
    try {
      role = (await this.client.status())?.role ?? 'member';
    } catch {
      /* ignore */
    }
    const rank = RANK[role] ?? 0;
    if (rank < RANK.moderator) {
      this.set(this.css() + `<div class="panel muted">Admin tools are available to moderators and above.</div>`);
      return;
    }
    this.set(
      this.css(`.act{margin:14px 0;padding-top:12px;border-top:1px solid var(--line)} .act:first-of-type{border:0;padding:0}`) +
        `<div class="panel">
           <h2>Admin <span class="tag ok">${esc(role)}</span></h2>
           <div class="act">
             <label>Deplatform / remove content (path)</label>
             <input id="cpath" placeholder="members/<user>/posts/<slug>/index.md" />
             <div class="row" style="margin-top:8px"><button class="ghost" id="deplatform">Deplatform (draft)</button><button class="ghost" id="remove">Remove</button></div>
           </div>
           ${rank >= RANK.admin ? `<div class="act">
             <label>Ban / grandfather (github_id)</label>
             <input id="gid" placeholder="github_id" /><input id="reason" placeholder="reason (optional)" style="margin-top:6px" />
             <div class="row" style="margin-top:8px"><button class="ghost" id="ban">Ban</button><button class="ghost" id="unban">Unban</button><button class="ghost" id="grandfather">Grandfather</button><button class="ghost" id="ungrandfather">Ungrandfather</button></div>
           </div>` : ''}
           ${rank >= RANK.superadmin ? `<div class="act">
             <label>Assign role</label>
             <div class="row"><input id="rid" placeholder="github_id" /><select id="role"><option>member</option><option>moderator</option><option>admin</option><option>superadmin</option></select><button class="ghost" id="setrole">Set role</button></div>
           </div>` : ''}
           <div id="out" class="muted" style="margin-top:12px"></div>
         </div>`,
    );

    const run = (action, args) => async () => {
      this.out('Working…');
      try {
        const res = await this.client.admin(action, args());
        this.out(`<span class="tag ok">PR opened</span> <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
      } catch (err) {
        this.out(esc(err.message), 'danger');
      }
    };
    const cpath = () => ({ path: this.$('#cpath').value.trim() });
    const gid = () => ({ githubId: this.$('#gid').value.trim(), reason: this.$('#reason').value.trim() || undefined });

    this.on('#deplatform', 'click', run('deplatform', cpath));
    this.on('#remove', 'click', run('remove', cpath));
    if (rank >= RANK.admin) {
      this.on('#ban', 'click', run('ban', gid));
      this.on('#unban', 'click', run('unban', () => ({ githubId: this.$('#gid').value.trim() })));
      this.on('#grandfather', 'click', run('grandfather', gid));
      this.on('#ungrandfather', 'click', run('ungrandfather', () => ({ githubId: this.$('#gid').value.trim() })));
    }
    if (rank >= RANK.superadmin) {
      this.on('#setrole', 'click', run('role', () => ({ githubId: this.$('#rid').value.trim(), role: this.$('#role').value })));
    }
  }

  out(html, cls = 'muted') {
    const o = this.$('#out');
    if (o) {
      o.className = cls;
      o.innerHTML = html;
    }
  }
}

define('gbti-admin', GbtiAdmin);
export { GbtiAdmin };
