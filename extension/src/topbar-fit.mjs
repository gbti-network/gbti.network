// sow-440 (owner, 2026-10-03): "on thinner screens when there are >several quick launches. We should hide the logo on
// the left before we cause our topbar to break into two rows." The owner's order (2026-10-03): the "GBTI" word goes
// first, then the logo icon, and only then, if it still does not fit, the quick launch steps aside (as it already does
// on phones). Each comes back as soon as there is room.
//
// A fixed breakpoint cannot do this: the control cluster's width depends on how many quick launch sites are switched on
// (0 to 8), which page it is (the view toggle is on the new tab only) and whether the account button has appeared. So
// the bar MEASURES whether it fits. The decision is pure (node-tested); the watcher below feeds it measurements.
//
// Why nothing flickers: the hidden states use `position: absolute; visibility: hidden` (extension/shell.css), not
// `display: none`, so a hidden item keeps its natural width and every number comes from the current layout with nothing
// toggled. Applying a state changes the size of nothing being watched, so a state can never undo itself. The quick
// launch's settings button unfolds on hover; its open width is always counted, so hovering it cannot flip the logo.

/** The order things drop in, widest first. The quick launch only goes once the whole brand has gone. */
export const FIT_STEPS = Object.freeze([
  { brand: 'full', quickLaunch: true },
  { brand: 'mark', quickLaunch: true },
  { brand: 'none', quickLaunch: true },
  { brand: 'none', quickLaunch: false },
]);

/**
 * The first step that fits on one row.
 *   row         the top bar's inner width
 *   rowGap      the gap between the brand and the control cluster (only paid while some brand shows)
 *   brandFull   the brand with its word; brandMark the brand with the icon only
 *   controls    the cluster's width WITHOUT the quick launch (its other children plus the gaps between them)
 *   quickLaunch the quick launch's width with its settings button open (0 when it is not shown at all)
 *   clusterGap  the gap the quick launch adds beside the other controls
 * When nothing fits it returns the last step; the cluster's own wrap is then the safety net.
 */
export function decideTopbarFit({ row = 0, rowGap = 0, brandFull = 0, brandMark = 0, controls = 0, quickLaunch = 0, clusterGap = 0, slack = 1 } = {}) {
  const brandOf = (b) => (b === 'full' ? brandFull : b === 'mark' ? brandMark : 0);
  for (const step of FIT_STEPS) {
    const brand = brandOf(step.brand);
    const ql = step.quickLaunch && quickLaunch > 0 ? quickLaunch + clusterGap : 0;
    if (brand + (brand > 0 ? rowGap : 0) + controls + ql <= row - slack) return { ...step };
  }
  return { ...FIT_STEPS[FIT_STEPS.length - 1] };
}

/**
 * The quick launch's width as if its settings button were open. `more` is that button's wrapper as measured now:
 * `width` and `marginRight` are its current box (0 and -4 when folded), `openWidth` its content width (its scrollWidth).
 * Folded, open or half way through the animation, the answer is the same.
 */
export function reservedQuickLaunchWidth(measured = 0, more = null) {
  if (!more || !(measured > 0)) return Math.max(0, measured || 0);
  const now = (more.width || 0) + (more.marginRight || 0);
  return measured + Math.max(0, (more.openWidth || 0) - now);
}

const px = (v) => parseFloat(v) || 0;

/** Watch one top bar: measure, decide, and write `data-fit-brand` / `data-fit-ql` whenever the answer changes. */
export function watchTopbarFit(topbar) {
  if (!topbar || typeof ResizeObserver !== 'function') return () => {};
  const brand = topbar.querySelector('.nt-brand');
  const controls = topbar.querySelector('.nt-controls');
  if (!controls) return () => {};
  const mk = brand?.querySelector('.nt-brand-mk');
  const tx = brand?.querySelector('.nt-brand-tx');

  const measure = () => {
    const cs = getComputedStyle(topbar);
    const row = topbar.getBoundingClientRect().width - px(cs.paddingLeft) - px(cs.paddingRight);
    const rowGap = px(cs.columnGap);
    let brandFull = 0;
    let brandMark = 0;
    if (brand && getComputedStyle(brand).display !== 'none') {
      const bs = getComputedStyle(brand);
      const pad = px(bs.paddingLeft) + px(bs.paddingRight);
      const mkW = mk ? mk.getBoundingClientRect().width : 0;
      const txW = tx && getComputedStyle(tx).display !== 'none' ? tx.getBoundingClientRect().width : 0;
      brandMark = pad + mkW;
      brandFull = txW > 0 ? brandMark + px(bs.columnGap) + txW : brandMark;
    }
    const clusterGap = px(getComputedStyle(controls).columnGap);
    let width = 0;
    let count = 0;
    let quickLaunch = 0;
    for (const el of controls.children) {
      if (getComputedStyle(el).display === 'none') continue; // takes no space and no gap
      const w = el.getBoundingClientRect().width;
      if (el.matches('.nt-apps')) {
        const more = el.querySelector('.ql-more');
        const ms = more ? getComputedStyle(more) : null;
        quickLaunch = reservedQuickLaunchWidth(w, more ? { width: more.getBoundingClientRect().width, marginRight: px(ms.marginRight), openWidth: more.scrollWidth } : null);
        continue;
      }
      width += w;
      count += 1;
    }
    const controlsWidth = width + Math.max(0, count - 1) * clusterGap;
    return { row, rowGap, brandFull, brandMark, controls: controlsWidth, quickLaunch, clusterGap: count > 0 ? clusterGap : 0 };
  };

  const apply = () => {
    const fit = decideTopbarFit(measure());
    if (topbar.dataset.fitBrand !== fit.brand) topbar.dataset.fitBrand = fit.brand;
    const ql = fit.quickLaunch ? 'on' : 'off';
    if (topbar.dataset.fitQl !== ql) topbar.dataset.fitQl = ql;
  };

  const ro = new ResizeObserver(apply);
  ro.observe(topbar);
  if (tx) ro.observe(tx); // the word's width changes only when the font does, never because of a state
  for (const el of controls.children) ro.observe(el);
  document.fonts?.ready?.then(apply).catch(() => {});
  apply();
  return () => ro.disconnect();
}
