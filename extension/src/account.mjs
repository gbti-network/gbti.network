// SOW-040: the extension's Account / Settings page script. Mounts <gbti-account> under the shared member-hub shell
// via the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token
// never reaches the page). The element is host-agnostic and requests sign-out via a gbti:request-signout event;
// the actual chrome signout + reload lives here, not in the element.
import { mountPageClient } from './page-client.mjs'; // sets the client + defines the client-ui elements (incl. <gbti-account>)
import { initShell } from './shell.mjs';

mountPageClient();
// Owner, 2026-09-24: Settings has no left sidebar. It takes the new tab's railless layout (sow-296): the brand and
// the controls share the top row, and the avatar menu is the way to WorkBench and back.
initShell({ active: 'settings', nav: 'none' });

// <gbti-account>'s "Sign out" + the file-and-sign-out step of "Request deletion" emit this event.
document.addEventListener('gbti:request-signout', async () => {
  try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
  location.reload();
});

// sow-296: the new-tab landing splash was REMOVED (owner, 2026-09-22: a new tab opens on the share box and the
// feed), and its settings went with it: the recurrence window, the background image, the patterns and the card
// and quote toggles. The stored image is dropped here, once per browser, so a member's uploaded picture is not
// left sitting in extension storage after the screen that showed it is gone.
const RETIRED_SPLASH_IMAGE_KEY = 'gbti:splash-bg-image';
try { chrome.storage?.local?.remove?.(RETIRED_SPLASH_IMAGE_KEY); } catch (e) { /* storage unavailable */ }
