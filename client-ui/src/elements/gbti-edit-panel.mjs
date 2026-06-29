// <gbti-edit-panel> (SOW-006 v2): the IN-PLACE inline editor. The extension content script mounts this on a
// live content page that carries the inert editing hooks (data-gbti-* + data-gbti-region="title|body"). It
// shows a floating "Edit" affordance; in edit mode it makes the page's own title region editable in place and
// swaps the rendered body region for a markdown textarea (seeded from the source the client loads), then a
// floating bar publishes the change as a PR through the unchanged SOW-005 gate. Only the folder owner sees it.
//
// It edits the HOST PAGE's light DOM (the real page) on purpose; its own Shadow DOM holds only the floating
// chrome. The merge into the full frontmatter uses the pure inline.mjs helpers.

import { GbtiElement, define, getIdentity, esc } from '../base.mjs';
import { submitAck } from '../workspace-core.mjs'; // SOW-072 P2: the one consistent submit acknowledgement
import { readHooks, canEditInPlace, toPublishPayload } from '../inline.mjs';

class GbtiEditPanel extends GbtiElement {
  constructor() {
    super();
    this.item = null;
    this.editing = false;
    this.original = null; // { titleText, bodyHtml } to restore on cancel
    this.membership = 'unknown'; // SOW-011: fetched on enter(); a non-paid member sees the upgrade label
  }

  hooks() {
    // hooks come from this element's own data-* (set by the content script) or a marked region on the page.
    const fromSelf = readHooks(this.dataset || {});
    if (fromSelf) return fromSelf;
    const marked = typeof document !== 'undefined' ? document.querySelector('[data-gbti-path]') : null;
    return marked ? readHooks(marked.dataset) : null;
  }
  titleEl() {
    return typeof document !== 'undefined' ? document.querySelector(this.getAttribute('title-selector') || '[data-gbti-region="title"]') : null;
  }
  bodyEl() {
    return typeof document !== 'undefined' ? document.querySelector(this.getAttribute('body-selector') || '[data-gbti-region="body"]') : null;
  }

  async render() {
    if (!this.client) return;
    const hooks = this.hooks();
    const id = await getIdentity();
    if (!hooks || !canEditInPlace(hooks, id)) {
      this.set(''); // nothing to offer on a page the member does not own
      return;
    }
    // SOW-011: a non-paid member may edit in place, but publishing is paid-only. Reflect that on the bar so
    // they know up front; the publish action is gated server-side regardless. 'unknown' shows the normal label.
    const blocked = this.membership !== 'paid' && this.membership !== 'unknown';
    const editingBar = blocked
      ? `<span class="muted" id="msg">Membership required to publish</span><button id="save" title="Publishing requires a paid membership">Upgrade to publish</button><button class="ghost" id="cancel">Cancel</button>`
      : `<span class="muted" id="msg">Editing in place</span><button id="save">Publish</button><button class="ghost" id="cancel">Cancel</button>`;
    this.set(
      this.css(`
        .bar { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display:flex; gap:8px; align-items:center;
               background: var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); border:1px solid var(--line); border-radius: 999px; padding: 8px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
        .bar .muted { font-size: 13px; }
      `) +
        `<div class="bar">
           ${this.editing
             ? editingBar
             : `<span class="muted">You own this</span><button id="edit">Edit this page</button>`}
         </div>`,
    );
    if (this.editing) {
      this.on('#save', 'click', () => this.save());
      this.on('#cancel', 'click', () => this.cancel());
    } else {
      this.on('#edit', 'click', () => this.enter(hooks));
    }
  }

  async enter(hooks) {
    // SOW-011: learn whether this member may publish, so the bar shows the upgrade label for a trial member.
    try {
      this.membership = (await this.client.status())?.membership ?? 'unknown';
    } catch {
      this.membership = 'unknown';
    }
    try {
      this.item = await this.client.getContentItem({ path: hooks.path });
    } catch (err) {
      this.flash(err.message, true);
      return;
    }
    const title = this.titleEl();
    const body = this.bodyEl();
    this.original = { titleText: title?.textContent, bodyHtml: body?.innerHTML };
    if (title) {
      title.setAttribute('contenteditable', 'true');
      title.dataset.gbtiEditing = 'true';
      title.focus?.();
    }
    if (body) {
      const ta = document.createElement('textarea');
      ta.value = this.item.body || '';
      ta.setAttribute('data-gbti-body-input', 'true');
      ta.style.cssText = 'width:100%;min-height:320px;font-family:ui-monospace,monospace;font-size:14px;padding:12px;';
      body.replaceChildren(ta);
    }
    this.editing = true;
    this.render();
  }

  collect() {
    const title = this.titleEl();
    const ta = typeof document !== 'undefined' ? document.querySelector('[data-gbti-body-input]') : null;
    return {
      title: title ? title.textContent.trim() : undefined,
      body: ta ? ta.value : undefined,
    };
  }

  async save() {
    this.flash('Publishing…');
    try {
      const edits = this.collect();
      const payload = toPublishPayload(this.item, edits);
      const res = await this.client.publish(payload);
      this.teardown();
      this.editing = false;
      this.render();
      this.flash(submitAck({ prNumber: res.prNumber, autoMerge: true })); // SOW-072 P2: consistent ack
      this.emit('gbti-published', res);
    } catch (err) {
      this.flash(err.message, true);
    }
  }

  cancel() {
    this.teardown(true);
    this.editing = false;
    this.render();
  }

  /** Remove the in-place editing affordances; optionally restore the original rendered regions. */
  teardown(restore = false) {
    const title = this.titleEl();
    if (title) {
      title.removeAttribute('contenteditable');
      delete title.dataset.gbtiEditing;
      if (restore && this.original?.titleText != null) title.textContent = this.original.titleText;
    }
    const body = this.bodyEl();
    if (body && restore && this.original?.bodyHtml != null) body.innerHTML = this.original.bodyHtml;
  }

  flash(msg, bad = false) {
    const el = this.$('#msg') || this.$('.muted');
    if (el) {
      el.textContent = msg;
      el.className = bad ? 'danger' : 'muted';
    }
  }
}

define('gbti-edit-panel', GbtiEditPanel);
export { GbtiEditPanel };
