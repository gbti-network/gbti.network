// sow-434: the DOM builders that make the invitation preview (/claim/, src/pages/claim/index.astro) the published
// project page section for section: the linked crumbs, the screenshots (grid or carousel, every shot opening the
// lightbox), the contents rail, the byline and the pinned "From the author" card. src/lib/claim-page.ts calls these
// once the listing has been read; the decisions behind them (which link, which picture, which label) are in
// claim-core.mjs, where node --test covers them.
//
// THE SAME RULES AS THE PAGE SCRIPT, AND test/claim-page-guards.test.mjs READS THIS FILE TOO. No innerHTML at all:
// every node is built with createElement and every listing string goes in as text. The addresses set here are a
// fixed few, each from a checked builder: a crumb (crumbHref, the feed filtered to a taxonomy key), the example
// profile (exampleProfileHref, the one invitation code the page already validated) and an in-page contents anchor
// (an id this file stamps). Nothing here logs, and nothing touches the document head or the tab title.
//
// WHY THE SHOTS ARE DIVS. The published grid wraps each shot in a link to the full image; here the image is a data:
// URL the page fetched, and the guard pins every address the page sets. Lightbox.astro delegates from the document
// and accepts any [data-lightbox], reading data-full first, so a div carries the same behaviour without an address.
import { crumbHref, claimToc, noteToNodes } from './claim-core.mjs';
import { buildAuthorNoteNodes } from './author-note.mjs';
import { initToc, initCarousel } from './pd-enhance.mjs';
import { memberBlob } from '../../membership/member-blob.mjs';
import { formatDate } from './authors';

type Shot = { src: string; caption: string };
type Identity = { name: string; seed: string; photo: string };
type NoteView = { label: string; text: string; placeholder: string };

const SVG_NS = 'http://www.w3.org/2000/svg';
const LAYER = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border:0';

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, cls = '', text = ''): HTMLElementTagNameMap[K] {
  const n = doc.createElement(tag);
  if (cls) n.className = cls;
  if (text) n.textContent = text;
  return n;
}

/** A photo layered over a blobatar that removes itself when it fails to load, as Avatar.astro's does. */
function photoImg(doc: Document, src: string, size?: number): HTMLImageElement {
  const img = el(doc, 'img');
  img.src = src;
  img.alt = '';
  if (size) { img.width = size; img.height = size; }
  img.loading = 'lazy';
  img.decoding = 'async';
  img.setAttribute('style', LAYER);
  img.addEventListener('error', () => img.remove());
  return img;
}

/** The hero crumbs, linked as CategoryCrumbs.astro links them. With none, the eyebrow says Project. */
export function renderCrumbs(doc: Document, eb: HTMLElement, crumbs: { key: string; label: string }[]): void {
  eb.replaceChildren();
  if (!crumbs.length) { eb.classList.remove('cat-crumbs'); eb.textContent = 'Project'; return; }
  eb.classList.add('cat-crumbs');
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = el(doc, 'span', 'cc-sep', '›');
      sep.setAttribute('aria-hidden', 'true');
      eb.appendChild(sep);
    }
    const a = el(doc, 'a', 'cc-crumb', c.label);
    const href = crumbHref(c.key);
    if (href) a.setAttribute('href', href);
    eb.appendChild(a);
  });
}

/** One carousel arrow, drawn with the published page's path. */
function arrow(doc: Document, dir: 'prev' | 'next'): HTMLButtonElement {
  const b = el(doc, 'button', `pd-arrow ${dir}`);
  b.type = 'button';
  b.setAttribute(dir === 'prev' ? 'data-pd-prev' : 'data-pd-next', '');
  b.setAttribute('aria-label', dir === 'prev' ? 'Previous screenshot' : 'Next screenshot');
  b.hidden = true; // initCarousel reveals the arrows, so they never show without their behaviour
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = doc.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', dir === 'prev' ? 'M15 5l-7 7 7 7' : 'M9 5l7 7-7 7');
  for (const [k, v] of [['fill', 'none'], ['stroke', 'currentColor'], ['stroke-width', '2'], ['stroke-linecap', 'round'], ['stroke-linejoin', 'round']]) path.setAttribute(k, v);
  svg.appendChild(path);
  b.appendChild(svg);
  return b;
}

/** A lightbox trigger: the attributes Lightbox.astro reads, on an element with no address. */
function lightboxTrigger(doc: Document, cls: string, shot: Shot, label: string): HTMLDivElement {
  const d = el(doc, 'div', cls);
  d.setAttribute('data-lightbox', '');
  d.setAttribute('data-lightbox-group', 'pd-gallery');
  d.setAttribute('data-full', shot.src);
  d.setAttribute('data-cap', shot.caption || '');
  d.setAttribute('role', 'button');
  d.tabIndex = 0;
  d.setAttribute('aria-label', label);
  return d;
}

/**
 * The screenshots, in the layout the published page picks (resolveGalleryStyle, carried in the model): the captioned
 * grid or the carousel with its counter, caption and filmstrip, built from the same classes and hooks as
 * src/pages/projects/[slug].astro. The carousel's controls start through the shared initCarousel.
 */
export function renderGallery(doc: Document, gal: HTMLElement, opts: { title: string; shots: Shot[]; captioned: boolean; style: 'grid' | 'carousel' }): void {
  const { title, shots, captioned, style } = opts;
  gal.querySelectorAll(':scope > .pd-shots, :scope > .pd-carousel').forEach((n) => n.remove());
  if (!shots.length) { gal.hidden = true; return; }
  const alt = (s: Shot, i: number) => s.caption || `${title} screenshot ${i + 1}`;
  const image = (s: Shot, a: string) => { const im = el(doc, 'img'); im.src = s.src; im.alt = a; return im; };

  if (style === 'grid') {
    const grid = el(doc, 'div', 'pd-shots');
    shots.forEach((s, i) => {
      const fig = el(doc, 'figure', 'pd-shot');
      const t = lightboxTrigger(doc, '', s, `Open screenshot ${i + 1} of ${title}`);
      t.appendChild(image(s, alt(s, i)));
      fig.appendChild(t);
      if (captioned) fig.appendChild(el(doc, 'figcaption', '', s.caption));
      grid.appendChild(fig);
    });
    gal.appendChild(grid);
  } else {
    const pad = (n: number) => String(n).padStart(2, '0');
    const car = el(doc, 'div', 'pd-carousel');
    car.setAttribute('data-pd-carousel', '');
    car.setAttribute('data-captions', JSON.stringify(shots.map((s) => s.caption)));
    const stage = el(doc, 'div', 'pd-stage');
    const frames = el(doc, 'div', 'pd-frames');
    frames.setAttribute('data-pd-frames', '');
    shots.forEach((s, i) => {
      const f = lightboxTrigger(doc, 'pd-frame', s, `Enlarge ${alt(s, i)}`);
      f.appendChild(image(s, alt(s, i)));
      frames.appendChild(f);
    });
    stage.append(frames, arrow(doc, 'prev'), arrow(doc, 'next'));
    const capRow = el(doc, 'div', 'pd-cap-row');
    const count = el(doc, 'span', 'pd-count', `${pad(1)} / ${pad(shots.length)}`);
    count.setAttribute('data-pd-count', '');
    capRow.appendChild(count);
    if (captioned) {
      const cap = el(doc, 'p', 'pd-cap', shots[0].caption);
      cap.setAttribute('data-pd-cap', '');
      capRow.appendChild(cap);
    }
    const strip = el(doc, 'div', 'pd-strip');
    strip.setAttribute('data-pd-strip', '');
    shots.forEach((s, i) => {
      const b = el(doc, 'button', 'pd-thumb');
      b.type = 'button';
      b.setAttribute('data-pd-go', String(i));
      b.setAttribute('aria-current', i === 0 ? 'true' : 'false');
      b.setAttribute('aria-label', `Screenshot ${i + 1}`);
      b.appendChild(image(s, ''));
      strip.appendChild(b);
    });
    car.append(stage, capRow, strip);
    gal.appendChild(car);
    initCarousel(gal);
  }
  gal.hidden = false;
}

/**
 * The contents rail: ids stamped on the body's h2s, the published entries (Overview, the h2s, Screenshots,
 * Discussion) appended after the rail label, and the shared scroll-spy started. Fewer than three entries hide the
 * rail, exactly as the published page renders none.
 */
export function renderToc(doc: Document, nav: HTMLElement, body: HTMLElement, opts: { hasGallery: boolean }): void {
  nav.querySelectorAll('a').forEach((a) => a.remove());
  const heads = Array.from(body.querySelectorAll('h2'));
  const { ids, toc } = claimToc(heads.map((h) => h.textContent || ''), { hasGallery: opts.hasGallery });
  heads.forEach((h, i) => { h.id = ids[i]; });
  toc.forEach((t: { id: string; label: string }, i: number) => {
    const a = el(doc, 'a', i === 0 ? 'on' : '', t.label);
    a.setAttribute('href', `#${t.id}`);
    a.setAttribute('data-pd-toc-link', t.id);
    nav.appendChild(a);
  });
  nav.hidden = toc.length === 0;
  if (toc.length) initToc(doc);
}

/** The avatar layers inside an existing Avatar.astro span: the blobatar for the seed, and the photo over it. */
function fillAvatar(doc: Document, span: Element | null, who: Identity, size?: number): void {
  if (!span) return;
  const blob = span.querySelector('img[data-blob]') as HTMLImageElement | null;
  if (blob) blob.src = memberBlob(who.seed);
  span.querySelectorAll('img:not([data-blob])').forEach((n) => n.remove());
  if (who.photo) span.appendChild(photoImg(doc, who.photo, size));
}

/**
 * The byline: the real ContentMeta, rendered at build with a placeholder, filled with the recipient's name, their
 * picture, today's date and a link to the example profile. Only text and attributes change, so the component's
 * scoped style hooks stay on every node.
 */
export function fillByline(doc: Document, holder: HTMLElement, who: Identity, profile: string | null, today: Date): void {
  const av = holder.querySelector('.cm-av');
  const name = holder.querySelector('.cm-name');
  const date = holder.querySelector('.cm-date');
  if (av) {
    av.setAttribute('aria-label', who.name);
    if (profile) av.setAttribute('href', profile);
    fillAvatar(doc, av.firstElementChild, who);
  }
  if (name) {
    name.textContent = who.name;
    if (profile) name.setAttribute('href', profile);
  }
  if (date) {
    date.textContent = formatDate(today);
    date.setAttribute('datetime', today.toISOString());
  }
}

/**
 * The pinned "From the author" card, the published block's twin (buildAuthorNoteNodes), with a label above it saying
 * what it shows: the preparer's suggestion, or the person's own words as they type them in the claim dialog.
 *
 * THE LABEL SITS ON ITS OWN LINE, OUTSIDE THE CARD. In the card's head row it could not shrink (nor can the name
 * beside it), so at phone width it pushed the row past the card and the page scrolled sideways, and it wrapped the
 * "From the author" eyebrow onto two lines. Outside, the card is the published card exactly.
 */
export function renderNoteCard(doc: Document, holder: HTMLElement, who: Identity, profile: string | null, view: NoteView): void {
  const tag = el(doc, 'span', 'cl-note-tag', view.label);
  const body = view.text ? noteToNodes(view.text, doc) : [el(doc, 'p', 'cl-note-empty', view.placeholder)];
  const card = buildAuthorNoteNodes(doc, { name: who.name, href: profile, avatarUrl: who.photo, seed: who.seed, bodyNodes: body });
  // The published card closes with its edit row (Comments.astro), empty for a reader, so it adds only its margin.
  const row = el(doc, 'div', 'flex items-center g12');
  row.setAttribute('style', 'margin-top:8px');
  card.appendChild(row);
  holder.replaceChildren(tag, card);
}
