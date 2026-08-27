// sow-271: the pure site-settings edit core + the toggle registry. These pin the behaviours that make the
// difference between a switch that works and one that only appears to: what a MISSING key means, what a
// non-boolean stored value does, and whether a flip is idempotent.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  setSiteToggle, readToggle, readAllToggles, unknownKeys,
  SITE_TOGGLES, TOGGLE_KEYS, SiteSettingsEditError,
} from '../membership/site-settings-edits.mjs';

test('a missing key falls back to the registry default, which is the pre-toggle behaviour', () => {
  // This is the property that lets a fork with no site-settings.yml behave exactly as the site did before the
  // toggle existed. If it regressed to `false`, adding the file would silently switch surfaces off everywhere.
  assert.equal(readToggle({}, 'extension_cta'), true);
  assert.equal(readToggle({ settings: {} }, 'extension_cta'), true);
  assert.equal(SITE_TOGGLES.extension_cta.fallback, true);
});

test('a stored boolean is returned as-is, both ways', () => {
  assert.equal(readToggle({ settings: { extension_cta: false } }, 'extension_cta'), false);
  assert.equal(readToggle({ settings: { extension_cta: true } }, 'extension_cta'), true);
});

test('a NON-boolean stored value throws rather than being coerced', () => {
  // The failure this prevents: "false" is truthy in JS, so a coercing reader would leave the surface switched ON
  // while the file plainly reads `extension_cta: "false"`. Loud beats quietly wrong for a setting like this.
  assert.throws(() => readToggle({ settings: { extension_cta: 'false' } }, 'extension_cta'), SiteSettingsEditError);
  assert.throws(() => readToggle({ settings: { extension_cta: 0 } }, 'extension_cta'), SiteSettingsEditError);
});

test('an unknown key is rejected on read and on write', () => {
  assert.throws(() => readToggle({}, 'no_such_toggle'), SiteSettingsEditError);
  assert.throws(() => setSiteToggle({}, { key: 'no_such_toggle', enabled: true }), SiteSettingsEditError);
  assert.throws(() => setSiteToggle({}, { key: '', enabled: true }), SiteSettingsEditError);
});

test('unknownKeys reports a stale key the build should refuse', () => {
  assert.deepEqual(unknownKeys({ settings: { extension_cta: true } }), []);
  assert.deepEqual(unknownKeys({ settings: { extension_cta: true, retired_flag: false } }), ['retired_flag']);
});

test('setSiteToggle writes the value and reports the previous one', () => {
  const r = setSiteToggle({ settings: {} }, { key: 'extension_cta', enabled: false }, {});
  assert.equal(r.changed, true);
  assert.equal(r.next.settings.extension_cta, false);
  assert.equal(r.audit.detail.enabled, false);
  assert.equal(r.audit.detail.was, true); // it was at its fallback before
});

test('pinning the fallback explicitly still counts as a change', () => {
  // Writing `true` into a file that omitted the key resolves to the same VALUE but is not a no-op: it pins the
  // setting so a later registry-default change cannot move it silently.
  const r = setSiteToggle({ settings: {} }, { key: 'extension_cta', enabled: true }, {});
  assert.equal(r.changed, true);
  assert.equal(r.next.settings.extension_cta, true);
});

test('setting a toggle to the value it already carries is an idempotent no-op', () => {
  const doc = { settings: { extension_cta: false } };
  const r = setSiteToggle(doc, { key: 'extension_cta', enabled: false }, {});
  assert.equal(r.changed, false);
  assert.equal(r.audit.detail.noop, true);
});

test('enabled must be a real boolean', () => {
  assert.throws(() => setSiteToggle({}, { key: 'extension_cta', enabled: 'false' }), SiteSettingsEditError);
  assert.throws(() => setSiteToggle({}, { key: 'extension_cta' }), SiteSettingsEditError);
});

test('the edit does not mutate the document it was given', () => {
  const doc = { settings: { extension_cta: true } };
  setSiteToggle(doc, { key: 'extension_cta', enabled: false }, {});
  assert.equal(doc.settings.extension_cta, true, 'the caller’s copy is untouched');
});

test('the audit entry carries the actor identity-minimally', () => {
  const r = setSiteToggle({}, { key: 'extension_cta', enabled: false }, { actor: { githubId: 42, login: 'gbtilabs' }, now: '2026-08-23T00:00:00.000Z' });
  assert.equal(r.audit.action, 'site-setting.set');
  assert.deepEqual(r.audit.target, { key: 'extension_cta' });
  assert.deepEqual(r.audit.actor, { github_id: '42', login: 'gbtilabs' });
  assert.equal(r.audit.at, '2026-08-23T00:00:00.000Z');
});

test('readAllToggles covers every registered key', () => {
  const all = readAllToggles({ settings: { extension_cta: false } });
  assert.deepEqual(Object.keys(all).sort(), [...TOGGLE_KEYS].sort());
  assert.equal(all.extension_cta, false);
});

test('every registered toggle declares the metadata the manager UI renders', () => {
  // A toggle added without a description would render as a bare switch with no statement of what it governs,
  // which is how the extension-CTA switch would get mistaken for "remove every mention of the extension".
  for (const [key, spec] of Object.entries(SITE_TOGGLES)) {
    assert.ok(spec.label && spec.label.length > 3, `${key} needs a label`);
    assert.ok(spec.description && spec.description.length > 20, `${key} needs a real description`);
    assert.equal(typeof spec.fallback, 'boolean', `${key} needs a boolean fallback`);
  }
});
