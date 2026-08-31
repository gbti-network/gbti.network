// <gbti-doc-editor> (SOW-062 Phase 5): the cohesive Markdown WYSIWYG body editor. Replaces the Phase-4
// per-block-container editor (gbti-block-editor) with one continuous surface where blocks edit IN PLACE. Same public
// contract as before: `.value` parses Markdown -> blocks (setter) + serializes blocks -> Markdown (getter), and it
// emits `block-change`, so the host (gbti-content-editor) is untouched. MODEL-IS-TRUTH: `this._blocks` is the state,
// the DOM renders it, and `.value` ALWAYS serializes from the array (never from the contenteditable HTML) -- this is
// what protects the round-trip idempotence + the SOW-016 `<!-- members-only -->` marker. Blocks after a members
// divider render as the "Members-only" section. In-house, node-free, CSP-safe, shadow-DOM. Phase 5c layers the slash
// menu + selection toolbar + drag reorder on top of this engine.
import { GbtiElement, define, esc } from '../base.mjs';
import { parseBlocks, serializeBlocks, emptyBlock, CALLOUT_VARIANTS, inlineMdToHtml, inlineHtmlToMd, listTree } from '../markdown-blocks.mjs';
import { readListDom, indentListSelection } from '../block-commit.mjs';
import { createSelectionToolbar } from '../selection-toolbar.mjs'; // sow-235: the toolbar + link manager, shared with the WorkBench Preview
import { resolveContentAsset } from '../assets.mjs';
import { MEDIA_INDEX_URL, mediaFor, filterMedia, reusePlan, authorFromItemPath } from '../media-picker.mjs'; // sow-165 Q36: reuse an image from the member's own published items // sow-165: repo-relative body images need the item folder to resolve
import { loadStagedImages } from '../../../src/lib/staged-images.mjs'; // a body image staged but not yet published reads back from the Worker store, not from the CDN
import { transferHasFiles, firstImageFile, processImageFile, blobToBase64, processedImageDataUrl } from '../image-intake.mjs'; // sow-290: shared drop, paste, metadata removal, and encoding
import { EDITOR_SURFACE } from '../tokens.mjs'; // SOW-062 P6: the solid --s-* editor palette (decoupled from glass)

let UID = 0;
const withId = (b) => { if (b && !b._id) b._id = ++UID; return b; };
const TEXT_TYPES = new Set(['paragraph', 'heading', 'quote', 'callout']);

// The "Turn into" menu: each entry maps to a concrete block shape (heading carries a level; list an ordered flag).
// SOW-062 P6: each palette entry carries an icon + one-line description so the slash / add-block menus render as
// rich rows (icon box + name + description), matching the hi-fi. icon keys resolve against the `ic` glyph map.
const CONVERT = [
  { key: 'paragraph', label: 'Text', icon: 'text', desc: 'Plain paragraph' },
  { key: 'h1', label: 'Heading 1', type: 'heading', level: 1, icon: 'h1', desc: 'Big section title' },
  { key: 'h2', label: 'Heading 2', type: 'heading', level: 2, icon: 'h2', desc: 'Section heading' },
  { key: 'h3', label: 'Heading 3', type: 'heading', level: 3, icon: 'h3', desc: 'Sub-section' },
  { key: 'quote', label: 'Quote', icon: 'quote', desc: 'Call out a passage' },
  { key: 'callout', label: 'Callout', icon: 'info', desc: 'Info, note or warning' },
  { key: 'code', label: 'Code', icon: 'code', desc: 'A code block' },
  { key: 'ul', label: 'Bulleted list', type: 'list', ordered: false, icon: 'listul', desc: 'A simple list' },
  { key: 'ol', label: 'Numbered list', type: 'list', ordered: true, icon: 'listol', desc: 'An ordered list' },
  { key: 'table', label: 'Table', icon: 'table', desc: 'Rows and columns' },
  { key: 'image', label: 'Image', icon: 'img', desc: 'Upload or embed a picture' },
  { key: 'embed', label: 'Video / embed', icon: 'video', desc: 'YouTube or Vimeo' },
];
// SOW-062 P6: one rich palette row (icon box + name + description); `sel` marks the keyboard-highlighted row.
const paletteRow = (c, dataAttr, sel = false) => `<div class="mi${sel ? ' on' : ''}" ${dataAttr}><span class="mi-ic">${svg(c.icon)}</span><span class="mi-tx"><span class="mi-nm">${esc(c.label)}</span><span class="mi-ds">${esc(c.desc)}</span></span></div>`;
const convertKey = (b) => (b.type === 'heading' ? `h${Math.min(3, Math.max(1, b.level || 2))}` : b.type === 'list' ? (b.ordered ? 'ol' : 'ul') : b.type);
const blockFromKey = (key) => {
  const c = CONVERT.find((x) => x.key === key) || CONVERT[0];
  const nb = emptyBlock(c.type || c.key);
  if (c.level) nb.level = c.level;
  if ('ordered' in c) nb.ordered = c.ordered;
  return nb;
};

const ic = {
  table: '<path d="M4 5h16v14H4zM4 10h16M4 15h16M10 5v14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
  up: '<path d="M12 19V6M6 11l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  down: '<path d="M12 5v13M6 13l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>',
  x: '<path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  plus: '<path d="M12 5.5v13M5.5 12h13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  grip: '<circle cx="9" cy="6" r="1.5" fill="currentColor"/><circle cx="15" cy="6" r="1.5" fill="currentColor"/><circle cx="9" cy="12" r="1.5" fill="currentColor"/><circle cx="15" cy="12" r="1.5" fill="currentColor"/><circle cx="9" cy="18" r="1.5" fill="currentColor"/><circle cx="15" cy="18" r="1.5" fill="currentColor"/>',
  img: '<rect x="4" y="5" width="16" height="14" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M5 17.5l4.2-4.2L13 17l2.6-2.6L19 17.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  video: '<rect x="3.5" y="6" width="11" height="12" rx="2.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M14.5 10l6-2.8v9.6l-6-2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
  gear: '<path d="M12 8.6a3.4 3.4 0 1 0 0 6.8 3.4 3.4 0 0 0 0-6.8z" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 13c.05-.33.08-.66.08-1s-.03-.67-.08-1l1.86-1.43-1.8-3.12-2.2.88a7 7 0 0 0-1.73-1l-.33-2.33h-3.6l-.33 2.33a7 7 0 0 0-1.73 1l-2.2-.88-1.8 3.12L7.1 11c-.05.33-.08.66-.08 1s.03.67.08 1l-1.86 1.43 1.8 3.12 2.2-.88c.52.4 1.1.74 1.73 1l.33 2.33h3.6l.33-2.33a7 7 0 0 0 1.73-1l2.2.88 1.8-3.12L19.4 13z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>',
  info: '<circle cx="12" cy="12" r="8.2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 11v5" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>',
  // SOW-062 P6: block-palette glyphs for the rich slash / add-block menu rows (from the hi-fi sprite).
  text: '<path d="M5 6h14M5 6v1.5M19 6v1.5M12 6v13M9.5 19h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  h1: '<path d="M4 6v12M12 6v12M4 12h8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M16 9l2.5-1.2V18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  h2: '<path d="M3 6v12M10 6v12M3 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14.5 9.2a2.3 2.3 0 0 1 4 1.5c0 2-4 3-4 5.8h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  h3: '<path d="M3 6v12M10 6v12M3 12h7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M14.5 8.5a2.2 2.2 0 1 1 1.7 3.6 2.3 2.3 0 1 1-1.5 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  quote: '<path d="M9 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3M19 7c-2.2 0-4 1.8-4 4 0 2.2 1.8 3.7 4 3.7.2 1.8-.9 2.6-2.4 3.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
  code: '<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  listul: '<circle cx="5" cy="7" r="1.4" fill="currentColor"/><circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="5" cy="17" r="1.4" fill="currentColor"/><path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
  listol: '<path d="M9.5 7h10M9.5 12h10M9.5 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><path d="M4 6l1-.5V9M3.6 15.5c.3-.8 1.8-.8 1.8.3 0 .8-1.6 1.2-1.8 2.2H5.6" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
};
const svg = (k) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ic[k]}</svg>`;

const CSS = `
  /* --blk-gutter reserves the column the hover toolbar lives in. Measured, not guessed: the toolbar measures 134px
     (five 24px controls plus gaps, padding and border), and 142px leaves it a little breathing room. Before this existed the toolbar was 225px wide over a gutter of
     40px on paragraphs and ZERO on headings, so it covered the text it was meant to sit beside. */
  :host { display:block; font-family:var(--font-body); color:var(--s-fg); --blk-gutter:142px; }
  .doc-blocks { display:flex; flex-direction:column; position:relative; padding-right:var(--blk-gutter); border-radius:10px; }
  .doc-blocks.file-drag { box-shadow:0 0 0 2px var(--s-green); }
  /* a block = its content + a contextual hover toolbar in the right gutter; NO bordered box around each block */
  .blk { position:relative; padding:2px 0; margin:2px 0; }
  .blk-tools { position:absolute; top:0; right:calc(var(--blk-gutter) * -1); display:flex; gap:2px; align-items:center; padding:2px;
    background:var(--s-surface); border:1px solid var(--s-line); border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,.08);
    opacity:0; pointer-events:none; transition:opacity .12s ease; z-index:2; }
  .blk:hover > .blk-tools, .blk:focus-within > .blk-tools { opacity:1; pointer-events:auto; }
  .bt { width:24px; height:24px; display:inline-flex; align-items:center; justify-content:center; border:0; border-radius:6px;
    background:transparent; color:var(--s-fg-mute); cursor:pointer; padding:0; }
  .bt:hover { background:var(--s-surface-2); color:var(--s-fg); }
  .bt.danger:hover { color:#d2453f; }
  .bt svg { width:16px; height:16px; }
  .grip { cursor:grab; } .grip:active { cursor:grabbing; }
  .blk.drop-over { box-shadow:inset 0 2.5px 0 var(--s-green); }
  /* the editing surfaces: borderless, "document" feel */
  .ce { outline:0; white-space:pre-wrap; word-break:break-word; caret-color:var(--s-green); color:var(--s-fg); padding:2px 0; border-radius:6px; }
  .ce:empty::before { content:attr(data-ph); color:var(--s-fg-mute); pointer-events:none; } /* sow-249: dropped opacity:.5, which put this at 1.75:1 */
  .ce:focus { background:transparent; }
  .ce-p { font-size:17px; line-height:1.65; padding:6px 40px 6px 0; }
  .ce-h1 { font-family:var(--font-display, var(--font-body)); font-weight:800; font-size:30px; line-height:1.2; letter-spacing:-.01em; padding:12px 0 4px; }
  .ce-h2 { font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:24px; line-height:1.25; padding:10px 0 3px; }
  .ce-h3 { font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:19.5px; line-height:1.3; padding:8px 0 2px; }
  .ce-q { border-left:3px solid var(--s-green); padding-left:20px; color:var(--s-fg-soft); font-size:18px; line-height:1.55; font-style:italic; margin:6px 0; }
  .ce-code { font-family:var(--font-mono, ui-monospace, monospace); font-size:13.5px; line-height:1.6; color:#e6e4ee; background:var(--ink); border:1.5px solid var(--s-line-2); border-radius:8px; padding:13px 16px; margin:8px 0; }
  .ce-list { padding-left:26px; font-size:17px; line-height:1.6; margin:6px 0; }
  .ce-list li { padding:1px 0; }
  /* SOW-062 P6: inline formatting rendered inside the contenteditable (bold/italic/link/code/strike) */
  .ce a { color:var(--s-green-fg); text-decoration:underline; text-underline-offset:2px; }
  .ce strong, .ce b { font-weight:700; }
  .ce em, .ce i { font-style:italic; }
  .ce s, .ce del { text-decoration:line-through; opacity:.8; }
  .ce code { font-family:var(--font-mono, ui-monospace, monospace); font-size:.88em; background:var(--s-surface-2); padding:2px 5px; border-radius:5px; }
  /* callout */
  .cwrap { margin:8px 0; }
  .cvar { display:inline-flex; align-items:center; gap:5px; margin-bottom:9px; padding:4px 4px 4px 6px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; }
  .cvar-lab { display:inline-flex; align-items:center; gap:5px; font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; color:var(--s-fg-mute); padding-right:6px; border-right:1.5px solid var(--s-line-2); white-space:nowrap; }
  .cvar-lab svg { width:13px; height:13px; }
  .cvar button { font:inherit; font-size:11px; font-weight:600; padding:3px 9px; border-radius:7px; border:0; background:transparent; color:var(--s-fg-soft); cursor:pointer; text-transform:capitalize; }
  .cvar button.on { background:var(--s-green); color:#fff; }
  .callout { display:flex; gap:13px; padding:15px 17px; border-radius:8px; border:1.5px solid var(--s-tint-2); background:var(--s-tint); margin:0; }
  .callout .cicon { width:24px; height:24px; flex:none; display:flex; align-items:center; justify-content:center; margin-top:1px; }
  .callout .cicon svg { width:21px; height:21px; }
  .callout .ce { padding:0; font-size:15.5px; line-height:1.6; flex:1; }
  .callout-info { background:color-mix(in srgb, #3f74c9 11%, var(--s-canvas)); border-color:color-mix(in srgb, #3f74c9 32%, transparent); } .callout-info .cicon { color:#3f74c9; }
  .callout-note { background:var(--s-tint); border-color:var(--s-tint-2); } .callout-note .cicon { color:var(--s-green-fg); }
  .callout-warning { background:color-mix(in srgb, #c9892b 13%, var(--s-canvas)); border-color:color-mix(in srgb, #c9892b 34%, transparent); } .callout-warning .cicon { color:#c9892b; }
  .callout-tip { background:color-mix(in srgb, #7a5cc0 12%, var(--s-canvas)); border-color:color-mix(in srgb, #7a5cc0 32%, transparent); } .callout-tip .cicon { color:#7a5cc0; }
  .co-lang { font:inherit; font-size:12px; color:var(--s-fg-mute); background:transparent; border:0; padding:0 0 4px; }
  /* void cards (image / embed) */
  .card { border:1.5px solid var(--s-line); border-radius:12px; padding:12px; background:var(--s-surface); display:flex; flex-direction:column; gap:8px; }
  .card-h { display:flex; align-items:center; gap:8px; font-size:13px; font-weight:600; color:var(--s-fg-mute); } .card-h svg { width:18px; height:18px; }
  .card input { width:100%; box-sizing:border-box; font:inherit; font-size:13.5px; padding:8px 10px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--bg, var(--s-surface)); color:var(--s-fg); }
  .card-prev { max-width:100%; border-radius:8px; border:1px solid var(--s-line); }
  /* SOW-062 P6: image drop-zone placeholder (striped) + the preview frame */
  .imgframe { border:1.5px solid var(--s-line-2); border-radius:9px; overflow:hidden; background:var(--s-surface-2); }
  .imgframe img { width:100%; display:block; }
  .imgph { aspect-ratio:16/8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:9px; color:var(--s-fg-mute); cursor:pointer;
    background-image:repeating-linear-gradient(45deg, var(--s-surface-3) 0 12px, transparent 12px 24px); transition:color .14s ease, box-shadow .14s ease; }
  .imgph:hover { color:var(--s-green-fg); }
  .imgph.drag { color:var(--s-green-fg); background:var(--s-tint); box-shadow:inset 0 0 0 2px var(--s-green); }
  .imgph svg { width:30px; height:30px; opacity:.55; }
  .imgph-t { font-family:var(--font-mono,monospace); font-size:12px; }
  .up { display:flex; align-items:center; gap:10px; }
  .up-btn { font:inherit; font-size:13px; font-weight:600; padding:7px 12px; border:1.5px solid var(--s-line); border-radius:9px; background:var(--s-surface); color:var(--s-fg); cursor:pointer; }
  .up-btn:hover { border-color:var(--s-green); color:var(--s-green); }
  .up-st { font-size:12px; color:var(--s-fg-mute); }
  /* members-only section divider + the tinted region after it */
  .mem-div { display:flex; align-items:center; gap:8px; margin:16px 0 8px; color:var(--s-green); font-weight:700; font-size:13px; }
  .mem-div::after { content:""; flex:1; height:1.5px; background:linear-gradient(to right, var(--s-green), transparent); }
  .mem-div svg { width:16px; height:16px; }
  .mem-div .rm { margin-left:auto; }
  .blk.in-members { border-left:2px solid var(--green-tint-2, rgba(31,158,95,.35)); padding-left:12px; margin-left:2px; }
  /* add row */
  .add-row { display:flex; gap:10px; flex-wrap:wrap; margin:12px 0 4px; }
  .intake-help { flex-basis:100%; color:var(--s-fg-mute); font-size:11.5px; line-height:1.4; }
  .add-btn { display:inline-flex; align-items:center; gap:7px; font:inherit; font-weight:600; font-size:13.5px; padding:9px 14px;
    border:1.5px dashed var(--s-line); border-radius:10px; background:transparent; color:var(--s-fg-mute); cursor:pointer; }
  .add-btn:hover { border-color:var(--s-green); color:var(--s-green); }
  .add-btn svg { width:16px; height:16px; }
  .add-menu { position:relative; }
  .add-pop { position:absolute; top:calc(100% + 6px); left:0; z-index:5; min-width:268px; background:var(--s-surface); border:1.5px solid var(--s-line);
    border-radius:12px; box-shadow:0 12px 34px rgba(0,0,0,.18); padding:6px; }
  /* SOW-062 5c-2: the slash menu (in-shadow popover). sow-235: the selection toolbar + link panel styles
     moved to selection-toolbar.mjs, which injects them into this shadow root. */
  .slash-pop { position:absolute; z-index:20; background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:0 12px 34px rgba(0,0,0,.2); }
  .slash-pop { min-width:268px; max-height:300px; overflow:auto; padding:5px; }
  /* sow-165 Q36: the image reuse grid, sized so a member scans thumbnails rather than filenames. */
  .media-pop { min-width:330px; width:330px; max-height:340px; padding:8px; }
  .media-q { width:100%; box-sizing:border-box; margin:0 0 8px; padding:6px 9px; font:inherit; font-size:12.5px; border:1.5px solid var(--s-line); border-radius:8px; background:var(--s-bg); color:var(--s-fg); }
  .media-grid { display:grid; grid-template-columns:repeat(3, 1fr); gap:7px; }
  .media-cell { display:flex; flex-direction:column; gap:3px; padding:0; border:1.5px solid var(--s-line); border-radius:8px; background:var(--s-bg); cursor:pointer; overflow:hidden; text-align:left; }
  .media-cell:hover, .media-cell:focus-visible { border-color:var(--s-accent); }
  .media-cell img { width:100%; height:62px; object-fit:cover; display:block; background:var(--s-line); }
  .media-cell span { padding:3px 5px 5px; font-size:10.5px; line-height:1.25; color:var(--s-mute); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .media-load { padding:14px 8px; font-size:12.5px; color:var(--s-mute); text-align:center; }
  /* SOW-062 P6: rich palette rows (icon box + name + description), shared by the add-block + slash menus */
  .mi { display:flex; align-items:center; gap:11px; padding:8px 9px; border-radius:8px; cursor:pointer; }
  .mi:hover, .mi.on { background:var(--s-surface-2); }
  .mi-ic { width:32px; height:32px; flex:none; border-radius:7px; border:1.5px solid var(--s-line); background:var(--s-surface); display:flex; align-items:center; justify-content:center; color:var(--s-fg-soft); }
  .mi.on .mi-ic { border-color:var(--s-green); color:var(--s-green-fg); background:var(--s-tint); }
  .mi-ic svg { width:18px; height:18px; }
  .mi-tx { display:flex; flex-direction:column; min-width:0; }
  .mi-nm { font-weight:600; font-size:14px; }
  .mi-ds { font-size:11.5px; color:var(--s-fg-mute); margin-top:1px; }
  /* SOW-169: the editable table block */
  .tbl-card { padding:12px; }
  .tbl-scroll { overflow-x:auto; }
  .tbl { border-collapse:collapse; width:100%; font-size:14px; }
  .tbl th, .tbl td { border:1px solid var(--s-line); padding:0; vertical-align:top; }
  .tbl th { background:var(--s-surface-2); }
  .tbl .corner { border:0; background:transparent; width:0; }
  .tbl td.row-ctl { border:0; background:transparent; width:28px; text-align:center; }
  .tbl .tc { min-width:80px; padding:7px 9px; outline:none; color:var(--s-fg); }
  .tbl .tc:empty::before { content:attr(data-ph); color:var(--s-fg-mute,#6c6976); }
  .tbl th .th-ctl { display:flex; gap:2px; justify-content:flex-end; padding:2px 4px; border-top:1px dashed var(--s-line); }
  .tbtn { display:inline-flex; align-items:center; justify-content:center; min-width:22px; height:20px; padding:0 4px; border:1px solid var(--s-line); border-radius:5px; background:var(--s-surface); color:var(--s-fg-soft); font-size:11px; font-weight:700; cursor:pointer; }
  .tbtn svg { width:12px; height:12px; }
  .tbtn:hover { border-color:var(--s-green); color:var(--s-green); }
  .tbtn.del:hover { border-color:#d9534f; color:#d9534f; }
  .tbl-ctl { display:flex; gap:8px; margin-top:10px; }
  .tbl-ctl .tadd { display:inline-flex; align-items:center; gap:5px; font:inherit; font-size:12.5px; font-weight:600; border:1px solid var(--s-line); border-radius:7px; background:var(--s-surface); color:var(--s-fg); padding:5px 11px; cursor:pointer; }
  .tbl-ctl .tadd svg { width:13px; height:13px; }
  .tbl-ctl .tadd:hover { border-color:var(--s-green); color:var(--s-green); }
`;

class GbtiDocEditor extends GbtiElement {
  // sow-165: the owning editor sets this so a repo-relative body image resolves against the item's folder.
  set itemPath(v) { this._itemPath = v || null; if (this.isConnected) this._render(); }
  get itemPath() { return this._itemPath || null; }
  // The owning editor's `<type>:<slug>` draft token, which scopes the staged-image store. Set by
  // gbti-content-editor alongside itemPath; a body image belongs to the same draft the rail fields do.
  set item(v) { this._item = v || null; }
  get item() { return this._item || null; }
  set usedImageNames(v) { this._usedNames = Array.isArray(v) ? v : []; }
  get usedImageNames() { return this._usedNames || []; }
  set value(md) { this._blocks = parseBlocks(md).map(withId); if (this.isConnected) { this._render(); this._rehydrateStaged().catch(() => {}); } }
  get value() { return serializeBlocks(this._blocks || []); } // serializeBlock ignores the non-serialized _id

  // A body image that is staged but not yet published exists ONLY in the Worker's staged store, so after a
  // reload its path resolves to a jsDelivr URL for a file that is not on main and the block renders broken.
  // Refill _stagedSrc from the store and swap the <img> src in place. Hung off the value SETTER (once per
  // loaded document) rather than _render(), which runs on every block-level edit, and patching the element
  // instead of re-rendering so an author who is already typing keeps their caret.
  async _rehydrateStaged() {
    const blocks = (this._blocks || []).filter((b) => b?.type === 'image' && b.url);
    if (!blocks.length) return;
    const found = await loadStagedImages(blocks.map((b) => b.url), (name) => this.client?.getStagedImage?.(name, this.item), this._stagedSrc || {});
    if (!Object.keys(found).length) return;
    Object.assign((this._stagedSrc ||= {}), found);
    for (const b of blocks) {
      const src = found[b.url];
      const img = src && this.$(`[data-imgfile="${b._id}"]`)?.closest('.imgframe')?.querySelector('img');
      if (img) img.src = src;
    }
  }

  connectedCallback() {
    if (!this._blocks) this._blocks = [];
    super.connectedCallback?.();
    this._render();
    // sow-235: the selection toolbar + link manager live in selection-toolbar.mjs so the WorkBench Preview can
    // drive the same code. The host is passed as a FUNCTION because _render() replaces this subtree wholesale.
    // Built AFTER _render(), and that ordering is load-bearing: createSelectionToolbar resolves its host
    // EAGERLY (selection-toolbar.mjs) and returns an inert stub when the host is missing. _render() is what
    // creates .doc-blocks, so constructing the toolbar first captured that stub for the life of the element
    // and left bold, italic, inline code and the link panel permanently dead on a freshly opened editor.
    this._seltb = this._seltb || createSelectionToolbar({
      root: this.root,
      host: () => this.$('.doc-blocks'),
      editableOf: (node) => {
        const ce = this._ceOf(node);
        return ce && ce.dataset && (ce.dataset.edit === 'text' || ce.dataset.edit === 'code') ? ce : null;
      },
      allowInline: (ce) => ce.dataset.edit !== 'code', // SOW-062 P6: code blocks stay literal
      onCommit: (ce, reason) => {
        const b = this._byId(ce.dataset.id);
        if (!b) return;
        b.text = inlineHtmlToMd(ce.innerHTML).replace(/\n$/, '');
        if (reason === 'link') { this._render(); this._focusBlock(b._id); }
        this._change();
      },
      // sow-235: select-to-promote parity with the WorkBench Preview. This surface already creates headings by
      // typing `# ` and through the block palette; the toolbar control is the third, in-selection way. Only a
      // paragraph and a heading convert into each other (MODEL-IS-TRUTH: mutate the block, re-render); the image
      // control is left to this surface's own richer media flow, so listItemImages is deliberately not passed.
      onRetype: (ce, toType, level) => {
        const b = this._byId(ce.dataset.id);
        if (!b || (b.type !== 'paragraph' && b.type !== 'heading')) return;
        const text = inlineHtmlToMd(ce.innerHTML).replace(/\n$/, '');
        if (toType === 'heading') {
          if (text.includes('\n')) return;                 // a heading is a single line
          b.type = 'heading'; b.level = Math.min(6, Math.max(1, Number(level) || 2)); b.text = text;
        } else {
          b.type = 'paragraph'; delete b.level; b.text = text;
        }
        this._render(); this._focusBlock(b._id); this._change();
      },
      // Owner QA 2026-08-31: the bottom-row control can only create a gated section at the document end. The
      // shared selection toolbar now lets an author place the same canonical split before the selected block.
      onMemberSplit: (ce) => {
        if (this._blocks.some((b) => b.type === 'members')) return;
        const at = this._indexOf(ce.dataset.id);
        if (at < 0) return;
        this._blocks.splice(at, 0, withId({ type: 'members' }));
        this._render();
        const next = this._blocks[at + 1];
        if (next) this._focusBlock(next._id);
        this._change();
      },
    });
  }

  disconnectedCallback() {
    this._seltb?.destroy();
    this._seltb = null;
    super.disconnectedCallback?.();
  }

  _byId(id) { return (this._blocks || []).find((b) => String(b._id) === String(id)); }
  _indexOf(id) { return (this._blocks || []).findIndex((b) => String(b._id) === String(id)); }
  _change() { this.emit('block-change'); }

  _render() {
    const blocks = this._blocks || [];
    const hasMembers = blocks.some((b) => b.type === 'members');
    let inMem = false;
    const parts = blocks.map((b) => {
      if (b.type === 'members') { inMem = true; return this._memberDivider(b); }
      return this._blockHtml(b, inMem);
    });
    const addRow = `<div class="add-row">
      <div class="add-menu"><button class="add-btn" data-addmenu type="button">${svg('plus')} Add block</button><div class="add-pop" data-addpop hidden></div></div>
      ${hasMembers ? '' : `<button class="add-btn" data-addmembers type="button">${svg('lock')} Add members-only section</button>`}
      <span class="intake-help">Drop or paste an image anywhere. Photos and PNGs remove embedded metadata; photos are resized to 2400 px and encoded as WebP. Animated GIFs stay unchanged.</span>
    </div>`;
    this._slash = null; // the slash popover lived in the old DOM (this.set replaced it); the selection toolbar remounts itself
    this.set(this.css(EDITOR_SURFACE + CSS) + `<div class="doc-blocks">${parts.join('')}${addRow}</div>`);
    this._wire();
  }

  _tools(b) {
    const id = b._id;
    // The type control shows the block's CURRENT type as an icon. That keeps the at-a-glance "what is this block"
    // the old <select> gave through its selected label, at 24px instead of 147px.
    const cur = CONVERT.find((c) => c.key === convertKey(b)) || CONVERT[0];
    return `<div class="blk-tools">
      <span class="bt grip" draggable="true" data-grip="${id}" title="Drag to reorder">${svg('grip')}</span>
      <button class="bt" type="button" data-convert="${id}" title="Turn into (now: ${esc(cur.label)})">${svg(cur.icon)}</button>
      <button class="bt" type="button" data-up="${id}" title="Move up">${svg('up')}</button>
      <button class="bt" type="button" data-down="${id}" title="Move down">${svg('down')}</button>
      <button class="bt danger" type="button" data-del="${id}" title="Delete">${svg('x')}</button>
    </div>`;
  }

  _blockHtml(b, inMem) {
    return `<div class="blk blk-${esc(b.type)}${inMem ? ' in-members' : ''}" data-id="${b._id}">${this._tools(b)}<div class="blk-in">${this._bodyHtml(b)}</div></div>`;
  }

  _ce(cls, edit, b, ph) {
    return `<div class="ce ${cls}" contenteditable="true" data-edit="${edit}" data-id="${b._id}" data-ph="${esc(ph || '')}">${inlineMdToHtml(b.text || '')}</div>`;
  }

  _bodyHtml(b) {
    switch (b.type) {
      case 'heading': return this._ce(`ce-h${Math.min(3, Math.max(1, b.level || 2))}`, 'text', b, 'Heading');
      case 'quote': return this._ce('ce-q', 'text', b, 'Quote');
      case 'callout': {
        const v = CALLOUT_VARIANTS.includes(b.variant) ? b.variant : 'note';
        const bar = `<div class="cvar"><span class="cvar-lab">${svg('gear')} Callout style</span>${CALLOUT_VARIANTS.map((x) => `<button type="button" class="${x === v ? 'on' : ''}" data-cvar="${b._id}" data-cval="${x}">${x}</button>`).join('')}</div>`;
        return `<div class="cwrap">${bar}<div class="callout callout-${v}"><span class="cicon">${svg('info')}</span>${this._ce('', 'text', b, 'Callout text')}</div></div>`;
      }
      case 'code':
        return `<input class="co-lang" data-edit="lang" data-id="${b._id}" value="${esc(b.lang || '')}" placeholder="language (optional)" />`
          + `<div class="ce ce-code" contenteditable="true" data-edit="code" data-id="${b._id}" data-ph="Code">${esc(b.code || '')}</div>`;
      case 'list': {
        const tag = b.ordered ? 'ol' : 'ul';
        const render = (nodes) => nodes.map((node) =>
          `<li>${inlineMdToHtml(node.text)}${node.children.length ? `<${tag}>${render(node.children)}</${tag}>` : ''}</li>`).join('');
        const items = render(listTree(Array.isArray(b.items) ? b.items : [''], b.depths)) || '<li></li>';
        return `<${tag} class="ce ce-list" contenteditable="true" data-edit="list" data-id="${b._id}">${items}</${tag}>`;
      }
      case 'table': {
        // SOW-169: a real, editable table (cells are contenteditable; add/remove row+column; per-column align).
        // MODEL-IS-TRUTH: cell edits mutate b.head / b.rows in place and .value re-serializes to GFM (never the DOM).
        const head = Array.isArray(b.head) ? b.head : [];
        const aligns = Array.isArray(b.aligns) ? b.aligns : [];
        const rows = Array.isArray(b.rows) ? b.rows : [];
        const cols = Math.max(1, head.length);
        const alignStyle = (c) => aligns[c] ? ` style="text-align:${aligns[c]}"` : '';
        const alignLabel = (c) => ({ '': '–', left: 'L', center: 'C', right: 'R' }[aligns[c] || '']);
        const cell = (r, c, v) => `<div class="tc" contenteditable="true" data-edit="cell" data-id="${b._id}" data-r="${r}" data-c="${c}" data-ph="">${inlineMdToHtml(v || '')}</div>`;
        const headCells = Array.from({ length: cols }, (_, c) =>
          `<th${alignStyle(c)}>${cell(-1, c, head[c])}<div class="th-ctl">`
          + `<button type="button" class="tbtn" data-talign="${b._id}" data-c="${c}" title="Cycle column alignment">${alignLabel(c)}</button>`
          + `<button type="button" class="tbtn del" data-tcolrm="${b._id}" data-c="${c}" title="Delete this column">${svg('x')}</button></div></th>`).join('');
        const bodyRows = rows.map((row, r) =>
          `<tr>` + Array.from({ length: cols }, (_, c) => `<td${alignStyle(c)}>${cell(r, c, row[c])}</td>`).join('')
          + `<td class="row-ctl"><button type="button" class="tbtn del" data-trowrm="${b._id}" data-r="${r}" title="Delete this row">${svg('x')}</button></td></tr>`).join('');
        return `<div class="card tbl-card"><div class="card-h">${svg('table')} Table</div>`
          + `<div class="tbl-scroll"><table class="tbl"><thead><tr>${headCells}<th class="corner"></th></tr></thead><tbody>${bodyRows || ''}</tbody></table></div>`
          + `<div class="tbl-ctl"><button type="button" class="tadd" data-taddrow="${b._id}">${svg('plus')} Row</button>`
          + `<button type="button" class="tadd" data-taddcol="${b._id}">${svg('plus')} Column</button></div></div>`;
      }
      case 'image': {
        // SOW-062 P6: a striped drop-zone placeholder when empty (click OR drag-drop an image), the preview when set.
        const hasUrl = !!b.url;
        // sow-165: a body image is usually a REPO-relative path (`./images/x.webp`). Prefixing the site
        // origin produced `https://gbti.network/./images/x.webp`, a guaranteed 404, which is why every body
        // image rendered broken in the editor. Resolve against the item's folder like the reader does.
        // sow-165: a freshly-staged image previews from its local object URL (jsDelivr 404s pre-merge); an
        // already-committed image resolves against the item folder over jsDelivr like the reader does.
        const src = hasUrl ? esc((this._stagedSrc && this._stagedSrc[b.url]) || resolveContentAsset(b.url, this.itemPath)) : '';
        return `<div class="card"><div class="card-h">${svg('img')} Image</div>`
          + `<div class="imgframe">`
          +   (hasUrl ? `<img src="${src}" alt="" />` : `<div class="imgph" data-imgdrop="${b._id}" title="Drop an image here, or click to upload">${svg('img')}<span class="imgph-t">Drop an image here, or click to upload</span></div>`)
          +   `<input type="file" accept="image/*" hidden data-imgfile="${b._id}" />`
          + `</div>`
          + `<input data-edit="url" data-id="${b._id}" value="${esc(b.url || '')}" placeholder="Image URL or repo path" />`
          + `<input data-edit="alt" data-id="${b._id}" value="${esc(b.alt || '')}" placeholder="Alt text" />`
          + `<div class="up"><button type="button" class="up-btn" data-imgpick="${b._id}">${svg('img')} ${hasUrl ? 'Replace image' : 'Choose image'}</button><button type="button" class="up-btn" data-imgreuse="${b._id}">${svg('img')} Reuse</button><span class="up-st" data-imgst="${b._id}"></span></div></div>`;
      }
      case 'embed':
        return `<div class="card"><div class="card-h">${svg('video')} Video / embed</div>`
          + `<input data-edit="url" data-id="${b._id}" value="${esc(b.url || '')}" placeholder="Paste a YouTube or Vimeo URL" /></div>`;
      case 'paragraph':
      default: return this._ce('ce-p', 'text', b, 'Write, or use the Add block button');
    }
  }

  // SOW-062 5c: a leading Markdown token in a fresh paragraph converts it to the block type (Notion-style).
  _shortcut(txt) {
    let m;
    if ((m = txt.match(/^(#{1,3})\s(.*)$/))) { const b = emptyBlock('heading'); b.level = m[1].length; b.text = m[2]; return b; }
    if ((m = txt.match(/^>\s(.*)$/))) { const b = emptyBlock('quote'); b.text = m[1]; return b; }
    if ((m = txt.match(/^[-*]\s(.*)$/))) { const b = emptyBlock('list'); b.ordered = false; b.items = [m[1]]; return b; }
    if ((m = txt.match(/^1\.\s(.*)$/))) { const b = emptyBlock('list'); b.ordered = true; b.items = [m[1]]; return b; }
    if (txt === '```') return emptyBlock('code');
    return null;
  }

  _memberDivider(b) {
    return `<div class="mem-div" data-id="${b._id}">${svg('lock')} Members only <span>· only members see the content below</span>`
      + `<button class="bt danger rm" type="button" data-del="${b._id}" title="Remove the members-only split">${svg('x')}</button></div>`;
  }

  _wire() {
    // Live text/field edits: mutate the model in place WITHOUT re-render (preserve caret). IME-safe.
    this.$$('[data-edit]').forEach((el) => {
      const on = () => {
        if (el._composing) return;
        const b = this._byId(el.dataset.id);
        if (!b) return;
        const f = el.dataset.edit;
        if (f === 'text') {
          const plain = el.innerText.replace(/\n$/, ''); // plain text for shortcut/slash detection ONLY
          if (b.type === 'paragraph') {
            const sc = this._shortcut(plain); // SOW-062 5c: '# '/'> '/'- '/'1. '/``` convert the paragraph IN PLACE
            if (sc) { const i = this._indexOf(b._id); this._blocks[i] = withId(sc); this._render(); this._focusBlock(this._blocks[i]._id); this._change(); return; }
            if (plain.startsWith('/')) this._openSlash(el, plain.slice(1)); else this._closeSlash(); // SOW-062 5c-2: slash menu
          }
          b.text = inlineHtmlToMd(el.innerHTML).replace(/\n$/, ''); // SOW-062 P6: store the .ce's inline HTML as Markdown
        }
        else if (f === 'code') b.code = el.innerText.replace(/\n$/, ''); // code stays literal
        else if (f === 'list') {
          const read = readListDom(el, { rendererAnchors: false });
          b.items = read.items;
          b.depths = read.depths;
        }
        else if (f === 'cell') { // SOW-169: a table cell -> b.head[c] (r=-1) or b.rows[r][c], in place, no re-render
          const r = Number(el.dataset.r); const c = Number(el.dataset.c);
          if (Number.isNaN(r) || Number.isNaN(c) || c < 0) return; // ignore a tampered index; never grow sparse arrays
          const md = inlineHtmlToMd(el.innerHTML).replace(/\n$/, '');
          if (r < 0) { if (!Array.isArray(b.head)) b.head = []; if (c < b.head.length) b.head[c] = md; }
          else if (Array.isArray(b.rows) && r < b.rows.length && Array.isArray(b.rows[r]) && c < b.rows[r].length) { b.rows[r][c] = md; }
        }
        else b[f] = el.value; // lang / url / alt inputs
        this._change();
      };
      el.addEventListener('input', on);
      el.addEventListener('compositionstart', () => { el._composing = true; });
      el.addEventListener('compositionend', () => { el._composing = false; on(); });
      if (el.dataset.edit === 'list') {
        el.addEventListener('keydown', (e) => {
          if (e.key !== 'Tab') return;
          const selection = this.root.getSelection ? this.root.getSelection() : document.getSelection();
          e.preventDefault(); // Tab belongs to list structure here, never focus traversal.
          if (indentListSelection(el, selection, { outdent: e.shiftKey })) on();
        });
      }
      if (el.classList.contains('ce') || el.classList.contains('tc')) {
        // paste as PLAIN TEXT only (never author HTML -> CSP + round-trip safe)
        el.addEventListener('paste', (e) => {
          const image = firstImageFile(e.clipboardData);
          if (image) {
            e.preventDefault();
            void this._insertImageFile(image, el.dataset.id, 'after');
            return;
          }
          e.preventDefault();
          const t = (e.clipboardData || window.clipboardData)?.getData('text/plain') || '';
          document.execCommand('insertText', false, t);
        });
      }
    });
    // Convert (Turn into): opens the shared palette. The conversion itself lives in _convertBlock so the button
    // and the palette cannot drift apart.
    this.$$('[data-convert]').forEach((el) => el.addEventListener('click', (e) => {
      e.stopPropagation();
      this._openConvert(el, el.dataset.convert);
    }));
    this.$$('[data-cvar]').forEach((el) => el.addEventListener('click', () => {
      const b = this._byId(el.dataset.cvar);
      if (b) { b.variant = el.dataset.cval; this._render(); this._focusBlock(b._id); this._change(); }
    }));
    // SOW-169: table structure controls. Each mutates the model then re-renders (structural, so caret loss is fine).
    const tblCols = (b) => Math.max(1, (Array.isArray(b.head) ? b.head.length : 1));
    const tblNorm = (b) => { const c = tblCols(b); if (!Array.isArray(b.head)) b.head = []; while (b.head.length < c) b.head.push(''); if (!Array.isArray(b.aligns)) b.aligns = []; while (b.aligns.length < c) b.aligns.push(''); b.aligns.length = c; b.rows = (Array.isArray(b.rows) ? b.rows : []).map((r) => { const row = Array.isArray(r) ? r.slice(0, c) : []; while (row.length < c) row.push(''); return row; }); };
    this.$$('[data-taddrow]').forEach((el) => el.addEventListener('click', () => { const b = this._byId(el.dataset.taddrow); if (!b) return; tblNorm(b); b.rows.push(new Array(tblCols(b)).fill('')); this._render(); this._change(); }));
    this.$$('[data-taddcol]').forEach((el) => el.addEventListener('click', () => { const b = this._byId(el.dataset.taddcol); if (!b) return; tblNorm(b); b.head.push(''); b.aligns.push(''); b.rows.forEach((r) => r.push('')); this._render(); this._change(); }));
    this.$$('[data-trowrm]').forEach((el) => el.addEventListener('click', () => { const b = this._byId(el.dataset.trowrm); if (!b) return; const r = Number(el.dataset.r); if (Array.isArray(b.rows)) b.rows.splice(r, 1); this._render(); this._change(); }));
    this.$$('[data-tcolrm]').forEach((el) => el.addEventListener('click', () => {
      const b = this._byId(el.dataset.tcolrm); if (!b) return; const c = Number(el.dataset.c);
      if (tblCols(b) <= 1) { const i = this._indexOf(b._id); if (i >= 0) { this._blocks.splice(i, 1); this._render(); this._change(); } return; } // last column -> drop the table
      b.head.splice(c, 1); if (Array.isArray(b.aligns)) b.aligns.splice(c, 1); (b.rows || []).forEach((r) => r.splice(c, 1)); this._render(); this._change();
    }));
    this.$$('[data-talign]').forEach((el) => el.addEventListener('click', () => {
      const b = this._byId(el.dataset.talign); if (!b) return; const c = Number(el.dataset.c);
      const order = ['', 'left', 'center', 'right']; if (!Array.isArray(b.aligns)) b.aligns = [];
      b.aligns[c] = order[(order.indexOf(b.aligns[c] || '') + 1) % order.length]; this._render(); this._change();
    }));
    this.$$('[data-up]').forEach((el) => el.addEventListener('click', () => this._move(el.dataset.up, -1)));
    this.$$('[data-down]').forEach((el) => el.addEventListener('click', () => this._move(el.dataset.down, 1)));
    this.$$('[data-del]').forEach((el) => el.addEventListener('click', () => this._deleteBlock(el.dataset.del)));
    // Add block menu.
    const menuBtn = this.$('[data-addmenu]'); const pop = this.$('[data-addpop]');
    if (menuBtn && pop) {
      pop.innerHTML = CONVERT.map((c) => paletteRow(c, `data-newkey="${c.key}"`)).join('');
      // SOW-062 P6 fix: arm the outside-click dismiss on EACH open (the old once-per-render {once:true} listener
      // stopped working after the first open/close cycle, since re-opening did not re-arm it).
      const hideAddPop = () => { pop.hidden = true; document.removeEventListener('click', hideAddPop); };
      menuBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        pop.hidden = !pop.hidden;
        document.removeEventListener('click', hideAddPop);
        if (!pop.hidden) document.addEventListener('click', hideAddPop);
      });
      pop.querySelectorAll('[data-newkey]').forEach((b) => b.addEventListener('click', () => {
        const nb = withId(blockFromKey(b.dataset.newkey));
        this._blocks.push(nb); this._render(); this._focusBlock(nb._id); this._change();
      }));
    }
    this.$('[data-addmembers]')?.addEventListener('click', () => {
      this._blocks.push(withId({ type: 'members' }), withId(emptyBlock('paragraph')));
      this._render(); this._change();
    });
    // SOW-062 5c: drag reorder via the grip handle only (native DnD; the contenteditable body is not draggable).
    this.$$('[data-grip]').forEach((g) => {
      g.addEventListener('dragstart', (e) => { this._dragId = g.dataset.grip; if (e.dataTransfer) { e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', g.dataset.grip); } catch { /* Firefox needs data */ } } });
      g.addEventListener('dragend', () => { this._dragId = null; this.$$('.blk.drop-over').forEach((b) => b.classList.remove('drop-over')); });
    });
    this.$$('.blk[data-id]').forEach((blk) => {
      blk.addEventListener('dragover', (e) => {
        if (transferHasFiles(e.dataTransfer)) {
          e.preventDefault();
          blk.classList.add('drop-over');
          return;
        }
        if (this._dragId != null) { e.preventDefault(); blk.classList.add('drop-over'); }
      });
      blk.addEventListener('dragleave', () => blk.classList.remove('drop-over'));
      blk.addEventListener('drop', (e) => {
        blk.classList.remove('drop-over');
        if (transferHasFiles(e.dataTransfer)) {
          e.preventDefault();
          e.stopPropagation();
          this.$('.doc-blocks')?.classList.remove('file-drag');
          const file = firstImageFile(e.dataTransfer);
          if (!file) return;
          const box = blk.getBoundingClientRect();
          const position = Number(e.clientY) < box.top + box.height / 2 ? 'before' : 'after';
          void this._insertImageFile(file, blk.dataset.id, position);
          return;
        }
        e.preventDefault();
        if (this._dragId == null || this._dragId === blk.dataset.id) { this._dragId = null; return; }
        const from = this._indexOf(this._dragId);
        if (from < 0) return;
        const [moved] = this._blocks.splice(from, 1);
        const to = this._indexOf(blk.dataset.id); // recompute after the splice; insert BEFORE the drop target
        this._blocks.splice(to < 0 ? this._blocks.length : to, 0, moved);
        this._dragId = null; this._render(); this._change();
      });
    });
    // sow-290: the blank space after the final block is a valid drop target too.
    const surface = this.$('.doc-blocks');
    surface?.addEventListener('dragover', (e) => {
      if (!transferHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      surface.classList.add('file-drag');
    });
    surface?.addEventListener('dragleave', (e) => {
      if (!surface.contains(e.relatedTarget)) surface.classList.remove('file-drag');
    });
    surface?.addEventListener('drop', (e) => {
      surface.classList.remove('file-drag');
      if (!transferHasFiles(e.dataTransfer) || e.target.closest?.('.blk')) return;
      e.preventDefault();
      const file = firstImageFile(e.dataTransfer);
      if (!file) return;
      const last = this._blocks[this._blocks.length - 1];
      void this._insertImageFile(file, last?._id, 'after');
    });
    // Image upload (reused from the Phase-4 editor).
    this.$$('[data-imgpick]').forEach((el) => {
      const id = el.dataset.imgpick;
      const fileEl = this.$(`[data-imgfile="${id}"]`);
      el.addEventListener('click', () => fileEl?.click());
      fileEl?.addEventListener('change', (e) => {
        void this._uploadImage(e.target.files?.[0], id);
        e.target.value = '';
      });
    });
    // sow-165 Q36: Reuse opens a grid of the images this member's own published items already use.
    this.$$('[data-imgreuse]').forEach((el) => {
      el.addEventListener('click', () => this._openMediaPicker(el, el.dataset.imgreuse));
    });
    // SOW-062 P6: the empty-image drop-zone: click to open the picker, or drag-drop an image file (reuses _uploadImage).
    this.$$('[data-imgdrop]').forEach((zone) => {
      const id = zone.dataset.imgdrop;
      const fileEl = this.$(`[data-imgfile="${id}"]`);
      zone.addEventListener('click', () => fileEl?.click());
      zone.addEventListener('dragover', (e) => { e.preventDefault(); e.stopPropagation(); zone.classList.add('drag'); });
      zone.addEventListener('dragleave', () => zone.classList.remove('drag'));
      zone.addEventListener('drop', (e) => {
        e.preventDefault(); e.stopPropagation(); zone.classList.remove('drag');
        const f = firstImageFile(e.dataTransfer);
        if (f) void this._uploadImage(f, id);
      });
    });
    // A single click on a link opens its editor directly, matching what every other WYSIWYG (Docs, Notion)
    // does -- without this, a plain click inside contenteditable neither navigates (Chrome/Firefox both
    // suppress that) nor shows anything: it just silently places a text caret, so a link looked "dead" to
    // click on. editLink builds its own Range and never touches document.getSelection(); see the note there.
    this.$$('.ce[data-edit="text"] a[href]').forEach((a) => a.addEventListener('click', (e) => {
      e.preventDefault();
      const ce = this._ceOf(a);
      if (!ce) return;
      this._seltb?.editLink(ce, a);
    }));
    // Enter at the end of a text block inserts a new paragraph after it.
    this.$$('.ce[data-edit="text"]').forEach((el) => el.addEventListener('keydown', (e) => {
      if (this._slash && this._slash.el === el) { // SOW-062 5c-2: slash-menu keyboard nav
        if (e.key === 'ArrowDown') { e.preventDefault(); return this._moveSlash(1); }
        if (e.key === 'ArrowUp') { e.preventDefault(); return this._moveSlash(-1); }
        if (e.key === 'Enter') { e.preventDefault(); return this._pickSlash(this._slash.idx); }
        if (e.key === 'Escape') { e.preventDefault(); return this._closeSlash(); }
      }
      // Backspace at the very start of an EMPTY block. Every block body is its own contenteditable host, so
      // the browser cannot merge across the boundary on its own and the key does nothing at all without this.
      // Emptiness is tested on the MODEL, never on innerHTML: Chrome leaves a bare <br> behind in a block the
      // author has just cleared, so an innerHTML test reports that block as non-empty exactly when it matters.
      if (e.key === 'Backspace') {
        const b = this._byId(el.dataset.id);
        const sel = this.root.getSelection ? this.root.getSelection() : document.getSelection();
        const atStart = sel && sel.isCollapsed && sel.focusOffset === 0;
        if (b && atStart && !String(b.text || '')) {
          // A non-paragraph block converts to a paragraph FIRST rather than vanishing. One stray Backspace
          // should not silently destroy a heading or a quote the author is about to type into.
          if (b.type !== 'paragraph') {
            e.preventDefault();
            const i = this._indexOf(b._id);
            this._blocks[i] = { ...emptyBlock('paragraph'), _id: b._id };
            this._render(); this._focusBlock(b._id); this._change();
            return;
          }
          // An empty paragraph is removed, but never the first block: deleting it would leave nowhere to type.
          if (this._indexOf(b._id) > 0) {
            e.preventDefault();
            this._deleteBlock(b._id, { focusPrev: true });
            return;
          }
        }
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        const b = this._byId(el.dataset.id);
        const sel = this.root.getSelection ? this.root.getSelection() : document.getSelection();
        const atEnd = sel && sel.focusOffset === (el.innerText || '').length;
        if (b && atEnd) {
          e.preventDefault();
          const i = this._indexOf(b._id);
          const nb = withId(emptyBlock('paragraph'));
          this._blocks.splice(i + 1, 0, nb);
          this._render(); this._focusBlock(nb._id); this._change();
        }
      }
    }));
  }

  _focusBlock(id) {
    const el = this.$(`.blk[data-id="${id}"] .ce`) || this.$(`.blk[data-id="${id}"] input`);
    if (!el) return;
    el.focus();
    try {
      const r = document.createRange(); r.selectNodeContents(el); r.collapse(false);
      const sel = document.getSelection(); sel.removeAllRanges(); sel.addRange(r);
    } catch { /* input focus is enough */ }
  }

  /**
   * Remove a block. The X button and Backspace-in-an-empty-block both land here, so the two cannot drift.
   * `focusPrev` puts the caret at the END of the preceding block, which is what makes Backspace feel like
   * ordinary text deletion rather than a structural edit.
   */
  _deleteBlock(id, { focusPrev = false } = {}) {
    const i = this._indexOf(id);
    if (i < 0) return false;
    const prev = i > 0 ? this._blocks[i - 1] : null;
    this._blocks.splice(i, 1);
    this._render();
    if (focusPrev && prev) this._focusBlock(prev._id);
    this._change();
    return true;
  }

  _move(id, dir) {
    const i = this._indexOf(id); const j = i + dir;
    if (i < 0 || j < 0 || j >= this._blocks.length) return;
    const [b] = this._blocks.splice(i, 1);
    this._blocks.splice(j, 0, b);
    this._render(); this._change();
  }

  _usedImageNames() {
    return [...this.usedImageNames, ...(this._blocks || [])
      .filter((block) => block?.type === 'image' && block.url)
      .map((block) => String(block.url).split('/').pop())];
  }

  async _insertImageFile(file, anchorId, position = 'after') {
    if (!file) return;
    const anchor = this._indexOf(anchorId);
    const at = anchor < 0 ? this._blocks.length : anchor + (position === 'before' ? 0 : 1);
    const block = withId(emptyBlock('image'));
    this._blocks.splice(at, 0, block);
    this._render();
    this._change();
    await this._uploadImage(file, block._id);
  }

  async _uploadImage(file, id) {
    const b = this._byId(id);
    if (!file || !b || !this.client?.stageImage) return;
    const status = () => this.$(`[data-imgst="${id}"]`);
    const firstStatus = status();
    if (firstStatus) firstStatus.textContent = 'Processing image...';
    try {
      const processed = await processImageFile(file, { usedNames: this._usedImageNames() });
      if (this._indexOf(id) < 0) return;
      const dataBase64 = await blobToBase64(processed.blob);
      // sow-165: pass the item path so the host CO-LOCATES the image in the item's ./images/ folder and returns
      // the canonical `./images/<file>` reference (native Astro resolution; the old per-user path broke the build).
      const out = await this.client.stageImage({
        filename: processed.name,
        dataBase64,
        itemPath: this.itemPath,
        item: this.item,
      });
      if (this._indexOf(id) < 0) return;
      b.url = out.path;
      // Preview the exact processed bytes, never the metadata-bearing original
      // file. A data URL fits the production CSP; blob: URLs are blocked there.
      (this._stagedSrc ||= {})[b.url] = processedImageDataUrl(processed.blob, dataBase64);
      if (!b.alt) b.alt = String(file.name || processed.name).replace(/\.[^.]+$/, '');
      this._render();
      const done = status();
      if (done) done.textContent = processed.message;
      this._change();
    } catch (error) {
      const failed = status();
      if (failed) failed.textContent = error?.message || 'Upload failed';
    }
  }

  // --- sow-165 Q36: reuse an image from this member's own published items ---------------------------------
  //
  // The index is fetched ONCE per editor session and cached on the instance. It is a public build artifact
  // (no token, CORS `*`), so a failure here is a missing picker rather than a broken editor: every path below
  // fail-softs to an empty grid with a reason, never an exception into render().
  async _loadMediaIndex() {
    if (this._mediaRows) return this._mediaRows;
    // An explicit `author` wins (a host that knows the signed-in login can set it); otherwise the item's own
    // folder identifies its owner, which is the same key the index groups by. A house item yields neither.
    const me = (typeof this.author === 'string' && this.author) || authorFromItemPath(this.itemPath);
    if (!me) { this._mediaErr = 'Reuse is available on your own items.'; return (this._mediaRows = []); }
    try {
      const res = await fetch(MEDIA_INDEX_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      this._mediaRows = mediaFor(await res.json(), me);
      if (!this._mediaRows.length) this._mediaErr = 'No images yet. Images appear here once an item using them is published.';
    } catch {
      this._mediaRows = [];
      this._mediaErr = 'Could not load your image library.';
    }
    return this._mediaRows;
  }

  async _openMediaPicker(btn, id) {
    this._closeMediaPicker();
    const blk = btn.closest('.blk') || btn.parentElement;
    if (!blk) return;
    const pop = document.createElement('div');
    pop.className = 'slash-pop media-pop';
    pop.innerHTML = '<div class="media-load">Loading your images...</div>';
    blk.appendChild(pop);
    this._mediaPop = pop;

    const rows = await this._loadMediaIndex();
    if (this._mediaPop !== pop) return; // closed while loading
    const draw = (q) => {
      const shown = filterMedia(rows, q);
      pop.querySelector('.media-grid').innerHTML = shown.length
        ? shown.map((r, i) => {
          const plan = reusePlan(r, this.itemPath);
          return `<button type="button" class="media-cell" data-mi="${i}" title="${esc(r.name)} (from ${esc(r.itemTitle || r.slug || '')})">`
            + `<img src="${esc(plan?.sourceUrl || '')}" alt="" loading="lazy" /><span>${esc(r.name)}</span></button>`;
        }).join('')
        : `<div class="media-load">${esc(rows.length ? 'Nothing matches that.' : (this._mediaErr || 'No images.'))}</div>`;
      pop.querySelectorAll('[data-mi]').forEach((cell) => {
        cell.addEventListener('click', () => { this._closeMediaPicker(); this._reuseImage(shown[Number(cell.dataset.mi)], id); });
        // A thumbnail can legitimately fail: the file was deleted, or jsDelivr has not caught up with a recent
        // merge. Hide the broken <img> so the cell falls back to its filename, which is still selectable and
        // still copies correctly. A browser broken-image glyph reads as "this app is broken" instead.
        cell.querySelector('img')?.addEventListener('error', (e) => { e.target.style.display = 'none'; });
      });
    };
    pop.innerHTML = `<input class="media-q" type="search" placeholder="Search your images" aria-label="Search your images" /><div class="media-grid"></div>`;
    const q = pop.querySelector('.media-q');
    q?.addEventListener('input', () => draw(q.value));
    draw('');
    q?.focus();
    this._onMediaEsc = (e) => { if (e.key === 'Escape') this._closeMediaPicker(); };
    document.addEventListener('keydown', this._onMediaEsc);
  }

  _closeMediaPicker() {
    this._mediaPop?.remove();
    this._mediaPop = null;
    if (this._onMediaEsc) { document.removeEventListener('keydown', this._onMediaEsc); this._onMediaEsc = null; }
  }

  // Selecting a row COPIES the file into the item being edited, through the same client.stageImage the upload
  // path uses, so co-location and the publish flush stay in one place. An image already in THIS item needs no
  // copy: re-staging it would upload a byte-identical file over itself and, on a host that de-duplicates by
  // name, would look like it worked while doing nothing.
  async _reuseImage(record, id) {
    const b = this._byId(id);
    const plan = reusePlan(record, this.itemPath);
    if (!b || !plan) return;
    const st = this.$(`[data-imgst="${id}"]`);
    if (plan.alreadyHere) {
      b.url = plan.ref;
      if (!b.alt) b.alt = plan.name.replace(/\.[^.]+$/, '');
      this._render(); this._change();
      return;
    }
    if (!this.client?.stageImage) { if (st) st.textContent = 'Reuse is not available in this client'; return; }
    if (st) st.textContent = 'Copying...';
    try {
      const res = await fetch(plan.sourceUrl);
      if (!res.ok) throw new Error(String(res.status));
      const buf = new Uint8Array(await res.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
      const out = await this.client.stageImage({ filename: plan.name, dataBase64: btoa(bin), itemPath: this.itemPath, item: this.item });
      b.url = out.path;
      if (!b.alt) b.alt = plan.name.replace(/\.[^.]+$/, '');
      this._render(); this._change();
    } catch {
      if (st) st.textContent = 'Could not copy that image';
    }
  }

  // --- SOW-062 5c-2: slash menu (type "/" in a fresh paragraph -> a filtered block picker) ---
  // "Turn into", as a palette rather than a dropdown. Reuses paletteRow and .slash-pop so it looks and behaves
  // like the slash menu and the add-block menu instead of being a third pattern.
  _openConvert(btn, id) {
    this._closeConvert();
    const b = this._byId(id);
    const host = this.$('.doc-blocks');
    const blk = btn.closest('.blk');
    if (!b || !host || !blk) return;
    const pop = document.createElement('div');
    pop.className = 'slash-pop';
    pop.innerHTML = CONVERT.map((c) => paletteRow(c, `data-ck="${c.key}"`, convertKey(b) === c.key)).join('');
    pop.style.top = `${blk.offsetTop + blk.offsetHeight + 4}px`;
    pop.style.left = `${Math.max(0, blk.offsetLeft + blk.offsetWidth - 268)}px`;
    pop.querySelectorAll('[data-ck]').forEach((row) => row.addEventListener('click', (e) => {
      e.stopPropagation();
      this._convertBlock(id, row.dataset.ck);
    }));
    host.appendChild(pop);
    // Armed on EACH open, and deferred by a tick so the click that opened it does not immediately close it.
    // The add-block menu learned this the hard way: a {once:true} listener stopped dismissing after one cycle.
    const away = () => this._closeConvert();
    setTimeout(() => document.addEventListener('click', away), 0);
    this._conv = { pop, away };
  }

  _closeConvert() {
    if (!this._conv) return;
    this._conv.pop.remove();
    document.removeEventListener('click', this._conv.away);
    this._conv = null;
  }

  _convertBlock(id, key) {
    const i = this._indexOf(id);
    if (i < 0) return;
    const cur = this._blocks[i];
    const next = withId(blockFromKey(key));
    if (cur.text != null && 'text' in next) next.text = cur.text;
    if (cur.text != null && next.type === 'code') next.code = cur.text;
    if (cur.text != null && next.type === 'list') next.items = String(cur.text).split('\n');
    this._blocks[i] = next;
    this._closeConvert();
    this._render(); this._focusBlock(next._id); this._change();
  }

  _openSlash(el, query) {
    const q = String(query || '').toLowerCase();
    const matches = CONVERT.filter((c) => `${c.label} ${c.key}`.toLowerCase().includes(q));
    this._closeSlash();
    const host = this.$('.doc-blocks'); const blk = el.closest('.blk');
    if (!matches.length || !host || !blk) return;
    const pop = document.createElement('div');
    pop.className = 'slash-pop';
    pop.style.top = `${blk.offsetTop + blk.offsetHeight + 4}px`;
    pop.style.left = `${blk.offsetLeft}px`;
    pop.innerHTML = matches.map((c, i) => paletteRow(c, `data-si="${i}"`, i === 0)).join('');
    pop.querySelectorAll('[data-si]').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); this._pickSlash(Number(b.dataset.si)); }));
    host.appendChild(pop);
    this._slash = { el, matches, idx: 0, pop };
  }

  _closeSlash() { if (this._slash && this._slash.pop) this._slash.pop.remove(); this._slash = null; }

  _moveSlash(dir) {
    const s = this._slash; if (!s) return;
    s.idx = (s.idx + dir + s.matches.length) % s.matches.length;
    s.pop.querySelectorAll('[data-si]').forEach((b, i) => { const on = i === s.idx; b.classList.toggle('on', on); if (on) b.scrollIntoView({ block: 'nearest' }); });
  }

  _pickSlash(i) {
    const s = this._slash; if (!s) return;
    const b = this._byId(s.el.dataset.id); if (!b) { this._closeSlash(); return; }
    const idx = this._indexOf(b._id);
    this._blocks[idx] = withId(blockFromKey(s.matches[i].key)); // the "/query" text is discarded on convert
    this._closeSlash();
    this._render(); this._focusBlock(this._blocks[idx]._id); this._change();
  }

  // sow-235: the selection toolbar, the link manager and the inline-tag toggle moved to
  // client-ui/src/selection-toolbar.mjs, so the WorkBench Preview drives the same implementation.
  // _ceOf stays here: it resolves one of THIS component's .ce blocks and is used by the link click above.
  _ceOf(node) {
    let n = node;
    while (n && n !== this.root) { if (n.nodeType === 1 && n.classList && n.classList.contains('ce')) return n; n = n.parentNode || n.host; }
    return null;
  }
}

define('gbti-doc-editor', GbtiDocEditor);
export { GbtiDocEditor };
