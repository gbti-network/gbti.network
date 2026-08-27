#!/usr/bin/env node
// sow-271 build guard: the extension-CTA site setting must actually govern the built HTML, in BOTH positions.
//
// Why this exists. The toggle gates four-plus separate components, and nothing about adding a fifth advertising
// surface next month reminds anyone that a switch governs the others. A one-directional check ("nothing shows
// when it is off") would also pass a change that simply deleted every surface, so this asserts the other half
// too: when the setting is ON, every marker must be back. A toggle only ever proven in one position is not a
// proven toggle.
//
// Honest limitation, stated rather than implied: this checks a FIXED list of markers. It cannot recognise a new
// advertising surface it has never been told about, so adding one means adding its marker here. What it does
// catch is the more likely regression -- an existing surface quietly losing its gate, or the gate breaking. To
// keep the list from rotting silently, a marker that appears NOWHERE while the setting is ON is reported as
// stale, because a marker matching nothing is a check that proves nothing.
//   node scripts/check-extension-cta.mjs
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { fileURLToPath } from 'node:url';
import { readToggle } from '../membership/site-settings-edits.mjs';

// Each entry: a label, and a literal HTML substring that appears ONLY when that advertising surface renders.
// Markers are matched against .html files only -- the Header bundle carries the string ".hm-download" as a
// querySelector argument, which is not a rendered advert, and matching it would be the "grep found the word so
// the thing must be there" mistake.
export const CTA_MARKERS = [
  ['the header "Get Extension" nav item', '>Get Extension<'],
  ['the homepage Add-to-Chrome banner', 'class="xbn"'],
  ['the sign-in modal "Get the extension" footnote', 'Get the extension</a> to edit'],
  ['the header "Get the extension to continue" download nudge', 'class="hm-item hm-download"'],
  ['the archived v1 homepage extension band', 'id="newtab"'],
];

// Surfaces the toggle deliberately does NOT govern. If one of these vanishes, the change went too far: hiding a
// capability notice leaves the control it explains dead AND silent, which is worse than either state alone.
export const MUST_SURVIVE = [
  ['the "Extension required" capability notices', 'Extension required'],
];

/** Walk dist for .html files. Pure over the directory so it is testable against a hand-built temp dist. */
function htmlFiles(dir, out = []) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) htmlFiles(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

/**
 * Check the built HTML against the setting. Pure over { root, distDir, ctaEnabled } so a test can drive both
 * positions without a real build. Returns { errors, notes, checked }.
 */
export function checkExtensionCta({ distDir, ctaEnabled }) {
  const errors = [];
  const notes = [];
  const files = htmlFiles(distDir);

  // ZERO COVERAGE IS A FAILURE. A guard that finds no subjects and exits 0 reports an assurance nobody holds;
  // that exact shape shipped once in check-article-closing-slot.mjs and went unnoticed because it printed a
  // cheerful pass line. If there is no built HTML, say so and fail.
  if (!files.length) {
    errors.push('no built HTML found in dist/ -- run the build before this guard, since it can prove nothing without it.');
    return { errors, notes, checked: 0 };
  }

  const hits = new Map(); // label -> [files]
  for (const f of files) {
    const html = fs.readFileSync(f, 'utf8');
    for (const [label, marker] of CTA_MARKERS) {
      if (html.includes(marker)) {
        if (!hits.has(label)) hits.set(label, []);
        hits.get(label).push(path.relative(distDir, f));
      }
    }
  }

  if (!ctaEnabled) {
    for (const [label] of CTA_MARKERS) {
      const found = hits.get(label);
      if (found && found.length) {
        errors.push(
          `the extension CTA is switched OFF in house/site-settings.yml, but ${label} still renders on ` +
          `${found.length} page${found.length === 1 ? '' : 's'} (e.g. ${found[0]}). ` +
          `That surface is not consulting extensionCtaEnabled() from src/lib/site-settings.ts.`,
        );
      }
    }
  } else {
    // Setting ON: every marker must come back, or the surface is broken independently of the toggle.
    for (const [label] of CTA_MARKERS) {
      if (!hits.get(label)?.length) {
        errors.push(
          `the extension CTA is switched ON, but ${label} renders on NO page. Either that surface broke, or its ` +
          `marker in scripts/check-extension-cta.mjs went stale and is now checking nothing.`,
        );
      }
    }
  }

  // The surfaces the toggle must never touch, checked in BOTH positions.
  for (const [label, marker] of MUST_SURVIVE) {
    const n = files.filter((f) => fs.readFileSync(f, 'utf8').includes(marker)).length;
    if (!n) {
      errors.push(
        `${label} render on NO page. The extension-CTA setting must NOT govern these: they explain a control ` +
        `that currently does nothing, and hiding them leaves that control dead and silent.`,
      );
    } else {
      notes.push(`${label}: present on ${n} page${n === 1 ? '' : 's'} (correctly untouched by the setting).`);
    }
  }

  return { errors, notes, checked: files.length };
}

/** Read the setting the same way the build does, so the guard and the site can never disagree. */
export function readCtaSetting(root) {
  const file = path.join(root, 'house', 'site-settings.yml');
  if (!fs.existsSync(file)) return readToggle({}, 'extension_cta');
  return readToggle(yaml.load(fs.readFileSync(file, 'utf8')) || {}, 'extension_cta');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const ctaEnabled = readCtaSetting(ROOT);
  const { errors, notes, checked } = checkExtensionCta({ distDir: path.join(ROOT, 'dist'), ctaEnabled });
  for (const n of notes) console.log('· ' + n);
  if (errors.length) {
    console.error(`✗ extension-CTA guard failed (setting is ${ctaEnabled ? 'ON' : 'OFF'}, ${errors.length} issue${errors.length === 1 ? '' : 's'} across ${checked} pages):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ extension-CTA guard passed (setting is ${ctaEnabled ? 'ON' : 'OFF'}, ${checked} pages checked)`);
}
