// sow-344 (2026-09-16): the welcome wizard lost its card. The owner's design pass ("Welcome wizard", the dissolved
// option, chosen for BOTH hosts) keeps the rail and the content as two columns on the page itself, with one hairline
// between them, the five steps drawn as a single connected track, and no fill, border, shadow or fixed height around
// any of it. These pin the stylesheet text, which is the thing a well-meant "restore the panel look" would revert.
// Run against the pre-change file they fail on the first .wf assertion, naming the property that came back.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// sow-349: the stylesheet moved to its own module; the component source still carries the markup and handlers.
const SRC = fs.readFileSync(new URL('../client-ui/src/elements/welcome-css.mjs', import.meta.url), 'utf8');
const COMPONENT = fs.readFileSync(new URL('../client-ui/src/elements/gbti-welcome.mjs', import.meta.url), 'utf8');
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
  assert.ok(!COMPONENT.includes('data-theme-flip'), 'the host owns the theme; the rail has no toggle of its own');
  assert.ok(!SRC.includes('.themebtn'), 'no orphaned themebtn rule left behind');
});

// sow-349 (2026-09-16): owner-reported, "the step hovers are ugly and has bad contrast". BASE_CSS gives every bare
// button `button:hover { background: var(--brand-dark) }`, which out-ranks one class, so a hovered step turned
// into a solid green block with dark text on it (subtitle 1.3:1). Every button class the wizard renders must
// therefore name its own hover background. The list is derived from the component's markup, so a new button
// class added later without a hover rule fails here instead of turning green in front of a member.
test('welcome hover (sow-349): every button class the wizard renders overrides the base green hover', () => {
  const classes = new Set();
  // The class may follow other attributes (`<button type="button" class="pk"`), so match inside the whole tag.
  for (const m of COMPONENT.matchAll(/<button\b[^>]*?\bclass="([a-z][a-z-]*)/g)) classes.add(m[1]);
  classes.add('rstep'); // rendered through a variable: class="${cls}" with cls = `rstep...`
  assert.match(COMPONENT, /const cls = `rstep\$\{/, 'the rail row class is still built from rstep');
  assert.ok(classes.size >= 10, `found the rendered button classes: ${[...classes].join(', ')}`);
  const missing = [...classes].filter((c) => !new RegExp(`\\.${c}(?::not\\([^)]*\\))*:hover[^{]*\\{[^}]*background`).test(SRC));
  assert.deepEqual(missing, [], `button classes whose hover inherits the base green: ${missing.join(', ')}`);
});

test('welcome hover (sow-349): a hovered or focused step keeps readable text and gains a ring, not a fill', () => {
  assert.match(SRC, /\.rstep:hover, \.rstep:focus-visible \{ background:none; \}/);
  assert.match(SRC, /\.rstep:hover \.circ, \.rstep:focus-visible \.circ \{ box-shadow:0 0 0 4px var\(--wf-greendim\); \}/);
  assert.match(SRC, /\.rstep:hover \.rl b, \.rstep:focus-visible \.rl b \{ color:var\(--wf-fg\); \}/);
  assert.match(SRC, /\.rstep:focus-visible \{ outline:2px solid var\(--wf-green\);/, 'keyboard focus is visible');
});

test('welcome contrast (sow-349): muted text and step numbers meet 4.5:1 on every background the wizard sits on', () => {
  const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const token = (block, name) => {
    const m = block.match(new RegExp(`--${name}:(#[0-9a-f]{6})`));
    assert.ok(m, `--${name} is a plain hex in the block`);
    return m[1];
  };
  const dark = SRC.slice(SRC.indexOf(':host {'), SRC.indexOf(':host-context([data-theme="light"])'));
  const light = SRC.slice(SRC.indexOf(':host-context([data-theme="light"])'), SRC.indexOf('@keyframes'));
  // Light: the site page, the panels and the step-number disc. Dark: the extension takeover, the site's dark page,
  // and the wizard's own panels and disc.
  const grounds = {
    light: ['#faf9f8', '#ffffff', token(light, 'wf-panel2'), token(light, 'wf-raise')],
    dark: ['#0d1117', '#1c1a21', token(dark, 'wf-surface'), token(dark, 'wf-panel'), token(dark, 'wf-panel2'), token(dark, 'wf-raise')],
  };
  for (const [theme, block] of [['light', light], ['dark', dark]]) {
    const mute = token(block, 'wf-mute');
    for (const bg of grounds[theme]) {
      assert.ok(ratio(mute, bg) >= 4.5, `${theme} --wf-mute ${mute} on ${bg} is ${ratio(mute, bg).toFixed(2)}:1`);
    }
  }
  assert.match(SRC, /\.rstep \.circ \{[^}]*color:var\(--wf-mute\)/, 'a pending step number uses the readable muted colour, not --wf-faint');
  // The current step's number, and a hovered pending one, is --wf-greenfg on the translucent --wf-greendim disc.
  // The disc sits in the rail, and the rail sits on the PAGE (sow-344 removed its panel), so only page grounds apply.
  const pages = { light: ['#faf9f8', '#ffffff'], dark: ['#0d1117', '#1c1a21'] };
  const blend = (fg, a, bg) => '#' + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * a + parseInt(bg.slice(i, i + 2), 16) * (1 - a)).toString(16).padStart(2, '0')).join('');
  for (const [theme, block, alpha] of [['light', light, 0.12], ['dark', dark, 0.16]]) {
    const fg = token(block, 'wf-greenfg');
    for (const bg of pages[theme]) {
      const disc = blend('#1f9e5f', alpha, bg);
      assert.ok(ratio(fg, disc) >= 4.5, `${theme} --wf-greenfg ${fg} on its disc over ${bg} is ${ratio(fg, disc).toFixed(2)}:1`);
    }
  }
  // A filled green button's white text on its hover colour.
  const hover = token(dark, 'wf-greenhover');
  assert.ok(ratio('#ffffff', hover) >= 4.5, `white on --wf-greenhover ${hover} is ${ratio('#ffffff', hover).toFixed(2)}:1`);
  assert.doesNotMatch(SRC, /:hover[^{]*\{[^}]*brightness/, 'no hover brightens a filled button, which lowers its contrast');
});
