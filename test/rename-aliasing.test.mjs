// SOW-112: read-time slug aliasing. aliasSlugsOf derivation, the saved-list alias index, and the comment
// listing union (repo-fs). No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { aliasSlugsOf } from '../src/lib/content-index.mjs';
import { buildItemIndex, resolveItem } from '../client-ui/src/saved-core.mjs';
import { createReader } from '../client/src/repo-fs.mjs';

test('aliasSlugsOf: only rename-generated (canonical URL shaped) entries yield aliases', () => {
  const d = {
    slug: 'new-name',
    redirectFrom: [
      '/prompts/old-name/',            // rename artifact -> alias
      '/devops/frameworks/old-wp/',    // legacy WordPress shape -> ignored
      '/prompts/new-name/',            // self -> ignored
      '/articles/other-old/',          // a rename artifact from another type section? still a valid alias shape
    ],
  };
  assert.deepEqual(aliasSlugsOf(d), ['old-name', 'other-old']);
  assert.deepEqual(aliasSlugsOf({}), []);
  assert.deepEqual(aliasSlugsOf({ redirectFrom: 'not-an-array' }), []);
});

test('saved-core: an old-slug saved row resolves to the renamed item via alias keys (current entry wins)', () => {
  const index = buildItemIndex({
    prompt: [{ slug: 'new-name', title: 'The Prompt', url: '/prompts/new-name/', path: 'p', aliases: ['old-name'] }],
    post: [{ slug: 'old-name', title: 'A Different Post', url: '/articles/old-name/', path: 'q' }],
  });
  const viaAlias = resolveItem(index, 'prompt', 'old-name');
  assert.equal(viaAlias.title, 'The Prompt');
  assert.equal(viaAlias.url, '/prompts/new-name/');
  // the alias never crosses types, and a REAL entry at the same key is never overwritten
  assert.equal(resolveItem(index, 'post', 'old-name').title, 'A Different Post');
});

test('repo-fs listComments unions the alias slugs (pre-rename comments keep resolving)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-alias-'));
  const cdir = path.join(dir, 'members', 'bob', 'comments');
  fs.mkdirSync(cdir, { recursive: true });
  fs.writeFileSync(path.join(cdir, 'c1.md'), '---\ntype: comment\nid: c1\nauthor: bob\ntargetType: prompt\ntargetSlug: old-name\nstatus: published\nvisibility: public\ncreatedAt: 2026-07-01\n---\n\nOld-slug comment.\n');
  fs.writeFileSync(path.join(cdir, 'c2.md'), '---\ntype: comment\nid: c2\nauthor: bob\ntargetType: prompt\ntargetSlug: new-name\nstatus: published\nvisibility: public\ncreatedAt: 2026-07-05\n---\n\nNew-slug comment.\n');
  const reader = createReader(dir);
  assert.equal(reader.listComments('prompt', 'new-name', 100).length, 1);
  assert.equal(reader.listComments('prompt', 'new-name', 100, ['old-name']).length, 2);
  fs.rmSync(dir, { recursive: true, force: true });
});
