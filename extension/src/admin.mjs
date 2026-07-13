// SOW-036: the extension's Admin page bootstrap. Mounts <gbti-admin> (role-gated moderation/admin tools, SOW-006
// AD1) over the background-worker messaging bridge; the page never sees the token. <gbti-admin> self-gates on the
// signed-in role (it shows a "moderators and above" notice otherwise), so reaching this page from the avatar menu
// is harmless for a plain member. Reached from the avatar menu's "Admin tools" entry (shown only for moderator+).
import { mountPageClient } from './page-client.mjs';
import { initShell } from './shell.mjs';

mountPageClient();

// SOW-052: mount the shell with the WorkBench rail; Admin is its "Admin tools" section (role-gated in the rail).
initShell({ active: 'admin', nav: 'workbench' });

// SOW-070: sub-section navigation -- the Members / Content / Syndication tabs show one parent group at a time
// (the last choice persists). The hidden panels still upgrade + load their data, so switching tabs is instant.
const ADMIN_TAB_KEY = 'gbti-admin-tab';
const adminTabs = Array.from(document.querySelectorAll('[data-tab]'));
const adminPanels = Array.from(document.querySelectorAll('[data-panel]'));
function showAdminTab(name) {
  if (!adminPanels.some((p) => p.dataset.panel === name)) name = 'members';
  adminTabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
  adminPanels.forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
  try { localStorage.setItem(ADMIN_TAB_KEY, name); } catch (e) { /* storage unavailable */ }
}
adminTabs.forEach((t) => t.addEventListener('click', () => showAdminTab(t.dataset.tab)));
// SOW-088: a `#tab=<name>` deep link (the activity bell's "To approve" notice links to
// admin.html#tab=syndication) wins over the persisted tab; falls back to the stored tab, then members.
function tabFromHash() {
  const m = /(?:^|[#&])tab=([a-z-]+)/.exec(location.hash || '');
  return m && adminPanels.some((p) => p.dataset.panel === m[1]) ? m[1] : null;
}
let initialAdminTab = 'members';
try { initialAdminTab = localStorage.getItem(ADMIN_TAB_KEY) || 'members'; } catch (e) { /* storage unavailable */ }
showAdminTab(tabFromHash() || initialAdminTab);
window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) showAdminTab(t); });
