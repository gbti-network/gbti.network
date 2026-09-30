// The WorkBench preview's page script (src/pages/workbench/preview.astro): read the staged draft with the member's
// own session and inject it into the page's Doc Shell structure. The page's frontmatter says why the preview is a
// real page filled in at runtime rather than a server render.
//
// Split out of the page at the 900-line limit (owner, 2026-09-30). This module is the RENDER half: loading the
// draft, the hero, crumbs, specs, links, video, gallery, body, contents rail and the from-the-author note, and the
// visitor/member toggle. The edit-in-place layer (sow-235) is src/lib/preview-edit.ts, which initWorkbenchPreview
// runs last with the values it needs. The two halves were one closure, so what they share is now explicit:
//   - `editing` and `noteMeta` are module-scope bindings in preview-edit.ts. An ES import is a live binding, so
//     the reads here see every write there. loadNote assigns noteMeta through setNoteMeta.
//   - wireEditing and renderNoteCard are defined inside initPreviewEdit and bound to the imports below before it
//     awaits loadNote. A visitor/member click that lands before then throws, as the temporal dead zone of the
//     single script did.
//   - noteDoc and srcOf call noteAfterCommit and noteEditSource, so this module imports author-note.mjs itself
//     rather than relying on the edit layer having loaded it first. Both modules import it statically: it is on
//     the page from the start either way, and a dynamic import beside a static one only earns a build warning.
import { initToc, initCarousel, slugifyHeading } from './pd-enhance.mjs';
import {
  normalizeGallery, hasCaptions, resolveGalleryStyle, buildToc,
  repoUrl as findRepo, resolvePrimaryCta, railLinks, linkLabel, isLockedLink, resolveHeroForType, iconForUrl,
} from './project-page.mjs';
import { applyPreviewShell, shellHasToc } from './preview-shells.mjs';
import { noteEditSource, noteAfterCommit, introPathFor } from './author-note.mjs';
import {
  editing, setNoteMeta, initPreviewEdit,
  liveWireEditing as wireEditing, liveRenderNoteCard as renderNoteCard,
} from './preview-edit';

// sow-235 + the note: one commit path, two documents. `attr` differs so the note's block indices can
// never collide with the body's, and each doc owns its own source getter/setter.
export type PvDoc = {
  attr: 'blk' | 'nblk';
  ranges: Array<{ start: number; end: number } | null>;
  get: () => string;
  set: (v: string) => void;
};

export async function initWorkbenchPreview() {
  const root = document.querySelector('[data-preview-root]');
  if (!root) return;
  const base = (root as HTMLElement).dataset.signupBase || '';
  const q = new URLSearchParams(location.search);
  const slug = q.get('slug') || '';
  const type = q.get('type') || 'project';
  const $ = (s: string) => root.querySelector(s) as HTMLElement | null;
  const note = $('[data-pv-note]');
  const say = (m: string) => { if (note) note.textContent = m; };
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

  // sow-315: the ref logic is SHARED with client-ui/src/assets.mjs rather than re-derived here. This page
  // already hand-duplicates resolveContentAsset below and the two copies have drifted; a second private
  // copy of the branch-versus-commit rule is the one thing that must not drift, because a short sha
  // silently keeps the mutable cache and nothing downstream would notice.
  const { cdnBase, setContentRef, attachCdnFallback } = await import('../../client-ui/src/assets.mjs');

  // sow-315: the CDN base is resolved LATE, because it depends on a content commit this page has not
  // fetched yet. `main` is the honest default and is exactly the pre-sow-315 behaviour.
  //
  // Why it matters: jsDelivr caches a BRANCH url for twelve hours at the edge and SEVEN DAYS in the
  // viewer's browser, so replacing an image at the same path leaves a reviewer looking at the old
  // picture for a week and no purge API can reach a browser cache. A full 40-hex COMMIT url is
  // immutable, so a new commit is simply a new url. pinnedRef refuses a short sha, which jsDelivr would
  // resolve as a branch and silently keep the mutable policy.
  let CDN = cdnBase();
  // An image the author has uploaded but not yet published is not on main, so jsDelivr 404s it and the
  // preview shows a broken image. Its bytes are in the Worker's staged store; this map is filled from
  // there once the draft is loaded (see loadStagedImages below) and consulted FIRST.
  const stagedSrc: Record<string, string> = {};
  // Mirrors resolveContentAsset (client-ui/src/assets.mjs): a repo-relative path resolves against the
  // item's folder over jsDelivr, because a draft's images may not be on the site yet.
  const asset = (v: string, itemPath: string) => {
    if (!v) return '';
    if (stagedSrc[v]) return stagedSrc[v];
    if (/^https?:\/\//.test(v) || /^\/\//.test(v)) return v.replace(/^\/\//, 'https://');
    const folder = String(itemPath || '').replace(/\/[^/]*$/, '').replace(/^\/+/, '');
    if (folder) return `${CDN}/${folder}/${v.replace(/^\.?\/+/, '')}`;
    return '';
  };

  if (!slug) { say('No draft named. Open Preview from the editor.'); return; }
  const store = q.get('store') || '';
  const repoPath = q.get('path') || '';

  // sow-315: the content commit the CI draft index was built from. Awaited before any render, because
  // every image below resolves through `asset()` and a late ref would paint the branch url first.
  // Fail-soft in both directions: an error, a missing field or a short sha all leave `main` in place.
  //
  // Then install the fallback for the one window that a pin makes WORSE rather than better. The
  // authoring loop is commit, then open the preview; until the index job finishes (about a minute) this
  // ref is the PREVIOUS content commit, where a just-added image does not exist. Without the retry a
  // pin would turn a stale image into a broken one.
  let contentSha: string | null = null;
  try {
    const rr = await fetch(`${base}/membership/repo-drafts`, { credentials: 'include' });
    if (rr.ok) contentSha = (await rr.json())?.sha ?? null;
  } catch { /* no pin; `main` still renders, just cacheably */ }
  setContentRef(contentSha);
  CDN = cdnBase();
  attachCdnFallback(document);
  // sow-194: read the non-HttpOnly gbti_csrf cookie for the double-submit header on the decrypt POST (mirrors
  // workbench-client.ts readCsrf); the httpOnly session rides on `credentials: 'include'`.
  const readCsrf = () => {
    for (const part of document.cookie.split(';')) {
      const eq = part.indexOf('=');
      if (eq >= 0 && part.slice(0, eq).trim() === 'gbti_csrf') return part.slice(eq + 1).trim() || null;
    }
    return null;
  };
  let draft: any = null;
  // sow-268 followup: a Save draft ALWAYS writes the KV draft store (workbench-client saveDraft), even for
  // an item opened as a committed repo draft, and mergeRepoDrafts then treats that KV copy as the newer
  // editable state. So Preview must prefer a matching KV draft over the committed main file for BOTH
  // stores; otherwise a saved edit (a removed banner, a changed title) never shows here and the preview
  // reads as broken -- the author saves, previews, and sees the OLD committed page. Check KV first; only
  // fall back to reading the committed file at main when there is no pending KV draft (the sow-194 fast
  // path for a pristine repo draft, which creates no shadow).
  let fromKv = false;
  try {
    const res = await fetch(`${base}/membership/drafts`, { credentials: 'include' });
    if (res.status === 401 || res.status === 403) { say('Sign in to preview your staged drafts.'); return; }
    const data = res.ok ? await res.json() : null;
    const kv = (Array.isArray(data?.drafts) ? data.drafts : []).find((d: any) => d?.slug === slug && (!type || d?.type === type));
    if (kv) { draft = kv; fromKv = true; }
  } catch { /* fall through: try the committed file next */ }

  if (!draft && store === 'repo' && repoPath) {
    // sow-194: a committed repo draft with no pending KV edit. Read its canonical file directly and parse
    // it; for a members body, decrypt the sibling .enc via the Worker so the MEMBER view shows the full
    // text. Nothing is written; no KV shadow is created. GET /membership/file (reviewFileContent) requires
    // a signed-in member and accepts any members/ or house content path -- deliberately NOT own-folder-only,
    // and safe here because the repo is PUBLIC (this plaintext is world-readable on GitHub), a members body
    // is .enc ciphertext or a stub, and the plaintext only ever comes back through the PAID-gated
    // /membership/decrypt below.
    try {
      // sow-315: the same commit the images are pinned to, so the text and its pictures cannot disagree.
      // Falls back to `main` when there is no pin, which is the original behaviour.
      const res = await fetch(`${base}/membership/file?path=${encodeURIComponent(repoPath)}&ref=${encodeURIComponent(contentSha || 'main')}`, { credentials: 'include' });
      if (res.status === 401 || res.status === 403) { say('Sign in to preview this draft.'); return; }
      const data = res.ok ? await res.json() : null;
      const text = data?.text;
      if (typeof text === 'string' && text) {
        const { parseContentFile } = await import('../../client/src/content-ops.mjs');
        const parsed: any = parseContentFile(text);
        let body = parsed.body || '';
        const enc = parsed.frontmatter?.encryptedBody;
        if (enc) {
          // MEMBER-view body: read the envelope, then decrypt it (the key stays in the Worker). A non-paid
          // viewer's decrypt returns a non-2xx (never { text }), so the body stays the public stub and the
          // members gate renders -- fail closed. Both hops guard on res.ok before trusting the payload, exactly
          // as workbench-client.ts decryptEnc (via workerPost's parseJson) does.
          try {
            const encRes = await fetch(`${base}/membership/file?path=${encodeURIComponent(enc)}&ref=${encodeURIComponent(contentSha || 'main')}`, { credentials: 'include' });
            const envelopeText = encRes.ok ? (await encRes.json())?.text : null;
            if (typeof envelopeText === 'string' && envelopeText) {
              const csrf = readCsrf();
              const dec = await fetch(`${base}/membership/decrypt`, {
                method: 'POST', credentials: 'include',
                headers: { 'Content-Type': 'application/json', ...(csrf ? { 'X-GBTI-CSRF': csrf } : {}) },
                body: envelopeText,
              });
              const decText = dec.ok ? (await dec.json())?.text : null;
              if (typeof decText === 'string') body = decText;
            }
          } catch { /* not decryptable (not paid): keep the stub body */ }
        }
        draft = { type, slug, path: repoPath, frontmatter: parsed.frontmatter || {}, body };
      }
    } catch { /* fall through to not-found */ }
  }
  if (!draft) { say('That draft was not found. Save it in the editor, then preview.'); return; }

  const fm = draft.frontmatter || {};
  const itemPath = draft.path || '';
  // Awaited, not fired off: every render below resolves its images through asset(), so the staged bytes
  // have to be in hand before the first paint or the preview shows the broken CDN URL and never repaints.
  // A miss is normal (published and merged, so the CDN has the real file) and simply leaves asset() alone.
  try {
    const { loadStagedImages, referencedDraftImages } = await import('./staged-images.mjs');
    Object.assign(stagedSrc, await loadStagedImages(
      referencedDraftImages(fm, String(draft.body || '')),
      async (name: string) => {
        // Scoped to THIS draft: the store is keyed by `<type>:<slug>` as well as the file name, so a
        // same-named image staged for another draft can no longer answer for this preview.
        const q = `name=${encodeURIComponent(name)}&item=${encodeURIComponent(`${type}:${slug}`)}`;
        const r = await fetch(`${base}/membership/draft-image?${q}`, { credentials: 'include' });
        return r.ok ? await r.json() : null;
      },
    ));
  } catch { /* the preview still renders; unstaged images just resolve to the CDN */ }
  // A KV-sourced preview is a STAGED (saved-but-not-published) draft; a main-sourced one is the committed draft.
  const stagedPreview = fromKv || store !== 'repo';
  say(stagedPreview
    ? 'This is a preview of a staged draft. It is not published, and live counts and discussion are omitted.'
    : 'This is a preview of a committed draft. It is not published, and live counts and discussion are omitted.');
  document.title = `Preview: ${fm.title || slug}`;

  const setImg = (sel: string, val: string, alt?: string) => {
    const el = $(sel) as HTMLImageElement | null; if (!el) return;
    const url = asset(val, itemPath);
    if (url) { el.src = url; el.hidden = false; } else { el.hidden = true; }
    // sow-210: the hero <img> ships with a hardcoded empty alt. A post carries coverAlt, and the alt
    // text is one of the things an author is reviewing, so pass it through when the type has one.
    if (typeof alt === 'string') el.alt = alt;
  };
  // sow-174: the hero resolves the same way the published page does. sow-210: PER TYPE, because the three
  // authorable types keep their covers in different fields. This previously called resolveHero directly
  // with the project fields, so a post or a prompt matched none of them, fell through to the 'ink'
  // preset, and the preview never showed an article cover at all.
  const hero = resolveHeroForType(type, fm);
  const heroSection = document.querySelector('.pd-hero');
  if (heroSection) {
    if (hero.preset) heroSection.setAttribute('data-preset', hero.preset);
    else heroSection.removeAttribute('data-preset');
  }
  const grid = document.querySelector('.pd-grid');
  if (grid) grid.setAttribute('data-side', fm.sidebarPosition === 'right' ? 'right' : 'left');
  setImg('[data-pv-hero]', hero.image, hero.alt || fm.title || '');

  // The category breadcrumb, resolved once: the project eyebrow below and the article lead both want it.
  let labels: Record<string, string> = {};
  try { labels = JSON.parse((root as HTMLElement).dataset.labels || '{}'); } catch { labels = {}; }
  const cats = Array.isArray(fm.categories) ? fm.categories : [];
  const catPath = cats.map((c: string) => labels[c] || c).join(' › ');

  // Reshape the project Doc Shell into the page this type actually publishes as. Articles and prompts
  // each have their own document on the site, and rendering both through the project shell made the
  // preview lie about the page. See src/lib/preview-shells.mjs for what each branch does and why.
  applyPreviewShell(document, { type, fm, slug, cats, labels, catPath, hero, esc, asset, itemPath, skillFile: draft.skillFile, signupBase: base, ref: contentSha || '' }); // sow-425: a skill previews as a skill
  setImg('[data-pv-mark]', fm.iconLarge || fm.icon);
  setImg('[data-pv-barmark]', fm.icon);

  const title = fm.title || slug;
  const t = $('[data-pv-title]'); if (t) t.textContent = title;
  const bn = $('[data-pv-barname]'); if (bn) bn.textContent = title;
  const dsc = $('[data-pv-desc]'); if (dsc) dsc.textContent = fm.shortDescription || fm.excerpt || '';

  const eb = $('[data-pv-eyebrow]');
  if (eb) {
    // sow-174: mirror the published hero, whose crumbs are now links to /feeds/?cat=<key>. The preview's
    // whole job is matching the live page (sow-169 phase 4), so an inert string here would be a visible
    // divergence the moment a crumb gains an underline. Built with DOM nodes rather than innerHTML
    // because `labels` is author-supplied taxonomy text and this page renders unpublished content.
    eb.textContent = '';
    if (cats.length) {
      eb.classList.add('cat-crumbs');
      cats.forEach((c: string, i: number) => {
        if (i > 0) {
          const sep = document.createElement('span');
          sep.className = 'cc-sep';
          sep.setAttribute('aria-hidden', 'true');
          sep.textContent = '\u203a';
          eb.appendChild(sep);
        }
        const a = document.createElement('a');
        a.className = 'cc-crumb';
        a.href = '/feeds/?cat=' + encodeURIComponent(c);
        a.textContent = labels[c] || c;
        eb.appendChild(a);
      });
    } else {
      eb.classList.remove('cat-crumbs');
      eb.textContent = type;
    }
  }

  const cap = (s: string) => String(s).charAt(0).toUpperCase() + String(s).slice(1);
  const show = (sel: string, text: string) => {
    const el = $(sel); if (!el) return;
    if (text) { el.textContent = text; el.hidden = false; } else { el.hidden = true; }
  };
  show('[data-pv-version]', fm.version ? `v${fm.version}` : '');
  show('[data-pv-pricing]', fm.pricing ? cap(fm.pricing) : '');

  // Links: the same split the published page makes between the install bar, the GitHub button and the rail.
  const links = Array.isArray(fm.links) ? fm.links : [];
  const repo = findRepo(links);
  const primary = resolvePrimaryCta(links, fm.pricingUrl);
  const aside = railLinks(links, primary, fm.pricingUrl, fm.pricing);

  // sow-176: mirror the published page's brand icon on the install buttons (same host->sprite mapping).
  const icoSvg = (id: string | null) => (id ? `<svg viewBox="0 0 24 24" aria-hidden="true"><use href="#${id}"></use></svg>` : '');
  const ctaButtons = (asMember: boolean) => {
    const out: string[] = [];
    if (repo) out.push(`<a href="${esc(repo)}" rel="noopener" class="btn btn-ghost pd-bar-gh">${icoSvg(iconForUrl(repo))}View on GitHub</a>`);
    if (primary) {
      const locked = isLockedLink(primary) && !asMember;
      out.push(locked
        ? `<span class="btn btn-primary pd-locked-btn">${esc(linkLabel(primary))} (members)</span>`
        : `<a href="${esc(primary.url)}" rel="noopener" class="btn btn-primary">${icoSvg(iconForUrl(primary.url))}${esc(linkLabel(primary))}</a>`);
    }
    return out.join('');
  };

  // Rail: specs, tags, and the leftover links.
  const specRows: [string, string][] = [];
  if (fm.version) specRows.push(['Version', String(fm.version)]);
  if (fm.requires) specRows.push(['Requires', String(fm.requires)]);
  if (Array.isArray(fm.platforms) && fm.platforms.length) specRows.push(['Works with', fm.platforms.join(', ')]);
  // sow-305: the licence the author DECLARED. The published page also falls back to what GitHub reports for
  // the repository, which a draft preview cannot do without a build-time call, so a blank here means "not
  // declared" rather than "no licence". Plain text: the link resolution belongs to the published page.
  if (typeof fm.license === 'string' && fm.license.trim()) specRows.push(['License', fm.license.trim()]);
  specRows.push(['Status', 'staged draft']);
  const specs = $('[data-pv-specs]');
  if (specs) specs.innerHTML = specRows.map(([k, v]) => `<div class="pd-spec"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('');
  const tags = $('[data-pv-tags]');
  if (tags) tags.innerHTML = (Array.isArray(fm.tags) ? fm.tags : []).map((tg: string) => `<span class="pd-tag">${esc(tg)}</span>`).join('');
  const specBlock = $('[data-pv-specblock]'); if (specBlock) specBlock.hidden = false;

  const linkBox = $('[data-pv-links]');
  if (linkBox) {
    linkBox.innerHTML = aside.map((l: any) => isLockedLink(l)
      ? `<span class="pd-rail-link locked">${esc(linkLabel(l))} (members)</span>`
      : `<a class="pd-rail-link" href="${esc(l.url)}" rel="noopener">${esc(linkLabel(l))}</a>`).join('');
  }
  const linkBlock = $('[data-pv-linkblock]'); if (linkBlock) linkBlock.hidden = aside.length === 0;

  // Video, in the body column exactly where the published page puts it.
  const videoBox = $('[data-pv-video]');
  if (videoBox && fm.video) {
    try {
      const { embedUrl } = await import('../../client/src/video-embed.mjs');
      const src = embedUrl(String(fm.video));
      if (src) {
        videoBox.innerHTML = `<div class="aspect-video w-full overflow-hidden" style="border-radius:var(--r-lg);background:var(--ink)">`
          + `<iframe src="${esc(src)}" title="${esc(title)} demo" loading="lazy" class="h-full w-full" allowfullscreen></iframe></div>`;
        videoBox.hidden = false;
      }
    } catch { /* a preview without the embed is still a useful preview */ }
  }

  // Gallery: the same normalize + style resolution, so a draft previews in the layout it will publish in.
  const shots = normalizeGallery(fm.gallery).map((s: any) => ({ src: asset(String(s.src), itemPath), caption: s.caption }));
  const usable = shots.filter((s: any) => s.src);
  const style = resolveGalleryStyle(fm.galleryStyle, usable.length);
  const captioned = hasCaptions(usable);
  const gal = $('[data-pv-gallery]');
  if (gal && usable.length) {
    const head = `<div class="pd-gal-head"><span class="pd-rail-lab">Screenshots</span></div>`
      + `<h2 class="pd-gal-title">See ${esc(title)} in action</h2>`;
    if (style === 'grid') {
      gal.innerHTML = head + `<div class="pd-shots">` + usable.map((s: any, i: number) =>
        `<figure class="pd-shot"><img src="${esc(s.src)}" alt="${esc(s.caption || `${title} screenshot ${i + 1}`)}" />`
        + (captioned ? `<figcaption>${esc(s.caption)}</figcaption>` : '') + `</figure>`).join('') + `</div>`;
    } else {
      gal.innerHTML = head
        + `<div class="pd-carousel" data-pd-carousel data-captions='${esc(JSON.stringify(usable.map((s: any) => s.caption)))}'>`
        + `<div class="pd-stage"><div class="pd-frames" data-pd-frames>`
        + usable.map((s: any, i: number) => `<div class="pd-frame"><img src="${esc(s.src)}" alt="${esc(s.caption || `${title} screenshot ${i + 1}`)}" /></div>`).join('')
        + `</div>`
        + `<button type="button" class="pd-arrow prev" data-pd-prev aria-label="Previous screenshot" hidden>&lsaquo;</button>`
        + `<button type="button" class="pd-arrow next" data-pd-next aria-label="Next screenshot" hidden>&rsaquo;</button>`
        + `</div><div class="pd-cap-row"><span class="pd-count" data-pd-count></span>`
        + (captioned ? `<p class="pd-cap" data-pd-cap></p>` : '') + `</div>`
        + `<div class="pd-strip">` + usable.map((s: any, i: number) =>
          `<button type="button" class="pd-thumb" data-pd-go="${i}" aria-label="Screenshot ${i + 1}"><img src="${esc(s.src)}" alt="" /></button>`).join('')
        + `</div></div>`;
    }
    gal.hidden = false;
  }

  // The body. A members-only draft keeps its plain body in the private draft store, so the MEMBER view
  // shows it and the VISITOR view shows the stub the published page would serve.
  const bodyEl = $('[data-pv-body]');
  const membersOnly = fm.visibility === 'members';

  // sow-235: the body is re-rendered from source on every edit, so the source is the state and the DOM is
  // only ever a view of it. renderMarkdownWithBlocks returns the same HTML the read view uses plus each
  // block's inclusive source line range, which is what makes one block editable without rendering the
  // document in pieces. Rendering in pieces loses footnote references, since [^1] only resolves against a
  // document that also carries its definition.
  // `editing` is owned by preview-edit.ts (the Edit toggle writes it) and imported above as a live binding.
  const bodyDoc: PvDoc = { attr: 'blk', ranges: [], get: () => String(draft.body || ''), set: (v) => { draft.body = v; } };
  const noteDoc: PvDoc = { attr: 'nblk', ranges: [], get: () => String(draft.authorNote || ''), set: (v) => { draft.authorNote = noteAfterCommit(v); } };
  // sow-358: an edit is applied against what the card SHOWS. For an item with no note that is the
  // placeholder, without which the first note typed into it could not be committed at all (see
  // noteEditSource). Every read of a document's source for range maths goes through this.
  const srcOf = (doc: PvDoc) => (doc === noteDoc ? noteEditSource(doc.get(), editing) : doc.get());
  const renderFromSource = async () => {
    const { renderMarkdownWithBlocks, renderMarkdown } = await import('../../client/src/markdown.mjs');
    const src = String(draft.body || '');
    if (editing) {
      const r = renderMarkdownWithBlocks(src);
      bodyDoc.ranges = r.blocks;
      draft.__html = r.html;
    } else {
      bodyDoc.ranges = [];
      draft.__html = renderMarkdown(src);
    }
    // data-ref carries the source ref alongside the resolved src, so an image read back out of an edited block
    // (inlineHtmlToMd) keeps ./images/x.png rather than the CDN or staged URL it was shown from.
    draft.__html = String(draft.__html).replace(/src="(\.\/[^"]+)"/g, (_m: string, q: string) => `src="${asset(q, itemPath)}" data-ref="${q}"`);
  };

  try {
    const { renderMarkdown } = await import('../../client/src/markdown.mjs');
    draft.__html = renderMarkdown(String(draft.body || ''));
    // Repo-relative body images need the item folder, exactly as the editor's blocks do.
    draft.__html = String(draft.__html).replace(/src="(\.\/[^"]+)"/g, (_m: string, p: string) => `src="${asset(p, itemPath)}" data-ref="${p}"`);
  } catch { draft.__html = '<p class="muted">The body could not be rendered.</p>'; }

  const renderBody = (asMember: boolean) => {
    if (!bodyEl) return;
    if (membersOnly && !asMember) {
      bodyEl.innerHTML = `<div class="pd-teaser"><span class="pd-gate-lab">Members only</span>`
        + `<h2 class="pd-gate-title">This write-up lives inside the network</h2>`
        + `<p class="pd-gate-sub">${esc(fm.shortDescription || '')}</p>`
        + `<div class="pd-skel" aria-hidden="true"><i></i><i></i><i></i></div>`
        + `<p style="margin-top:16px"><a class="btn btn-primary" href="/membership/">Become a member</a></p></div>`;
      return;
    }
    bodyEl.innerHTML = draft.__html || '';
  };

  // Contents rail. The published page reuses the ids Astro generated at build; the client-side renderer
  // emits none, so the headings are stamped here first and then fed through the SAME buildToc rules.
  const buildRail = (asMember: boolean) => {
    const nav = $('[data-pd-toc]');
    const list = $('[data-pv-toc]');
    if (!nav || !list || !bodyEl) return;
    const taken = new Set<string>();
    const headings = Array.from(bodyEl.querySelectorAll('h2')).map((el) => {
      const text = (el.textContent || '').trim();
      const s = slugifyHeading(text, taken);
      el.id = s;
      return { depth: 2, slug: s, text };
    });
    // A type whose published page has no Contents rail must not grow one here. The headings above are
    // still stamped with ids, so in-body anchors keep working; only the rail is withheld.
    if (!shellHasToc(type)) { list.innerHTML = ''; nav.hidden = true; return; }
    const toc = buildToc(headings, {
      hasBody: !(membersOnly && !asMember),
      hasGallery: usable.length > 0,
      hasDiscussion: false, // the preview omits the discussion, so it must not be offered as an anchor
    });
    list.innerHTML = toc.map((e: any, i: number) =>
      `<a href="#${esc(e.id)}" data-pd-toc-link="${esc(e.id)}"${i === 0 ? ' class="on"' : ''}>${esc(e.label)}</a>`).join('');
    nav.hidden = toc.length === 0;
  };

  // End-of-body install panel.
  const ctaBox = $('[data-pv-cta]');
  const renderCta = (asMember: boolean) => {
    if (!ctaBox) return;
    if (!primary && !repo) { ctaBox.hidden = true; return; }
    const sub = [fm.pricing ? cap(fm.pricing) : null, fm.requires].filter(Boolean).join(' · ');
    ctaBox.className = 'pd-cta';
    ctaBox.innerHTML = `<div class="pd-cta-txt"><div class="pd-cta-title">Ready to install?</div>`
      + (sub ? `<p class="pd-cta-sub">${esc(sub)}</p>` : '') + `</div>`
      + `<div class="pd-cta-btns">${ctaButtons(asMember)}</div>`;
    ctaBox.hidden = false;
  };

  // sow-219 Phase 2 + the editable note: the from-the-author note. The published page pins it above the
  // discussion and then DROPS the author box, because the note carries the byline (ContentFooter's
  // skipAuthorBox), so the preview mirrors both halves of that.
  //
  // The source is resolved once, in priority order: the DRAFT record carries it now (so a staged edit is
  // what you see), falling back to the committed sibling comment file that reaches the repo in the same PR.
  // This is defined as a function rather than a fire-and-forget IIFE and awaited at the END of setup: it
  // calls renderNoteCard, which is declared with the editing machinery in preview-edit.ts and imported here as
  // the live binding liveRenderNoteCard, assigned just before that module awaits loadNote. An IIFE could
  // reach it before the assignment had run.
  const loadNote = async () => {
    const noteBox = $('[data-pv-note-card]');
    const foot = $('[data-pv-inert-foot]');
    if (!noteBox) return;
    try {
      const author = String(fm.author || '');
      const { authorDisplay, authorHref, authorAvatar } = await import('./authors.ts');
      let avatarUrl = '';
      try {
        const idx = await fetch('/members-index.json').then((r) => (r.ok ? r.json() : null));
        avatarUrl = (idx?.members || []).find((m: any) => m?.username === author)?.avatar || '';
      } catch { /* the author's own address below, then the blobatar, are the fallbacks */ }
      // sow-428: an author who is not in the directory still has their account-number picture, as on the page.
      if (!avatarUrl) avatarUrl = authorAvatar(author) || '';
      setNoteMeta({ name: authorDisplay(author), href: authorHref(author), avatarUrl, seed: author });

      // The draft already carries the note once it has been edited here or in the editor. Only go to the
      // committed file when it does not, so a staged edit is never masked by the older committed copy.
      if (typeof draft.authorNote !== 'string' && store === 'repo' && repoPath) {
        const notePath = introPathFor(repoPath, slug);
        if (notePath) {
          const res = await fetch(`${base}/membership/file?path=${encodeURIComponent(notePath)}&ref=${encodeURIComponent(contentSha || 'main')}`, { credentials: 'include' });
          const text = res.ok ? (await res.json())?.text : null;
          if (typeof text === 'string' && text) {
            const { parseContentFile } = await import('../../client/src/content-ops.mjs');
            const parsed: any = parseContentFile(text);
            // Match the published selection exactly: only a PUBLIC, authorNote-flagged, published comment pins.
            const nfm = parsed.frontmatter || {};
            if (nfm.authorNote === true && nfm.visibility === 'public' && (!nfm.status || nfm.status === 'published')) {
              draft.authorNote = String(parsed.body || '').trim();
            }
          }
        }
      }
      renderNoteCard();
      if (foot && noteDoc.get().trim()) foot.textContent = 'The discussion renders here on the published page. The author box is replaced by the note above.';
    } catch { /* a preview never fails on its optional trimmings */ }
  };

  let asMemberNow = false;
  let stopToc: (() => void) | undefined;
  const apply = () => {
    const actions = $('[data-pv-actions]');
    if (actions) actions.innerHTML = ctaButtons(asMemberNow);
    renderBody(asMemberNow);
    renderCta(asMemberNow);
    buildRail(asMemberNow);
    // Re-run after every injection: the toggle replaces the body, so the previous observer is watching
    // elements that have left the document. Drop it before wiring the new one.
    stopToc?.();
    stopToc = initToc(document);
    initCarousel(document);
  };
  root.querySelectorAll('[data-pv-as]').forEach((b) => b.addEventListener('click', () => {
    asMemberNow = (b as HTMLElement).dataset.pvAs === 'member';
    root.querySelectorAll('[data-pv-as]').forEach((x) => x.classList.toggle('on', x === b));
    apply();
    // apply() replaces the body's innerHTML, so every editing listener left with the old nodes. Without
    // this, switching the visitor/member view while editing silently turned editing off: the blocks still
    // looked editable (contenteditable is re-applied) but nothing committed.
    wireEditing();
  }));
  apply();

  // The edit-in-place layer (sow-235), in preview-edit.ts. It reads what was resolved above, and it binds the
  // wireEditing and renderNoteCard this half calls before it awaits loadNote.
  await initPreviewEdit({ $, bodyEl, itemPath, type, slug, fm, draft, base, asset, stagedSrc, bodyDoc, noteDoc, srcOf, renderFromSource, apply, loadNote });
}
