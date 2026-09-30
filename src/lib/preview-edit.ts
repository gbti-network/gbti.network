// The WorkBench preview's edit-in-place layer (sow-235): click-to-edit blocks, the shared selection toolbar,
// image paste and drop, the editable title and note, and Save. Split out of src/pages/workbench/preview.astro at
// the 900-line limit (owner, 2026-09-30). The render half is src/lib/preview-page.ts, which calls initPreviewEdit
// once the draft is on screen and hands over the values this layer reads.
//
// The state both halves share lives HERE as module-scope bindings, because an ES import is a live binding:
// preview-page.ts reads `editing` (srcOf, renderFromSource) and sees every write the Edit toggle makes. The one
// shared value the render half writes, noteMeta (in loadNote), goes through setNoteMeta, since an imported
// binding cannot be assigned from the importing module.
import type { PvDoc } from './preview-page';
import { buildAuthorNoteHtml, noteEditSource, noteAfterCommit } from './author-note.mjs';

/** Edit mode. Written only by the Edit toggle below; read here and by the render half. */
export let editing = false;
/** The note card byline (name, link, picture), resolved by loadNote in the render half. */
export let noteMeta: any = null;
export const setNoteMeta = (v: any) => { noteMeta = v; };
// The two functions the render half calls (preview-page.ts imports them as wireEditing and renderNoteCard). They
// are defined inside initPreviewEdit and bound there before it awaits loadNote, which is the first caller.
export let liveWireEditing: () => void;
export let liveRenderNoteCard: () => void;

/** What the render half hands over: everything this layer reads that initWorkbenchPreview resolved. */
export type PreviewEditContext = {
  $: (s: string) => HTMLElement | null;
  bodyEl: HTMLElement | null;
  itemPath: string;
  type: string;
  slug: string;
  fm: any;
  draft: any;
  base: string;
  asset: (v: string, itemPath: string) => string;
  stagedSrc: Record<string, string>;
  bodyDoc: PvDoc;
  noteDoc: PvDoc;
  srcOf: (doc: PvDoc) => string;
  renderFromSource: () => Promise<void>;
  apply: () => void;
  loadNote: () => Promise<void>;
};

export async function initPreviewEdit(ctx: PreviewEditContext) {
  const { $, bodyEl, itemPath, type, slug, fm, draft, base, asset, stagedSrc, bodyDoc, noteDoc, srcOf, renderFromSource, apply, loadNote } = ctx;

  // ---- sow-235: edit in place -------------------------------------------------------------------
  // Editability follows the resolved item path rather than the store it came from. The original rule here
  // was repo-only, on the grounds that a KV or fork draft would need a second write path and two stores
  // would then disagree about one draft. That reasoning no longer matches the code: the Save handler below
  // writes EVERY store through the same client.saveDraft call, so there is only ever one write path.
  // sow-235: the block reader/committer and the shared selection toolbar. Loaded once here because
  // wireEditing runs synchronously on every re-render and cannot await an import each time.
  const { readBlockDom, applyBlockEdit, isEditableBlockTag, planBlockDelete, planBlockRetype, planImageInsert, isImageBlockEl, imageBlockOf, planImageLayout, planImageCaption, planListIndent, listItemAtSelection, caretAtEndOfItem, listBlockOf, planListAttrs, planListUnwrap } = await import('../../client-ui/src/block-commit.mjs');
  const { listRunState } = await import('../../client/src/list-items.mjs'); // sow-322: what the list bar paints
  const { imagePastePlan, pastedImageName, fileToDataUrl, fitImageFile } = await import('../../client-ui/src/image-paste.mjs');
  const { createSelectionToolbar } = await import('../../client-ui/src/selection-toolbar.mjs');
  const { referencedDraftImages, stagedImageName } = await import('./staged-images.mjs');
  const { renderMarkdownWithBlocks: mdBlocks, renderMarkdown: mdPlain } = await import('../../client/src/markdown.mjs');
  const { planTitleEdit } = await import('./preview-title.mjs');

  const editCtl = $('[data-pv-editctl]') as HTMLElement | null;
  const editBtn = $('[data-pv-edit-toggle]') as HTMLButtonElement | null;
  const saveBtn = $('[data-pv-save]') as HTMLButtonElement | null;
  const editMsg = $('[data-pv-edit-msg]') as HTMLElement | null;
  // Editability follows the RESOLVED item, not how the URL happened to be written. The old test read the
  // two raw query parameters, so an item that is perfectly editable became read-only the moment Preview was
  // reached by a bookmark, browser history, or a typed address, none of which carry them. `itemPath` is the
  // path preview-page.ts already resolved and passes in: `repoPath` for a committed repo draft, and the persisted record
  // path for a KV or fork draft. Both stores save through the same client.saveDraft call below, so the
  // original repo-only restriction no longer describes what this page can actually write.
  // Fails closed: a draft with no path at all stays read-only rather than offering a Save with no target.
  const canEdit = Boolean(itemPath);
  if (editCtl && canEdit) editCtl.hidden = false;

  let dirty = false;
  const setMsg = (t: string) => { if (editMsg) editMsg.textContent = t; };
  const markDirty = () => { dirty = true; if (saveBtn) saveBtn.hidden = false; setMsg('Unsaved changes.'); };

  // Commit one edited block back into the SOURCE, then re-render the whole document. Editing the source
  // rather than the DOM is what keeps footnotes, reference numbering and every other cross-block
  // construct correct, and it is why the range matters more than the element.
  //
  // sow-235: the block is rebuilt from its OWN source (applyBlockEdit re-parses the range and replaces only
  // the text the author touched), so a range of ANY length can be committed. That is what makes a list, a
  // table, a fence and a wrapped paragraph editable: the earlier version replaced a whole range with one
  // line, which would have collapsed a list to a single bullet. It also carries through everything the
  // rendered HTML cannot express, notably a table's alignment row and a fence's language.
  // A block's CONTENT identity, and the basis for deciding whether it actually changed. Deliberately the
  // read-back rather than innerHTML: a grammar extension (Grammarly, LanguageTool) decorates the paragraph
  // it is checking with its own markup, which changes innerHTML without changing a word the author wrote.
  // Comparing innerHTML therefore reported every scanned block as edited. inlineHtmlToMd drops that
  // decoration, so both sides of the comparison see the text the author sees.
  const readKey = (el: HTMLElement) => { try { return JSON.stringify(readBlockDom(el)); } catch { return ''; } };

  // Commits are SERIALIZED, and this is load-bearing rather than tidiness. commitIn writes the source
  // synchronously but only refreshes doc.ranges after renderFromSource() resolves, so a second commit
  // entering that window splices using ranges that describe the document as it stood BEFORE the first one.
  // That leaves the original block where it was and writes the edited copy over a neighbour, which is the
  // duplicated paragraph reported on 2026-08-28 while applying a Grammarly correction. Two guards, because
  // they fail differently: `committing` closes the async window, and isConnected refuses a node that a
  // re-render has already replaced.
  let committing = false;
  const commitIn = async (doc: PvDoc, el: HTMLElement) => {
    if (committing || !el.isConnected) return;
    committing = true;
    try { await commitInner(doc, el); } finally { committing = false; }
  };
  const commitInner = async (doc: PvDoc, el: HTMLElement) => {
    const range = doc.ranges[Number(el.dataset[doc.attr])];
    if (!range) return;
    const lines = srcOf(doc).replace(/\r\n/g, '\n').split('\n');
    const before = lines.slice(range.start, range.end + 1);
    const next = applyBlockEdit(before.join('\n'), readBlockDom(el));
    // null means the edit could not be applied safely (the source range is not the shape the DOM claims);
    // committing nothing is the fail-safe, because a wrong write here destroys neighbouring content.
    if (!next || next.join('\n') === before.join('\n')) return;
    lines.splice(range.start, range.end - range.start + 1, ...next);
    doc.set(lines.join('\n'));
    markDirty();
    if (doc === noteDoc) { renderNoteCard(); wireEditing(); return; }
    await renderFromSource();
    apply();
    wireEditing();
  };
  // Remove an emptied block outright, rather than leaving the blank line an empty commit writes. Blur already
  // disposes of an empty paragraph (applyBlockEdit returns [''] and markdown collapses it), so this exists for
  // the KEYBOARD: Backspace in an empty block should do immediately, and visibly, what clicking away does
  // eventually. It shares commitIn's render path so a delete and an edit cannot diverge.
  const deleteIn = async (doc: PvDoc, el: HTMLElement) => {
    if (committing) return false; // same stale-range window as commitIn; see the note there
    const idx = Number(el.dataset[doc.attr]);
    const range = doc.ranges[idx];
    if (!range) return false;
    const next = planBlockDelete(srcOf(doc), range);
    if (!next) return false; // refused: a bad range, or this is the last content in the document
    doc.set(next.join('\n'));
    markDirty();
    if (doc === noteDoc) { renderNoteCard(); wireEditing(); return true; }
    await renderFromSource();
    apply();
    wireEditing();
    // Put the caret at the end of the preceding block, which is where the author expects it after a
    // Backspace that joined two paragraphs. Best effort: a re-render may not offer the same index back.
    const prev = idx > 0 ? (bodyEl?.querySelector(`[data-${doc.attr}="${idx - 1}"]`) as HTMLElement | null) : null;
    if (prev) {
      prev.focus();
      try {
        const r = document.createRange(); r.selectNodeContents(prev); r.collapse(false);
        const sel = document.getSelection(); sel?.removeAllRanges(); sel?.addRange(r);
      } catch { /* focus alone is enough */ }
    }
    return true;
  };

  // sow-235: splice a computed replacement over ONE block's source range, sharing commitIn's serialization
  // guard and render path so a heading retype or an image insert cannot race a text commit (the same stale-range
  // window that duplicated a paragraph on 2026-08-28). computeNext(before) returns the replacement LINES, or
  // null to abort. This is the write path for the toolbar's block-level controls, which change or add a block
  // rather than editing its text in place.
  const spliceBlock = async (doc: PvDoc, el: HTMLElement, computeNext: (before: string[]) => string[] | null) => {
    if (committing || !el.isConnected) return;
    committing = true;
    try {
      const range = doc.ranges[Number(el.dataset[doc.attr])];
      if (!range) return;
      const lines = srcOf(doc).replace(/\r\n/g, '\n').split('\n');
      const before = lines.slice(range.start, range.end + 1);
      const next = computeNext(before);
      if (!next || next.join('\n') === before.join('\n')) return;
      lines.splice(range.start, range.end - range.start + 1, ...next);
      doc.set(lines.join('\n'));
      markDirty();
      if (doc === noteDoc) { renderNoteCard(); wireEditing(); return; }
      await renderFromSource();
      apply();
      wireEditing();
    } finally { committing = false; }
  };

  // The body keeps its own name because the selection toolbar's onCommit closes over it.
  const commitBlock = (el: HTMLElement) => commitIn(bodyDoc, el);

  // Which document a stamped block belongs to, and that block's current source lines.
  const docOfEl = (el: HTMLElement): PvDoc => (el.dataset.nblk !== undefined ? noteDoc : bodyDoc);
  const sourceOf = (doc: PvDoc, el: HTMLElement) => {
    const range = doc.ranges[Number(el.dataset[doc.attr])];
    if (!range) return '';
    return srcOf(doc).replace(/\r\n/g, '\n').split('\n').slice(range.start, range.end + 1).join('\n');
  };

  // The identity-scoped client, built once and shared by Save and the image paste. currentIdentity, not
  // readMemberSignal alone: readMemberSignal reads ONLY the extension content script's data-gbti-member
  // attribute, so a member signed in with the website cookie session had no identity here and Save answered
  // "Sign in to save this draft" to someone already signed in. currentIdentity applies the cookie-wins
  // precedence, and BaseLayout has already run hydrateMemberSignal by click time. Same pairing the rest of
  // the site uses (see account.astro). Null when nobody is signed in; the next call asks again.
  let clientP: Promise<any> | null = null;
  const getClient = (): Promise<any> => {
    if (!clientP) {
      clientP = (async () => {
        const { createWorkbenchClient } = await import('./workbench-client');
        const { readMemberSignal, currentIdentity } = await import('./member-signal');
        const who = currentIdentity(readMemberSignal());
        if (!who?.login) { clientP = null; return null; }
        return createWorkbenchClient({
          signupBase: base,
          login: String(who.login), username: String(who.username || who.login),
          githubId: who.githubId != null ? String(who.githubId) : null,
        });
      })();
    }
    return clientP;
  };

  // A pasted image (2026-09-11). Left to the browser, an image on the clipboard lands in the paragraph as
  // <img src="data:..."> and vanished on "Done editing": the commit's read-back had no storable ref for it and
  // nothing had staged the bytes. So the paste is intercepted: an image FILE is staged the way the editor's
  // image card does it (same item key, same name rules, same 1 MB cap) and inserted as its own image block
  // right after the paragraph that held the caret (an emptied paragraph is replaced); a copied web image with
  // no file bytes inserts as a block pointing at its address. Anything else pastes as before. The decision of
  // what was pasted, and what to call it, is imagePastePlan / pastedImageName (tested without a DOM).
  const pasteImage = async (doc: PvDoc, el: HTMLElement, plan: any) => {
    let ref = '';
    let alt = '';
    if (plan.kind === 'remote') { ref = String(plan.url || ''); alt = String(plan.alt || ''); }
    else {
      const client = await getClient();
      if (!client) { setMsg('Sign in to add an image.'); return; }
      setMsg('Adding the image…');
      try {
        const taken = referencedDraftImages(fm, String(bodyDoc.get() || ''))
          .map((p: string) => stagedImageName(p) || String(p).split('/').pop() || '');
        // A copied image arrives as a decoded PNG bitmap, often over the cap for a small webp; fitImageFile
        // re-encodes anything over the cap as WEBP and passes a file that already fits through untouched.
        const fit = await fitImageFile(plan.file);
        const filename = pastedImageName({ name: fit.name, type: fit.blob?.type || plan.file?.type }, taken);
        const dataUrl = await fileToDataUrl(fit.blob);
        const res = await client.stageImage({ filename, dataBase64: dataUrl.split(',')[1] || '', itemPath, item: `${type}:${slug}` });
        ref = String(res?.path || '');
        alt = filename.replace(/\.[a-z0-9]+$/i, '');
        if (ref) stagedSrc[ref] = dataUrl; // the re-render resolves the new ref to the bytes just staged
      } catch (e: any) { setMsg(`Could not add the image: ${e?.message || 'unknown error'}`); return; }
    }
    if (!ref || !el.isConnected) return;
    delete el.dataset.pvSnap; // the re-render replaces this node; its blur must not commit a stale read
    await spliceBlock(doc, el, (before: string[]) => {
      const edited = applyBlockEdit(before.join('\n'), readBlockDom(el));
      return planImageInsert((edited || before).join('\n'), ref, alt);
    });
  };
  document.addEventListener('paste', (ev: ClipboardEvent) => {
    if (!editing) return;
    const el = (ev.target as HTMLElement | null)?.closest?.('[data-blk][contenteditable="true"], [data-nblk][contenteditable="true"]') as HTMLElement | null;
    if (!el) return;
    const plan = imagePastePlan(ev.clipboardData);
    if (!plan) return;
    ev.preventDefault();
    void pasteImage(docOfEl(el), el, plan);
  }, true);
  // A dropped image file (owner, 2026-09-11: a webp dragged in from the file explorer did nothing) lands the
  // same way a pasted one does, after the block under the pointer, or after the last block when dropped on
  // the margin. dragover must be cancelled for the drop to be offered at all.
  const dropBlockOf = (ev: DragEvent): HTMLElement | null => {
    const at = (ev.target as HTMLElement | null)?.closest?.('[data-blk], [data-nblk]') as HTMLElement | null;
    if (at) return at;
    const all = bodyEl ? Array.from(bodyEl.querySelectorAll('[data-blk]')) as HTMLElement[] : [];
    return all.length ? all[all.length - 1] : null;
  };
  document.addEventListener('dragover', (ev: DragEvent) => {
    if (!editing || !bodyEl?.contains(ev.target as Node)) return;
    if (Array.from(ev.dataTransfer?.types || []).includes('Files')) { ev.preventDefault(); if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy'; }
  }, true);
  document.addEventListener('drop', (ev: DragEvent) => {
    if (!editing || !bodyEl?.contains(ev.target as Node)) return;
    const plan = imagePastePlan(ev.dataTransfer);
    if (!plan) return;
    const el = dropBlockOf(ev);
    if (!el) return;
    ev.preventDefault();
    void pasteImage(docOfEl(el), el, plan);
  }, true);

  // sow-235: the shared hover toolbar (bold, italic, inline code, link) and its link manager, the same
  // module the block editor drives. It only offers itself over a block that is actually contenteditable.
  let seltb: any = null;
  const ensureToolbar = () => {
    if (seltb || !bodyEl) return;
    seltb = createSelectionToolbar({
      root: document,
      host: bodyEl,
      editableOf: (node: any) => {
        let cur = node;
        while (cur && cur !== bodyEl) {
          if (cur.nodeType === 1 && cur.getAttribute?.('contenteditable') === 'true') return cur as HTMLElement;
          cur = cur.parentNode;
        }
        return null;
      },
      allowInline: (el: HTMLElement) => el.tagName !== 'PRE', // a fenced block stays literal
      onCommit: (el: HTMLElement, reason: string) => {
        // A link edit closes the panel and has already left the block, so it commits now. Inline formatting
        // leaves the caret where it is, and re-rendering under the author mid-sentence would be hostile, so
        // it just marks the document dirty and lets the existing blur commit pick it up.
        if (reason === 'link') { void commitBlock(el); return; }
        markDirty();
      },
      // sow-235: promote a paragraph to a heading (or demote it back), through the toolbar's explicit H2/H3/P
      // controls. Any uncommitted text edit in the block is folded in first (applyBlockEdit), then the type is
      // changed; planBlockRetype refuses anything that is not a paragraph or heading, so the control is a safe
      // no-op over a list, a table or a fence.
      onRetype: (el: HTMLElement, toType: string, level: number | null) => {
        void spliceBlock(bodyDoc, el, (before: string[]) => {
          const edited = applyBlockEdit(before.join('\n'), readBlockDom(el));
          return planBlockRetype((edited || before).join('\n'), toType, level);
        });
      },
      // sow-235: the images ALREADY attached to this item, offered by the insert-image picker. Sourced from the
      // same referenced-path scan that fed stagedSrc and resolved through asset(), so a staged (unpublished)
      // image shows its bytes and a published one its CDN file. No new Worker route: the picker only ever lists
      // what this page already holds.
      listItemImages: () => referencedDraftImages(fm, String(bodyDoc.get() || ''))
        .map((p: string) => {
          const name = stagedImageName(p) || String(p).split('/').pop() || '';
          return { name, ref: p, src: asset(p, itemPath), alt: name.replace(/\.[a-z0-9]+$/i, '') };
        })
        .filter((im: { src: string }) => im.src),
      onInsertImage: (el: HTMLElement, { ref, alt }: { ref: string; alt: string }) => {
        void spliceBlock(bodyDoc, el, (before: string[]) => {
          const edited = applyBlockEdit(before.join('\n'), readBlockDom(el));
          return planImageInsert((edited || before).join('\n'), ref, alt);
        });
      },
      // The image bar (2026-09-11): full width, alignment, wrap and remove over an image block. The layout is
      // read from and written to the SOURCE line ({full}, {left wrap}: client/src/image-attrs.mjs), never the
      // DOM, and each write goes through spliceBlock like the heading control. The re-render replaces the
      // node, so the bar is put back on the same block index afterwards and the next click needs no
      // re-selection.
      imageTools: {
        layoutOf: (el: HTMLElement) => {
          const b: any = imageBlockOf(sourceOf(docOfEl(el), el));
          return b ? { width: b.width, align: b.align, wrap: b.wrap } : {};
        },
        onLayout: (el: HTMLElement, layout: any) => {
          const doc = docOfEl(el);
          const idx = Number(el.dataset[doc.attr]);
          void spliceBlock(doc, el, (before: string[]) => planImageLayout(before.join('\n'), layout)).then(() => {
            const scope = doc === noteDoc ? $('[data-pv-note-card]') : bodyEl;
            const again = scope?.querySelector(`[data-${doc.attr}="${idx}"]`) as HTMLElement | null;
            if (again && isImageBlockEl(again)) seltb?.showImageTools(again);
          });
        },
        onRemove: (el: HTMLElement) => { void deleteIn(docOfEl(el), el); },
        // The caption is the image title in the source line; set, changed or removed through the same splice.
        captionOf: (el: HTMLElement) => {
          const b: any = imageBlockOf(sourceOf(docOfEl(el), el));
          return b ? String(b.caption || '') : '';
        },
        onCaption: (el: HTMLElement, caption: string) => {
          const doc = docOfEl(el);
          const idx = Number(el.dataset[doc.attr]);
          void spliceBlock(doc, el, (before: string[]) => planImageCaption(before.join('\n'), caption)).then(() => {
            const scope = doc === noteDoc ? $('[data-pv-note-card]') : bodyEl;
            const again = scope?.querySelector(`[data-${doc.attr}="${idx}"]`) as HTMLElement | null;
            if (again && isImageBlockEl(again)) seltb?.showImageTools(again);
          });
        },
      },
      // sow-322: the list bar (Bullets | Numbers, marker styles, Remove list) while the caret is inside a list
      // block. The state is read from the SOURCE (a {square} suffix on the item that opens a run:
      // client/src/list-attrs.mjs) and a click goes through spliceBlock like Tab does, with any half-typed
      // text folded in first; the caret is put back on the same item afterwards, which re-shows the bar.
      listTools: {
        listOf: (node: any) => {
          let cur = node;
          while (cur && cur.nodeType !== 1) cur = cur.parentNode;
          const el = editing ? (cur?.closest?.('[data-blk][contenteditable="true"], [data-nblk][contenteditable="true"]') as HTMLElement | null) : null;
          return el && (el.tagName === 'UL' || el.tagName === 'OL') ? el : null;
        },
        stateOf: (el: HTMLElement, index: number) => {
          const b: any = listBlockOf(sourceOf(docOfEl(el), el));
          return b ? listRunState(b.items, !!b.ordered, index) : { ordered: el.tagName === 'OL', style: null };
        },
        onAction: (el: HTMLElement, index: number, action: string) => {
          const doc = docOfEl(el);
          const idx = Number(el.dataset[doc.attr]);
          delete el.dataset.pvSnap; // the re-render replaces this node; its blur must not commit a stale read
          void spliceBlock(doc, el, (before: string[]) => {
            const edited = applyBlockEdit(before.join('\n'), readBlockDom(el));
            const src = (edited || before).join('\n');
            return action === 'unwrap' ? planListUnwrap(src) : planListAttrs(src, index, action);
          }).then(() => {
            if (action === 'unwrap') return;
            const scope = doc === noteDoc ? $('[data-pv-note-card]') : bodyEl;
            const again = scope?.querySelector(`[data-${doc.attr}="${idx}"]`) as HTMLElement | null;
            const li = again ? (again.querySelectorAll('li')[index] as HTMLElement | undefined) : undefined;
            if (again) { again.focus(); if (li) caretAtEndOfItem(li, document.getSelection()); }
          });
        },
      },
    });
  };

  // An image block in edit mode: no caret, the image bar on click. Registered once per node, like the text
  // blocks below; the class is re-applied on every pass because edit mode owns it.
  const wireImageBlock = (el: HTMLElement) => {
    el.removeAttribute('contenteditable');
    el.classList.add('pv-image');
    if (el.dataset.pvWired === '1') return;
    el.dataset.pvWired = '1';
    el.addEventListener('click', (ev) => {
      if (!editing) return;
      ev.preventDefault();
      ensureToolbar();
      seltb?.showImageTools(el);
    });
  };

  // One wiring routine for both documents. The note is the same kind of thing as the body (stamped blocks
  // over a markdown source), so it gets the same click-to-edit, link manager and commit-on-blur behaviour
  // rather than a parallel implementation that would drift.
  const wireBlocks = (container: HTMLElement, doc: PvDoc) => {
    container.classList.toggle('pv-editing', editing);
    container.querySelectorAll(`[data-${doc.attr}]`).forEach((raw) => {
      const el = raw as HTMLElement;
      if (!editing) { el.removeAttribute('contenteditable'); return; }
      // sow-235: every block the renderer stamped with a source range and that carries editable text.
      // A range spanning several lines is fine now that commitBlock rebuilds the block from its source.
      // hr has nothing to edit, and the footnotes section is synthesized and carries a null range.
      const range = doc.ranges[Number(el.dataset[doc.attr])];
      if (!range) return;
      // An image block has no text to edit: it gets the image bar (full width, alignment, wrap, caption, remove)
      // on click instead of a caret, and never contenteditable, so a stray keystroke cannot delete the image.
      // Checked BEFORE the editable-tag test: a captioned image is a <figure>, which is not an editable tag.
      if (isImageBlockEl(el)) { wireImageBlock(el); return; }
      if (!isEditableBlockTag(el.tagName)) return;
      // sow-235 follow-up: contenteditable is set EAGERLY on every editable block while edit mode is on,
      // rather than lazily on click. The selection toolbar's editableOf only recognises a block already
      // carrying contenteditable="true", so with the attribute set on click a drag-selection across an
      // untouched paragraph resolved to nothing and no toolbar appeared. The author had to click a block
      // before they could select inside it, which is the reported defect. Setting it up front is what makes
      // select-then-act work on first contact, and it is also what lets keydown reach an unclicked block.
      el.setAttribute('contenteditable', 'true');
      // Listeners are registered once per NODE. wireEditing() re-runs after every commit, and the note
      // branch of commitIn re-renders ONLY the note card, so without this guard every body block collects a
      // second set of listeners and a single blur commits twice. The contenteditable line above is
      // deliberately outside the guard: it is owned by edit mode and must be re-applied on every pass.
      if (el.dataset.pvWired === '1') return;
      el.dataset.pvWired = '1';
      // A click on a link inside an editable block opens the link manager rather than placing a caret:
      // inside contenteditable a link neither navigates nor shows anything, so it otherwise reads as dead.
      el.querySelectorAll('a[href]').forEach((a) => a.addEventListener('click', (ev) => {
        if (!editing) return;
        ev.preventDefault();
        if (el.getAttribute('contenteditable') !== 'true') {
          el.setAttribute('contenteditable', 'true');
          el.dataset.pvSnap = readKey(el);
        }
        ensureToolbar();
        seltb?.editLink(el, a as HTMLElement);
      }));
      // Baseline for the no-op check on blur. Captured on FOCUS now that the attribute is set eagerly, so a
      // block entered by keyboard (Tab, or a caret arriving from a neighbour) records a baseline exactly as a
      // clicked one does. Captured after the browser's own contenteditable normalization, so the comparison
      // has the same normalization on both sides.
      el.addEventListener('focus', () => {
        if (el.dataset.pvSnap === undefined) el.dataset.pvSnap = readKey(el);
      });
      // Backspace at the very start of an EMPTY block removes it. Without this the only way to dispose of an
      // empty paragraph was to click away and let the blur commit collapse it, which works but gives no
      // feedback at the moment the author presses the key, so the key reads as broken.
      el.addEventListener('keydown', (ev: KeyboardEvent) => {
        // Tab / Shift+Tab in a list: the item under the caret moves one level in or out, through the same splice
        // path as the heading control, with any half-typed text folded in first. The re-render replaces the node,
        // so the caret is put back on the same item afterwards.
        if (ev.key === 'Tab' && editing && (el.tagName === 'UL' || el.tagName === 'OL')) {
          const { index } = listItemAtSelection(el, document.getSelection());
          if (index < 0) return;
          ev.preventDefault();
          const idx = Number(el.dataset[doc.attr]);
          const delta = ev.shiftKey ? -1 : 1;
          delete el.dataset.pvSnap;
          void spliceBlock(doc, el, (before: string[]) => {
            const edited = applyBlockEdit(before.join('\n'), readBlockDom(el));
            return planListIndent((edited || before).join('\n'), index, delta);
          }).then(() => {
            const scope = doc === noteDoc ? $('[data-pv-note-card]') : bodyEl;
            const again = scope?.querySelector(`[data-${doc.attr}="${idx}"]`) as HTMLElement | null;
            const li = again ? (again.querySelectorAll('li')[index] as HTMLElement | undefined) : undefined;
            if (again) { again.focus(); if (li) caretAtEndOfItem(li, document.getSelection()); }
          });
          return;
        }
        if (ev.key !== 'Backspace' || !editing) return;
        const sel = document.getSelection();
        if (!sel || !sel.isCollapsed || sel.focusOffset !== 0) return;
        if (String(el.textContent || '').trim() !== '') return;
        ev.preventDefault();
        delete el.dataset.pvSnap; // the blur that follows the re-render must not try to commit this node
        void deleteIn(doc, el);
      });
      el.addEventListener('blur', () => {
        // The link panel takes focus from the block. Committing now would re-render the document and
        // destroy the saved range before Apply is ever pressed, so the commit waits for the panel to close
        // (the toolbar's own onCommit does it). contenteditable and the snapshot are deliberately left in
        // place here, so the block is still the one being edited when the panel returns.
        if (seltb?.isPanelOpen()) return;
        // A click-through must commit NOTHING. commitBlock decides "edited" by comparing the read-back to the
        // source line, and the renderer is not a perfect inverse for every construct, so an untouched block
        // could read back different, rewrite draft.body, and re-render the whole document -- destroying the
        // node the author was clicking next. Comparing the DOM against itself cannot have that failure mode.
        // No snapshot means this blur has already been handled, or the block was never focused. Without
        // this an extra blur reads `undefined !== <the html>` as "edited" and commits the block a second time.
        if (el.dataset.pvSnap === undefined) return;
        const untouched = el.dataset.pvSnap === readKey(el);
        // contenteditable is NOT removed here any more: it is owned by edit mode, and wireBlocks strips it
        // from every block the moment editing is turned off. Removing it on blur would put the surface back
        // into the click-first state this change exists to fix.
        delete el.dataset.pvSnap;
        if (untouched) return;
        void commitIn(doc, el);
      });
    });
  };

  // The TITLE is editable in place too, and it is a different kind of thing from every block around it: it
  // is frontmatter, not body source, so it has no line range and never goes through commitIn. The edit
  // writes fm.title, which is the very object the Save handler sends as `input`, so nothing else has to
  // learn about it. Held to one line of plain text on purpose: the value becomes an h1 and a document
  // title, and neither can render markup or a newline.
  const wireTitle = () => {
    const el = $('[data-pv-title]') as HTMLElement | null;
    if (!el) return;
    if (!editing) { el.removeAttribute('contenteditable'); return; }
    el.setAttribute('contenteditable', 'true');
    if (el.dataset.pvTitleWired === '1') return; // wireEditing re-runs after every commit
    el.dataset.pvTitleWired = '1';
    el.addEventListener('keydown', (ev: KeyboardEvent) => {
      // Enter commits rather than inserting a line break, and Escape abandons the edit.
      if (ev.key === 'Enter') { ev.preventDefault(); el.blur(); }
      if (ev.key === 'Escape') { ev.preventDefault(); el.textContent = String(fm.title || slug); el.blur(); }
    });
    el.addEventListener('blur', () => {
      // textContent, so pasted markup cannot survive the commit whatever the browser allowed on the way in.
      // What the value MEANS is planTitleEdit's decision, tested in test/preview-title.test.mjs.
      const plan = planTitleEdit(el.textContent, fm.title, slug);
      el.textContent = plan.display;
      if (!plan.changed) return;
      fm.title = plan.title;
      const bn = $('[data-pv-barname]'); if (bn) bn.textContent = plan.title;
      document.title = `Preview: ${plan.title}`;
      markDirty();
    });
  };

  const wireEditing = () => {
    if (editing) ensureToolbar(); else seltb?.hide();
    if (bodyEl) wireBlocks(bodyEl, bodyDoc);
    const card = $('[data-pv-note-card]');
    if (card) wireBlocks(card, noteDoc);
    wireTitle();
  };

  // The note card, rebuilt from its own source the same way the body is. Two details matter. The renderer
  // stamps `data-blk`, which would collide with the body's indices, so the note's stamps are rewritten to
  // `data-nblk` and wireBlocks looks for that. And while editing, an item with no note yet still renders
  // the card with an empty paragraph, so a note can be ADDED here rather than only edited.
  const renderNoteCard = () => {
    const card = $('[data-pv-note-card]');
    if (!card || !noteMeta) return;
    const src = noteDoc.get();
    if (!src.trim() && !editing) { card.hidden = true; return; }
    let bodyHtml: string;
    if (editing) {
      const r = mdBlocks(noteEditSource(src, true));
      noteDoc.ranges = r.blocks;
      bodyHtml = String(r.html).replace(/ data-blk="/g, ' data-nblk="');
    } else {
      noteDoc.ranges = [];
      bodyHtml = mdPlain(src);
    }
    card.innerHTML = buildAuthorNoteHtml({ ...noteMeta, bodyHtml });
    card.hidden = false;
  };

  // Bind the two functions the render half calls, before loadNote (which calls renderNoteCard) runs.
  liveWireEditing = wireEditing;
  liveRenderNoteCard = renderNoteCard;

  await loadNote();

  editBtn?.addEventListener('click', async () => {
    editing = !editing;
    editBtn.textContent = editing ? 'Done editing' : 'Edit';
    editBtn.classList.toggle('on', editing);
    setMsg(editing ? 'Click a block to edit it. Highlight text for formatting and links.' : (dirty ? 'Unsaved changes.' : ''));
    await renderFromSource();
    apply();
    renderNoteCard();
    wireEditing();
  });

  // Saves through the SAME path the editor uses. A second write path to one draft is how a save starts
  // disagreeing with itself, so this reuses saveDraft rather than posting the file itself.
  saveBtn?.addEventListener('click', async () => {
    saveBtn.disabled = true;
    setMsg('Saving…');
    try {
      // The client is identity-scoped, so it needs the signed-in member rather than being constructed
      // bare (getClient, shared with the image paste). Same source the rest of the site uses (sow-030's
      // member signal), so a save from here is attributed exactly as a save from the editor is.
      const client = await getClient();
      if (!client) { setMsg('Sign in to save this draft.'); return; }
      await client.saveDraft({
        type, input: fm, body: String(draft.body || ''), path: itemPath,
        ...(typeof draft.authorNote === 'string' ? { authorNote: draft.authorNote } : {}),
      });
      dirty = false;
      saveBtn.hidden = true;
      setMsg('Saved.');
    } catch (e: any) {
      setMsg(`Could not save: ${e?.message || 'unknown error'}`);
    } finally {
      saveBtn.disabled = false;
    }
  });
}
