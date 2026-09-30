// sow-430: the editor's "Make this public" button did nothing. `_makePublic` reported through a `setStatus` no element
// defines, so it threw on its first line of feedback and never asked for the approval (since sow-293, 2026-09-03).
// test/one-click-public.test.mjs only read the method's text, which is why that stayed green. These RUN it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbtiContentEditor } from '../client-ui/src/elements/gbti-content-editor.mjs';

function editor(client, itemPath = 'members/jane-doe/posts/hello/index.md') {
  // The constructor reads attributes, which needs a DOM; the method under test does not. Build the instance from the
  // real prototype, so `_makePublic` and the `client` getter are the shipped code.
  const el = Object.create(GbtiContentEditor.prototype);
  el.itemPath = itemPath;
  el.preset = { input: { title: 'Hello' } };
  el._ownClient = client; // the element's own client (base.mjs), so no page-wide client is needed
  const seen = { chip: [], banner: [] };
  el._setChip = (html, cls = '') => seen.chip.push([html, cls]);
  el._banner = (html, cls = '') => seen.banner.push([html, cls]);
  return { el, seen };
}

test('Make this public asks for the approval and says so', async () => {
  const calls = [];
  const { el, seen } = editor({ decideEditorial: async (req) => { calls.push(req); return { ok: true }; } });
  await el._makePublic();
  assert.deepEqual(calls, [{ path: 'members/jane-doe/posts/hello/index.md', decision: 'approve' }]);
  assert.deepEqual(seen.chip[0], ['Approving...', 'busy']);
  assert.match(seen.chip.at(-1)[0], /Approved/);
  assert.deepEqual(seen.banner, [['Approved. It is public within a few minutes.', '']]);
});

test('an item already public, a failed approval, and an unsaved item each say what happened', async () => {
  const pub = editor({ decideEditorial: async () => ({ alreadyPublic: true }) });
  await pub.el._makePublic();
  assert.deepEqual(pub.seen.banner, [['This item is already public.', '']]);

  const bad = editor({ decideEditorial: async () => { throw new Error('the Worker said <no>'); } });
  await bad.el._makePublic();
  assert.deepEqual(bad.seen.banner, [['the Worker said &lt;no&gt;', 'danger']], 'the error is shown, escaped');

  const calls = [];
  const unsaved = editor({ decideEditorial: async (r) => { calls.push(r); } }, null);
  await unsaved.el._makePublic();
  assert.deepEqual(calls, [], 'nothing is sent for an item with no path');
  assert.deepEqual(unsaved.seen.banner, [['Save this item first, then it can be approved.', 'warn']]);
});
