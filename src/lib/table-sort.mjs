// sow-470: whether a table in an article earns sort controls, and how its columns compare.
//
// Pure on purpose. The DOM half lives in the Prose enhancer, which cannot be unit tested without a browser;
// everything that decides anything lives here, where `node --test` reaches it.
//
// WHY A TABLE HAS TO EARN IT. Measured over the whole corpus on 2026-10-23: 13 tables in 332 content files,
// of which exactly ONE is a ranked numeric table. Seven are two-column reference tables ("Command | What it
// does"), and one has a single row in it. Putting a sort control on every heading on the site would decorate
// twelve tables where sorting means nothing, so the rule below asks for evidence that sorting is useful:
// enough rows to be worth reordering, and at least one column that is numbers the whole way down.

/** A table needs at least this many body rows before sorting it is worth offering. */
export const MIN_SORTABLE_ROWS = 5;

/**
 * The number a cell holds, or null when it does not hold one.
 *
 * THE TRAP, and the reason this is not a one-liner: `Number('')` is `0`, not `NaN`. Strip the non-numeric
 * characters out of "§a" and you are left with an empty string, which a naive parser reads as the number
 * zero, which makes a column of Minecraft colour codes (§0 through §f, a real 16-row table in the corpus)
 * look numeric and win sort controls it should never have. An empty result is NOT a zero, so it returns null.
 *
 * Handles what the corpus actually contains: thousands separators, percent signs, currency, and a leading
 * minus. A bare "-" or an em dash standing in for "no value" is not a number either.
 */
export function parseNumericCell(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  // Keep digits, one decimal point, and a leading sign. Everything else (commas, %, $, £, spaces, letters,
  // backticks) goes. The sign is read before stripping, because the strip would eat it.
  const negative = /^[-−]/.test(raw);
  const cleaned = raw.replace(/[^0-9.]/g, '');
  if (!cleaned || !/[0-9]/.test(cleaned)) return null; // '' or '.' or '...' are not numbers
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** True when every one of these cells parses as a number. An empty column is not numeric. */
export function isNumericColumn(cells) {
  const list = Array.isArray(cells) ? cells : [];
  if (!list.length) return false;
  return list.every((c) => parseNumericCell(c) !== null);
}

/**
 * Does this table earn sort controls?
 *
 * `header` is the header labels, `rows` the body rows as arrays of cell text, and `override` the author's
 * `<!-- sort: on|off -->` marker when there is one. The override wins outright in both directions: an author
 * who asks for sorting on a three-row table gets it, and one who marks an ordered table (a list of steps,
 * where reordering produces nonsense) keeps its order whatever the shape says.
 */
export function qualifiesForSorting({ header, rows, override } = {}) {
  if (override === 'off') return false;
  const head = Array.isArray(header) ? header : [];
  const body = Array.isArray(rows) ? rows : [];
  if (!head.length) return false;              // nothing to put a control on
  if (override === 'on') return body.length > 0;
  if (body.length < MIN_SORTABLE_ROWS) return false;
  return head.some((_, i) => isNumericColumn(body.map((r) => (Array.isArray(r) ? r[i] : undefined))));
}

/** The columns that hold numbers, by index, so the renderer can right-align them on tabular figures. */
export function numericColumns({ header, rows } = {}) {
  const head = Array.isArray(header) ? header : [];
  const body = Array.isArray(rows) ? rows : [];
  return head.map((_, i) => i).filter((i) => isNumericColumn(body.map((r) => (Array.isArray(r) ? r[i] : undefined))));
}

/**
 * The order the rows should appear in, as indices into the ORIGINAL rows.
 *
 * Indices rather than rows, so the caller can move real DOM nodes and keep whatever is inside them (links,
 * code, images) rather than re-rendering text. `dir` of 'none' returns the author's order, which is what the
 * third click restores and is otherwise unreachable once a reader has sorted.
 */
export function sortedOrder({ rows, column, dir, numeric } = {}) {
  const body = Array.isArray(rows) ? rows : [];
  const order = body.map((_, i) => i);
  if (dir !== 'asc' && dir !== 'desc') return order;
  const isNum = numeric === undefined
    ? isNumericColumn(body.map((r) => (Array.isArray(r) ? r[column] : undefined)))
    : Boolean(numeric);
  const cell = (i) => (Array.isArray(body[i]) ? body[i][column] : undefined);
  /** The sortable value, or null when this cell holds nothing to sort by in this mode. */
  const valueAt = (i) => {
    if (isNum) return parseNumericCell(cell(i));
    const s = String(cell(i) ?? '').trim();
    return s === '' ? null : s;
  };
  const compareValues = (x, y) => {
    if (isNum) return x - y;
    return String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
  };
  // THREE THINGS HAVE TO SURVIVE REVERSAL, and none of them can live inside the negated comparison.
  //   1. A cell with no value sinks to the BOTTOM in both directions. Negating a "sink" turns it into a
  //      float, so a blank row headed the top of every descending sort. Caught by its own test.
  //   2. Equal values keep the order the author wrote them in. Negating the index tiebreak reverses them,
  //      which makes a descending sort of a column of equal values silently rewrite the table.
  //   3. Only the value comparison itself is direction-dependent.
  order.sort((a, b) => {
    const x = valueAt(a);
    const y = valueAt(b);
    if (x === null || y === null) {
      if (x === null && y === null) return a - b;   // both missing: author order, never reversed
      return x === null ? 1 : -1;                   // missing sinks, never reversed
    }
    const c = compareValues(x, y);
    if (c !== 0) return dir === 'asc' ? c : -c;     // the only part that reverses
    return a - b;                                   // stable, never reversed
  });
  return order;
}

/** asc -> desc -> none -> asc. The 'none' step is what gives a reader the author's order back. */
export function nextDirection(current) {
  if (current === 'asc') return 'desc';
  if (current === 'desc') return 'none';
  return 'asc';
}
