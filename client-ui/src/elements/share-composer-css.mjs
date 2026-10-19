// The stylesheet of <gbti-share-composer>, in its own module because the component reached the 900-line cap
// (2026-10-19, when the "Leave a public stub" option was added). Moved verbatim from gbti-share-composer.mjs; the
// stub option's rules at the end are the only addition.
export const SHARE_COMPOSER_CSS = `
  /* sow-304: edit-mode controls */
  .rmlink { margin-left: 8px; flex: none; font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius:var(--sc-r); border: 1px solid var(--line, #ddd); background: transparent; color: inherit; cursor: pointer; }
  .rmlink[hidden], .unpub[hidden], .editnote[hidden], .audnote[hidden], .catnote[hidden] { display: none; }
  .catnote button, .catnote button:hover { font: inherit; padding: 0; border: 0; background: none; color: var(--brand); text-decoration: underline; cursor: pointer; width: auto; }
  .unpub { font: inherit; font-size: 12.5px; padding: 6px 10px; border-radius:var(--sc-r); border: 1px solid var(--line, #ddd); background: transparent; color: var(--fg-mute, #666); cursor: pointer; margin-right: auto; }
  input[type=url][readonly] { opacity: .75; }

  /* sow-395 (owner, 2026-09-24): the share dialog is square-cornered. Every corner in it is this one 2px value;
     only the round things stay round (the step numbers and the posting spinner). */
  :host { --sc-r: 2px; display:block; font-family:var(--font-body); color:var(--fg); }
  /* The shared BASE_CSS gives every bare button and field 8px corners, and a control without a rule of its own
     here (the step tabs, the tags field, the category note's button) kept them. Same specificity, later in the
     sheet, so this wins; the class rules below all use the same value. */
  button, input, select, textarea { border-radius:var(--sc-r); }
  .card { background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius:var(--sc-r); padding:16px; }
  h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sub { margin:0 0 12px; font-size:13px; color:var(--muted); }
  textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; font:inherit; font-size:14px;
    padding:10px 12px; border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--fg); }
  textarea:focus { outline:none; border-color:var(--brand); }
  input.title, input.desc { width:100%; box-sizing:border-box; font:inherit; padding:9px 12px; margin-bottom:8px;
    border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--fg); }
  input.title { font-size:15px; font-weight:700; }
  input.desc { font-size:13px; }
  input.title:focus, input.desc:focus { outline:none; border-color:var(--brand); }
  .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
  input[type=url] { flex:1; min-width:160px; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px;
    border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--fg); }
  select { font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--fg); }
  .actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:12px; }
  button.post { display:inline-flex; align-items:center; gap:8px; font:inherit; font-weight:700; font-size:14px; padding:9px 18px; border:0; border-radius:var(--sc-r); background:var(--brand); color:#fff; cursor:pointer; }
  button.post[disabled] { opacity:.6; cursor:default; }
  /* SOW-092: the progressing ring shown inside the Post button while postShare runs. */
  .post .spin, .edit-loading .spin { display:inline-block; width:13px; height:13px; border:2px solid currentColor; border-right-color:transparent; border-radius:50%; animation:sc-spin .7s linear infinite; }
  @keyframes sc-spin { to { transform:rotate(360deg); } }
  .wizard { position:relative; } .wizard .edit-loading { display:none; } .wizard.loading > :not(.edit-loading) { visibility:hidden; }
  .wizard.loading .edit-loading { display:flex; position:absolute; inset:0; align-items:center; justify-content:center; gap:10px; margin:0; color:var(--muted); }
  .msg { font-size:13px; }
  .msg.err { color:#c0392b; }
  .msg.ok { color:var(--brand); }
  .notice { display:flex; gap:12px; align-items:flex-start; padding:16px; border:1.5px dashed var(--line); border-radius:var(--sc-r); background:var(--hover, rgba(0,0,0,.03)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .notice h3 { margin-bottom:2px; }
  .notice a { color:var(--brand); font-weight:600; }
  .lock { font-size:22px; line-height:1; }
  .busy { opacity:.55; pointer-events:none; }
  .og { margin-top:10px; }
  .og .ogmsg { font-size:12.5px; color:var(--muted); }
  /* sow-211: a FAILED preview reads as a failure, not as a quiet absence. Same red as .msg.err above, so the
     composer has one error colour rather than two. A reached-but-empty page stays muted: it is not an error. */
  .og .ogmsg.err { color:#c0392b; }
  /* SOW-102: the rich link-preview card (image + title + description + domain), replacing the bare image. */
  .og .ogcard { display:flex; gap:12px; align-items:stretch; border:1px solid var(--line); border-radius:var(--sc-r); overflow:hidden; background:var(--panel); }
  .og .ogimg { flex:none; width:120px; min-height:76px; object-fit:cover; border:0; border-radius:0; }
  .og .ogtxt { min-width:0; padding:8px 10px 8px 0; display:flex; flex-direction:column; gap:2px; justify-content:center; }
  .og .ogtxt:first-child { padding-left:10px; }
  .og .ogtitle { font-size:13.5px; font-weight:700; color:var(--fg); overflow:hidden; text-overflow:ellipsis; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; }
  .og .ogdesc { font-size:12px; color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .og .ogdomain { font-size:11px; color:var(--muted); opacity:.8; text-transform:lowercase; }
  .og .ogclear { margin-top:6px; font:inherit; font-size:12px; background:none; border:0; color:var(--muted); cursor:pointer; padding:0; }
  .og .ogclear:hover { color:var(--brand); text-decoration:underline; }
  /* sow-192 Phase E: the four-step wizard chrome (Link -> Preview -> Note -> Publish). */
  /* The step sections + nav buttons are toggled with the [hidden] attribute, but several of them carry an
     explicit display (flex/inline-flex) that would beat the UA [hidden]{display:none}. Force it here so a
     hidden step or a hidden Back/Next/Post button actually disappears. */
  [hidden] { display:none !important; }
  .rail { display:flex; gap:6px; margin:0 0 16px; }
  .rail .dot { flex:1; display:flex; align-items:center; gap:7px; padding:0; background:none; border:0; font:inherit; font-size:12px; color:var(--muted); cursor:pointer; text-align:left; }
  .rail .dot .num { flex:none; width:20px; height:20px; border-radius:50%; display:inline-flex; align-items:center; justify-content:center; font-size:11px; font-weight:700; border:1.5px solid var(--line); background:var(--panel); color:var(--muted); }
  .rail .dot .lbl { white-space:nowrap; }
  .rail .dot.on { color:var(--fg); font-weight:600; }
  .rail .dot.done { color:var(--fg); }
  .rail .dot.on .num, .rail .dot.done .num { background:var(--brand); border-color:var(--brand); color:#fff; }
  .step h3 { margin:0 0 4px; }
  .step .sub { margin:0 0 12px; }
  .hint { margin:8px 0 0; font-size:12px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .autoblock { margin-top:12px; padding-top:12px; border-top:1px solid var(--line); }
  .autolabel { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; color:var(--accent); margin-bottom:8px; } .autoblock .cat { margin-bottom:8px; }
  .autolabel svg { width:14px; height:14px; fill:currentColor; flex:none; }
  .authorrow { margin-top:12px; padding-top:12px; border-top:1px solid var(--line); display:flex; flex-direction:column; gap:6px; }
  .authorrow[hidden] { display:none; }
  .authorrow select { width:100%; }
  .authornote { margin:0; }
  .notetabs { display:flex; align-items:center; gap:4px; margin-bottom:8px; }
  .notetabs .nt { font:inherit; font-size:13px; font-weight:600; padding:5px 12px; border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--muted); cursor:pointer; }
  .notetabs .nt.on { border-color:var(--brand); color:var(--brand); }
  .notetabs .mdlabel { margin-left:auto; font-size:11px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .notepreview { min-height:84px; padding:10px 12px; border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); font-size:14px; line-height:1.6; overflow-wrap:anywhere; }
  .notepreview :is(h1,h2,h3) { font-family:var(--font-display, var(--font-body)); font-size:16px; margin:.6em 0 .3em; }
  .notepreview p { margin:0 0 .7em; }
  .notepreview p:last-child, .notepreview :is(ul,ol):last-child, .notepreview blockquote:last-child { margin-bottom:0; }
  .notepreview a { color:var(--brand); }
  .notepreview ul, .notepreview ol { padding-left:1.3em; margin:0 0 .7em; }
  .notepreview blockquote { margin:0 0 .7em; padding:2px 0 2px 12px; border-left:3px solid var(--line); color:var(--muted); }
  .notepreview pre { background:var(--hover, rgba(0,0,0,.05)); padding:8px 10px; border-radius:var(--sc-r); overflow-x:auto; font-size:12.5px; }
  .notepreview code { font-family:var(--font-mono, monospace); font-size:.92em; }
  .notepreview .empty { color:var(--muted); font-style:italic; }
  .aud { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
  .audcard { display:flex; flex-direction:column; gap:3px; text-align:left; font:inherit; padding:12px 14px; border:1.5px solid var(--line); border-radius:var(--sc-r); background:var(--panel); color:var(--fg); cursor:pointer; }
  .audcard .at { display:flex; align-items:center; gap:7px; font-weight:700; font-size:14px; }
  .audcard .at svg { width:15px; height:15px; fill:currentColor; flex:none; }
  .audcard .ad { font-size:12px; color:var(--muted); }
  .audcard.on { border-color:var(--brand); box-shadow:inset 0 0 0 1px var(--brand); }
  .audcard.on .at { color:var(--brand); }
  .wizfoot { display:flex; align-items:center; gap:10px; margin-top:16px; }
  .wizfoot .msg { margin-right:auto; }
  .navbtns { display:flex; align-items:center; gap:8px; }
  .navbtns button.back, .navbtns button.next { font:inherit; font-weight:700; font-size:14px; padding:9px 16px; border-radius:var(--sc-r); cursor:pointer; display:inline-flex; align-items:center; gap:7px; }
  .navbtns .back { background:none; border:1.5px solid var(--line); color:var(--fg); }
  .navbtns .next { background:var(--brand); border:0; color:#fff; }
  .navbtns svg { width:15px; height:15px; fill:currentColor; flex:none; }
  /* Owner, 2026-10-19: "Leave a public stub", shown under Members only. BASE_CSS gives a bare label a block of muted
     13px text and a bare input 100% width, so both are set here; [hidden] is restated because display:flex beats it. */
  .stubopt { display:flex; align-items:flex-start; gap:10px; margin:12px 0 0; padding:12px 14px; border:1.5px dashed var(--line); border-radius:var(--sc-r); color:var(--fg); font-size:14px; cursor:pointer; }
  .stubopt[hidden] { display:none; }
  .stubopt input { width:auto; padding:0; margin:3px 0 0; flex:none; accent-color:var(--brand); }
  .stubopt b { display:block; font-weight:700; }
  .stubopt .sd { display:block; margin-top:2px; font-size:12px; color:var(--muted); }
  @media (max-width:420px) { .aud { grid-template-columns:1fr; } }
  @media (max-width:360px) { .rail .dot .lbl { display:none; } }
`;
