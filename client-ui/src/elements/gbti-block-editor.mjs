// SOW-062 Phase 4: the in-house block body editor. Replaces the single Markdown textarea with typed, reorderable
// blocks (paragraph, heading, code, quote, list, image, embed, and the members-only divider). The on-disk format
// stays Markdown: `value` parses Markdown -> blocks (the setter) and serializes blocks -> Markdown (the getter), so
// the host (gbti-content-editor) reads `.value` exactly like the old textarea, and the SOW-016 marker round-trips.
import { GbtiElement, define, esc } from '../base.mjs';
import { parseBlocks, serializeBlocks, BLOCK_TYPES, emptyBlock } from '../markdown-blocks.mjs';

const TYPE_LABEL = {
  paragraph: 'Paragraph', heading: 'Heading', code: 'Code', quote: 'Quote',
  list: 'List', image: 'Image', embed: 'Embed', members: 'Members-only',
};

const CSS = `
  :host { display:block; }
  .be-blk { border:1px solid var(--line); border-radius:10px; margin:0 0 10px; background:var(--panel, transparent); }
  .be-blk.be-members { border-color:var(--accent); border-style:dashed; }
  .be-blk-h { display:flex; justify-content:flex-end; gap:6px; padding:6px 8px; border-bottom:1px solid var(--line); }
  .be-blk-h select { font:inherit; font-size:12px; padding:3px 6px; border:1px solid var(--line); border-radius:6px; background:var(--paper, transparent); color:var(--fg); }
  .be-mv { border:1px solid var(--line); background:var(--paper, transparent); border-radius:6px; width:26px; height:26px; cursor:pointer; color:var(--muted); font-size:13px; line-height:1; }
  .be-mv:hover { color:var(--accent); border-color:var(--accent); }
  .be-body { padding:10px; }
  .be-body textarea, .be-body input { width:100%; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:6px; padding:7px 9px; box-sizing:border-box; }
  .be-body textarea { min-height:74px; resize:vertical; }
  textarea.be-code { font-family:var(--font-mono, ui-monospace, monospace); font-size:13px; }
  .be-lang { margin-bottom:6px; }
  .be-row { display:flex; gap:8px; }
  .be-row input { flex:1; }
  .be-ck { display:flex; gap:6px; align-items:center; font-size:13px; color:var(--muted); margin-bottom:6px; }
  .be-ck input { width:auto; }
  .be-members { font-weight:600; color:var(--accent); font-size:13px; }
  .be-add button { width:100%; border:1px dashed var(--line); background:transparent; border-radius:8px; padding:9px 14px; cursor:pointer; color:var(--muted); font:inherit; font-weight:600; }
  .be-add button:hover { border-color:var(--accent); color:var(--accent); }
  .be-imgup { display:flex; align-items:center; gap:10px; margin-top:8px; }
  .be-imgpick { border:1px solid var(--line); background:var(--paper, transparent); border-radius:7px; padding:6px 12px; cursor:pointer; font:inherit; font-size:13px; color:var(--fg); }
  .be-imgpick:hover { border-color:var(--accent); color:var(--accent); }
  .be-imgst { font-size:12px; color:var(--muted); }
`;

class GbtiBlockEditor extends GbtiElement {
  set value(md) { this._blocks = parseBlocks(md); if (this.isConnected) this._render(); }
  get value() { return serializeBlocks(this._blocks || []); }

  connectedCallback() {
    if (!this._blocks) this._blocks = [];
    super.connectedCallback?.();
    this._render();
  }

  _render() {
    const blocks = this._blocks || [];
    const body = blocks.map((b, i) => this._blockHtml(b, i)).join('');
    this.set(this.css(CSS) + `<div class="be">${body}<div class="be-add"><button type="button" data-add>+ Add block</button></div></div>`);
    this._wire();
  }

  _blockHtml(b, i) {
    const types = BLOCK_TYPES.map((t) => `<option value="${t}" ${t === b.type ? 'selected' : ''}>${TYPE_LABEL[t]}</option>`).join('');
    const head = `<div class="be-blk-h"><select data-type data-i="${i}" title="Block type">${types}</select>`
      + `<button type="button" class="be-mv" data-up data-i="${i}" title="Move up" aria-label="Move up">&#8593;</button>`
      + `<button type="button" class="be-mv" data-down data-i="${i}" title="Move down" aria-label="Move down">&#8595;</button>`
      + `<button type="button" class="be-mv" data-del data-i="${i}" title="Delete" aria-label="Delete block">&#215;</button></div>`;
    return `<div class="be-blk be-${esc(b.type)}" data-i="${i}">${head}<div class="be-body">${this._bodyHtml(b, i)}</div></div>`;
  }

  _bodyHtml(b, i) {
    switch (b.type) {
      case 'members':
        return `<div class="be-members">Members-only divider &mdash; everything BELOW this block is paid-only (SOW-016).</div>`;
      case 'heading':
        return `<div class="be-row"><select data-f="level" data-i="${i}" style="flex:none;width:64px">${[1, 2, 3].map((l) => `<option value="${l}" ${b.level === l ? 'selected' : ''}>H${l}</option>`).join('')}</select><input data-f="text" data-i="${i}" value="${esc(b.text || '')}" placeholder="Heading" /></div>`;
      case 'code':
        return `<input class="be-lang" data-f="lang" data-i="${i}" value="${esc(b.lang || '')}" placeholder="language (optional)" /><textarea class="be-code" data-f="code" data-i="${i}" placeholder="code">${esc(b.code || '')}</textarea>`;
      case 'list':
        return `<label class="be-ck"><input type="checkbox" data-f="ordered" data-i="${i}" ${b.ordered ? 'checked' : ''} /> numbered list</label><textarea data-f="items" data-i="${i}" placeholder="one item per line">${esc((b.items || []).join('\n'))}</textarea>`;
      case 'image':
        return `<div class="be-row"><input data-f="url" data-i="${i}" value="${esc(b.url || '')}" placeholder="image URL or repo path" /><input data-f="alt" data-i="${i}" value="${esc(b.alt || '')}" placeholder="alt text" /></div>`
          + `<div class="be-imgup"><input type="file" accept="image/*" hidden data-imgfile data-i="${i}" /><button type="button" class="be-imgpick" data-imgpick data-i="${i}">Upload an image</button><span class="be-imgst" data-imgst data-i="${i}"></span></div>`;
      case 'embed':
        return `<input data-f="url" data-i="${i}" value="${esc(b.url || '')}" placeholder="YouTube / Vimeo URL" />`;
      case 'quote':
        return `<textarea data-f="text" data-i="${i}" placeholder="Quote">${esc(b.text || '')}</textarea>`;
      case 'paragraph':
      default:
        return `<textarea data-f="text" data-i="${i}" placeholder="Write...">${esc(b.text || '')}</textarea>`;
    }
  }

  _wire() {
    // Live field edits: update the model in place WITHOUT re-render (so the caret/focus is preserved).
    this.$$('[data-f]').forEach((el) => {
      const onEdit = () => {
        const b = this._blocks[Number(el.dataset.i)];
        if (!b) return;
        const f = el.dataset.f;
        if (f === 'ordered') b.ordered = el.checked;
        else if (f === 'level') b.level = Number(el.value);
        else if (f === 'items') b.items = el.value.split('\n');
        else b[f] = el.value;
        this.emit('block-change');
      };
      el.addEventListener('input', onEdit);
      el.addEventListener('change', onEdit);
    });
    // Structural changes re-render.
    this.$$('[data-type]').forEach((el) => el.addEventListener('change', () => {
      const i = Number(el.dataset.i);
      const cur = this._blocks[i];
      const next = emptyBlock(el.value);
      if ('text' in next && cur && cur.text != null) next.text = cur.text; // carry text across compatible types
      this._blocks[i] = next;
      this._render();
      this.emit('block-change');
    }));
    this.$$('[data-up]').forEach((el) => el.addEventListener('click', () => this._move(Number(el.dataset.i), -1)));
    this.$$('[data-down]').forEach((el) => el.addEventListener('click', () => this._move(Number(el.dataset.i), 1)));
    this.$$('[data-del]').forEach((el) => el.addEventListener('click', () => {
      this._blocks.splice(Number(el.dataset.i), 1);
      this._render();
      this.emit('block-change');
    }));
    this.$('[data-add]')?.addEventListener('click', () => {
      this._blocks.push(emptyBlock('paragraph'));
      this._render();
      this.emit('block-change');
    });
    // SOW-062 P4: direct image upload inside an image block (pick a file -> stage it -> set the block url).
    this.$$('[data-imgpick]').forEach((el) => {
      const i = Number(el.dataset.i);
      const fileEl = this.$(`[data-imgfile][data-i="${i}"]`);
      el.addEventListener('click', () => fileEl?.click());
      fileEl?.addEventListener('change', (e) => this._uploadImage(e.target.files?.[0], i));
    });
  }

  async _uploadImage(file, i) {
    const b = this._blocks[i];
    if (!file || !b || !this.client?.stageImage) return;
    const st = this.$(`[data-imgst][data-i="${i}"]`);
    if (st) st.textContent = 'Uploading...';
    try {
      const dataBase64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1] || '');
        r.onerror = () => rej(new Error('read failed'));
        r.readAsDataURL(file);
      });
      const out = await this.client.stageImage({ filename: file.name, dataBase64 });
      b.url = out.path;
      if (!b.alt) b.alt = file.name.replace(/\.[^.]+$/, '');
      this._render();
      this.emit('block-change');
    } catch {
      if (st) st.textContent = 'Upload failed';
    }
  }

  _move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= this._blocks.length) return;
    const [b] = this._blocks.splice(i, 1);
    this._blocks.splice(j, 0, b);
    this._render();
    this.emit('block-change');
  }
}

define('gbti-block-editor', GbtiBlockEditor);
export { GbtiBlockEditor };
