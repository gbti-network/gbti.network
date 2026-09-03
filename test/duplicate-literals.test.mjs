// sow-196 follow-up (2026-09-03): a repo-wide guard against the clobber shape that a bulk rename produces.
//
// When a rename KEEPS the old name somewhere for compatibility, the compatibility edit and the bulk replace
// fight, and the bulk replace wins silently. A line written to carry BOTH names is exactly the line the
// sweep destroys, turning the retained value into a duplicate of its replacement:
//
//   { project: X, product: X }            -> { project: X, project: X }     (JS keeps the last)
//   case 'projects': case 'products':     -> case 'projects': case 'projects':
//
// Seven such sites shipped on sow-196. The object-literal ones were caught only by an esbuild warning
// noticed by chance during an unrelated build; the array, enum, route-param and switch-case ones warn from
// NOTHING and rode a green 4280-test suite to production.
//
// This runs esbuild's parser over every source file deliberately, instead of hoping someone reads a build
// log. It catches duplicates anywhere, including in files no bundle includes, which is where the silent
// ones lived.
//
// It does NOT catch a legacy value that was simply DELETED rather than duplicated, because that leaves no
// duplicate to find. test/legacy-type-compat.test.mjs covers the specific retentions for that reason; the
// two guards are complements, not overlaps.
//
// esbuild is a transitive dependency (via astro) pinned in package-lock.json, so `npm ci` installs it. The
// import is deliberately NOT wrapped in a try/catch: if it ever disappears this test must fail loudly
// rather than skip, because a guard that quietly stops running prevents nothing.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as esbuild from 'esbuild';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Generated output is exempt: a bundle legitimately concatenates many scopes, and public/tools carries
// vendored minified libraries we do not author.
const EXEMPT = /(^|\/)(dist|public\/tools)\//;

function sources() {
  return execSync("git ls-files '*.ts' '*.mjs' '*.js' '*.astro'", { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => f && !f.includes('node_modules/') && !EXEMPT.test(f));
}

// An .astro file is HTML with a TypeScript frontmatter fence; only the fence is JavaScript.
function sourceFor(file, txt) {
  if (!file.endsWith('.astro')) {
    return { code: txt, loader: file.endsWith('.ts') ? 'ts' : 'js', offset: 0 };
  }
  const m = /^---\n([\s\S]*?)\n---/.exec(txt);
  return m ? { code: m[1], loader: 'ts', offset: 1 } : null;
}

async function duplicatesIn(label, code, loader, offset) {
  const r = await esbuild.transform(code, { loader, logLevel: 'silent' });
  return (r.warnings ?? [])
    .filter((w) => /duplicate/i.test(w.text))
    .map((w) => `${label}:${(w.location?.line ?? 0) + offset}  ${w.text}`);
}

test('the duplicate detector actually detects a duplicate', async () => {
  // Without this, a clean result over the repo is indistinguishable from a detector that reports nothing.
  const objHits = await duplicatesIn('CONTROL', 'export const M = { project: 1, project: 2 };\n', 'js', 0);
  assert.equal(objHits.length, 1, `the detector missed a planted duplicate KEY: ${JSON.stringify(objHits)}`);

  const caseHits = await duplicatesIn(
    'CONTROL',
    "export function f(n) { switch (n) { case 'a': return 1; case 'a': return 2; default: return 0; } }\n",
    'js', 0,
  );
  assert.equal(caseHits.length, 1, `the detector missed a planted duplicate CASE: ${JSON.stringify(caseHits)}`);
});

test('no source file contains a duplicate object key or switch case', async () => {
  const files = sources();
  assert.ok(files.length > 500, `only ${files.length} source files listed; the enumeration is wrong, so a clean result would be vacuous`);

  const hits = [];
  let parsed = 0;
  const unparseable = [];
  for (const file of files) {
    const txt = readFileSync(path.join(ROOT, file), 'utf8');
    const src = sourceFor(file, txt);
    if (!src) continue; // an .astro page with no frontmatter fence has no JavaScript to check
    try {
      hits.push(...await duplicatesIn(file, src.code, src.loader, src.offset));
      parsed++;
    } catch (err) {
      // A parse failure is not a clean result. Collect it so it can never be mistaken for one.
      unparseable.push(`${file}: ${err?.message?.split('\n')[0] ?? err}`);
    }
  }

  assert.deepEqual(unparseable, [], `files the detector could not parse (these were NOT checked):\n${unparseable.join('\n')}`);
  assert.ok(parsed > 500, `only ${parsed} files actually parsed; a clean result would be vacuous`);
  assert.deepEqual(hits, [], `duplicate key or case found. A bulk rename over a line carrying two names produces exactly this, and nothing else reports it:\n${hits.join('\n')}`);
});
