#!/usr/bin/env node
// sow-470: a table in a built article has a scroll wrapper and real cell padding.
//
// The defect this guards is not hypothetical and not subtle: the site shipped with ONE rule for a table, a
// scroll container, and no padding at all, so "36,254,891" printed flush against "21.66%" on a live article
// until a member sent a screenshot of it. A source assertion would not have caught it, because the source was
// not wrong; there was simply nothing there. So this reads dist.
//
// Two-sided on purpose, which sow-248 learned the hard way with a sampler that checked one page: a guard that
// finds no tables passes everything, so finding none is itself a failure.
import fs from 'node:fs';
import path from 'node:path';

const DIST = path.resolve(process.argv[2] || 'dist');
const MIN_TABLE_PAGES = 5; // the corpus had tables on 12 pages when this was written

/** Every built html file under dist. */
function pages(dir, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pages(p, out);
    else if (e.name.endsWith('.html')) out.push(p);
  }
  return out;
}

const html = pages(DIST);
if (!html.length) {
  console.error(`check-tables: no built pages under ${DIST}. Run the build first.`);
  process.exit(1);
}

const problems = [];
let withTable = 0;
let tables = 0;
let wrapped = 0;

for (const file of html) {
  const text = fs.readFileSync(file, 'utf8');
  // Only tables inside rendered prose are ours; a layout table in page chrome is not in scope.
  const proseAt = text.indexOf('prose-gbti');
  if (proseAt === -1) continue;
  const body = text.slice(proseAt);
  const count = (body.match(/<table[\s>]/g) || []).length;
  if (!count) continue;
  withTable += 1;
  tables += count;
  const inWrapper = (body.match(/class="table-scroll"><table[\s>]/g) || []).length;
  wrapped += inWrapper;
  if (inWrapper < count) {
    problems.push(`${path.relative(DIST, file)}: ${count - inWrapper} of ${count} table(s) have no .table-scroll wrapper`);
  }
}

// The styling itself lives in one built stylesheet; if the rule is gone, every table on the site is unpadded.
const css = pages(DIST).length ? fs.readdirSync(path.join(DIST, '_astro')).filter((f) => f.endsWith('.css')) : [];
const allCss = css.map((f) => fs.readFileSync(path.join(DIST, '_astro', f), 'utf8')).join('\n');
// The padding has to be NON-ZERO, and that is the whole point: `padding:0` is exactly the state the site
// shipped in, and a looser pattern here passed a build whose padding had been zeroed when it was mutation
// tested. Read the declaration and check the number.
const cellMatch = /\.prose-gbti th\s*,\s*\.prose-gbti td\s*\{([^}]*)\}/.exec(allCss);
const padding = cellMatch && /(?:^|;)\s*padding:\s*([^;]+)/.exec(cellMatch[1]);
const nonZero = padding && /(?:^|\s)(?!0(?:px|em|rem)?(?:\s|$))\d*\.?\d+(?:px|em|rem|%)?/.test(padding[1])
  && !/^\s*0(?:px|em|rem)?\s*$/.test(padding[1]);
if (!cellMatch) {
  problems.push('the built CSS has no `.prose-gbti th, .prose-gbti td` rule at all: every table on the site renders with its columns touching');
} else if (!nonZero) {
  problems.push(`.prose-gbti th/td padding is \`${(padding && padding[1] || 'unset').trim()}\`, so adjacent columns touch (this is the defect sow-470 fixed)`);
}
if (!/\.prose-gbti thead th\{[^}]*border-bottom/.test(allCss)) {
  problems.push('the built CSS has no header rule for .prose-gbti thead th');
}

if (withTable < MIN_TABLE_PAGES) {
  console.error(`check-tables: only ${withTable} page(s) with a prose table found, expected at least ${MIN_TABLE_PAGES}.`);
  console.error('A guard that finds nothing passes everything. Either the build is partial or this check is looking in the wrong place.');
  process.exit(1);
}

if (problems.length) {
  console.error('check-tables FAILED:');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

console.log(`check-tables: ${tables} table(s) across ${withTable} page(s), all wrapped (${wrapped}), cell padding and header rule present.`);
