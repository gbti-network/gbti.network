// The stylesheet of <gbti-welcome>, in its own module because the component crossed the size cap (sow-349).
// Moved verbatim from gbti-welcome.mjs on 2026-09-16; the only changes since are the ones sow-349 describes.
// BASE_CSS (tokens.mjs) styles bare `button` for every component, including `button:hover { background:
// var(--brand-dark) }`, which out-ranks a single class. Every button this wizard renders therefore needs its own
// :hover background, or hovering paints it solid brand green (see the hover block below).
export const WELCOME_CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg);
    /* The design handoff's dark palette (the extension default). */
    --wf-surface:#232029; --wf-panel:#2a2731; --wf-panel2:#302c37; --wf-raise:#35313d;
    --wf-line:rgba(255,255,255,.085); --wf-line2:rgba(255,255,255,.16);
    --wf-fg:#f3f2f0; --wf-soft:#bdbac4; --wf-mute:#9d98a6; --wf-faint:#5c5865;
    --wf-green:#1f9e5f; --wf-greenfg:#5fd49a; --wf-greendim:rgba(31,158,95,.16);
    /* sow-349: a filled green button goes DARKER on hover, in both themes, so its white text reads 5.4:1. */
    --wf-greenhover:#157a48;
  }
  :host-context([data-theme="light"]) {
    --wf-surface:#efece6; --wf-panel:#ffffff; --wf-panel2:#f6f3ee; --wf-raise:#ece7df;
    --wf-line:rgba(30,24,38,.10); --wf-line2:rgba(30,24,38,.18);
    --wf-fg:#241f2c; --wf-soft:#4f4a58; --wf-mute:#65626f; --wf-faint:#a9a4b0;
    --wf-green:#1f9e5f; --wf-greenfg:#137343; --wf-greendim:rgba(31,158,95,.12);
  }
  /* sow-349: --wf-mute carries readable secondary text (step subtitles, step numbers, notes), so it is held at
     4.5:1 or better on every ground the wizard sits on: the site page, the extension takeover, and the wizard's
     own panels and discs (test/welcome-frame.test.mjs computes it). --wf-faint is for decoration and disabled
     controls only, which the contrast rule exempts. */
  @keyframes wf-in { from { opacity:0; transform:translateY(14px) scale(.985); } to { opacity:1; transform:none; } }
  @keyframes wf-fade { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:none; } }

  /* THE FRAME (sow-344): there is no card. The owner's design pass (2026-09-16, "Welcome wizard", the dissolved
     option, chosen for both hosts) keeps the two columns and removes the box around them: no fill, no border, no
     radius, no shadow, no fixed height and nothing scrolling inside. The rail and the content sit on the page
     itself with one hairline between them, so the page's own background shows through on the /welcome/ page and
     in the extension takeover alike, which is why nothing here paints --wf-surface any more. */
  .wf { display:flex; width:100%; max-width:1080px; margin:0 auto; box-sizing:border-box;
    animation:wf-in .34s cubic-bezier(.2,.8,.2,1) both; color:var(--wf-fg); }
  .rail { width:264px; flex:none; border-right:1px solid var(--wf-line);
    padding:6px 28px 0 0; display:flex; flex-direction:column; box-sizing:border-box; }
  .brand { display:inline-flex; align-items:center; gap:9px; }
  .brand .mark { width:30px; height:30px; border-radius:7px; background:var(--wf-green); color:#fff;
    display:flex; align-items:center; justify-content:center; font-family:var(--font-display); font-weight:700; font-size:14px; }
  .brand b { font-family:var(--font-display); font-size:15px; font-weight:600; color:var(--wf-fg); line-height:1; }
  .railhead { font-family:var(--font-mono); font-size:10.5px; font-weight:600; letter-spacing:.14em;
    text-transform:uppercase; color:var(--wf-mute); margin:22px 0 12px; }
  /* The five steps read as ONE connected track rather than five boxed rows: a 2px line runs behind the circles
     from the first to the last. It is drawn per row, as a segment above and one below each circle, so it can
     stop 3px short of the active circle without knowing the page colour (the two hosts paint different
     backgrounds, and a ring in the wrong one would show as a halo). The active step has no pill any more; the
     ring on its circle and the weight of its label carry the state. */
  .rsteps { display:flex; flex-direction:column; gap:0; }
  .rstep { position:relative; display:flex; align-items:center; gap:12px; padding:10px 0; border:0; border-radius:0;
    background:none; cursor:pointer; width:100%; font:inherit; text-align:left; transition:.12s; }
  .rstep::before, .rstep::after { content:""; position:absolute; left:12px; width:2px; background:var(--wf-line); border-radius:2px; }
  .rstep::before { top:0; bottom:calc(50% + 13px); }
  .rstep::after { top:calc(50% + 13px); bottom:0; }
  .rstep:first-child::before, .rstep:last-child::after { display:none; }
  .rstep.active::before { bottom:calc(50% + 16px); }
  .rstep.active::after { top:calc(50% + 16px); }
  .rstep .circ { position:relative; z-index:1; width:26px; height:26px; flex:none; border-radius:50%; display:flex; align-items:center;
    justify-content:center; font-family:var(--font-mono); font-weight:600; font-size:11px;
    background:var(--wf-raise); color:var(--wf-mute); box-sizing:border-box; transition:box-shadow .12s, background-color .12s, color .12s; }
  .rstep.done .circ { background:var(--wf-green); color:#fff; }
  .rstep.active .circ { background:var(--wf-greendim); color:var(--wf-greenfg); border:1.5px solid var(--wf-green); }
  .rstep .rl { display:flex; flex-direction:column; line-height:1.2; min-width:0; }
  .rstep .rl b { font-size:13.5px; font-weight:600; color:var(--wf-soft); }
  .rstep.done .rl b, .rstep.active .rl b { color:var(--wf-fg); }
  .rstep .rl span { font-size:11px; color:var(--wf-mute); }
  .rstep.active .rl span { color:var(--wf-greenfg); }
  /* sow-349: hover and keyboard focus on a step. BASE_CSS paints a hovered button brand green, which turned a step
     into a solid block with dark text on it. A step now answers the pointer the way the dissolved layout reads: no
     fill, a soft green halo around its circle (translucent, so it works on either host's ground), and its label at
     full strength. */
  .rstep:hover, .rstep:focus-visible { background:none; }
  .rstep:focus-visible { outline:2px solid var(--wf-green); outline-offset:3px; border-radius:7px; }
  .rstep:hover .circ, .rstep:focus-visible .circ { box-shadow:0 0 0 4px var(--wf-greendim); }
  .rstep:not(.done):not(.active):hover .circ { background:var(--wf-greendim); color:var(--wf-greenfg); }
  .rstep:hover .rl b, .rstep:focus-visible .rl b { color:var(--wf-fg); }
  .rstep:hover .rl span, .rstep:focus-visible .rl span { color:var(--wf-soft); }
  .rstep.active:hover .rl span, .rstep.active:focus-visible .rl span { color:var(--wf-greenfg); }

  .main { flex:1; min-width:0; display:flex; flex-direction:column; padding-left:34px; }
  .top { padding:0; }
  .eyebrow { font-family:var(--font-mono); font-size:10.5px; font-weight:600; letter-spacing:.16em;
    text-transform:uppercase; color:var(--wf-greenfg); display:flex; align-items:center; gap:10px; }
  .couponline { margin:2px 0 10px; font-size:12.5px; line-height:1.5; color:var(--muted); }
  .phasepill { font-family:var(--font-body); font-size:10px; font-weight:700; letter-spacing:.05em;
    color:var(--wf-mute); background:var(--wf-panel2); border:1px solid var(--wf-line); border-radius:999px; padding:2px 9px; }
  .heads { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-top:5px; }
  .heads h2 { font-family:var(--font-display); font-size:25px; font-weight:600; letter-spacing:-.01em; margin:0; color:var(--wf-fg); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-transform:none; }
  .stepmono { font-family:var(--font-mono); font-size:11px; font-weight:600; letter-spacing:.1em; color:var(--wf-mute); white-space:nowrap; }
  .bar { height:4px; background:var(--wf-raise); border-radius:99px; overflow:hidden; margin-top:15px; }
  .bar i { display:block; height:100%; background:var(--wf-green); border-radius:99px; transition:width .3s; }
  .content { flex:1; padding:22px 0 0; }
  .stepin { animation:wf-fade .3s ease both; }
  .foot { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:28px; padding:16px 0 0;
    border-top:1px solid var(--wf-line); }
  .footr { display:flex; align-items:center; gap:10px; }
  .gbtn { font:inherit; font-weight:600; font-size:13px; color:var(--wf-soft); background:var(--wf-raise);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:11px 18px; cursor:pointer; }
  .gbtn:hover { color:var(--wf-fg); border-color:var(--wf-line2); background:var(--wf-raise); }
  .gbtn.off { color:var(--wf-faint); background:none; border-color:transparent; cursor:default; opacity:.5; }
  .skipbtn { font:inherit; font-weight:600; font-size:13px; color:var(--wf-mute); background:none; border:none; cursor:pointer; padding:10px 8px; }
  .skipbtn:hover { color:var(--wf-fg); background:none; }
  .pbtn { font:inherit; font-weight:600; font-size:13.5px; color:#fff; background:var(--wf-green);
    border:1.5px solid transparent; border-radius:7px; padding:11px 24px; cursor:pointer; }
  /* The base hover colour is a LIGHT green in dark mode, which drops white text below 3:1; use our own darker one. */
  .pbtn:hover { background:var(--wf-green); }
  .pbtn:not([disabled]):hover { background:var(--wf-greenhover); }
  .pbtn[disabled] { opacity:.55; cursor:default; }

  /* Step content shared. */
  .intro { font-size:14px; line-height:1.6; color:var(--wf-soft); max-width:64ch; margin:0 0 16px; }
  .ico-tile { flex:none; border-radius:7px; background:var(--wf-raise); border:1.5px solid var(--wf-line);
    display:flex; align-items:center; justify-content:center; color:var(--wf-fg); box-sizing:border-box; }
  .callout { display:flex; gap:9px; font-size:12.5px; line-height:1.5; color:var(--wf-mute);
    background:var(--wf-panel2); border:1.5px solid var(--wf-line); border-radius:7px; padding:11px 13px; margin-top:16px; }
  .callout .gl { color:var(--wf-faint); flex:none; }
  .sbtn { font:inherit; font-weight:600; font-size:12.5px; color:#fff; background:var(--wf-green);
    border:1.5px solid transparent; border-radius:7px; padding:7px 15px; cursor:pointer; flex:none; transition:.12s; }
  .sbtn:not(.on):hover { background:var(--wf-greenhover); }
  .sbtn.on { color:var(--wf-soft); background:var(--wf-raise); border-color:var(--wf-line); }

  /* Discord step. */
  .dhead { display:flex; align-items:center; gap:13px; margin-bottom:16px; }
  .dhead .ico-tile { width:46px; height:46px; }
  /* The card used to repeat the step heading ("Connect Discord") beside the icon, so the words appeared twice
     on one screen. The icon stays, the duplicate heading is gone, and the line beside it now does the actual
     work of inviting the member in. It is a <p> rather than a heading on purpose: the step already owns the
     only heading on this panel, and a second one saying nearly the same thing is noise for a screen reader.
     Sized between the old h3 and the old sub-line so it still carries next to a 46px tile. */
  .dhead .dlede { font-family:var(--font-display); font-size:16.5px; font-weight:600; margin:0; line-height:1.25; color:var(--wf-fg); }
  .dbtn { display:inline-flex; align-items:center; gap:8px; font:inherit; font-weight:600; font-size:13.5px;
    color:#fff; background:var(--wf-green); border:1.5px solid transparent; border-radius:7px; padding:11px 18px; cursor:pointer; }
  .dbtn:not(.on):not([disabled]):hover { background:var(--wf-greenhover); }
  .dbtn.on, .dbtn[disabled] { color:var(--wf-soft); background:var(--wf-raise); border-color:var(--wf-line); cursor:default; }
  /* sow-218: the connected row pairs the confirmation with a quiet Disconnect. Deliberately understated: it is
     a real action but not the one this step is asking anybody to take. */
  .drow { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
  .dlink { font:inherit; font-size:13px; font-weight:600; color:var(--wf-soft); background:none; border:0;
    padding:6px 2px; cursor:pointer; text-decoration:underline; text-underline-offset:3px; }
  .dlink:hover { background:none; }
  .dlink:hover:not([disabled]) { color:var(--wf-fg); }
  .dlink[disabled] { opacity:.6; cursor:default; }

  /* Channels grid. */
  .grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(238px, 1fr)); gap:12px; }
  .pcard { display:flex; flex-direction:column; gap:11px; padding:14px; background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; box-sizing:border-box; }
  .pcard .ph { display:flex; align-items:center; gap:10px; min-width:0; }
  .pcard .ico-tile { width:34px; height:34px; }
  .pcard .pn { min-width:0; }
  .pcard .pn b { display:block; font-size:14px; font-weight:600; color:var(--wf-fg); line-height:1.1; }
  .pcard .pn span { display:block; font-family:var(--font-mono); font-size:11.5px; color:var(--wf-mute);
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pcard .pd { font-size:12.5px; line-height:1.5; color:var(--wf-soft); flex:1; }
  .pcard .sbtn { align-self:flex-start; }

  /* Socials step. */
  .srow { display:flex; align-items:center; gap:11px; margin:0 0 10px; max-width:560px; }
  .srow .ico-tile { width:40px; height:40px; }
  .srow input { flex:1; min-width:0; font:inherit; font-size:14px; color:var(--wf-fg); background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:10px 13px; outline:none; box-sizing:border-box; }
  .srow input:focus { border-color:var(--wf-green); }
  .addmore { align-self:flex-start; font:inherit; font-weight:600; font-size:12.5px; color:var(--wf-greenfg);
    background:none; border:none; cursor:pointer; padding:2px 0; }
  .addmore:hover { background:none; text-decoration:underline; text-underline-offset:3px; }
  .pkrow { display:flex; flex-wrap:wrap; gap:7px; margin-top:10px; }
  .pk { display:inline-flex; align-items:center; gap:6px; font:inherit; font-size:12.5px; font-weight:600;
    color:var(--wf-soft); background:var(--wf-panel2); border:1.5px solid var(--wf-line); border-radius:999px; padding:6px 11px; cursor:pointer; }
  .pk:hover { color:var(--wf-fg); border-color:var(--wf-green); background:var(--wf-panel2); }

  /* Members grid. */
  .mtop { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; margin-bottom:14px; }
  .mtop .intro { margin:0; max-width:54ch; }
  .mcount { font-family:var(--font-mono); font-size:11px; color:var(--wf-mute); white-space:nowrap; }
  .mgrid { display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:10px; }
  .mcard { display:flex; align-items:center; gap:12px; padding:11px 13px; background:var(--wf-panel2);
    border:1.5px solid var(--wf-line); border-radius:7px; box-sizing:border-box; }
  .mav { width:36px; height:36px; flex:none; border-radius:50%; color:#fff; display:grid; place-items:center;
    font-weight:700; font-size:13px; overflow:hidden; position:relative; }
  .mav img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .mi { flex:1; min-width:0; }
  .mi b { display:block; font-size:13.5px; font-weight:600; color:var(--wf-fg); line-height:1.15; }
  .mi span { display:block; color:var(--wf-mute); font-size:11.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .pager { display:flex; align-items:center; justify-content:space-between; margin-top:13px; }
  .pager button { font:inherit; font-weight:600; font-size:12.5px; color:var(--wf-soft); background:var(--wf-raise);
    border:1.5px solid var(--wf-line); border-radius:7px; padding:7px 14px; cursor:pointer; }
  .pager button[disabled] { opacity:.4; cursor:default; }
  .pager .pg { font-family:var(--font-mono); font-size:11px; color:var(--wf-mute); }
  .note { color:var(--wf-mute); font-size:12.5px; line-height:1.5; margin:0; }

  /* Done state. */
  .donewrap { display:flex; flex-direction:column; align-items:center; text-align:center; gap:14px; padding:24px 12px; }
  .donecheck { width:56px; height:56px; border-radius:50%; background:var(--wf-greendim); color:var(--wf-greenfg);
    display:flex; align-items:center; justify-content:center; font-size:26px; }
  .donewrap h3 { font-family:var(--font-display); font-size:22px; font-weight:600; margin:0; color:var(--wf-fg); }
  .donewrap p { margin:0; font-size:14px; line-height:1.6; color:var(--wf-soft); max-width:44ch; }
  .stats { display:flex; gap:22px; margin-top:4px; }
  .stat { text-align:center; }
  .stat b { display:block; font-family:var(--font-mono); font-weight:700; font-size:20px; color:var(--wf-greenfg); }
  .stat span { display:block; font-family:var(--font-mono); font-size:10px; letter-spacing:.1em; text-transform:uppercase; color:var(--wf-mute); }

  /* Small screens: the rail collapses to a horizontal step strip under a hairline. The track segments go with
     it, since they only make sense stacked. Responsive block last on purpose: source order, not specificity. */
  @media (max-width: 860px) {
    .wf { flex-direction:column; }
    .rail { width:100%; flex-direction:row; align-items:center; gap:10px; padding:0 0 12px; border-right:0; border-bottom:1px solid var(--wf-line); }
    .brand b, .railhead { display:none; }
    .rsteps { flex:1; min-width:0; flex-direction:row; overflow-x:auto; gap:4px; }
    .rstep { width:auto; flex:none; padding:7px 9px; }
    .rstep::before, .rstep::after { display:none; }
    .rstep .rl span { display:none; }
    .main { padding-left:0; }
    .top { padding-top:18px; }
  }

  /* SOW-048: the forced-sign-in (login splash) mode + the loading state (token-styled, not the modal). */
  .splashwrap { max-width:680px; margin:0 auto; padding:32px 28px; }
  .head { text-align:center; margin-bottom:22px; }
  .head .ic { display:inline-grid; place-items:center; }
  .head h2 { font-family:var(--font-display); font-size:24px; margin:8px 0 6px; }
  .head p { color:var(--muted); margin:0 auto; max-width:46ch; line-height:1.5; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:9px;
    background:var(--brand); color:#fff; text-decoration:none; font:inherit; font-weight:700; font-size:14px; padding:10px 16px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn.ghost { background:transparent; color:var(--fg-soft); border:1.5px solid var(--line); }
  .btn.ghost:hover { background:var(--hover); color:var(--fg); border-color:var(--line-2); }
  .btn.signin { width:100%; box-sizing:border-box; padding:13px; font-size:15px; }
  .splashwrap .note { color:var(--muted); }
  .splashwrap .note a { color:var(--accent); }
  .codebox { text-align:center; }
  .codebox .sub { color:var(--muted); font-size:13.5px; margin:0 0 8px; }
  .codeval { display:flex; align-items:center; justify-content:center; gap:10px; margin:8px 0 14px; flex-wrap:wrap; }
  .codeval code { font-family:var(--font-mono, monospace); font-size:22px; font-weight:700; letter-spacing:.14em; background:var(--hover); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .codeval .btn { padding:8px 13px; font-size:13px; }
  .loading { color:var(--muted); text-align:center; padding:30px 0; }
`;
