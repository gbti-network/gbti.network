// A WorkBench save submits the editor's form fields and nothing else, so a frontmatter key a project carries that
// the editor does not offer is silently dropped on the next save. Found 2026-09-12 on the SavePoint project:
// `requires` rendered on the live page and was not a form field, while `version` and `platforms` were form fields
// listed in no rail section, so the owner could not see 1.57.1 in the editor at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

import { fieldsFor } from '../client/src/form-fields.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const editorSrc = fs.readFileSync(path.join(ROOT, 'client-ui/src/elements/gbti-content-editor.mjs'), 'utf8');
const pageSrc = fs.readFileSync(path.join(ROOT, 'src/pages/projects/[slug].astro'), 'utf8');

// Keys the save path writes itself rather than reading from a form field: `type` and `author` are stamped by
// sanitizeInput, `contributors` is system-managed, `redirectFrom` and `publishedAt` are merged from the old file,
// `encryptedBody` is set by the encrypt-on-publish split, and the editor stamps `updatedAt` on every save.
const SAVE_PATH_OWNED = new Set(['type', 'author', 'contributors', 'redirectFrom', 'encryptedBody', 'publishedAt', 'updatedAt']);

function projectFiles() {
  const out = [];
  const bases = [path.join(ROOT, 'house')];
  for (const u of fs.readdirSync(path.join(ROOT, 'members'))) bases.push(path.join(ROOT, 'members', u));
  for (const base of bases) {
    const dir = path.join(base, 'projects');
    if (!fs.existsSync(dir)) continue;
    for (const slug of fs.readdirSync(dir)) {
      const f = path.join(dir, slug, 'index.md');
      if (fs.existsSync(f)) out.push(f);
    }
  }
  return out;
}

function frontmatterOf(file) {
  const m = /^---\n([\s\S]*?)\n---/.exec(fs.readFileSync(file, 'utf8'));
  return m ? yaml.load(m[1]) || {} : {};
}

// The keys listed in the project RAIL_SCHEMA, read from the editor source (the schema is not exported).
function projectRailKeys() {
  const block = /\n\s{2}project: \[\n([\s\S]*?)\n\s{2}\],/.exec(editorSrc.slice(editorSrc.indexOf('const RAIL_SCHEMA')));
  assert.ok(block, 'found the project RAIL_SCHEMA block');
  const keys = new Set();
  for (const arr of block[1].matchAll(/keys: \[([^\]]*)\]/g)) for (const k of arr[1].matchAll(/'([^']+)'/g)) keys.add(k[1]);
  return keys;
}

test('every frontmatter key a real project carries is one the editor can submit', () => {
  const offered = new Set(fieldsFor('project').map((f) => f.key));
  const files = projectFiles();
  assert.ok(files.length > 0, 'the sweep found project files to check');
  const missing = [];
  for (const file of files) {
    for (const key of Object.keys(frontmatterOf(file))) {
      if (!offered.has(key) && !SAVE_PATH_OWNED.has(key)) missing.push(`${path.relative(ROOT, file)}: ${key}`);
    }
  }
  assert.deepEqual(missing, [], 'a WorkBench save would drop these keys');
});

test('every spec the project page prints has a visible control in the editor rail', () => {
  const specKeys = [...pageSrc.matchAll(/\.\.\.\(d\.(\w+)(?:\?\.length)? \? \[\['/g)].map((m) => m[1]);
  assert.ok(specKeys.includes('version') && specKeys.includes('requires'), `read the page's spec rows (${specKeys})`);
  const offered = new Set(fieldsFor('project').map((f) => f.key));
  const rail = projectRailKeys();
  for (const key of specKeys) {
    if (SAVE_PATH_OWNED.has(key)) continue;
    assert.ok(offered.has(key), `${key} is a project form field`);
    assert.ok(rail.has(key), `${key} is listed in a project rail section, so the owner can see and change it`);
  }
});
