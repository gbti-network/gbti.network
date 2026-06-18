// SOW-040: the extension's Account / Settings page script. Mounts <gbti-account> under the shared member-hub shell
// via the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token
// never reaches the page). The element is host-agnostic and requests sign-out via a gbti:request-signout event;
// the actual chrome signout + reload lives here, not in the element.
import { mountPageClient } from './page-client.mjs'; // sets the client + defines the client-ui elements (incl. <gbti-account>)
import { initShell } from './shell.mjs';

mountPageClient();
initShell({ active: 'account' });

// <gbti-account>'s "Sign out" + the file-and-sign-out step of "Request deletion" emit this event.
document.addEventListener('gbti:request-signout', async () => {
  try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
  location.reload();
});
