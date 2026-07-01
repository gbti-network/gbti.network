// SOW-062 Phase 5f: the migration AUDIT guard. Every existing content body must round-trip IDEMPOTENTLY through the
// Phase-5 block model, so opening + re-saving an article in the new editor can never drift the body beyond the
// one-time canonicalization. This scans the real repo content (house/ + members/) and is the gate that proves the
// new editor is safe for all existing articles, products, and prompts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scanBodies, canonicalBody } from '../scripts/migrate-content-blocks.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('every existing content body is idempotent through the Phase-5 block model', () => {
  const items = scanBodies(ROOT);
  assert.ok(items.length > 0, 'expected to find content items to audit');
  const drift = [];
  for (const it of items) {
    const once = canonicalBody(it.body);
    const twice = canonicalBody(once);
    if (once !== twice) drift.push(it.path);
  }
  assert.deepEqual(drift, [], `these bodies drift on re-serialize (block-model bug): ${drift.join(', ')}`);
});
