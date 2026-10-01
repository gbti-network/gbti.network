// sow-219 Phase 2: the from-the-author note, expressed ONCE so the WorkBench preview and the published page
// cannot drift apart the way the article layout and the markdown renderer did.
//
// The published block is rendered by src/components/blog/Comments.astro (the `{intro && ...}` branch). The
// preview renders on the CLIENT from fetched files, so it cannot run an Astro component; what it can share is
// the STRUCTURE. Every class and inline style below was read off that component, and
// test/author-note.test.mjs re-reads the component's source and fails if they diverge.
//
// Two things are deliberately NOT shared, because the preview has no server render behind it:
//   - the edit control (CommentBox) and the "edited / view history" link, which need live comment state
//   - the avatar <img>, which the published page resolves from the profile collection at build time; the
//     preview resolves the same URL from /members-index.json instead, so the picture matches even though the
//     code path does not.

/** The class + style contract of the pinned block, read off Comments.astro. */
export const AUTHOR_NOTE_BLOCK = {
  card: 'card',
  cardStyle: 'padding:24px;border-color:var(--green);background:var(--green-tint)',
  head: 'flex items-center g12',
  eyebrow: 'eyebrow',
  eyebrowStyle: 'color:var(--green-700)',
  eyebrowText: 'From the author',
  name: 'link',
  nameStyle: 'font-weight:700;display:inline-flex',
  body: 'cmt-rich',
  bodyStyle: 'margin-top:14px;color:var(--fg)',
  avatarSize: 44,
};

import { memberBlob } from '../../membership/member-blob.mjs'; // sow-428: the picture when there is no photo

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * The repo path of an item's intro comment, derived from the item's own content path. Mirrors
 * workbench-client-core.mjs introFolderFor, but works from a PATH rather than a { scope, username }, because
 * that is what the preview has in hand. Returns null for a path that is not member or house content.
 */
export function introPathFor(repoPath, slug) {
  const parts = String(repoPath ?? '').split('/').filter(Boolean);
  if (!slug || parts.length < 2) return null;
  if (parts[0] === 'house') return `house/comments/intro-${slug}.md`;
  if (parts[0] !== 'members') return null;
  return `members/${parts[1]}/comments/intro-${slug}.md`;
}

/**
 * The pinned block as an HTML string. `bodyHtml` is already-rendered markdown and is injected as-is (the
 * caller renders it through the same renderMarkdown the preview body uses); everything else is escaped here.
 */
export function buildAuthorNoteHtml({ name, href, avatarUrl, bodyHtml, seed } = {}) {
  const b = AUTHOR_NOTE_BLOCK;
  // sow-428: the author's blobatar (drawn from their folder when the caller knows it) sits under the photo, and a photo
  // that is missing or fails to load leaves it showing, as on the published page (Avatar.astro).
  const layer = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border:0';
  const avatar = `<span class="rounded-full" style="position:relative;display:inline-flex;overflow:hidden;width:${b.avatarSize}px;height:${b.avatarSize}px;flex-shrink:0;background:var(--tint)">`
    + `<img src="${esc(memberBlob(seed || name))}" alt="" aria-hidden="true" data-blob style="${layer}" />`
    + (avatarUrl ? `<img src="${esc(avatarUrl)}" alt="" width="${b.avatarSize}" height="${b.avatarSize}" onerror="this.remove()" style="${layer}" />` : '')
    + `</span>`;
  return `<article class="${b.card}" style="${b.cardStyle}">`
    + `<div class="${b.head}">`
    + `<a href="${esc(href)}" class="shrink-0">${avatar}</a>`
    + `<div><p class="${b.eyebrow}" style="${b.eyebrowStyle}">${b.eyebrowText}</p>`
    + `<a href="${esc(href)}" class="${b.name}" style="${b.nameStyle}">${esc(name)}</a></div>`
    + `</div>`
    + `<div class="${b.body}" style="${b.bodyStyle}">${bodyHtml ?? ''}</div>`
    + `</article>`;
}

/**
 * sow-434: the same pinned block as DOM NODES, for a page that may not parse markup at all (the invitation preview,
 * /claim/, whose guard allows one innerHTML and spends it on the markdown body). A twin of buildAuthorNoteHtml above,
 * attribute for attribute and in the same order, which test/claim-render.test.mjs holds it to. Two differences, both
 * because there is no markup to parse: the body is NODES the caller built from text (`bodyNodes`), and the photo drops
 * itself on a load error through a listener rather than an inline handler.
 *
 * `href` is set only when it is a same-site path or an http(s) address; anything else leaves both links without one,
 * which renders in place as plain text (the `a:not([href])` rule), exactly as a missing profile page does. There is no
 * slot for anything extra in the card: a caller that labels it (the invitation's "Suggested note") puts the label
 * outside, so the card stays the published card.
 */
export function buildAuthorNoteNodes(doc, { name, href, avatarUrl, seed, bodyNodes = [] } = {}) {
  const b = AUTHOR_NOTE_BLOCK;
  const el = (tag, attrs = {}) => {
    const n = doc.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    return n;
  };
  const link = typeof href === 'string' && (/^\/(?!\/)/.test(href) || /^https?:\/\//i.test(href)) ? href : null;
  const layer = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;display:block;border:0';
  const avatar = el('span', { class: 'rounded-full', style: `position:relative;display:inline-flex;overflow:hidden;width:${b.avatarSize}px;height:${b.avatarSize}px;flex-shrink:0;background:var(--tint)` });
  avatar.appendChild(el('img', { src: memberBlob(seed || name), alt: '', 'aria-hidden': 'true', 'data-blob': '', style: layer }));
  if (avatarUrl) {
    const photo = el('img', { src: String(avatarUrl), alt: '', width: String(b.avatarSize), height: String(b.avatarSize), style: layer });
    photo.addEventListener('error', () => photo.remove());
    avatar.appendChild(photo);
  }
  const card = el('article', { class: b.card, style: b.cardStyle });
  const head = el('div', { class: b.head });
  const avLink = el('a', link ? { href: link, class: 'shrink-0' } : { class: 'shrink-0' });
  avLink.appendChild(avatar);
  const who = el('div');
  const eyebrow = el('p', { class: b.eyebrow, style: b.eyebrowStyle });
  eyebrow.appendChild(doc.createTextNode(b.eyebrowText));
  const nameLink = el('a', link ? { href: link, class: b.name, style: b.nameStyle } : { class: b.name, style: b.nameStyle });
  nameLink.appendChild(doc.createTextNode(String(name ?? '')));
  who.appendChild(eyebrow);
  who.appendChild(nameLink);
  head.appendChild(avLink);
  head.appendChild(who);
  const body = el('div', { class: b.body, style: b.bodyStyle });
  for (const n of bodyNodes) body.appendChild(n);
  card.appendChild(head);
  card.appendChild(body);
  return card;
}

/**
 * sow-358: the placeholder the preview shows in edit mode when an item has no note yet, so a note can be
 * WRITTEN there rather than only edited.
 */
export const NOTE_PLACEHOLDER = 'Add a note for readers.';

/**
 * The source a note edit is applied against. An empty note has no source at all, and a block commit parses the
 * source range it is given: an empty string parses to zero blocks, so applyBlockEdit refuses the write (its
 * fail-safe, since a range that does not parse to exactly one block would corrupt a neighbour). The first note
 * anyone typed into the placeholder was therefore dropped in silence, and because nothing committed, nothing
 * marked the draft dirty either, so no Save button appeared. Editing against the placeholder gives the commit
 * exactly the one block the rendered card shows.
 */
export function noteEditSource(src, editing) {
  const s = String(src ?? '');
  return editing && !s.trim() ? NOTE_PLACEHOLDER : s;
}

/**
 * What a note commit stores. The placeholder is prompt text rather than content, so a commit that leaves it
 * word for word stores nothing: an untouched card must not turn into a note that says "Add a note for readers."
 * An emptied note stores the empty string, which is how a note is cleared (an ABSENT note preserves, an empty
 * one clears, and that asymmetry is the draft store's contract).
 */
export function noteAfterCommit(next) {
  const s = String(next ?? '');
  return s.trim() === NOTE_PLACEHOLDER ? '' : s;
}
