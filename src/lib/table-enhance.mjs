// sow-470: the DOM half of article table sorting. The decisions all live in table-sort.mjs, which is pure and
// unit tested; this file only reads the table, asks that module, and moves rows.
//
// Progressive enhancement, deliberately: the table is plain HTML from the markdown and the scroll wrapper is
// built at build time, so a reader with JavaScript off gets a correctly styled table in the order the author
// wrote it. Everything here is an addition on top of something that already works.

import { qualifiesForSorting, numericColumns, sortedOrder, nextDirection } from './table-sort.mjs';

const CHEVRON = '<svg class="tsort-ind" width="9" height="6" viewBox="0 0 9 6" fill="none" aria-hidden="true"><path d="M1 1.25 4.5 4.75 8 1.25" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** The visible text of a cell, which is what the author sees and therefore what sorting should follow. */
const cellText = (td) => (td?.textContent || '').trim();

/** Header cells, body rows, and the row elements, read once. */
function readTable(table) {
  const headRow = table.tHead?.rows?.[0] || null;
  const header = headRow ? Array.from(headRow.cells).map(cellText) : [];
  const bodyRows = Array.from(table.tBodies?.[0]?.rows || []);
  const rows = bodyRows.map((tr) => Array.from(tr.cells).map(cellText));
  return { headRow, header, bodyRows, rows };
}

/**
 * Right-align the columns that hold figures, on tabular numerals, so the digits stack and a column can be
 * read down its length. This happens whether or not the table earns sorting: a two-column reference table
 * with a count in it still reads better with the count aligned.
 */
function markNumericColumns(table, { header, rows, bodyRows, headRow }) {
  for (const i of numericColumns({ header, rows })) {
    headRow?.cells?.[i]?.classList.add('tnum');
    for (const tr of bodyRows) tr.cells?.[i]?.classList.add('tnum');
  }
}

/**
 * Paint the right-edge fade only while there is somewhere still to scroll.
 *
 * The flag goes on the OUTER wrapper because that is where the fade is: a pseudo-element inside the scroller
 * is positioned against the scrolled content and ends up off-screen.
 */
function trackOverflow(scroller) {
  const wrap = scroller?.closest('.table-wrap');
  if (!scroller || !wrap) return;
  const update = () => {
    const over = scroller.scrollWidth - scroller.clientWidth > 1
      && scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 1;
    wrap.setAttribute('data-overflow', over ? '1' : '0');
  };
  update();
  scroller.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver === 'function') new ResizeObserver(update).observe(scroller);
  else window.addEventListener('resize', update);
}

/** Turn each header cell into a real button carrying the sort state on its th. */
function addSorting(table, parts) {
  const { headRow, header, rows, bodyRows } = parts;
  const tbody = table.tBodies?.[0];
  if (!tbody || !headRow) return;
  const numeric = new Set(numericColumns({ header, rows }));
  let activeCol = -1;
  let dir = 'none';

  const caption = table.querySelector('caption') || table.insertBefore(document.createElement('caption'), table.firstChild);
  caption.classList.add('tsort-cap');

  const apply = () => {
    const order = dir === 'none' ? rows.map((_, i) => i) : sortedOrder({ rows, column: activeCol, dir, numeric: numeric.has(activeCol) });
    // One fragment, so the table reflows once rather than once per row.
    const frag = document.createDocumentFragment();
    for (const i of order) frag.appendChild(bodyRows[i]);
    tbody.appendChild(frag);
    Array.from(headRow.cells).forEach((th, i) => {
      const on = i === activeCol && dir !== 'none';
      th.setAttribute('aria-sort', on ? (dir === 'asc' ? 'ascending' : 'descending') : 'none');
      th.querySelector('.tsort-btn')?.classList.toggle('on', on);
      th.querySelector('.tsort-btn')?.classList.toggle('asc', on && dir === 'asc');
    });
    caption.textContent = dir === 'none'
      ? 'Click a heading to sort this table.'
      : `Sorted by ${header[activeCol] || `column ${activeCol + 1}`}, ${dir === 'asc' ? 'lowest first' : 'highest first'}. Click again to reverse, once more for the original order.`;
  };

  Array.from(headRow.cells).forEach((th, i) => {
    const label = cellText(th);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'tsort-btn';
    // The label is the author's text and is inserted as TEXT, never as markup.
    const span = document.createElement('span');
    span.textContent = label;
    btn.appendChild(span);
    btn.insertAdjacentHTML('beforeend', CHEVRON);
    btn.addEventListener('click', () => {
      if (i === activeCol) dir = nextDirection(dir);
      else { activeCol = i; dir = 'asc'; }
      if (dir === 'none') activeCol = -1;
      apply();
    });
    th.textContent = '';
    th.appendChild(btn);
    th.setAttribute('aria-sort', 'none');
  });

  apply();
}

/**
 * Enhance every table inside `root`.
 *
 * `root` is a rendered prose container. Safe to call twice: a table already enhanced is skipped.
 */
export function enhanceTables(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('table').forEach((table) => {
    if (table.dataset.tsort === 'done') return;
    table.dataset.tsort = 'done';
    const parts = readTable(table);
    markNumericColumns(table, parts);
    trackOverflow(table.closest('.table-scroll'));
    const override = table.getAttribute('data-sort');
    if (qualifiesForSorting({ header: parts.header, rows: parts.rows, override })) addSorting(table, parts);
  });
}
