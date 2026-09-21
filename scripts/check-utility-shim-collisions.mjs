#!/usr/bin/env node
// Build guard (sow-351): a Tailwind variant can never override the unlayered utility shim, so any element
// carrying both is silently stuck in one state.
//
// WHAT WENT WRONG. src/styles/gbti-v3.css defines a small shim near the end of the file: `.flex`, `.grid`,
// `.items-center`, `.items-start`, `.items-end`, `.justify-between`, `.justify-center` and `.relative`, all
// OUTSIDE any cascade layer. Tailwind emits its own utilities inside `@layer utilities`, and an unlayered
// rule beats a layered one whatever the source order or media query. So on an element with `justify-center`,
// a `sm:justify-start` beside it can never apply.
//
// The member profile header asked for a desktop layout on seven elements and received it on none of them,
// from the day it was written until 2026-09-20. It did not look broken in the stylesheet, in the markup, or
// in review: both rules are present and correct, and only the computed value on a real page disagrees. That
// is why this is a guard and not a note.
//
// THE SHIM IS NOT REMOVED, DELIBERATELY. 356 of the 973 rules in that stylesheet set one of the same four
// properties and are also unlayered. Today they and the shim settle ties by source order; delete the shim
// entries and Tailwind's layered utilities lose to every one of them instead. That is a site-wide precedence
// change to fix a one-page bug. The fix was local (`max-sm:` variants, which have no unlayered twin) and this
// guard exists because the cause is still there for the next element that meets it.
//
// SELF-UPDATING. The shimmed names are read from gbti-v3.css itself, not copied here. Remove an entry from
// the shim and this guard stops flagging that property, with no edit.
//
//   node scripts/check-utility-shim-collisions.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Tailwind's utility names for the four properties the shim touches. A collision can only be between two
// tokens in the SAME group; `flex` (display) beside `flex-col` (flex-direction) is not one.
export const GROUPS = {
  display: ['block', 'inline-block', 'inline', 'flex', 'inline-flex', 'grid', 'inline-grid', 'contents', 'hidden', 'table', 'flow-root'],
  'align-items': ['items-start', 'items-end', 'items-center', 'items-baseline', 'items-stretch'],
  'justify-content': ['justify-normal', 'justify-start', 'justify-end', 'justify-center', 'justify-between', 'justify-around', 'justify-evenly', 'justify-stretch'],
  position: ['static', 'fixed', 'absolute', 'relative', 'sticky'],
};

const groupOf = (name) => Object.keys(GROUPS).find((g) => GROUPS[g].includes(name)) || null;

/** Strip a variant prefix (`sm:`, `max-sm:`, `dark:`, `hover:md:` ...) and any `!` marker. */
export function baseName(token) {
  const t = String(token).replace(/^!/, '');
  const i = t.lastIndexOf(':');
  return i === -1 ? t : t.slice(i + 1);
}

/**
 * Which Tailwind-named utilities the stylesheet defines as bare, unlayered class selectors. Pure over the CSS
 * text so it is testable without the real file.
 */
export function shimmedNames(css) {
  const found = new Set();
  for (const g of Object.keys(GROUPS)) {
    for (const name of GROUPS[g]) {
      // A standalone class selector for that exact name: `.flex {` or `.items-center{`, not `.flex-col` and
      // not `.foo .flex`. The escape keeps a hyphenated name from reading as a range.
      const re = new RegExp(String.raw`(^|[},;\n])\s*\.${name.replace(/-/g, '\\-')}\s*\{`, 'm');
      if (re.test(css)) found.add(name);
    }
  }
  return found;
}

/** Every static class list in a source file, with its line number. */
export function classLists(source) {
  const out = [];
  const re = /class(?:Name)?\s*=\s*"([^"]*)"/g;
  for (const m of source.matchAll(re)) {
    const line = source.slice(0, m.index).split('\n').length;
    out.push({ line, value: m[1] });
  }
  return out;
}

/**
 * Collisions in one class list: a BARE shimmed token, plus another token in the same property group. The
 * other token may be variant-prefixed (the real case) or bare (a plain conflict the shim also wins).
 */
export function collisionsIn(value, shimmed) {
  const tokens = String(value).split(/\s+/).filter(Boolean);
  // `{...}` expressions are not static text; skip a list that carries one rather than guessing at it.
  if (tokens.some((t) => t.includes('{') || t.includes('}'))) return [];
  const out = [];
  for (const t of tokens) {
    // Only a BARE token can be the shimmed side: the shim holds bare names, so a variant never matches this.
    if (!shimmed.has(t)) continue;
    const g = groupOf(t);
    for (const other of tokens) {
      if (other === t) continue;
      const b = baseName(other);
      if (b === t || groupOf(b) !== g) continue;
      out.push({ shimmed: t, beaten: other, property: g });
    }
  }
  return out;
}

function walk(dir, exts) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

/** Scan a source tree. Returns { errors, scanned } where scanned is the number of class lists read. */
export function checkTree({ root, cssFile, srcDir } = {}) {
  const errors = [];
  const css = fs.readFileSync(cssFile, 'utf8');
  const shimmed = shimmedNames(css);
  if (shimmed.size === 0) {
    // The shim is gone, so the whole class of bug is gone with it. Say so rather than passing silently, since
    // a zero here and a zero from a broken scan look identical.
    return { errors, scanned: 0, shimmed, note: `${path.basename(cssFile)} defines no bare Tailwind-named utilities any more, so this guard has nothing to protect against. If that was deliberate, delete this guard.` };
  }
  let scanned = 0;
  for (const f of walk(srcDir, ['.astro', '.html', '.tsx', '.jsx'])) {
    for (const { line, value } of classLists(fs.readFileSync(f, 'utf8'))) {
      scanned += 1;
      for (const c of collisionsIn(value, shimmed)) {
        errors.push(`${path.relative(root, f)}:${line}: "${c.beaten}" can never apply: "${c.shimmed}" is defined unlayered in ${path.basename(cssFile)} and beats every layered utility for ${c.property}. Use the inverse variant (max-sm:) instead of a base plus an override.`);
      }
    }
  }
  if (scanned === 0) errors.push(`no class attributes were read under ${path.relative(root, srcDir)}, so this guard had no subjects and proved nothing (sow-245).`);
  return { errors, scanned, shimmed };
}

// CLI
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
  const { errors, scanned, shimmed, note } = checkTree({
    root: ROOT,
    cssFile: path.join(ROOT, 'src/styles/gbti-v3.css'),
    srcDir: path.join(ROOT, 'src'),
  });
  if (note) { console.log('· ' + note); process.exit(0); }
  if (errors.length) {
    console.error(`✗ utility shim collisions (${errors.length}):`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`✓ no utility shim collisions (${scanned} class lists, ${shimmed.size} shimmed names)`);
}
