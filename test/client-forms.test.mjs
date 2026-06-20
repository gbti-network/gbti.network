// SOW-006 form polish: per-type field drift guard, the preview markdown renderer, and image staging.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { FIELDS, fieldsFor } from '../client/src/form-fields.mjs';
import { schemaFor } from '../client/src/schemas.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { stageImage } from '../client/src/operations.mjs';
import { createStager } from '../client/src/repo-fs.mjs';

const FORCED_OR_SYSTEM = ['type', 'author', 'username', 'contributors', 'tier', 'joinedAt'];

test('form-fields: every field is a real schema key, and forced/system fields are never offered', () => {
  for (const type of Object.keys(FIELDS)) {
    const shape = new Set(Object.keys(schemaFor(type).shape));
    const fields = fieldsFor(type);
    assert.ok(fields.length > 0, `${type} has fields`);
    for (const f of fields) assert.ok(shape.has(f.key), `${type}.${f.key} is not a schema key`);
    const offered = new Set(fields.map((f) => f.key));
    for (const forbidden of FORCED_OR_SYSTEM) assert.ok(!offered.has(forbidden), `${type} must not offer ${forbidden}`);
  }
});

test('form-fields: content types require title + slug; profile requires displayName', () => {
  for (const t of ['post', 'product', 'prompt']) {
    const keys = fieldsFor(t).filter((f) => f.required).map((f) => f.key);
    assert.ok(keys.includes('title') && keys.includes('slug'), `${t} requires title+slug`);
  }
  assert.ok(fieldsFor('profile').some((f) => f.key === 'displayName' && f.required));
});

test('renderMarkdown: headings, emphasis, lists, code, links, and HTML escaping', () => {
  assert.match(renderMarkdown('# Title'), /<h1>Title<\/h1>/);
  assert.match(renderMarkdown('**bold**'), /<strong>bold<\/strong>/);
  assert.match(renderMarkdown('- a\n- b'), /<ul><li>a<\/li><li>b<\/li><\/ul>/);
  assert.match(renderMarkdown('`code`'), /<code>code<\/code>/);
  assert.match(renderMarkdown('[GBTI](https://gbti.network)'), /<a href="https:\/\/gbti\.network"[^>]*>GBTI<\/a>/);
  assert.match(renderMarkdown('```\nx<y\n```'), /<pre><code>x&lt;y<\/code><\/pre>/);
  // SOW-050: a fenced block tags its language onto the <code> (class + data-lang) for the reader's code card;
  // an unknown/dirty tag is sanitized to a safe charset.
  assert.match(renderMarkdown('```js\nconst a=1;\n```'), /<pre><code class="language-js" data-lang="js">const a=1;<\/code><\/pre>/);
  assert.match(renderMarkdown('```TS x\ny\n```'), /class="language-ts" data-lang="ts"/); // first token, lowercased
  assert.doesNotMatch(renderMarkdown('```"><img>\nz\n```'), /<img>/); // tag chars stripped, never injected
  // XSS safety: raw HTML is escaped, not injected
  assert.doesNotMatch(renderMarkdown('<script>alert(1)</script>'), /<script>/);
  assert.match(renderMarkdown('<script>alert(1)</script>'), /&lt;script&gt;/);
});

test('stageImage: writes a scoped image and rejects traversal / bad type', () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-img-'));
  const ctx = { identity: () => ({ username: 'alice', login: 'alice', githubId: '1' }), stager: createStager(repoPath), store: { get: (k) => ({ repoPath })[k] } };
  const data = Buffer.from('PNGDATA').toString('base64');

  const ok = stageImage(ctx, { filename: 'pic.png', dataBase64: data });
  assert.equal(ok.path, 'members/alice/images/pic.png');
  assert.ok(fs.existsSync(path.join(repoPath, ok.path)));

  assert.throws(() => stageImage(ctx, { filename: '../escape.png', dataBase64: data }), /invalid filename/);
  assert.throws(() => stageImage(ctx, { filename: 'evil.exe', dataBase64: data }), /unsupported image type/);
  assert.throws(() => stageImage(ctx, { filename: 'pic.png' }), /no image data/);
});
