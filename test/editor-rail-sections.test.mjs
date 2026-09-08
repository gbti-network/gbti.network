// sow-164: the editor's Media section has a slot of its own for every content type, and the Copy ID button is
// the MCP ID with the value shown beside it. The split is pure; the placement and the button are source pins.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { splitRailSections } from '../client-ui/src/editor-rail-sections.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const src = readFileSync(ROOT + 'client-ui/src/elements/gbti-content-editor.mjs', 'utf8');
const code = src.replace(/\/\*[\s\S]*?\*\//g, '');

// The three schemas as the editor declares them today (the pin below proves the editor still declares them).
const SCHEMAS = {
  post: [
    { title: 'Details', open: true, keys: ['visibility', 'excerpt', 'categories', 'tags'] },
    { title: 'Article layout', open: true, keys: ['layout'] },
    { title: 'Media', open: false, keys: ['coverImage', 'coverAlt'] },
  ],
  project: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'categories', 'tags'] },
    { title: 'Layout', open: true, keys: ['sidebarPosition'] },
    { title: 'Pricing', open: true, keys: ['pricing', 'pricingUrl'] },
    { title: 'Links', open: true, keys: ['links'] },
    { title: 'Media', open: true, keys: ['icon', 'featuredImage', 'banner'] },
    { title: 'Gallery', open: false, keys: ['gallery', 'galleryStyle'] },
  ],
  prompt: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'targets', 'categories', 'tags'] },
    { title: 'Media', open: false, keys: ['image'] },
  ],
};

test('every type: Media comes out with its keys intact and the other sections keep their order', () => {
  for (const [type, schema] of Object.entries(SCHEMAS)) {
    const { media, rest } = splitRailSections(schema);
    assert.ok(media, `${type} has a Media section`);
    assert.deepEqual(media.keys, schema.find((s) => s.title === 'Media').keys, `${type}: the media keys are the schema's`);
    assert.deepEqual(rest.map((s) => s.title), schema.filter((s) => s.title !== 'Media').map((s) => s.title), `${type}: the rest keeps its order`);
    assert.equal(rest.length + 1, schema.length, `${type}: nothing lost, nothing duplicated`);
  }
});

test('a schema without Media places nothing; junk in, an empty split out', () => {
  const { media, rest } = splitRailSections([{ title: 'Details', open: true, keys: ['tags'] }]);
  assert.equal(media, null);
  assert.equal(rest.length, 1);
  assert.deepEqual(splitRailSections(undefined), { media: null, rest: [] });
});

test('the editor still declares a Media section for each of the three types (the pin behind the fixture above)', () => {
  for (const [type, schema] of Object.entries(SCHEMAS)) {
    const keys = schema.find((s) => s.title === 'Media').keys.map((k) => `'${k}'`).join(', ');
    assert.ok(src.includes(`{ title: 'Media', open: ${type === 'project'}, keys: [${keys}] }`), `${type} Media keys ${keys} in RAIL_SCHEMA`);
  }
});

test('placement: Media renders into its own slot between the document and the rail, always open', () => {
  assert.match(code, /splitRailSections\(schema\)/, 'the render uses the split');
  assert.match(code, /renderSection\(mediaSec, \{ open: true, cls: 'rsec-media' \}\)/, 'Media is open in the slot whatever the schema default');
  assert.match(code, /<\/article>\s*\$\{mediaHtml \? `<section class="media-slot"/, 'the slot follows the document and precedes the rail');
  assert.match(code, /\.doc \{ grid-row:1 \/ span 2; \}/, 'wide: the document spans both rows');
  assert.match(code, /\.media-slot \{ grid-column:2; grid-row:1;/, 'wide: Media takes the top of the right column');
  assert.match(code, /\.rail \{ grid-column:2; grid-row:2; \}/, 'wide: the rail sits under it');
  assert.match(code, /@container \(max-width:1100px\) \{[^}]*grid-template-columns:1fr;[^@]*\.media-slot \{ order:-1; \}/, 'stacked: Media orders itself above the document');
});

test('MCP ID: the button is relabeled, names the tool it serves, and shows the value beside it', () => {
  assert.match(code, /<span class="lbl">MCP ID<\/span>/);
  assert.doesNotMatch(code, /<span class="lbl">Copy ID<\/span>/, 'the old label is gone');
  assert.match(code, /title="Copy this content's MCP ID: its repo path, which the get_content tool takes"/);
  assert.match(code, /<code class="mcpid" id="mcpid"[^>]*>\$\{esc\(this\.itemPath\)\}<\/code>/, 'the readout shows the path');
  assert.match(code, /this\.on\('#mcpid', 'click', \(\) => this\.copyContentId\(\)\)/, 'the readout copies too');
  assert.match(code, /@container \(max-width:760px\) \{ \.mcpid \{ display:none; \} \}/, 'hidden when the toolbar is narrow so the sticky bar never wraps');
});
