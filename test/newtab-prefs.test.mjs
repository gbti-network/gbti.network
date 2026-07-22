// SOW-105: the new-tab prefs core. Per-section view-mode resolution (per-type defaults, invalid stored
// values fall through) and the boot landing precedence (explicit hash > remembered section > snoozed
// splash dest > 'all'). Pure module, no DOM, no storage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAST_SECTION_KEY, LEGACY_MODE_KEY, VIEW_MODES, DEFAULT_VIEW, viewKey, viewModeFor, landingType,
} from '../client-ui/src/newtab-prefs.mjs';
import { TYPE_FILTERS } from '../client-ui/src/feed-route.mjs';

test('DEFAULT_VIEW covers exactly the TYPE_FILTERS set with valid modes (guards future type drift)', () => {
  for (const t of TYPE_FILTERS) {
    assert.ok(t in DEFAULT_VIEW, `DEFAULT_VIEW is missing '${t}'`);
    assert.ok(VIEW_MODES.has(DEFAULT_VIEW[t]), `DEFAULT_VIEW['${t}'] is not a valid mode`);
  }
  for (const t of Object.keys(DEFAULT_VIEW)) {
    assert.ok(TYPE_FILTERS.has(t), `DEFAULT_VIEW has an entry for unknown type '${t}'`);
  }
});

test('the storage contract: key names are pinned', () => {
  assert.equal(LAST_SECTION_KEY, 'gbti-nt-last-section');
  assert.equal(LEGACY_MODE_KEY, 'gbti-nt-mode');
  assert.equal(viewKey('prompt'), 'gbti-nt-view-prompt');
  assert.equal(viewKey('all'), 'gbti-nt-view-all');
  assert.notEqual(viewKey('post'), viewKey('product'));
});

test('viewModeFor: a valid stored value wins over the default', () => {
  assert.equal(viewModeFor('prompt', 'card'), 'card');
  assert.equal(viewModeFor('post', 'compact'), 'compact');
  assert.equal(viewModeFor('news', 'detailed'), 'detailed');
});

test('viewModeFor: absent or invalid stored falls to the per-type default', () => {
  const expected = { all: 'card', post: 'card', product: 'detailed', prompt: 'compact', share: 'detailed', news: 'card' };
  for (const [t, want] of Object.entries(expected)) {
    for (const bad of [null, undefined, '', 'bogus', 'CARD']) {
      assert.equal(viewModeFor(t, bad), want, `${t} with stored=${String(bad)}`);
    }
  }
});

test('viewModeFor: an unknown type falls to compact', () => {
  assert.equal(viewModeFor('kanban', null), 'compact');
  assert.equal(viewModeFor(undefined, 'nope'), 'compact');
});

test('landingType: an explicit hash always wins (rail clicks and deep links land where they point)', () => {
  assert.equal(landingType({ hash: '#type=post', remembered: 'news', splashDest: 'news' }), 'post');
  assert.equal(landingType({ hash: '#tab=share&read=alice%2F1', remembered: 'news' }), 'share');
  // an unknown hash type is malformed: it falls through to the remembered section
  assert.equal(landingType({ hash: '#type=bogus', remembered: 'prompt' }), 'prompt');
});

test('landingType: the remembered section wins over the splash dest; invalid remembered falls through', () => {
  assert.equal(landingType({ hash: '', remembered: 'news', splashDest: 'activity' }), 'news');
  assert.equal(landingType({ hash: '', remembered: 'all', splashDest: 'news' }), 'all', "'all' is itself remembered");
  for (const bad of ['bogus', '', null, undefined]) {
    assert.equal(landingType({ hash: '', remembered: bad, splashDest: 'news' }), 'news', `remembered=${String(bad)}`);
  }
});

test('landingType: the splash dest fallback maps through its vocabulary; the final default is all', () => {
  assert.equal(landingType({ hash: '', remembered: null, splashDest: 'news' }), 'news');
  assert.equal(landingType({ hash: '', remembered: null, splashDest: 'activity' }), 'all');
  assert.equal(landingType({ hash: '', remembered: null, splashDest: 'workbench' }), 'all');
  assert.equal(landingType({}), 'all');
  assert.equal(landingType(), 'all');
});
