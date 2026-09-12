// Tab / Shift+Tab inside a rendered list (the block editor's list block; the Preview wires its own copy of this
// through its splice path). The item under the caret, and its children, move one level in or out; the caller
// re-renders and hands back the new list element so the caret lands on the same item. Kept out of
// gbti-doc-editor.mjs, which sits at the 900-line cap.
import { indentListItem, isFlatList } from '../../client/src/list-items.mjs';
import { inlineHtmlToMd } from './markdown-blocks.mjs';
import { readListDom, listItemAtSelection, caretAtEndOfItem } from './block-commit.mjs';

/**
 * Handle one keydown on a list block. `apply(items)` writes the new items onto the block and re-renders, returning
 * the re-rendered list element (or null). Returns true when the key was consumed.
 */
export function listTabKeydown(e, { el, ordered = false, selection, apply }) {
  if (!e || e.key !== 'Tab' || !el) return false;
  const sel = selection || (typeof document !== 'undefined' ? document.getSelection() : null);
  const { index } = listItemAtSelection(el, sel);
  if (index < 0) return false;
  e.preventDefault();
  const current = readListDom(el, (h) => inlineHtmlToMd(h));
  const next = indentListItem(current, index, e.shiftKey ? -1 : 1, !!ordered);
  if (!next) return true;
  const again = apply(isFlatList(next) ? next.map((it) => it.text) : next);
  const li = again ? again.querySelectorAll('li')[index] : null;
  if (again) again.focus();
  if (li) caretAtEndOfItem(li, sel);
  return true;
}
