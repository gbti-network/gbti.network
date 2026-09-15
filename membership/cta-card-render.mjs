// sow-337: the ONE drawing of a call-to-action card, shared by the public page (src/components/CtaCard.astro) and
// the superadmin preview (client-ui), so what a superadmin previews is what a visitor sees. It returns the card's
// inner markup plus one stylesheet; the mounting page supplies the chrome (the prompt aside's .card, the project
// rail's .pd-block, and so on) and two custom properties that tell an edge-to-edge image how far to reach.
//
// Six layouts, from the design the owner approved on 2026-09-15:
//   below    title, sentence, image, button (the first card, Stranger in a Strange Land)
//   first    image, title, sentence, button
//   compact  a small image beside the title and sentence, button below
//   image    the image is the link; a slim footer names the destination so it stays clear where the link goes
//            (the Amazon rule: a placement must not hide that the link leads to Amazon)
//   html     the title (unless the card turns it off), then the partner's own HTML, rendered as written
//   text     title, sentence, button (every card before this change; the default when layout is absent)
//
// Pure and Node-free. Every value from the registry is escaped except `html`, which is the partner code the owner
// chose to allow as written (scripts included); only a superadmin can set it (house/ctas.yml is pinned).
import { iconSvg } from './cta-icon.mjs';

export const CTA_LAYOUTS = Object.freeze(['below', 'first', 'compact', 'image', 'html', 'text']);
export const CTA_LAYOUT_NAMES = Object.freeze({ below: 'Image below', first: 'Image first', compact: 'Compact', image: 'Image only', html: 'HTML block', text: 'Text only' });

/** The card's layout: its `layout` when it is one of the six, else text only (the shape every older card has). */
export const ctaLayoutOf = (cta) => (CTA_LAYOUTS.includes(cta?.layout) ? cta.layout : 'text');

/** Which parts a layout uses. The edit core requires exactly these, and the admin shows exactly these fields. */
export function layoutUses(layout) {
  const L = CTA_LAYOUTS.includes(layout) ? layout : 'text';
  const words = L === 'below' || L === 'first' || L === 'compact' || L === 'text';
  return { line: words, button: words, icon: words, link: L !== 'html', image: L === 'below' || L === 'first' || L === 'compact' || L === 'image', html: L === 'html' };
}

const esc = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const ARROW = '<svg class="pcta-ar" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The destination's host for the image-only footer ("amazon.com"), or the raw value when it does not parse. */
export function destinationHost(destination) {
  try { return new URL(String(destination || '')).hostname.replace(/^www\./, ''); } catch { return String(destination || ''); }
}

/**
 * The card's inner markup.
 * @param cta the registry entry (already validated)
 * @param opts.image { url, width, height } for image layouts, or null (a placeholder is drawn in preview)
 * @param opts.preview true in the admin: links become inert spans and the HTML block shows a notice, not the code
 */
export function renderCtaCard(cta, { image = null, preview = false } = {}) {
  const L = ctaLayoutOf(cta);
  const uses = layoutUses(L);
  const href = esc(cta?.destination);
  const linkOpen = (cls, extra = '') => (preview ? `<span class="${cls}" role="link"${extra}>` : `<a class="${cls}" href="${href}" target="_blank" rel="sponsored nofollow noopener"${extra}>`);
  const linkClose = preview ? '</span>' : '</a>';
  const dim = (k, v) => (Number.isInteger(v) && v > 0 ? ` ${k}="${v}"` : '');
  const img = (alt) => (image && image.url
    ? `<img src="${esc(image.url)}" alt="${esc(alt)}"${dim('width', image.width)}${dim('height', image.height)} loading="lazy" decoding="async">`
    : '<span class="pcta-ph">No image yet</span>');

  if (L === 'image') {
    return `${linkOpen('pcta-io', ` aria-label="${esc(cta?.label)}"`)}<span class="pcta-io-img">${img(cta?.label)}</span><span class="pcta-io-foot"><span>${esc(destinationHost(cta?.destination))}</span>${ARROW}</span>${linkClose}`;
  }
  const parts = [];
  if (L === 'first') parts.push(`<div class="pcta-media pcta-top">${img('')}</div>`);
  if (L === 'compact') parts.push(`<div class="pcta-cmp"><div class="pcta-cmp-img">${img('')}</div><div><p class="pcta-eyebrow">${esc(cta?.label)}</p><p class="pcta-line">${esc(cta?.line)}</p></div></div>`);
  const showTitle = L === 'below' || L === 'first' || L === 'text' || (L === 'html' && cta?.showTitle !== false);
  if (showTitle) parts.push(`<p class="pcta-eyebrow">${esc(cta?.label)}</p>`);
  if (L === 'below' || L === 'first' || L === 'text') parts.push(`<p class="pcta-line">${esc(cta?.line)}</p>`);
  if (L === 'below') parts.push(`<div class="pcta-media">${img('')}</div>`);
  if (L === 'html') {
    const cls = showTitle ? 'pcta-html' : 'pcta-html pcta-flush';
    if (preview) {
      const hosts = (Array.isArray(cta?.hosts) ? cta.hosts : []).map((h) => `<span class="pcta-host">loads from ${esc(h)}</span>`).join('');
      parts.push(`<div class="${cls}"><div class="pcta-notice"><strong>Partner code runs on the live page</strong><span>Scripts do not run in this preview.</span>${hosts}</div></div>`);
    } else {
      parts.push(`<div class="${cls}">${String(cta?.html ?? '')}</div>`);
    }
  }
  if (uses.button) parts.push(`${linkOpen('pcta-btn')}${cta?.icon ? iconSvg(cta.icon, 'pcta-ic') : ''}<span>${esc(cta?.button)}</span>${ARROW}${linkClose}`);
  return parts.join('');
}

/**
 * The card's stylesheet. It reads the site's design tokens, so the public card follows the page theme, and falls
 * back to the light values where no token is defined (the admin preview sets them itself; CTA_TOKENS below).
 */
export const CTA_CARD_CSS = `
.pcta .pcta-eyebrow{margin:0;font-family:var(--f-mono,'JetBrains Mono',ui-monospace,monospace);font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;line-height:1.6;color:var(--green-600,#178a51)}
.pcta .pcta-line{margin:12px 0 0;font-size:14px;line-height:1.5;color:var(--fg,#24222a);text-wrap:pretty}
.pcta .pcta-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;margin-top:14px;padding:14px 26px;border-radius:var(--r,8px);border:1.5px solid var(--line-2,#ddd9d4);background:transparent;color:var(--fg,#24222a);font-family:var(--f-sans,'Hanken Grotesk',system-ui,sans-serif);font-weight:600;font-size:13.5px;line-height:1;white-space:normal;text-align:left;text-decoration:none;cursor:pointer;transition:background .2s ease,border-color .2s ease}
.pcta .pcta-btn:hover{border-color:var(--ink,#25232b);background:var(--pcta-btn-hover,#fff)}
[data-theme="dark"] .pcta .pcta-btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.4)}
.pcta .pcta-btn .pcta-ic,.pcta .pcta-btn .pcta-ar{flex:none;width:16px;height:16px}
.pcta .pcta-ar{transition:transform .2s ease}
.pcta .pcta-btn:hover .pcta-ar{transform:translateX(3px)}
.pcta .pcta-media{display:flex;justify-content:center;align-items:center;margin-top:14px;padding:14px 0;border-radius:var(--r,8px);background:var(--tint-warm,#f3f1ee)}
.pcta .pcta-media img{display:block;width:auto;height:auto;max-width:100%;max-height:252px;border-radius:3px;box-shadow:0 6px 18px rgba(20,18,24,.22)}
.pcta .pcta-media.pcta-top{margin:calc(-1 * var(--pcta-pad,0px)) calc(-1 * var(--pcta-pad,0px)) 18px;padding:18px 0;border-radius:var(--pcta-top-radius,8px)}
.pcta .pcta-media.pcta-top img{max-height:220px}
.pcta .pcta-cmp{display:grid;grid-template-columns:64px minmax(0,1fr);gap:14px;align-items:start}
.pcta .pcta-cmp-img img{display:block;width:64px;height:auto;border-radius:3px;box-shadow:0 4px 12px rgba(20,18,24,.22)}
.pcta .pcta-cmp .pcta-line{margin-top:6px;font-size:13.5px}
.pcta .pcta-ph{display:flex;align-items:center;justify-content:center;width:100%;min-height:120px;font-size:12.5px;color:var(--fg-mute,#6c6976)}
.pcta .pcta-cmp .pcta-ph{width:64px;min-height:96px;border-radius:4px;font-size:11px;background:var(--tint-warm,#f3f1ee)}
.pcta .pcta-io{display:block;color:inherit;text-decoration:none;cursor:pointer}
.pcta.pcta-boxless .pcta-io{border:1.5px solid var(--line,#e7e4e0);border-radius:var(--r-lg,12px);overflow:hidden}
.pcta .pcta-io-img{display:flex;justify-content:center;padding:20px 0;background:var(--tint-warm,#f3f1ee)}
.pcta .pcta-io-img img{display:block;width:auto;height:auto;max-width:100%;max-height:340px;border-radius:3px;box-shadow:0 8px 22px rgba(20,18,24,.25)}
.pcta .pcta-io-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 14px;border-top:1.5px solid var(--line,#e7e4e0);font-family:var(--f-mono,'JetBrains Mono',ui-monospace,monospace);font-size:12px;color:var(--fg-mute,#6c6976)}
.pcta .pcta-io-foot svg{width:14px;height:14px}
.pcta .pcta-html{margin-top:14px}
.pcta .pcta-html.pcta-flush{margin-top:0}
.pcta .pcta-notice{display:flex;flex-direction:column;gap:6px;padding:14px;border:1.5px dashed var(--line-2,#ddd9d4);border-radius:var(--r,8px);font-size:13px;line-height:1.45;color:var(--fg-soft,#57545e)}
.pcta .pcta-notice strong{font-weight:600;color:var(--fg,#24222a)}
.pcta .pcta-host{font-family:var(--f-mono,'JetBrains Mono',ui-monospace,monospace);font-size:11.5px;color:var(--fg-mute,#6c6976);overflow-wrap:anywhere}
`;

/** The design tokens the card reads, for a surface that does not carry the site's own (the admin preview). */
export const CTA_TOKENS = Object.freeze({
  light: '--paper:#ffffff;--paper-2:#faf9f8;--fg:#24222a;--fg-soft:#57545e;--fg-mute:#6c6976;--line:#e7e4e0;--line-2:#ddd9d4;--green-600:#178a51;--tint-warm:#f3f1ee;--ink:#25232b;--pcta-btn-hover:#ffffff',
  dark: '--paper:#2d2a34;--paper-2:#1c1a21;--fg:#f3f2f0;--fg-soft:rgba(243,242,240,.72);--fg-mute:rgba(243,242,240,.50);--line:rgba(255,255,255,.12);--line-2:rgba(255,255,255,.20);--green-600:#46c089;--tint-warm:#25232b;--ink:rgba(255,255,255,.4);--pcta-btn-hover:rgba(255,255,255,.06)',
});
