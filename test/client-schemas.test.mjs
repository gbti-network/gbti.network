// SOW-006 schema drift guard. The client keeps its own zod-4 copy of the content schemas (the site's
// astro:content uses zod 3, so a single shared object is impossible). This test PINS that copy to reality:
// it validates every real repo content file against the client schemas. If the site schema and real
// content evolve in a way the client copy does not cover, this fails, flagging the drift.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { schemaFor } from '../client/src/schemas.mjs';
import { parseContentFile } from '../client/src/content-ops.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.(md|mdx)$/.test(e.name)) out.push(full);
  }
  return out;
}

/** Classify a content file path to one of the client's authorable schema types, or null. */
function typeOf(rel) {
  if (/(^|\/)profile\.md$/.test(rel)) return 'profile';
  if (/\/posts\//.test(rel)) return 'post';
  if (/\/products\//.test(rel)) return 'product';
  if (/\/prompts\//.test(rel)) return 'prompt';
  return null;
}

test('client schemas validate all real repo content (drift tripwire)', () => {
  const files = [...walk(path.join(ROOT, 'members')), ...walk(path.join(ROOT, 'house'))];
  const failures = [];
  let checked = 0;

  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const type = typeOf(rel);
    if (!type) continue; // pages/comments are not client-authorable types
    const schema = schemaFor(type);
    if (!schema) continue;
    const { frontmatter } = parseContentFile(fs.readFileSync(file, 'utf8'));
    const result = schema.safeParse(frontmatter);
    checked++;
    if (!result.success) {
      failures.push(`${rel} (${type}): ${result.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
    }
  }

  assert.ok(checked > 0, 'expected to find real content to validate');
  assert.deepEqual(failures, [], `client schemas drifted from real content:\n${failures.join('\n')}`);
});
