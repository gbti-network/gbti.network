// sow-441: the extension reader's PROJECT view, drawn from projectViewModel (client-ui/src/project-view.mjs). Design of
// record: the "Extension Project Page" canvas the owner approved on 2026-10-03, after the website's project page:
//   - above the two columns: the hero (the project's icon left of the category, title and short description) and the
//     action bar (price, platforms, the author's own source and main buttons);
//   - in the article column, after the body: "Ready to install?" and the captioned screenshots;
//   - at the top of the side column: "About this project" (the facts and the tags).
// No cover image: the website's project page shows none, and the old cover was the icon stretched to the column.
//
// Every dynamic string is escaped and every href arrives already checked (safeHref, in the model). The icons are drawn
// inline because a shadow root cannot reach the site's icon sprite. Screenshots open in a small image viewer, made
// once and reused, on the pattern of the video viewer in ../embed-lightbox.mjs (the extension has no Lightbox.astro).
import { esc } from '../base.mjs';

const ICON = {
  github: '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" d="M12 1.6a10.4 10.4 0 0 0-3.29 20.27c.52.1.71-.22.71-.5l-.01-1.75c-2.9.63-3.51-1.4-3.51-1.4-.47-1.2-1.16-1.52-1.16-1.52-.95-.65.07-.64.07-.64 1.05.08 1.6 1.08 1.6 1.08.93 1.6 2.44 1.13 3.04.87.09-.68.36-1.13.66-1.39-2.31-.26-4.74-1.16-4.74-5.14 0-1.14.4-2.06 1.07-2.79-.11-.27-.46-1.32.1-2.76 0 0 .87-.28 2.85 1.06a9.8 9.8 0 0 1 5.19 0c1.98-1.34 2.85-1.06 2.85-1.06.57 1.44.21 2.49.1 2.76.67.73 1.07 1.65 1.07 2.79 0 3.99-2.43 4.87-4.75 5.13.38.32.71.95.71 1.92l-.01 2.85c0 .28.19.61.72.5A10.4 10.4 0 0 0 12 1.6Z"/></svg>',
  download: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>',
  link: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/></svg>',
  lock: '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
};

export const PROJECT_CSS = `
  .pv-hero { display:grid; grid-template-columns:104px minmax(0,1fr); gap:26px; align-items:center; padding:28px 30px; margin:0 0 14px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
  .pv-icon { display:block; width:104px; height:104px; border-radius:22%; object-fit:cover; background:var(--hover); }
  .pv-eyebrow { font-family:ui-monospace, "JetBrains Mono", monospace; font-size:11.5px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--accent); }
  .pv-hero h1 { font-size:34px; line-height:1.1; margin:6px 0 10px; }
  .pv-pitch { margin:0; font-size:16px; line-height:1.55; color:var(--muted); max-width:64ch; }
  .pv-bar { display:flex; align-items:center; gap:12px 16px; flex-wrap:wrap; padding:14px 18px; margin:0 0 28px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
  .pv-price { font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--accent); background:var(--green-tint); border-radius:999px; padding:4px 11px; }
  .pv-plat { font-size:13.5px; color:var(--muted); }
  .pv-acts { margin-left:auto; display:flex; gap:10px; flex-wrap:wrap; }
  .pv-btn { display:inline-flex; align-items:center; justify-content:center; gap:9px; padding:11px 16px; border-radius:9px; border:1px solid var(--line-2); background:transparent; color:var(--fg); font-size:14.5px; font-weight:600; text-decoration:none; }
  .pv-btn:hover { border-color:var(--accent); color:var(--fg); }
  .pv-btn.primary { background:var(--accent); border-color:var(--accent); color:var(--on-accent); font-weight:700; }
  .pv-btn.primary:hover { filter:brightness(1.07); color:var(--on-accent); }
  .pv-btn.locked { opacity:.75; cursor:not-allowed; }
  .pv-btn svg { width:17px; height:17px; flex:none; }
  .pv-install { display:flex; align-items:center; gap:14px 10px; flex-wrap:wrap; margin:34px 0 0; padding:22px 24px; border:1px solid color-mix(in srgb, var(--accent) 45%, transparent); border-radius:12px; background:var(--green-tint); }
  .pv-install-t { flex:1 1 100%; }
  .pv-install-h { font-weight:700; font-size:18px; color:var(--fg); }
  .pv-install-s { margin-top:4px; font-size:14px; color:var(--muted); }
  .pv-shots { margin-top:40px; padding-top:30px; border-top:1px solid var(--line); }
  .pv-label { font-family:ui-monospace, "JetBrains Mono", monospace; font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--fg-mute); }
  /* The reader styles a body h2 as a small grey caps label; this heading is a real title, as on the website. */
  .pv-shots h2 { font-family:var(--font-display); font-size:24px; margin:6px 0 20px; text-transform:none; letter-spacing:normal; color:var(--fg); }
  .pv-grid { display:grid; grid-template-columns:repeat(2, minmax(0,1fr)); gap:22px 20px; }
  .pv-grid figure { margin:0; }
  /* An explicit background and its own :hover, because BASE_CSS paints every bare button brand green and
     button:hover outranks a single class. */
  .pv-shot { display:block; width:100%; padding:0; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:#0b0b0d; cursor:zoom-in; }
  .pv-shot:hover, .pv-shot:focus-visible { background:#0b0b0d; border-color:var(--accent); }
  .pv-shot img { display:block; width:100%; aspect-ratio:16 / 10; object-fit:contain; }
  .pv-grid figcaption { margin-top:8px; font-size:13.5px; line-height:1.5; color:var(--fg-mute); }
  .pv-facts { padding:18px 20px; border:1px solid var(--line); border-radius:14px; background:var(--panel); }
  .pv-facts dl { margin:8px 0 0; }
  .pv-fact { display:flex; justify-content:space-between; gap:16px; padding:10px 0; border-bottom:1px solid var(--line); font-size:14px; }
  .pv-fact dt { color:var(--fg-mute); }
  .pv-fact dd { margin:0; text-align:right; font-weight:600; color:var(--fg); }
  .pv-tags { display:flex; flex-wrap:wrap; gap:6px; margin-top:14px; }
  .pv-tag { font-family:ui-monospace, "JetBrains Mono", monospace; font-size:12px; color:var(--muted); border:1px solid var(--line-2); border-radius:6px; padding:3px 8px; }
  @media (max-width:760px) {
    .pv-hero { grid-template-columns:72px minmax(0,1fr); gap:18px; padding:22px; }
    .pv-icon { width:72px; height:72px; }
    .pv-hero h1 { font-size:26px; }
    .pv-acts { margin-left:0; width:100%; }
    .pv-acts .pv-btn { flex:1 1 220px; }
  }
  @media (max-width:520px) {
    .pv-hero { grid-template-columns:56px minmax(0,1fr); align-items:start; }
    .pv-icon { width:56px; height:56px; }
    .pv-grid { grid-template-columns:minmax(0,1fr); }
  }
`;

/** One button: a live link, or a locked label carrying the website's tooltip. */
export function projectButtonHtml(v, { primary = false } = {}) {
  if (!v) return '';
  const cls = `pv-btn${primary ? ' primary' : ''}`;
  if (v.locked) return `<span class="${cls} locked" title="${esc(v.hint)}" aria-disabled="true">${ICON.lock}${esc(v.label)}</span>`;
  return `<a class="${cls}" href="${esc(v.href)}" target="_blank" rel="noopener nofollow">${ICON[v.kind] || ICON.link}${esc(v.label)}</a>`;
}

/** The hero: icon, category, title, short description. `fallbackTitle` covers a link opened before its read lands. */
export function projectHeroHtml(m, fallbackTitle = '') {
  const icon = m.icon ? `<img class="pv-icon" src="${esc(m.icon)}" alt="" width="104" height="104">` : '<span class="pv-icon" aria-hidden="true"></span>';
  return `<section class="pv-hero">${icon}<div>`
    + (m.eyebrow ? `<div class="pv-eyebrow">${esc(m.eyebrow)}</div>` : '')
    + `<h1>${esc(m.title || fallbackTitle || '')}</h1>`
    + (m.pitch ? `<p class="pv-pitch">${esc(m.pitch)}</p>` : '')
    + '</div></section>';
}

/** The action bar: price, platforms, the source button and the main button. Empty when the project has none. */
export function projectBarHtml(m) {
  if (!m.hasBar) return '';
  const acts = projectButtonHtml(m.repo) + projectButtonHtml(m.primary, { primary: true });
  return '<section class="pv-bar">'
    + (m.pricing ? `<span class="pv-price">${esc(m.pricing)}</span>` : '')
    + (m.platforms.length ? `<span class="pv-plat">${m.platforms.map(esc).join(' &middot; ')}</span>` : '')
    + (acts ? `<div class="pv-acts">${acts}</div>` : '')
    + '</section>';
}

/** "Ready to install?": the main button (left out when locked, as on the website) and the source button. */
export function projectInstallHtml(m) {
  if (!m.install) return '';
  const acts = (m.primary && !m.primary.locked ? projectButtonHtml(m.primary, { primary: true }) : '') + projectButtonHtml(m.repo);
  if (!acts) return '';
  return `<section class="pv-install"><div class="pv-install-t"><div class="pv-install-h">Ready to install?</div>`
    + (m.install.sub ? `<div class="pv-install-s">${esc(m.install.sub)}</div>` : '')
    + `</div>${acts}</section>`;
}

/** The screenshots, each a button that opens the image viewer (wireProjectView). */
export function projectGalleryHtml(m) {
  if (!m.gallery.length) return '';
  const shots = m.gallery.map((g, i) => `<figure><button class="pv-shot" type="button" data-pv-shot="${i}" aria-label="Open screenshot ${i + 1} full size">`
    + `<img src="${esc(g.src)}" alt="${esc(g.caption || `Screenshot ${i + 1}`)}" loading="lazy"></button>`
    + (g.caption ? `<figcaption>${esc(g.caption)}</figcaption>` : '') + '</figure>').join('');
  return `<section class="pv-shots"><div class="pv-label">Screenshots</div><h2>See ${esc(m.title || 'it')} in action</h2><div class="pv-grid">${shots}</div></section>`;
}

/** "About this project": the facts and the tags. Empty when there is nothing to say. */
export function projectFactsHtml(m) {
  if (!m.facts.length && !m.tags.length) return '';
  const rows = m.facts.map((f) => `<div class="pv-fact"><dt>${esc(f.k)}</dt><dd>${esc(f.v)}</dd></div>`).join('');
  const tags = m.tags.length ? `<div class="pv-tags">${m.tags.map((t) => `<span class="pv-tag">${esc(t)}</span>`).join('')}</div>` : '';
  return `<section class="pv-facts"><div class="pv-label">About this project</div>${rows ? `<dl>${rows}</dl>` : ''}${tags}</section>`;
}

// The public category tree, fetched once per page and only for a project opened from a link (a list item already
// carries its labels). A failed fetch is remembered as "no tree" for the page's life rather than retried on every open.
let taxonomyLoad = null;
export function loadTaxonomy(fetchImpl = globalThis.fetch) {
  if (!taxonomyLoad) {
    taxonomyLoad = Promise.resolve()
      .then(() => fetchImpl('https://gbti.network/taxonomy.json'))
      .then((r) => (r && r.ok ? r.json() : null))
      .catch(() => null);
  }
  return taxonomyLoad;
}

const VIEWER_ID = 'gbti-image-viewer';

/** The image viewer: one <dialog> in the page, made on first use and reused. Esc, the close button or a click
 *  outside the picture closes it. The caption is set as text, never as markup. */
function viewer() {
  let dlg = document.getElementById(VIEWER_ID);
  if (dlg) return dlg;
  dlg = document.createElement('dialog');
  dlg.id = VIEWER_ID;
  dlg.setAttribute('aria-label', 'Screenshot');
  dlg.style.cssText = 'inset:0;width:100vw;height:100vh;max-width:100vw;max-height:100vh;margin:0;padding:0;border:0;background:transparent;overflow:hidden;';
  dlg.innerHTML = `<style>#${VIEWER_ID}::backdrop{background:rgba(20,19,24,.9)}#${VIEWER_ID}[open]{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px}`
    + `#${VIEWER_ID} img{max-width:min(94vw,1600px);max-height:82vh;object-fit:contain;border-radius:10px;box-shadow:0 12px 48px rgba(0,0,0,.55);background:#0b0b0d}`
    + `#${VIEWER_ID} p{margin:0;max-width:min(90vw,900px);text-align:center;color:#f3f2f0;font:14.5px/1.5 system-ui,sans-serif}`
    + `#${VIEWER_ID} .x{position:fixed;top:14px;right:16px;width:42px;height:42px;border-radius:999px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.12);color:#fff;cursor:pointer;font-size:22px;line-height:1}</style>`
    + '<button type="button" class="x" aria-label="Close">&times;</button><img alt=""><p></p>';
  dlg.querySelector('.x').addEventListener('click', () => dlg.close());
  dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });
  document.body.appendChild(dlg);
  return dlg;
}

export function openImageViewer(src, caption = '') {
  if (!src || typeof document === 'undefined') return;
  const dlg = viewer();
  const img = dlg.querySelector('img');
  img.src = src;
  img.alt = caption || 'Screenshot';
  const p = dlg.querySelector('p');
  p.textContent = caption || '';
  p.hidden = !caption;
  if (!dlg.open) dlg.showModal();
}

/** Bind the screenshot buttons in `root` (the reader's shadow root) to the viewer. */
export function wireProjectView(root, m) {
  root.querySelectorAll('[data-pv-shot]').forEach((b) => b.addEventListener('click', () => {
    const g = m.gallery[Number(b.dataset.pvShot)];
    if (g) openImageViewer(g.src, g.caption);
  }));
}
