// sow-452: the ```directory block. An article declares a sortable list with a fence, and the items are the h3
// entries that follow it, up to the next h2. Nothing is duplicated into data attributes (member markdown cannot
// carry any): each item's rank, type and subscriber count are read from its own text.
//
//   ### #100. Channel name
//   ...
//   Plugin and theme company · 4.5K subscribers · 83% of 2026 videos about WordPress · ...
//
// Without the script the list reads correctly in its source order (a countdown). The pure helpers below are
// tested on their own; enhanceSortList(root) is the page side, used by the article page and the WorkBench preview.

/** "#100. Name" -> 100; anything else -> null. */
export function parseRank(heading) {
  const m = String(heading ?? '').trim().match(/^#\s*(\d+)\s*[.:)]/);
  return m ? Number(m[1]) : null;
}

/** "4.5K subscribers" -> 4500, "1.24M subscribers" -> 1240000, "625 subscribers" -> 625; none -> null. */
export function parseSubscribers(text) {
  // No \b after the word: a stat strip's text runs straight on ("63K subscribers46% of ...").
  const m = String(text ?? '').match(/([\d][\d,]*(?:\.\d+)?)\s*([KkMm])?\s+subscribers?(?![A-Za-z])/);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ''));
  const mult = /k/i.test(m[2] || '') ? 1e3 : /m/i.test(m[2] || '') ? 1e6 : 1;
  return Math.round(n * mult);
}

/** A stats line "Type · 4.5K subscribers · ..." -> { type, subscribers }, or null when it is not a stats line. */
export function parseStats(text) {
  const t = String(text ?? '').replace(/\s+/g, ' ').trim();
  const subscribers = parseSubscribers(t);
  if (subscribers == null) return null;
  const first = t.split(/\s+·\s+/)[0];
  const type = first && parseSubscribers(first) == null ? first.trim() : null;
  return { type, subscribers };
}

export const SORT_MODES = [
  { key: 'score', label: 'Score' },
  { key: 'category', label: 'Category' },
  { key: 'subscribers', label: 'Subscribers' },
];

const byRankDesc = (a, b) => (b.rank ?? -1) - (a.rank ?? -1) || a.index - b.index;

/**
 * Order items ({ rank, type, subscribers, index }) for a mode. Always returns groups: [{ label, items }], one
 * unlabelled group except in the category view.
 *   score:       the countdown, highest rank number first, #1 last (the article's own order)
 *   subscribers: largest first; ties keep the countdown (displayNumbers renumbers this view: largest #1, fewest #N)
 *   category:    one group per type, the biggest group first (ties by name), countdown inside each
 */
export function orderItems(items, mode) {
  const list = items.slice();
  if (mode === 'subscribers') {
    return [{ label: null, items: list.sort((a, b) => (b.subscribers ?? -1) - (a.subscribers ?? -1) || byRankDesc(a, b)) }];
  }
  if (mode === 'category') {
    const groups = new Map();
    for (const it of list) {
      const k = it.type || 'Other';
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
    return [...groups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
      .map(([label, its]) => ({ label, items: its.sort(byRankDesc) }));
  }
  return [{ label: null, items: list.sort(byRankDesc) }];
}

/**
 * Owner, 2026-10-14: "Sort by Subscribers should change the numeric rating and the least amount of subscribers should
 * be #100." The number each entry shows in a view: in the subscribers view its place by subscriber count (the most is
 * #1, the fewest #N, unknown counts after them); in the score and category views its own rank from the heading.
 * Returns Map(item -> number).
 */
export function displayNumbers(groups, mode) {
  const out = new Map();
  if (mode === 'subscribers') groups.flatMap((g) => g.items).forEach((it, i) => out.set(it, i + 1));
  else for (const g of groups) for (const it of g.items) out.set(it, it.rank);
  return out;
}

/** Rewrite the "#N" a heading starts with, leaving the rest of the heading (name, links, ids) as it is. */
function setHeadingNumber(h, num) {
  if (num == null) return;
  const walker = h.ownerDocument.createTreeWalker(h, 4); // NodeFilter.SHOW_TEXT
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    if (/^\s*#\s*\d+/.test(t.nodeValue)) { t.nodeValue = t.nodeValue.replace(/^(\s*#\s*)\d+/, `$1${num}`); return; }
  }
}

/**
 * Owner, 2026-10-13: in the category view each category is also a sub-filter. Keep only the group named `sub`; no
 * sub (or one that is not a group) keeps them all.
 */
export function filterGroups(groups, sub) {
  if (!sub || !groups.some((g) => g.label === sub)) return groups;
  return groups.filter((g) => g.label === sub);
}

// ---- page side ----

const STATE = new WeakMap(); // the list's document -> the last mode chosen, so a re-render keeps the view

/** Collect the items after a .sortlist placeholder: each h3 and its following siblings, up to the next h2. */
function collectItems(box) {
  const items = [];
  let cur = null;
  for (let n = box.nextElementSibling; n && n.tagName !== 'H2'; n = n.nextElementSibling) {
    if (n.tagName === 'H3') {
      cur = { nodes: [n], rank: parseRank(n.textContent), type: null, subscribers: null, index: items.length };
      items.push(cur);
    } else if (cur) {
      cur.nodes.push(n);
      // sow-453: a ```tags block names the category (its first tag); the stats line is the fallback.
      const tag = n.matches?.('.gbti-tags') ? n.querySelector('.gbti-tag') : null;
      if (tag) cur.tagType = tag.textContent.trim();
      // sow-453 option A: a ```stats caption names the category in its first segment.
      const cap = n.matches?.('.gbti-stats') ? n.querySelector('.gbti-stats-caption') : null;
      if (cap && !cur.tagType) cur.tagType = cap.textContent.split(/\s+·\s+/)[0].trim();
      if (cur.subscribers == null) {
        const s = parseStats(n.textContent);
        if (s) { cur.type = s.type; cur.subscribers = s.subscribers; }
      }
    }
  }
  for (const it of items) if (it.tagType) it.type = it.tagType;
  return items;
}

/** Elements pinned to the top of the page that the sticky sort bar must sit below. */
export const STICKY_STACK = '.site-head, .pv-bar';

/** Upgrade every .sortlist placeholder under root into a sort bar over the entries that follow it. */
export function enhanceSortList(root = document) {
  const doc = root.ownerDocument || root;
  root.querySelectorAll('div.sortlist').forEach((box) => {
    if (box.querySelector('.sortlist-bar')) return; // already enhanced
    const items = collectItems(box);
    if (items.length < 2) return;
    const wrap = doc.createElement('div');
    wrap.className = 'sortlist-items';
    box.after(wrap);
    for (const it of items) {
      const holder = doc.createElement('div');
      holder.className = 'sortlist-item';
      it.nodes.forEach((n) => holder.append(n));
      it.el = holder;
      wrap.append(holder);
    }

    const bar = doc.createElement('div');
    bar.className = 'sortlist-bar';
    bar.setAttribute('role', 'group');
    bar.setAttribute('aria-label', 'Sort the list');
    const lab = doc.createElement('span');
    lab.className = 'sortlist-lab';
    lab.textContent = 'Sort by';
    bar.append(lab);
    const buttons = SORT_MODES.map((m) => {
      const b = doc.createElement('button');
      b.type = 'button';
      b.className = 'sortlist-btn';
      b.dataset.mode = m.key;
      b.textContent = m.label;
      b.addEventListener('click', () => apply(m.key, true));
      bar.append(b);
      return b;
    });
    const count = doc.createElement('span');
    count.className = 'sortlist-count';
    count.textContent = `${items.length} channels`;
    bar.append(count);
    // The category sub-filters: a second row inside the same sticky bar, shown only in the category view.
    const subRow = doc.createElement('div');
    subRow.className = 'sortlist-sub';
    subRow.setAttribute('role', 'group');
    subRow.setAttribute('aria-label', 'Show one category');
    subRow.hidden = true;
    bar.append(subRow);
    let sub = null;
    // Owner, 2026-10-13: the bar stays on screen while the list scrolls. A sticky element only sticks inside its
    // parent, so the entries move into the box with it, and it parks just under the site's sticky header.
    box.append(bar, wrap);
    // The offset is the bottom of everything already pinned to the top of the page: the site header, and on the
    // WorkBench preview the PREVIEW strip under it (owner, 2026-10-13: the bar hid behind that strip).
    const view = doc.defaultView;
    const stack = [...doc.querySelectorAll(STICKY_STACK)];
    const park = () => {
      let off = 0;
      for (const el of stack) {
        const cs = view?.getComputedStyle(el);
        if (!cs || (cs.position !== 'sticky' && cs.position !== 'fixed') || cs.display === 'none') continue;
        off = Math.max(off, (parseFloat(cs.top) || 0) + el.getBoundingClientRect().height);
      }
      box.style.setProperty('--sortlist-top', `${Math.round(off)}px`);
      // The bar's own height, so an entry reached by its link stops below the bar too (Prose.astro scroll-margin).
      box.style.setProperty('--sortlist-bar', `${Math.round(bar.getBoundingClientRect().height)}px`);
    };
    park();
    view?.addEventListener('resize', park);
    if (view?.ResizeObserver) { const ro = new view.ResizeObserver(park); [...stack, bar].forEach((el) => ro.observe(el)); } // the strip's note and the bar's category row change heights

    function apply(mode, fromClick) {
      STATE.set(doc, mode);
      buttons.forEach((b) => {
        const on = b.dataset.mode === mode;
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      const groups = orderItems(items, mode);
      // Every entry, shown or filtered out, carries the number of the current view.
      const nums = displayNumbers(groups, mode);
      for (const it of items) setHeadingNumber(it.nodes[0], nums.get(it));
      if (mode !== 'category') sub = null;
      if (sub && !groups.some((g) => g.label === sub)) sub = null;
      subRow.hidden = mode !== 'category';
      subRow.replaceChildren();
      if (mode === 'category') {
        for (const [label, n] of [[null, items.length], ...groups.map((g) => [g.label, g.items.length])]) {
          const b = doc.createElement('button');
          b.type = 'button';
          b.className = 'sortlist-btn sortlist-subbtn';
          b.textContent = label || 'All'; // counts live in the bar ("13 of 100 channels") and the group heading
          b.setAttribute('aria-label', `${label || 'All'}, ${n} channels`);
          const on = label === sub;
          b.classList.toggle('on', on);
          b.setAttribute('aria-pressed', String(on));
          b.addEventListener('click', () => { sub = label; apply('category', true); });
          subRow.append(b);
        }
      }
      // A swiped row (phone) keeps the chosen pill in view; a wrapped row (wide screen) never scrolls.
      const chosen = subRow.querySelector('.sortlist-subbtn.on');
      if (chosen && subRow.scrollWidth > subRow.clientWidth) subRow.scrollLeft = Math.max(0, chosen.offsetLeft - subRow.offsetLeft - 24);
      const shown = filterGroups(groups, sub);
      const total = shown.reduce((a, g) => a + g.items.length, 0);
      count.textContent = total === items.length ? `${items.length} channels` : `${total} of ${items.length} channels`;
      wrap.replaceChildren(); // filtered-out entries stay in memory, ready to come back
      for (const g of shown) {
        if (g.label) {
          const h = doc.createElement('div');
          h.className = 'sortlist-group';
          h.setAttribute('role', 'heading');
          h.setAttribute('aria-level', '3');
          h.textContent = `${g.label} (${g.items.length})`;
          wrap.append(h);
        }
        g.items.forEach((it) => wrap.append(it.el));
      }
      if (fromClick) {
        // Back to the top of the list, stopping under the sticky header rather than behind it.
        const top = box.getBoundingClientRect().top;
        const off = parseFloat(box.style.getPropertyValue('--sortlist-top')) || 0;
        if (top < off) view?.scrollBy({ top: top - off, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    }
    apply(STATE.get(doc) || 'score', false);
    // A link to one entry (each YouTube creator's invite opens their own) is scrolled by the browser before this
    // bar exists, so the heading lands under the bar. Scroll once more now that the offsets are set, as a jump:
    // the site scrolls smoothly, and from the top of a long list that is a glide of a second or more.
    let id = '';
    try { id = decodeURIComponent((view?.location?.hash || '').slice(1)); } catch { id = ''; }
    const target = id ? doc.getElementById(id) : null;
    if (target && box.contains(target)) {
      const root = doc.documentElement;
      const was = root.style.scrollBehavior;
      root.style.scrollBehavior = 'auto';
      target.scrollIntoView({ block: 'start' });
      root.style.scrollBehavior = was;
    }
  });
}
