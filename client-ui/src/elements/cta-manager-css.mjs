// sow-337: the stylesheet of <gbti-cta-manager>, copied from the approved design (the Manager artboard) with every
// rule scoped under .mgr. The scope is not decoration: BASE_CSS (tokens.mjs) styles bare button, label, input and
// textarea for every component, and `button:hover` would otherwise out-rank a single class and paint every ghost
// button green on hover. The design's extra colours (tint, warning, the popover shadow, the danger wash) are added to
// the host palette here with their dark values, following the site's data-theme the way TOKENS does.
export const CTA_MANAGER_CSS = `
:host { display:block; --tint:#e9f6ef; --btn-fg:#ffffff; --warn:#8a5500; --danger-bg:rgba(192,57,43,.06); --danger-line:rgba(192,57,43,.32);
  --pop:0 12px 30px rgba(37,35,43,.10), 0 3px 8px rgba(37,35,43,.06); }
:host-context([data-theme="dark"]) { --tint:rgba(31,158,95,.13); --btn-fg:#08231a; --warn:#e6b45c; --danger-bg:rgba(224,108,108,.10);
  --danger-line:rgba(224,108,108,.40); --pop:0 18px 50px rgba(0,0,0,.55), 0 4px 12px rgba(0,0,0,.4); }
[hidden] { display:none !important; }
.mgr { color:var(--fg); font:15px/1.5 var(--font-body); container-type:inline-size; box-sizing:border-box; }
.mgr label { margin:0; font-size:inherit; }
.mgr button { font-weight:inherit; }
.mgr .c { border-bottom:0; }
.mgr .pv-card { flex:none; width:320px; max-width:100%; background:var(--paper); border:1.5px solid var(--line); border-radius:12px; box-shadow:0 1px 2px rgba(37,35,43,.06), 0 1px 1px rgba(37,35,43,.04); padding:22px; overflow:hidden; color:var(--fg); font-family:var(--font-body); text-align:left; --pcta-pad:22px; --pcta-top-radius:0; }
.mgr .pv-card.phone { width:358px; max-width:none; }
.mgr .pv-card.io { padding:0; }
/* The design drew a handful of set chips; the real library has 31 sets, so the chip area holds two rows and scrolls. */
.mgr .imgwork { font-size:12.5px; color:var(--muted); margin-top:6px; }
.mgr .ed-form { min-width:0; }
.mgr *, .mgr *::before, .mgr *::after { box-sizing: border-box; }
.mgr p { margin: 0; }
.mgr .mono { font-family: 'JetBrains Mono', ui-monospace, monospace; }
.mgr .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; }
.mgr .hint { font-size: 12.5px; color: var(--muted); max-width: 620px; }
.mgr .msg { font-size: 13px; color: var(--accent); margin: 0 0 12px; }
.mgr .msg.bad { color: var(--danger); }
.mgr .btn { flex: none; border: 1px solid var(--accent); background: var(--accent); color: var(--btn-fg); border-radius: 7px; font: inherit; font-weight: 700; font-size: 13px; line-height: 1.4; padding: 7px 14px; cursor: pointer; }
.mgr .btn[disabled] { opacity: .6; cursor: default; }
.mgr .lk { flex: none; border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 7px; font: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.4; padding: 5px 11px; cursor: pointer; display: inline-flex; align-items: center; gap: 6px; }
.mgr .lk:hover { border-color: var(--accent); color: var(--accent); }
.mgr .lk.danger:hover { border-color: var(--danger); color: var(--danger); }
.mgr .badge { font-size: 11px; font-weight: 700; letter-spacing: .02em; text-transform: uppercase; border-radius: 999px; padding: 2px 8px; border: 1px solid var(--line); color: var(--muted); white-space: nowrap; }
.mgr .badge.on { color: var(--accent); border-color: var(--accent); }

.mgr .list { list-style: none; margin: 0; padding: 0; }
.mgr .c { display: grid; grid-template-columns: 112px minmax(0, 1fr) auto; gap: 18px; align-items: center; border-top: 1px solid var(--line); padding: 14px 2px; }
.mgr .c:first-child { border-top: 0; }
.mgr .c.off .meta, .mgr .c.off .thumb { opacity: .6; }
.mgr .thumb { width: 112px; height: 132px; overflow: hidden; border-radius: 8px; background: var(--bg); border: 1px solid var(--line); position: relative; }
.mgr .thumb-in { position: absolute; left: 6px; top: 6px; width: 320px; transform: scale(.3125); transform-origin: top left; }
.mgr .top { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mgr .label { font-size: 14.5px; font-weight: 700; color: var(--fg); }
.mgr .line { margin-top: 5px !important; font-size: 13.5px; color: var(--fg); }
.mgr .sub { margin-top: 4px !important; font-size: 12px; color: var(--muted); }
.mgr .acts-r { display: flex; gap: 6px; flex-wrap: wrap; justify-content: flex-end; }

.mgr .ed-head { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; margin: 0 0 6px; }
.mgr .ed-title { margin: 0; font: 700 20px/1.2 var(--font-display); }
.mgr .ed-head .acts-r { margin-left: auto; }
.mgr .ed-grid { display: grid; grid-template-columns: minmax(0, 1fr) 392px; gap: 28px; align-items: start; margin-top: 10px; }
.mgr .sec { border-top: 1px solid var(--line); padding: 18px 0; }
.mgr .sec:first-child { border-top: 0; padding-top: 6px; }
.mgr .sec-h { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; margin: 0 0 12px; }
.mgr .sec-h h4 { margin: 0; font-size: 12.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.mgr .sec-h .hint { font-size: 12px; }

.mgr .tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.mgr .tile { display: flex; flex-direction: column; gap: 8px; text-align: left; padding: 10px; border: 1.5px solid var(--line); border-radius: 9px; background: transparent; color: var(--fg); font: inherit; cursor: pointer; }
.mgr .tile:hover { border-color: var(--accent); }
.mgr .tile.on { border-color: var(--accent); box-shadow: 0 0 0 3px var(--tint); }
.mgr .sk { height: 84px; border-radius: 6px; background: var(--bg); border: 1px solid var(--line); padding: 8px 9px; display: flex; flex-direction: column; gap: 4px; overflow: hidden; }
.mgr .sk .ey { height: 4px; width: 46%; border-radius: 2px; background: var(--brand); flex: none; }
.mgr .sk .ln { height: 4px; width: 88%; border-radius: 2px; background: var(--muted); opacity: .32; flex: none; }
.mgr .sk .ln.s { width: 60%; }
.mgr .sk .im { flex: 1; min-height: 14px; border-radius: 3px; background: var(--tint); display: flex; justify-content: center; align-items: center; }
.mgr .sk .im i { display: block; width: 14px; height: 80%; border-radius: 1px; background: var(--brand); opacity: .55; }
.mgr .sk .bt { height: 10px; width: 58%; border-radius: 3px; border: 1.5px solid var(--muted); opacity: .55; flex: none; }
.mgr .sk .top-im { margin: -8px -9px 2px; border-radius: 0; flex: 1; }
.mgr .sk .row { display: flex; gap: 6px; flex: none; }
.mgr .sk .row .im { flex: none; width: 18px; height: 28px; }
.mgr .sk .row .col { flex: 1; display: flex; flex-direction: column; gap: 4px; padding-top: 2px; }
.mgr .sk .code { flex: 1; border-radius: 3px; border: 1.5px dashed var(--muted); opacity: .5; display: flex; align-items: center; justify-content: center; font: 600 10px/1 'JetBrains Mono', ui-monospace, monospace; color: var(--fg); }
.mgr .sk.io { padding: 0; gap: 0; }
.mgr .sk.io .im { border-radius: 0; flex: none; height: 70px; }
.mgr .sk.io .im i { height: 48px; }
.mgr .sk.io .ft { height: 13px; border-top: 1px solid var(--line); flex: none; background: var(--panel); }
.mgr .tile-n { font-size: 13px; font-weight: 700; line-height: 1.2; }
.mgr .tile-d { font-size: 11.5px; color: var(--muted); line-height: 1.3; margin-top: 2px !important; }

.mgr .form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 14px; }
.mgr .fld { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); min-width: 0; }
.mgr .fld.wide { grid-column: 1 / -1; }
.mgr .fld input, .mgr .fld textarea, .mgr .srch input, .mgr .hostadd input { font: inherit; font-size: 13.5px; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 7px; padding: 6px 9px; min-width: 0; width: 100%; }
.mgr .fld input:focus, .mgr .fld textarea:focus, .mgr .srch input:focus, .mgr .hostadd input:focus { outline: none; border-color: var(--brand); }
.mgr .fld textarea { resize: vertical; min-height: 58px; line-height: 1.45; }
.mgr .fld.err input, .mgr .fld.err textarea { border-color: var(--danger); }
.mgr .et { font-size: 12px; color: var(--danger); line-height: 1.4; }
.mgr .wt { font-size: 12px; color: var(--warn); line-height: 1.4; }
.mgr .check { display: flex; align-items: center; gap: 8px; font-size: 13.5px; color: var(--fg); cursor: pointer; }
.mgr .check input { width: 16px; height: 16px; accent-color: var(--brand); margin: 0; }
.mgr .fld.check { flex-direction: row; align-items: center; gap: 8px; font-size: 13.5px; color: var(--fg); }
.mgr .fld.check input { width: 16px; flex: none; padding: 0; }

.mgr .drop { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1.5px dashed var(--line); border-radius: 9px; }
.mgr .drop.on { border-color: var(--accent); background: var(--tint); }
.mgr .drop.err { border-color: var(--danger); }
.mgr .drop-ic { flex: none; width: 40px; height: 40px; border-radius: 10px; background: var(--tint); color: var(--accent); display: grid; place-items: center; }
.mgr .drop-ic svg { width: 20px; height: 20px; }
.mgr .drop-t { font-size: 13.5px; font-weight: 600; }
.mgr .imgrow { display: flex; align-items: center; gap: 14px; padding: 12px; border: 1px solid var(--line); border-radius: 9px; }
.mgr .imgrow img { flex: none; width: 52px; height: auto; max-height: 86px; object-fit: contain; border-radius: 3px; box-shadow: 0 3px 10px rgba(20,18,24,.2); }
.mgr .imgmeta { min-width: 0; flex: 1; }
.mgr .imgname { font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
.mgr .imginfo { font-size: 12px; color: var(--muted); margin-top: 2px !important; display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.mgr .shield { display: inline-flex; align-items: center; gap: 4px; color: var(--accent); font-weight: 600; }
.mgr .shield svg { width: 13px; height: 13px; }
.mgr .pick-file { position: relative; overflow: hidden; }
.mgr .pick-file input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }

.mgr .ip-trig { display: flex; align-items: center; gap: 10px; width: 100%; max-width: 440px; padding: 7px 10px; border: 1px solid var(--line); border-radius: 7px; background: transparent; color: var(--fg); font: inherit; font-size: 13.5px; cursor: pointer; text-align: left; }
.mgr .ip-trig:hover, .mgr .ip-trig.open { border-color: var(--brand); }
.mgr .ip-sw { flex: none; width: 30px; height: 30px; border-radius: 7px; background: var(--bg); border: 1px solid var(--line); display: grid; place-items: center; }
.mgr .ip-sw svg { width: 16px; height: 16px; }
.mgr .ip-name { flex: 1; min-width: 0; }
.mgr .ip-name b { font-weight: 600; }
.mgr .ip-name span { display: block; font-size: 11.5px; color: var(--muted); }
.mgr .chev { width: 16px; height: 16px; color: var(--muted); flex: none; }
.mgr .ip-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.mgr .ip-pop { margin-top: 8px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); box-shadow: var(--pop); padding: 12px; max-width: 600px; }
.mgr .srch { position: relative; }
.mgr .srch svg { position: absolute; left: 10px; top: 50%; width: 15px; height: 15px; transform: translateY(-50%); color: var(--muted); }
.mgr .srch input { padding-left: 32px; }
.mgr .chips { display: flex; gap: 6px; flex-wrap: wrap; margin: 10px 0 8px; max-height: 60px; overflow-y: auto; padding: 1px 2px; }
.mgr .chip { border: 1px solid var(--line); background: transparent; color: var(--fg); border-radius: 999px; font: inherit; font-size: 12px; font-weight: 600; padding: 3px 10px; cursor: pointer; }
.mgr .chip:hover { border-color: var(--accent); }
.mgr .chip.on { background: var(--accent); border-color: var(--accent); color: var(--btn-fg); }
.mgr .ip-count { font-size: 12px; color: var(--muted); margin: 0 0 8px !important; }
.mgr .ip-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(92px, 1fr)); gap: 6px; max-height: 248px; overflow: auto; padding: 2px; }
.mgr .ic-cell { display: flex; flex-direction: column; align-items: center; gap: 6px; padding: 10px 4px 8px; border: 1px solid var(--line); border-radius: 8px; background: transparent; color: var(--fg); font: inherit; cursor: pointer; min-width: 0; }
.mgr .ic-cell:hover { border-color: var(--accent); }
.mgr .ic-cell.on { border-color: var(--accent); background: var(--tint); }
.mgr .ic-cell svg { width: 22px; height: 22px; }
.mgr .ic-cell span { font: 500 10px/1.2 'JetBrains Mono', ui-monospace, monospace; color: var(--muted); max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.mgr textarea.code { font: 12.5px/1.55 'JetBrains Mono', ui-monospace, monospace !important; min-height: 150px !important; background: var(--bg) !important; white-space: pre; }
.mgr .warnbox { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--danger-line); background: var(--danger-bg); border-radius: 9px; font-size: 13px; line-height: 1.45; }
.mgr .warnbox svg { flex: none; width: 18px; height: 18px; color: var(--danger); margin-top: 1px; }
.mgr .warnbox b { font-weight: 700; }
.mgr .hosts { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.mgr .host { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 10px; border: 1px solid var(--line); border-radius: 7px; font-size: 12.5px; }
.mgr .host .mono { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.mgr .hostadd { display: flex; gap: 6px; margin-top: 8px; }
.mgr .found { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12px; color: var(--muted); margin-top: 8px; }
.mgr .found .mono { color: var(--fg); }

.mgr .items { list-style: none; margin: 0 0 10px; padding: 0; }
.mgr .it { display: flex; align-items: center; gap: 10px; padding: 7px 0; border-top: 1px solid var(--line); font-size: 13.5px; }
.mgr .it:first-child { border-top: 0; }
.mgr .ty { flex: none; font: 500 11px/1 'JetBrains Mono', ui-monospace, monospace; color: var(--muted); text-transform: uppercase; letter-spacing: .06em; width: 62px; }
.mgr .it .t { flex: 1; min-width: 0; color: var(--accent); overflow-wrap: anywhere; }
.mgr .results { list-style: none; margin: 6px 0 0; padding: 4px; border: 1px solid var(--line); border-radius: 9px; background: var(--panel); box-shadow: var(--pop); }
.mgr .res { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--fg); font: inherit; font-size: 13.5px; text-align: left; cursor: pointer; }
.mgr .res:hover { background: var(--hover); }
.mgr .res .add { margin-left: auto; font-size: 12px; font-weight: 700; color: var(--accent); }
.mgr .empty { font-size: 13px; color: var(--muted); padding: 6px 0; }

.mgr .ed-prev { position: sticky; top: 16px; border: 1px solid var(--line); border-radius: 12px; overflow: hidden; }
.mgr .pv-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 12px; border-bottom: 1px solid var(--line); background: var(--panel); }
.mgr .pv-bar h4 { margin: 0 auto 0 0; font-size: 12.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); }
.mgr .segs { display: inline-flex; border: 1px solid var(--line); border-radius: 7px; overflow: hidden; }
.mgr .seg { border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; font-weight: 600; padding: 4px 10px; cursor: pointer; }
.mgr .seg + .seg { border-left: 1px solid var(--line); }
.mgr .seg.on { background: var(--accent); color: var(--btn-fg); }
.mgr .pv-stage { padding: 22px; display: flex; justify-content: safe center; overflow-x: auto; background: #faf9f8; }
.mgr .pv-stage.dk { background: #1c1a21; }
.mgr .pv-note { padding: 10px 12px; font-size: 12px; color: var(--muted); border-top: 1px solid var(--line); background: var(--panel); }

@container (max-width: 760px) {
.mgr .ed-grid { grid-template-columns: minmax(0, 1fr); gap: 18px; }
.mgr .ed-prev { position: static; order: -1; }
.mgr .pv-stage { overflow-x: auto; justify-content: flex-start; }
.mgr .tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.mgr .form { grid-template-columns: minmax(0, 1fr); }
.mgr .c { grid-template-columns: 76px minmax(0, 1fr); gap: 12px; align-items: start; }
.mgr .c .acts-r { grid-column: 1 / -1; justify-content: flex-start; }
.mgr .thumb { width: 76px; height: 92px; }
.mgr .thumb-in { transform: scale(.2125); left: 4px; top: 4px; }
.mgr .ed-head .acts-r { margin-left: 0; width: 100%; }
.mgr .imgrow { flex-wrap: wrap; }
.mgr .imgrow .acts-r { width: 100%; justify-content: flex-start; }
.mgr .drop { flex-wrap: wrap; }
}
`;
