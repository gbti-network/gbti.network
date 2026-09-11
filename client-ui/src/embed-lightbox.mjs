// The video lightbox a comment poster opens (owner, 2026-09-11). On the website the page owns one <dialog>
// (src/components/Lightbox.astro, mounted by BaseLayout) and listens for the composed `gbti-embed-open`
// event this module dispatches, so a poster inside any shadow root reaches it. Off the website (the
// extension's pages have no Lightbox.astro) a minimal dialog is created once and reused. Either way the
// player iframe gets its src only while the dialog is open, and loses it on close, so nothing keeps
// playing behind a closed lightbox.
const FALLBACK_ID = 'gbti-embed-lightbox';

function fallbackDialog() {
  let dlg = document.getElementById(FALLBACK_ID);
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = FALLBACK_ID;
  dlg.setAttribute('aria-label', 'Video');
  dlg.style.cssText = 'inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:hidden;';
  dlg.innerHTML = '<style>#' + FALLBACK_ID + '::backdrop{background:rgba(20,19,24,.88)}#' + FALLBACK_ID + '[open]{display:flex;align-items:center;justify-content:center}#' + FALLBACK_ID + ' .f{width:min(92vw,1100px);aspect-ratio:16/9;background:#000;border-radius:10px;overflow:hidden;box-shadow:0 12px 48px rgba(0,0,0,.55)}#' + FALLBACK_ID + ' iframe{width:100%;height:100%;border:0}#' + FALLBACK_ID + ' .x{position:fixed;top:14px;right:16px;width:42px;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:22px;line-height:1}</style>'
    + '<button type="button" class="x" aria-label="Close">&times;</button><div class="f"><iframe title="Video" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
  dlg.querySelector('.x').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  dlg.addEventListener('close', () => { const f = dlg.querySelector('iframe'); if (f) f.removeAttribute('src'); });
  document.body.appendChild(dlg);
  return dlg;
}

/** Autoplay on open: the viewer already clicked play on the poster. */
export function autoplaySrc(src) {
  const s = String(src || '');
  if (!s) return '';
  return s + (s.includes('?') ? '&' : '?') + 'autoplay=1';
}

/** Open the player for `src` in the page's lightbox, or in the fallback dialog off the website. */
export function openEmbedLightbox(src) {
  if (typeof document === 'undefined' || !src) return false;
  if (document.querySelector('[data-lightbox-root]')) {
    document.dispatchEvent(new CustomEvent('gbti-embed-open', { bubbles: true, composed: true, detail: { src } }));
    return true;
  }
  const dlg = fallbackDialog();
  if (typeof dlg.showModal !== 'function') { window.open(src, '_blank', 'noopener'); return false; }
  const f = dlg.querySelector('iframe');
  if (f) f.src = autoplaySrc(src);
  dlg.showModal();
  return true;
}

/** Bind every poster inside a rendered root (a shadow root or an element) to the lightbox. Idempotent. */
export function wireEmbedPosters(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return 0;
  let n = 0;
  for (const btn of root.querySelectorAll('.md-embed-poster .md-embed-open')) {
    if (btn.dataset.lbWired) continue;
    btn.dataset.lbWired = '1';
    btn.addEventListener('click', (e) => { e.preventDefault(); const box = btn.closest('.md-embed-poster'); openEmbedLightbox(box?.dataset.embedSrc || ''); });
    n++;
  }
  return n;
}

/** The poster CSS a comment renderer includes in its shadow stylesheet: full width, rounded, 16:9 (9:16 portrait). */
export const EMBED_POSTER_CSS = `
  .md-embed { position:relative; width:100%; margin:.6em 0 1em; aspect-ratio:16/9; border-radius:10px; overflow:hidden; background:#000; }
  .md-embed.md-embed-portrait { aspect-ratio:9/16; max-width:360px; }
  .md-embed iframe { position:absolute; inset:0; width:100%; height:100%; border:0; }
  .md-embed-open { position:absolute; inset:0; width:100%; height:100%; display:block; padding:0; border:0; background:#111; cursor:pointer; }
  .md-embed-thumb { width:100%; height:100%; object-fit:cover; display:block; }
  .md-embed-panel { position:absolute; inset:0; display:flex; align-items:center; justify-content:center; color:#fff; font:600 14px/1 var(--f-mono, ui-monospace, monospace); letter-spacing:.08em; text-transform:uppercase; }
  .md-embed-play { position:absolute; left:50%; top:50%; width:64px; height:64px; margin:-32px 0 0 -32px; border-radius:999px; background:rgba(0,0,0,.65); color:#fff; display:flex; align-items:center; justify-content:center; box-shadow:0 4px 18px rgba(0,0,0,.4); transition:background .15s ease, transform .15s ease; }
  .md-embed-open:hover .md-embed-play, .md-embed-open:focus-visible .md-embed-play { background:var(--accent, #1f9e5f); transform:scale(1.06); }
`;
