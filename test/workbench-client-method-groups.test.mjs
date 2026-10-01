// The website WorkBench client builds one object from its own methods plus groups spread in from other modules
// (the admin surface since the 900-line split of 2026-09-30, the prepared listings since sow-427). A name defined in
// two places is not an error anywhere: the later one silently wins, so a bulk rename or a copied method would replace
// a working method with no warning. test/duplicate-literals.test.mjs catches that inside ONE object literal, which
// is what this client was before the split; it cannot see a clash between an object's own keys and a spread.
// This test can: the client's own method names come from its source, each group's names come from running it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const esbuild = require('esbuild');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLIENT = path.join(ROOT, 'src/lib/workbench-client.ts');

// The groups spread into the client's returned object, with the module that defines each.
const GROUPS = { adminMethods: 'src/lib/workbench-client-admin.ts', preparedMethods: 'src/lib/workbench-prepared.ts' };

/** The client's OWN method names (the non-spread keys of the object literal that spreads the groups in), and every
 *  spread in it that is NOT a known group: a new group, or a spread of a plain object, whose names this test cannot see. */
export function readReturnedLiteral(tsSource) {
  const js = esbuild.transformSync(tsSource, { loader: 'ts', format: 'esm', target: 'es2022' }).code;
  const ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'module' });
  let found = null;
  (function walk(node) {
    if (found || !node || typeof node.type !== 'string') return;
    if (node.type === 'ObjectExpression' && node.properties.some((p) => p.type === 'SpreadElement' && p.argument?.callee?.name in GROUPS)) {
      found = node;
      return;
    }
    for (const v of Object.values(node)) {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v.type === 'string') walk(v);
    }
  })(ast);
  if (!found) return null;
  return {
    own: found.properties.filter((p) => p.type === 'Property').map((p) => p.key.name ?? p.key.value),
    unknownSpreads: found.properties.filter((p) => p.type === 'SpreadElement' && !(p.argument?.callee?.name in GROUPS))
      .map((p) => js.slice(p.start, p.end).slice(0, 60)),
  };
}

/** Each group's method names, by running it for a member and for a superadmin (some names exist only for one). */
async function groupNames() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wb-groups-'));
  try {
    const out = {};
    for (const [name, rel] of Object.entries(GROUPS)) {
      const file = path.join(dir, `${name}.mjs`);
      esbuild.buildSync({ entryPoints: [path.join(ROOT, rel)], bundle: true, format: 'esm', platform: 'node', outfile: file, logLevel: 'silent' });
      const mod = await import(pathToFileURL(file).href);
      const stub = async () => ({});
      const names = new Set();
      for (const isSuperadmin of [false, true]) {
        for (const k of Object.keys(mod[name]({ workerGet: stub, workerPost: stub, workerPatch: stub, isSuperadmin }))) names.add(k);
      }
      out[name] = names;
    }
    return out;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** Every name defined in more than one place, as "name: where, where". */
export function clashes(own, groups) {
  const where = new Map();
  const add = (n, at) => where.set(n, [...(where.get(n) || []), at]);
  own.forEach((n) => add(n, 'the client'));
  for (const [g, names] of Object.entries(groups)) names.forEach((n) => add(n, g));
  return [...where].filter(([, at]) => at.length > 1).map(([n, at]) => `${n}: ${at.join(', ')}`);
}

test('no method is defined both by the WorkBench client and by a group spread into it, or by two groups', async () => {
  const lit = readReturnedLiteral(fs.readFileSync(CLIENT, 'utf8'));
  assert.ok(lit && lit.own.length > 40, `the client's own methods were not found (${lit?.own.length ?? 'no literal'}), so this proved nothing`);
  assert.deepEqual(lit.unknownSpreads, [], 'a spread this test does not know: add its factory to GROUPS so its names are checked');
  const own = lit.own;
  const groups = await groupNames();
  for (const [g, names] of Object.entries(groups)) assert.ok(names.size > 3, `${g} yielded ${names.size} methods, so this proved nothing`);
  assert.deepEqual(clashes(own, groups), [], 'a later definition silently replaces an earlier one');
});

test('the check sees a clash between the client and a group (control)', async () => {
  const groups = await groupNames();
  const adminName = [...groups.adminMethods][0];
  const planted = fs.readFileSync(CLIENT, 'utf8').replace('    ...adminMethods(', `    ${adminName}() { return null; },\n    ...adminMethods(`);
  const { own } = readReturnedLiteral(planted);
  assert.ok(own.includes(adminName), 'the planted method was read');
  assert.deepEqual(clashes(own, groups), [`${adminName}: the client, adminMethods`]);
});

test('a spread the test does not know is reported, not skipped (control)', () => {
  const src = fs.readFileSync(CLIENT, 'utf8');
  const planted = src.replace('    ...adminMethods(', '    ...newGroupMethods({ workerGet }),\n    ...EXTRA,\n    ...adminMethods(');
  assert.deepEqual(readReturnedLiteral(planted).unknownSpreads.length, 2);
  assert.deepEqual(readReturnedLiteral(src).unknownSpreads, []);
});
