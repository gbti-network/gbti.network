// sow-337: the pure half of <gbti-cta-manager>, the superadmin call-to-action editor from the approved design. It
// holds no DOM: the editor's draft, the field messages the design specifies, the save payload an edit becomes, and
// the helpers behind "found in the code" and page search. The element renders from these; the tests drive them.
//
// Two layers of validation, on purpose. The design's messages come first, per field, in plain words ("Add the
// sentence the card shows."). Then the shared registry rules (membership/cta-edits.mjs validateCta, the rules every
// writer and the content check apply) run on the card the draft would save, and anything they still refuse is shown
// as the banner, so the editor can never let through a save the server will refuse.
import { validateCta, amazonDestinationProblem, CTA_HOST_RE, CTA_LIMITS } from '../../membership/cta-edits.mjs';
import { layoutUses, CTA_LAYOUTS, CTA_LAYOUT_NAMES } from '../../membership/cta-card-render.mjs';

export { CTA_LAYOUTS, CTA_LAYOUT_NAMES };

export const LAYOUT_HINT = Object.freeze({
  below: 'Title, sentence, image, then the button.',
  first: 'The image leads, then the words and the button.',
  compact: 'A small image beside the words. Uses the least height.',
  image: 'The whole card is the image and links to the partner.',
  html: 'Your partner code, with the title above it if you want.',
  text: 'Title, sentence and button, with no image.',
});
export const LAYOUT_TILE_TEXT = Object.freeze({
  below: 'Title, sentence, image, button',
  first: 'Image, title, sentence, button',
  compact: 'Small image beside the words',
  image: 'The image is the link',
  html: 'Partner code, optional title',
  text: 'Title, sentence, button',
});
export const TYPE_LABEL = Object.freeze({ prompt: 'Prompt', post: 'Article', project: 'Project', share: 'Share' });

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const str = (v) => (typeof v === 'string' ? v : '');
export const plural = (n) => (n === 1 ? '1 page' : `${n} pages`);

/** An editable copy of a registry card. `image` describes the picture: none, the stored file, or a new upload. */
export function draftFromCta(c, { imageUrl = null } = {}) {
  return {
    id: str(c?.id), label: str(c?.label), line: str(c?.line), button: str(c?.button), destination: str(c?.destination),
    partner: str(c?.partner), note: str(c?.note), enabled: c?.enabled === true,
    layout: CTA_LAYOUTS.includes(c?.layout) ? c.layout : 'text',
    icon: c?.icon && typeof c.icon === 'object' ? structuredClone(c.icon) : null,
    html: str(c?.html), showTitle: c?.showTitle !== false,
    hosts: Array.isArray(c?.hosts) ? c.hosts.filter((h) => typeof h === 'string') : [],
    items: (Array.isArray(c?.items) ? c.items : []).filter((it) => it && typeof it === 'object').map((it) => ({ type: it.type, ref: str(it.ref) })),
    image: typeof c?.image === 'string' ? { kind: 'stored', file: c.image, url: imageUrl } : { kind: 'none' },
  };
}

/** A new card's starting draft (the design opens a new card on Image below, enabled). */
export function blankDraft() {
  return { ...draftFromCta({ enabled: true, layout: 'below' }), enabled: true };
}

/** The registry entry the draft would save, for the shared rules and the preview. */
export function cardFromDraft(d) {
  const card = { id: d.id.trim(), label: d.label.trim(), layout: d.layout, partner: d.partner.trim(), enabled: d.enabled, items: d.items };
  if (d.line.trim()) card.line = d.line.trim();
  if (d.button.trim()) card.button = d.button.trim();
  if (d.destination.trim()) card.destination = d.destination.trim();
  if (d.note.trim()) card.note = d.note.trim();
  if (d.image.kind === 'stored') card.image = d.image.file;
  else if (d.image.kind === 'upload') card.image = `${card.id || 'new-card'}.webp`;
  if (d.icon) card.icon = d.icon;
  if (d.html.trim()) card.html = d.html.trim();
  if (d.showTitle === false) card.showTitle = false;
  if (d.hosts.length) card.hosts = d.hosts;
  return card;
}

/**
 * The design's per-field messages plus the shared rules. Returns { errors: { field: message }, live: { field: true },
 * banner, ok }. `live` marks a message worth showing before the first save attempt (a link already typed wrong);
 * the rest wait for Save, as in the design. `taken` is the set of ids already in the registry (a new card only).
 */
export function validateDraft(d, { isNew = false, taken = new Set() } = {}) {
  const errors = {};
  const live = {};
  const uses = layoutUses(d.layout);
  if (isNew) {
    if (!ID_RE.test(d.id.trim()) || d.id.trim().length > CTA_LIMITS.id) errors.id = 'Use lowercase words joined by hyphens.';
    else if (taken.has(d.id.trim())) errors.id = 'Another call-to-action already uses this id.';
  }
  if (!d.label.trim()) errors.label = d.layout === 'image' ? 'A title is required. It becomes the image description.' : 'A title is required.';
  if (!/^[a-z0-9][a-z0-9-]*$/.test(d.partner.trim())) errors.partner = 'Name the partner in one lowercase word, like amazon.';
  if (uses.line && !d.line.trim()) errors.line = 'Add the sentence the card shows.';
  if (uses.button && !d.button.trim()) errors.button = 'Add the button text, naming the partner.';
  if (uses.link) {
    const dest = d.destination.trim();
    let u = null;
    try { u = new URL(dest); } catch { u = null; }
    if (!u || u.protocol !== 'https:') {
      errors.destination = 'Use a full link starting with https://.';
      if (dest) live.destination = true;
    } else if (d.partner.trim() === 'amazon') {
      const why = amazonDestinationProblem(dest);
      if (why && /tag=/.test(why)) errors.destination = 'This Amazon link has no tag=, so a purchase through it earns nothing.';
      else if (why) errors.destination = 'An Amazon link must go straight to amazon.com. A redirect, including a gbti.network/outbound/ link, loses the purchase credit.';
      if (why) live.destination = true;
    }
  }
  if (uses.image && d.image.kind === 'none') errors.image = 'This layout needs an image.';
  if (uses.html && !d.html.trim()) errors.html = 'Paste the partner code.';
  // The shared rules on the card this draft would save. A field message above already explains most refusals, so
  // only a refusal no field covers becomes the banner (an Amazon link inside the HTML block, an icon, a length).
  const problems = validateCta(cardFromDraft(d), 'card');
  const covered = (p) => Object.keys(errors).some((k) => new RegExp(`\\b${k === 'destination' ? 'destination|amazon' : k}\\b`).test(p));
  const rest = problems.filter((p) => !covered(p));
  const banner = rest.length ? rest[0].replace(/^card(\.[a-z]+(\[\d+\])?)*: /, '').replace(/^./, (ch) => ch.toUpperCase()) : '';
  return { errors, live, banner, ok: !Object.keys(errors).length && !banner };
}

const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The fields a save sends. A new card sends everything it has; an edit sends only what changed from `original`
 * (the registry card), so an untouched field is never rewritten. Returns { fields, changed } where changed lists
 * the field names (empty for an edit with nothing to save).
 */
export function savePayload(d, original, { isNew = false } = {}) {
  const card = cardFromDraft(d);
  if (isNew) {
    const fields = { ...card };
    delete fields.image;
    if (d.image.kind === 'upload') fields.imageBase64 = d.image.base64;
    return { fields, changed: Object.keys(fields) };
  }
  const o = original || {};
  const fields = { id: o.id };
  const changed = [];
  const set = (k, v) => { fields[k] = v; changed.push(k); };
  for (const k of ['label', 'line', 'button', 'destination', 'partner', 'note', 'html']) {
    if (str(card[k]) !== str(o[k]).trim()) set(k, str(card[k]));
  }
  const oLayout = CTA_LAYOUTS.includes(o.layout) ? o.layout : 'text';
  if (card.layout !== oLayout) set('layout', card.layout);
  if (!sameJson(card.icon ?? null, o.icon ?? null)) set('icon', card.icon ?? null);
  if ((o.showTitle !== false) !== (d.showTitle !== false)) set('showTitle', d.showTitle === false ? false : null);
  const oHosts = Array.isArray(o.hosts) ? o.hosts : [];
  if (!sameJson(d.hosts, oHosts)) set('hosts', d.hosts.length ? d.hosts : null);
  const oItems = (Array.isArray(o.items) ? o.items : []).map((it) => ({ type: it.type, ref: str(it.ref) }));
  if (!sameJson(d.items, oItems)) set('items', d.items);
  if ((o.enabled === true) !== (d.enabled === true)) set('enabled', d.enabled === true);
  if (d.image.kind === 'upload') set('imageBase64', d.image.base64);
  else if (d.image.kind === 'none' && typeof o.image === 'string') set('removeImage', true);
  return { fields, changed };
}

/** An outside address as the page policy takes it, or the reason it cannot be one. A trailing slash is forgiven. */
export function normalizeHost(raw) {
  const v = String(raw ?? '').trim().replace(/\/+$/, '').toLowerCase();
  if (!CTA_HOST_RE.test(v)) return { ok: false, problem: 'Enter an address like https://widgets.partner.com, with no path.' };
  return { ok: true, host: v };
}

/** The https origins the partner code loads from (src and href), not yet allowed, in first-seen order. */
export function foundHosts(html, hosts = []) {
  const found = [];
  const re = /(?:src|href)\s*=\s*["']?(https:\/\/[^/"'\s>?#]+)/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    const n = normalizeHost(m[1]);
    if (n.ok && !found.includes(n.host) && !hosts.includes(n.host)) found.push(n.host);
  }
  return found;
}

/**
 * The pages a card can be put on, from the built card list (/ctas.json `pages`: every item with a public page, in the
 * reference form the registry stores, a share as author/id). [{ type, ref, title }].
 */
export function pagesFromBuilt(built) {
  return (Array.isArray(built?.pages) ? built.pages : [])
    .filter((p) => p && TYPE_LABEL[p.type] && str(p.ref))
    .map((p) => ({ type: p.type, ref: str(p.ref), title: str(p.title) || str(p.ref) }));
}

/** Search the pages for the "Add a page" box: title or ref contains the query, not already on the card. */
export function pageCandidates(pages, query, items = [], limit = 6) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const taken = new Set(items.map((it) => `${it.type}:${it.ref}`));
  return (Array.isArray(pages) ? pages : [])
    .filter((p) => !taken.has(`${p.type}:${p.ref}`) && (p.title.toLowerCase().includes(q) || p.ref.toLowerCase().includes(q)))
    .slice(0, limit);
}

/** The line under a card in the list: its sentence, or for an HTML block what it loads from. */
export function rowSummary(c) {
  if (c?.layout === 'html') {
    const hosts = Array.isArray(c.hosts) ? c.hosts : [];
    return `Partner code${hosts.length ? `, loads from ${hosts.map((h) => h.replace(/^https:\/\//, '')).join(', ')}` : ''}`;
  }
  return str(c?.line);
}

/** The preview's note under the card. */
export function previewNote(d) {
  if (!d.enabled) return 'Disabled: this card shows on no page.';
  return d.items.length ? `Shows on ${plural(d.items.length)} once saved.` : 'Not on any page yet.';
}
