// The stylesheet of <gbti-workspace>, in its own module because the element crossed the 900-line limit (owner,
// 2026-09-30). Moved verbatim from gbti-workspace.mjs, which imports it as CSS.
export const WORKSPACE_CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); container-type:inline-size; } /* sow-168: the phone rules below are container queries */
  .tabs { display:flex; gap:4px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius:var(--radius); padding:4px; margin:0 0 16px; flex-wrap:wrap; } /* sow-163: the homepage radius (was the SOW-052 squared 2px) aesthetic: 2px nav bar */
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:8px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .tbadge { display:inline-block; min-width:16px; margin-left:6px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:11px; font-weight:800; line-height:16px; text-align:center; vertical-align:text-top; }
  .profile { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:var(--radius); padding:11px 14px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); font-size:14px; }
  .profile .lbl { color:var(--muted); font-size:12px; }
  .profile button { margin-left:auto; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { flex:1; min-width:0; overflow:hidden; }
  .row .gl { flex:none; width:34px; height:34px; border-radius:9px; display:grid; place-items:center; color:var(--ka, var(--accent)); background:color-mix(in srgb, var(--ka, var(--accent)) 12%, transparent); }
  .row .gl svg { width:19px; height:19px; }
  .row .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12.5px; }
  /* sow-221: the event time sits in the meta line, dimmer than the #N link so the link still leads. */
  .row .t .meta .when { opacity:.85; }
  .row .t .meta .when::before { content:"·"; margin:0 6px; opacity:.6; }
  .row .t .why { display:block; margin-top:3px; color:var(--danger); font-size:12px; line-height:1.35; white-space:normal; } /* SOW-072 P2: the rejection reason, never silent */
  .row .t .why[hidden] { display:none; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--hover); font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.bad { background:rgba(224,108,108,.16); color:var(--danger); }
  .btn { flex:none; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .right { display:flex; align-items:center; gap:8px; flex:none; }
  .pager { display:flex; align-items:center; justify-content:center; gap:14px; margin:16px 0 2px; }
  .pager-n { font-size:12.5px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .btn[disabled] { opacity:.42; cursor:default; }
  .btn[disabled]:hover { border-color:var(--line); color:var(--fg); }
  /* SOW-085: the content-list controls bar (status filter + sort) */
  .lc-bar { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; margin:0 0 10px; }
  .lc-filter { display:inline-flex; gap:2px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:3px; }
  .lc-f { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:600; font-size:12.5px; padding:5px 12px; border-radius:6px; cursor:pointer; }
  .lc-f.on { background:var(--hover); color:var(--accent); }
  /* SOW-145: the superadmin content-scope switch (My content / Network content). sow-195 repointed the
     second scope from the old house/ folder to members/gbtilabs/, so the label names the network, not a folder. */
  .lc-scopes { display:inline-flex; gap:2px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:3px; margin-right:auto; }
  .lc-scope { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:600; font-size:12.5px; padding:5px 12px; border-radius:6px; cursor:pointer; }
  .lc-scope.on { background:var(--accent); color:#fff; }
  .lc-sort { display:inline-flex; align-items:center; gap:7px; font-size:12.5px; color:var(--muted); }
  .lc-sort .lc-sl { font-weight:600; }
  .lc-sort select { font:inherit; font-size:12.5px; color:var(--fg); background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:5px 9px; cursor:pointer; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:18px 2px; }
  .back { margin:0 0 14px; }
  a { color:var(--accent); }
  /* SOW-052: the Overview hub */
  .ov-hero { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border:1px solid var(--line); border-radius:var(--radius); padding:14px 16px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); margin:0 0 16px; }
  .ov-hero b { font-size:15px; }
  .ov-hero .muted { font-size:12.5px; }
  .ov-draft { font-size:12.5px; color:var(--accent); font-weight:700; }
  .ov-trial { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; border:1px solid var(--accent); border-radius:var(--radius); padding:13px 16px; background:color-mix(in srgb, var(--accent) 9%, var(--panel)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); margin:0 0 16px; }
  .ov-trial b { font-size:13.5px; }
  .ov-trial span { font-size:12.5px; color:var(--muted); }
  .ov-trial .ov-up { flex:none; font-weight:700; font-size:12.5px; padding:7px 14px; border-radius:8px; background:var(--accent); color:#fff; text-decoration:none; white-space:nowrap; }
  .ov-trial .ov-up:hover { filter:brightness(1.05); }
  .ov-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px; margin:0 0 22px; }
  .ov-tile { display:flex; flex-direction:column; gap:4px; border:1px solid var(--line); border-radius:var(--radius); padding:14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); text-decoration:none; color:var(--fg); transition:border-color .14s, transform .14s; }
  .ov-tile:hover { border-color:var(--accent); transform:translateY(-2px); }
  .ov-n { font-weight:800; font-size:22px; line-height:1; color:var(--accent); min-height:16px; }
  .ov-nm { font-weight:600; font-size:13.5px; color:var(--fg); }
  .ov-h3 { font-weight:700; font-size:15px; margin:0 0 10px; }
  .ov-att { list-style:none; margin:0; padding:0; }
  .ov-att li { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .ov-att li:first-child { border-top:0; }
  /* sow-168: the phone layout. Below 560px of inline size (the website hands this element about 350px at a
     390px viewport) a one-line row starves the title: the owner's screenshot read "R.." nine times while the
     pills and both buttons kept their full width. So the row reflows to two lines, title and meta first, then
     the pills and buttons, every control still visible and Unpublish still its own deliberate press. The
     title may wrap to a second line before it clips. The tab strip becomes one row that scrolls sideways
     instead of wrapping to three ragged lines (render() brings the active tab into view), and the list
     controls stack their two groups. A container query rather than a media query, so the same rules hold in
     a narrow website column and never fire in a wide extension tab. */
  @container (max-width: 560px) {
    .tabs { flex-wrap:nowrap; overflow-x:auto; scrollbar-width:thin; -webkit-overflow-scrolling:touch; }
    .tab { flex:none; }
    .row { flex-wrap:wrap; row-gap:8px; }
    .row .t { flex:1 1 60%; }
    .row .t b { white-space:normal; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; line-height:1.3; }
    .row .right { flex:1 1 100%; justify-content:flex-start; flex-wrap:wrap; }
    .row .gl ~ .right { padding-left:44px; } /* under the title, not under the glyph */
    .row .btn { padding:5px 10px; font-size:12.5px; }
    .lc-bar { gap:8px; }
    .lc-scopes { width:100%; margin-right:0; }
    .lc-sort { margin-left:auto; }
  }
  /* sow-163: from 880px of the element's own inline size the tab strip becomes a LEFT RAIL beside the content
     pane (the owner's 2026-07-29 ask; both hosts, by the 2026-09-08 decision). Same buttons, same data-tab, same
     #tab= deep links and badge counts: this is layout only, so routing, the sow-104 editor exit and the phone
     reveal are untouched. Below 880px the horizontal strip stays, and under 560px the phone rules above apply.
     Last in the template on purpose: a container rule adds no specificity, so it must follow the strip rules. */
  .wb { min-width:0; }
  @container (min-width: 880px) {
    .wb { display:grid; grid-template-columns:200px minmax(0,1fr); gap:26px; align-items:start; }
    .tabs { flex-direction:column; align-items:stretch; gap:2px; margin:0; padding:6px; }
    .tab { display:flex; align-items:center; justify-content:space-between; text-align:left; padding:9px 12px; }
    .tab .tbadge { margin-left:10px; }
  }
`;
