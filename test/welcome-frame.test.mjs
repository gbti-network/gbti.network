// sow-344 (2026-09-16): the welcome wizard lost its card. The owner's design pass ("Welcome wizard", the dissolved
// option, chosen for BOTH hosts) keeps the rail and the content as two columns on the page itself, with one hairline
// between them, the five steps drawn as a single connected track, and no fill, border, shadow or fixed height around
// any of it. These pin the stylesheet text, which is the thing a well-meant "restore the panel look" would revert.
// Run against the pre-change file they fail on the first .wf assertion, naming the property that came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../client-ui/src/elements/gbti-welcome.mjs', import.meta.url), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The body of ONE top-level rule in the component stylesheet (two-space indented, selector then a brace block).
function rule(sel) {
  const m = SRC.match(new RegExp('\\n  ' + escapeRe(sel) + ' \\{([^}]*)\\}'));
  assert.ok(m, `rule ${sel} exists in the welcome stylesheet`);
  return m[1];
}

test('welcome frame (sow-344): the wizard sits on the page, with no card around the two columns', () => {
  const wf = rule('.wf');
  for (const prop of ['border:', 'border-radius', 'box-shadow', 'background', 'height:min(', 'overflow:hidden']) {
    assert.ok(!wf.includes(prop), `.wf must not carry ${prop} (the card is gone; the page shows through)`);
  }
  const rail = rule('.rail');
  assert.ok(!rail.includes('background'), '.rail has no panel fill of its own');
  assert.match(rail, /border-right:1px solid var\(--wf-line\)/, 'one hairline divides the rail from the content');
  const foot = rule('.foot');
  assert.ok(!foot.includes('background'), '.foot is a hairline, not a filled band');
  assert.match(foot, /border-top:1px solid var\(--wf-line\)/, 'the footer hairline matches the rail divider');
  assert.ok(!rule('.content').includes('overflow'), 'nothing scrolls inside the wizard; the page does');
});

test('welcome frame (sow-344): the steps are one connected track and the active step has no pill', () => {
  assert.match(SRC, /\.rstep::before, \.rstep::after \{ content:""; position:absolute; left:12px; width:2px;/, 'a track segment above and below each circle');
  assert.match(SRC, /\.rstep:first-child::before, \.rstep:last-child::after \{ display:none; \}/, 'the track starts at the first circle and ends at the last');
  assert.match(SRC, /\.rstep\.active::before \{ bottom:calc\(50% \+ 16px\); \}/, 'the track stops short of the active circle');
  assert.ok(!SRC.includes('.rstep.active { border-color'), 'no pill behind the active row');
  const media = SRC.slice(SRC.indexOf('@media (max-width: 860px)'));
  assert.ok(media.length > 0, 'the small-screen block exists');
  assert.match(media, /\.rstep::before, \.rstep::after \{ display:none; \}/, 'the track is hidden in the horizontal strip');
});

test('welcome frame (sow-344): the rail no longer carries its own theme button', () => {
  assert.ok(!SRC.includes('data-theme-flip'), 'the host owns the theme; the rail has no toggle of its own');
  assert.ok(!SRC.includes('.themebtn'), 'no orphaned themebtn rule left behind');
});
