// The invite link a member copies from the extension's Settings was built as /join?ref=<code>, a page that never
// existed, so a referred visitor landed on the not-found page and the referral was lost (found 2026-10-07). Two
// things now stand between a shared link and that 404, and both are easy to lose without a test noticing:
//   - the /join redirect lives in public/_redirects, a GENERATED file that is rewritten wholesale on every run of
//     scripts/gen-redirects.mjs, so the pair has to be in the generator's EXTRA list or a regeneration drops it;
//   - the link builders must keep pointing at a page that exists and records ?ref.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

test('the redirect generator emits /join and /join/ to the membership page', () => {
  const gen = read('scripts/gen-redirects.mjs');
  for (const want of ["['/join', '/membership/']", "['/join/', '/membership/']"]) {
    assert.ok(gen.includes(want), `gen-redirects lost ${want}; the next regeneration would turn every shared invite link back into a 404`);
  }
});

test('the committed _redirects sends /join to the membership page, ahead of the /blog/ splat', () => {
  const lines = read('public/_redirects').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  assert.ok(lines.length > 50, `only ${lines.length} rules parsed; the assertions below would pass vacuously`);
  const at = (rule) => lines.indexOf(rule);
  const splat = lines.findIndex((l) => l.startsWith('/blog/* '));
  assert.ok(splat > 0, 'the /blog/* splat rule was not found, so the ordering check below proves nothing');
  for (const rule of ['/join /membership/ 301', '/join/ /membership/ 301']) {
    assert.ok(at(rule) >= 0, `public/_redirects is missing "${rule}"`);
    assert.ok(at(rule) < splat, `"${rule}" must come before the /blog/* splat`);
  }
});

test('the invite link builders point at a page that exists and records ?ref', () => {
  for (const file of ['client/src/account-ops.mjs', 'client-ui/src/elements/gbti-account.mjs']) {
    const src = read(file);
    assert.ok(src.includes('/membership/?ref='), `${file} no longer builds the membership referral link`);
    assert.ok(!src.includes('/join?ref='), `${file} builds a /join?ref= link again; that page does not exist`);
  }
});
