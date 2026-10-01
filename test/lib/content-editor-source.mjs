// <gbti-content-editor> as ONE text: the element, then the modules it was split into at the 900-line limit (owner,
// 2026-09-30), in the order the element imports them. A test that read only the element would quietly stop seeing
// every line that moved, and a check that something is ABSENT would pass on nothing. Read the editor through this
// instead of by path.
//
// The order is chosen for the checks that compare positions. The element comes first, so the render() markup is read
// before the stylesheet that used to sit inside render() (editor-activity-tiles slices from the tile markup to the
// FIRST `rail-foot-note`, which must be the markup and not the CSS rule). Each mixin keeps its methods in their
// original relative order, so a slice from one method to the next (publish-diff, publish-clears-staged-draft) still
// measures one method. No piece leaves a block comment open past its own end (an `accept="image/*"` in fieldHtml
// opens one, and it closes inside editor-fields.mjs), so stripping comments from the joined text removes the same
// spans as stripping each piece on its own.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);
const DIR = 'client-ui/src/elements/';

/** The element, then each module it was split into, in the order the element imports them. */
export const CONTENT_EDITOR_FILES = [
  'gbti-content-editor.mjs',
  'editor-icons.mjs',
  'editor-cheatsheet.mjs',
  'content-editor-css.mjs',
  'editor-fields.mjs',
  'editor-rows.mjs',
  'editor-media.mjs',
  'editor-actions.mjs',
].map((f) => DIR + f);

/** Every editor file, joined in order. Throws if the element no longer imports a piece, or composes a mixin, so no guard reads a stale file. */
export function contentEditorSource() {
  const texts = CONTENT_EDITOR_FILES.map((f) => fs.readFileSync(new URL(f, ROOT), 'utf8'));
  const [element] = texts;
  const imported = [...element.matchAll(/^import \{[^}]*\} from '\.\/([a-z-]+\.mjs)';/gm)].map((m) => DIR + m[1]);
  const pieces = CONTENT_EDITOR_FILES.slice(1);
  const order = imported.filter((f) => pieces.includes(f));
  if (order.join() !== pieces.join()) {
    throw new Error(`content-editor-source: the element imports ${order.join(', ') || 'none of the pieces'}, expected ${pieces.join(', ')}`);
  }
  if (!/^class GbtiContentEditor extends withEditorActions\(withEditorMedia\(withEditorRows\(withEditorFields\(GbtiElement\)\)\)\) \{$/m.test(element)) {
    throw new Error('content-editor-source: GbtiContentEditor no longer composes the four mixins, so the files read here may not be what the element runs');
  }
  return texts.join('\n');
}
