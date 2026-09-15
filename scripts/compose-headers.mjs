#!/usr/bin/env node
// sow-337: compose the SERVED header file. `public/_headers` stays the committed base (the site policy, the /embed
// relay, the eval tool); this script appends one rule per built page that shows a call-to-action HTML block with
// outside addresses, and writes the result to `dist/_headers` AFTER the Astro build (which copied the base there).
// The rules and their limits live in scripts/lib/cta-headers.mjs; scripts/check-headers.mjs recomputes them and
// requires an exact match. Runs in build:pages after compose-redirects and before verify:dist, and in the weekly
// layout guard before the browser policy check.
//   node scripts/compose-headers.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCtas } from './lib/ctas-store.mjs';
import { composeCardHeaders, scanHtmlCardPages } from './lib/cta-headers.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

export function main({ root = ROOT } = {}) {
  const distDir = path.join(root, 'dist');
  if (!fs.existsSync(distDir)) {
    console.error('compose-headers: dist/ is missing; run `astro build` first.');
    process.exitCode = 1;
    return { rules: [] };
  }
  const base = fs.readFileSync(path.join(root, 'public/_headers'), 'utf8');
  const { text, rules, problems } = composeCardHeaders(base, scanHtmlCardPages(distDir), readCtas(root, { fresh: true }));
  if (problems.length) {
    console.error(`compose-headers: the call-to-action page policies cannot be written (${problems.length} problem${problems.length === 1 ? '' : 's'}):`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exitCode = 1;
    return { rules: [], problems };
  }
  fs.writeFileSync(path.join(distDir, '_headers'), text);
  console.log(`compose-headers: wrote dist/_headers (${rules.length} page polic${rules.length === 1 ? 'y' : 'ies'} for call-to-action HTML blocks${rules.length ? `: ${rules.map((r) => r.path).join(', ')}` : ''}).`);
  return { rules };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
