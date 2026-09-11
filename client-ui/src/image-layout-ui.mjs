// The image layout controls (Natural | Full width, Left | Center | Right, Wrap text) as ONE set of buttons and ONE
// set of prose rules, shared by the WorkBench Preview's image bar (selection-toolbar.mjs), the doc editor's image
// card (gbti-doc-editor.mjs) and the two client renderers of a body (gbti-reader.mjs, gbti-locked-content.mjs).
// The words themselves, and what a click means, live in client/src/image-attrs.mjs; this module only draws them.
// The published page carries the same prose rules by hand in src/components/blog/Prose.astro (an Astro style
// block cannot import a JS string), and test/image-layout.test.mjs pins the five class names in all three.
import { normalizeImageLayout } from '../../client/src/image-attrs.mjs';

/** The three button groups, in display order. `action` is what applyImageLayoutAction receives. */
export const IMAGE_LAYOUT_GROUPS = Object.freeze([
  Object.freeze([{ action: 'natural', label: 'Natural', title: 'Natural size' }, { action: 'full', label: 'Full width', title: 'Span the column' }]),
  Object.freeze([{ action: 'left', label: 'Left', title: 'Align left' }, { action: 'center', label: 'Center', title: 'Center' }, { action: 'right', label: 'Right', title: 'Align right' }]),
  Object.freeze([{ action: 'wrap', label: 'Wrap text', title: 'Let the text flow beside the image (left or right only)' }]),
]);

/** Whether a button reads as the current state. Natural is pressed when no width is set; wrap only beside a side. */
export function imageLayoutPressed(layout, action) {
  const n = normalizeImageLayout(layout);
  switch (action) {
    case 'natural': return !n.width;
    case 'full': return n.width === 'full';
    case 'left': case 'center': case 'right': return n.align === action;
    case 'wrap': return !!n.wrap && (n.align === 'left' || n.align === 'right');
    default: return false;
  }
}

/** Wrap has nothing to float to without a left or right alignment, so the button is offered but disabled. */
export function imageLayoutDisabled(layout, action) {
  const n = normalizeImageLayout(layout);
  return action === 'wrap' && !(n.align === 'left' || n.align === 'right');
}

/**
 * The buttons for a layout, grouped with separators. Every button carries `data-il="<action>"`, aria-pressed for
 * the current state and `disabled` where the action cannot apply. `sep` is the separator markup between groups.
 */
export function imageLayoutButtonsHtml(layout, { sep = '<span class="gbti-stb-sep" aria-hidden="true"></span>' } = {}) {
  return IMAGE_LAYOUT_GROUPS.map((group) => group.map((b) =>
    `<button type="button" data-il="${b.action}" title="${b.title}"`
      + (imageLayoutPressed(layout, b.action) ? ' aria-pressed="true"' : '')
      + (imageLayoutDisabled(layout, b.action) ? ' disabled' : '')
      + `>${b.label}</button>`).join('')).join(sep);
}

/** The editor card's control row (solid --s-* palette). */
export const IMAGE_LAYOUT_ROW_CSS = `
  .imglay { display:flex; flex-wrap:wrap; gap:8px; margin-top:8px; }
  .imglay .gbti-stb-sep { display:none; }
  .imglay button { font:inherit; font-size:12px; font-weight:600; padding:5px 10px; border-radius:7px; cursor:pointer;
    border:1px solid var(--s-line-2); background:transparent; color:var(--s-fg); }
  .imglay button:hover { border-color:var(--s-green); }
  .imglay button[aria-pressed="true"] { background:var(--s-tint); color:var(--s-green-fg); border-color:var(--s-green); }
  .imglay button[disabled] { opacity:.4; cursor:default; }
`;

/**
 * How the five classes render inside a body, scoped to the container that holds the prose. {full} spans the
 * column; {left} / {center} / {right} place the image on its own line; {left wrap} / {right wrap} float it at up to
 * half the column so the following text flows beside it. Full width wins over a float. A phone column is too
 * narrow to share, so a float falls back to a block there. The container is a flow root so a trailing float
 * never spills past the body.
 */
export function imageLayoutProseCss(scope) {
  const s = String(scope || '').trim();
  return `
  ${s} { display: flow-root; }
  ${s} img.img-full { display: block; width: 100%; }
  ${s} img.img-left, ${s} img.img-center, ${s} img.img-right { display: block; }
  ${s} img.img-left { margin-left: 0; margin-right: auto; }
  ${s} img.img-right { margin-left: auto; margin-right: 0; }
  ${s} img.img-center { margin-left: auto; margin-right: auto; }
  ${s} img.img-wrap.img-left:not(.img-full) { float: left; max-width: 50%; margin: 0.35em 1.5em 0.75em 0; }
  ${s} img.img-wrap.img-right:not(.img-full) { float: right; max-width: 50%; margin: 0.35em 0 0.75em 1.5em; }
  ${s} figure { margin: 1.5em auto; text-align: center; }
  ${s} figure img { display: block; margin: 0 auto; }
  ${s} figcaption { font-family: var(--f-mono, ui-monospace, monospace); background: var(--tint, rgba(127,127,127,.12)); color: var(--muted, var(--fg-mute)); font-size: 0.85rem; padding: 4px 8px; text-align: left; }
  ${s} figure.img-full { width: 100%; }
  ${s} figure.img-full img { width: 100%; }
  ${s} figure.img-left, ${s} figure.img-center, ${s} figure.img-right { width: fit-content; max-width: 100%; }
  ${s} figure.img-left { margin-left: 0; margin-right: auto; }
  ${s} figure.img-right { margin-left: auto; margin-right: 0; }
  ${s} figure.img-center { margin-left: auto; margin-right: auto; }
  ${s} figure.img-wrap.img-left:not(.img-full) { float: left; max-width: 50%; margin: 0.35em 1.5em 0.75em 0; }
  ${s} figure.img-wrap.img-right:not(.img-full) { float: right; max-width: 50%; margin: 0.35em 0 0.75em 1.5em; }
  @media (max-width: 640px) {
    ${s} img.img-wrap.img-left:not(.img-full), ${s} img.img-wrap.img-right:not(.img-full) { float: none; max-width: 100%; margin: 1.5em auto; }
    ${s} figure.img-wrap.img-left:not(.img-full), ${s} figure.img-wrap.img-right:not(.img-full) { float: none; max-width: 100%; margin: 1.5em auto; width: fit-content; }
  }
`;
}
