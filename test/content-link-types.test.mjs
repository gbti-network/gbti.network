// The link types have ONE source, and these tests fail when any consumer drifts from it (sow-454).
//
// WHY THIS EXISTS. The same six values were written down in five places. The editor's picker offered
// `download, project, repository, github, website, docs, demo`, of which only two validate, so five of its
// seven suggestions failed on Publish with `links.0.type: Invalid input` and the four accepted values it
// never offered had to be typed by hand. A member hit this on their first project on 2026-10-13 and could
// not publish until they guessed.
//
// The defect was DRIFT, not a wrong constant, and that is what these tests are shaped around. A test that
// pinned today's seven editor values would have passed every day the editor was broken. So the checks below
// compare the CONSUMERS AGAINST THE SOURCE, and prefer exercising a consumer to reading its text: the editor
// test renders a real row, and the schema test parses real frontmatter. Re-hardcoding a list is what these
// are here to catch, so the two text checks look for exactly that and nothing else.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { CONTENT_LINK_TYPES, CONTENT_LINK_TYPE_KEYS, CONTENT_LINK_TYPES_SENTENCE } from '../src/lib/content-link-types.mjs';
import { linkLabel } from '../src/lib/project-page.mjs';
import { productSchema } from '../client/src/schemas.mjs';
import { withEditorRows } from '../client-ui/src/elements/editor-rows.mjs';
import { TOOLS } from '../client/src/mcp-tools.mjs';
import { listVocabulary } from '../client/src/vocabulary.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

test('the source holds the six authorable types, and every one has a label', () => {
  assert.deepEqual([...CONTENT_LINK_TYPE_KEYS], ['homepage', 'repository', 'mirror', 'download', 'documentation', 'support']);
  for (const t of CONTENT_LINK_TYPES) {
    assert.ok(t.label && t.label !== t.key, `${t.key} needs a human label`);
  }
});

test('the editor offers exactly the source values, and cannot offer anything else', () => {
  const inst = new (withEditorRows(class {}))();
  const html = inst._linkRowHtml({ type: 'documentation', url: 'https://x.example/' }, 0);
  const offered = [...html.matchAll(/<option value="([^"]*)"/g)].map((m) => m[1]).filter(Boolean);
  assert.deepEqual(offered, [...CONTENT_LINK_TYPE_KEYS], 'the picker and the source disagree');
  // A select cannot produce a value outside its options, which is the point: the old control was a free-text
  // input backed by a datalist, so a suggestion the schema rejected was one keystroke away.
  assert.match(html, /<select[^>]*class="selbox lk-type"/);
  assert.doesNotMatch(html, /list="lk-types"/, 'the datalist of invalid suggestions must stay gone');
  assert.match(html, /value="documentation" selected/, 'the stored value must be the selected one');
});

test('a stored value this build does not know keeps its option instead of being silently rewritten', () => {
  const inst = new (withEditorRows(class {}))();
  const html = inst._linkRowHtml({ type: 'some-older-type', url: 'https://x.example/' }, 0);
  assert.match(html, /value="some-older-type" selected/, 'an unknown type must survive merely opening the editor');
});

test('an empty type stays empty, so an untouched row is still detectable as untouched', () => {
  const inst = new (withEditorRows(class {}))();
  const html = inst._linkRowHtml({ url: 'https://x.example/' }, 0);
  assert.match(html, /<option value=""\s+selected>/, 'a new row must select the empty placeholder');
});

test('the client and MCP schema accepts every source value and rejects anything else', () => {
  const base = {
    title: 'T', slug: 't', shortDescription: 'd', status: 'published', author: 'someone',
    icon: './images/i.webp', featuredImage: './images/f.webp',
  };
  for (const type of CONTENT_LINK_TYPE_KEYS) {
    const r = productSchema.safeParse({ ...base, links: [{ type, url: 'https://a.example/' }] });
    assert.ok(r.success, `the schema rejects ${type}, which the editor offers`);
  }
  // The five the old picker suggested and the schema refused. If a later change widens the schema, this is
  // the test to revisit deliberately rather than the one to delete.
  for (const type of ['project', 'github', 'website', 'docs', 'demo']) {
    const r = productSchema.safeParse({ ...base, links: [{ type, url: 'https://a.example/' }] });
    assert.ok(!r.success, `the schema now accepts ${type}; add it to content-link-types.mjs instead`);
  }
});

test('the validation error names the allowed values rather than saying only that it is invalid', () => {
  const r = productSchema.safeParse({
    title: 'T', slug: 't', shortDescription: 'd', status: 'published', author: 'someone',
    icon: './images/i.webp', featuredImage: './images/f.webp',
    links: [{ type: 'website', url: 'https://a.example/' }],
  });
  assert.ok(!r.success);
  const msg = r.error.issues.find((i) => i.path.join('.') === 'links.0.type')?.message ?? '';
  for (const key of CONTENT_LINK_TYPE_KEYS) {
    assert.ok(msg.includes(key), `the error should name ${key}; a member saw only "Invalid input"`);
  }
});

test('every source value renders a label, and the synthetic pricing type is not authorable', () => {
  for (const t of CONTENT_LINK_TYPES) {
    assert.equal(linkLabel({ type: t.key }), t.label);
  }
  // `pricing` is built from the pricingUrl field at render time, so it must label but never be offered.
  assert.equal(linkLabel({ type: 'pricing' }), 'Pricing');
  assert.ok(!CONTENT_LINK_TYPE_KEYS.includes('pricing'), 'pricing is synthetic and must stay out of the enum');
});

test('the agent tool descriptions name every source value', () => {
  const described = TOOLS.filter((t) => /link/i.test(t.description) && /type is one of/.test(t.description));
  assert.ok(described.length >= 2, 'the authoring tools should say what a link type may be');
  for (const t of described) {
    for (const key of CONTENT_LINK_TYPE_KEYS) {
      assert.ok(t.description.includes(key), `${t.name} does not name ${key}`);
    }
  }
  assert.equal(CONTENT_LINK_TYPES_SENTENCE, CONTENT_LINK_TYPE_KEYS.join(', '));
});

test('an agent can discover the three vocabularies without reading the page', async () => {
  const ctx = { reader: { readFile: (rel) => read(rel) } };
  const v = await listVocabulary(ctx);
  assert.deepEqual(v.linkTypes.map((t) => t.type), [...CONTENT_LINK_TYPE_KEYS]);
  assert.ok(v.licenses.length > 1 && v.licenses.every((l) => typeof l.id === 'string' && l.id));
  assert.ok(v.categories.length > 1, 'the category tree must come back as paths');
  assert.ok(v.categories.every((c) => Array.isArray(c.categories) && c.categories.length));
  // The tool this replaces guessing with must itself be listed, or nothing points an agent at it.
  assert.ok(TOOLS.some((t) => t.name === 'list_vocabulary'));
});

test('a vocabulary file that cannot be read yields empty lists, never a throw', async () => {
  const v = await listVocabulary({ reader: { readFile: () => null } });
  assert.deepEqual(v.categories, []);
  assert.deepEqual(v.licenses, []);
  // The link types are code, not config, so they survive a missing file. An author is never blocked by this.
  assert.deepEqual(v.linkTypes.map((t) => t.type), [...CONTENT_LINK_TYPE_KEYS]);
});

test('no consumer has re-hardcoded the list', () => {
  for (const rel of ['src/content.config.ts', 'client/src/schemas.mjs']) {
    const src = read(rel);
    assert.match(src, /CONTENT_LINK_TYPE_KEYS/, `${rel} should read the shared source`);
    assert.doesNotMatch(
      src,
      /z\.enum\(\s*\[\s*'homepage'/,
      `${rel} has a literal link-type enum again; import CONTENT_LINK_TYPE_KEYS instead`,
    );
  }
});
