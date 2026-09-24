// sow-395 (owner, 2026-09-24): the share dialog is square-cornered, 2px. The composer is one shared element (the
// website's share modal, the WorkBench and the extension's new tab all mount it), so its corners come from one value
// on :host; the extension draws its own panel around it, scoped to the share panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const COMPOSER = src('client-ui/src/elements/gbti-share-composer.mjs');
const css = COMPOSER.slice(COMPOSER.indexOf('const CSS = `'), COMPOSER.indexOf('`;', COMPOSER.indexOf('const CSS = `')));

test('every corner in the composer is the one 2px value, except the round step numbers and spinner', () => {
  assert.ok(css.length > 1000, 'the composer stylesheet was found');
  assert.match(css, /:host \{ --sc-r: 2px;/);
  const radii = [...css.matchAll(/border-radius:\s*([^;}]+)/g)].map((m) => m[1].trim());
  assert.ok(radii.length >= 15, `read ${radii.length} radii`);
  const odd = radii.filter((r) => r !== 'var(--sc-r)' && r !== '50%' && r !== '0');
  assert.deepEqual(odd, [], 'no other corner size is left in the dialog');
  assert.equal(radii.filter((r) => r === '50%').length, 2, 'the step numbers and the spinner stay round');
  // the shared BASE_CSS gives bare buttons and fields 8px; the composer's own sheet comes after it and resets them
  assert.match(css, /\n  button, input, select, textarea \{ border-radius:var\(--sc-r\); \}/);
});

test('the extension share dialog is the website one: the composer card is the dialog, with a round close button', () => {
  const shell = src('extension/src/shell.mjs');
  assert.match(shell, /overlay\.innerHTML = `<div class="share-dialog" role="dialog" aria-modal="true" aria-label="Post a Share"><button class="share-x" type="button" aria-label="Close">\$\{ico\('x'\)\}<\/button><gbti-share-composer><\/gbti-share-composer><\/div>`;/);
  assert.doesNotMatch(shell, /<b>Post a Share<\/b>/, 'no panel title around the composer (a section within a section)');
  assert.match(shell, /overlay\.querySelector\('\.share-x'\)\?\.addEventListener\('click', close\);/, 'the close button still closes it');
  const css = src('extension/shell.css');
  assert.match(css, /\.share-dialog \{ position: relative; width: 100%; max-width: 620px; margin: auto; \}/, 'the website width, centred');
  assert.match(css, /\.share-x \{[^}]*border-radius: 50%;/, 'round, like the website close button');
  assert.match(src('src/styles/gbti-v3.css'), /\.share-modal \{ width: 620px;/, 'the website dialog it mirrors is 620px');
  assert.match(css, /\.compose-panel \{[^}]*border-radius: var\(--r-lg\)/, 'the Membership panel keeps its own look');
});
