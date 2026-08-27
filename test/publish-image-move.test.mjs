// sow-183 (owner report 2026-08-27): reassigning an item's author must CARRY its images.
//
// Images on this network are co-located: they live in the item's own folder, next to its index.md, because
// Astro's image() resolves relative to that file. So an item's folder is also its images' folder, and moving
// the item (an author reassignment, a slug rename, or both) moves them.
//
// What was wrong: publish derived the image commit folder from the DESTINATION path and looked for the bytes
// in three places, all of which miss during a move. The in-tab Map is empty after a reload. The staged store
// is empty because publish deletes the staged copy once the image has been committed. And the destination
// folder holds nothing, because the item has not moved there yet. All three missed, planPublishImage refused
// with "no longer staged", and reassigning any item that carries an image was impossible without re-picking
// every image by hand. Since co-location is universal here, that was nearly every item.
//
// WHY THIS FILE IS A SOURCE-TEXT GUARD. The decisions are pure and are tested for real in
// workbench-client-core.test.mjs: planPublishImage holds the source ORDER, planPublishImageFiles holds the
// FILE SET a move contributes. Neither can be exercised end to end from node, because the caller is browser
// TypeScript over fetch. A correct helper that nothing calls would pass every one of its own tests while the
// picker refused exactly as before, which is the failure mode this repo keeps hitting. These assert the
// wiring: that publish reads the origin folder, and that it reads it as BYTES.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const client = readFileSync(new URL('../src/lib/workbench-client.ts', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../workers/signup/github-app.mjs', import.meta.url), 'utf8');

test('publish resolves the ORIGIN images folder by the same rule it resolves the destination', () => {
  // Both ends derive from a path by stripping its file name, so they cannot drift apart. If one end ever
  // learns about the co-located layout and the other does not, a move writes into a folder nobody reads.
  assert.match(client, /const imagesDir = `\$\{built\.path\.replace\(\/\\\/\[\^\/\]\*\$\/, ''\)\}\/images`/,
    'the destination images folder is no longer derived from built.path');
  assert.match(client, /const oldImagesDir = moved && origin \? `\$\{origin\.oldPath\.replace\(\/\\\/\[\^\/\]\*\$\/, ''\)\}\/images` : null/,
    'the origin images folder is gone, or is no longer gated on `moved`');
});

test('the origin copy is read as BYTES, and only through the existing member-gated route', () => {
  // readOwnFile returns decoded text. An image decoded as text is mojibake and cannot be re-encoded back into
  // the original file, so a move wired to readOwnFile would commit a corrupt image and report success.
  assert.match(client, /async function readOwnFileBase64\(path: string\): Promise<string \| null> \{[\s\S]{0,240}?return r\?\.base64 \?\? null;/,
    'readOwnFileBase64 is gone or no longer returns the raw base64');
  assert.match(client, /readOwnFileBase64\(oldPath\)/, 'the origin copy is no longer read as bytes');
  // Same route, same allow-list, same auth as the text read it sits beside. A separate endpoint here would be
  // a second place the allow-list has to be got right.
  const reads = [...client.matchAll(/\/membership\/file\?path=/g)].length;
  assert.equal(reads, 2, 'the file read forked into a third path; both reads must share one gated route');
});

test('publish plans BOTH halves of the move through the pure helper, not by hand', () => {
  // planPublishImageFiles is where "commit the new path AND delete the old" lives, and where it is tested. A
  // caller that reached past it to planPublishImage would get the carry and silently drop the cleanup, leaving
  // an orphaned image in a folder whose index.md is gone. Nothing references it, so the build stays green and
  // the repo accumulates the images of every item ever reassigned.
  assert.match(client, /planPublishImageFiles\(\{ name: ref\.name, item: itemTokens\[0\], commitPath, oldPath, oldBase64 \}/,
    'publish no longer hands the move descriptor to planPublishImageFiles');
  assert.doesNotMatch(client, /await planPublishImage\(/, 'publish reached past the file planner back to the raw source planner');
  assert.match(client, /files\.push\(\.\.\.plan\.files\)/, 'publish stopped pushing the whole planned file set');
  // The staged copies are dropped only for a real commit. A skip pushes no bytes, so treating it as a commit
  // would delete a staged image the PR never carried.
  assert.match(client, /if \(plan\.action !== 'commit'\) continue;\s*\n\s*pendingImages\.delete/,
    'the staged-image cleanup is no longer gated on an actual commit');
});

test('the Worker hands back the base64 it already holds, without widening what it will serve', () => {
  assert.match(worker, /return \{ status: 200, body: \{ ok: true, text, base64 \} \};/, 'the file route stopped returning base64');
  // Decoded from the SAME string that is returned, so text and base64 can never describe different bytes.
  assert.match(worker, /const base64 = String\(data\.content\)\.replace\(\/\\s\+\/g, ''\);\s*\n\s*let text = null;\s*\n\s*try \{\s*\n\s*const bin = atob\(base64\);/,
    'the returned base64 is no longer the string the text is decoded from');
  // The allow-list is the only thing keeping this from being a general repo-file oracle. It must not have
  // grown to accommodate images: co-located image paths already sit under members/ and the house content
  // folders, so this change needed nothing from it.
  assert.match(worker, /const HOUSE_CONTENT = \['house\/posts\/', 'house\/products\/', 'house\/prompts\/'\];/,
    'the house content allow-list changed; base64 must reach exactly the paths text already reached');
  assert.match(worker, /const allowedPrefix = path\.startsWith\('members\/'\) \|\| HOUSE_CONTENT\.some\(\(p\) => path\.startsWith\(p\)\);/,
    'the allow-list rule changed');
});
