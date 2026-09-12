// sow-327: the block editor's stylesheet, lifted out of gbti-doc-editor.mjs when that file crossed the
// project's 900-line cap (enforced by test/image-layout.test.mjs and test/list-nesting.test.mjs, which is how
// it was caught). Split along the seam that was already there rather than at a line count: this is one
// self-contained template string with one interpolation, and nothing else in the element reads it.
//
// The rules themselves are UNCHANGED by the move, and that was measured rather than asserted: the pre-split
// build was reconstructed, rebuilt and confirmed to hash to the old bundle, then the two bundles were
// compared. This stylesheet's text is byte-identical in both. The bundles differ only in the bundler's own
// numbering of its internal constants (CSS25 became CSS24 and so on), because one module entered the graph.
import { IMAGE_LAYOUT_ROW_CSS } from './image-layout-ui.mjs';

export const DOC_EDITOR_CSS = `
  /* --blk-gutter reserves the column the hover toolbar lives in. Measured, not guessed: the toolbar measures 134px
     (five 24px controls plus gaps, padding and border), and 142px leaves it a little breathing room. Before this existed the toolbar was 225px wide over a gutter of
     40px on paragraphs and ZERO on headings, so it covered the text it was meant to sit beside. */
  :host { display:block; font-family:var(--font-body); color:var(--s-fg); --blk-gutter:142px; container-type:inline-size; }
  .doc-blocks { display:flex; flex-direction:column; position:relative; padding-right:var(--blk-gutter); }
  /* a block = its content + a contextual hover toolbar in the right gutter; NO bordered box around each block */
  .blk { position:relative; padding:2px 0; margin:2px 0; }
  /* sow-327: where the change list lands you. Amber to match the staged-draft banner the list opens from,
     and an animation rather than a held class so nothing has to remember to clean it up on a re-render. */
  .blk-flash { border-radius:8px; animation: blkflash 1.8s ease-out 1; }
  @keyframes blkflash {
    0%, 55% { background:color-mix(in srgb, var(--s-amber, #d9a13c) 30%, transparent); box-shadow:0 0 0 4px color-mix(in srgb, var(--s-amber, #d9a13c) 30%, transparent); }
    100% { background:transparent; box-shadow:0 0 0 4px transparent; }
  }
  @media (prefers-reduced-motion: reduce) { .blk-flash { animation-duration:.01s; outline:2px solid var(--s-amber, #d9a13c); } }
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
  .ce-list ul, .ce-list ol { padding-left:22px; margin:2px 0; }
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
  .imgframe figcaption { font-family:var(--font-mono,monospace); font-size:12px; color:var(--s-fg-mute); background:var(--s-tint); padding:4px 8px; }
  .imgph { aspect-ratio:16/8; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:9px; color:var(--s-fg-mute); cursor:pointer;
    background-image:repeating-linear-gradient(45deg, var(--s-surface-3) 0 12px, transparent 12px 24px); transition:color .14s ease, box-shadow .14s ease; }
  .imgph:hover { color:var(--s-green-fg); }
  .imgph.drag { color:var(--s-green-fg); background:var(--s-tint); box-shadow:inset 0 0 0 2px var(--s-green); }
  .imgph svg { width:30px; height:30px; opacity:.55; }
  .imgph-t { font-family:var(--font-mono,monospace); font-size:12px; }
  .up { display:flex; align-items:center; gap:10px; }
  ${IMAGE_LAYOUT_ROW_CSS}
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
  /* sow-169, found at phone width on 2026-09-08: the gutter is a HOVER affordance and a phone has neither hover nor
     the room. At 241px of document it left every block 99px wide, so a paragraph wrapped one word per line and a
     table showed one column. Below 560px of the editor's own width there is no gutter and no paragraph
     right-padding; a block's toolbar flows in at the TOP of the block while the block is focused (a tap focuses
     it) instead of floating beside it, pushing the text down rather than covering it. Wide layouts keep the
     measured 142px column. */
  @container (max-width: 560px) {
    .doc-blocks { padding-right:0; }
    .ce-p { padding-right:0; }
    .blk-tools { position:static; display:none; width:max-content; margin:0 0 6px auto; opacity:1; }
    .blk:focus-within > .blk-tools { display:flex; }
  }
`;
