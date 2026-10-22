// The permalink editor must render for EVERY content type.
//
// The defect this pins (reported 2026-10-21 by the first member to write an article on this CMS): the editor
// injected the permalink field at `key === 'shortDescription'`. project and prompt have that field; `post`
// does not, because an article's description field is `excerpt`. So an article rendered no permalink editor
// anywhere, and the inline slug in the document header is display-only (`slug-val locked`), so there was no
// other control that could set it. Save draft and Publish both refused with "Add a permalink first" and the
// author had no way to comply.
//
// The census below is the point: it walks every type the editor declares rather than checking the one that
// broke, because the bug was never about articles specifically. It was about anchoring a universal control
// to a field name only some types have.
import test from 'node:test';
import assert from 'node:assert/strict';

import { permalinkPlacement } from '../client-ui/src/editor-rail-sections.mjs';
import { contentEditorSource } from './lib/content-editor-source.mjs';

const src = contentEditorSource();

/** Every Details section the editor declares, by type, read from RAIL_SCHEMA in the source. */
function declaredDetailsSections() {
  const body = src.slice(src.indexOf('const RAIL_SCHEMA = {'));
  const out = {};
  for (const m of body.matchAll(/^\s{2}(\w+): \[/gm)) {
    const type = m[1];
    const after = body.slice(m.index);
    const line = after.match(/\{ title: 'Details'[^\n]*\}/);
    if (!line) continue;
    const keys = line[0].match(/keys: \[([^\]]*)\]/);
    const anchor = line[0].match(/permalinkBefore: '([^']*)'/);
    out[type] = {
      title: 'Details',
      permalinkBefore: anchor ? anchor[1] : undefined,
      keys: keys ? keys[1].split(',').map((k) => k.trim().replace(/^'|'$/g, '')).filter(Boolean) : [],
    };
  }
  return out;
}

test('every content type declares a Details section, and the census is not vacuously empty', () => {
  const sections = declaredDetailsSections();
  const types = Object.keys(sections);
  assert.ok(types.length >= 3, `expected at least post, project and prompt; got ${types.join(', ') || 'none'}`);
  for (const t of ['post', 'project', 'prompt']) assert.ok(sections[t], `${t} declares a Details section`);
});

test('every content type places a permalink editor, which is what an article did not', () => {
  for (const [type, sec] of Object.entries(declaredDetailsSections())) {
    const place = permalinkPlacement([sec]);
    assert.ok(place, `${type}: the Details rail resolves a permalink placement`);
    // `before: null` is the top-of-section fallback and still renders; what must never happen is no placement.
    if (place.before !== null) {
      assert.ok(sec.keys.includes(place.before), `${type}: the anchor '${place.before}' is a key this section has`);
    }
  }
});

test('an anchor naming a field the section does not have still renders, at the top', () => {
  const place = permalinkPlacement([{ title: 'Details', permalinkBefore: 'shortDescription', keys: ['visibility', 'excerpt'] }]);
  assert.deepEqual(place, { before: null }, 'a stale anchor falls back rather than dropping the field');
});

test('a Details section with no anchor at all still renders it', () => {
  assert.deepEqual(permalinkPlacement([{ title: 'Details', keys: ['visibility', 'excerpt'] }]), { before: null });
});

test('no Details section means no placement, and the caller is told so rather than guessing', () => {
  assert.equal(permalinkPlacement([{ title: 'Media', keys: ['coverImage'] }]), null);
  assert.equal(permalinkPlacement([]), null);
  assert.equal(permalinkPlacement(null), null);
});

test('the editor anchors on the section, not on a field name it assumes every type has', () => {
  assert.equal(src.includes("key === 'shortDescription'"), false,
    'the permalink must not be keyed to shortDescription: post does not have that field');
  assert.ok(src.includes('permalinkPlacement('), 'the editor asks permalinkPlacement where the field goes');
  assert.ok(/if \(place && !placed\)/.test(src), 'the editor keeps the render-anyway fallback');
});
