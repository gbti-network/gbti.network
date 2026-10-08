// sow-431: the homepage Prompts & Skills section as image cards (design B, owner 2026-09-30). The card and the page are
// Astro, which no unit test renders, so their wiring is pinned by source; the tile's command is checked against the real
// skills it will be drawn for. Driven in a browser before shipping, in light, dark and at 390px.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { skillNameFrom } from '../membership/skill-install.mjs';

const src = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const CARD = 'src/components/home/HomePromptCard.astro';

test('the card leads with the cover, else a tile in its kind, and never the robot', () => {
  const s = src(CARD);
  assert.match(s, /\{d\.image\s*\n\s*\? <Image class="hpc-img" src=\{d\.image\} alt="" width=\{600\} height=\{338\} \/>/);
  assert.match(s, /<span class=\{`hpc-tile hpc-tile-\$\{d\.kind\}`\}>\s*\n\s*<svg viewBox="0 0 24 24" aria-hidden="true"><use href=\{`#ico-kind-\$\{d\.kind\}`\}\/><\/svg>/);
  assert.doesNotMatch(s, /ico-bot/, 'the robot is gone from the homepage card');
  assert.match(s, /<span class="hpc-badge"><span class=\{`kind-badge kind-\$\{d\.kind\}`\}>/, 'the label sits on the image');
});

test('a skill tile names its command from the skill file; a members-only skill shows the glyph alone', () => {
  const s = src(CARD);
  assert.match(s, /const skillName = d\.kind === 'skill' && !d\.image \? skillFileOf\(prompt\)\?\.name \|\| '' : '';/);
  assert.match(s, /\{skillName && <span class="hpc-cmd">\/\{skillName\}<\/span>\}/);
});

test('the card text is the short description, not the author note', () => {
  const s = src(CARD);
  assert.match(s, /\{d\.shortDescription && <p class="hpc-desc"><InlineCode text=\{d\.shortDescription\} \/><\/p>\}/, 'sow-449: backticks show as code');
  assert.doesNotMatch(s, /authorNote|comments/, 'no author-note lookup, and no comments prop');
  assert.doesNotMatch(s, /leafLabel|hp-kind/, 'no category tag repeating the section name');
});

test('the section is three cards across, and its subtitle counts each kind', () => {
  const s = src('src/pages/index.astro');
  assert.match(s, /<div class="works-grid">\s*\n\s*\{homePrompts\.map\(\(p\) => <HomePromptCard prompt=\{p\} profiles=\{homeProfiles\} \/>\)\}/);
  assert.match(s, /const n = listedPrompts\.filter\(\(p\) => p\.data\.kind === k\)\.length;\s*\n\s*return `\$\{n\} \$\{n === 1 \? one : many\}`;/);
  assert.match(s, /const promptKindLine = `\$\{kindCount\('prompt', 'prompt', 'prompts'\)\} · \$\{kindCount\('skill', 'skill', 'skills'\)\}`;/);
  assert.match(s, /<p class="home-sec-sub">\{promptKindLine\}<\/p>/);
  assert.doesNotMatch(s, /three kinds/);
  assert.doesNotMatch(s, /homeComments/, 'the comment collection is no longer loaded for this section');
});

test('the tile colours exist in both themes, and the old row styles are gone', () => {
  const feed = src('src/styles/gbti-v3-feed.css');
  const [light, dark] = [/\.hpc-card \{([^}]*)\}/.exec(feed)[1], /\[data-theme="dark"\] \.hpc-card \{([^}]*)\}/.exec(feed)[1]];
  for (const tok of ['--hpc-tile-skill-bg', '--hpc-tile-skill-fg', '--hpc-tile-prompt-bg', '--hpc-tile-prompt-fg']) {
    assert.match(light, new RegExp(`${tok}: #[0-9a-f]{6};`), `${tok} light`);
    assert.match(dark, new RegExp(`${tok}: #[0-9a-f]{6};`), `${tok} dark`);
  }
  assert.match(feed, /\.hpc-tile-skill \{ background: var\(--hpc-tile-skill-bg\); color: var\(--hpc-tile-skill-fg\); \}/);
  assert.match(feed, /\.hpc-tile-prompt \{ background: var\(--hpc-tile-prompt-bg\); color: var\(--hpc-tile-prompt-fg\); \}/);
  assert.doesNotMatch(feed, /\.hp-bot|\.hp-row|\.hp-grid/);
  assert.doesNotMatch(src('src/styles/prompt-kind.css'), /tile/, 'the shared label tokens stay as the extension has them');
});

test('every published public skill without a cover has a file that names its command', () => {
  const root = new URL('../members/', import.meta.url).pathname;
  let checked = 0;
  for (const member of fs.readdirSync(root)) {
    const dir = path.join(root, member, 'prompts');
    if (!fs.existsSync(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const file = path.join(dir, slug, 'index.md');
      if (!fs.existsSync(file)) continue;
      const fm = yaml.load(/^---\r?\n([\s\S]*?)\r?\n---/.exec(fs.readFileSync(file, 'utf8'))?.[1] || '') || {};
      if (fm.kind !== 'skill' || fm.status !== 'published' || fm.image || fm.encryptedSkill) continue;
      const skill = path.join(dir, slug, 'SKILL.md');
      assert.ok(fs.existsSync(skill), `${member}/${slug} has a SKILL.md`);
      assert.ok(skillNameFrom(fs.readFileSync(skill, 'utf8')), `${member}/${slug} SKILL.md declares a name`);
      checked += 1;
    }
  }
  assert.ok(checked >= 1, 'at least one skill without a cover was checked (the /CI tile is one)');
});
