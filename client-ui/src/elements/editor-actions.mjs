// <gbti-content-editor> actions: the toolbar (copy the MCP ID, view the public entry, the Visual and Markdown views,
// Save draft, Preview, Publish), one-click public approval, the "what changed" list, and the status line, save chip
// and banner they report through. A class mixin composed onto GbtiElement in gbti-content-editor.mjs, so `this` is
// the editor. The methods moved here unchanged and in their original order when the element crossed the 900-line
// limit (owner, 2026-09-30); _toggleChanges, _changesHtml and doPublish stay adjacent, in that order.

import { esc } from '../base.mjs';
import { submitAck, failHint, authorSelectValue, authorTargetFor } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement
import { publishChanges, changeLabel, formatValue, snippet } from '../publish-diff.mjs'; // sow-327: what exactly is unpublished
import { publicUrlFor } from '../public-url.mjs'; // SOW-265: the shared live-URL scheme (also used by the My Content table)
import { INFO, CHECK } from './editor-icons.mjs';
import { landingPath, waitForLanding } from '../editor-core.mjs'; // sow-477: a second publish waits for this editor's move to land
import { behindMessage, staleMessage, forceConfirmMessage } from '../draft-behind.mjs'; // sow-482: a draft or a tab the published version moved past

// sow-327: the amber banner of a staged draft. Shared by render() and by "Keep editing the draft", which swaps the
// behind banner for this one in place (a full render would throw away edits typed since the load).
export const stagedBannerHtml = () => `<div class="pubinfo warn" id="pubbanner">${INFO}<div class="pi-body"><span>You have unpublished changes saved in this editor. <b>Publish</b> to make them live. <button type="button" class="pi-link" id="whatchanged">See what changed</button></span><div class="chg" id="changedlist" hidden></div></div></div>`;

// sow-482: the same slot when the published version changed after this draft began (owner, 2026-10-27: reuse the
// current banner). The discard is the primary action because it is the safe one: the published version has work the
// draft does not, and publishing the draft would remove it.
export const behindBannerHtml = ({ publishedAt, savedAt, type } = {}) => `<div class="pubinfo warn" id="pubbanner">${INFO}<div class="pi-body"><span>${esc(behindMessage({ publishedAt, savedAt, type }))} <button type="button" class="pi-link" id="whatchanged">See what changed</button></span><div class="pi-acts"><button type="button" class="ebtn ebtn-primary" id="behinddiscard">Discard this draft and open the published version</button><button type="button" class="ebtn" id="behindkeep">Keep editing the draft</button></div><div class="chg" id="changedlist" hidden></div></div></div>`;

export const withEditorActions = (Base) => class extends Base {
  out(html, cls = 'muted') {
    const o = this.$('#out');
    if (o) {
      o.className = cls;
      o.innerHTML = html;
    }
  }

  // SOW-062 Phase 6: the "content ID" the MCP server (and every /api content route) addresses is the item's
  // repo-relative path. Copy it to the clipboard so an author can hand it to their agent. Only wired when editing an
  // existing item (a new item has no path yet, so the button is not rendered).
  async copyContentId() {
    const id = this.itemPath;
    if (!id) return;
    const lbl = this.$('#copyid')?.querySelector('.lbl');
    try {
      if (!navigator.clipboard?.writeText) throw new Error('no clipboard');
      await navigator.clipboard.writeText(id);
      if (lbl) { const o = lbl.textContent; lbl.textContent = 'Copied'; setTimeout(() => { lbl.textContent = o; }, 1200); }
    } catch {
      this.out(`MCP ID: <code>${esc(id)}</code> (copy it manually)`);
    }
  }

  // SOW-062 Phase 6: the live public URL for a published item (post -> /articles/, project -> /projects/,
  // prompt -> /prompts/). Drives the "View Public Entry" button, which is only shown when the item is published.
  publicUrl() {
    const p = this.preset?.input ?? {};
    const slug = this.presetStr(p.slug) || (this.$('[data-header="slug"]')?.textContent || '').trim();
    // SOW-265: delegate to the shared scheme so the editor and the My Content table cannot diverge.
    // Passing itemPath lets the helper recover the slug from a nested item path when frontmatter omits
    // it, which previously built a broken https://gbti.network/projects// URL.
    return publicUrlFor({ type: this.type, slug, path: this.itemPath });
  }

  // SOW-062 Phase 6: the Visual / Markdown doc-view toggle. Visual is the block editor; Markdown is the body as
  // source (the same #body.value the serializer produces). sow-199 made it EDITABLE: see the #docmd input
  // wiring; opening the view projects the body in, and any pending edit is flushed before the view changes.
  // sow-199: push the Markdown textarea into the block model. Idempotent for text that is already the body.
  _applyMarkdownEdit() {
    const ta = this.$('#docmd');
    const body = this.$('#body');
    if (!ta || !body) return;
    if (ta.value === body.value) return;
    body.value = ta.value;
    this._markDirty();
  }

  setDocView(mode) {
    const on = mode === 'markdown';
    this.$('.doc')?.classList.toggle('md-view', on);
    const wrap = this.$('#docmdwrap');
    if (wrap) {
      if (!on) { clearTimeout(this._mdTimer); this._applyMarkdownEdit(); } // sow-199: a debounced edit must not be lost on the way back to Visual
      wrap.hidden = !on;
      if (on) { const ta = this.$('#docmd'); if (ta) ta.value = this.$('#body')?.value ?? ''; }
    }
    this.$$('#docview [data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === mode));
    const md = this.$('#mdref'); if (md) md.hidden = !on; // SOW-062 P6: the cheatsheet button shows only in Markdown view
  }

  // SOW-062 P6: immediate feedback at the toolbar (the #out message sits far down the canvas, so a click read as
  // "no feedback"). _setChip updates the save-chip next to the buttons; _btnBusy spins + disables the button, and
  // returns a restore fn.
  _setChip(html, cls = '') { const c = this.$('#savechip'); if (c) { c.className = 'savechip' + (cls ? ' ' + cls : ''); c.innerHTML = html; } }
  _btnBusy(sel, label) {
    const b = this.$(sel);
    if (!b) return () => {};
    const orig = b.innerHTML;
    b.disabled = true; b.setAttribute('aria-busy', 'true'); b.innerHTML = `<span class="spin"></span> ${esc(label)}`;
    return () => { b.disabled = false; b.removeAttribute('aria-busy'); b.innerHTML = orig; };
  }

  // SOW-062 P6: the content has diverged from the loaded/published version -> reveal the Publish button (once).
  _markDirty() {
    if (this._dirty) return;
    this._dirty = true;
    this.$('#publish')?.removeAttribute('hidden');
  }


  /**
   * sow-327: show WHICH changes are unpublished, as an ordered list, and jump to the one you click.
   *
   * The comparison is made against the committed file read at click time, not against anything the editor
   * was loaded with. That is the whole point: this element is filled from the staged draft alone, so it has
   * never held the live bytes, and the staged flag it shows is a boolean rather than a comparison.
   */
  async _toggleChanges() {
    const box = this.$('#changedlist');
    const btn = this.$('#whatchanged');
    if (!box) return;
    this._changesOpen = !this._changesOpen;
    box.hidden = !this._changesOpen;
    if (btn) btn.textContent = this._changesOpen ? 'Hide changes' : 'See what changed';
    if (!this._changesOpen) return;
    box.innerHTML = '<p class="chg-msg">Comparing with the live version…</p>';
    try {
      // Re-read every time it is opened rather than caching: the author keeps editing with the panel closed,
      // and a stale list is worse than no list here.
      const live = this.itemPath ? await this.client?.getContentItem?.({ path: this.itemPath }) : null;
      const { input, body } = this.gather();
      const draftNote = this.$('#authornote') ? (this.$('#authornote').value ?? '') : null;
      // The Author picker's pending move, read exactly as doPublish reads it, because that IS what a publish
      // would send. Absent for everyone but a superadmin, who is the only one the picker renders for.
      const to = authorTargetFor(this.$('#ownerSelect')?.value, this._ownerSelInitial);
      const fromValue = authorSelectValue({ itemPath: this.itemPath, author: this.presetStr(this.preset?.input?.author) });
      const from = fromValue === 'house' ? { scope: 'house' } : { scope: 'member', username: fromValue.replace(/^member:/, '') };
      const res = publishChanges({
        reassign: to ? { from, to } : null,
        live: live ? { frontmatter: live.frontmatter || {}, body: live.body || '' } : null,
        draft: { frontmatter: input, body },
        liveNote: typeof this._liveAuthorNote === 'string' ? this._liveAuthorNote : null,
        draftNote,
      });
      box.innerHTML = this._changesHtml(res);
      // Clicking an entry takes you to the block it describes. The body editor owns its own shadow DOM, so
      // it is asked to highlight rather than reached into.
      this.$$('[data-jump]').forEach((el) => el.addEventListener('click', () => {
        const ok = this.$('#body')?.highlightBlock?.(Number(el.dataset.jump));
        if (ok === false) el.classList.add('chg-gone');
      }));
    } catch {
      box.innerHTML = '<p class="chg-msg">Could not read the live version to compare against. Your changes are still saved.</p>';
    }
  }

  /** The ordered list itself. Values are escaped here; nothing in a diff is trusted markup. */
  _changesHtml(res) {
    if (res.isNew) {
      return `<p class="chg-msg">This item has never been published, so all ${res.blockCount} block${res.blockCount === 1 ? '' : 's'} of it are new. Publish to put it live.</p>`;
    }
    // The honest half of the metadata guard in publish-diff.mjs: say the fields could not be read, rather
    // than either listing them as emptied or quietly dropping them from the answer.
    const unread = res.metaUnread
      ? '<p class="chg-msg">The settings fields could not be read just now, so only body changes are listed. Reload the editor before publishing.</p>'
      : '';
    if (!res.items.length) {
      return unread || '<p class="chg-msg">Nothing differs from the live version right now. The saved draft matches what is published.</p>';
    }
    // sow-482: when the published version is the newer side, the list says so first and names each side by what it
    // is, so a block the draft lacks reads as only in the published version, not as one the author removed.
    const newerSide = Boolean(this._behind || this._stale);
    const [wasW, nowW] = newerSide ? ['published', 'here'] : ['was', 'now'];
    const label = (it) => changeLabel(it, { newer: newerSide });
    const row = (was, now) => `<span class="chg-v"><i>${wasW}</i> ${esc(was)}</span><span class="chg-v"><i>${nowW}</i> ${esc(now)}</span>`;
    const li = res.items.map((it) => {
      const head = it.kind === 'block' && Number.isInteger(it.index) && it.op !== 'removed'
        ? `<button type="button" class="chg-jump" data-jump="${it.index}">${esc(label(it))}</button>`
        : `<span class="chg-h">${esc(label(it))}</span>`;
      if (it.kind === 'field' || it.kind === 'note') return `<li>${head}${row(formatValue(it.was), formatValue(it.now))}</li>`;
      if (it.op === 'coarse') return `<li>${head}<span class="chg-v">${esc(it.was)} live, ${esc(it.now)} in this ${this.staged ? 'draft' : 'editor'}</span></li>`;
      if (it.op === 'added') return `<li>${head}<span class="chg-v">${esc(snippet(it.now))}</span></li>`;
      if (it.op === 'removed') return `<li>${head}<span class="chg-v"><i>${wasW}</i> ${esc(snippet(it.was))}</span></li>`;
      return `<li>${head}${row(snippet(it.was), snippet(it.now))}</li>`;
    }).join('');
    const newer = newerSide ? `<p class="chg-msg">The published version is newer than this ${this.staged ? 'draft' : 'editor'}. Publishing would undo each difference below.</p>` : '';
    return `${unread}${newer}<ol>${li}</ol>`;
  }

  async doPublish({ force = false } = {}) {
    // sow-454 (defect 6, reported by a member 2026-10-13): a validation failure leaves its red banner on
    // screen, and this method never cleared it, so fixing the fields and pressing Publish again showed
    // "Publishing…" under the OLD error. Clearing on entry is the only correct moment: the success and
    // failure paths below both write their own banner, so clearing there would race with them.
    this._bannerClear();
    const restore = this._btnBusy('#publish', 'Publishing…');
    this._setChip('Publishing…', 'busy');
    this.out('Publishing…');
    try {
      // sow-477: the last publish from this editor moved the item, and the move may still be landing. Publishing
      // over it would refuse on the pictures at best, and at worst undo the move (see waitForLanding).
      if (this._landingPath) {
        this._setChip('Waiting for your last publish to land…', 'busy');
        this.out('Waiting for your last publish to land…');
        const landed = await waitForLanding({ read: (path) => this.client.getContentItem({ path }), path: this._landingPath });
        if (landed === 'timeout') {
          this._setChip('');
          const msg = 'Your last publish moved this item, and the move has not landed yet. Wait a minute, then publish again.';
          this._banner(esc(msg), 'danger');
          this.out(esc(msg), 'danger');
          return;
        }
        this._landingPath = null;
        this._setChip('Publishing…', 'busy');
        this.out('Publishing…');
      }
      // Pictures picked before the item had a permalink upload now (editor-media.mjs), and a required image that is
      // still empty is named in words rather than reaching the schema as "icon: Invalid input".
      await this._flushHeldImages();
      const missingImages = this._missingImagesMessage();
      if (missingImages) throw new Error(missingImages);
      const { type, input, body, skillFile } = this.gather();
      // SOW-062 P6: the from-the-author note seeds/updates the intro-<slug> comment in the same PR (project/prompt).
      const authorNote = this.$('#authornote')?.value?.trim() || undefined;
      if (this.fields.some((f) => f.key === 'status')) input.status = 'published'; // status is action-driven (no rail dropdown)
      // SOW-062 P6: stamp `updatedAt` so the meta can show last-updated-on-live vs -locally.
      // publishedAt is DELIBERATELY NOT stamped here (owner bug, 2026-08-07). It used to be, so that an edit
      // re-surfaced the item in the publishedAt-sorted feed, but that overwrote the real publication date: a
      // Nov 2025 post edited today claimed to be from today, in the WorkBench list AND on the public site.
      // operations.mjs (publishContent) already sets publishedAt only when it is ABSENT and otherwise preserves
      // the prior value, so a first publish still gets its date and a re-publish keeps it. Resurfacing is now
      // the feed's job: feedTime sorts on the later of publishedAt/updatedAt and the row marks itself Updated.
      if (['post', 'project', 'prompt'].includes(type)) { input.updatedAt = new Date().toISOString(); }
      // publish() sends the files to the network, which opens the pull request (sow-274: no fork step), so no
      // separate pre-publish saveDraft is needed.
      // SOW-112 v2: `path` names the loaded canonical item; a changed permalink makes this publish a RENAME.
      // SOW-145: a house target publishes to house/ (author stays 'gbti'); the server re-checks superadmin.
      // sow-183: the Author picker (superadmin-only, rendered only for an existing item) -> authorTarget. Sent
      // ONLY when the pick differs from what the picker was rendered with. It used to be sent unconditionally,
      // on the reasoning that a same-owner pick is a self-cancelling no-op; that reasoning holds only while the
      // rendered value is right, and when it was not (see authorSelectValue) an untouched control moved a live
      // item into members/gbtilabs on publish. An untouched control now moves nothing, whatever it displays.
      const authorTarget = authorTargetFor(this.$('#ownerSelect')?.value, this._ownerSelInitial);
      // sow-482: the versions this publish may replace. The client refuses with 'published-changed' when main holds
      // another; `force` is the author's "Publish anyway".
      const bases = [this._base, this._prevBase].filter((b) => typeof b === 'string');
      const res = await this.client.publish({ type, input, body, authorNote, path: this.itemPath || undefined, scope: this.itemScope === 'house' ? 'house' : undefined, ...(bases.length ? { bases } : {}), ...(force ? { force: true } : {}), authorTarget, ...(skillFile !== undefined ? { skillFile } : {}) });
      this._setChip(`${CHECK} Published`, 'ok');
      this._dirty = false; this.$('#publish')?.setAttribute('hidden', ''); // now live + matches -> nothing to publish
      // sow-326: this content is no longer a staged draft, and the flag has to say so IN THIS SESSION as well
      // as in the store. The publish above deletes the KV record, but `staged` is written exactly once, in
      // load(), and the workspace re-feeds its own copy on every render, so without both halves the banner and
      // the "Staged draft . not published" label came straight back on the next repaint of an editor that had
      // just published successfully. The workspace clears its copy on the gbti-published event.
      this.staged = false;
      // sow-482: this publish is now the version the editor stands on; the one it replaced (on main when it went
      // through, which after "Publish anyway" is not the one this editor opened) stays accepted until the merge lands. A host that returns no base drops both (no check rather than a false refusal), as the workspace
      // does in followPublishedItem. The draft is gone, so nothing is behind any more.
      if (typeof res?.base === 'string') { this._prevBase = typeof res.replaced === 'string' ? res.replaced : this._base; this._base = res.base; } else { this._base = null; this._prevBase = null; }
      this._behind = null;
      this._stale = false;
      // sow-454 (reported by a member 2026-10-13): the toolbar said "Published" while the line under the
      // title still read "Draft", so a member who had just published could not tell whether it worked.
      // liveLabel is computed in render() from preset.input.status, which a publish never updated, so the
      // stale word survived until a reload. Update the preset (any later render is then right) and the two
      // nodes in place, because a full re-render here would throw away cursor and scroll in a live editor.
      if (this.preset?.input) this.preset.input.status = 'published';
      const liveEl = this.$('[data-livelabel]');
      if (liveEl) liveEl.textContent = 'Live';
      this.$('[data-slugmeta]')?.classList.remove('staged');
      this.$('[data-slugmeta]')?.classList.add('pub');
      // SOW-112 QA (owner-directed): the publish-expectation banner appears only AFTER Publish is pressed.
      // sow-404: members no longer see pull requests, so the banner no longer points at them.
      this._banner(`Publishing is not instant. The site rebuilds after you publish, so your change reaches the live site in about 2 to 3 minutes.`);
      const renameNote = res?.renamed ? ` The permalink changed from ${esc(res.renamed.from)} to ${esc(res.renamed.to)}; the old link starts redirecting in about 2 to 3 minutes.` : '';
      const ownerLabel = (o) => (o?.scope === 'house' ? 'House / GBTI Network' : (o?.username || 'a member'));
      const reassignNote = res?.reassigned ? ` This item moved from ${esc(ownerLabel(res.reassigned.from))} to ${esc(ownerLabel(res.reassigned.to))}.` : '';
      this.out(`<span class="tag ok">submitted</span> ${esc(submitAck({ prNumber: res.prNumber, autoMerge: true }))}${renameNote}${reassignNote}`); // SOW-072 P2: consistent ack (esc: out() writes innerHTML)
      if (res?.renamed && this.preset?.input) { this.preset.input.slug = res.renamed.to; } // the view reflects the accepted rename
      // Follow the item to where the Worker actually put it. This used to write the pre-sow-195 literal 'gbti'
      // for a house reassignment; 'gbti' names no member, so the Author picker could never resolve the owner
      // again and re-defaulted to House on every later render. Reading it off the returned PATH keeps one
      // source of truth and needs no second copy of the network owner's name in this bundle.
      if (res?.path && this.preset?.input) {
        const owner = authorSelectValue({ itemPath: res.path });
        if (owner.startsWith('member:')) this.preset.input.author = owner.slice(7);
      }
      // The move has been consumed, so the pending target must not survive it. Left set, it would outrank the
      // item's new path on the next render and show the item as still pending a move it already made, and a
      // later draft save would write that stale target back into the store.
      this._pendingAuthorTarget = null;
      // sow-183: keep itemPath/itemScope live from the Worker's own account of where the item now sits, so a
      // SECOND publish in the same session (no reload) targets the new location rather than the just-deleted
      // old one -- true for either a rename or a reassignment, and a harmless no-op for a plain edit.
      if (res?.path) { this.itemPath = res.path; this.itemScope = res.path.startsWith('house/') ? 'house' : 'member'; }
      // sow-477: the ID readout is drawn once per render, so after a move it kept showing the old folder.
      if (res?.path) { const id = this.$('#mcpid'); if (id) id.textContent = res.path; }
      this._landingPath = landingPath(res); // a move lands in about 25 seconds; the next publish waits for it
      this.emit('gbti-published', res);
    } catch (err) {
      this._setChip('');
      if (err?.code === 'published-changed') { this._staleRefusal(); return; } // sow-482
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      const msg = h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text;
      // SOW-112 QA: the failure must be unmissable — the banner slot goes danger (the bottom status line was
      // repeatedly below the fold, so a failed publish read as "nothing happened").
      this._banner(esc(msg), 'danger');
      this.out(esc(msg), 'danger');
    } finally {
      restore();
    }
  }

  // sow-482: the behind banner's buttons. "Keep editing" hides the warning for this visit only: the banner becomes the
  // plain staged one, swapped in place, and the next open shows the warning again while the draft is still behind.
  _wireBehindActions() {
    this.$('#behinddiscard')?.addEventListener('click', () => this._openPublishedVersion());
    this.$('#behindkeep')?.addEventListener('click', () => {
      this._behindHidden = true;
      const pb = this.$('#pubbanner');
      if (!pb) return;
      // The banner is a direct child of the shadow root, where outerHTML cannot be set (it throws), so the new one is
      // parsed in a template and swapped in.
      const t = document.createElement('template');
      t.innerHTML = stagedBannerHtml();
      pb.replaceWith(t.content.firstElementChild);
      this._changesOpen = false;
      this.$('#whatchanged')?.addEventListener('click', () => this._toggleChanges());
    });
  }

  /** Leave this edit for the published version. The workspace does the loading; a staged draft is discarded first. */
  _openPublishedVersion() {
    const q = this.staged
      ? 'Discard this draft and open the published version? The saved draft is deleted.'
      : 'Open the published version? Changes in this editor that are not published are lost.';
    if (typeof confirm === 'function' && !confirm(q)) return;
    this.emit('gbti-open-published', { discard: Boolean(this.staged) });
  }

  /** A failure reported from outside the editor (the workspace's load of the published version). */
  showProblem(msg) {
    this._banner(esc(msg), 'danger');
    this.out(esc(msg), 'danger');
  }

  // sow-482: the publish stopped because the published version is not the one this edit began from. Red, beside the
  // comparison, with the author's two ways on: write over it anyway, or start again from the published version.
  _staleRefusal() {
    this._stale = true;
    const msg = staleMessage(this.type);
    const open = this.staged ? 'Discard this draft and open the published version' : 'Open the published version';
    const pb = this.$('#pubbanner');
    if (pb) {
      pb.classList.remove('warn');
      pb.classList.add('danger');
      pb.innerHTML = `${INFO}<div class="pi-body"><span>${esc(msg)} <button type="button" class="pi-link" id="whatchanged">See what changed</button></span><div class="pi-acts"><button type="button" class="ebtn" id="pubanyway">Publish anyway</button><button type="button" class="ebtn" id="openpub">${open}</button></div><div class="chg" id="changedlist" hidden></div></div>`;
      pb.hidden = false;
      this._changesOpen = false;
      pb.querySelector('#whatchanged')?.addEventListener('click', () => this._toggleChanges());
      pb.querySelector('#pubanyway')?.addEventListener('click', () => {
        if (typeof confirm === 'function' && !confirm(forceConfirmMessage(this.type))) return; // see forceConfirmMessage
        this.doPublish({ force: true });
      });
      pb.querySelector('#openpub')?.addEventListener('click', () => this._openPublishedVersion());
    }
    this.out(esc(msg), 'danger');
  }

  // SOW-112 QA: put a message in the top banner slot. cls '' = info (green), 'warn' = amber, 'danger' = red.
  /** Hide the publish banner and drop its severity. Paired with _banner, which never un-hides on its own. */
  _bannerClear() {
    const pb = this.$('#pubbanner');
    if (!pb) return;
    pb.classList.remove('warn', 'danger');
    pb.innerHTML = '';
    pb.hidden = true;
  }

  _banner(html, cls = '') {
    const pb = this.$('#pubbanner');
    if (!pb) return;
    pb.classList.remove('warn', 'danger');
    if (cls) pb.classList.add(cls);
    pb.innerHTML = `${INFO}<span>${html}</span>`;
    pb.hidden = false;
  }

  // SOW-082: Save the current content as a private draft (no PR; sow-274: never a fork). Allowed for trial + paid; a
  // trial member's members-only content is refused server-side with a clean upgrade nudge (membership-required).
  // sow-169 phase 4: preview the item as the page it will become, in a new tab.
  //
  // It SAVES first, and that is forced rather than chosen: a new tab cannot read this editor's unsaved
  // in-memory state, and in the extension the editor runs on chrome-extension:// while the preview is
  // gbti.network, so no storage is shared at all. Saving to the draft store is the only mechanism that
  // works identically on both hosts, so the button title says so and the status line repeats it.
  //
  // The tab is opened SYNCHRONOUSLY on the click and its location set after the save resolves, because a
  // window.open() issued after an await is a popup the browser blocks.
  //
  // sow-170 fix: the open must NOT pass 'noopener' -- `window.open('', ..., 'noopener')` returns null (that is
  // what noopener does), so the code could never navigate the tab it opened and fell to a second window.open()
  // after the await, leaving a blank orphan tab beside the preview. We open with a real handle, sever the opener
  // ourselves (the security intent of noopener) and paint a same-origin interstitial so the tab is not a stark
  // blank while the draft saves.
  async doPreview() {
    // sow-268: gather() runs first and can THROW (a field that fails to coerce, historically the gallery json
    // field). Unlike doDraft/doPublish this call sat outside any try, so a gather error made Preview a dead
    // button with no message. Catch it and report it the same way the other two actions do.
    let slug;
    try {
      slug = String(this.gather()?.input?.slug || '').trim();
    } catch (err) {
      const h = failHint(err);
      this.out(esc(h.text), 'danger');
      return;
    }
    if (!slug) { this.out('Give the item a permalink before previewing it.', 'danger'); return; }
    // sow-194: a repo draft is already committed at its canonical path, so Preview reads it directly (store=repo
    // + path) instead of saving a KV shadow copy first. This keeps it a "Repo draft" in the WorkBench afterward,
    // rather than the doDraft() below converting it into a KV/fork draft on every preview.
    const isRepo = this.itemStore === 'repo';
    const tab = typeof window !== 'undefined' ? window.open('', '_blank') : null;
    if (tab) {
      try { tab.opener = null; } catch { /* cross-origin, already severed */ }
      try { tab.document.write('<!doctype html><title>Preparing preview</title><body style="margin:0;font:15px/1.5 system-ui,sans-serif;color:#6c6976;background:#faf9fb;display:flex;align-items:center;justify-content:center;height:100vh">Preparing your preview&hellip;</body>'); } catch { /* about:blank not writable */ }
    }
    const previewUrl = (extra = '') => `https://gbti.network/workbench/preview/?type=${encodeURIComponent(this.type)}&slug=${encodeURIComponent(slug)}${extra}`;
    if (isRepo) {
      // No save: point the tab straight at the canonical preview. The path lets preview.astro read the committed
      // file via /membership/file rather than the KV draft store.
      const url = previewUrl(`&store=repo${this.itemPath ? `&path=${encodeURIComponent(this.itemPath)}` : ''}`);
      if (tab) tab.location = url; else window.open(url, '_blank', 'noopener');
      this.out('<span class="tag ok">preview</span> Opened this committed draft in a new tab as a preview.');
      return;
    }
    const restore = this._btnBusy('#preview', 'Saving…');
    this._setChip('Saving…', 'busy');
    try {
      await this.doDraft();
      const url = previewUrl();
      if (tab) tab.location = url;
      else window.open(url, '_blank', 'noopener'); // the synchronous open was popup-blocked: try once directly
      this.out('<span class="tag ok">saved</span> Draft saved and opened in a new tab as a preview.');
    } catch (err) {
      if (tab) tab.close();
      const h = failHint(err);
      this.out(esc(h.text), 'danger');
    } finally {
      restore();
    }
  }

  async doDraft() {
    const restore = this._btnBusy('#draft', 'Saving…');
    this._setChip('Saving…', 'busy');
    this.out('Saving draft…');
    try {
      await this._flushHeldImages(); // a draft keeps the pictures picked before the permalink existed
      const { type, input, body, skillFile } = this.gather();
      if (this.fields.some((f) => f.key === 'status')) input.status = 'draft'; // SOW-062 P6: status is action-driven (no rail dropdown)
      if (['post', 'project', 'prompt'].includes(type)) input.updatedAt = new Date().toISOString(); // SOW-062 P6: last-updated-locally
      const authorNote = this.$('#authornote')?.value ?? undefined;
      // The pending author reassignment travels WITH the draft. Before this it lived only in the DOM, so saving
      // and reloading discarded the superadmin's choice, and publishing that draft from the Drafts list
      // reassigned nothing while reporting success.
      //
      // THE BASELINE IS THE ITEM'S TRUE OWNER, NOT THE RENDERED VALUE, and the difference is the whole
      // semantics of the stored field: it means "the chosen owner differs from where this item actually is".
      // Comparing against the rendered value instead would store nothing when a pending pick is reloaded and
      // saved again untouched, quietly dropping it on the second save.
      //
      // undefined PRESERVES (the picker is not rendered at all for a non-superadmin, and for the extension
      // host, neither of which may clear a pending move they cannot see). An explicit null CLEARS, which is
      // what a pick that matches the true owner means.
      const ownerSel = this.$('#ownerSelect');
      const trueOwner = authorSelectValue({ itemPath: this.itemPath, author: this.presetStr(this.preset?.input?.author) });
      const authorTarget = ownerSel ? (authorTargetFor(ownerSel.value, trueOwner) ?? null) : undefined;
      const res = await this.client.saveDraft({
        type, input, body, path: this.itemPath || undefined, // SOW-112 v2: a changed permalink stages on the item's own branch
        ...(typeof authorNote === 'string' ? { authorNote } : {}),
        ...(authorTarget !== undefined ? { authorTarget } : {}),
        ...(skillFile !== undefined ? { skillFile } : {}), // sow-109: a skill's SKILL.md is kept with the draft
        // sow-482: the version the draft began from, never advanced by a save, so a draft that is behind stays behind.
        ...(this._base ? { base: this._base } : {}),
      });
      this._pendingAuthorTarget = authorTarget ?? this._pendingAuthorTarget;
      this._setChip(`${CHECK} Draft saved`, 'ok');
      // A pending rename is a big deal — say so in the top banner too (the bottom status line hides below the fold).
      if (res?.renamed) this._banner(`Draft saved with the pending permalink change: <b>${esc(res.renamed.from)}</b> becomes <b>${esc(res.renamed.to)}</b> when you publish. The old link will redirect.`);
      this.out(res?.renamed
        ? `<span class="tag ok">saved</span> Draft saved privately with the pending permalink change (${esc(res.renamed.from)} to ${esc(res.renamed.to)}); the rename happens when you publish.`
        : '<span class="tag ok">saved</span> Draft saved privately. Open <b>Drafts</b> to review or publish it.');
      this.emit('gbti-draft-saved', res);
    } catch (err) {
      this._setChip('');
      const h = failHint(err); // SOW-072 P3: consistent failure copy + upgrade pointer across every composer
      this.out(esc(h.upgrade ? `${h.text} Upgrade at gbti.network/membership.` : h.text), 'danger');
    } finally {
      restore();
    }
  }
};
