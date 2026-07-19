// SOW-129: the extension's Profile page script. Mounts <gbti-profile-editor> under the shared member-hub shell via
// the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token never
// reaches the page). The element is host-agnostic; it loads the member's profile.md and publishes it through the
// existing fork PR path. It imports the element directly so esbuild bundles + registers it here.
import { mountPageClient } from './page-client.mjs';
import { initShell } from './shell.mjs';
import '../../client-ui/src/elements/gbti-profile-editor.mjs'; // registers <gbti-profile-editor>

mountPageClient();
initShell({ active: 'profile', nav: 'workbench' });

// The editor does not sign out, but keep the shell's shared signout contract consistent with the sibling pages.
document.addEventListener('gbti:request-signout', async () => {
  try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
  location.reload();
});
