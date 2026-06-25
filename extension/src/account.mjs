// SOW-040: the extension's Account / Settings page script. Mounts <gbti-account> under the shared member-hub shell
// via the standard messaging-backed client (page-client.mjs relays /api/* to the background worker; the token
// never reaches the page). The element is host-agnostic and requests sign-out via a gbti:request-signout event;
// the actual chrome signout + reload lives here, not in the element.
import { mountPageClient } from './page-client.mjs'; // sets the client + defines the client-ui elements (incl. <gbti-account>)
import { initShell } from './shell.mjs';
import { normalizeBgMode, normalizeBgOpacity, normalizeBgPattern, fitDimensions } from '../../client-ui/src/splash.mjs'; // SOW-074

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

// SOW-074: the new-tab splash background. Mode / opacity / pattern are small localStorage prefs (read synchronously by
// newtab.mjs); the uploaded image is downscaled (the pure fitDimensions math + a canvas) and kept as a JPEG data URL
// in chrome.storage.local. Per-device + personal (not synced, not git). The full-screen-only controls reveal on mode.
const BG_MODE_KEY = 'gbti-splash-bg-mode';
const BG_OPACITY_KEY = 'gbti-splash-bg-opacity';
const BG_PATTERN_KEY = 'gbti-splash-bg-pattern';
const BG_IMAGE_KEY = 'gbti:splash-bg-image';
const BG_MAX_SIDE = 1600;

const lsGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };

// Downscale an uploaded image via a canvas (longest side capped) and return a JPEG data URL. DOM-only; the dimension
// math is the pure fitDimensions(). Rejects on a read/decode failure so the caller can show a notice.
function downscaleImage(file, maxSide) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('read failed'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('decode failed'));
      img.onload = () => {
        const { w, h } = fitDimensions(img.naturalWidth, img.naturalHeight, maxSide);
        if (!w || !h) { reject(new Error('bad image')); return; }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

const bgMode = document.querySelector('[data-bg-mode]');
if (bgMode) {
  const fullCtrls = document.querySelector('[data-bg-full-ctrls]');
  const fileInput = document.querySelector('[data-bg-file]');
  const preview = document.querySelector('[data-bg-preview]');
  const removeBtn = document.querySelector('[data-bg-remove]');
  const note = document.querySelector('[data-bg-note]');
  const opacity = document.querySelector('[data-bg-opacity]');
  const opacityOut = document.querySelector('[data-bg-opacity-out]');
  const pattern = document.querySelector('[data-bg-pattern]');

  // Hydrate the prefs (normalized).
  bgMode.value = normalizeBgMode(lsGet(BG_MODE_KEY));
  if (opacity) opacity.value = String(normalizeBgOpacity(lsGet(BG_OPACITY_KEY)));
  if (opacityOut && opacity) opacityOut.textContent = `${opacity.value}%`;
  if (pattern) pattern.value = normalizeBgPattern(lsGet(BG_PATTERN_KEY));
  const syncFullCtrls = () => { if (fullCtrls) fullCtrls.hidden = bgMode.value !== 'full'; };
  syncFullCtrls();

  // Hydrate the stored image preview.
  const showImage = (dataUrl) => {
    if (preview) { if (dataUrl) { preview.src = dataUrl; preview.hidden = false; } else { preview.removeAttribute('src'); preview.hidden = true; } }
    if (removeBtn) removeBtn.hidden = !dataUrl;
  };
  try { chrome.storage?.local?.get?.(BG_IMAGE_KEY, (o) => showImage(o?.[BG_IMAGE_KEY] || null)); } catch { /* storage unavailable */ }

  bgMode.addEventListener('change', () => { lsSet(BG_MODE_KEY, normalizeBgMode(bgMode.value)); syncFullCtrls(); });
  opacity?.addEventListener('input', () => { const v = String(normalizeBgOpacity(opacity.value)); if (opacityOut) opacityOut.textContent = `${v}%`; lsSet(BG_OPACITY_KEY, v); });
  pattern?.addEventListener('change', () => lsSet(BG_PATTERN_KEY, normalizeBgPattern(pattern.value)));
  removeBtn?.addEventListener('click', () => { try { chrome.storage?.local?.remove?.(BG_IMAGE_KEY); } catch { /* storage unavailable */ } showImage(null); if (note) note.textContent = 'Image removed.'; });

  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files?.[0];
    if (!file) return;
    if (note) note.textContent = 'Processing the image...';
    try {
      const dataUrl = await downscaleImage(file, BG_MAX_SIDE);
      chrome.storage?.local?.set?.({ [BG_IMAGE_KEY]: dataUrl }, () => {});
      showImage(dataUrl);
      if (note) note.textContent = `Saved (${Math.round(dataUrl.length / 1024)} KB). Open a new tab to see it.`;
    } catch (e) {
      if (note) note.textContent = 'Could not read that image. Try a JPG or PNG.';
    }
    fileInput.value = ''; // allow re-selecting the same file
  });
}
