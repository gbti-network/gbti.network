// sow-434: the invitation preview (/claim/) is the published project page section for section, built from the real
// components where it can be and from DOM twins where it cannot. These tests hold the two together at the source:
//   - the inert variants of the save, favorite and share controls render nothing live, and the default variants are
//     the pre-sow-434 markup VERBATIM (the published page is unchanged; a dist diff proved it once, the hashes keep it);
//   - every screenshot opens the lightbox, with the published page's gallery classes and hooks;
//   - the "From the author" card built from nodes is buildAuthorNoteHtml's twin, attribute for attribute;
//   - the strip, the static discussion, the note pre-fill and its live mirror are where the page needs them.
// The pure decisions are in test/claim-preview-core.test.mjs; the page-wide guards in test/claim-page-guards.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { buildAuthorNoteHtml, buildAuthorNoteNodes, AUTHOR_NOTE_BLOCK } from '../src/lib/author-note.mjs';
import { isFolder } from '../membership/member-avatar.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const sha = (s) => createHash('sha256').update(s).digest('hex');

const RENDER = 'src/lib/claim-render.ts';
const SCRIPT = 'src/lib/claim-page.ts';
const LISTING = 'src/components/claim/ClaimListing.astro';
const PAGE = 'src/pages/claim/index.astro';
const COMPONENTS = ['FavoriteButton', 'CollectionButton', 'ShareRow', 'ContentActions'].map((n) => `src/components/${n}.astro`);

/** A component's template: after the frontmatter, up to its first <style> or <script> block. */
function template(src) {
  const t = src.replace(/^---\n[\s\S]*?\n---\n/, '');
  const cut = t.search(/\n<(style|script)\b/);
  return (cut < 0 ? t : t.slice(0, cut)).trimEnd();
}

/** The end of a `{...}` expression that opens at `at`, skipping strings, template literals and their `${}`. */
function closeBrace(s, at) {
  let depth = 0;
  for (let i = at; i < s.length; i += 1) {
    const c = s[i];
    if (c === "'" || c === '"') { i = s.indexOf(c, i + 1); continue; }
    if (c === '`') {
      for (i += 1; s[i] !== '`'; i += 1) if (s[i] === '$' && s[i + 1] === '{') i = closeBrace(s, i + 1);
      continue;
    }
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return i;
  }
  throw new Error(`unbalanced expression at ${at}`);
}

/**
 * The template as it reads with `inert` fixed: every switch the components use is replaced by what it evaluates to.
 * An attribute whose value is undefined is dropped with the whitespace before it (Astro omits it); a string literal
 * becomes a quoted attribute, '' a bare one. Anything the reducer does not recognise is left as it is, so a new kind
 * of switch makes the default-output comparison fail rather than pass by accident.
 */
function reduce(src, inert) {
  const hostTag = /const Host = inert \? 'span' : '([a-z-]+)';/.exec(src)?.[1];
  let t = template(src);
  if (hostTag) t = t.replace(/<Host\b/g, `<${inert ? 'span' : hostTag}`).replace(/<\/Host>/g, `</${inert ? 'span' : hostTag}>`);
  t = t.replace(/ inert=\{inert\}/g, inert ? ' inert' : '').replace(/ && !inert && \(/g, inert ? ' && false && (' : ' && (');
  const lit = (attr, expr) => {
    const e = expr.trim();
    if (e === 'undefined') return null;
    const m = /^'([^'\\]*)'$/.exec(e);
    if (m) return m[1] === '' ? ` ${attr}` : ` ${attr}="${m[1]}"`;
    return ` ${attr}={${e}}`;
  };
  let out = '';
  let i = 0;
  const re = /(\s+)([a-z][a-z:-]*)=\{/g;
  for (let m; (m = re.exec(t)); ) {
    const open = m.index + m[0].length - 1;
    const close = closeBrace(t, open);
    const expr = t.slice(open + 1, close);
    const attr = m[2];
    let val;
    let hit = true;
    let x;
    if ((x = /^live\(([\s\S]*)\)$/.exec(expr))) val = inert ? null : lit(attr, x[1]);
    else if ((x = /^inert \? ([\s\S]*?) : ([\s\S]*)$/.exec(expr)) && !/^inert \?[\s\S]*\?/.test(expr.replace(/`[^`]*`/g, '``'))) val = lit(attr, inert ? x[1] : x[2]);
    else if (expr === 'inert || undefined') val = inert ? ` ${attr}` : null;
    else if (expr === 'off') val = inert ? ` ${attr}="true"` : null;
    else if (expr === 'offStyle') val = inert ? ` ${attr}="color:var(--fg-soft) !important;cursor:not-allowed"` : null;
    else if ((x = /^tip\('([^']*)'\)$/.exec(expr))) val = ` ${attr}="${inert ? 'Available once published' : x[1]}"`;
    else if ((x = /^name\('([^']*)'\)$/.exec(expr))) val = ` ${attr}="${inert ? `${x[1]}, available once published` : x[1]}"`;
    else hit = false;
    if (!hit) continue;
    out += t.slice(i, m.index) + (val === null ? '' : m[1] + val.slice(1));
    i = close + 1;
    re.lastIndex = close + 1;
  }
  return out + t.slice(i);
}

test('the new files stay at or under the 900-line cap', () => {
  for (const f of [RENDER, 'test/claim-render.test.mjs', 'test/claim-preview-core.test.mjs']) {
    const n = read(f).split('\n').length;
    assert.ok(n > 40, `${f} was read as nearly empty: this check is broken, not the subject`);
    assert.ok(n <= 900, `${f} is over the 900-line cap (${n})`);
  }
});

// ---- the inert controls ---------------------------------------------------------------------------------------

test('DEFAULT OUTPUT UNCHANGED: with inert off, each component template reads exactly as it did before sow-434', () => {
  // The sha256 of each template before sow-434 (origin/main at a3219c87, after the frontmatter, up to its <style> or
  // <script>). With `inert` off, every switch reduces to the attribute it replaced, so the reduced template must be
  // that text exactly. A full-site build diffed before and after showed every published page body byte-identical
  // (sow-434). If this fails, the published markup of every content page moved: prove it again, then re-pin.
  const BEFORE = {
    'src/components/FavoriteButton.astro': '674f0d66d2ea1925b84f0c1467255a1f22fdd885b0b9f8122799556dcd879139',
    'src/components/CollectionButton.astro': '54e15a7727571bbe32a2c90c80f9deed0625bc1def7a02a20223ed8317ad2bb3',
    'src/components/ShareRow.astro': '7ab2b1b879c1be57bd52d252a3288aa752c3f19b6a61682b8926c0b969da7c23',
    'src/components/ContentActions.astro': '7422861ff4de6fbac8b2e71c6e0e8c049557a912cec5b52f6e8d3b741d5e1b77',
  };
  for (const f of COMPONENTS) {
    const src = read(f);
    assert.match(template(src), /inert|live\(/, `${f}: the switches were found`);
    assert.equal(sha(reduce(src, false)), BEFORE[f], `${f}: the default markup changed`);
  }
  // Controls: the hash moves on a one-character change, and an unreduced switch is not mistaken for the original.
  const fav = read(COMPONENTS[0]);
  assert.notEqual(sha(reduce(fav, false).replace('fav-pill', 'fav-pil1')), BEFORE[COMPONENTS[0]]);
  assert.notEqual(sha(template(fav)), BEFORE[COMPONENTS[0]]);
  assert.notEqual(sha(reduce(fav.replace("data-tooltip={inert ? 'Available once published' : 'Favorite'}", "data-tooltip={inert ? 'Available once published' : 'Favourite'}"), false)), BEFORE[COMPONENTS[0]]);
  // Every component defaults to live, so a page that does not pass `inert` renders the reduced-off template.
  for (const f of COMPONENTS) assert.match(read(f), /, inert = false \} = Astro\.props;/, f);
  // No version of the markup sits inside an expression (Astro drops the whitespace between elements there).
  for (const f of COMPONENTS) assert.doesNotMatch(template(read(f)), /\{inert \? \(/, f);
});

test('inert, the controls render nothing live: plain hosts, no sign-in or data hooks, no share address, every control off', () => {
  const [fav, col, share, actions] = COMPONENTS.map((f) => reduce(read(f), true));
  // The Open in extension button sits behind `itemPath && !inert`, which is false here: it does not render.
  const rendered = actions.replace(/\{itemPath && false && \([\s\S]*?\n {2}\)\}/, '');
  assert.ok(rendered.length < actions.length, 'the extension button block was found');
  for (const [name, t] of [['favorite', fav], ['collection', col], ['share', share], ['actions', rendered]]) {
    assert.ok(t.length > 150, `${name}: the inert template was read`);
    assert.doesNotMatch(t, /<gbti-|data-signin|data-gbti-|data-copy-link|data-url|data-ext-open|live\(|=\{inert/, `${name}: a live hook`);
    // An icon from the page's own sprite (<use href="#ico-heart" />) is a drawing, not an address.
    assert.doesNotMatch(t.replace(/<use href="#[a-z-]+" ?\/>/g, ''), /\bhref=/, `${name}: an address`);
  }
  assert.match(fav, /^<span\n[\s\S]*class:list=\{\['gbti-favorite',/, 'the same classes on a plain element');
  assert.match(col, /^<span\n[\s\S]*class:list=\{\['gbti-collection',/);
  for (const [name, t] of [['favorite', fav], ['collection', col]]) {
    assert.match(t, /<button type="button" class="(fav|col)-pill" disabled aria-disabled="true" style="cursor:not-allowed" data-tooltip="Available once published"/, name);
  }
  const anchors = share.match(/<a class="share-btn"[^>]*>/g) || [];
  assert.equal(anchors.length, 5);
  for (const a of anchors) assert.match(a, /aria-disabled="true" style="color:var\(--fg-soft\) !important;cursor:not-allowed"/);
  for (const a of anchors) assert.match(a, /data-tooltip="Available once published"/);
  assert.match(share, /<button type="button" class="share-btn" aria-label="Copy link, available once published" data-tooltip="Available once published" disabled aria-disabled="true"/);
  for (const c of ['FavoriteButton', 'CollectionButton', 'ShareRow']) assert.match(actions, new RegExp(`<${c} [^>]* inert />`), c);
  assert.match(actions, /\{itemPath && false && \(/, 'no Open in extension button');
  assert.match(actions, /^<div class:list=\{\['content-actions', variant === 'rail' && 'ca-rail'\]\}>/, 'the row has no data hooks');
});

test('inert or not, the share row draws the same six icons in the same order', () => {
  const src = read('src/components/ShareRow.astro');
  const svgs = (s) => s.match(/<svg\b[\s\S]*?<\/svg>/g) || [];
  assert.equal(svgs(reduce(src, false)).length, 6);
  assert.deepEqual(svgs(reduce(src, true)), svgs(reduce(src, false)));
});

test('the claim listing renders the REAL byline and action components, the actions inert, the byline linking nowhere at build', () => {
  const src = read(LISTING);
  assert.match(src, /import ContentMeta from '\.\.\/ContentMeta\.astro';/);
  assert.match(src, /import ContentActions from '\.\.\/ContentActions\.astro';/);
  assert.match(src, /<ContentActions [^>]*\binert \/>/);
  const meta = /<ContentMeta author="([^"]+)" publishedAt=\{BUILT\} \/>/.exec(src);
  assert.ok(meta, 'ContentMeta renders with a placeholder author');
  // A placeholder that is no member folder: ContentMeta links nowhere and loads no picture until the page fills it.
  assert.equal(isFolder(meta[1].toLowerCase()), false);
});

test('the preview root carries no live control: no custom element, sign-in, data or copy hook, and no share address', () => {
  const tpl = read(LISTING).replace(/^---\n[\s\S]*?\n---\n/, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/<style[\s\S]*?<\/style>/g, '');
  assert.doesNotMatch(tpl, /<gbti-|data-signin|data-gbti-|data-copy-link|data-ext-open|<form\b/);
  assert.doesNotMatch(read(LISTING), /CommentBox|CommunityInvite|DigestSubscribe/, 'no composer, no membership pitch, no live subscribe');
  for (const f of [RENDER, SCRIPT]) {
    const code = read(f).replace(/^\s*\/\/.*$/gm, '');
    assert.doesNotMatch(code, /gbti-favorite|gbti-collection|gbti-comment|data-signin|data-gbti-|data-copy-link|share\.(x|linkedin|reddit)|intent\/tweet/, f);
  }
});

// ---- the gallery and the lightbox ------------------------------------------------------------------------------

test('every screenshot opens the lightbox: one trigger builder, carrying what Lightbox.astro reads', () => {
  const src = read(RENDER);
  const trigger = src.slice(src.indexOf('function lightboxTrigger('), src.indexOf('export function renderGallery('));
  for (const attr of [
    "d.setAttribute('data-lightbox', '');", "d.setAttribute('data-lightbox-group', 'pd-gallery');",
    "d.setAttribute('data-full', shot.src);", "d.setAttribute('data-cap', shot.caption || '');",
    "d.setAttribute('role', 'button');", 'd.tabIndex = 0;',
  ]) assert.ok(trigger.includes(attr), attr);
  const gallery = src.slice(src.indexOf('export function renderGallery('), src.indexOf('export function renderToc('));
  assert.equal((gallery.match(/lightboxTrigger\(doc,/g) || []).length, 2, 'the grid shot and the carousel frame');
  // The grid shot and the carousel frame put their image inside the trigger; only the filmstrip thumbs (buttons that
  // move the carousel, as on the published page) hold an image outside one.
  assert.match(gallery, /t\.appendChild\(image\(s, alt\(s, i\)\)\);/);
  assert.match(gallery, /f\.appendChild\(image\(s, alt\(s, i\)\)\);/);
  assert.equal((gallery.match(/\bimage\(s, /g) || []).length, 3, 'two triggers and one filmstrip thumb');
  assert.match(gallery, /initCarousel\(gal\);/, 'the carousel controls start after insertion');
  // Lightbox.astro delegates from the document, so a later node needs no bind; it reads data-full first.
  const lb = read('src/components/Lightbox.astro');
  assert.match(lb, /closest\('\[data-lightbox\], \.prose-gbti img'\)/);
  assert.match(lb, /closest\('\[data-lightbox\]\[role="button"\]'\)/);
  assert.match(lb, /if \(el\.dataset && el\.dataset\.full\) return el\.dataset\.full;/);
  assert.match(lb, /data-lightbox-group="\$\{CSS\.escape\(key\)\}"/);
  assert.match(read('src/layouts/BaseLayout.astro'), /\{!bare && <Footer \/>\}[\s\S]*<Lightbox \/>/, 'the lightbox is on every page');
});

test('DRIFT: the gallery uses exactly the published page classes and hooks', () => {
  const page = read('src/pages/projects/[slug].astro');
  const pub = page.slice(page.indexOf('<div id="pd-screenshots"'), page.indexOf('{/* sow-353'));
  assert.ok(pub.length > 1500, 'the published gallery was found');
  const pubClasses = new Set([...pub.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)));
  const pubHooks = new Set([...pub.matchAll(/\b(data-[a-z-]+)/g)].map((m) => m[1]));
  const src = read(RENDER);
  const code = src.slice(src.indexOf('function arrow('), src.indexOf('export function renderToc('));
  const listing = read(LISTING);
  const frame = listing.slice(listing.indexOf('<div id="pd-screenshots"'), listing.indexOf('</aside>'));
  const ours = new Set([
    ...[...code.matchAll(/el\(doc, '[a-z]+', '([^']*)'/g)].flatMap((m) => m[1].split(/\s+/)),
    ...[...code.matchAll(/el\(doc, '[a-z]+', `([^`]*)`/g)].flatMap((m) => m[1].replace('${dir}', 'prev next').split(/\s+/)),
    ...[...code.matchAll(/lightboxTrigger\(doc, '([^']*)'/g)].flatMap((m) => m[1].split(/\s+/)),
    ...[...frame.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1].split(/\s+/)),
  ].filter(Boolean));
  const ourHooks = new Set([...code.matchAll(/'(data-[a-z-]+)'/g)].map((m) => m[1]));
  for (const c of pubClasses) assert.ok(ours.has(c), `published class ${c} is missing from the preview gallery`);
  for (const c of ours) if (!c.startsWith('pd-toc') && c !== 'pd-rail' && !/^(pd-block|pd-specs|pd-tags|pd-rail-links)$/.test(c)) assert.ok(pubClasses.has(c), `preview class ${c} is not the published page's`);
  for (const h of pubHooks) assert.ok(ourHooks.has(h), `published hook ${h} is missing from the preview gallery`);
  for (const h of ourHooks) assert.ok(pubHooks.has(h), `preview hook ${h} is not the published page's`);
  // The arrows draw the published paths.
  for (const d of ['M15 5l-7 7 7 7', 'M9 5l7 7-7 7']) assert.ok(pub.includes(d) && code.includes(d), d);
});

test('the write-up starts at the top of the overview, as published: its first child loses its top margin', () => {
  // The published body is Prose > <Content />, so the first heading is .prose-gbti's first child and the detail
  // stylesheet zeroes its 32px top margin. Here the body renders into [data-cl-body] inside Prose, a wrapper those
  // child-combinator rules stop at, so the listing carries the same rule one level down.
  const listing = read(LISTING);
  assert.match(listing, /<Prose><div data-cl-body><\/div><\/Prose>/, 'the wrapper this rule exists for');
  assert.match(listing, /\.cl-listing \[data-cl-body\] > :first-child \{ margin-top: 0; \}/);
  const detail = read('src/styles/gbti-v3-detail.css');
  assert.match(detail, /\.pd-col \.prose-gbti > :first-child \{ margin-top: 0; \}/, 'the published rule it mirrors');
  assert.match(detail, /\.pd-col \.prose-gbti h2 \{[^}]*margin: 32px 0 12px;/, 'the margin it takes away (0,2,1, beaten by 0,3,0)');
  assert.match(read('src/components/blog/Prose.astro'), /\.prose-gbti > :first-child \{ margin-top: 0; \}/);
  assert.match(read('src/pages/projects/[slug].astro'), /<Prose>\s*<Content \/>/, 'published: no wrapper between Prose and the body');
});

test('the install bar and CTA icons take the published sizes: 14px in the bar from CSS, 16px in the CTA from attributes', () => {
  // A leftover sow-427 rule sized both at 15px, so the bar's GitHub button stood 35px tall (published 34) and the
  // sticky bar 58px (published 57, which --pd-bar still claims).
  const listing = read(LISTING);
  assert.doesNotMatch(listing, /\.pd-bar-actions \.btn svg|\.pd-cta-btns \.btn svg/, 'no override of the published icon sizes');
  assert.match(read('src/styles/gbti-v3-detail.css'), /\.pd-bar \.btn svg \{ width: 14px; height: 14px; \}/, 'the bar size comes from the published rule');
  const page = read('src/pages/projects/[slug].astro');
  const cta = page.slice(page.indexOf('<div class="pd-cta-btns">'), page.indexOf('</div>', page.indexOf('<div class="pd-cta-btns">')));
  assert.equal((cta.match(/<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">/g) || []).length, 2, 'published CTA icons are 16 by attribute');
  const src = read(SCRIPT);
  assert.match(src, /if \(size\) \{ svg\.setAttribute\('width', String\(size\)\); svg\.setAttribute\('height', String\(size\)\); \}/);
  assert.match(src, /btns\.push\(linkButton\(m\.primary, 'btn btn-primary', 16\)\);/);
  assert.match(src, /btns\.push\(linkButton\(m\.repo, 'btn btn-ghost', 16\)\);/);
  assert.match(src, /actions\.push\(linkButton\(m\.repo, 'btn btn-ghost pd-bar-gh'\)\);/, 'the bar passes no size: CSS sizes it');
  assert.match(src, /actions\.push\(linkButton\(m\.primary, 'btn btn-primary'\)\);/);
});

// ---- the author note card ----------------------------------------------------------------------------------------

/** A document stand-in that records attributes in order and serializes like the HTML string builder writes. */
function fakeDoc() {
  const VOID = new Set(['img', 'br']);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const node = (tag) => ({
    tag, attrs: [], children: [], listeners: [], parent: null,
    setAttribute(k, v) { const a = this.attrs.find((x) => x[0] === k); if (a) a[1] = String(v); else this.attrs.push([k, String(v)]); },
    appendChild(n) { n.parent = this; this.children.push(n); return n; },
    addEventListener(type, fn) { this.listeners.push([type, fn]); },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
  });
  const html = (n) => {
    if (n.tag === '#text') return esc(n.text);
    const attrs = n.attrs.map(([k, v]) => (v === '' && k.startsWith('data-') ? ` ${k}` : ` ${k}="${esc(v)}"`)).join('');
    return VOID.has(n.tag) ? `<${n.tag}${attrs}>` : `<${n.tag}${attrs}>${n.children.map(html).join('')}</${n.tag}>`;
  };
  return { createElement: node, createTextNode: (text) => ({ tag: '#text', text }), html };
}

test('DRIFT: buildAuthorNoteNodes is buildAuthorNoteHtml as nodes, attribute for attribute', () => {
  const doc = fakeDoc();
  const opts = { name: 'Ali <Khallad>', href: '/claim/profile/?code=ABC123', avatarUrl: '/avatar/bomsn', seed: 'bomsn' };
  const p = doc.createElement('p');
  p.appendChild(doc.createTextNode('Body & more'));
  const nodes = doc.html(buildAuthorNoteNodes(doc, { ...opts, bodyNodes: [p] }));
  const string = buildAuthorNoteHtml({ ...opts, bodyHtml: '<p>Body &amp; more</p>' })
    .replace(/ \/>/g, '>')
    .replace(' onerror="this.remove()"', ''); // the nodes drop a failed photo through a listener instead
  assert.equal(nodes, string);
  // Without a photo, and the blobatar drawn from the name when no seed is given.
  assert.equal(doc.html(buildAuthorNoteNodes(doc, { name: 'Sam', href: '/x/' })), buildAuthorNoteHtml({ name: 'Sam', href: '/x/', bodyHtml: '' }).replace(/ \/>/g, '>'));
  assert.ok(nodes.includes(AUTHOR_NOTE_BLOCK.eyebrowText) && nodes.includes(AUTHOR_NOTE_BLOCK.cardStyle));
});

test('the node card: the photo removes itself on error, only a site path or http(s) address links, the head is the published two', () => {
  const doc = fakeDoc();
  const card = buildAuthorNoteNodes(doc, { name: 'Sam', href: '/claim/profile/?code=ABC123', avatarUrl: 'https://x/a.png', seed: 'sam' });
  const head = card.children[0];
  const span = head.children[0].children[0];
  const photo = span.children[1];
  assert.deepEqual(photo.listeners.map(([t]) => t), ['error']);
  photo.listeners[0][1]();
  assert.equal(span.children.length, 1, 'a failed photo leaves the blobatar showing');
  for (const bad of ['javascript:alert(1)', '//evil.example/x', 'data:text/html,x', ' /x', null]) {
    const out = doc.html(buildAuthorNoteNodes(doc, { name: 'Sam', href: bad }));
    assert.doesNotMatch(out, /href=/, String(bad));
  }
  assert.match(doc.html(buildAuthorNoteNodes(doc, { name: 'Sam', href: 'https://example.com/' })), /href="https:\/\/example\.com\/"/);
  // The head row holds the avatar link and the name block, nothing else: an extra node there (the old "Suggested note"
  // pill) could not shrink and pushed the row past a phone screen. A caller's `aside` is ignored.
  const tag = doc.createElement('span');
  const withAside = buildAuthorNoteNodes(doc, { name: 'Sam', href: '/x/', aside: tag });
  assert.deepEqual(withAside.children[0].children.map((n) => n.tag), ['a', 'div']);
  assert.ok(!withAside.children[0].children.includes(tag));
  // The name is text: markup in it is never a tag.
  assert.match(doc.html(buildAuthorNoteNodes(doc, { name: '<img src=x>', href: '/x/' })), /&lt;img src=x&gt;/);
});

test('the preview card is pinned where Comments.astro pins it, with its label, its body rules and its closing row', () => {
  const listing = read(LISTING);
  const at = listing.indexOf('<section id="comments"');
  const section = listing.slice(at, listing.indexOf('</section>', at));
  assert.match(section, /^<section id="comments" class="mx-auto" style="margin-top:48px;max-width:800px">/);
  assert.ok(section.indexOf('data-cl-note') < section.indexOf('0 Comments'), 'the note sits above the count, as published');
  assert.match(section, /<h2 class="h3" style="margin-top:40px">0 Comments<\/h2>/);
  assert.match(section, /No comments yet\. Be the first\./);
  const comments = read('src/components/blog/Comments.astro');
  assert.match(comments, /<section id="comments" class:list=\{\[!wide && 'mx-auto'\]\} style=\{`margin-top:48px\$\{wide \? '' : ';max-width:800px'\}`\}>/);
  assert.match(comments, /<h2 class="h3" style=\{intro \? 'margin-top:40px' : ''\}/);
  assert.match(comments, /<div class="card" data-comments-empty style="padding:24px;background:var\(--tint-warm\);margin-top:16px;display:flex;flex-direction:column;align-items:flex-start;gap:12px">/);
  assert.match(section, /<div class="card" style="padding:24px;background:var\(--tint-warm\);margin-top:16px;display:flex;flex-direction:column;align-items:flex-start;gap:12px">/);
  // The note body rules are Comments.astro's own (they ship only on a page that renders Comments).
  const rules = [...listing.matchAll(/^\s*(\.cmt-rich[^{]*\{[^}]*\})/gm)].map((m) => m[1]);
  assert.ok(rules.length >= 3, 'the copied body rules were found');
  for (const r of rules) assert.ok(comments.includes(r), `${r} is no longer in Comments.astro`);
  // The edit row the published card closes with, empty here.
  assert.match(comments, /<div class="flex items-center g12" style="margin-top:8px">/);
  const render = read(RENDER);
  assert.match(render, /const row = el\(doc, 'div', 'flex items-center g12'\);\n\s*row\.setAttribute\('style', 'margin-top:8px'\);/);
  assert.match(render, /const tag = el\(doc, 'span', 'cl-note-tag', view\.label\);/);
  assert.match(render, /noteToNodes\(view\.text, doc\)/, 'the note is text nodes, never parsed');
});

test('the "Suggested note" label sits above the card, never in its head row, so a phone never scrolls sideways', () => {
  // In the head row the pill (flex: none, nowrap) sat beside a name that cannot wrap either: at 390px an ordinary
  // 22-character name pushed the page to 459px wide, and even a short one wrapped the eyebrow onto two lines.
  const render = read(RENDER);
  const fn = render.slice(render.indexOf('export function renderNoteCard('));
  assert.match(fn, /buildAuthorNoteNodes\(doc, \{ name: who\.name, href: profile, avatarUrl: who\.photo, seed: who\.seed, bodyNodes: body \}\);/);
  assert.doesNotMatch(fn, /\baside\b/, 'nothing is added to the card head');
  assert.match(fn, /holder\.replaceChildren\(tag, card\);/, 'the label, then the card');
  assert.doesNotMatch(read('src/lib/author-note.mjs'), /\baside\b/, 'the node builder has no slot in the head row');
  const rule = /\.cl-note-tag \{([^}]*)\}/.exec(read(LISTING))?.[1] || '';
  assert.match(rule, /display: inline-block;/, 'the rule was read');
  assert.doesNotMatch(rule, /margin-left: auto|flex: none|align-self/, 'no flex-row placement left behind');
});

test('the note box starts from the suggestion, the card mirrors it as the person types, and Publish still sends only their words', () => {
  const src = read(SCRIPT);
  assert.match(src, /if \(noteText && !noteText\.value && suggestion\) \{ noteText\.value = suggestion; syncCount\(\); \}/);
  assert.equal((src.match(/\bnoteText\.value =/g) || []).length, 1, 'the one write to the note box is the pre-fill');
  assert.match(src, /noteText\?\.addEventListener\('input', \(\) => \{ syncCount\(\); showError\(''\); showNote\(\); \}\);/);
  assert.match(src, /noteCardView\(\{ suggestion: typeof listing\.suggestedNote === 'string' \? listing\.suggestedNote : '', current: noteText \? noteText\.value : null \}\)/);
  assert.match(src, /const note = noteText\.value;/);
  assert.match(src, /body: JSON\.stringify\(\{ code, note \}\)/);
  // The dialog keeps the note required and capped as before.
  assert.match(read('src/components/claim/ClaimDialog.astro'), /data-claim-note-text rows="5" maxlength=\{NOTE_MAX\} required/);
});

test('the byline is filled with text and attributes only, so the component keeps its scoped style hooks', () => {
  const src = read(RENDER);
  const fill = src.slice(src.indexOf('export function fillByline('), src.indexOf('export function renderNoteCard('));
  assert.match(fill, /name\.textContent = who\.name;/);
  assert.match(fill, /date\.textContent = formatDate\(today\);/);
  assert.doesNotMatch(fill, /replaceWith|replaceChildren|outerHTML|\.remove\(\)/, 'no ContentMeta node is replaced');
  assert.match(src, /blob\.src = memberBlob\(who\.seed\);/);
  assert.match(read(SCRIPT), /onMemberSignal\(\(\) => \{ if \(listing && !onPanel\) showIdentity\(\); \}\);/, 'a late sign-in signal refreshes the face');
});

// ---- the strip and the chrome ------------------------------------------------------------------------------------

test('the strip under the real header says what the page is and carries the Claim button', () => {
  const page = read(PAGE);
  const strip = page.slice(page.indexOf('<div class="cl-strip"'), page.indexOf('<section class="cl-panel"'));
  assert.match(strip, /<span class="cl-tag">Invitation preview<\/span>/);
  assert.match(strip, /This listing is not published yet\./);
  assert.match(strip, /<button type="button" class="btn btn-primary cl-open" data-claim-open hidden>Claim this listing<\/button>/);
  assert.match(strip, /data-claim-strip hidden/, 'hidden until there is a listing to preview');
  assert.match(page, /\.cl-strip \{ position: sticky; top: var\(--head-h\);/, 'pinned under the site header');
  assert.match(read(LISTING), /\.pd-shell\.cl-listing \{ --pd-off: calc\(var\(--head-h\) \+ var\(--cl-strip-h, 0px\)\); \}/, 'the install bar pins under both');
  const script = read(SCRIPT);
  assert.match(script, /show\(listingEl, false\);\n\s*show\(openBtn, false\);\n\s*show\(strip, false\);/, 'a panel shows no strip');
  assert.match(script, /show\(listingEl, true\);\n\s*show\(strip, true\);/);
  assert.doesNotMatch(page, /cl-bar|cl-brand|mark-mint/, 'the custom top bar is gone');
});
