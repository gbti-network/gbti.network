// sow-406: the extension's Favorites and collections page script. The avatar menu's Favorites and Collections items
// open saved.html at their section; this reads the hash and hands it to <gbti-saved> as its `section`, again on a
// same-page hash change (choosing the other item while already here). The standard messaging-backed client relays
// /api/* to the background worker, as on Settings (page-client.mjs); the token never reaches the page.
import { mountPageClient } from './page-client.mjs'; // sets the client + defines the client-ui elements (incl. <gbti-saved>)
import { initShell } from './shell.mjs';
import { savedSectionFromHash } from '../../client-ui/src/saved-core.mjs';

mountPageClient();
initShell();

// Created here, after mountPageClient() has set the client, never written into the page markup: <gbti-saved> loads
// once, when it connects, so a copy in the markup upgrades while the bundle's imports run, finds no client, and never
// loads (the drive of this page caught it sitting on "Loading your saved items..."). The section is set before it
// connects, so the first full render already knows where to scroll.
const el = document.createElement('gbti-saved');
const apply = () => { const s = savedSectionFromHash(location.hash); if (s) el.setAttribute('section', s); };
apply();
document.querySelector('[data-saved-slot]')?.replaceWith(el);
window.addEventListener('hashchange', apply);
