// SOW-040: the extension's Account / Settings page script. Mounts <gbti-account> under the shared member-hub shell
// via the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token
// never reaches the page). The element is host-agnostic and requests sign-out via a gbti:request-signout event;
// the actual chrome signout + reload lives here, not in the element.
import { mountPageClient } from './page-client.mjs'; // sets the client + defines the client-ui elements (incl. <gbti-account>)
import { initShell } from './shell.mjs';

mountPageClient();
initShell({ active: 'settings', nav: 'workbench' }); // SOW-052: Account = the WorkBench "Settings" section

// <gbti-account>'s "Sign out" + the file-and-sign-out step of "Request deletion" emit this event.
document.addEventListener('gbti:request-signout', async () => {
  try { await chrome.runtime.sendMessage({ type: 'signout' }); } catch (e) { /* worker unreachable */ }
  location.reload();
});

// SOW-063: the new-tab landing-splash recurrence window. A pure client preference (localStorage, not server/git
// state), read by newtab.mjs's splashWindowMs(); minutes, 0 = always show the splash. The select self-persists.
const SPLASH_WINDOW_KEY = 'gbti-splash-window-min';
const splashSel = document.querySelector('[data-splash-window]');
if (splashSel) {
  try { splashSel.value = localStorage.getItem(SPLASH_WINDOW_KEY) ?? '30'; } catch (e) { /* storage unavailable */ }
  if (!splashSel.value) splashSel.value = '30'; // a stored value outside the option set -> the 30-minute default
  splashSel.addEventListener('change', () => { try { localStorage.setItem(SPLASH_WINDOW_KEY, splashSel.value); } catch (e) { /* storage unavailable */ } });
}
