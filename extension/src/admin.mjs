// SOW-036: the extension's Admin page bootstrap. Mounts the staff tools over the background-worker messaging
// bridge; the page never sees the token. Reached from the avatar menu's "Admin tools" entry (shown only for
// moderator+).
//
// sow-228: THE PAGE NOW GATES ITSELF. It previously did not. `shell.mjs` hid the rail LINK behind
// [data-admin-only], but admin.html is directly navigable, and the header comment's claim that opening it "is
// harmless for a plain member" rested on <gbti-admin> self-gating. That was true of a ONE-panel page; it grew to
// EIGHT and only that one ever self-gated. We hid the entrance and never locked the door.
//
// The eight panels live in an INERT <template data-admin-panels>. Template content does not render and its custom
// elements do NOT upgrade, so for a non-staff visitor nothing mounts and no admin request is ever issued. Hiding a
// rendered panel would have shipped the markup and still fired every load.
//
// THIS GATE IS DISCLOSURE CONTROL, NOT THE BOUNDARY. Every write behind these panels is denied server-side by the
// Worker's authorizeStaff/authorizeAdmin against the KV mirror, and the SOW-005 gate plus CODEOWNERS are the real
// authority. Nothing here is a reason to relax any of that.
import { mountPageClient } from './page-client.mjs';
import { initShell, shouldGateStaff, shouldGateTab } from './shell.mjs';

mountPageClient();

// sow-406: no left menu; the page is reached from the avatar menu's Admin tools (role-gated there, and gated here).
const shell = initShell({ compose: true });

// SOW-070: sub-section navigation -- the admin tabs show one parent group at a time (Syndication moved to the
// website in sow-399)
// (the last choice persists). The hidden panels still upgrade + load their data, so switching tabs is instant.
// sow-228: wired AFTER the template is cloned, because before that none of these nodes exist.
const ADMIN_TAB_KEY = 'gbti-admin-tab';
function wireAdminTabs() {
  const adminTabs = Array.from(document.querySelectorAll('[data-tab]'));
  const adminPanels = Array.from(document.querySelectorAll('[data-panel]'));
  function showAdminTab(name) {
    if (!adminPanels.some((p) => p.dataset.panel === name)) name = 'members';
    adminTabs.forEach((t) => t.classList.toggle('on', t.dataset.tab === name));
    adminPanels.forEach((p) => p.classList.toggle('on', p.dataset.panel === name));
    try { localStorage.setItem(ADMIN_TAB_KEY, name); } catch (e) { /* storage unavailable */ }
  }
  adminTabs.forEach((t) => t.addEventListener('click', () => showAdminTab(t.dataset.tab)));
  // SOW-088: a `#tab=<name>` deep link wins over the persisted tab; falls back to the stored tab, then members. (The
  // bell's "To approve" notice linked here until sow-399 moved syndication to the website; an old link lands on
  // Members.)
  function tabFromHash() {
    const m = /(?:^|[#&])tab=([a-z-]+)/.exec(location.hash || '');
    return m && adminPanels.some((p) => p.dataset.panel === m[1]) ? m[1] : null;
  }
  let initialAdminTab = 'members';
  try { initialAdminTab = localStorage.getItem(ADMIN_TAB_KEY) || 'members'; } catch (e) { /* storage unavailable */ }
  showAdminTab(tabFromHash() || initialAdminTab);
  window.addEventListener('hashchange', () => { const t = tabFromHash(); if (t) showAdminTab(t); });
}

/**
 * sow-323: remove the tabs and panels this account does not clear.
 *
 * REMOVED, not hidden. The panels upgrade and load their data as soon as they are in the document, so a hidden
 * one would still make its Worker calls and take the 403 silently; and a tab the Worker refuses is worse than
 * no tab, because it reads as a broken feature rather than as one that is not yours.
 */
function gateAdminTabs(status) {
  for (const el of Array.from(document.querySelectorAll('[data-min]'))) {
    if (!shouldGateTab(status, el.getAttribute('data-min'))) continue;
    const name = el.dataset.tab;
    if (name) document.querySelector(`[data-panel="${name}"]`)?.remove();
    el.remove();
  }
}

/** sow-228: reveal the staff surface, once. Cloning the template is what mounts the panels. */
let revealed = false;
function revealAdminPanels(status) {
  if (revealed) return;
  const tpl = document.querySelector('template[data-admin-panels]');
  if (!tpl) return;
  revealed = true;
  tpl.replaceWith(tpl.content.cloneNode(true));
  gateAdminTabs(status); // before wiring, so a removed tab is never a tab anything can select
  wireAdminTabs();
}

/** sow-228: the non-staff notice. Shown only once the role has RESOLVED below moderator, never while it is still
 *  unknown, so a legitimate admin does not get a denial flash on a slow status call. */
function showAdminDenied() {
  const deny = document.querySelector('[data-admin-deny]');
  if (deny) deny.hidden = false;
}

// sow-228: the gate. FAIL CLOSED -- the surface is revealed ONLY on a positive staff answer, so a rejected
// promise, an offline extension or a thrown status call leaves the template inert rather than exposing it. The
// signed-OUT case is already handled by the shell's own auth gate (it overlays the login splash), so this path
// stays silent for it rather than telling a signed-out visitor they lack a staff role.
shell.loadShellAccount()
  .then((status) => {
    if (!status) return;                       // signed out: the shell's auth splash owns this case
    if (shouldGateStaff(status)) { showAdminDenied(); return; }
    revealAdminPanels(status);
  })
  .catch(() => { /* status unavailable: stay closed, and stay quiet about why */ });
