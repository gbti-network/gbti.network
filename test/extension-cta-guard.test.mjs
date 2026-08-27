// sow-271: the extension-CTA build guard, driven against hand-built temp dists so BOTH toggle positions and the
// guard's own failure modes are exercised in CI. These are the scenarios the guard was mutation-tested against
// when it was written; keeping them as tests is what stops it degrading into a check that always passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkExtensionCta, CTA_MARKERS, MUST_SURVIVE } from '../scripts/check-extension-cta.mjs';

const CAP = '<div>Extension required</div>'; // the capability notice the toggle must never govern

function mkDist(files) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'cta-guard-'));
  for (const [name, body] of Object.entries(files)) {
    const f = path.join(d, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, body);
  }
  return d;
}

/** A dist carrying every advertising marker, plus the capability notice. */
function fullAdvertDist() {
  return mkDist({ 'a.html': CTA_MARKERS.map(([, m]) => `<div>${m}</div>`).join('') + CAP });
}

test('setting OFF + a surface still rendering FAILS, naming the surface', () => {
  const { errors } = checkExtensionCta({ distDir: mkDist({ 'a.html': `<nav><a>Get Extension</a></nav>${CAP}` }), ctaEnabled: false });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /switched OFF/);
  assert.match(errors[0], /Get Extension/);
});

test('setting OFF + a clean build PASSES', () => {
  const { errors, checked } = checkExtensionCta({ distDir: mkDist({ 'a.html': `<nav></nav>${CAP}` }), ctaEnabled: false });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test('setting ON + the surfaces missing FAILS', () => {
  // The half a one-directional guard misses: a change that DELETED the adverts rather than gating them would
  // sail through an absence-only check while the setting said they should be visible.
  const { errors } = checkExtensionCta({ distDir: mkDist({ 'a.html': `<nav></nav>${CAP}` }), ctaEnabled: true });
  assert.equal(errors.length, CTA_MARKERS.length);
  for (const e of errors) assert.match(e, /switched ON, but/);
});

test('setting ON + every surface present PASSES', () => {
  const { errors } = checkExtensionCta({ distDir: fullAdvertDist(), ctaEnabled: true });
  assert.deepEqual(errors, []);
});

test('the capability notices disappearing FAILS in either position', () => {
  for (const ctaEnabled of [false, true]) {
    const files = ctaEnabled
      ? { 'a.html': CTA_MARKERS.map(([, m]) => `<div>${m}</div>`).join('') } // adverts present, notices gone
      : { 'a.html': '<nav></nav>' };
    const { errors } = checkExtensionCta({ distDir: mkDist(files), ctaEnabled });
    assert.ok(errors.some((e) => e.includes(MUST_SURVIVE[0][0])), `expected the capability-notice failure with the setting ${ctaEnabled ? 'ON' : 'OFF'}`);
  }
});

test('an empty dist FAILS rather than passing vacuously', () => {
  // Zero coverage reported as a pass is the exact shape that let a broken deploy gate go unnoticed once before
  // (see the header of scripts/check-article-closing-slot.mjs).
  const { errors, checked } = checkExtensionCta({ distDir: mkDist({}), ctaEnabled: false });
  assert.equal(checked, 0);
  assert.match(errors[0], /no built HTML/);
});

test('a marker appearing only in a .js bundle does NOT trip the guard', () => {
  // Header.astro's bundle carries ".hm-download" as a querySelector argument. That string is not a rendered
  // advert, and matching it would be the "the word is present so the thing must be there" mistake.
  const { errors } = checkExtensionCta({
    distDir: mkDist({ 'a.html': `<nav></nav>${CAP}`, 'b.js': 'q.querySelector(".hm-item hm-download")' }),
    ctaEnabled: false,
  });
  assert.deepEqual(errors, []);
});

test('the guard walks nested directories, not just the dist root', () => {
  const { errors } = checkExtensionCta({
    distDir: mkDist({ 'index.html': CAP, 'deep/nested/page/index.html': `<nav><a>Get Extension</a></nav>` }),
    ctaEnabled: false,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deep\/nested\/page/);
});
