// SOW-129 QA hardening: <gbti-profile-editor> loads profile.md frontmatter into a working model. YAML parses an
// unquoted numeric/boolean value (e.g. a numeric social handle `discord: 123456789`) as a Number/Boolean; the
// model then feeds `.trim()` in _buildInput and render, which throws on a non-string. _modelFromFm now coerces
// every text field to a string on load, so a hand-crafted or migrated malformed profile.md never crashes the
// editor. (In shipped flows the editor's own serializer quotes such values and content-check rejects them at the
// gate, so this is defense-in-depth, not a reachable-in-app bug.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbtiProfileEditor } from '../client-ui/src/elements/gbti-profile-editor.mjs';

test('_modelFromFm: coerces numeric/boolean YAML values to strings', () => {
  const el = new GbtiProfileEditor();
  const m = el._modelFromFm(
    { displayName: 123, headline: true, avatar: 0, location: 42, links: { discord: 456789, github: 'ok' }, skills: ['a', 7], roles: ['dev', 9] },
    'body',
  );
  assert.equal(m.displayName, '123');
  assert.equal(m.headline, 'true');
  assert.equal(m.avatar, '0');
  assert.equal(m.location, '42');
  assert.equal(m.links.discord, '456789');
  assert.equal(m.links.github, 'ok');
  assert.deepEqual(m.skills, ['a', '7']);
  assert.deepEqual(m.roles, ['dev', '9']);
  // every link value is a string
  for (const v of Object.values(m.links)) assert.equal(typeof v, 'string');
});

test('_buildInput: does not throw on a model built from numeric YAML values', () => {
  const el = new GbtiProfileEditor();
  el._status = { identity: { login: 'alice' } };
  el._model = el._modelFromFm({ displayName: 999, links: { discord: 123456789, youtube: 42 } }, '');
  let input;
  assert.doesNotThrow(() => { input = el._buildInput(); });
  assert.equal(input.displayName, '999');
  // a non-empty coerced handle survives into the built links (discord is verbatim; youtube gets its base URL)
  assert.equal(input.links.discord, '123456789');
  assert.match(input.links.youtube, /^https:\/\/(www\.)?youtube\.com\/@42$/);
});

test('_modelFromFm: null/undefined fields become empty strings, arrays default to []', () => {
  const el = new GbtiProfileEditor();
  const m = el._modelFromFm({}, '');
  assert.equal(m.displayName, '');
  assert.equal(m.headline, '');
  assert.equal(m.avatar, '');
  assert.deepEqual(m.skills, []);
  assert.deepEqual(m.roles, []);
  assert.deepEqual(m.links, {});
});
