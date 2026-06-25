// SOW-063 Phase 3: the pure quote-pool edit core (membership/quote-edits.mjs). Mirrors news-source-edits.test:
// add/enable/remove over a parsed { quotes: [...] }, returning { next, changed, audit }, idempotent + validating.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addQuote, setQuoteEnabled, removeQuote, QuoteEditError } from '../membership/quote-edits.mjs';

const ctx = { actor: { githubId: '7', login: 'gbtilabs' }, now: '2026-06-24T00:00:00.000Z' };
const base = () => ({ quotes: [{ text: 'Keep it simple.', author: 'Anon', enabled: true }] });

test('addQuote appends a new quote, defaults enabled, and audits', () => {
  const r = addQuote(base(), { text: 'Ship it.', author: 'Dev' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.quotes.length, 2);
  assert.deepEqual(r.next.quotes[1], { text: 'Ship it.', author: 'Dev', enabled: true });
  assert.equal(r.audit.action, 'quote.add');
  assert.deepEqual(r.audit.target, { text: 'Ship it.' });
  assert.equal(r.audit.actor.github_id, '7');
});

test('addQuote is idempotent on the same text (case-insensitive), trims, and caps', () => {
  const r = addQuote(base(), { text: '  keep IT simple.  ', author: 'X' }, ctx);
  assert.equal(r.changed, false);
  assert.equal(r.next.quotes.length, 1);
  assert.ok(r.audit.detail.noop);
  // trimming on a genuinely new quote
  const r2 = addQuote(base(), { text: '  Trim me.  ', author: '  Me  ' }, ctx);
  assert.deepEqual(r2.next.quotes[1], { text: 'Trim me.', author: 'Me', enabled: true });
});

test('addQuote validates a non-empty text + author', () => {
  assert.throws(() => addQuote(base(), { text: '', author: 'x' }, ctx), QuoteEditError);
  assert.throws(() => addQuote(base(), { text: 'x', author: '' }, ctx), QuoteEditError);
  assert.throws(() => addQuote(base(), { text: '   ', author: '   ' }, ctx), QuoteEditError);
});

test('setQuoteEnabled toggles by text, is idempotent, and errors on a miss', () => {
  const r = setQuoteEnabled(base(), { text: 'keep it simple.', enabled: false }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.quotes[0].enabled, false);
  // already disabled -> no-op
  const r2 = setQuoteEnabled(r.next, { text: 'Keep it simple.', enabled: false }, ctx);
  assert.equal(r2.changed, false);
  assert.ok(r2.audit.detail.noop);
  assert.throws(() => setQuoteEnabled(base(), { text: 'nope', enabled: false }, ctx), QuoteEditError);
});

test('removeQuote drops the matching quote and errors on a miss', () => {
  const r = removeQuote(base(), { text: 'KEEP IT SIMPLE.' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.quotes.length, 0);
  assert.equal(r.audit.action, 'quote.remove');
  assert.throws(() => removeQuote(base(), { text: 'missing' }, ctx), QuoteEditError);
});

test('a missing/garbage doc is treated as an empty pool (does not throw on shape)', () => {
  const r = addQuote(null, { text: 'First.', author: 'A' }, ctx);
  assert.equal(r.next.quotes.length, 1);
  assert.throws(() => removeQuote({}, { text: 'x' }, ctx), QuoteEditError); // empty pool -> not found
});
