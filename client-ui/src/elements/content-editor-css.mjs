// The <gbti-content-editor> stylesheet: the component's own rules, which render() appends after the shared editor
// surface, the skill editor rules (a prompt only) and the prepared-mode rules. It moved out of render() unchanged when
// the element crossed the 900-line limit (owner, 2026-09-30). The template text, its indentation included, is the
// same string render() used to build inline, so the shadow root receives byte-identical CSS.

export const CONTENT_EDITOR_CSS = `
        :host { display:block; background:var(--s-app); color:var(--s-fg); font-family:var(--font-body); container-type:inline-size; }
        /* sow-184 (design 3a): pin the action toolbar so Publish / Save draft / Preview never scroll off. It pins
           to the editor's scroll container; a solid --s-app background + a hairline let the document scroll under it.
           Under the single-column breakpoint below, it collapses back to static. */
        .edhead { display:flex; align-items:center; gap:12px; padding:12px 2px; flex-wrap:wrap; position:sticky; top:0; z-index:20; background:var(--s-app); border-bottom:1.5px solid var(--s-line); }
        .etype { font-family:var(--font-mono,monospace); font-size:10.5px; font-weight:600; letter-spacing:.12em; text-transform:uppercase; color:var(--s-green-fg); background:var(--s-tint); border:1.5px solid var(--s-tint-2); border-radius:999px; padding:5px 12px; }
        .edhead-sp { flex:1; }
        .mcpid { font-family:var(--font-mono,monospace); font-size:11.5px; color:var(--s-fg-mute); background:var(--s-tint); border:1px solid var(--s-line); border-radius:6px; padding:6px 9px; cursor:pointer; max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; } /* sow-164: the MCP ID, visible before it is copied */
        .mcpid:hover { color:var(--s-fg); border-color:var(--s-line-2); }
        @container (max-width:760px) { .mcpid { display:none; } }
        .savechip { font-size:13px; color:var(--s-fg-mute); font-weight:500; display:inline-flex; align-items:center; gap:3px; }
        .savechip svg { width:14px; height:14px; }
        .savechip.ok { color:var(--s-green-fg); font-weight:600; }
        .savechip.busy { color:var(--s-fg-soft); }
        .ebtn[disabled] { opacity:.7; cursor:default; }
        .ebtn .spin { display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:ed-spin .7s linear infinite; }
        @keyframes ed-spin { to { transform:rotate(360deg); } }
        .ebtn { font:inherit; font-weight:600; font-size:14px; padding:9px 16px; border-radius:8px; border:1.5px solid var(--s-line-2); background:var(--s-surface); color:var(--s-fg); cursor:pointer; display:inline-flex; align-items:center; gap:7px; white-space:nowrap; }
        .ebtn:hover { border-color:var(--s-fg-mute); }
        .ebtn svg { width:16px; height:16px; }
        .ebtn-primary { background:var(--s-green); border-color:var(--s-green); color:#fff; box-shadow:0 8px 20px rgba(31,158,95,.26); }
        .ebtn-primary:hover { filter:brightness(.96); border-color:var(--s-green); }
        .edgrid { display:grid; grid-template-columns:minmax(0,1fr) 350px; grid-template-rows:auto 1fr; gap:34px; align-items:start; margin-top:18px; }
        /* sow-164: the Media slot is its own grid child. Wide: the document spans both rows, Media takes the top of
           the right column and the rail (Status first) sits under it, so the rail's sticky behaviour is untouched.
           Stacked: everything is one column and the slot orders itself above the document. */
        .doc { grid-row:1 / span 2; }
        .media-slot { grid-column:2; grid-row:1; min-width:0; }
        .media-slot .rsec-media { background:var(--s-surface); }
        .rail { grid-column:2; grid-row:2; }
        /* sow-184's own mockup pins this at "under 1100px"; the WorkBench page shell (.wb-wrap max-width:1200px
           plus its 40px gutter) only ever hands this host ~1120px of inline-size, so a 1140px threshold matched
           unconditionally and the two-column rail could never appear on the real page at any viewport width. */
        @container (max-width:1100px) { .edgrid { grid-template-columns:1fr; grid-template-rows:none; } .doc, .media-slot, .rail { grid-column:auto; grid-row:auto; } .media-slot { order:-1; } .edhead { position:static; } }
        .doc { min-width:0; background:var(--s-canvas); border:1.5px solid var(--s-line); border-radius:12px; box-shadow:var(--s-shadow-md); padding:40px 46px 52px; color:var(--s-fg); }
        .doc-title { font-family:var(--font-display); font-weight:800; font-size:34px; line-height:1.14; letter-spacing:-.015em; color:var(--s-fg); outline:none; margin-bottom:6px; }
        .doc-title:empty::before { content:attr(data-ph); color:var(--s-fg-mute); } /* sow-249: dropped opacity:.55, which put this at 1.86:1 */
        .doc-tagline { font-size:18px; line-height:1.5; font-weight:500; color:var(--s-fg-soft); outline:none; margin:2px 0 14px; }
        .doc-tagline:empty::before { content:attr(data-ph); color:var(--s-fg-mute); } /* sow-249: dropped opacity:.5, which put this at 1.75:1 */
        .doc-slug { display:flex; align-items:center; gap:9px; flex-wrap:wrap; font-family:var(--font-mono,monospace); font-size:12.5px; color:var(--s-fg-mute); margin-bottom:6px; }
        .doc-slug .slug-val { color:var(--s-green-fg); font-weight:600; outline:none; border-bottom:1.5px dashed transparent; }
        .doc-slug .slug-val:hover { border-bottom-color:var(--s-line-2); }
        .doc-slug .slug-val:focus { border-bottom-color:var(--s-green); }
        .doc-slug .slug-val.locked { border-bottom-color:transparent; cursor:default; }
        .doc-slug .slug-val.locked:hover { border-bottom-color:transparent; }
        .fld .slugrow { display:flex; align-items:center; gap:4px; font-family:var(--font-mono,monospace); font-size:12.5px; }
        .fld .slugrow .slugpre { color:var(--s-fg-mute); flex:none; }
        .fld .slugrow .slugro { color:var(--s-green-fg); font-weight:600; }
        .fld .slugrow input { flex:1; min-width:0; font:inherit; color:var(--s-green-fg); font-weight:600; background:var(--s-paper, transparent); border:1.5px solid var(--s-line); border-radius:7px; padding:6px 9px; }
        .fld .slugrow input:focus { outline:none; border-color:var(--s-green); }
        .fld .btn2 { margin-top:7px; font:inherit; font-size:12.5px; font-weight:700; color:var(--s-fg); background:none; border:1.5px solid var(--s-line); border-radius:7px; padding:5px 12px; cursor:pointer; }
        .fld .btn2:hover { color:var(--s-green-fg); border-color:var(--s-green); }
        .fld .btn2[disabled] { opacity:.45; cursor:default; }
        .fld .urlprev.danger { color:var(--s-danger, #e06c6c); }
        .doc-slug .slug-meta { display:inline-flex; align-items:center; gap:7px; }
        .doc-slug .pubdot { width:7px; height:7px; border-radius:50%; background:var(--s-fg-mute); }
        .doc-slug .slug-meta.pub .pubdot { background:var(--s-green); }
        .doc-slug .slug-meta.staged .pubdot { background:var(--s-amber, #d9a13c); }
        .doc-slug .slug-meta.staged { color:var(--s-amber, #d9a13c); font-weight:600; }
        .docsec { margin-top:38px; padding-top:30px; border-top:1.5px solid var(--s-line); }
        /* sow-169 (2026-09-08): on a phone the document's 46px side padding cost a quarter of the column. Placed
           AFTER the base .doc and .doc-title rules: a container query adds no specificity, so source order decides. */
        @container (max-width:560px) { .doc { padding:24px 16px 34px; } .doc-title { font-size:28px; } }
        .docsec#secMain { margin-top:14px; padding-top:0; border-top:none; }
        .docsec-h { font-family:var(--font-mono,monospace); font-size:11px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--s-fg-mute); margin-bottom:14px; display:flex; align-items:center; gap:8px; }
        .docsec-h svg { width:15px; height:15px; }
        #body { display:block; min-height:24vh; }
        .notice { background:var(--s-tint); border:1px solid var(--s-green); border-radius:10px; padding:10px 14px; margin-bottom:16px; color:var(--s-fg); font-size:13.5px; }
        .notice a { color:var(--s-green-fg); }
        #out { margin-top:14px; }
        .preview { background:var(--s-surface-2); border:1px solid var(--s-line); border-radius:10px; padding:12px 14px; color:var(--s-fg); margin-top:12px; }
        /* sow-062 review feedback: tables render for real now; give them borders and their own horizontal
           scroll so a wide table never widens the editor column on a phone. */
        .preview table { display:block; overflow-x:auto; max-width:100%; border-collapse:collapse; margin:0 0 1.1em; font-size:14px; }
        .preview table th, .preview table td { border:1px solid var(--s-line); padding:6px 10px; text-align:left; vertical-align:top; }
        .preview table th { background:var(--s-surface); font-weight:700; white-space:nowrap; }
        /* sow-184: the rail pins BELOW the sticky toolbar (top:64px clears it), so the top Status card is never
           hidden under the pinned bar. Collapses to static under the breakpoint below. */
        .rail { display:flex; flex-direction:column; gap:14px; position:sticky; top:64px; max-height:calc(100vh - 72px); overflow-y:auto; }
        /* The rail is a height-capped flex column and .rsec has overflow:hidden (zero min size), so without
           this the flex algorithm SHRINKS the section cards to fit instead of scrolling: every card clipped
           its content mid-line (the Type card cut its own one-liner). Cards keep their natural height; the
           rail scrolls. */
        .rail > * { flex-shrink:0; }
        @container (max-width:1100px) { .rail { position:static; max-height:none; } }
        .rsec { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rsec > summary { list-style:none; cursor:pointer; display:flex; align-items:center; justify-content:space-between; padding:13px 15px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary::-webkit-details-marker { display:none; }

        .rbody { padding:2px 15px 14px; display:grid; gap:8px; }
        .rbody label { font-size:12px; color:var(--s-fg-mute); font-weight:600; }
        .type-ro { font-weight:600; font-size:13px; padding:7px 11px; border:1px solid var(--s-line); border-radius:8px; background:var(--s-surface-2); color:var(--s-fg); text-transform:capitalize; }
        /* SOW-062 P6 rail controls (ported from gbti-editor.css --s-* controls) */
        .rsec > summary { padding:14px 16px; }
        .rsec > summary::after { content:none; }
        .rsec > summary .st { display:flex; align-items:center; gap:9px; font-weight:700; font-size:14px; color:var(--s-fg); }
        .rsec > summary .st .si { width:17px; height:17px; color:var(--s-fg-mute); display:inline-flex; }
        .rsec > summary .chev { width:17px; height:17px; color:var(--s-fg-mute); transition:transform .18s ease; display:inline-flex; }
        .rsec[open] > summary .chev { transform:rotate(180deg); }
        /* sow-184 (design 3a): a section-header hint (Media "1 cover"), right-aligned before the chevron. */
        .rsec > summary .rsec-sum { margin-left:auto; margin-right:10px; font-family:var(--font-mono,monospace); font-size:10.5px; font-weight:500; color:var(--s-fg-mute); }
        /* sow-184 (design 3a): rail info cards. Status folds the old Type panel into a compact card; Activity holds
           the stat tiles. Same surface tokens as .rsec so the rail reads as one system. */
        .rcard { background:var(--s-surface); border:1.5px solid var(--s-line); border-radius:10px; box-shadow:var(--s-shadow); overflow:hidden; }
        .rcard-h { display:flex; align-items:center; gap:9px; padding:13px 16px; border-bottom:1px solid var(--s-line); }
        .rcard-t { font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.14em; text-transform:uppercase; color:var(--s-fg-mute); }
        .rcard-b { padding:14px 16px; display:flex; flex-direction:column; gap:11px; }
        .rcard-note { font-size:12px; line-height:1.5; color:var(--s-fg-mute); margin:2px 0 0; }
        .statpill { display:inline-flex; align-items:center; gap:6px; margin-left:auto; font-family:var(--font-mono,monospace); font-size:10px; font-weight:600; letter-spacing:.08em; text-transform:uppercase; padding:3px 9px; border-radius:999px; }
        .statpill .d { width:7px; height:7px; border-radius:50%; background:currentColor; }
        .statpill-live { color:var(--s-green-fg); background:var(--s-tint); border:1.5px solid var(--s-tint-2); }
        /* sow-184: the golden #d9a13c drives the tint + border, but the TEXT uses the theme-aware --s-amber-fg so the
           small 10px label clears WCAG AA on the light card (the flat golden fails at ~2.1:1). */
        .statpill-staged { color:var(--s-amber-fg,#8a5500); background:color-mix(in srgb, var(--s-amber,#d9a13c) 14%, transparent); border:1.5px solid color-mix(in srgb, var(--s-amber,#d9a13c) 34%, transparent); }
        .statpill-draft { color:var(--s-fg-mute); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); }
        .strow { display:flex; align-items:center; justify-content:space-between; gap:10px; font-size:13px; }
        .strow .sk { color:var(--s-fg-mute); }
        .strow .sv { font-weight:600; color:var(--s-fg); text-transform:capitalize; }
        .strow .sv.mono { font-family:var(--font-mono,monospace); font-weight:500; text-transform:none; }
        .rbody { padding:4px 16px 16px; display:flex; flex-direction:column; gap:15px; }
        .fld { display:flex; flex-direction:column; gap:6px; }
        .fld[hidden] { display:none; } /* sow-109: the attribute must beat display:flex (a skill hides the rail's Works with) */
        .fld > label { font-size:12.5px; font-weight:600; color:var(--s-fg-soft); display:flex; align-items:center; gap:6px; }
        .fld .req { color:var(--s-green-fg); } .fld .hint { font-size:11.5px; color:var(--s-fg-mute); font-weight:400; }
        .inp, .ta, .selbox { width:100%; font:inherit; font-size:13.5px; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; padding:9px 11px; outline:none; box-sizing:border-box; }
        .inp:focus, .ta:focus, .selbox:focus { border-color:var(--s-green); background:var(--s-surface); }
        .ta { resize:vertical; min-height:64px; line-height:1.5; } .inp.mono, .ta.mono { font-family:var(--font-mono,monospace); font-size:12.5px; }
        .selbox { appearance:none; cursor:pointer; padding-right:34px; background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2384818c' stroke-width='2.2' stroke-linecap='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E"); background-repeat:no-repeat; background-position:right 11px center; }
        .urlprev { font-family:var(--font-mono,monospace); font-size:11.5px; color:var(--s-fg-mute); line-height:1.5; } .urlprev b { color:var(--s-green-fg); font-weight:600; }
        .tgl { width:42px; height:24px; border-radius:999px; background:var(--s-line-2); border:0; position:relative; cursor:pointer; flex:none; transition:background .18s; }
        .tgl.on { background:var(--s-green); }
        .tgl::after { content:""; position:absolute; top:3px; left:3px; width:18px; height:18px; border-radius:50%; background:#fff; box-shadow:0 1px 3px rgba(0,0,0,.25); transition:left .18s cubic-bezier(.3,.7,.4,1); }
        .tgl.on::after { left:21px; }
        .tglrow { display:flex; align-items:center; justify-content:space-between; gap:12px; }
        .tglrow .tt { font-size:13px; font-weight:600; color:var(--s-fg); } .tglrow .td { font-size:11.5px; color:var(--s-fg-mute); margin-top:1px; }
        .chips { display:flex; flex-wrap:wrap; gap:6px; padding:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; }
        .chips:focus-within { border-color:var(--s-green); }
        .chip2 { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:500; padding:4px 6px 4px 10px; border-radius:7px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .chip2 .x { width:15px; height:15px; border-radius:50%; display:flex; align-items:center; justify-content:center; cursor:pointer; opacity:.65; } .chip2 .x:hover { opacity:1; background:rgba(0,0,0,.08); } .chip2 .x svg { width:11px; height:11px; }
        .chips input { flex:1; min-width:70px; border:0; background:transparent; font:inherit; font-size:13px; color:var(--s-fg); outline:none; padding:4px; }
        .chip-neutral { background:var(--s-surface-3); color:var(--s-fg-soft); border-color:var(--s-line-2); }
        .visfield { padding-bottom:4px; }
        .visswitch { position:relative; display:grid; grid-template-columns:1fr 1fr; padding:4px; border-radius:7px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); margin-top:2px; }
  /* sow-323: the locked audience state, for an author who does not choose it (most of them). Same box as
     the switch so the rail does not jump when the control changes shape. */
  .vislocked { display:flex; align-items:center; gap:8px; padding:9px 12px; border:1px solid var(--line);
    border-radius:9px; background:var(--surface-2, var(--surface)); font-size:13.5px; }
  .vislocked svg { width:15px; height:15px; flex:none; color:var(--muted); }
        .visswitch .vs-thumb { position:absolute; top:4px; bottom:4px; left:4px; width:calc(50% - 4px); border-radius:7px; background:var(--s-surface); box-shadow:0 1px 3px rgba(0,0,0,.12); border:1.5px solid var(--s-line-2); transition:transform .18s cubic-bezier(.3,.7,.4,1); }
        .visswitch[data-active="members"] .vs-thumb { transform:translateX(calc(100% + 4px)); background:var(--s-tint); border-color:var(--s-tint-2); }
        .visswitch .vs-opt { position:relative; z-index:1; display:inline-flex; align-items:center; justify-content:center; gap:7px; padding:9px 6px; border:0; background:transparent; font:inherit; font-size:13.5px; font-weight:600; color:var(--s-fg-mute); cursor:pointer; white-space:nowrap; }
        .visswitch .vs-opt svg { width:16px; height:16px; } .visswitch .vs-opt.on { color:var(--s-fg); }
        .visswitch[data-active="members"] .vs-opt[data-vis="members"].on { color:var(--s-green-fg); }
        .stubwrap { margin-top:12px; padding-top:12px; border-top:1.5px dashed var(--s-line); } .stubwrap[hidden] { display:none; }
        .infobox { display:flex; gap:9px; margin-top:10px; padding:11px 13px; border-radius:7px; background:var(--s-tint); border:1.5px solid var(--s-tint-2); font-size:12.5px; line-height:1.55; color:var(--s-fg-soft); }
        .infobox svg { width:15px; height:15px; flex:none; margin-top:1px; color:var(--s-green-fg); } .infobox b { font-weight:700; color:var(--s-fg); }
        .statusrow { display:flex; align-items:center; gap:8px; }
        .dotpill { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; font-weight:600; padding:6px 12px; border-radius:999px; background:var(--s-tint); color:var(--s-green-fg); border:1.5px solid var(--s-tint-2); }
        .dotpill .d { width:7px; height:7px; border-radius:50%; background:var(--s-green); }
        .cover-field .ebtn { font-size:13px; padding:7px 12px; }
        /* SOW-062 P6: reframable cover preview (single 4:3-card / Hero frame + striped placeholder) */
        .cover { display:flex; flex-direction:column; gap:10px; margin:6px 0 4px; position:relative; }
        .framepick { display:inline-flex; gap:2px; padding:2px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:7px; align-self:flex-start; }
        .framepick button { font:inherit; font-size:11.5px; font-weight:600; padding:4px 10px; border:0; background:transparent; color:var(--s-fg-mute); border-radius:5px; cursor:pointer; }
        .framepick button.on { background:var(--s-surface); color:var(--s-fg); box-shadow:0 1px 2px rgba(0,0,0,.1); }
        .coverframe { border:1.5px solid var(--s-line-2); border-radius:8px; overflow:hidden; background:var(--s-surface-2); position:relative; }
        .coverframe.card4 { aspect-ratio:4/3; } .coverframe.hero { aspect-ratio:16/7; }
        .coverframe .ph { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:7px; color:var(--s-fg-mute); background-image:repeating-linear-gradient(45deg, var(--s-surface-3) 0 12px, transparent 12px 24px); }
        .coverframe .ph svg { width:26px; height:26px; opacity:.5; } .coverframe .ph .mono { font-family:var(--font-mono,monospace); font-size:11px; }
        .coverframe img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; display:block; }
        .coverbtns { display:flex; gap:8px; }
        /* sow-174: banner color-preset swatches, folded into the banner cover control (mutually exclusive
           with the image above it -- see doCoverImage/clearCover). */
        .swatch-or { font-size:11.5px; color:var(--s-fg-mute); text-align:center; margin:2px 0; }
        .swatchrow { display:flex; flex-wrap:wrap; gap:7px; }
        .swatch { display:inline-flex; align-items:center; gap:7px; font:inherit; font-size:12px; font-weight:600; color:var(--s-fg-soft); padding:6px 11px 6px 7px; border:1.5px solid var(--s-line-2); border-radius:999px; background:var(--s-surface); cursor:pointer; transition:border-color .15s,color .15s; }
        .swatch:hover { border-color:var(--s-fg-mute); color:var(--s-fg); }
        .swatch.on { border-color:var(--s-green); color:var(--s-fg); background:var(--s-tint); }
        .sw-dot { width:16px; height:16px; border-radius:50%; flex:none; box-shadow:inset 0 0 0 1px rgba(0,0,0,.08); }
        /* sow-174: gallery-layout picker (Auto / Grid / Carousel), illustrated cards instead of a <select>. */
        .gs-cards { display:flex; gap:10px; flex-wrap:wrap; }
        .gs-card { display:flex; flex-direction:column; align-items:flex-start; gap:8px; width:132px; padding:12px; border:1.5px solid var(--s-line-2); border-radius:9px; background:var(--s-surface); font:inherit; text-align:left; cursor:pointer; transition:border-color .15s,background .15s; }
        .gs-card:hover { border-color:var(--s-fg-mute); }
        .gs-card.on { border-color:var(--s-green); background:var(--s-tint); }
        .gs-shape { display:flex; align-items:center; gap:4px; width:100%; height:34px; }
        .gs-tile { flex:1; align-self:stretch; border-radius:4px; background:var(--s-surface-3); }
        .gs-frame { display:block; width:100%; height:22px; border-radius:4px; background:var(--s-surface-3); }
        .gs-strip { display:flex; gap:3px; width:100%; height:8px; margin-top:2px; }
        .gs-strip i { flex:1; border-radius:2px; background:var(--s-surface-3); font-style:normal; }
        .gs-name { font-size:12.5px; font-weight:700; color:var(--s-fg); }
        .gs-card.on .gs-name { color:var(--s-green-fg); }
        .gs-desc { font-size:11px; line-height:1.35; color:var(--s-fg-mute); }
        /* SOW-062 P6: project links[] row editor */
        .linkrows { display:flex; flex-direction:column; gap:9px; margin-bottom:8px; }
        .linkrow { display:flex; flex-direction:column; gap:8px; padding:10px; border:1.5px solid var(--s-line-2); border-radius:8px; background:var(--s-surface-2); }
        .linkrow .lr-top, .linkrow .lr-bot { display:flex; align-items:center; gap:8px; }
        .linkrow .lk-type { flex:none; width:118px; }
        .linkrow .lk-url, .linkrow .lk-label { flex:1; min-width:0; }
        .linkrow .inp { padding:7px 9px; font-size:12.5px; }
        .lr-del { flex:none; width:34px; height:34px; display:inline-flex; align-items:center; justify-content:center; border:1.5px solid var(--s-line-2); border-radius:7px; background:var(--s-surface); color:var(--s-fg-mute); cursor:pointer; }
        .lr-del:hover { color:#c0392b; border-color:#c0392b; } .lr-del svg { width:16px; height:16px; }
        .lr-vis { display:inline-flex; padding:2px; gap:2px; background:var(--s-surface); border:1.5px solid var(--s-line-2); border-radius:7px; flex:none; }
        .lr-vis button { font:inherit; font-size:10.5px; font-weight:600; padding:5px 9px; border:0; background:transparent; color:var(--s-fg-soft); border-radius:6px; cursor:pointer; }
        .lr-vis button.on { background:var(--s-fg); color:var(--s-canvas); }
        .addrow { font-size:13px; padding:8px 12px; align-self:flex-start; }
        /* sow-268 P3 + sow-165: the gallery action row (Upload / Reuse / Add by path) + the reuse picker popup. */
        .galactions { display:flex; flex-wrap:wrap; align-items:center; gap:8px; position:relative; }
        .galactions .ebtn { font-size:13px; padding:8px 12px; }
        .up-st { font-size:12px; color:var(--s-fg-mute); }
        /* sow-165: the reuse grid, anchored under the button that opened it (the .cover control or .galactions). */
        .media-pop { position:absolute; z-index:40; top:calc(100% + 6px); left:0; width:min(420px,92vw); max-height:320px; overflow:auto; padding:10px; border:1.5px solid var(--s-line-2); border-radius:10px; background:var(--s-surface); box-shadow:0 12px 30px -12px rgba(0,0,0,.35); }
        .media-load { padding:14px 6px; font-size:12.5px; color:var(--s-fg-mute); text-align:center; }
        .media-q { width:100%; box-sizing:border-box; padding:8px 10px; margin-bottom:8px; font:inherit; font-size:13px; border:1.5px solid var(--s-line-2); border-radius:7px; background:var(--s-surface-2); color:var(--s-fg); }
        .media-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(88px,1fr)); gap:8px; }
        .media-cell { display:flex; flex-direction:column; gap:4px; padding:6px; border:1.5px solid var(--s-line-2); border-radius:8px; background:var(--s-surface-2); cursor:pointer; font:inherit; text-align:left; }
        .media-cell:hover { border-color:var(--s-green); }
        .media-cell img { width:100%; aspect-ratio:1; object-fit:cover; border-radius:5px; background:var(--s-surface-3); display:block; }
        .media-cell span { font-size:10.5px; color:var(--s-fg-soft); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        /* sow-268: gallery rows. Same visual language as .linkrow, plus a thumbnail and up/down reorder. */
        .galrows { display:flex; flex-direction:column; gap:9px; margin-bottom:8px; }
        .galrow { display:flex; align-items:flex-start; gap:8px; padding:10px; border:1.5px solid var(--s-line-2); border-radius:8px; background:var(--s-surface-2); }
        .galrow .gr-thumb { flex:none; width:56px; height:42px; border-radius:6px; overflow:hidden; background:var(--s-surface); border:1.5px solid var(--s-line-2); display:flex; align-items:center; justify-content:center; }
        .galrow .gr-thumb img { width:100%; height:100%; object-fit:cover; }
        .galrow .gr-fields { flex:1; min-width:0; display:flex; flex-direction:column; gap:6px; }
        .galrow .gr-fields .inp { padding:7px 9px; font-size:12.5px; }
        .galrow .gr-ctl { flex:none; display:flex; align-items:center; gap:4px; }
        /* sow-268: the drag handle. It is a real <button> so it is tabbable and announced, and it carries the
           keyboard reorder (ArrowUp/ArrowDown) as well as the pointer drag, because the owner's choice of drag
           over up/down buttons removed the keyboard path that buttons gave for free. */
        .gr-grip { width:30px; height:30px; display:inline-flex; align-items:center; justify-content:center; border:1.5px solid var(--s-line-2); border-radius:7px; background:var(--s-surface); color:var(--s-fg-mute); cursor:grab; touch-action:none; }
        .gr-grip:hover { color:var(--s-fg); border-color:var(--s-fg-mute); }
        .gr-grip:active { cursor:grabbing; }
        .gr-grip:focus-visible { outline:2px solid var(--s-green); outline-offset:2px; color:var(--s-fg); }
        .gr-grip svg { width:15px; height:15px; fill:currentColor; }
        .galrow.dragging { opacity:.5; border-color:var(--s-green); }
        /* SOW-062 P6 rail-2 + sow-184: the stat tiles, now inside the Activity card (design 3a), 2-up per the mockup. */
        .rail-stats { display:grid; grid-template-columns:repeat(2,1fr); gap:8px; }
        .rstat { display:flex; flex-direction:column; align-items:center; gap:3px; padding:12px 6px; border:1.5px solid var(--s-line); border-radius:8px; background:var(--s-surface); }
        .rstat .rs-n { font-family:var(--font-display); font-weight:800; font-size:22px; line-height:1; color:var(--s-fg); }
        .rstat .rs-l { font-size:10.5px; font-weight:600; color:var(--s-fg-mute); text-align:center; line-height:1.25; }
        .rail-foot-note { font-size:11.5px; line-height:1.45; color:var(--s-fg-mute); margin-top:10px; text-align:center; }
        /* SOW-062 P6: markdown cheatsheet modal (ported from gbti-editor.css .mdRefModal onto the component tokens) */
        .mdRefModal { position:fixed; inset:0; z-index:1200; display:none; }
        .mdRefModal.show { display:block; }
        .mr-scrim { position:absolute; inset:0; background:rgba(15,14,18,.55); backdrop-filter:blur(3px); }
        .mr-panel { position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); width:min(680px, calc(100% - 36px)); max-height:calc(100% - 48px); display:flex; flex-direction:column; background:var(--s-surface); border:1.5px solid var(--s-line-2); border-radius:12px; box-shadow:var(--s-shadow-md); overflow:hidden; }
        .mr-head { display:flex; align-items:flex-start; gap:14px; padding:22px 24px 16px; border-bottom:1.5px solid var(--s-line); }
        .mr-head > div { flex:1; }
        .mr-head h3 { font-family:var(--font-display); font-weight:800; font-size:21px; letter-spacing:-.01em; color:var(--s-fg); }
        .mr-head p { font-size:13px; color:var(--s-fg-mute); margin-top:5px; line-height:1.5; }
        .mm-x { width:36px; height:36px; flex:none; border-radius:8px; border:1.5px solid var(--s-line-2); background:var(--s-surface); color:var(--s-fg-soft); cursor:pointer; display:flex; align-items:center; justify-content:center; }
        .mm-x:hover { background:var(--s-surface-2); } .mm-x svg { width:18px; height:18px; }
        .mr-scroll { overflow-y:auto; padding:18px 24px 24px; }
        .mr-blurb { font-size:13px; color:var(--s-fg-mute); line-height:1.55; margin-bottom:14px; }
        .mr-legend { padding:14px 16px; border-radius:8px; background:var(--s-surface-2); border:1.5px solid var(--s-line); margin-bottom:18px; }
        .mr-legend > b { font-size:12px; font-weight:700; color:var(--s-fg); }
        .mr-leg-grid { display:grid; grid-template-columns:auto 1fr; gap:6px 14px; margin-top:10px; align-items:center; }
        .mr-leg-grid code { font-family:var(--font-mono,monospace); font-size:12px; color:var(--s-green-fg); white-space:pre; }
        .mr-leg-grid span { font-size:12.5px; color:var(--s-fg-mute); }
        .mr-code { font-family:var(--font-mono,monospace); font-size:12.5px; line-height:1.7; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line); border-radius:8px; padding:15px 16px; overflow-x:auto; white-space:pre; tab-size:2; margin:0; }
        /* SOW-062 P6: Visual / Markdown doc-view toggle + the read-only full-document markdown panel */
        .doc-view-row { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin:0 0 26px; }
        .doc-view { display:inline-flex; gap:3px; padding:4px; border-radius:8px; background:var(--s-surface-2); border:1.5px solid var(--s-line-2); }
        .dv-cheat { padding:6px 12px; font-size:12.5px; }
        .ebtn[hidden] { display:none; } /* [hidden] must beat .ebtn's display:inline-flex (cheatsheet + publish) */
        /* SOW-062 P6: the publish-expectation banner above the toolbar */
        .pubinfo { display:flex; align-items:flex-start; gap:9px; padding:11px 14px; margin:0 2px 12px; border-radius:10px; background:var(--s-tint); border:1.5px solid var(--s-tint-2); font-size:12.5px; line-height:1.5; color:var(--s-fg-soft); }
        .pubinfo[hidden] { display:none; } /* the hidden attribute must win over display:flex (an empty strip showed otherwise) */
        .pubinfo svg { width:16px; height:16px; flex:none; margin-top:1px; color:var(--s-green-fg); } .pubinfo b { color:var(--s-fg); font-weight:700; }
        .pubinfo.warn { background:color-mix(in srgb, var(--s-amber, #d9a13c) 12%, transparent); border-color:var(--s-amber, #d9a13c); }
        .pubinfo.warn svg { color:var(--s-amber, #d9a13c); }
        .pubinfo.danger { background:color-mix(in srgb, var(--s-danger, #e06c6c) 12%, transparent); border-color:var(--s-danger, #e06c6c); }
        .pubinfo.danger svg { color:var(--s-danger, #e06c6c); }
        /* sow-327: the banner becomes a column (text, then the answer) while keeping its icon at the left. */
        .pubinfo .pi-body { flex:1; min-width:0; }
        .pi-link { font:inherit; font-weight:700; color:var(--s-fg); background:none; border:0; padding:0; text-decoration:underline; text-underline-offset:2px; cursor:pointer; }
        .pi-link:hover { color:var(--s-green-fg); }
        .chg { margin-top:9px; border-top:1px solid var(--s-tint-2); padding-top:9px; }
        .chg[hidden] { display:none; }
        .chg ol { margin:0; padding-left:20px; }
        .chg li { margin:0 0 9px; }
        .chg li:last-child { margin-bottom:0; }
        .chg .chg-h { font-weight:700; color:var(--s-fg); }
        .chg .chg-jump { font:inherit; font-weight:700; color:var(--s-fg); background:none; border:0; padding:0; text-decoration:underline; text-underline-offset:2px; cursor:pointer; }
        .chg .chg-jump:hover { color:var(--s-green-fg); }
        .chg .chg-v { display:block; margin-top:2px; color:var(--s-fg-soft); overflow-wrap:anywhere; }
        .chg .chg-v i { font-style:normal; color:var(--s-fg-mute); }
        .chg .chg-msg { margin:0; color:var(--s-fg-soft); }
        .doc-slug .meta-local { color:var(--s-fg-mute); }
        .doc-view button { display:inline-flex; align-items:center; gap:7px; padding:7px 15px; border:0; border-radius:7px; background:transparent; font:inherit; font-size:13px; font-weight:600; color:var(--s-fg-mute); cursor:pointer; white-space:nowrap; transition:color .14s ease; }
        .doc-view button svg { width:15px; height:15px; }
        .doc-view button.on { background:var(--s-surface); color:var(--s-fg); box-shadow:0 1px 3px rgba(0,0,0,.12); border:1.5px solid var(--s-line-2); padding:5.5px 13.5px; }
        .doc.md-view > .doc-title, .doc.md-view > .doc-slug, .doc.md-view > .docsec { display:none; }
        .docmd-wrap { border:1.5px solid var(--s-line-2); border-radius:8px; overflow:hidden; background:var(--s-surface); }
        .docmd-wrap[hidden] { display:none; }
        .docmd-bar { display:flex; align-items:center; gap:8px; padding:11px 15px; border-bottom:1.5px solid var(--s-line); background:var(--s-surface-2); font-size:13px; font-weight:600; color:var(--s-fg-soft); }
        .docmd-bar svg { width:15px; height:15px; color:var(--s-green-fg); }
        .docmd-note { margin-left:auto; font-family:var(--font-mono,monospace); font-size:11px; font-weight:500; color:var(--s-fg-mute); }
        .docmd { display:block; width:100%; box-sizing:border-box; border:0; resize:vertical; min-height:60vh; padding:20px 22px; font-family:var(--font-mono,monospace); font-size:13px; line-height:1.7; color:var(--s-fg); background:var(--s-surface); outline:none; white-space:pre; tab-size:2; }
        /* SOW-062 P6: the document-canvas sections (Video, From-the-author, Discussion) below the body */
        .docsec-h .dsub { text-transform:none; letter-spacing:0; font-weight:500; color:var(--s-fg-mute); }
        #secVideo .inp { width:100%; box-sizing:border-box; }
        .authornote { display:flex; gap:12px; align-items:flex-start; }
        .an-av { position:relative; overflow:hidden; display:block; flex:none; width:34px; height:34px; border-radius:50%; background:var(--hover); }
        .an-text { flex:1; min-width:0; font:inherit; font-size:14px; line-height:1.55; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:9px; padding:11px 13px; outline:none; resize:vertical; min-height:70px; box-sizing:border-box; }
        .an-text:focus { border-color:var(--s-green); background:var(--s-surface); }
        #secDiscussion gbti-discussion { display:block; margin-top:2px; }
        button.rstat-link { font:inherit; background:none; border:none; padding:0; cursor:pointer; text-align:inherit; }
        button.rstat-link:hover .rs-n, button.rstat-link:hover .rs-l { color:var(--s-green-fg); }
      `;
