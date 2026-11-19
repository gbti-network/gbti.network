// sow-494: the styles every Community element shares: the kind badges, the status pills, buttons, cards, result bars
// and the avatar circles, in light and dark.
//
// CORNERS (sow-498, owner 2026-11-19). Every Community corner is --cm-r, 2px, on the Community surfaces only (the rest
// of the site keeps its own). Faces, step markers and the live dot stay round.
//
// DARK MODE, IN EVERY BROWSER. client-ui's TOKENS redefine --fg, --line and the rest on every shadow host and flip
// them with :host-context([data-theme="dark"]), which Firefox and Safari do not support. These elements live on the
// website, where the page's own V3 tokens already flip with data-theme on <html>, so the host takes those back with
// `inherit` and every rule below reads the page's values. The names TOKENS never touches (--paper, --paper-2, --tint,
// --fg-soft, --green-700, --blue-700, --amber-*, --err*) inherit on their own.
//
// BASE_CSS styles bare button, input, label and h2 inside every shadow root and beats a single class (a green hover,
// width:100%, grey capitals). Each is reset here, and every class with a background states its own :hover.

export const COMMUNITY_CSS = `
:host {
  --fg: inherit; --fg-mute: inherit; --line: inherit; --line-2: inherit; --green-tint: inherit;
  --tooltip-bg: inherit; --tooltip-fg: inherit; --tooltip-border: inherit;
  --text: var(--fg); --muted: var(--fg-soft); --panel: var(--paper); --bg: var(--paper); --hover: var(--tint);
  --cm-btn: #137d4a; --cm-btn-hover: #0f6f40; --cm-hi: var(--green); --cm-lo: var(--green-bar); --cm-r: 2px;
  display: block; color: var(--fg); font: 16px/1.5 var(--f-sans); min-width: 0;
}
[hidden] { display: none !important; }
h1, h2, h3 { margin: 0; color: inherit; font-family: var(--f-sans); text-transform: none; letter-spacing: normal; font-size: inherit; }
label { display: inline; margin: 0; font-size: inherit; color: inherit; }
input, select, textarea { width: auto; font: inherit; color: var(--fg); background: var(--paper); border: 1px solid var(--line-2); border-radius: var(--cm-r); }
input[type="radio"], input[type="checkbox"] { width: 20px; height: 20px; padding: 0; margin: 0; accent-color: #1f9e5f; flex: none; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, a:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
button { background: none; color: inherit; border: 0; border-radius: var(--cm-r); padding: 0; font: inherit; font-weight: inherit; cursor: pointer; }
button:hover { background: none; }
button[disabled] { opacity: .5; cursor: not-allowed; }
a { color: var(--green-700); }
a:hover { color: var(--green); }

.cm-disp { font-family: var(--f-display); font-weight: 700; }
.cm-mono { font-family: var(--f-mono); font-size: 12px; letter-spacing: .06em; text-transform: uppercase; }
.cm-mute { color: var(--fg-mute); }
.cm-soft { color: var(--fg-soft); }
.cm-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

.cm-badge { flex: none; display: inline-flex; align-items: center; gap: 6px; padding: 5px 10px; border-radius: var(--cm-r); font-size: 12px; font-weight: 700; line-height: 1.2; white-space: nowrap; }
.cm-badge svg { width: 14px; height: 14px; flex: none; }
.cm-badge.k-poll, .cm-badge.k-typed { background: var(--green-tint); color: var(--green-700); }
.cm-badge.k-topic { background: var(--blue-tint); color: var(--blue-700); }

.cm-pill { display: inline-flex; align-items: center; gap: 5px; padding: 2px 8px; border-radius: var(--cm-r); font-size: 12px; font-weight: 700; line-height: 1.5; }
.cm-pill.live { background: var(--green-tint); color: var(--green-700); }
.cm-pill.live::before { content: ""; width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
.cm-pill.muted { background: var(--tint); color: var(--fg-soft); }
.cm-pill.outline { border: 1px solid var(--green-700); color: var(--green-700); padding: 1px 7px; }

.cm-btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 46px; padding: 0 22px; border-radius: var(--cm-r);
  background: var(--cm-btn); color: #fff; font-weight: 700; font-size: 15px; text-decoration: none; white-space: nowrap; }
.cm-btn:hover { background: var(--cm-btn-hover); color: #fff; }
.cm-btn2 { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 14px; border-radius: var(--cm-r);
  border: 1px solid var(--line-2); background: var(--paper); color: var(--fg); font-weight: 600; font-size: 14px; text-decoration: none; white-space: nowrap; }
.cm-btn2:hover { background: var(--tint); color: var(--fg); }
.cm-btn2.sm { min-height: 34px; padding: 0 10px; font-size: 13px; border-radius: var(--cm-r); }
.cm-quiet { color: var(--fg-soft); font-weight: 600; font-size: 14px; padding: 6px 4px; text-decoration: underline; text-underline-offset: 3px; }
.cm-quiet:hover { color: var(--fg); }
.cm-danger { color: var(--err); }
.cm-danger:hover { color: var(--err); }

.cm-card { background: var(--paper); border: 1px solid var(--line); border-radius: var(--cm-r); }
.cm-raised { border-color: var(--line-2); box-shadow: 0 4px 14px rgba(37,35,43,.07); }
/* sow-498: a round frame for a real face (faceHtml): the blobatar and the picture fill it (AVATAR_LAYER_CSS). */
.cm-av { flex: none; position: relative; overflow: hidden; display: inline-block; width: 30px; height: 30px; border-radius: 50%; background: var(--tint); }
.cm-av.lg { width: 34px; height: 34px; }
.cm-faces { display: inline-flex; }
.cm-faces .cm-av { width: 26px; height: 26px; border: 2px solid var(--paper); margin-left: -6px; }
.cm-faces .cm-av:first-child { margin-left: 0; }

.cm-note { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--cm-r); background: var(--amber-tint); color: var(--amber-text); font-size: 14px; }
.cm-err { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px; border-radius: var(--cm-r); background: var(--err-tint); color: var(--err); font-size: 14px; }
.cm-err strong { display: block; }
.cm-ok { color: var(--green-700); font-size: 14px; font-weight: 600; }

.cm-bars { display: flex; flex-direction: column; gap: 12px; }
.cm-bar { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 6px 14px; align-items: baseline; }
.cm-bar .lbl { font-size: 15px; min-width: 0; overflow-wrap: anywhere; }
.cm-bar .num { font-family: var(--f-mono); font-size: 13px; color: var(--fg-soft); white-space: nowrap; }
.cm-bar .trk { display: block; grid-column: 1 / -1; height: 12px; border-radius: 2px; background: var(--tint); overflow: hidden; }
.cm-bar .fill { display: block; height: 100%; border-radius: 2px; background: var(--cm-lo); transition: width .3s ease; }
.cm-bar.lead .lbl { font-weight: 700; }
.cm-bar.lead .fill { background: var(--cm-hi); }
.cm-yours { margin-left: 8px; font-size: 12px; font-weight: 700; color: var(--green-700); }

.cm-state { text-align: center; padding: 48px 24px; display: flex; flex-direction: column; align-items: center; gap: 12px; }
.cm-state h2 { font-size: 22px; font-weight: 700; }
.cm-state p { margin: 0; max-width: 520px; color: var(--fg-soft); }
.cm-state.amber { background: var(--amber-tint); border-radius: var(--cm-r); }
.cm-skel { height: 76px; border-radius: var(--cm-r); background: var(--tint); opacity: .7; }

@media (max-width: 640px) {
  .cm-btn { min-height: 44px; padding: 0 18px; }
}
`;

/** The small kind glyphs: bars for a poll, a speech bubble for a topic. */
export const KIND_ICON = {
  poll: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V10M12 20V4M19 20v-7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  topic: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-8l-5 4v-4H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
};
KIND_ICON.typed = KIND_ICON.poll;
