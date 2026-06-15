// SOW-024: the geofenced cookie-consent decision logic. EU/UK needs a prompt before analytics; elsewhere is
// implicit-allow; unknown region fails closed (prompt). Pure, no DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLoc, isConsentRegion, decide, CONSENT_REGIONS } from '../src/lib/consent.mjs';

test('parseLoc extracts the country code from a /cdn-cgi/trace body', () => {
  assert.equal(parseLoc('fl=abc\nip=1.2.3.4\nts=...\nloc=DE\nhttp=http/2'), 'DE');
  assert.equal(parseLoc('loc=us'), 'US');
  assert.equal(parseLoc('no loc here'), null);
  assert.equal(parseLoc(''), null);
});

test('isConsentRegion covers EU + EEA + UK, not the US', () => {
  for (const eu of ['DE', 'FR', 'IE', 'GB', 'NO', 'IS', 'LI']) assert.equal(isConsentRegion(eu), true, eu);
  for (const other of ['US', 'CA', 'AU', 'JP', 'BR', 'CH']) assert.equal(isConsentRegion(other), false, other);
  assert.equal(isConsentRegion(null), false);
  assert.equal(CONSENT_REGIONS.size, 31); // 27 EU + 3 EEA + UK
});

test('EU/UK visitor, undecided: show the banner, hold analytics', () => {
  assert.deepEqual(decide({ stored: null, loc: 'DE' }), { showBanner: true, analyticsAllowed: false, needsConsent: true });
  assert.deepEqual(decide({ stored: null, loc: 'GB' }), { showBanner: true, analyticsAllowed: false, needsConsent: true });
});

test('non-EU visitor, undecided: no banner, analytics allowed (implicit)', () => {
  assert.deepEqual(decide({ stored: null, loc: 'US' }), { showBanner: false, analyticsAllowed: true, needsConsent: false });
});

test('unknown region (geo failed), undecided: fail closed (prompt, hold analytics)', () => {
  assert.deepEqual(decide({ stored: null, loc: null }), { showBanner: true, analyticsAllowed: false, needsConsent: true });
});

test('a stored choice is honored regardless of region (no re-prompt)', () => {
  assert.equal(decide({ stored: 'granted', loc: 'DE' }).analyticsAllowed, true);
  assert.equal(decide({ stored: 'granted', loc: 'DE' }).showBanner, false);
  assert.equal(decide({ stored: 'denied', loc: 'DE' }).analyticsAllowed, false);
  assert.equal(decide({ stored: 'denied', loc: 'US' }).analyticsAllowed, false);
  assert.equal(decide({ stored: 'denied', loc: 'DE' }).showBanner, false);
});
