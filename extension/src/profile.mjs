// SOW-129: the extension's Profile page script. Mounts <gbti-profile-editor> under the shared member-hub shell via
// the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token never
// reaches the page). The element is host-agnostic; it loads the member's profile.md and publishes it through the
// existing fork PR path. It imports the element directly so esbuild bundles + registers it here.
import { mountPageClient } from './page-client.mjs';
import { initShell } from './shell.mjs';
import '../../client-ui/src/elements/gbti-profile-editor.mjs'; // registers <gbti-profile-editor>

mountPageClient();
initShell({ active: 'profile', nav: 'workbench' });

// The welcome flow lands here with ?welcome=1: greet the new member and point them at completing the
// profile (the editor also prefills any socials they staged during the welcome). Dismiss strips the param.
if (new URLSearchParams(location.search).get('welcome') === '1') {
  const b = document.createElement('div');
  b.className = 'welcome-banner';
  b.innerHTML = `<div><b>Welcome to the co-op!</b> Finish your profile so members and readers can find you:
    a short bio, an avatar, your specialties, and your social links. Any handles you added during the
    welcome are already filled in below; hit Save to publish them. Handles are mentioned automatically when
    your work is shared to the matching GBTI channel.</div>
    <button type="button" aria-label="Dismiss">&times;</button>`;
  b.querySelector('button').addEventListener('click', () => { b.remove(); history.replaceState(null, '', location.pathname); });
  const main = document.querySelector('.nt-main');
  const editor = main?.querySelector('gbti-profile-editor');
  if (main && editor) main.insertBefore(b, editor);
}

// The editor does not sign out, but keep the shell's shared signout contract consistent with the sibling pages.
document.addEventListener('gbti:request-signout', async () => {
  try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
  location.reload();
});
