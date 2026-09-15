// sow-322: the list bar's controls (Bullets | Numbers, the marker styles of the current kind, Remove list) as ONE
// set of buttons and ONE set of prose rules, shared by the WorkBench Preview's list bar and the doc editor's
// (both through selection-toolbar.mjs) and by the two client renderers of a body (gbti-reader.mjs,
// gbti-locked-content.mjs) and the editor's own list block. The words themselves live in client/src/list-attrs.mjs
// and what a click means in client/src/list-items.mjs (applyListAction); this module only draws them. The
// published page carries the same prose rules by hand in src/components/blog/Prose.astro (an Astro style block
// cannot import a JS string), and test/list-styles.test.mjs pins the six class names in all of them. The model of
// image-layout-ui.mjs.
import { LIST_STYLE_WORDS, styleKind, isDefaultStyle } from '../../client/src/list-attrs.mjs';

/** The kind toggle, then one style group per kind, then Remove list. `action` is what applyListAction receives
 *  (unwrap is the host's own planner, never applyListAction). */
export const LIST_STYLE_GROUPS = Object.freeze({
  kind: Object.freeze([
    { action: 'unordered', label: 'Bullets', title: 'A bulleted list' },
    { action: 'ordered', label: 'Numbers', title: 'A numbered list' },
  ]),
  bullet: Object.freeze([
    { action: 'style:disc', label: 'Disc', title: 'Round bullets (the default)' },
    { action: 'style:circle', label: 'Circle', title: 'Hollow bullets' },
    { action: 'style:square', label: 'Square', title: 'Square bullets' },
  ]),
  number: Object.freeze([
    { action: 'style:decimal', label: '1.', title: 'Numbers (the default)' },
    { action: 'style:lower-alpha', label: 'a.', title: 'Lower-case letters' },
    { action: 'style:upper-alpha', label: 'A.', title: 'Upper-case letters' },
    { action: 'style:lower-roman', label: 'i.', title: 'Lower-case roman numerals' },
    { action: 'style:upper-roman', label: 'I.', title: 'Upper-case roman numerals' },
  ]),
  remove: Object.freeze([
    { action: 'unwrap', label: 'Remove list', title: 'Turn the list into paragraphs, one per item' },
  ]),
});

/** Whether a button reads as the current state of a run { ordered, style }. The default style is pressed when
 *  the run carries no style. */
export function listStylePressed(state, action) {
  const ordered = !!state?.ordered;
  const style = state?.style || null;
  if (action === 'ordered') return ordered;
  if (action === 'unordered') return !ordered;
  if (String(action).startsWith('style:')) {
    const word = String(action).slice('style:'.length);
    if (styleKind(word) !== (ordered ? 'number' : 'bullet')) return false;
    return isDefaultStyle(word) ? !style : style === word;
  }
  return false;
}

/**
 * The buttons for a run, grouped with separators: the kind toggle, the styles of the CURRENT kind (a bullet run
 * never sees the roman numerals), Remove list. Every button carries `data-la="<action>"` and aria-pressed for
 * the current state. `sep` is the separator markup between groups.
 */
export function listStyleButtonsHtml(state, { sep = '<span class="gbti-stb-sep" aria-hidden="true"></span>' } = {}) {
  const groups = [LIST_STYLE_GROUPS.kind, state?.ordered ? LIST_STYLE_GROUPS.number : LIST_STYLE_GROUPS.bullet, LIST_STYLE_GROUPS.remove];
  return groups.map((group) => group.map((b) =>
    `<button type="button" data-la="${b.action}" title="${b.title}"`
      + (listStylePressed(state, b.action) ? ' aria-pressed="true"' : '')
      + `>${b.label}</button>`).join('')).join(sep);
}

/**
 * How the six classes render inside a body, scoped to the container that holds the prose: a run's own items
 * (the child combinator, as the sow-321 marker rules) take the marker the class names, so a sublist keeps its
 * own marker. The two defaults have no class and no rule: the plain marker rules already render them.
 */
export function listStyleProseCss(scope) {
  const s = String(scope || '').trim();
  return LIST_STYLE_WORDS.filter((w) => !isDefaultStyle(w))
    .map((w) => `  ${s} ${styleKind(w) === 'number' ? 'ol' : 'ul'}.list-${w} > li { list-style: ${w}; }`)
    .join('\n');
}
