// A picture picked before a new item has a permalink (reported 2026-10-16 from a member's new project). The website
// stores an upload under the item it belongs to, so an item with no permalink cannot take one. The editor used to show
// the picture anyway and print the refusal at the bottom of the page, where Publish overwrote it: the project then
// failed with "icon: Invalid input; featuredImage: Invalid input", and an article or prompt published without its
// picture. Now the picture is held and uploaded at the start of Publish or Save draft, a failed upload puts the field
// back and says why in the field, and a required image that is still empty is named in words.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbtiContentEditor } from '../client-ui/src/elements/gbti-content-editor.mjs';
import { HELD_NOTE, notUploadedNote, NEEDS_PERMALINK, heldUploadFailed, missingImagesMessage } from '../client-ui/src/editor-image-core.mjs';
import { contentEditorSource } from './lib/content-editor-source.mjs';

const REFUSAL = 'Give this item a permalink before adding an image.'; // src/lib/workbench-client.ts stageImage

// One [data-cover] control with the parts the editor touches.
function cover(key, value = '') {
  const status = { textContent: '', cls: new Set(), classList: { toggle(c, on) { if (on) status.cls.add(c); else status.cls.delete(c); } } };
  const img = { src: '' };
  const frame = { innerHTML: '<div class="ph">no image yet</div>', querySelector: () => img };
  const clear = { hidden: !value, removeAttribute() { this.hidden = false; }, setAttribute() { this.hidden = true; }, toggleAttribute(_n, force) { this.hidden = force; } };
  const pick = { textContent: value ? 'Replace image' : 'Choose image' };
  const fld = { hidden: false };
  const control = {};
  const hidden = { value, dataset: { key }, closest: (sel) => (sel === '[data-cover]' ? control : fld) };
  const parts = { '[data-key][data-kind="image"]': hidden, '[data-coverframe]': frame, '[data-cover-clear]': clear, '[data-cover-pick]': pick, '[data-cover-st]': status };
  control.querySelector = (sel) => parts[sel] ?? null;
  return { control, hidden, frame, img, clear, pick, status, fld };
}

function editor({ slug = '', fail = null } = {}) {
  const el = Object.create(GbtiContentEditor.prototype);
  const covers = { icon: cover('icon'), featuredImage: cover('featuredImage') };
  const staged = [];
  el.type = 'project';
  el._slugVal = slug;
  el.fields = [
    { key: 'icon', label: 'Icon (small, 1:1)', kind: 'image', required: true },
    { key: 'featuredImage', label: 'Featured cover (spotlight)', kind: 'image', required: true },
    { key: 'banner', label: 'Banner', kind: 'image' },
  ];
  el.$ = (sel) => {
    const m = /\[data-key="([^"]+)"\]\[data-kind="image"\]/.exec(sel);
    return m && covers[m[1]] ? covers[m[1]].hidden : null;
  };
  el.out = () => {};
  el._markDirty = () => {};
  el.client = {
    async stageImage({ filename, item }) {
      staged.push({ filename, item });
      if (!item) throw new Error(REFUSAL);
      if (fail && filename === fail) throw new Error('That image is over 1 MB.');
      return { path: `./images/${filename}` };
    },
  };
  return { el, covers, staged };
}

const DATA = 'data:image/png;base64,AAAA';

test('the messages say what happened in plain words', () => {
  assert.equal(HELD_NOTE, 'Uploads when you save or publish.');
  assert.equal(notUploadedNote('That image is over 1 MB.'), 'Not uploaded. That image is over 1 MB.');
  assert.equal(notUploadedNote(''), 'Not uploaded. Choose it again.');
  assert.match(NEEDS_PERMALINK, /permalink/);
  assert.equal(heldUploadFailed('Icon (small, 1:1)', 'That image is over 1 MB.'), 'Icon (small, 1:1) could not be uploaded: That image is over 1 MB. Choose it again.');
  assert.equal(heldUploadFailed('Banner', ''), 'Banner could not be uploaded. Choose it again.');
  assert.equal(missingImagesMessage([]), '');
  assert.equal(missingImagesMessage(['Icon (small, 1:1)']), 'Choose an image for "Icon (small, 1:1)" before publishing.');
  assert.equal(missingImagesMessage(['A', 'B', 'C']), 'Choose an image for "A", "B" and "C" before publishing.');
});

test('held pictures upload once the item has a permalink, into their own fields', async () => {
  const { el, covers, staged } = editor({ slug: '' });
  el._heldImages = new Map([
    ['icon', { name: 'icon.png', dataUrl: DATA, before: { value: '', frame: 'x' } }],
    ['featuredImage', { name: 'cover.png', dataUrl: DATA, before: { value: '', frame: 'x' } }],
  ]);
  await assert.rejects(el._flushHeldImages(), { message: NEEDS_PERMALINK }); // no permalink yet: nothing is tried
  assert.equal(staged.length, 0);
  assert.equal(el._heldImages.size, 2, 'still held');

  el._slugVal = 'ishacked';
  await el._flushHeldImages();
  assert.deepEqual(staged, [{ filename: 'icon.png', item: 'project:ishacked' }, { filename: 'cover.png', item: 'project:ishacked' }]);
  assert.equal(covers.icon.hidden.value, './images/icon.png');
  assert.equal(covers.featuredImage.hidden.value, './images/cover.png');
  assert.equal(el._heldImages.size, 0);
  assert.equal(el._missingImagesMessage(), '', 'nothing left to name');
});

test('a failed upload puts the field back, says why in it, and stops Publish naming the field', async () => {
  const { el, covers } = editor({ slug: 'ishacked', fail: 'big.png' });
  covers.icon.frame.innerHTML = '<img data-cimg src="data:new" />'; // the picked picture is on screen
  covers.icon.clear.hidden = false;
  el._heldImages = new Map([['icon', { name: 'big.png', dataUrl: DATA, before: { value: '', frame: '<div class="ph">no image yet</div>' } }]]);
  await assert.rejects(el._flushHeldImages(), { message: 'Icon (small, 1:1) could not be uploaded: That image is over 1 MB. Choose it again.' });
  assert.equal(covers.icon.hidden.value, '', 'nothing pretends to be uploaded');
  assert.equal(covers.icon.frame.innerHTML, '<div class="ph">no image yet</div>', 'the picture is gone again');
  assert.equal(covers.icon.clear.hidden, true);
  assert.equal(covers.icon.pick.textContent, 'Choose image');
  assert.equal(covers.icon.status.textContent, 'Not uploaded. That image is over 1 MB.');
  assert.ok(covers.icon.status.cls.has('bad'));
});

test('a required image that is still empty is named before anything is sent', () => {
  const { el, covers } = editor({ slug: 'ishacked' });
  assert.equal(el._missingImagesMessage(), 'Choose an image for "Icon (small, 1:1)" and "Featured cover (spotlight)" before publishing.');
  covers.icon.hidden.value = './images/icon.png';
  assert.equal(el._missingImagesMessage(), 'Choose an image for "Featured cover (spotlight)" before publishing.');
  covers.featuredImage.fld.hidden = true; // a field not on the form is not demanded
  assert.equal(el._missingImagesMessage(), '');
});

test('Remove and Reuse drop a picture still waiting to upload', () => {
  const { el, covers } = editor({ slug: '' });
  el._heldImages = new Map([['icon', { name: 'a.png', dataUrl: DATA, before: {} }], ['featuredImage', { name: 'b.png', dataUrl: DATA, before: {} }]]);
  el._coverFrameInner = () => '';
  el.clearCover(covers.icon.control);
  assert.equal(el._heldImages.has('icon'), false);
  el.resolveCover = (p) => p;
  el._setCoverField(covers.featuredImage.control, './images/reused.png', 'https://example.test/reused.png');
  assert.equal(el._heldImages.has('featuredImage'), false, 'a reused image is not overwritten by the old pick at Publish');
});

test('Publish uploads held pictures and checks required images before it gathers; Save draft uploads them too', () => {
  const src = contentEditorSource();
  const pub = src.slice(src.indexOf('async doPublish()'), src.indexOf('async doPublish()') + 2500);
  const flush = pub.indexOf('await this._flushHeldImages();');
  const check = pub.indexOf('this._missingImagesMessage()');
  const gather = pub.indexOf('this.gather()');
  assert.ok(flush > 0 && check > flush && gather > check, 'flush, then the required-image check, then gather');
  const draft = src.slice(src.indexOf('async doDraft()'), src.indexOf('async doDraft()') + 800);
  assert.ok(draft.indexOf('await this._flushHeldImages();') > 0 && draft.indexOf('await this._flushHeldImages();') < draft.indexOf('this.gather()'));
  // A picked picture is held, not sent, while there is no permalink, and a re-render keeps showing it.
  assert.match(src, /if \(!this\.itemToken && key\) \{\s*\(this\._heldImages \|\|= new Map\(\)\)\.set\(key/);
  assert.match(src, /const held = this\._heldImages\?\.get\(f\.key\);\s*const url = held \? held\.dataUrl/);
});
