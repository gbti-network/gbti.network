// sow-271: the extension-CTA build guard, driven against hand-built temp dists so BOTH toggle positions and the
// guard's own failure modes are exercised in CI. These are the scenarios the guard was mutation-tested against
// when it was written; keeping them as tests is what stops it degrading into a check that always passes.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkExtensionCta, CTA_MARKERS, MUST_NOT_CLAIM, CLAIM_EXEMPT_PATHS } from '../scripts/check-extension-cta.mjs';

// sow-271: the phrase the guard now BANS outside the exempt pages (it used to be required to survive).
const CAP = '<div>Extension required</div>';

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
  return mkDist({ 'a.html': CTA_MARKERS.map(([, m]) => `<div>${m}</div>`).join('') });
}

test('setting OFF + a surface still rendering FAILS, naming the surface', () => {
  const { errors } = checkExtensionCta({ distDir: mkDist({ 'a.html': '<nav><a>Get Extension</a></nav>' }), ctaEnabled: false });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /switched OFF/);
  assert.match(errors[0], /Get Extension/);
});

test('setting OFF + a clean build PASSES', () => {
  const { errors, checked } = checkExtensionCta({ distDir: mkDist({ 'a.html': '<nav></nav>' }), ctaEnabled: false });
  assert.deepEqual(errors, []);
  assert.equal(checked, 1);
});

test('setting ON + the surfaces missing FAILS', () => {
  // The half a one-directional guard misses: a change that DELETED the adverts rather than gating them would
  // sail through an absence-only check while the setting said they should be visible.
  const { errors } = checkExtensionCta({ distDir: mkDist({ 'a.html': '<nav></nav>' }), ctaEnabled: true });
  assert.equal(errors.length, CTA_MARKERS.length);
  for (const e of errors) assert.match(e, /switched ON, but/);
});

test('setting ON + every surface present PASSES', () => {
  const { errors } = checkExtensionCta({ distDir: fullAdvertDist(), ctaEnabled: true });
  assert.deepEqual(errors, []);
});

// sow-271 Phase 3 REPLACED the assertion this case used to make. It used to require the "Extension required"
// notices to SURVIVE, because they explained a control that did nothing on the website. The website now
// follows news sources, posts comments and upgrades the edit panel, so such a notice is a false statement
// rather than a helpful one. The guard, and this test, now assert the opposite.
test('a claim that the extension is REQUIRED fails in either toggle position', () => {
  for (const ctaEnabled of [false, true]) {
    for (const [label, marker] of MUST_NOT_CLAIM) {
      const files = { 'a.html': `<div>${marker}</div>`, ...(ctaEnabled ? Object.fromEntries(CTA_MARKERS.map(([, m], i) => [`c${i}.html`, `<div>${m}</div>`])) : {}) };
      const { errors } = checkExtensionCta({ distDir: mkDist(files), ctaEnabled });
      assert.ok(errors.some((e) => e.includes(label)),
        `expected "${label}" to fail with the setting ${ctaEnabled ? 'ON' : 'OFF'}`);
    }
  }
});

test('the exempt pages may still describe the extension freely', () => {
  // /extension/ and /brand/ exist to talk about it. Banning the phrase everywhere would make the install page
  // unwritable, and a guard that forces you to lie is worse than no guard.
  const [, marker] = MUST_NOT_CLAIM[0];
  const files = Object.fromEntries(CLAIM_EXEMPT_PATHS.map((ex, i) => [`${ex.replace(/\//g, '')}/page${i}.html`, `<div>${marker}</div>`]));
  const { errors } = checkExtensionCta({ distDir: mkDist(files), ctaEnabled: false });
  assert.deepEqual(errors.filter((e) => e.includes('Extension required')), []);
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
    distDir: mkDist({ 'a.html': '<nav></nav>', 'b.js': 'q.querySelector(".hm-item hm-download")' }),
    ctaEnabled: false,
  });
  assert.deepEqual(errors, []);
});

test('the guard walks nested directories, not just the dist root', () => {
  const { errors } = checkExtensionCta({
    distDir: mkDist({ 'index.html': '<p>clean</p>', 'deep/nested/page/index.html': `<nav><a>Get Extension</a></nav>` }),
    ctaEnabled: false,
  });
  assert.equal(errors.length, 1);
  assert.match(errors[0], /deep\/nested\/page/);
});
