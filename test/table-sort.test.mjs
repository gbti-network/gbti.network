// sow-470: a table earns sort controls, it is not given them.
//
// The census at the bottom is the point of this file. The rule was written against a measurement of the real
// corpus (13 tables in 332 content files, exactly one of them a ranked numeric table), so the test re-takes
// that measurement rather than trusting a fixture: if someone loosens the rule, the count moves and this goes
// red naming the tables that newly qualify.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parseNumericCell, isNumericColumn, qualifiesForSorting, numericColumns, sortedOrder, nextDirection,
  MIN_SORTABLE_ROWS,
} from '../src/lib/table-sort.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('a cell that is not a number reads as null, and an empty strip is NOT zero', () => {
  // The trap this whole rule turns on. '§a' strips to '', and Number('') is 0, so a naive parser calls a
  // column of Minecraft colour codes numeric. There is a real 16-row table of exactly these in the corpus.
  assert.equal(parseNumericCell('`§a`'), null);
  assert.equal(parseNumericCell('§f'), null);
  assert.equal(parseNumericCell(''), null);
  assert.equal(parseNumericCell('   '), null);
  assert.equal(parseNumericCell('-'), null);
  assert.equal(parseNumericCell('—'), null); // an em dash standing in for "no value"
  assert.equal(parseNumericCell('.'), null);
  assert.equal(parseNumericCell('Cloudflare'), null);
});

test('the number formats the corpus actually contains', () => {
  assert.equal(parseNumericCell('36,254,891'), 36254891);
  assert.equal(parseNumericCell('21.66%'), 21.66);
  assert.equal(parseNumericCell('$1,200.50'), 1200.50);
  assert.equal(parseNumericCell('  7,831,569  '), 7831569);
  assert.equal(parseNumericCell('-12.5'), -12.5);
  assert.equal(parseNumericCell('−3.1'), -3.1); // a real minus sign, not a hyphen
  assert.equal(parseNumericCell('0'), 0);
  assert.equal(parseNumericCell('`§0`'), 0); // this one IS a number; it is the rest of the column that saves us
});

test('a column is numeric only when EVERY cell is, so one stray label disqualifies it', () => {
  assert.equal(isNumericColumn(['1', '2', '3']), true);
  assert.equal(isNumericColumn(['1', '2', 'n/a']), false);
  assert.equal(isNumericColumn(['`§0`', '`§9`', '`§a`']), false); // the colour-code column, as it really is
  assert.equal(isNumericColumn([]), false);
});

test('a two-column reference table does not qualify, however many rows it has', () => {
  // "Code | Color Name", 16 rows, the nearest miss in the corpus.
  const rows = [['`§0`', 'Black'], ['`§1`', 'Dark Blue'], ['`§9`', 'Blue'], ['`§a`', 'Green'],
    ['`§b`', 'Aqua'], ['`§c`', 'Red'], ['`§d`', 'Light Purple'], ['`§e`', 'Yellow']];
  assert.equal(qualifiesForSorting({ header: ['Code', 'Color Name'], rows }), false);
});

test('a ranked numeric table qualifies, and its numeric columns are found', () => {
  const header = ['Rank', 'Provider', 'Names', 'Share of the zone'];
  const rows = [
    ['1', 'GoDaddy', '36,254,891', '21.66%'],
    ['2', 'Cloudflare', '21,649,792', '12.94%'],
    ['3', 'Google Domains', '7,831,569', '4.68%'],
    ['4', 'Namecheap', '6,126,924', '3.66%'],
    ['5', 'dns-parking.com', '5,217,859', '3.12%'],
  ];
  assert.equal(qualifiesForSorting({ header, rows }), true);
  assert.deepEqual(numericColumns({ header, rows }), [0, 2, 3]); // not Provider
});

test('too few rows does not qualify, and the threshold is the stated one', () => {
  const header = ['Rank', 'Count'];
  const four = [['1', '10'], ['2', '9'], ['3', '8'], ['4', '7']];
  assert.equal(four.length, MIN_SORTABLE_ROWS - 1);
  assert.equal(qualifiesForSorting({ header, rows: four }), false);
  assert.equal(qualifiesForSorting({ header, rows: [...four, ['5', '6']] }), true);
});

test('the author override wins in both directions', () => {
  const header = ['Step', 'What to do'];
  const steps = [['1', 'Install'], ['2', 'Sign in'], ['3', 'Publish'], ['4', 'Check'], ['5', 'Done']];
  // An ordered table whose first column happens to be numeric would otherwise qualify. Sorting a list of
  // steps alphabetically produces nonsense, so 'off' has to be able to stop it.
  assert.equal(qualifiesForSorting({ header, rows: steps }), true);
  assert.equal(qualifiesForSorting({ header, rows: steps, override: 'off' }), false);
  // And a short table an author genuinely wants sorted gets it.
  assert.equal(qualifiesForSorting({ header, rows: steps.slice(0, 2), override: 'on' }), true);
  // 'on' still cannot invent a table out of nothing.
  assert.equal(qualifiesForSorting({ header, rows: [], override: 'on' }), false);
  assert.equal(qualifiesForSorting({ header: [], rows: steps, override: 'on' }), false);
});

test('sorting returns indices into the original rows, and numbers sort as numbers', () => {
  const rows = [['b', '7,000'], ['a', '900'], ['c', '10,000']];
  // The defect a text sort gives you: '10,000' < '7,000' < '900' as strings.
  assert.deepEqual(sortedOrder({ rows, column: 1, dir: 'asc' }), [1, 0, 2]);
  assert.deepEqual(sortedOrder({ rows, column: 1, dir: 'desc' }), [2, 0, 1]);
  assert.deepEqual(sortedOrder({ rows, column: 0, dir: 'asc' }), [1, 0, 2]);
});

test('the third state gives the author order back, untouched', () => {
  const rows = [['b'], ['a'], ['c']];
  assert.deepEqual(sortedOrder({ rows, column: 0, dir: 'none' }), [0, 1, 2]);
  assert.deepEqual(sortedOrder({ rows, column: 0 }), [0, 1, 2]);
  assert.equal(nextDirection('asc'), 'desc');
  assert.equal(nextDirection('desc'), 'none');
  assert.equal(nextDirection('none'), 'asc');
  assert.equal(nextDirection(undefined), 'asc');
});

test('equal values keep the order the author wrote them in, in BOTH directions', () => {
  const rows = [['first', '5'], ['second', '5'], ['third', '5']];
  assert.deepEqual(sortedOrder({ rows, column: 1, dir: 'asc' }), [0, 1, 2]);
  // Reversing the whole comparator, tiebreak included, silently rewrites a table of equal values.
  assert.deepEqual(sortedOrder({ rows, column: 1, dir: 'desc' }), [0, 1, 2]);
});

test('a blank text cell sinks in both directions too', () => {
  const rows = [['b'], [''], ['a']];
  assert.deepEqual(sortedOrder({ rows, column: 0, dir: 'asc' }), [2, 0, 1]);
  assert.deepEqual(sortedOrder({ rows, column: 0, dir: 'desc' }), [0, 2, 1]);
});

test('a non-number inside a numeric sort sinks, rather than sorting as zero', () => {
  const rows = [['a', '10'], ['b', 'n/a'], ['c', '5']];
  const asc = sortedOrder({ rows, column: 1, dir: 'asc', numeric: true });
  assert.equal(asc[asc.length - 1], 1, 'the n/a row is last ascending');
  const desc = sortedOrder({ rows, column: 1, dir: 'desc', numeric: true });
  assert.equal(desc[desc.length - 1], 1, 'and last descending too, not first');
});

// --- the census -------------------------------------------------------------------------------------------

/** Every GFM table in the content corpus, as { file, header, rows }. */
function corpusTables() {
  const out = [];
  const sep = /^\s*\|?[\s:-]*-{2,}[\s:|-]*\|/;
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        const lines = fs.readFileSync(p, 'utf8').split('\n');
        for (let i = 0; i < lines.length; i += 1) {
          if (!lines[i].trimStart().startsWith('|') || !sep.test(lines[i + 1] || '')) continue;
          const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
          const header = cells(lines[i]);
          const rows = [];
          let j = i + 2;
          while (j < lines.length && lines[j].trimStart().startsWith('|')) { rows.push(cells(lines[j])); j += 1; }
          out.push({ file: path.relative(ROOT, p), header, rows });
          i = j;
        }
      }
    }
  };
  walk(path.join(ROOT, 'members'));
  walk(path.join(ROOT, 'house'));
  return out;
}

test('census: the rule lights up the ranked tables in the corpus and leaves the reference tables alone', () => {
  const tables = corpusTables();
  // A census that found nothing would pass every assertion below it. Refuse to be vacuous.
  assert.ok(tables.length >= 10, `expected to find the corpus tables, found ${tables.length}`);

  const qualify = tables.filter((t) => qualifiesForSorting({ header: t.header, rows: t.rows }));
  const two = tables.filter((t) => t.header.length <= 2);
  assert.ok(two.length >= 5, `expected the two-column reference tables to be present, found ${two.length}`);

  // No two-column reference table in the corpus earns sort controls. This is the half that would break first
  // if the rule were loosened, and it is the half the owner chose the rule for.
  for (const t of two) {
    assert.equal(qualifiesForSorting({ header: t.header, rows: t.rows }), false,
      `a two-column table should not qualify: ${t.file} (${t.header.join(' | ')})`);
  }

  // And the ranked table that prompted the work does.
  const ranked = tables.find((t) => t.header[0] === 'Rank' && t.header.includes('Share of the zone'));
  assert.ok(ranked, 'the DNS providers table is in the corpus');
  assert.equal(qualifiesForSorting({ header: ranked.header, rows: ranked.rows }), true);

  // Keep the blast radius honest: if a change starts lighting up many more tables, read the list before
  // accepting it. The number is small by design, not by accident.
  assert.ok(qualify.length <= 3,
    `sorting should stay rare; it now qualifies ${qualify.length} tables: ${qualify.map((t) => t.file).join(', ')}`);
});
