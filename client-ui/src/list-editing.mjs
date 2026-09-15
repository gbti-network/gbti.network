// Tab / Shift+Tab inside a rendered list (the block editor's list block; the Preview wires its own copy of this
// through its splice path), and (sow-322) the list bar's hooks for the block editor. The item under the caret,
// and its children, move one level in or out; the caller re-renders and hands back the new list element so the
// caret lands on the same item. Kept out of gbti-doc-editor.mjs, which sits at the 900-line cap.
import { indentListItem, isFlatList, normalizeListItems, applyListAction, listRunState } from '../../client/src/list-items.mjs';
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

/** The block-model shape a list keeps: plain strings for a flat unstyled list, objects otherwise. */
const shapeOf = (items) => (isFlatList(items) ? items.map((it) => it.text) : items);

/**
 * sow-322: the `listTools` contract (selection-toolbar.mjs) for the block editor, over its block model. The bar
 * shows when the caret is inside a `.ce[data-edit="list"]` host; a click reads the list back first (a half-typed
 * item is not lost), applies the shared applyListAction to the model (MODEL-IS-TRUTH: mutate the block,
 * re-render) or, for Remove list, splices one paragraph block per item in the list's place; then the caret
 * goes back to the same item so the bar re-shows for it. `host` is the slice of the editor this needs:
 *   ceOf(node)        the .ce element holding node          byId(id) / indexOf(id)   the block and its index
 *   blocks()          the live block array                  withId(block)            a new block wearing an id
 *   render() / change()                                     query(selector)          this.$ on the shadow root
 *   selection()       the root's selection                  focusBlock(id)           caret at the end of a block
 */
export function listBarTools(host) {
  const md = (h) => inlineHtmlToMd(h);
  return {
    listOf: (node) => {
      const ce = host.ceOf(node);
      return ce && ce.dataset && ce.dataset.edit === 'list' ? ce : null;
    },
    stateOf: (el, index) => {
      const b = host.byId(el.dataset.id);
      return b ? listRunState(b.items, !!b.ordered, index) : { ordered: false, style: null, depth: 0 };
    },
    onAction: (el, index, action) => {
      const b = host.byId(el.dataset.id);
      if (!b) return;
      const current = readListDom(el, md);
      if (action === 'unwrap') {
        const i = host.indexOf(b._id);
        if (i < 0) return;
        const texts = normalizeListItems(current, !!b.ordered).map((it) => it.text).filter((t) => t.trim() !== '');
        const paras = (texts.length ? texts : ['']).map((text) => host.withId({ type: 'paragraph', text }));
        host.blocks().splice(i, 1, ...paras);
        host.render(); host.change();
        host.focusBlock(paras[0]._id);
        return;
      }
      const next = applyListAction({ ordered: !!b.ordered, items: current }, index, action);
      if (!next) return;
      b.ordered = next.ordered;
      b.items = shapeOf(next.items);
      host.render(); host.change();
      const again = host.query(`.ce[data-edit="list"][data-id="${b._id}"]`);
      const li = again ? again.querySelectorAll('li')[index] : null;
      if (again) again.focus();
      if (li) caretAtEndOfItem(li, host.selection());
    },
  };
}
