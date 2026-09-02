// The Extension build drift job must WATCH every source the bundles inline, or it is blind to the exact
// case it exists for.
//
// THE GAP THIS CLOSES, found 2026-09-02. `extension-check.yml` watched `extension/**`, `client-ui/**` and
// `client/src/**`. But the committed bundles also inline 19 modules from `membership/` and 2 from `src/lib/`.
// A change to one of those, pushed WITHOUT re-running the two builds, leaves a stale committed artifact and
// the drift job never runs, because no watched path changed. The guard whose whole purpose is catching a
// stale artifact could not see it.
//
// It looked covered because the job DID run on such changes in practice: those commits happened to also carry
// the rebuilt artifacts, which matched `extension/**`. So the trigger fired for the wrong reason, and the one
// time it mattered (a source-only change) is precisely the time it would not have.
//
// This test derives the requirement FROM THE BUNDLES rather than restating the glob list, so it cannot go
// stale: esbuild writes a `// <path>` comment above each inlined module, and every one of those paths must be
// matched by some glob in the workflow. A newly bundled source outside the list reds here.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const WORKFLOW = path.join(ROOT, '.github/workflows/extension-check.yml');
const BUNDLES = [
  'extension/dist/background.js',
  'extension/mcp/gbti-network-mcp.mjs',
  'client-ui/dist/gbti-ui.js',
];

/** The repo-relative sources esbuild names inside a built bundle. */
function bundledSources(rel) {
  const file = path.join(ROOT, rel);
  if (!fs.existsSync(file)) return [];
  const out = new Set();
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = /^\/\/ ([A-Za-z0-9._-]+\/[A-Za-z0-9._/-]+\.(?:mjs|js|ts))$/.exec(line.trim());
    if (m) out.add(m[1]);
  }
  return [...out];
}

/** Does a workflow `paths:` glob cover this repo-relative file? Only the two forms the file uses. */
function globCovers(glob, file) {
  if (glob.endsWith('/**')) return file.startsWith(glob.slice(0, -2));
  return glob === file;
}

function workflowPaths() {
  const doc = yaml.load(fs.readFileSync(WORKFLOW, 'utf8'));
  const on = doc[true] ?? doc.on; // YAML 1.1 parses the key `on` as boolean true
  return { pull: on.pull_request.paths, push: on.push.paths };
}

test('every source inlined into a committed bundle is watched by the drift job', () => {
  const { pull, push } = workflowPaths();
  // Vendored dependencies are inlined too (js-yaml is, into extension/mcp), but they are not repo sources
  // and no source glob should match them. They are covered by watching package-lock.json instead, asserted
  // separately below, because the signal for a dependency change is the lockfile moving.
  const all = [...new Set(BUNDLES.flatMap(bundledSources))].filter((f) => !f.startsWith('node_modules/'));

  // Not vacuous: if the bundles stopped naming their sources this would pass while checking nothing.
  assert.ok(all.length > 20, `only ${all.length} bundled sources parsed; the extractor is not reading them`);

  for (const src of all) {
    assert.ok(
      pull.some((g) => globCovers(g, src)),
      `${src} is inlined into a bundle but no pull_request path glob in extension-check.yml covers it`,
    );
    assert.ok(
      push.some((g) => globCovers(g, src)),
      `${src} is inlined into a bundle but no push path glob in extension-check.yml covers it`,
    );
  }
});

test('the two filters agree, so a change cannot be caught on a PR and missed on push', () => {
  const { pull, push } = workflowPaths();
  // push legitimately omits the script-only entry; every DIRECTORY glob must appear in both.
  const dirs = (a) => a.filter((g) => g.endsWith('/**')).sort();
  assert.deepEqual(dirs(pull), dirs(push));
});

test('CONTROL: a source outside every glob would be detected', () => {
  // Proves the checker can fail. Without this, a globCovers that always returned true would pass everything.
  const { pull } = workflowPaths();
  assert.equal(pull.some((g) => globCovers(g, 'workers/signup/index.mjs')), false);
  assert.equal(pull.some((g) => globCovers(g, 'membership/classify-pr.mjs')), true);
});

test('the lockfile is watched, because a dependency bump can change a bundle with no source touched', () => {
  // js-yaml is inlined into extension/mcp. `npm update` would alter that artifact while every repo source
  // stayed identical, so without the lockfile in the filter the drift job would not run and the stale
  // artifact would ship. This is the same blindness as the membership/ gap, arriving through a different door.
  const { pull, push } = workflowPaths();
  assert.ok(pull.includes('package-lock.json'), 'pull_request must watch package-lock.json');
  assert.ok(push.includes('package-lock.json'), 'push must watch package-lock.json');

  // And prove a dependency really is inlined, so this is not guarding a hypothetical.
  const vendored = BUNDLES.flatMap(bundledSources).filter((f) => f.startsWith('node_modules/'));
  assert.ok(vendored.length > 0, 'no vendored source found in any bundle; this guard has lost its subject');
});
