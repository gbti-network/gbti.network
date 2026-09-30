// sow-109: the prompt-or-skill label and a skill's install box, styled ONCE for both places they appear: the website
// (src/styles/prompt-kind.css carries this text verbatim) and the extension reader (a shadow root, which cannot read the
// site's stylesheet). test/skill-reader.test.mjs fails if the two copies differ, the same guard idea as the card
// colours in test/card-list-site-parity.test.mjs.
//
// The rules use the website's token names (--fg, --fg-soft, --green, --f-mono and so on). The reader maps those onto
// its own tokens (READER_TOKEN_ALIASES in client-ui/src/skill-reader.mjs), so the rule text stays identical.

/** The label and box colours, per theme. The website sets them on :root and [data-theme="dark"]. */
export const SKILL_TOKENS = Object.freeze({
  light: Object.freeze({
    'kind-prompt-fg': '#6b4fb0',
    'kind-prompt-bg': '#f2eefb',
    'kind-prompt-line': '#d6c9ee',
    'kind-skill-fg': '#ffffff',
    'kind-skill-bg': '#6b4fb0',
    'skill-box-bg': '#f8f5fe',
    'skill-box-line': '#d6c9ee',
    'skill-box-well': '#ffffff',
    'skill-box-well-line': '#e2daf3',
    'skill-box-mute': '#5d5275',
    'skill-box-accent': '#6b4fb0',
    'skill-box-on-accent': '#ffffff',
  }),
  dark: Object.freeze({
    'kind-prompt-fg': '#cdbcff',
    'kind-prompt-bg': '#332b48',
    'kind-prompt-line': '#4b3f6e',
    'kind-skill-fg': '#1d1433',
    'kind-skill-bg': '#c4b0ff',
    'skill-box-bg': '#262234',
    'skill-box-line': '#5d4d8f',
    'skill-box-well': '#19171f',
    'skill-box-well-line': '#3d3754',
    'skill-box-mute': '#b9b0d6',
    'skill-box-accent': '#c4b0ff',
    'skill-box-on-accent': '#1d1433',
  }),
});

/** The token declarations for one theme, as CSS: `--kind-prompt-fg: #6b4fb0; ...`. */
export const skillTokenDecls = (theme) => Object.entries(SKILL_TOKENS[theme]).map(([k, v]) => `--${k}: ${v};`).join(' ');

/** The shared rules: the PROMPT / SKILL label and the install box. */
export const SKILL_BOX_CSS = `/* ---------- the label ---------- */
.kind-badge {
  display: inline-flex; align-items: center; gap: 5px; height: 24px; box-sizing: border-box; padding: 0 9px;
  border-radius: 6px; border: 1px solid transparent; font-family: var(--f-mono); font-size: 11px; font-weight: 700;
  letter-spacing: .08em; text-transform: uppercase; white-space: nowrap; line-height: 1; text-decoration: none;
}
.kind-badge svg { flex: none; }
.kind-prompt { color: var(--kind-prompt-fg); background: var(--kind-prompt-bg); border-color: var(--kind-prompt-line); }
.kind-skill { color: var(--kind-skill-fg); background: var(--kind-skill-bg); }

/* ---------- a skill page: the install box ---------- */
.skill-install {
  display: flex; flex-direction: column; gap: 20px; padding: 26px 28px; margin-bottom: 30px;
  border: 1.5px solid var(--skill-box-line); border-radius: var(--r-lg); background: var(--skill-box-bg); color: var(--fg);
}
.skill-install-head { display: flex; align-items: center; gap: 14px; }
.skill-install-head h2 {
  margin: 0; font-family: var(--f-display); font-weight: 700; font-size: 24px; line-height: 1.2; color: var(--fg);
  text-transform: none; letter-spacing: normal; /* the extension's base styles uppercase every h2 */
}
.skill-install-ico {
  width: 40px; height: 40px; flex: none; border-radius: 10px; display: flex; align-items: center; justify-content: center;
  background: var(--skill-box-accent); color: var(--skill-box-on-accent);
}
.skill-install code { font-family: var(--f-mono); font-size: .9em; }
.skill-tools-row { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.skill-tools-label { margin: 0; font-size: 14px; font-weight: 600; color: var(--skill-box-mute); }
.skill-tools { display: flex; flex-wrap: wrap; gap: 4px; padding: 4px; border: 1px solid var(--skill-box-well-line); border-radius: 10px; background: var(--skill-box-well); }
.skill-tools button {
  height: 36px; padding: 0 14px; border: 0; border-radius: 7px; background: transparent; color: var(--fg-soft);
  font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; width: auto;
}
.skill-tools button:hover { background: var(--skill-box-bg); color: var(--fg); }
.skill-tools button[aria-selected="true"] { background: var(--skill-box-accent); color: var(--skill-box-on-accent); font-weight: 700; }
.skill-panel[hidden] { display: none; }
.skill-steps { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 18px; }
.skill-steps > li { display: flex; gap: 14px; }
.skill-step-n {
  width: 28px; height: 28px; flex: none; border-radius: 50%; border: 1.5px solid var(--skill-box-accent); color: var(--skill-box-accent);
  font-family: var(--f-mono); font-size: 13px; font-weight: 700; display: flex; align-items: center; justify-content: center;
}
.skill-step { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 10px; }
.skill-step-t { margin: 0; font-size: 16px; line-height: 28px; font-weight: 600; }
.skill-step-t code {
  padding: 2px 7px; border-radius: 5px; border: 1px solid var(--skill-box-well-line); background: var(--skill-box-well); color: var(--fg);
}
.skill-cmd {
  display: flex; align-items: center; gap: 10px; padding: 10px 10px 10px 16px; min-width: 0;
  border: 1px solid var(--skill-box-well-line); border-radius: 8px; background: var(--skill-box-well);
}
.skill-cmd code { flex: 1; min-width: 0; overflow-wrap: anywhere; font-size: 14px; color: var(--fg); }
.skill-note, .skill-local { margin: 0; font-size: 13.5px; line-height: 1.55; color: var(--skill-box-mute); }
.skill-local { padding-top: 16px; margin-top: 18px; border-top: 1px solid var(--skill-box-well-line); }
.skill-local code { color: var(--fg); }
.skill-file-btns { display: flex; flex-wrap: wrap; gap: 10px; }

/* The buttons carry their own hover background: the site's bare-button rules would otherwise paint them green. */
.skill-btn {
  display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 18px; width: auto; box-sizing: border-box;
  border: 1px solid var(--skill-box-well-line); border-radius: 8px; background: transparent; color: var(--fg);
  font-family: inherit; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer;
}
.skill-btn:hover { background: var(--skill-box-well); color: var(--fg); border-color: var(--skill-box-accent); }
.skill-btn-sm { height: 32px; padding: 0 12px; font-size: 13px; gap: 6px; flex: none; }
.skill-btn-primary { border-color: transparent; background: var(--green); color: #fff; font-weight: 700; }
.skill-btn-primary:hover { background: var(--green-600); color: #fff; border-color: transparent; }

@media (max-width: 600px) {
  .skill-install { padding: 20px 16px; }
  .skill-steps > li { gap: 10px; }
  .skill-cmd { flex-wrap: wrap; }
}
`;
