// sow-323 Phase 3: reveal a listing's members-only cards for a paying member (the pure decisions are in
// members-only-reveal-core.mjs). A listing marks the cards with <MembersOnlyCards>, which renders:
//
//   <template data-members-only data-items="<selector of one card>" data-order="newest|title|end" data-key="<attr>">
//
// The cards inside it must already be in the list's own order (the server sorts them), because each lands relative to
// the existing cards and ties keep template order. A section wrapper marked [data-members-section] (a profile list
// with only members-only items, rendered hidden) is shown when its cards are revealed.
// as the LAST child of the element that holds its cards. Each revealed card lands before the first existing card the
// order says it precedes, or after the last one, so a card in a paged list lands in whichever page holds its
// neighbour. The container then announces `members-only-revealed` (and `feed-rows-changed`, which the feed view
// already listens for), so a page script that collected its cards once can collect them again.
import { readMemberSignal, onMemberSignal, currentIdentity, type MemberSignal } from './member-signal';
import { canSeeMembersListing, planReveal } from './members-only-reveal-core.mjs';

export const REVEALED_EVENT = 'members-only-revealed';

/** Move every not-yet-revealed template's cards into its list. Returns the number of cards added. */
export function revealMembersOnly(root: ParentNode = document): number {
  let added = 0;
  root.querySelectorAll<HTMLTemplateElement>('template[data-members-only]:not([data-revealed])').forEach((tpl) => {
    const container = tpl.parentElement;
    if (!container) return;
    tpl.setAttribute('data-revealed', '');
    const selector = tpl.dataset.items || '*';
    const order = tpl.dataset.order || 'end';
    const keyAttr = tpl.dataset.key || '';
    const keyOf = (el: Element) => (keyAttr ? el.getAttribute(keyAttr) ?? '' : '');
    const existing = Array.from(container.querySelectorAll<HTMLElement>(selector));
    const cards = Array.from(tpl.content.children).map((c) => document.importNode(c, true) as HTMLElement);
    if (!cards.length) return;
    const plan = planReveal(existing.map(keyOf), cards.map(keyOf), order);
    const last = existing[existing.length - 1] ?? null;
    let tail: Element | null = last;
    for (const p of plan) {
      const card = cards[p.index];
      if (p.before != null) existing[p.before].before(card);
      else if (tail) { tail.after(card); tail = card; }
      else { container.insertBefore(card, tpl); }
      added++;
    }
    // A listing section with ONLY members-only items renders hidden for a visitor (no empty header on show).
    container.closest<HTMLElement>('[data-members-section]')?.removeAttribute('hidden');
    container.dispatchEvent(new CustomEvent(REVEALED_EVENT, { bubbles: true, detail: { added: cards.length } }));
    container.dispatchEvent(new CustomEvent('feed-rows-changed', { bubbles: true, detail: { added: cards.length } }));
  });
  return added;
}

let started = false;
/** Reveal now if the page already knows a paying member, and again when the member signal arrives. Idempotent. */
export function initMembersOnlyReveal(): void {
  if (started || typeof document === 'undefined') return;
  started = true;
  const run = (s: MemberSignal | null) => { if (canSeeMembersListing(s)) revealMembersOnly(); };
  run(currentIdentity(readMemberSignal()));
  onMemberSignal(run);
}
