// sow-325: which publishedAt a WorkBench publish writes.
//
// Both faults this covers were measured on one article, not imagined. It was drafted 2026-08-15 and
// published 2026-09-12; it went live dated August and sorted a month down every feed. The date was then
// corrected in the repository three times and overwritten three times, by six consecutive publishes that
// carried the editor's stale copy back over it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePublishedAt, DATED_CONTENT_TYPES } from '../src/lib/workbench-client-core.mjs';

const NOW = '2026-09-12T14:40:14.869Z';
const AUG = '2026-08-15T00:00:00.000Z';

test('the first publish of a draft is dated now, not from the draft', () => {
  // The draft ALREADY carries publishedAt, which is exactly why "fill it in when absent" never fired.
  const prior = { status: 'draft', publishedAt: AUG };
  assert.equal(resolvePublishedAt({ oldFm: prior, moved: false, type: 'post', now: NOW }), NOW);
});

test('a brand new item with nothing committed is dated now', () => {
  assert.equal(resolvePublishedAt({ oldFm: null, moved: false, type: 'post', now: NOW }), NOW);
  assert.equal(resolvePublishedAt({ oldFm: {}, moved: false, type: 'post', now: NOW }), NOW);
});

test('an already-live item keeps its COMMITTED date, so a stale editor cannot overwrite it', () => {
  // This is the half that stops the loop. The editor round-trips whatever frontmatter it loaded, which may
  // be a staged record saved days ago, so its publishedAt is not evidence of anything.
  const live = { status: 'published', publishedAt: AUG };
  assert.equal(resolvePublishedAt({ oldFm: live, moved: false, type: 'post', now: NOW }), AUG);
});

test('a Date instance from a YAML date is normalized rather than written as an object', () => {
  // Unquoted `publishedAt: 2026-08-15` parses to a Date, and String(Date) is not an ISO stamp.
  const live = { status: 'published', publishedAt: new Date(AUG) };
  assert.equal(resolvePublishedAt({ oldFm: live, moved: false, type: 'post', now: NOW }), AUG);
});

test('a live item with no recorded date is dated now rather than left blank', () => {
  // A dateless item sits at the bottom of every feed with no date chip, which is the fault sow-258 hit.
  const live = { status: 'published' };
  assert.equal(resolvePublishedAt({ oldFm: live, moved: false, type: 'post', now: NOW }), NOW);
});

test('a move defers to the caller, which restores the original date', () => {
  // A rename or reassignment must not re-date the item; the caller already handled it.
  const live = { status: 'published', publishedAt: AUG };
  assert.equal(resolvePublishedAt({ oldFm: live, moved: true, type: 'post', now: NOW }), null);
  assert.equal(resolvePublishedAt({ oldFm: { status: 'draft' }, moved: true, type: 'post', now: NOW }), null);
});

test('only dated content types are touched', () => {
  assert.deepEqual([...DATED_CONTENT_TYPES].sort(), ['post', 'project', 'prompt']);
  for (const t of ['comment', 'share', 'profile', '', null, undefined]) {
    assert.equal(resolvePublishedAt({ oldFm: null, moved: false, type: t, now: NOW }), null, `${t} must be left alone`);
  }
  for (const t of ['post', 'project', 'prompt']) {
    assert.equal(resolvePublishedAt({ oldFm: null, moved: false, type: t, now: NOW }), NOW);
  }
});

test('called with nothing at all it refuses rather than throwing', () => {
  assert.equal(resolvePublishedAt(), null);
  assert.equal(resolvePublishedAt({}), null);
});
