// <gbti-content-editor> (SOW-006 v2): the per-type authoring form. Renders the field descriptors from
// client.formFields(type), a markdown body with a live preview (client.preview), image staging
// (client.stageImage), validation (client.validateContent), and publish (client.publish). The same component
// powers the standalone CMS (in <gbti-app>) and is reused by the inline editor. All typing/gathering uses the
// pure form.mjs helpers, so the only DOM concern here is reading raw values + rendering.
//
// Split along its seams at the 900-line limit (owner, 2026-09-30), with the code moved unchanged. This file keeps the
// constructor, load(), render(), cheatData() and the constants render() reads, and it stays the one import path. The
// stylesheet is content-editor-css.mjs, the icons editor-icons.mjs and the markdown cheatsheet editor-cheatsheet.mjs.
// The other methods are four class mixins composed onto GbtiElement below: editor-fields.mjs (the rail fields and
// gather), editor-rows.mjs (the links and gallery rows), editor-media.mjs (images) and editor-actions.mjs (save,
// preview, publish, approve and the changes list). Tests read all eight files through test/lib/content-editor-source.mjs.

import { GbtiElement, define, esc } from '../base.mjs';
import { authorSelectValue } from '../workspace-core.mjs';
import { oneClickPublicView } from '../one-click-public-core.mjs'; // sow-293, sow-323
import { editorStatus, mediaSummary } from '../editor-core.mjs';
import { splitRailSections } from '../editor-rail-sections.mjs'; // sow-164: Media gets its own slot // SOW-184: pure Status-card + Media-summary helpers (design 3a)
import './gbti-doc-editor.mjs'; // SOW-062 P5: the cohesive WYSIWYG body editor (same #body.value Markdown contract)
import './gbti-discussion.mjs'; // SOW-062 P6: the shared discussion thread, embedded in the editor for published items
import './gbti-cta-assignment.mjs'; // sow-281: the read-only "which CTA does this item carry" line in the Links section
import './gbti-category-picker.mjs'; // sow-227: the Category field is picked from the tree, not typed
import { EDITOR_SURFACE } from '../tokens.mjs'; // SOW-062 P6: the solid --s-* editor palette (decoupled from glass)
import { kindSectionHtml, skillSectionsHtml, mainHeadingHtml, wireSkillEditor, SKILL_EDITOR_CSS, normalizeKind } from '../editor-skill.mjs'; // sow-109: prompt or skill
import { avatarLayers } from '../member-avatars.mjs'; // sow-428: account-number photo over a blobatar
import { PREPARED_CSS, preparedFromLoad, preparedParts, wirePrepared, imageClientFor } from '../prepared-editor.mjs'; // sow-427: prepared mode (a project for someone who is not a member yet)
import { DOC, SAVE, MERGE, GLOBE, INFO, X, CHEV, BOOK, COPY, CODE, VIDEO, CHAT, USERS, SECTION_ICON } from './editor-icons.mjs';
import { MD_CHEAT } from './editor-cheatsheet.mjs';
import { CONTENT_EDITOR_CSS } from './content-editor-css.mjs';
import { withEditorFields } from './editor-fields.mjs';
import { withEditorRows } from './editor-rows.mjs';
import { withEditorMedia } from './editor-media.mjs';
import { withEditorActions } from './editor-actions.mjs';

// SOW-062 P6: keys rendered in a DOCUMENT-CANVAS section (not the rail) for a given type, so they are excluded from
// the preserved-hidden block to avoid a duplicate [data-key]. `video` -> the project Video section.
const DOC_SECTION_KEYS = { project: new Set(['video']), prompt: new Set(['kind']) }; // sow-109: kind is the cards above the body
// SOW-062 P6 rail-2: the stat tiles (hi-fi rail footer). Discussions is live now (client.listComments count); the
// rest are wired to an optional client.itemStats() that a later backend phase provides -- until then they show a
// pending dash. Order matches the mockup.
// sow-232 (owner decision 2026-09-09): only what is REAL. Draft revisions (a hosted draft is one copy, nothing to
// count) and Referrals (no per-item attribution exists yet) are gone rather than shown as a dash that reads as
// loading. Live revisions come from client.itemStats() (commits on main touching the item); Contributions is the
// item's credited contributors (the SOW-008/009 credit model); Discussions is the live comment count.
const STAT_DEFS = [
  { key: 'discussions', label: 'Discussions' },
  { key: 'revisions', label: 'Live revisions', title: 'Commits on the main branch that touched this item' },
  { key: 'contributions', label: 'Contributions', title: 'Members credited as contributors on this item' },
];

// SOW-062 Phase 6: the rail follows the hi-fi mockup's CURATED per-type schema (gbti-editor-data.js RAILS), not the
// exhaustive formFields grouping. Each section lists the field keys to show, in order. Any formField NOT listed here
// is preserved HIDDEN (gather() still submits its existing value). status + publishedAt surface in the slug-meta.
// (Article deliberately has no Video section -- owner: the video sidebar is not needed for the article edit page.)
// SOW-014 + 2026-08-11: the content types that MAY carry a from-the-author note, which now includes a post.
// This is a LITERAL rather than an import on purpose: the two cores that own the same set
// (client/src/operations.mjs and src/lib/workbench-client-core.mjs) sit behind bundle boundaries this
// component cannot cross. test/publish-intro-comment.test.mjs reads this file's source and fails if the three
// copies disagree. A note stays OPTIONAL for a post; only a project/prompt is required to have one.
const AUTHOR_NOTE_TYPES = new Set(['post', 'project', 'prompt']);

const RAIL_SCHEMA = {
  post: [
    { title: 'Details', open: true, keys: ['visibility', 'excerpt', 'categories', 'tags'] },
    // sow-179: its own section, not folded into Details or Media, since it governs how BOTH read together.
    // "Article layout" rather than "Layout" for the section title -- the field's own label is "Layout", and
    // stacking the same word as both the section header and the field label directly below it read redundant.
    { title: 'Article layout', open: true, keys: ['layout'] },
    { title: 'Media', open: false, keys: ['coverImage', 'coverAlt'] },
  ],
  project: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'categories', 'tags'] },
    // The three values the project page prints in its rail spec block (Version, Requires, Works with). version and
    // platforms were form fields listed in no section, so they were hidden-submitted with no control to see or
    // change them, the same gap sow-174 closed for the gallery. requires was not a form field at all, so a save
    // dropped it outright.
    { title: 'Specs', open: true, keys: ['version', 'requires', 'platforms'] },
    { title: 'Layout', open: true, keys: ['sidebarPosition'] },
    { title: 'Pricing', open: true, keys: ['pricing', 'pricingUrl'] },
    { title: 'Links', open: true, keys: ['links'] },
    { title: 'Media', open: true, keys: ['icon', 'featuredImage', 'banner'] },
    // sow-174: gallery/galleryStyle existed in the schema + form-fields already but were never listed in any
    // section, so they were silently hidden-submitted with no control to see or change them. New section.
    { title: 'Gallery', open: false, keys: ['gallery', 'galleryStyle'] },
  ],
  prompt: [
    { title: 'Details', open: true, keys: ['visibility', 'shortDescription', 'targets', 'categories', 'tags'] },
    { title: 'Media', open: false, keys: ['image'] },
  ],
};

class GbtiContentEditor extends withEditorActions(withEditorMedia(withEditorRows(withEditorFields(GbtiElement)))) {
  constructor() {
    super();
    this.type = this.getAttribute('type') || 'post';
    this.fields = [];
    this.preset = null; // { input, body } when editing an existing item
  }

  /** Seed the editor from an existing item (used by the inline editor + "edit" from My Content). */
  // SOW-112: the item's pre-rename slugs, derived from canonical-URL-shaped redirectFrom entries. An inline
  // copy of aliasSlugsOf (canonical: src/lib/content-index.mjs); client-ui does not import src/lib.
  aliasSlugs() {
    const list = Array.isArray(this.preset?.input?.redirectFrom) ? this.preset.input.redirectFrom : [];
    const out = [];
    for (const e of list) {
      const m = /^\/(articles|projects|products|prompts)\/([a-z0-9][a-z0-9-]*)\/$/.exec(String(e || '').trim());
      if (m && m[2] !== this.preset?.input?.slug && !out.includes(m[2])) out.push(m[2]);
    }
    return out;
  }

  // sow-326: decline a client-broadcast re-render while there are unsaved edits. See base.mjs for why this
  // exists; the guard is deliberately no broader than _dirty, which is false at wiring time and true only on
  // real author input, so a late client still re-renders an editor nobody has touched.
  skipClientRender() { return this._dirty === true; }

  load(type, input, body, path, { staged = false, scope, store = null, authorTarget = null, authorNote = null, skillFile = null, prepared = null } = {}) {
    this.type = type || this.type;
    this._prepared = preparedFromLoad(prepared); this._prepStash = null; // sow-427: per load, like _slugVal below
    // sow-326: `authorNote` travels with the draft now. readDraft has always returned it and BOTH hops between
    // there and here dropped the field, so this.preset.authorNote was permanently undefined, the prefill below
    // always fell through to its fallback, and the owner watched a saved note vanish on every refresh. It is
    // folded into preset rather than held in its own property so one assignment per load stays the whole
    // contract, exactly as `input` and `body` are.
    this.preset = { input: input || {}, body: body || '', authorNote: typeof authorNote === 'string' ? authorNote : null, skillFile: typeof skillFile === 'string' ? skillFile : null };
    this.itemPath = path || null; // SOW-062 P6: the item's index.md path, to resolve a repo-relative cover for preview
    // SOW-145: the content scope. Explicit for a NEW house item (no path yet); inferred from a house/ path when
    // editing an existing house item. House content publishes DIRECTLY (no fork-staged house drafts in v1).
    this.itemScope = scope || (path && String(path).startsWith('house/') ? 'house' : 'member');
    this.itemStore = store; // sow-194: 'repo' when opened from a committed repo draft; Preview reads it canonically
    this.staged = Boolean(staged); // SOW-106 QA: loaded from a fork draft branch (not live until published)
    this._slugVal = null; // SOW-112 v2: the pending permalink value follows the loaded item
    // The PENDING author reassignment carried by a saved draft. Set per load, exactly like _slugVal above, so
    // a value left over from a previously-open item can never be attributed to this one.
    this._pendingAuthorTarget = authorTarget && typeof authorTarget === 'object' ? authorTarget : null;
    if (this.isConnected) this.render();
  }

  async render() {
    if (!this.client) return;
    try {
      const res = await this.client.formFields({ type: this.type });
      this.fields = res?.fields ?? [];
    } catch {
      this.fields = [];
    }
    // SOW-011: surface the membership status so a trial member sees a "membership required to publish" notice
    // up front (the publish action is still gated server-side; this is the proactive UX). 'unknown' (oracle
    // unreachable) shows no notice and does not block, matching the fail-open publish gate.
    let membership = 'unknown';
    let canStage = true; // SOW-082: Save-draft is allowed for trial+paid; 'unknown' fails OPEN like publish
    let authorFolder = ''; // SOW-062 P6: the from-the-author avatar. sow-428: the member's photo over their blobatar
    try {
      const st = await this.client.status();
      membership = st?.membership ?? 'unknown';
      // sow-323: the audience control needs the paid tier. Absent means "not a trusted author", which lands on
      // the locked states rather than unlocking the switch (see audienceControl).
      this._paidTier = st?.paidTier ?? null;
      // SOW-145: house content publishes directly (fork-staged house drafts are deferred), so Save-draft is
      // hidden in house scope; a superadmin editing a house item Publishes (which auto-merges via SOW-108).
      canStage = this.itemScope !== 'house' && (membership === 'unknown' || st?.canStageDrafts === true);
      authorFolder = String(st?.identity?.username || st?.identity?.login || '').toLowerCase();
      this._statusRole = st?.role ?? null; // sow-427: the prepared-mode toggle is offered to a superadmin on a new project
    } catch {
      membership = 'unknown';
    }
    const blocked = membership !== 'paid' && membership !== 'unknown';
    const p = this.preset?.input ?? {};
    const getValPreset = (k) => this.presetStr(p[k]);
    // sow-183: the Author-reassignment picker, EXISTING items only. Sourced from an OPTIONAL client capability
    // (client.authorTargets) that only the website adapter implements so far, and only ever succeeds for a
    // superadmin -- a plain member, or a host that has not wired the capability yet (the extension, until its
    // own sow-183 phase), simply gets no options back, and the whole Author section renders nothing. This is
    // UX gating only; the Worker independently re-verifies the caller on publish either way.
    let authorMembers = null;
    if (this.itemPath) {
      try {
        const t = await this.client.authorTargets?.();
        if (t && Array.isArray(t.members)) authorMembers = t.members;
      } catch { /* not superadmin, or unsupported on this host -- no Author section */ }
    }
    // sow-323: the audience control needs the same superadmin signal the Author section uses, and it renders in
    // a different method, so it is persisted rather than recomputed from a second, weaker role test. Note this
    // is only attempted for an EXISTING item (authorTargets needs one), which is why the audience decision also
    // accepts the paid tier: a superadmin resolves to the trusted-author tier through their role
    // (membership/tier-gate.mjs), so they keep the free switch on a brand new item too.
    this._isSuperadmin = authorMembers != null;
    // The item's own path is where it actually IS, and it is persisted with a draft; the frontmatter author is
    // not (it is not a form field, so gather() drops it on every save). Deriving from the path is what stops an
    // untouched picker from reading as "House / GBTI Network". See authorSelectValue.
    // A pending reassignment outranks both, because it IS the unpublished choice: rendering the current owner
    // over a saved pick is what made the choice look silently discarded.
    const ownerSelValue = authorSelectValue({
      itemPath: this.itemPath, author: this.presetStr(p.author), pendingTarget: this._pendingAuthorTarget,
    });
    this._ownerSelInitial = ''; // reset per render: a stale value from a previous item must not read as "unchanged"
    // SOW-062 Phase 6: header = title + slug ONLY (the description moved into the rail Details per the mockup). The
    // rail renders the per-type RAIL_SCHEMA in order; fields NOT in the schema (nor header, nor publicStub which the
    // visibility switch folds in) are preserved HIDDEN so gather() still submits their existing values.
    const headerKeys = new Set(['title', 'slug']);
    const docSecKeys = DOC_SECTION_KEYS[this.type] || new Set(); // keys rendered in a doc section, not the hidden block
    const schema = RAIL_SCHEMA[this.type] || RAIL_SCHEMA.post;
    const schemaKeys = new Set(schema.flatMap((s) => s.keys));
    const fieldByKey = new Map(this.fields.map((f) => [f.key, f]));
    // NOTE: headerKeys (title, slug) MUST stay in hiddenFields so their hidden [data-key] mirror inputs are rendered
    // -- the inline header contenteditables (data-header) mirror INTO those inputs via _bindHeader, and gather()
    // reads them. Excluding headerKeys here drops title + slug from every publish/draft-save (both are required).
    // sow-174: bannerPreset is excluded exactly like publicStub above -- it renders its own swatch row folded
    // into the banner field's own markup (see fieldHtml), never as an independent row.
    const hiddenFields = this.fields.filter((f) => !schemaKeys.has(f.key) && !docSecKeys.has(f.key) && f.key !== 'publicStub' && f.key !== 'bannerPreset');
    // sow-164: one renderer for every rail section; Media is pulled out of the stack into its own slot (top of
    // the rail wide, above the document stacked) and is always open there, whatever the schema's default.
    const renderSection = (sec, { open = sec.open, cls = '' } = {}) => {
      let inner = sec.keys.map((key) => {
        const f = fieldByKey.get(key);
        let html = f ? this.fieldHtml(f, p[key], this.fieldVisible(f, getValPreset)) : '';
        // SOW-112 QA: the permalink editor lives in the Details rail, directly above Short description.
        if (sec.title === 'Details' && key === 'shortDescription') html = this.permalinkFieldHtml() + html;
        return html;
      }).join('');
      if (!inner) return '';
      if (sec.title === 'Links') inner += `<gbti-cta-assignment type="${esc(this.type)}" ref="${esc(this.presetStr(p.slug) || '')}"></gbti-cta-assignment>`; // sow-281
      // sow-184 (design 3a): an at-a-glance hint on a section header, so a collapsed section still tells you what
      // it holds. Media only for now ("1 cover" / "2 images"); every other section carries no hint.
      const hint = sec.title === 'Media' ? mediaSummary(this.type, p) : '';
      const hintHtml = hint ? `<span class="rsec-sum">${esc(hint)}</span>` : '';
      return `<details ${open ? 'open' : ''} class="rsec${cls ? ' ' + cls : ''}"><summary><span class="st"><span class="si">${SECTION_ICON[sec.title] || DOC}</span>${esc(sec.title)}</span>${hintHtml}<span class="chev">${CHEV}</span></summary><div class="rbody">${inner}</div></details>`;
    };
    const { media: mediaSec, rest: railSecs } = splitRailSections(schema);
    const sectionsHtml = railSecs.map((sec) => renderSection(sec)).join('');
    const mediaHtml = mediaSec ? renderSection(mediaSec, { open: true, cls: 'rsec-media' }) : '';
    const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join('');
    const typePath = ({ post: 'articles', project: 'projects', product: 'projects', prompt: 'prompts' })[this.type] || this.type;
    const isPub = String(p.status || '').toLowerCase() === 'published';
    const isPrompt = this.type === 'prompt'; // sow-109: a prompt item is a prompt or a skill (the cards above the body)
    const kind = normalizeKind(p.kind);
    const statusLabel = isPub ? (p.publishedAt ? String(p.publishedAt).slice(0, 10) : 'published') : 'draft';
    // sow-184 (design 3a): the Status-card descriptor (pill label + tone + published date). `staged` wins over the
    // status field, since a staged draft carries status: published by design.
    const status = editorStatus({ staged: this.staged, status: p.status, publishedAt: p.publishedAt });
    // SOW-062 P6: the slug-meta shows when the item was last updated on LIVE (publishedAt) and LOCALLY (updatedAt,
    // stamped client-side on each save/publish). A published item edited locally shows Live older than Local.
    const fmtD = (d) => { if (!d) return ''; const t = new Date(d); return Number.isNaN(t.getTime()) ? '' : t.toISOString().slice(0, 10); };
    // SOW-106 QA: a staged draft carries status: published BY DESIGN (the "draft" is where it is kept),
    // so the meta must key off the staged flag, never the status field, or it would misread as Live.
    const liveLabel = this.staged ? 'Staged draft · not published' : isPub ? (fmtD(p.publishedAt) ? `Live ${fmtD(p.publishedAt)}` : 'Live') : 'Draft';
    const localLabel = fmtD(p.updatedAt) ? `Local ${fmtD(p.updatedAt)}` : '';
    const cheat = this.cheatData(); // SOW-062 P6: per-type markdown cheatsheet content for the modal
    // SOW-062 P6: the document-canvas sections below the body (all `.docsec`, so the md-view rule hides them).
    const slug = this.presetStr(p.slug) || '';
    const videoField = fieldByKey.get('video');
    const videoSection = (docSecKeys.has('video') && videoField) ? `
             <section class="docsec" id="secVideo">
               <div class="docsec-h">${VIDEO} Video <span class="dsub">YouTube or Vimeo, shown at the top of the project page</span></div>
               <input class="inp" data-key="video" data-kind="${esc(videoField.kind || 'text')}" type="text" value="${esc(this.presetStr(p.video) || '')}" placeholder="https://youtube.com/watch?v=…" />
             </section>` : '';
    const showAuthorNote = AUTHOR_NOTE_TYPES.has(this.type);
    const authorSection = showAuthorNote ? `
             <section class="docsec" id="secAuthorNote">
               <div class="docsec-h">${CHAT} From the author <span class="dsub">a personal note shown under the content (published in the same PR)</span></div>
               <div class="authornote"><span class="an-av">${avatarLayers(authorFolder || 'gbti')}</span>
                 <textarea class="an-text" id="authornote" placeholder="Add a personal note for readers…"></textarea></div>
             </section>` : '';
    const discussionSection = (isPub && slug && ['post', 'project', 'prompt'].includes(this.type)) ? `
             <section class="docsec" id="secDiscussion">
               <div class="docsec-h">${USERS} Discussion <span class="dsub">public and members-only comments</span></div>
               <gbti-discussion data-gbti-hide-author-notes data-gbti-target-type="${esc(this.type)}" data-gbti-target-slug="${esc(slug)}"${this.aliasSlugs().length ? ` data-gbti-target-aliases="${esc(this.aliasSlugs().join(','))}"` : ''}></gbti-discussion>
             </section>` : '';
    const docSections = videoSection + authorSection + discussionSection;
    // sow-183: the Author-reassignment rail section (superadmin-only; null authorMembers hides it entirely).
    // A plain <select>, read at publish time (doPublish) -- exactly like the Permalink field, a pending change
    // takes effect only when Publish is pressed, no separate action or dialog.
    const ownerFieldHtml = authorMembers ? (() => {
      const opt = (value, label, selected) => `<option value="${esc(value)}"${selected ? ' selected' : ''}>${esc(label)}</option>`;
      const real = [{ value: 'house', label: 'House / GBTI Network' }]
        .concat(authorMembers.map((m) => ({ value: `member:${m.username}`, label: m.username })));
      // A value that matches no option would leave the browser selecting the FIRST one, and the first one MOVES
      // the item. So an unresolvable owner gets an inert placeholder at the head of the list instead, and
      // authorTargetFor reads it as "leave the owner alone".
      const known = real.some((o) => o.value === ownerSelValue);
      this._ownerSelInitial = known ? ownerSelValue : '';
      const options = (known ? '' : opt('', 'Keep the current author', true))
        + real.map((o) => opt(o.value, o.label, known && o.value === ownerSelValue)).join('');
      // sow-293: the one-click "make public" control lives in this SAME superadmin-gated section, because
      // `authorMembers !== null` IS the superadmin signal (client.authorTargets only ever succeeds for one).
      // Reusing that signal means there is no second, weaker role test to drift from this one.
      const ocp = oneClickPublicView({
        isSuperadmin: true, // reached only when authorMembers resolved, i.e. the caller is a superadmin
        visibility: this.presetStr(this.preset?.input?.visibility),
        itemPath: this.itemPath,
      });
      const ocpHtml = ocp === 'available'
        ? `<div class="fld"><button id="makepublic" class="btn2" type="button">${GLOBE} Make this public</button>
             <div class="urlprev">Superadmin only. Opens a pull request setting visibility to public; it reaches the live site in about 2 to 3 minutes.</div></div>`
        : ocp === 'already-public'
          ? `<div class="fld"><div class="urlprev">This item is already public.</div></div>`
          : '';
      return `<details open class="rsec"><summary><span class="st"><span class="si">${USERS}</span>Author</span><span class="chev">${CHEV}</span></summary><div class="rbody"><div class="fld"><select id="ownerSelect" class="selbox">${options}</select><div class="urlprev">Superadmin only. Reassigning moves this item to the new owner's folder when you Publish; the public link stays the same.</div></div>${ocpHtml}</div></details>`;
    })() : '';
    // SOW-062 P6 rail-2: the stat tiles footer, shown for a published post/product/prompt (in the rail).
    const showStats = isPub && slug && ['post', 'project', 'prompt'].includes(this.type);
    // sow-184 (design 3a): the stat tiles now live in an "Activity" rail card (was a borderless footer), matching
    // the mockup. Same STAT_DEFS + live Discussions count + jump-to-discussion button.
    const railFootHtml = showStats ? `
             <section class="rcard rcard-activity">
               <div class="rcard-h"><span class="rcard-t">Activity</span></div>
               <div class="rcard-b">
                 <div class="rail-stats">${STAT_DEFS.map((s) => {
                   const inner = `<span class="rs-n" data-statn="${s.key}">…</span><span class="rs-l"${s.title ? ` title="${esc(s.title)}"` : ''}>${esc(s.label)}</span>`;
                   // SOW-112 QA: the Discussions tile links to the discussion section below the content.
                   return s.key === 'discussions' && discussionSection
                     ? `<button class="rstat rstat-link" id="statdiscuss" type="button" title="Jump to the discussion">${inner}</button>`
                     : `<div class="rstat">${inner}</div>`;
                 }).join('')}</div>
                 <p class="rail-foot-note">Live once published.</p>
               </div>
             </section>` : '';
    const prep = await preparedParts(this); // sow-427: the toggle, the Prepared for card and Save listing (empty for everyone else)
    this.set(
      this.css(EDITOR_SURFACE + (this.type === 'prompt' ? SKILL_EDITOR_CSS : '') + PREPARED_CSS + CONTENT_EDITOR_CSS) +
        // sow-326: the banner is a FLAG, not a comparison. This element holds no copy of the committed file
        // (it is filled from readDraft alone), so "ahead of the live edge" was an unearned directional claim,
        // and the repository had already disproved it: a staged record can be BEHIND main, which is exactly
        // what src/lib/workbench-client-core.mjs records as having let six publishes overwrite a corrected
        // date. Say only what is known. The em dash also went, per the writing conventions.
        // sow-327: the banner states that something is unpublished; the control answers WHICH. It renders for
        // every staged draft, including one that has never been published: there is nothing to compare that
        // against, and the panel says exactly that ("all N blocks of it are new") rather than listing every
        // block as an addition.
        `${this.staged
          ? `<div class="pubinfo warn" id="pubbanner">${INFO}<div class="pi-body"><span>You have unpublished changes saved in this editor. <b>Publish</b> to make them live. <button type="button" class="pi-link" id="whatchanged">See what changed</button></span><div class="chg" id="changedlist" hidden></div></div></div>`
          : `<div class="pubinfo" id="pubbanner" hidden></div>`}
         <div class="edhead">
           <span class="etype">${esc(this.type)}</span>
           <span class="edhead-sp"></span>
           <span class="savechip" id="savechip"></span>
           ${this.itemPath ? `<button class="ebtn" id="copyid" type="button" title="Copy this content's MCP ID: its repo path, which the get_content tool takes">${COPY} <span class="lbl">MCP ID</span></button><code class="mcpid" id="mcpid" title="The MCP ID. Click to copy.">${esc(this.itemPath)}</code>` : ''}
           ${isPub ? `<button class="ebtn" id="viewpub" type="button" title="Open the live public page in a new tab">${GLOBE} <span class="lbl">View Public Entry</span></button>` : ''}
           ${canStage ? `<button class="ebtn" id="draft" type="button">${SAVE} Save draft</button>` : ''}
           ${canStage ? `<button class="ebtn" id="preview" type="button" title="Save the draft, then open it in a new tab as the page it will become">${GLOBE} <span class="lbl">Preview</span></button>` : ''}
           <button class="ebtn${blocked ? '' : ' ebtn-primary'}" id="publish" type="button"${isPub && !this.staged ? ' hidden' : ''}${blocked ? ' title="Publishing requires a paid membership"' : ''}>${blocked ? 'Membership required' : `${MERGE} Publish${isPrompt ? ` <span data-publish-kind>${kind}</span>` : ''}`}</button>
           ${prep.toolbar}
         </div>
         <div class="edgrid">
           <article class="doc">
             ${blocked ? `<div class="notice">Publishing requires a paid membership. Use <b>Save draft</b> to save your work privately; publish it once you upgrade. <a href="https://gbti.network/membership/" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ''}
             <div class="doc-title" contenteditable="true" data-header="title" data-ph="Untitled">${esc(this.presetStr(p.title) || '')}</div>
             ${(() => {
               // SOW-106 QA fix: the slug IS the item identity (branch + path derive from it), so on an EXISTING
               // item it is set at creation, like the Type. Editing it here silently forked a NEW item.
               // SOW-112 QA (owner-directed): the inline permalink is a pure DISPLAY; the editor lives in the
               // Details rail (permalinkFieldHtml), above Short description.
               const slugVal = `<span class="slug-val locked">${esc(this.presetStr(p.slug) || '')}</span>`;
               const metaCls = this.staged ? ' staged' : (isPub ? ' pub' : '');
               return `<div class="doc-slug"><span class="slug-base">${esc(typePath)}/</span>${slugVal}<span class="slug-meta${metaCls}"><span class="pubdot"></span><span>${esc(liveLabel)}</span>${localLabel ? ` <span class="meta-local">· ${esc(localLabel)}</span>` : ''}</span></div>`;
             })()}
             ${isPrompt ? kindSectionHtml(kind) + skillSectionsHtml({ kind, skillFile: this.preset?.skillFile || '' }) : ''}
             <div class="doc-view-row">
               <div class="doc-view" id="docview">
                 <button type="button" class="on" data-view="visual">${DOC} Visual</button>
                 <button type="button" data-view="markdown">${CODE} Markdown</button>
               </div>
               <button class="ebtn dv-cheat" id="mdref" type="button" title="Markdown cheatsheet" hidden>${BOOK} <span class="lbl">Cheatsheet</span></button>
             </div>
             <section class="docsec" id="secMain">
               <div class="docsec-h">${DOC} ${isPrompt ? mainHeadingHtml(kind) : 'Main content'}</div>
               <gbti-doc-editor id="body"></gbti-doc-editor>
             </section>${docSections}
             <div class="docmd-wrap" id="docmdwrap" hidden>
               <div class="docmd-bar">${CODE} <span>Body as markdown</span><span class="docmd-note">Edits here update the visual editor</span></div>
               <textarea class="docmd" id="docmd" spellcheck="false" aria-label="Body as markdown"></textarea>
             </div>
             <div id="out" class="muted"></div>
             <div hidden>${hiddenHtml}</div>
           </article>
           ${mediaHtml ? `<section class="media-slot" aria-label="Media">${mediaHtml}</section>` : ''}
           <aside class="rail">
             ${prep.rail}
             <section class="rcard rcard-status">
               <div class="rcard-h"><span class="rcard-t">Status</span><span class="statpill statpill-${status.tone}"><span class="d"></span>${esc(status.label)}</span></div>
               <div class="rcard-b">
                 <div class="strow"><span class="sk">Type</span><span class="sv">${esc(this.typeLabel())}</span></div>
                 ${status.publishedLabel ? `<div class="strow"><span class="sk">Published</span><span class="sv mono">${esc(status.publishedLabel)}</span></div>` : ''}
                 <p class="rcard-note">Type is set at creation and can't be changed here.</p>
               </div>
             </section>
             ${ownerFieldHtml}
             ${sectionsHtml}
             ${railFootHtml}
           </aside>
         </div>
         <div class="mdRefModal" id="mdrefmodal">
           <div class="mr-scrim" data-mrclose></div>
           <div class="mr-panel">
             <div class="mr-head"><div><h3>Markdown cheatsheet</h3><p>How to write ${esc(cheat.label.toLowerCase())} content in markdown: the standard elements plus the GBTI-specific blocks.</p></div><button class="mm-x" type="button" data-mrclose title="Close">${X}</button></div>
             <div class="mr-scroll">
               <p class="mr-blurb">${esc(cheat.blurb)}</p>
               <div class="mr-legend"><b>GBTI blocks</b><div class="mr-leg-grid">${cheat.directives.map(([d, t]) => `<code>${esc(d)}</code><span>${esc(t)}</span>`).join('')}</div></div>
               <pre class="mr-code">${esc(cheat.body)}</pre>
             </div>
           </div>
         </div>`,
    );

    // SOW-062 5e: the Document Type is READ-ONLY (set when the item is created; gather() reads this.type, not the DOM).
    this.on('#mdref', 'click', () => this.$('#mdrefmodal')?.classList.add('show'));
    this.$$('[data-mrclose]').forEach((el) => el.addEventListener('click', () => this.$('#mdrefmodal')?.classList.remove('show')));
    if (!this._escWired) { this._escWired = true; document.addEventListener('keydown', (e) => { if (e.key === 'Escape') this.$('#mdrefmodal')?.classList.remove('show'); }); }
    if (this.itemPath) { this.on('#copyid', 'click', () => this.copyContentId()); this.on('#mcpid', 'click', () => this.copyContentId()); } // sow-164: the readout copies too
    this._wirePermalinkField(); // SOW-112: the Details-rail permalink editor
    this.on('#statdiscuss', 'click', () => this.$('#secDiscussion')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    this.on('#viewpub', 'click', () => { const u = this.publicUrl(); if (u) window.open(u, '_blank', 'noopener'); });
    this.$$('#docview [data-view]').forEach((b) => b.addEventListener('click', () => this.setDocView(b.dataset.view))); // SOW-062 P6: Visual/Markdown
    // sow-199: the Markdown view EDITS the body. Typing writes back through the block editor's own value setter
    // (the tested parseBlocks), debounced so a long document is not re-parsed per keystroke, and marks the
    // document dirty. The view projects body -> textarea only when it OPENS (setDocView), never while typing,
    // so the caret never jumps and a half-typed fence is not normalised under the cursor. Body only: the
    // frontmatter is not in this surface, so the publishedAt guard is untouched by construction.
    this.on('#docmd', 'input', () => {
      clearTimeout(this._mdTimer);
      this._mdTimer = setTimeout(() => this._applyMarkdownEdit(), 250);
    });
    this.on('#draft', 'click', () => this.doDraft());
    this.on('#preview', 'click', () => this.doPreview());
    this.on('#publish', 'click', () => this.doPublish());
    // sow-323 Phase 3: one-click public is an EDITORIAL APPROVAL now, not a publish. It calls the approval
    // route and the Worker rebuilds the item, because only the Worker holds the content key and only it can
    // restore an encrypted members-only body. The Worker re-verifies superadmin; this control is the affordance.
    this.on('#makepublic', 'click', () => this._makePublic());
    // sow-327: compare against the live file on demand. Never on render: it is a network read, and the
    // answer is only interesting when the author asks for it.
    this._changesOpen = false;
    this.on('#whatchanged', 'click', () => this._toggleChanges());
    // SOW-062 P6: the Publish button shows ONLY when there is something to publish -- the item is unpublished (it was
    // rendered visible above) OR it has local edits since load. Reset the dirty flag for the freshly-loaded content,
    // then mark dirty on any edit. The root-level input/change listeners persist (this.root is stable); the element
    // listeners re-bind each render.
    this._dirty = false;
    if (!this._dirtyRootWired) {
      this._dirtyRootWired = true;
      this.root.addEventListener('input', () => this._markDirty()); // header/slug/rail text + chips (input is composed)
      this.root.addEventListener('change', () => this._markDirty()); // selects + checkboxes
    }
    this.$('#body')?.addEventListener('block-change', () => this._markDirty()); // body block add/edit/delete/convert/drag
    // rail control mutations that do NOT fire input/change (visibility switch, toggles, chip remove, cover, links).
    // Text fields fire input (caught above); a section collapse (summary) or the cover frame toggle are not edits.
    this.$('.rail')?.addEventListener('click', (e) => { if (e.target.closest('button:not([data-frame]), [data-rm]') && !e.target.closest('summary')) this._markDirty(); });
    this._bindHeader(); // SOW-062 P6: the inline title/tagline/slug mirror to their hidden [data-key] inputs
    this._wireRail(); // SOW-062 P6: chips / toggles / visibility switch / status dots
    this._wireLinks(); // SOW-062 P6: the project links[] row editor (serializes into the hidden json input)
    this._wireGallery(); // sow-268: the project gallery[] row editor (serializes into the hidden json input)
    wirePrepared(this); // sow-427: the host class that hides Publish and the author note, the toggle, the card, Save listing
    if (this.type === 'prompt') wireSkillEditor(this); // sow-109: the Prompt or Skill cards and the Made for list
    // SOW-062 P6: prefill the from-the-author note from the existing intro-<slug> comment (existing item).
    const introSlug = AUTHOR_NOTE_TYPES.has(this.type) ? this.presetStr(this.preset?.input?.slug) : '';
    if (introSlug) {
      // The SAVED draft's note wins whenever the record carries the field. This tests the TYPE and not the
      // content on purpose: an empty string is a deliberate clear (the store's contract is that an absent
      // note PRESERVES and '' CLEARS), so it must leave the box empty rather than re-prefill from the
      // committed comment the author just emptied.
      const staged = typeof this.preset?.authorNote === 'string' ? this.preset.authorNote : null;
      const ta0 = this.$('#authornote');
      if (ta0 && !ta0.value && staged) ta0.value = staged;
      if (staged == null) {
        // sow-326: read the note out of the ITEM's folder, not the caller's. getComment defaults to the
        // caller's own folder, which is correct where a member edits their own comment and wrong here: a
        // superadmin editing another member's article got a not-found, the box stayed empty, and the note
        // read as lost on every open. The file is public content in a public repo, and the Worker's file
        // route already admits any clean members/ path for any signed-in member.
        const noteOwner = authorSelectValue({ itemPath: this.itemPath, author: this.presetStr(this.preset?.input?.author) });
        const noteAuthor = noteOwner.startsWith('member:') ? noteOwner.slice(7) : null;
        this.client?.getComment?.({ id: `intro-${introSlug}`, ...(noteAuthor ? { author: noteAuthor } : {}) }).then((c) => {
          const ta = this.$('#authornote');
          if (ta && !ta.value && c?.body) ta.value = c.body;
          // sow-327: keep the live note, so the change list can tell an edited note from an untouched one.
          if (typeof c?.body === 'string') this._liveAuthorNote = c.body;
        }).catch(() => {});
      }
    }
    // SOW-062 P6 rail-2 + sow-232: Discussions from the live comment count; Contributions from the item's credited
    // contributors (already in the loaded frontmatter, no request); Live revisions from client.itemStats(), which the
    // website (a Worker route) and the npm host implement. A tile that cannot be filled reads "n/a" with the reason
    // in its title, never a dash that looks like loading.
    if (showStats) {
      const setStat = (key, n) => { const el = this.$(`[data-statn="${key}"]`); if (el && n != null) el.textContent = String(n); };
      const failStat = (key, why) => { const el = this.$(`[data-statn="${key}"]`); if (el) { el.textContent = 'n/a'; el.title = why; } };
      const credited = this.preset?.input?.contributors;
      setStat('contributions', Array.isArray(credited) ? credited.length : 0);
      // Parity with the PUBLIC thread count: union the rename aliases, exclude author notes (pinned, not
      // replies) and legacy members rows with no encrypted body (the page excludes them too). A just-posted
      // comment still counts here before the deploy (the live echo) — deliberately ahead of the public page.
      this.client?.listComments?.({ targetType: this.type, targetSlug: slug, aliases: this.aliasSlugs() })
        .then((res) => setStat('discussions', (res?.items || []).filter((c) => !c.authorNote && (c.visibility !== 'members' || c.encryptedBody)).length))
        .catch(() => setStat('discussions', 0));
      if (typeof this.client?.itemStats === 'function') {
        this.client.itemStats({ type: this.type, slug, path: this.itemPath })
          .then((st) => { if (st && st.revisions != null) setStat('revisions', st.revisions); else failStat('revisions', 'The revision count is not available for this item'); })
          .catch((err) => failStat('revisions', err?.message ? `Could not read revisions: ${err.message}` : 'Could not read revisions'));
      } else {
        failStat('revisions', 'This host does not read revision history');
      }
    }

    // SOW-062 P3: the rich cover-image control(s) — preview + Choose/Replace/Remove (the kind:'image' field).
    this.$$('[data-cover]').forEach((c) => {
      const file = c.querySelector('[data-cover-file]');
      c.querySelector('[data-cover-pick]')?.addEventListener('click', () => file?.click());
      // sow-165: "Reuse" opens a grid of images the member's own published items already use, and sets THIS
      // field (not a body block). The picker copies the picked file into the item being edited via stageImage.
      c.querySelector('[data-cover-reuse]')?.addEventListener('click', (e) => this._openMediaPicker(e.currentTarget, { cover: c }));
      file?.addEventListener('change', (e) => this.doCoverImage(e.target.files?.[0], c));
      c.querySelector('[data-cover-clear]')?.addEventListener('click', () => this.clearCover(c));
      // SOW-062 P6: the 4:3-card / Hero frame toggle just swaps the preview aspect ratio (a preview aid).
      c.querySelectorAll('[data-frame]').forEach((fb) => fb.addEventListener('click', () => {
        c.querySelectorAll('[data-frame]').forEach((b) => b.classList.toggle('on', b === fb));
        const cf = c.querySelector('[data-coverframe]');
        if (cf) cf.className = 'coverframe ' + (fb.dataset.frame === 'hero' ? 'hero' : 'card4');
      }));
    });

    // sow-174: the banner swatch row -- mutually exclusive with the image side of the SAME [data-cover]
    // control (resolveHero() only ever uses one or the other). Picking a swatch clears any staged image;
    // doCoverImage (below) clears the swatch selection back the other way when a file is chosen.
    this.$$('[data-swatches]').forEach((row) => {
      const cover = row.closest('[data-cover]');
      const hidden = row.querySelector('[data-key="bannerPreset"]');
      row.querySelectorAll('[data-preset]').forEach((btn) => btn.addEventListener('click', () => {
        row.querySelectorAll('[data-preset]').forEach((b) => b.classList.toggle('on', b === btn));
        if (hidden) hidden.value = btn.dataset.preset;
        // sow-326: mirror the choice into the preset, for the reason given on the [data-gscards] handler.
        if (hidden?.dataset?.key && this.preset?.input) this.preset.input[hidden.dataset.key] = btn.dataset.preset;
        if (cover) this.clearCover(cover);
      }));
    });

    // sow-174: the gallery-layout cards (Auto / Grid / Carousel) -- a plain enum choice with illustrated
    // options instead of a <select>, same hidden data-key contract as every other enum field.
    this.$$('[data-gscards]').forEach((row) => {
      const hidden = row.querySelector('input[type="hidden"]');
      row.querySelectorAll('[data-gs]').forEach((btn) => btn.addEventListener('click', () => {
        row.querySelectorAll('[data-gs]').forEach((b) => b.classList.toggle('on', b === btn));
        if (hidden) hidden.value = btn.dataset.gs;
        // sow-326: write the PRESET as well as the DOM. render() rebuilds each control from this.preset, so a
        // choice that lived only in a hidden input was reverted by any re-render, which is how the owner's
        // layout kept flipping back to the stale draft's value. Belt and braces with skipClientRender above:
        // this makes a re-render idempotent for the pickers even if that guard is ever bypassed.
        const gsKey = hidden?.dataset?.key;
        if (gsKey && this.preset?.input) this.preset.input[gsKey] = btn.dataset.gs;
      }));
    });

    // SOW-062 P4: seed the block body editor from the preset body (its value setter parses Markdown -> blocks).
    const be = this.$('#body');
    // sow-165: hand the body editor the item's path BEFORE its value, so a repo-relative image block
    // (`./images/x.webp`) resolves against the item folder on its first render instead of 404-ing against
    // the page url.
    if (be && this._prepared?.id) be.client = imageClientFor(this); // sow-427: body images of a saved listing read from its store
    if (be) { be.itemPath = this.itemPath; be.item = this.itemToken; be.value = this.preset?.body ?? ''; }

    // Live-toggle conditional fields (e.g. the image-gen-only result image) as their dependency changes.
    const deps = new Set(this.fields.filter((f) => f.showIf?.field).map((f) => f.showIf.field));
    for (const dep of deps) {
      const el = this.$(`[data-key="${dep}"]`);
      if (el) { el.addEventListener('input', () => this.syncConditional()); el.addEventListener('change', () => this.syncConditional()); }
    }

    this._rehydrateStaged().catch(() => {}); // a store that cannot be reached just leaves the CDN fallback in place
  }

  // SOW-062 Phase 6: pick the cheatsheet content for the current type (post maps to the mockup's "article" key).
  cheatData() {
    const key = this.type === 'post' ? 'article' : this.type;
    return MD_CHEAT[key] || MD_CHEAT.article;
  }
}

define('gbti-content-editor', GbtiContentEditor);
export { GbtiContentEditor };
