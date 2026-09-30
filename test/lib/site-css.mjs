// The site's design system as ONE text, in the order src/styles/global.css loads it. gbti-v3.css was split into ordered
// parts at the 900-line limit (owner, 2026-09-30), and a test that read only the first part would quietly stop seeing
// every rule that moved: a check that something is ABSENT would pass on nothing, and an order check would compare
// rules from different files. Read the stylesheet through this instead of by path.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.
import fs from 'node:fs';

const STYLES = new URL('../../src/styles/', import.meta.url);

/** The design-system files, in load order, read from global.css's `@import "./gbti-v3*.css"` lines. */
export function siteCssFiles() {
  const global = fs.readFileSync(new URL('global.css', STYLES), 'utf8');
  const files = [...global.matchAll(/^@import "\.\/(gbti-v3[\w-]*\.css)";/gm)].map((m) => m[1]);
  if (files[0] !== 'gbti-v3.css' || files.length < 2) {
    throw new Error(`site-css: global.css no longer imports gbti-v3.css and its parts (found ${JSON.stringify(files)}), so this helper would check nothing`);
  }
  return files;
}

/** Every design-system file, joined in load order. */
export function siteCss() {
  return siteCssFiles().map((f) => fs.readFileSync(new URL(f, STYLES), 'utf8')).join('\n');
}
