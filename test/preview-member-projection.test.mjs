import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewMemberProjection } from '../src/lib/preview-member-projection.mjs';

const MARKER = '<!-- members-only -->';
const source = `Public introduction.\n\n${MARKER}\n\n## Private details\n\nSECRET_TAIL`;

test('visitor projection keeps the public introduction and withholds the gated tail and marker', () => {
  assert.deepEqual(previewMemberProjection(source), {
    markdown: 'Public introduction.',
    gate: 'tail',
  });
});

test('member projection receives both sections without the authoring marker', () => {
  const result = previewMemberProjection(source, { asMember: true });
  assert.equal(result.gate, null);
  assert.match(result.markdown, /Public introduction/);
  assert.match(result.markdown, /SECRET_TAIL/);
  assert.doesNotMatch(result.markdown, /members-only/);
});

test('whole-item member visibility remains fully locked to a visitor', () => {
  assert.deepEqual(previewMemberProjection('WHOLE_SECRET', { visibility: 'members' }), {
    markdown: '', gate: 'whole',
  });
  assert.deepEqual(previewMemberProjection('WHOLE_SECRET', { visibility: 'members', asMember: true }), {
    markdown: 'WHOLE_SECRET', gate: null,
  });
});

test('members visibility with a populated marker still exposes the authored public teaser', () => {
  assert.deepEqual(previewMemberProjection(source, { visibility: 'members' }), {
    markdown: 'Public introduction.',
    gate: 'tail',
  });
});

test('an empty marker follows publish semantics instead of displaying a false tail gate', () => {
  const emptyTail = `Public introduction.\n\n${MARKER}\n`;
  assert.deepEqual(previewMemberProjection(emptyTail), {
    markdown: 'Public introduction.',
    gate: null,
  });
  assert.deepEqual(previewMemberProjection(emptyTail, { visibility: 'members' }), {
    markdown: '',
    gate: 'whole',
  });
});

test('editing retains the canonical source marker so it can be moved or removed', () => {
  assert.deepEqual(previewMemberProjection(source, { editing: true }), { markdown: source, gate: null });
});

test('Preview renders the audience projection instead of the raw authored body', () => {
  const preview = fs.readFileSync(new URL('../src/pages/workbench/preview.astro', import.meta.url), 'utf8');
  assert.match(preview, /previewMemberProjection\(bodyDoc\.get\(\), \{ visibility: fm\.visibility, asMember, editing \}\)/);
  assert.match(preview, /projection\.gate === 'tail'/);
});
