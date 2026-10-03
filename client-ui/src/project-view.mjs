// sow-441 (owner, 2026-10-03; design of record: the "Extension Project Page" canvas): the model behind the extension
// reader's PROJECT view, which follows the website's project page (src/pages/projects/[slug].astro): the project's icon
// beside the title, an action bar with the price, the platforms and the author's own buttons, a "Ready to install?"
// box, the captioned screenshots and an "About this project" card.
//
// Why a model at all: the reader used to show a project like any article, with the content index's thumbnail as a
// full-width cover. For a project that thumbnail IS the icon (src/lib/content-index.mjs THUMB_FIELDS, right for list
// rows), so a 256px icon was stretched across the column, and a page opened from a link (no index fields) showed no
// picture at all. The links, price, platforms and screenshots never reached the page. Everything here comes from the
// item's own frontmatter (read with its body) plus the index entry when there is one, so a list and a link agree.
//
// Pure and node-free: every decision is a unit test (test/project-view.test.mjs). The page-level rules (which link is
// the main button, what a members-only link may do, which hrefs are safe) are the website's own, imported from
// src/lib/project-page.mjs, so the two surfaces cannot drift apart.
import {
  normalizeGallery, hasCaptions, resolvePrimaryCta, linkLabel, isLockedLink, lockedHint, safeHref, railDate,
} from '../../src/lib/project-page.mjs';
import { resolveContentAsset } from './assets.mjs';
import { treeNodesFromJson } from './category-picker-core.mjs';

const REPOSITORY = 'repository';
const PRICING_LABELS = { free: 'Free', freemium: 'Freemium', paid: 'Paid' };

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const strings = (v) => (Array.isArray(v) ? v.map(str).filter(Boolean) : []);
const hostOf = (href) => { try { return new URL(href).hostname.replace(/^www\./, ''); } catch { return ''; } };

/**
 * The category labels for a frontmatter `categories` path (['devops', 'frameworks', 'wordpress'] -> ['DevOps',
 * 'Frameworks', 'WordPress']) from the public /taxonomy.json, the labels the content index carries as categoryLabels.
 * Only the index has them, so a page opened from a link reads them here and shows the same category as the list.
 * An unknown path, or no tree, gives none.
 */
export function categoryLabelsFrom(taxonomy, categories) {
  const keys = strings(categories);
  if (!keys.length) return [];
  const node = treeNodesFromJson(taxonomy).find((n) => n.key === keys.join('/'));
  return node ? [...node.crumbs, node.label] : [];
}

/** A frontmatter or index date: a YAML Date (an unquoted date), an ISO string, or epoch ms. Null when unusable. */
export function toDate(v) {
  const d = v instanceof Date ? v : (typeof v === 'number' || typeof v === 'string') && v !== '' ? new Date(v) : null;
  return d && !Number.isNaN(d.valueOf()) ? d : null;
}

/**
 * One button the view may draw, or null. `paid` is the viewer's effective membership (fail closed: anything but `true`
 * is not paid). A public link is live when its address is a safe http(s) one; a members-only link is live only for a
 * paying member, and an encrypted one never (nothing decrypts a link yet), so it renders locked with the website's
 * own tooltip. A public link whose address is not safe is dropped rather than drawn dead.
 */
export function linkView(link, { paid = false, repository = false } = {}) {
  if (!link || typeof link !== 'object') return null;
  const href = safeHref(link.url);
  const members = isLockedLink(link);
  const locked = members && (paid !== true || link.encrypted === true);
  if (!locked && !href) return null;
  const host = href ? hostOf(href) : '';
  // The website writes "View on GitHub" for a repository; an author's own label wins, as the approved canvas shows.
  const fallback = repository && host === 'github.com' ? 'View on GitHub' : linkLabel(link);
  const label = str(link.label) || fallback || 'Link';
  const kind = link.type === 'download' ? 'download' : host === 'github.com' ? 'github' : 'link';
  return { label, href: locked ? null : href, locked, hint: locked ? lockedHint(link) : '', kind };
}

/**
 * The whole project view. `item` is the reader's item (an index entry, or just `{ type, path }` from a link);
 * `frontmatter` is the item's raw frontmatter from the body read (null until it arrives, or when the read failed);
 * `itemPath` is the repo path the images resolve against; `paid` as above.
 */
export function projectViewModel({ item = {}, frontmatter = null, itemPath = '', paid = false } = {}) {
  const it = item && typeof item === 'object' ? item : {};
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  const path = str(itemPath) || str(it.path);
  const asset = (v) => (typeof v === 'string' && v ? resolveContentAsset(v, path) : '');

  const title = str(fm.title) || str(it.title);
  const labels = strings(it.categoryLabels);
  const eyebrow = labels.length ? labels[labels.length - 1] : '';
  const pitch = str(fm.shortDescription) || str(it.description) || str(it.excerpt);
  // The large icon, else the small one; before the frontmatter arrives (or when it cannot be read), the index's own
  // optimized copy, which for a project is that same icon.
  const icon = asset(fm.iconLarge) || asset(fm.icon) || asset(it.thumbCard) || asset(it.thumb);

  const pricing = PRICING_LABELS[str(fm.pricing)] || '';
  const platforms = strings(fm.platforms);
  const links = Array.isArray(fm.links) ? fm.links.filter((l) => l && typeof l === 'object') : [];
  const opts = { paid };
  // The source button: a public repository link first, then a members-only one (live for a paying member).
  const repoLink = links.find((l) => l.type === REPOSITORY && l.url && !isLockedLink(l)) || links.find((l) => l.type === REPOSITORY && l.url);
  const repo = linkView(repoLink, { ...opts, repository: true });
  const primary = linkView(resolvePrimaryCta(links, safeHref(fm.pricingUrl)), opts);
  const requires = str(fm.requires);
  const version = str(fm.version);

  const published = toDate(fm.publishedAt) || toDate(it.publishedAt);
  const updated = toDate(fm.updatedAt);
  const facts = [
    ['Works with', platforms.join(', ')],
    ['Price', pricing],
    ['Category', eyebrow],
    ['Version', version],
    ['Requires', requires],
    ['Published', published ? railDate(published) : ''],
    ['Updated', updated && (!published || railDate(updated) !== railDate(published)) ? railDate(updated) : ''],
  ].filter(([, v]) => v).map(([k, v]) => ({ k, v }));

  const shots = normalizeGallery(fm.gallery)
    .map((g) => ({ src: asset(typeof g.src === 'string' ? g.src : g.src?.src), caption: str(g.caption) }))
    .filter((g) => g.src);

  return {
    title,
    eyebrow,
    pitch,
    icon,
    pricing,
    platforms,
    repo,
    primary,
    hasBar: Boolean(pricing || platforms.length || repo || primary),
    install: primary || repo ? { sub: [pricing, requires].filter(Boolean).join(' · ') } : null,
    facts,
    tags: strings(fm.tags).length ? strings(fm.tags) : strings(it.tags),
    gallery: shots,
    galleryCaptions: hasCaptions(shots),
  };
}
