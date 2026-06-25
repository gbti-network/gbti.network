"use strict";
(() => {
  // client-ui/src/tokens.mjs
  var TOKENS = `
:host {
  --bg: #faf9f8; --panel: #ffffff;
  --brand: #1f9e5f; --brand-dark: #178a51; --accent: #0f6f40;
  --text: #24222a; --fg: #24222a; --muted: #57545e;
  --line: #e7e4e0; --hover: #f1f1f1; --danger: #c0392b;
  --radius: 12px;
  --font-body: "Hanken Grotesk", system-ui, -apple-system, sans-serif;
  --font-display: "Baloo Da 2", "Hanken Grotesk", system-ui, sans-serif;
}
:host-context([data-theme="dark"]) {
  --bg: #1c1a21; --panel: #2d2a34;
  --brand: #1f9e5f; --brand-dark: #46c089; --accent: #5fd49a;
  --text: #f3f2f0; --fg: #f3f2f0; --muted: rgba(243,242,240,.72);
  --line: rgba(255,255,255,.12); --hover: #34313c; --danger: #e06c6c;
}
`;
  var BASE_CSS = `
:host { display: block; color: var(--text); font: 15px/1.5 var(--font-body); box-sizing: border-box; }
*, *::before, *::after { box-sizing: border-box; }
h1, h2, h3 { font-family: var(--font-display); margin: 0 0 .5em; }
h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); }
a { color: var(--accent); }
.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; }
label { display: block; font-size: 13px; color: var(--muted); margin: 10px 0 4px; }
input, select, textarea {
  width: 100%; padding: 9px 11px; background: var(--bg); border: 1px solid var(--line);
  border-radius: 8px; color: var(--text); font: inherit;
}
input:focus, select:focus, textarea:focus { outline: none; border-color: var(--brand); }
textarea { min-height: 120px; resize: vertical; font-family: ui-monospace, monospace; }
button {
  background: var(--brand); color: #08231a; border: 0; border-radius: 8px;
  padding: 9px 16px; font: inherit; font-weight: 600; cursor: pointer;
}
button:hover { background: var(--brand-dark); }
button.ghost { background: transparent; color: var(--muted); border: 1px solid var(--line); }
button[disabled] { opacity: .5; cursor: default; }
.muted { color: var(--muted); }
.danger { color: var(--danger); }
.row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
.tag { display: inline-block; padding: 2px 8px; border-radius: 999px; background: var(--hover); font-size: 12px; color: var(--muted); }
.tag.ok { background: rgba(31,158,95,.14); color: var(--accent); }
.tag.bad { background: rgba(224,108,108,.16); color: var(--danger); }
ul.list { list-style: none; margin: 0; padding: 0; }
ul.list li { padding: 8px 0; border-bottom: 1px solid var(--line); }
`;

  // client-ui/src/base.mjs
  var HAS_DOM = typeof HTMLElement !== "undefined";
  var CLIENT = null;
  var IDENTITY = null;
  var SUBSCRIBERS = /* @__PURE__ */ new Set();
  function setClient(client2) {
    CLIENT = client2;
    IDENTITY = null;
    for (const fn of SUBSCRIBERS) {
      try {
        fn();
      } catch {
      }
    }
  }
  function getClient() {
    return CLIENT;
  }
  async function getIdentity() {
    if (IDENTITY) return IDENTITY;
    if (!CLIENT) return null;
    try {
      const s = await CLIENT.status();
      IDENTITY = s?.identity ?? null;
      return IDENTITY;
    } catch {
      return null;
    }
  }
  var Base = HAS_DOM ? HTMLElement : class {
  };
  var GbtiElement = class extends Base {
    constructor() {
      super();
      if (HAS_DOM) this.root = this.attachShadow({ mode: "open" });
      this._onClient = () => this.isConnected && this.render?.();
    }
    connectedCallback() {
      SUBSCRIBERS.add(this._onClient);
      this.render?.();
    }
    disconnectedCallback() {
      SUBSCRIBERS.delete(this._onClient);
    }
    get client() {
      return getClient();
    }
    /** Wrap markup with the tokens + base CSS (+ per-component extra) for the Shadow DOM. */
    css(extra = "") {
      return `<style>${TOKENS}${BASE_CSS}${extra}</style>`;
    }
    set(markup) {
      if (this.root) this.root.innerHTML = markup;
    }
    $(sel) {
      return this.root?.querySelector(sel) ?? null;
    }
    $$(sel) {
      return this.root ? [...this.root.querySelectorAll(sel)] : [];
    }
    on(sel, event, handler) {
      const el = this.$(sel);
      if (el) el.addEventListener(event, handler);
    }
    emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
    }
  };
  function define(tag, ctor) {
    const ce = HAS_DOM ? globalThis.customElements : null;
    if (!ce || ce.get(tag)) return;
    ce.define(tag, ctor);
  }
  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }

  // client-ui/src/elements/gbti-auth.mjs
  var GbtiAuth = class extends GbtiElement {
    async render() {
      if (!this.client) {
        this.set(this.css() + `<div class="panel muted">Connecting to the local client…</div>`);
        return;
      }
      let status2 = null;
      try {
        status2 = await this.client.status();
      } catch {
      }
      const id = status2?.identity ?? null;
      const role = status2?.role ?? "member";
      const authed = Boolean(status2?.authenticated);
      if (id && authed) {
        this.set(
          this.css() + `<div class="panel row" style="justify-content:space-between">
             <div>Signed in as <strong>@${esc(id.login)}</strong> ${role !== "member" ? `<span class="tag ok">${esc(role)}</span>` : ""}</div>
             <button class="ghost" id="out">Sign out</button>
           </div>`
        );
        this.on("#out", "click", () => this.emit("gbti-signout"));
        return;
      }
      const canLogin = typeof this.client.login === "function";
      this.set(
        this.css() + `<div class="panel">
           <h2>Sign in</h2>
           <p class="muted">Authorize with GitHub to author + publish your content as pull requests.</p>
           ${canLogin ? `<button id="in">Sign in with GitHub</button>` : `<p class="muted">Run <code>gbti login</code> in your terminal to connect this client.</p>`}
           <div id="prompt" class="muted" style="margin-top:10px"></div>
         </div>`
      );
      if (canLogin) {
        this.on("#in", "click", async () => {
          const slot = this.$("#prompt");
          try {
            await this.client.login(({ userCode, verificationUri }) => {
              slot.innerHTML = `Enter code <strong>${esc(userCode)}</strong> at <a href="${esc(verificationUri)}" target="_blank" rel="noopener">${esc(verificationUri)}</a>`;
            });
            getIdentity();
            this.render();
            this.emit("gbti-signin");
          } catch (err) {
            slot.innerHTML = `<span class="danger">${esc(err.message || "sign-in failed")}</span>`;
          }
        });
      }
    }
  };
  define("gbti-auth", GbtiAuth);

  // client-ui/src/markdown-blocks.mjs
  var MEMBERS_MARKER = "<!-- members-only -->";
  var BLOCK_TYPES = ["paragraph", "heading", "code", "quote", "list", "image", "embed", "members"];
  var isMarker = (l) => l.trim() === MEMBERS_MARKER;
  var isFence = (l) => /^```/.test(l);
  var isHeading = (l) => /^#{1,6}\s+/.test(l);
  var isQuote = (l) => /^>\s?/.test(l);
  var isListItem = (l) => /^\s*([-*]|\d+\.)\s+/.test(l);
  var isImageOnly = (l) => /^!\[[^\]]*\]\([^)]*\)\s*$/.test(l);
  var isBareUrl = (l) => /^https?:\/\/\S+$/.test(l.trim());
  function serializeBlocks(blocks) {
    return (Array.isArray(blocks) ? blocks : []).map(serializeBlock).join("\n\n");
  }
  function serializeBlock(b) {
    if (!b || typeof b !== "object") return "";
    switch (b.type) {
      case "members":
        return MEMBERS_MARKER;
      case "heading":
        return `${"#".repeat(Math.min(6, Math.max(1, b.level || 2)))} ${b.text ?? ""}`;
      case "code":
        return "```" + (b.lang ?? "") + "\n" + (b.code ?? "") + "\n```";
      case "quote":
        return String(b.text ?? "").split("\n").map((l) => l ? `> ${l}` : ">").join("\n");
      case "list": {
        const items = Array.isArray(b.items) ? b.items : String(b.text ?? "").split("\n").filter((x) => x !== "");
        return items.map((it, i) => (b.ordered ? `${i + 1}. ` : "- ") + it).join("\n");
      }
      case "image":
        return `![${b.alt ?? ""}](${b.url ?? ""})`;
      case "embed":
        return String(b.url ?? "");
      case "paragraph":
      default:
        return String(b.text ?? "");
    }
  }
  function parseBlocks(md) {
    const lines = String(md ?? "").replace(/\r\n/g, "\n").split("\n");
    const blocks = [];
    const n = lines.length;
    let i = 0;
    while (i < n) {
      const line = lines[i];
      if (line.trim() === "") {
        i++;
        continue;
      }
      if (isMarker(line)) {
        blocks.push({ type: "members" });
        i++;
        continue;
      }
      if (isFence(line)) {
        const lang = line.replace(/^```/, "").trim();
        const code = [];
        i++;
        while (i < n && !/^```\s*$/.test(lines[i])) {
          code.push(lines[i]);
          i++;
        }
        i++;
        blocks.push({ type: "code", lang, code: code.join("\n") });
        continue;
      }
      let m = line.match(/^(#{1,6})\s+(.*)$/);
      if (m) {
        blocks.push({ type: "heading", level: m[1].length, text: m[2] });
        i++;
        continue;
      }
      if (isQuote(line)) {
        const q = [];
        while (i < n && isQuote(lines[i])) {
          q.push(lines[i].replace(/^>\s?/, ""));
          i++;
        }
        blocks.push({ type: "quote", text: q.join("\n") });
        continue;
      }
      if (isListItem(line)) {
        const ordered = /^\s*\d+\.\s+/.test(line);
        const items = [];
        while (i < n && isListItem(lines[i])) {
          items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ""));
          i++;
        }
        blocks.push({ type: "list", ordered, items });
        continue;
      }
      m = line.match(/^!\[([^\]]*)\]\(([^)]*)\)\s*$/);
      if (m) {
        blocks.push({ type: "image", alt: m[1], url: m[2] });
        i++;
        continue;
      }
      if (isBareUrl(line)) {
        blocks.push({ type: "embed", url: line.trim() });
        i++;
        continue;
      }
      const para = [];
      while (i < n) {
        const l = lines[i];
        if (l.trim() === "" || isMarker(l) || isFence(l) || isHeading(l) || isQuote(l) || isListItem(l) || isImageOnly(l) || isBareUrl(l)) break;
        para.push(l);
        i++;
      }
      if (para.length) blocks.push({ type: "paragraph", text: para.join("\n") });
      else i++;
    }
    return blocks;
  }
  function emptyBlock(type) {
    switch (type) {
      case "heading":
        return { type: "heading", level: 2, text: "" };
      case "code":
        return { type: "code", lang: "", code: "" };
      case "quote":
        return { type: "quote", text: "" };
      case "list":
        return { type: "list", ordered: false, items: [""] };
      case "image":
        return { type: "image", alt: "", url: "" };
      case "embed":
        return { type: "embed", url: "" };
      case "members":
        return { type: "members" };
      default:
        return { type: "paragraph", text: "" };
    }
  }

  // client-ui/src/elements/gbti-block-editor.mjs
  var TYPE_LABEL = {
    paragraph: "Paragraph",
    heading: "Heading",
    code: "Code",
    quote: "Quote",
    list: "List",
    image: "Image",
    embed: "Embed",
    members: "Members-only"
  };
  var CSS = `
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
  var GbtiBlockEditor = class extends GbtiElement {
    set value(md) {
      this._blocks = parseBlocks(md);
      if (this.isConnected) this._render();
    }
    get value() {
      return serializeBlocks(this._blocks || []);
    }
    connectedCallback() {
      if (!this._blocks) this._blocks = [];
      super.connectedCallback?.();
      this._render();
    }
    _render() {
      const blocks = this._blocks || [];
      const body = blocks.map((b, i) => this._blockHtml(b, i)).join("");
      this.set(this.css(CSS) + `<div class="be">${body}<div class="be-add"><button type="button" data-add>+ Add block</button></div></div>`);
      this._wire();
    }
    _blockHtml(b, i) {
      const types2 = BLOCK_TYPES.map((t) => `<option value="${t}" ${t === b.type ? "selected" : ""}>${TYPE_LABEL[t]}</option>`).join("");
      const head = `<div class="be-blk-h"><select data-type data-i="${i}" title="Block type">${types2}</select><button type="button" class="be-mv" data-up data-i="${i}" title="Move up">&#8593;</button><button type="button" class="be-mv" data-down data-i="${i}" title="Move down">&#8595;</button><button type="button" class="be-mv" data-del data-i="${i}" title="Delete">&#215;</button></div>`;
      return `<div class="be-blk be-${esc(b.type)}" data-i="${i}">${head}<div class="be-body">${this._bodyHtml(b, i)}</div></div>`;
    }
    _bodyHtml(b, i) {
      switch (b.type) {
        case "members":
          return `<div class="be-members">Members-only divider &mdash; everything BELOW this block is paid-only (SOW-016).</div>`;
        case "heading":
          return `<div class="be-row"><select data-f="level" data-i="${i}" style="flex:none;width:64px">${[1, 2, 3].map((l) => `<option value="${l}" ${b.level === l ? "selected" : ""}>H${l}</option>`).join("")}</select><input data-f="text" data-i="${i}" value="${esc(b.text || "")}" placeholder="Heading" /></div>`;
        case "code":
          return `<input class="be-lang" data-f="lang" data-i="${i}" value="${esc(b.lang || "")}" placeholder="language (optional)" /><textarea class="be-code" data-f="code" data-i="${i}" placeholder="code">${esc(b.code || "")}</textarea>`;
        case "list":
          return `<label class="be-ck"><input type="checkbox" data-f="ordered" data-i="${i}" ${b.ordered ? "checked" : ""} /> numbered list</label><textarea data-f="items" data-i="${i}" placeholder="one item per line">${esc((b.items || []).join("\n"))}</textarea>`;
        case "image":
          return `<div class="be-row"><input data-f="url" data-i="${i}" value="${esc(b.url || "")}" placeholder="image URL or repo path" /><input data-f="alt" data-i="${i}" value="${esc(b.alt || "")}" placeholder="alt text" /></div><div class="be-imgup"><input type="file" accept="image/*" hidden data-imgfile data-i="${i}" /><button type="button" class="be-imgpick" data-imgpick data-i="${i}">Upload an image</button><span class="be-imgst" data-imgst data-i="${i}"></span></div>`;
        case "embed":
          return `<input data-f="url" data-i="${i}" value="${esc(b.url || "")}" placeholder="YouTube / Vimeo URL" />`;
        case "quote":
          return `<textarea data-f="text" data-i="${i}" placeholder="Quote">${esc(b.text || "")}</textarea>`;
        case "paragraph":
        default:
          return `<textarea data-f="text" data-i="${i}" placeholder="Write...">${esc(b.text || "")}</textarea>`;
      }
    }
    _wire() {
      this.$$("[data-f]").forEach((el) => {
        const onEdit = () => {
          const b = this._blocks[Number(el.dataset.i)];
          if (!b) return;
          const f = el.dataset.f;
          if (f === "ordered") b.ordered = el.checked;
          else if (f === "level") b.level = Number(el.value);
          else if (f === "items") b.items = el.value.split("\n");
          else b[f] = el.value;
          this.emit("block-change");
        };
        el.addEventListener("input", onEdit);
        el.addEventListener("change", onEdit);
      });
      this.$$("[data-type]").forEach((el) => el.addEventListener("change", () => {
        const i = Number(el.dataset.i);
        const cur = this._blocks[i];
        const next = emptyBlock(el.value);
        if ("text" in next && cur && cur.text != null) next.text = cur.text;
        this._blocks[i] = next;
        this._render();
        this.emit("block-change");
      }));
      this.$$("[data-up]").forEach((el) => el.addEventListener("click", () => this._move(Number(el.dataset.i), -1)));
      this.$$("[data-down]").forEach((el) => el.addEventListener("click", () => this._move(Number(el.dataset.i), 1)));
      this.$$("[data-del]").forEach((el) => el.addEventListener("click", () => {
        this._blocks.splice(Number(el.dataset.i), 1);
        this._render();
        this.emit("block-change");
      }));
      this.$("[data-add]")?.addEventListener("click", () => {
        this._blocks.push(emptyBlock("paragraph"));
        this._render();
        this.emit("block-change");
      });
      this.$$("[data-imgpick]").forEach((el) => {
        const i = Number(el.dataset.i);
        const fileEl = this.$(`[data-imgfile][data-i="${i}"]`);
        el.addEventListener("click", () => fileEl?.click());
        fileEl?.addEventListener("change", (e) => this._uploadImage(e.target.files?.[0], i));
      });
    }
    async _uploadImage(file, i) {
      const b = this._blocks[i];
      if (!file || !b || !this.client?.stageImage) return;
      const st = this.$(`[data-imgst][data-i="${i}"]`);
      if (st) st.textContent = "Uploading...";
      try {
        const dataBase64 = await new Promise((res, rej) => {
          const r = new FileReader();
          r.onload = () => res(String(r.result).split(",")[1] || "");
          r.onerror = () => rej(new Error("read failed"));
          r.readAsDataURL(file);
        });
        const out = await this.client.stageImage({ filename: file.name, dataBase64 });
        b.url = out.path;
        if (!b.alt) b.alt = file.name.replace(/\.[^.]+$/, "");
        this._render();
        this.emit("block-change");
      } catch {
        if (st) st.textContent = "Upload failed";
      }
    }
    _move(i, dir) {
      const j = i + dir;
      if (j < 0 || j >= this._blocks.length) return;
      const [b] = this._blocks.splice(i, 1);
      this._blocks.splice(j, 0, b);
      this._render();
      this.emit("block-change");
    }
  };
  define("gbti-block-editor", GbtiBlockEditor);

  // client-ui/src/form.mjs
  function coerceValue(kind, raw) {
    switch (kind) {
      case "boolean":
        return Boolean(raw);
      case "number": {
        const n = Number(raw);
        return Number.isFinite(n) ? n : void 0;
      }
      case "array":
        return String(raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      case "json": {
        const t = String(raw ?? "").trim();
        return t ? JSON.parse(t) : void 0;
      }
      default: {
        const t = String(raw ?? "").trim();
        return t === "" ? void 0 : t;
      }
    }
  }
  function gatherInput(fields, getRaw) {
    const input = {};
    for (const f of fields ?? []) {
      const raw = getRaw(f.key, f.kind);
      let val;
      try {
        val = coerceValue(f.kind, raw);
      } catch (err) {
        throw new Error(`field "${f.key}": ${err.message}`);
      }
      if (val === void 0) continue;
      if (Array.isArray(val) && val.length === 0) continue;
      input[f.key] = val;
    }
    return input;
  }

  // client-ui/src/assets.mjs
  var SITE = "https://gbti.network";
  function resolveAsset(thumb, site = SITE) {
    if (!thumb || typeof thumb !== "string") return null;
    if (/^https?:\/\//.test(thumb)) return thumb;
    if (/^\/\//.test(thumb)) return `https:${thumb}`;
    return `${site}${thumb.startsWith("/") ? "" : "/"}${thumb}`;
  }

  // client-ui/src/elements/gbti-content-editor.mjs
  var TYPES = ["post", "product", "prompt", "profile"];
  var HIDDEN_KEYS = /* @__PURE__ */ new Set(["delegation", "canonicalUrl"]);
  var RAIL_SECTIONS = [
    { name: "Publishing", keys: ["status", "visibility"] },
    { name: "Taxonomy", keys: ["categories", "tags"] },
    { name: "Pricing", keys: ["pricing", "pricingUrl"] },
    { name: "Links", keys: ["links"] },
    { name: "Media", keys: ["coverImage", "coverAlt", "image", "imageAlt", "alt", "video"] }
  ];
  var sectionFor = (key) => RAIL_SECTIONS.find((s) => s.keys.includes(key))?.name || "Details";
  var GbtiContentEditor = class extends GbtiElement {
    constructor() {
      super();
      this.type = this.getAttribute("type") || "post";
      this.fields = [];
      this.preset = null;
    }
    /** Seed the editor from an existing item (used by the inline editor + "edit" from My Content). */
    load(type, input, body) {
      this.type = type || this.type;
      this.preset = { input: input || {}, body: body || "" };
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
      let membership = "unknown";
      try {
        membership = (await this.client.status())?.membership ?? "unknown";
      } catch {
        membership = "unknown";
      }
      const blocked = membership !== "paid" && membership !== "unknown";
      const p = this.preset?.input ?? {};
      const getValPreset = (k) => this.presetStr(p[k]);
      const grouped = {};
      const hiddenFields = [];
      for (const f of this.fields) {
        if (HIDDEN_KEYS.has(f.key)) {
          hiddenFields.push(f);
          continue;
        }
        const sec = sectionFor(f.key);
        (grouped[sec] = grouped[sec] || []).push(f);
      }
      const order = ["Details", ...RAIL_SECTIONS.map((s) => s.name)];
      const sectionsHtml = order.filter((n) => grouped[n]?.length).map((n) => {
        const inner = grouped[n].map((f) => this.fieldHtml(f, p[f.key], this.fieldVisible(f, getValPreset))).join("");
        return `<details open class="sec"><summary>${esc(n)}</summary><div class="grid">${inner}</div></details>`;
      }).join("");
      const hiddenHtml = hiddenFields.map((f) => this.fieldHtml(f, p[f.key], false)).join("");
      this.set(
        this.css(`
        .editor { display:grid; grid-template-columns:minmax(0,1fr) 320px; gap:22px; align-items:start; }
        @media (max-width:860px) { .editor { grid-template-columns:1fr; } }
        .doc { min-width:0; }
        .doc .body-l { margin-top:0; }
        #body { display:block; min-height:30vh; }
        .grid { display:grid; gap:2px; }
        .actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
        #out { margin-top:12px; }
        .preview { background:#201e26; border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
        .notice { background:#2a2330; border:1px solid var(--accent); border-radius:8px; padding:10px 14px; margin-bottom:12px; }
        .notice a { color: var(--accent); }
        .rail { border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:4px 14px 12px; position:sticky; top:8px; max-height:calc(100vh - 16px); overflow-y:auto; }
        @media (max-width:860px) { .rail { position:static; max-height:none; } }
        .rail-h { font-family:var(--font-display, inherit); font-weight:700; font-size:15px; padding:11px 0 2px; }
        .rail details.sec { border-top:1px solid var(--line); }
        .rail summary { cursor:pointer; list-style:none; font-weight:600; font-size:13px; padding:10px 0; color:var(--fg); display:flex; justify-content:space-between; align-items:center; }
        .rail summary::-webkit-details-marker { display:none; }
        .rail summary::after { content:'⌄'; color:var(--muted); font-size:12px; }
        .rail details[open] summary::after { content:'⌃'; }
        .rail .grid { padding-bottom:10px; }
        .cover-frames { display:flex; gap:12px; align-items:flex-end; margin:6px 0 10px; }
        .cover-frames.empty { display:none; }
        .cf { margin:0; }
        .cf img { display:block; background:var(--hover); border:1px solid var(--line); border-radius:8px; }
        .cf-43 img { width:116px; aspect-ratio:4/3; object-fit:cover; }
        .cf-hero img { width:184px; height:auto; max-height:150px; object-fit:contain; }
        .cf figcaption { font-size:11px; color:var(--muted); margin-top:4px; text-align:center; }
        .cover-actions { display:flex; gap:8px; }
      `) + `<div class="editor">
           <div class="doc">
             ${blocked ? `<div class="notice">Publishing requires a paid membership. You can write and stage your work now; it stays on your fork until you upgrade. <a href="https://gbti.network" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ""}
             <label class="body-l">Body</label>
             <gbti-block-editor id="body"></gbti-block-editor>
             <div class="actions">
               <button id="preview" class="ghost">Preview</button>
               <button id="validate" class="ghost">Validate</button>
               <button id="publish"${blocked ? ' title="Publishing requires a paid membership"' : ""}>${blocked ? "Membership required to publish" : "Publish (open PR)"}</button>
               <input type="file" id="img" accept="image/*" style="display:none" />
               <button id="imgbtn" class="ghost">Add image</button>
             </div>
             <div id="out" class="muted"></div>
           </div>
           <aside class="rail">
             <div class="rail-h">Document</div>
             <label>Type</label>
             <select id="type">${TYPES.map((t) => `<option ${t === this.type ? "selected" : ""}>${t}</option>`).join("")}</select>
             ${sectionsHtml}
             <div hidden>${hiddenHtml}</div>
           </aside>
         </div>`
      );
      this.on("#type", "change", (e) => {
        this.type = e.target.value;
        this.preset = null;
        this.render();
      });
      this.on("#preview", "click", () => this.doPreview());
      this.on("#validate", "click", () => this.doValidate());
      this.on("#publish", "click", () => this.doPublish());
      this.on("#imgbtn", "click", () => this.$("#img").click());
      this.on("#img", "change", (e) => this.doImage(e.target.files?.[0]));
      this.$$("[data-cover]").forEach((c) => {
        const file = c.querySelector("[data-cover-file]");
        c.querySelector("[data-cover-pick]")?.addEventListener("click", () => file?.click());
        file?.addEventListener("change", (e) => this.doCoverImage(e.target.files?.[0], c));
        c.querySelector("[data-cover-clear]")?.addEventListener("click", () => this.clearCover(c));
      });
      const be = this.$("#body");
      if (be) be.value = this.preset?.body ?? "";
      const deps = new Set(this.fields.filter((f) => f.showIf?.field).map((f) => f.showIf.field));
      for (const dep of deps) {
        const el = this.$(`[data-key="${dep}"]`);
        if (el) {
          el.addEventListener("input", () => this.syncConditional());
          el.addEventListener("change", () => this.syncConditional());
        }
      }
    }
    fieldHtml(f, value, visible = true) {
      const v = value == null ? "" : Array.isArray(value) ? value.join(", ") : typeof value === "object" ? JSON.stringify(value) : String(value);
      const label = `<label>${esc(f.label || f.key)}${f.required ? " *" : ""}</label>`;
      let control;
      if (f.kind === "image") {
        const url = v ? resolveAsset(v) : "";
        const has = !!url;
        return `<div class="field cover-field" data-fkey="${f.key}"${visible ? "" : " hidden"}>${label}
        <div class="cover" data-cover>
          <div class="cover-frames${has ? "" : " empty"}">
            <figure class="cf cf-43"><img data-cimg src="${esc(url)}" alt="" /><figcaption>4:3 card</figcaption></figure>
            <figure class="cf cf-hero"><img data-cimg src="${esc(url)}" alt="" /><figcaption>Hero (full)</figcaption></figure>
          </div>
          <input type="file" accept="image/*" hidden data-cover-file />
          <div class="cover-actions">
            <button type="button" class="ghost" data-cover-pick>${has ? "Replace image" : "Choose image"}</button>
            <button type="button" class="ghost" data-cover-clear${has ? "" : " hidden"}>Remove</button>
          </div>
          <input data-key="${f.key}" data-kind="image" type="hidden" value="${esc(v)}" />
        </div></div>`;
      }
      if (f.kind === "enum") {
        control = `<select data-key="${f.key}">${(f.options || []).map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
      } else if (f.kind === "boolean") {
        return `<div class="field" data-fkey="${f.key}"${visible ? "" : " hidden"}>` + label.replace("<label>", '<label style="display:flex;gap:8px;align-items:center">') + `<input type="checkbox" data-key="${f.key}" ${value ? "checked" : ""} style="width:auto" /></div>`;
      } else if (f.kind === "textarea" || f.kind === "json") {
        control = `<textarea data-key="${f.key}" data-kind="${f.kind}" placeholder="${esc(f.placeholder || "")}">${esc(v)}</textarea>`;
      } else {
        control = `<input data-key="${f.key}" data-kind="${f.kind}" value="${esc(v)}" placeholder="${esc(f.placeholder || "")}" />`;
      }
      return `<div class="field" data-fkey="${f.key}"${visible ? "" : " hidden"}>${label}${control}</div>`;
    }
    /** Format a value the way fieldHtml does, so showIf can read preset values before the DOM exists. */
    presetStr(value) {
      return value == null ? "" : Array.isArray(value) ? value.join(", ") : String(value);
    }
    /** Evaluate a field's `showIf` against a (key)=>string value reader. No showIf => always visible. */
    fieldVisible(f, getVal) {
      const s = f.showIf;
      if (!s) return true;
      return matchesShowIf(s, getVal(s.field));
    }
    /** Recompute conditional fields from the live DOM and toggle their wrappers. */
    syncConditional() {
      const getVal = (k) => {
        const el = this.$(`[data-key="${k}"]`);
        return el ? el.type === "checkbox" ? el.checked : el.value : "";
      };
      for (const f of this.fields) {
        if (!f.showIf) continue;
        const wrap = this.$(`.field[data-fkey="${f.key}"]`);
        if (wrap) wrap.hidden = !this.fieldVisible(f, getVal);
      }
    }
    /** Read raw value for a field key from the rendered inputs (DOM side of the pure gatherInput). */
    rawGetter() {
      return (key, kind) => {
        const el = this.$(`[data-key="${key}"]`);
        if (!el) return void 0;
        if (kind === "boolean") return el.checked;
        return el.value;
      };
    }
    gather() {
      const getVal = (k) => {
        const el = this.$(`[data-key="${k}"]`);
        return el ? el.type === "checkbox" ? el.checked : el.value : "";
      };
      const visible = this.fields.filter((f) => this.fieldVisible(f, getVal));
      return { type: this.type, input: gatherInput(visible, this.rawGetter()), body: this.$("#body")?.value ?? "" };
    }
    out(html, cls = "muted") {
      const o = this.$("#out");
      if (o) {
        o.className = cls;
        o.innerHTML = html;
      }
    }
    async doPreview() {
      try {
        const res = await this.client.preview({ body: this.$("#body").value });
        this.out(`<div class="preview">${res.html || ""}</div>`);
      } catch (err) {
        this.out(esc(err.message), "danger");
      }
    }
    async doValidate() {
      try {
        const { type, input, body } = this.gather();
        const res = await this.client.validateContent({ type, input, body });
        this.out(res.valid ? `<span class="tag ok">valid</span> ${esc(res.path || "")}` : `<span class="danger">${esc(res.error)}</span>`);
      } catch (err) {
        this.out(esc(err.message), "danger");
      }
    }
    async doPublish() {
      this.out("Publishing…");
      try {
        const { type, input, body } = this.gather();
        const res = await this.client.publish({ type, input, body });
        this.out(`<span class="tag ok">${res.updated ? "updated" : "opened"}</span> PR <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
        this.emit("gbti-published", res);
      } catch (err) {
        this.out(esc(err.message), "danger");
      }
    }
    async doImage(file) {
      if (!file) return;
      const dataBase64 = await fileToBase64(file);
      try {
        const res = await this.client.stageImage({ filename: file.name, dataBase64 });
        const imgField = this.fields.find((f) => f.kind === "image");
        const el = imgField && this.$(`[data-key="${imgField.key}"]`);
        const wrap = imgField && this.$(`.field[data-fkey="${imgField.key}"]`);
        if (el && !el.value && wrap && !wrap.hidden) {
          el.value = res.path;
          this.out(`Image staged into <code>${esc(imgField.label || imgField.key)}</code>: <code>${esc(res.path)}</code>`);
        } else {
          this.out(`Image staged: <code>${esc(res.path)}</code> (reference it in your body)`);
        }
      } catch (err) {
        this.out(esc(err.message), "danger");
      }
    }
    // SOW-062 P3: stage a picked cover image — update both framing previews from the file immediately, then stage it
    // and drop the returned repo path into the field's hidden input (gather() picks it up like any field).
    async doCoverImage(file, control) {
      if (!file || !control) return;
      const dataUrl = await fileToDataUrl(file);
      control.querySelectorAll("[data-cimg]").forEach((img) => {
        img.src = dataUrl;
      });
      control.querySelector(".cover-frames")?.classList.remove("empty");
      control.querySelector("[data-cover-clear]")?.removeAttribute("hidden");
      const pick = control.querySelector("[data-cover-pick]");
      if (pick) pick.textContent = "Replace image";
      try {
        const res = await this.client.stageImage({ filename: file.name, dataBase64: dataUrl.split(",")[1] || "" });
        const el = control.querySelector("[data-key]");
        if (el) el.value = res.path;
        this.out(`Cover image staged: <code>${esc(res.path)}</code>`);
      } catch (err) {
        this.out(esc(err.message), "danger");
      }
    }
    clearCover(control) {
      if (!control) return;
      const el = control.querySelector("[data-key]");
      if (el) el.value = "";
      control.querySelectorAll("[data-cimg]").forEach((img) => {
        img.removeAttribute("src");
      });
      control.querySelector(".cover-frames")?.classList.add("empty");
      control.querySelector("[data-cover-clear]")?.setAttribute("hidden", "");
      const pick = control.querySelector("[data-cover-pick]");
      if (pick) pick.textContent = "Choose image";
    }
  };
  function normTok(s) {
    return String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
  }
  function matchesShowIf(showIf, raw) {
    if (!showIf) return true;
    if (Array.isArray(showIf.includesModel)) {
      const models = showIf.includesModel.map(normTok).filter(Boolean);
      const parts = String(raw ?? "").split(",").map(normTok).filter(Boolean);
      return parts.some((p) => models.some((m) => p.includes(m)));
    }
    return true;
  }
  function fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] || "");
      r.onerror = () => reject(new Error("could not read file"));
      r.readAsDataURL(file);
    });
  }
  function fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(new Error("could not read file"));
      r.readAsDataURL(file);
    });
  }
  define("gbti-content-editor", GbtiContentEditor);

  // client-ui/src/elements/gbti-content-list.mjs
  var GbtiContentList = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      let items = [];
      try {
        items = (await this.client.listContent({}))?.items ?? [];
      } catch {
      }
      this.set(
        this.css() + `<div class="panel">
           <h2>My content</h2>
           ${items.length === 0 ? `<p class="muted">No content yet. Use the Author tab to create your first post.</p>` : ""}
           <ul class="list">${items.map((it, i) => this.rowHtml(it, i)).join("")}</ul>
         </div>`
      );
      this.$$("button[data-i]").forEach(
        (b) => b.addEventListener("click", async () => {
          const it = items[Number(b.dataset.i)];
          try {
            const full = await this.client.getContentItem({ path: it.path });
            this.emit("gbti-edit", { type: it.type, ...full });
          } catch (err) {
            b.textContent = err.message;
          }
        })
      );
    }
    rowHtml(it, i) {
      const status2 = it.status ? `<span class="tag ${it.status === "published" ? "ok" : ""}">${esc(it.status)}</span>` : "";
      const vis = it.visibility === "members" ? `<span class="tag">members</span>` : "";
      return `<li class="row" style="justify-content:space-between">
      <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || "")}</span> ${status2} ${vis}</span>
      <button class="ghost" data-i="${i}">Edit</button>
    </li>`;
    }
  };
  define("gbti-content-list", GbtiContentList);

  // client-ui/src/elements/gbti-pr-list.mjs
  var GbtiPrList = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      let prs = [];
      try {
        prs = (await this.client.listPRs())?.prs ?? [];
      } catch {
      }
      this.set(
        this.css() + `<div class="panel">
           <h2>My pull requests</h2>
           ${prs.length === 0 ? `<p class="muted">No open PRs.</p>` : ""}
           <ul class="list">${prs.map((pr) => `<li class="row" style="justify-content:space-between" data-n="${esc(pr.number)}">
             <span><a href="${esc(pr.html_url)}" target="_blank" rel="noopener">#${esc(pr.number)}</a> ${esc(pr.title)}</span>
             <span class="gate tag" data-n="${esc(pr.number)}">checking…</span>
           </li>`).join("")}</ul>
         </div>`
      );
      for (const pr of prs) this.loadStatus(pr.number);
    }
    async loadStatus(number) {
      const tag = this.$(`.gate[data-n="${number}"]`);
      if (!tag) return;
      try {
        const s = await this.client.prStatus({ number });
        const ok = s.state === "success";
        const bad = s.state === "failure" || s.state === "error";
        tag.className = `gate tag ${ok ? "ok" : bad ? "bad" : ""}`;
        tag.textContent = s.meaning || s.state || "unknown";
        if (s.description) tag.title = s.description;
      } catch {
        tag.textContent = "unknown";
      }
    }
  };
  define("gbti-pr-list", GbtiPrList);

  // client-ui/src/elements/gbti-contrib-inbox.mjs
  function shortPath(p) {
    return String(p || "").replace(/^members\/[^/]+\//, "");
  }
  function whenAgo(ts, now = Date.now()) {
    if (ts == null) return "";
    const t = typeof ts === "number" ? ts : Date.parse(ts);
    if (!Number.isFinite(t)) return "";
    const s = Math.max(0, (now - t) / 1e3);
    if (s < 60) return "just now";
    const units = [["d", 86400], ["h", 3600], ["m", 60]];
    for (const [label, secs] of units) {
      const n = Math.floor(s / secs);
      if (n >= 1) return `${n}${label} ago`;
    }
    return "just now";
  }
  var CSS2 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .count { display:inline-block; min-width:20px; text-align:center; margin-left:6px; padding:1px 7px; border-radius:999px;
    background:var(--accent); color:#fff; font-size:12px; font-weight:800; vertical-align:middle; }
  ul.list { list-style:none; margin:0; padding:0; }
  .crow { border-top:1px solid var(--line); padding:13px 2px; }
  .crow:first-child { border-top:0; }
  .top { display:flex; align-items:baseline; justify-content:space-between; gap:10px; }
  .top b { font-weight:700; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .size { flex:none; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; white-space:nowrap; }
  .size .add { color:var(--accent); font-weight:700; }
  .size .del { color:var(--danger); font-weight:700; }
  .meta { color:var(--muted); font-size:12.5px; margin-top:3px; }
  .files { margin-top:7px; display:flex; flex-wrap:wrap; gap:5px; }
  .file { font-family:var(--font-mono,ui-monospace,monospace); font-size:11.5px; padding:2px 7px; border-radius:6px;
    background:var(--hover); color:var(--fg); }
  .file.added { background:rgba(31,158,95,.14); color:var(--accent); }
  .file.removed { background:rgba(224,108,108,.16); color:var(--danger); }
  .act { margin-top:9px; display:flex; gap:8px; }
  .btn { display:inline-block; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px;
    font:inherit; font-weight:600; font-size:13px; padding:6px 13px; text-decoration:none; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.primary:hover { color:#fff; opacity:.92; }
  .muted { color:var(--muted); }
  h2 { font-size:17px; margin:0 0 12px; }
`;
  var GbtiContribInbox = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      let list = [];
      let errored = false;
      try {
        list = (await this.client.listContributions?.())?.contributions ?? [];
      } catch {
        errored = true;
      }
      this.set(this.css(CSS2) + this._html(list, errored));
      this.$$("[data-review]").forEach((b) => b.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("contrib-open", { detail: { number: Number(b.dataset.review) }, bubbles: true, composed: true }));
      }));
    }
    _html(list, errored) {
      if (errored) {
        return `<div class="panel"><h2>Contributions to review</h2>
        <p class="muted">Sign in to see contributions other members have proposed against your content.</p></div>`;
      }
      if (list.length === 0) {
        return `<div class="panel"><h2>Contributions to review</h2>
        <p class="muted">No one has proposed a change to your content yet. When a member improves one of your
        articles, products, or prompts, it shows up here for you to review and accept.</p></div>`;
      }
      return `<div class="panel">
      <h2>Contributions to review<span class="count">${list.length}</span></h2>
      <ul class="list">${list.map((c) => this._row(c)).join("")}</ul></div>`;
    }
    _row(c) {
      const who = c.author?.login ? `@${esc(c.author.login)}` : "a member";
      const files = (c.files || []).map((f) => `<code class="file ${esc(f.status || "")}">${esc(shortPath(f.filename))}</code>`).join("");
      const n = c.fileCount ?? (c.files || []).length;
      return `<li class="crow">
      <div class="top"><b>${esc(c.title || "PR #" + c.number)}</b>
        <span class="size"><span class="add">+${c.additions | 0}</span> <span class="del">&minus;${c.deletions | 0}</span></span></div>
      <div class="meta">${who} &middot; ${esc(n)} file${n === 1 ? "" : "s"} &middot; ${esc(whenAgo(c.createdAt))}</div>
      <div class="files">${files}</div>
      <div class="act">
        <button class="btn primary" data-review="${esc(c.number)}" type="button">Review</button>
        <a class="btn" href="${esc(c.html_url || "#")}" target="_blank" rel="noopener">On GitHub</a>
      </div>
    </li>`;
    }
  };
  define("gbti-contrib-inbox", GbtiContribInbox);

  // client-ui/src/contrib-diff.mjs
  function diffRows(patch) {
    if (!patch || typeof patch !== "string") return [];
    return patch.split("\n").map((line) => {
      if (line.startsWith("@@") || line.startsWith("+++") || line.startsWith("---")) return { cls: "hunk", text: line };
      if (line.startsWith("+")) return { cls: "add", text: line };
      if (line.startsWith("-")) return { cls: "del", text: line };
      return { cls: "ctx", text: line };
    });
  }

  // client-ui/src/elements/gbti-contrib-review.mjs
  var CSS3 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  h2 { font-size:18px; margin:0 0 4px; }
  .sub { color:var(--muted); font-size:13px; margin:0 0 14px; }
  .sub a { color:var(--accent); }
  .tabs { display:inline-flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:3px; margin:0 0 12px; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:12.5px; padding:6px 14px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .file { margin:0 0 14px; border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  .file > .fh { background:var(--panel); padding:8px 12px; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; display:flex; justify-content:space-between; gap:10px; }
  .fh .sz .add { color:var(--accent); font-weight:700; } .fh .sz .del { color:var(--danger); font-weight:700; }
  pre.diff { margin:0; overflow:auto; font-family:var(--font-mono,ui-monospace,monospace); font-size:12px; line-height:1.5; }
  .dl { display:block; padding:0 12px; white-space:pre-wrap; word-break:break-word; }
  .dl.add { background:rgba(31,158,95,.12); }
  .dl.del { background:rgba(224,108,108,.14); }
  .dl.hunk { background:var(--hover); color:var(--muted); }
  .preview { border:1px solid var(--line); border-radius:10px; padding:16px 18px; background:var(--panel); }
  .preview + .preview { margin-top:12px; }
  .pmeta { color:var(--muted); font-size:12px; font-family:var(--font-mono,ui-monospace,monospace); margin:0 0 8px; }
  .award { margin-top:16px; border:1px solid var(--line); border-radius:10px; padding:13px 15px; background:var(--hover); }
  .award b { font-size:13px; } .award p { margin:5px 0 0; font-size:13.5px; color:var(--fg); }
  .award .zero { color:var(--muted); }
  .decide { margin-top:16px; border-top:1px solid var(--line); padding-top:16px; }
  textarea { width:100%; box-sizing:border-box; min-height:74px; resize:vertical; border:1px solid var(--line); border-radius:8px; padding:9px 11px; font:inherit; background:var(--panel); color:var(--fg); }
  .actions { display:flex; flex-wrap:wrap; gap:8px; margin-top:11px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:700; font-size:13px; padding:8px 16px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); }
  .btn.approve { background:var(--accent); border-color:var(--accent); color:#fff; }
  .btn.decline { color:var(--danger); }
  .btn[disabled] { opacity:.55; cursor:default; }
  .err { color:var(--danger); font-size:13px; margin-top:9px; }
  .muted { color:var(--muted); }
  .hint { color:var(--muted); font-size:12.5px; margin:10px 0 0; }
`;
  var GbtiContribReview = class extends GbtiElement {
    static get observedAttributes() {
      return ["number"];
    }
    connectedCallback() {
      this._data = null;
      this._previews = {};
      this._tab = "diff";
      this._busy = false;
      this._error = "";
      super.connectedCallback?.();
      this._load();
    }
    attributeChangedCallback(name, oldV, newV) {
      if (name === "number" && oldV !== newV && this.isConnected) this._load();
    }
    get _number() {
      const n = Number(this.getAttribute("number"));
      return Number.isInteger(n) && n > 0 ? n : null;
    }
    async _load() {
      if (!this.client || this._number == null) {
        this.render();
        return;
      }
      this._data = null;
      this._error = "";
      this._previews = {};
      this.render();
      try {
        this._data = await this.client.getContribution({ number: this._number });
        for (const p of this._data.proposed || []) {
          try {
            this._previews[p.filename] = (await this.client.preview({ body: p.body }))?.html || "";
          } catch {
          }
        }
      } catch (e) {
        this._error = e?.code === "forbidden" ? "This contribution is no longer available to review (it may have been merged, closed, or changed)." : "Could not load this contribution.";
      }
      this.render();
    }
    async _decide(decision) {
      if (this._busy || this._number == null) return;
      const msg = (this.$("[data-msg]")?.value || "").trim();
      if (decision === "request-changes" && !msg) {
        this._error = "Add a note describing the changes you would like before requesting changes.";
        this.render();
        return;
      }
      this._busy = true;
      this._error = "";
      this.render();
      try {
        await this.client.reviewContribution({ number: this._number, decision, message: msg });
        this.dispatchEvent(new CustomEvent("contrib-decided", { detail: { number: this._number, decision }, bubbles: true, composed: true }));
      } catch {
        this._error = "Could not submit your decision. Try again, or review it on GitHub.";
        this._busy = false;
        this.render();
      }
    }
    render() {
      if (!this.client) return;
      if (this._error && !this._data) {
        this.set(this.css(CSS3) + `<p class="err">${esc(this._error)}</p>`);
        return;
      }
      if (!this._data) {
        this.set(this.css(CSS3) + `<p class="muted">Loading the contribution...</p>`);
        return;
      }
      const d = this._data;
      const body = this._tab === "preview" ? this._previewHtml() : this._diffHtml();
      this.set(
        this.css(CSS3) + `<h2>${esc(d.title || "Contribution #" + d.number)}</h2>
         <p class="sub">From ${d.author?.login ? "@" + esc(d.author.login) : "a member"} &middot;
           <a href="${esc(d.html_url || "#")}" target="_blank" rel="noopener">#${esc(d.number)} on GitHub</a></p>
         <div class="tabs" role="tablist">
           <button class="tab ${this._tab === "diff" ? "on" : ""}" data-tab="diff" type="button">Changes</button>
           <button class="tab ${this._tab === "preview" ? "on" : ""}" data-tab="preview" type="button">Preview as merged</button>
         </div>
         <div>${body}</div>
         ${this._awardHtml()}
         ${this._decideHtml()}`
      );
      this.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        this._tab = b.dataset.tab;
        this.render();
      }));
      this.$$("[data-decide]").forEach((b) => b.addEventListener("click", () => this._decide(b.dataset.decide)));
    }
    _diffHtml() {
      const files = this._data.files || [];
      if (files.length === 0) return `<p class="muted">No file changes.</p>`;
      return files.map((f) => {
        const rows = diffRows(f.patch).map((r) => `<span class="dl ${r.cls}">${esc(r.text) || "&nbsp;"}</span>`).join("");
        const diff = f.patch ? `<pre class="diff">${rows}</pre>` : `<p class="dl ctx muted" style="padding:10px 12px">Binary or large file (no inline diff). View it on GitHub.</p>`;
        return `<div class="file"><div class="fh"><span>${esc(shortPath(f.filename))} <span class="muted">(${esc(f.status)})</span></span>
        <span class="sz"><span class="add">+${f.additions | 0}</span> <span class="del">&minus;${f.deletions | 0}</span></span></div>${diff}</div>`;
      }).join("");
    }
    _previewHtml() {
      const proposed = this._data.proposed || [];
      if (proposed.length === 0) return `<p class="muted">No readable content to preview (the change touches non-article files only).</p>`;
      return proposed.map((p) => {
        const html = this._previews[p.filename];
        return `<div class="preview"><p class="pmeta">${esc(shortPath(p.filename))}</p>${html || '<p class="muted">Preview unavailable.</p>'}</div>`;
      }).join("");
    }
    // SOW-028 P4 / SOW-059: surface the reward at the decision point. The contributor is credited on this content
    // (the stacked-avatar footnote) and earns a contribution point. Under the touch-based model the revenue cut is
    // AUTOMATIC: a contribution to a first-touch or last-touch item shares the fixed 5% collaboration mix (1
    // collaboration point per qualifying contribution, split evenly). Owners no longer set a per-content delegation.
    _awardHtml() {
      const who = this._data.author?.login ? "@" + esc(this._data.author.login) : "The contributor";
      return `<div class="award"><b>If you approve</b><p>${who} is credited as a contributor on this content and earns a contribution point. If this item is the first-touch or last-touch item when a member converts, that point also shares the automatic 5% collaboration mix. Rewards are automatic, so you do not set a revenue split.</p></div>`;
    }
    _decideHtml() {
      if (this._data && this._data.canActInClient === false) {
        return `<div class="decide">
        <p class="hint">Approving records your GitHub identity as the reviewer, which the membership gate reads. In this mode, approve or decline on GitHub.</p>
        <div class="actions"><a class="btn approve" href="${esc(this._data.html_url || "#")}" target="_blank" rel="noopener">Open on GitHub to decide</a></div>
      </div>`;
      }
      return `<div class="decide">
      <textarea data-msg placeholder="Optional note to the contributor (required when requesting changes)"></textarea>
      <div class="actions">
        <button class="btn approve" data-decide="approve" type="button" ${this._busy ? "disabled" : ""}>Approve &amp; merge</button>
        <button class="btn" data-decide="request-changes" type="button" ${this._busy ? "disabled" : ""}>Request changes</button>
        <button class="btn decline" data-decide="decline" type="button" ${this._busy ? "disabled" : ""}>Decline</button>
      </div>
      ${this._error ? `<p class="err">${esc(this._error)}</p>` : ""}
      <p class="hint">Approving submits an approval the membership gate reads, then merges the change. The client never merges directly.</p>
    </div>`;
    }
  };
  define("gbti-contrib-review", GbtiContribReview);

  // client-ui/src/elements/gbti-members-portal.mjs
  var GbtiMembersPortal = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      let items = [];
      try {
        items = (await this.client.listMembersOnly())?.items ?? [];
      } catch {
      }
      this.set(
        this.css() + `<div class="panel">
           <h2>Members-only</h2>
           <p class="muted">Content marked <code>visibility: members</code>, surfaced here (excluded from the public site).</p>
           ${items.length === 0 ? `<p class="muted">Nothing members-only yet.</p>` : ""}
           <ul class="list">${items.map((it) => `<li class="row" style="justify-content:space-between">
             <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || "")}</span></span>
             <span class="muted">${esc(it.author || "")}</span>
           </li>`).join("")}</ul>
         </div>`
      );
    }
  };
  define("gbti-members-portal", GbtiMembersPortal);

  // client-ui/src/elements/gbti-settings.mjs
  var GbtiSettings = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      const [settings, billing, referral] = await Promise.all([
        this.client.getSettings().catch(() => ({})),
        this.client.getBilling().catch(() => ({})),
        this.client.getReferral().catch(() => ({}))
      ]);
      this.set(
        this.css() + `<div class="panel">
           <h2>Settings</h2>
           <label>Local repo path</label><input id="repoPath" value="${esc(settings.repoPath || "")}" />
           <label>Preferred port</label><input id="preferredPort" type="number" value="${esc(settings.preferredPort || "")}" />
           <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input id="mcpEnabled" type="checkbox" ${settings.mcpEnabled ? "checked" : ""} style="width:auto" /> Enable the MCP HTTP endpoint</label>
           <label style="display:flex;gap:8px;align-items:center"><input id="autostart" type="checkbox" ${settings.autostart ? "checked" : ""} style="width:auto" /> Start on login (peg-startup)</label>
           <div class="row" style="margin-top:12px"><button id="save">Save</button><span id="out" class="muted"></span></div>
         </div>
         <div class="panel" style="margin-top:14px">
           <h2>Billing</h2>
           <p class="muted">${esc(billing.note || "Manage your membership in the Stripe customer portal.")}</p>
           ${billing.portal ? `<a href="${esc(billing.portal)}" target="_blank" rel="noopener"><button class="ghost">Open billing portal</button></a>` : ""}
         </div>
         <div class="panel" style="margin-top:14px">
           <h2>Referrals + revenue</h2>
           ${referral.link ? `<p>Your link: <code>${esc(referral.link)}</code></p>` : ""}
           <p class="muted">${esc(referral.note || "")}</p>
           <p class="muted">When a member converts after touching your content, you earn the first-touch (30%) or last-touch (10%) share. Contributors and commenters on those items are rewarded automatically from the 5% collaboration mix. You do not set a split.</p>
           ${referral.connectOnboarding ? `<a href="${esc(referral.connectOnboarding)}" target="_blank" rel="noopener"><button class="ghost">Set up payouts (Stripe Connect)</button></a>` : ""}
           ${referral.terms ? `<a href="${esc(referral.terms)}" target="_blank" rel="noopener" class="muted" style="margin-left:8px">Terms</a>` : ""}
         </div>`
      );
      this.on("#save", "click", async () => {
        const patch = {
          repoPath: this.$("#repoPath").value.trim(),
          preferredPort: Number(this.$("#preferredPort").value) || void 0,
          mcpEnabled: this.$("#mcpEnabled").checked,
          autostart: this.$("#autostart").checked
        };
        try {
          await this.client.updateSettings(patch);
          this.$("#out").textContent = "Saved.";
        } catch (err) {
          this.$("#out").innerHTML = `<span class="danger">${esc(err.message)}</span>`;
        }
      });
    }
  };
  define("gbti-settings", GbtiSettings);

  // client-ui/src/elements/gbti-account.mjs
  var SITE2 = "https://gbti.network";
  var LOCKED = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var WELCOME_PREFIX = "gbti-welcome";
  var STATUS_LABEL = {
    paid: "Paid member",
    trialing: "Free trial",
    expired: "Trial expired",
    cancelled: "Cancelled",
    none: "Not a member",
    banned: "Suspended",
    unknown: "Unknown"
  };
  var CSS4 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { border:1px solid var(--line); border-radius:14px; padding:16px 18px; margin:0 0 16px; background:var(--panel); }
  .sec h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sec .hint { margin:0 0 14px; color:var(--muted); font-size:13px; }
  .row { display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:9px 0; border-top:1px solid var(--line); }
  .row:first-of-type { border-top:0; }
  .row .lbl { font-weight:600; font-size:14px; min-width:140px; }
  .row .val { color:var(--muted); font-size:13.5px; flex:1; min-width:0; word-break:break-all; }
  .badge { display:inline-block; font-family:var(--font-mono, monospace); font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; border-radius:999px; padding:2px 9px; background:var(--hover); color:var(--fg); }
  .badge.paid { background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); }
  .badge.warn { background:#fdecea; color:#b3261e; }
  button, a.btn { font:inherit; font-weight:600; font-size:13.5px; padding:8px 14px; border:1px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none; display:inline-block; }
  button:hover, a.btn:hover { border-color:var(--accent); color:var(--accent); }
  button.primary { background:var(--brand); border-color:var(--brand); color:#fff; }
  button.primary:hover { background:var(--brand-dark, var(--brand)); color:#fff; }
  .copyrow { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
  .copyrow input { flex:1; min-width:220px; font:inherit; font-size:13px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--bg, var(--panel)); color:var(--fg); }
  .nudge { padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  .msg { font-size:13px; margin-top:8px; } .msg.ok { color:var(--green-700, #0f6f40); } .msg.err { color:#b3261e; }
  /* danger zone */
  .danger { border:1.5px solid #f0c2bd; border-radius:14px; padding:16px 18px; background:#fff8f7; }
  [data-theme="dark"] .danger { background:rgba(179,38,30,.08); border-color:rgba(179,38,30,.4); }
  .danger h3 { color:#b3261e; }
  .danger .row { border-top-color:#f3d4d0; }
  [data-theme="dark"] .danger .row { border-top-color:rgba(179,38,30,.25); }
  button.danger-btn { border-color:#e0a39d; color:#b3261e; }
  button.danger-btn:hover { background:#b3261e; border-color:#b3261e; color:#fff; }
  .confirm { margin-top:10px; }
  .confirm input { font:inherit; font-size:13px; padding:7px 10px; border:1px solid #e0a39d; border-radius:8px; background:var(--panel); color:var(--fg); width:200px; }
`;
  var GbtiAccount = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._loaded = false;
      this.render();
      this._load();
    }
    async _load() {
      if (!this.client) return;
      try {
        const [status2, billing, referral, invite] = await Promise.all([
          this.client.status?.().catch(() => null),
          this.client.getBilling?.().catch(() => null),
          this.client.getReferral?.().catch(() => null),
          this.client.discordInvite?.().catch(() => null)
        ]);
        this._status = status2;
        this._billing = billing;
        this._referral = referral;
        this._invite = invite;
        this._loaded = true;
        this.render();
      } catch {
        this._loaded = true;
        this.render();
      }
    }
    get _signedIn() {
      return Boolean(this._status?.authenticated && this._status?.identity?.login);
    }
    get _login() {
      return this._status?.identity?.login || null;
    }
    get _membership() {
      return this._status?.membership || "unknown";
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS4) + `<div class="nudge">Open this in the GBTI client or extension to manage your account.</div>`);
        return;
      }
      if (!this._loaded) {
        this.set(this.css(CSS4) + `<p class="hint">Loading your account…</p>`);
        return;
      }
      if (!this._signedIn) {
        this.set(this.css(CSS4) + `<div class="nudge">Sign in with the GBTI client to manage your account. <a href="${SITE2}/membership/">Become a member</a>.</div>`);
        return;
      }
      this.set(this.css(CSS4) + this._account() + this._billingSec() + this._referrals() + this._dangerZone());
      this._wire();
    }
    _account() {
      return `<section class="sec">
      <h3>Account</h3>
      <p class="hint">Signed in as <b>@${esc(this._login)}</b>.</p>
      <div class="row"><span class="lbl">Sign out</span><span class="val">End this session on this device.</span><button data-signout type="button">Sign out</button></div>
      <div class="row"><span class="lbl">Welcome tour</span><span class="val">Show the post-setup welcome (join Discord + discover members) again.</span><button data-reset-welcome type="button">Reset</button></div>
      <div class="msg" data-account-msg aria-live="polite"></div>
    </section>`;
    }
    _billingSec() {
      const m = this._membership;
      const cls = m === "paid" ? "paid" : LOCKED.has(m) ? "warn" : "";
      const portal = this._billing?.portal;
      return `<section class="sec">
      <h3>Membership & billing</h3>
      <p class="hint">Your plan, invoices, and payment method.</p>
      <div class="row"><span class="lbl">Status</span><span class="val"><span class="badge ${cls}">${esc(STATUS_LABEL[m] || m)}</span></span></div>
      <div class="row"><span class="lbl">Invoices & receipts</span><span class="val">Manage your card, see invoices, and download receipts in the Stripe customer portal.</span>
        ${portal ? `<a class="btn" href="${esc(portal)}" target="_blank" rel="noopener">Open billing portal</a>` : `<span class="val">Billing portal unavailable.</span>`}</div>
    </section>`;
    }
    _referrals() {
      const r = this._referral || {};
      const canonical = r.link || (r.code ? `${SITE2}/join?ref=${r.code}` : null);
      const invite = this._invite?.url || null;
      const copyField = (id, value, label) => `<div class="row"><span class="lbl">${esc(label)}</span><div class="copyrow"><input id="${id}" type="text" readonly value="${esc(value)}" /><button data-copy="${id}" type="button">Copy</button></div></div>`;
      return `<section class="sec">
      <h3>Referrals & invites</h3>
      <p class="hint">Share your link to invite members; you earn referral commission on what you refer (SOW-007).</p>
      ${canonical ? copyField("ref-canonical", canonical, "Your invite link") : ""}
      ${invite ? copyField("discord-invite", invite, "Discord invite") : ""}
      ${!canonical && !invite ? `<p class="hint">No referral link yet. Sign in as a member to generate one.</p>` : ""}
      <div class="msg" data-ref-msg aria-live="polite"></div>
    </section>`;
    }
    _dangerZone() {
      const portal = this._billing?.portal;
      return `<section class="danger">
      <h3>Danger zone</h3>
      <p class="hint">These actions end your access or remove your data. They cannot be undone here.</p>
      <div class="row"><span class="lbl">Cancel membership</span><span class="val">Cancel in the Stripe portal (it handles proration + the period-end choice). Your paid access ends and your published content is set to draft on lapse.</span>
        ${portal ? `<a class="btn danger-btn" href="${esc(portal)}" target="_blank" rel="noopener">Cancel in portal</a>` : ""}</div>
      <div class="row"><span class="lbl">Delete account</span><span class="val">Request erasure of your account + data (GDPR). Type <b>DELETE</b> to confirm. Your private data is cleared on this device immediately; your published content + billing are removed by our erasure process.</span>
        <div class="confirm"><input data-delete-confirm type="text" placeholder="Type DELETE" aria-label="Type DELETE to confirm" autocomplete="off" /> <button data-delete type="button" class="danger-btn" disabled>Request deletion</button></div>
      </div>
      <div class="msg" data-danger-msg aria-live="polite"></div>
    </section>`;
    }
    _wire() {
      this.on("[data-signout]", "click", () => this.emit("gbti:request-signout"));
      this.on("[data-reset-welcome]", "click", () => this._resetWelcome());
      this.$$("[data-copy]").forEach((b) => b.addEventListener("click", () => this._copy(b.dataset.copy)));
      const confirm2 = this.$("[data-delete-confirm]");
      const delBtn = this.$("[data-delete]");
      if (confirm2 && delBtn) confirm2.addEventListener("input", () => {
        delBtn.disabled = confirm2.value.trim() !== "DELETE";
      });
      this.on("[data-delete]", "click", () => this._requestDeletion());
    }
    _resetWelcome() {
      let n = 0;
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(WELCOME_PREFIX)) {
            localStorage.removeItem(k);
            n++;
          }
        }
      } catch {
      }
      this._say("[data-account-msg]", n ? "Welcome tour reset. It will run again next time you open onboarding." : "Nothing to reset — the welcome tour has not run yet.", "ok");
    }
    async _copy(id) {
      const el = this.$(`#${id}`);
      if (!el) return;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(el.value);
        else {
          el.select();
          document.execCommand?.("copy");
        }
        this._say("[data-ref-msg]", "Copied to your clipboard.", "ok");
      } catch {
        this._say("[data-ref-msg]", "Could not copy. Select the text and copy manually.", "err");
      }
    }
    // SOW-040 v1: the SAFE, legal-park-respecting parts of erasure. Clear the member's instant-deletable LOCAL data
    // (welcome flags) and FILE the request (sign out so the device session ends). The full self-service KV/Stripe
    // erase + content removal is the SOW-024-aligned follow-up (a Worker erase endpoint, owner-adjudicated content
    // removal) — deliberately NOT a one-click member action while the GDPR process is owner-run.
    _requestDeletion() {
      const confirm2 = this.$("[data-delete-confirm]");
      if (!confirm2 || confirm2.value.trim() !== "DELETE") {
        this._say("[data-danger-msg]", "Type DELETE to confirm.", "err");
        return;
      }
      try {
        for (let i = localStorage.length - 1; i >= 0; i--) {
          const k = localStorage.key(i);
          if (k && k.startsWith(WELCOME_PREFIX)) localStorage.removeItem(k);
        }
      } catch {
      }
      this._say("[data-danger-msg]", "Deletion requested. Your private data on this device is cleared. Email privacy@gbti.network to complete erasure of your published content + billing (processed within 30 days). Signing you out…", "ok");
      setTimeout(() => this.emit("gbti:request-signout"), 2500);
    }
    _say(sel, text, kind) {
      const el = this.$(sel);
      if (el) {
        el.textContent = text;
        el.className = `msg ${kind || ""}`;
      }
    }
  };
  define("gbti-account", GbtiAccount);

  // client-ui/src/elements/gbti-admin.mjs
  var RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
  var GbtiAdmin = class extends GbtiElement {
    async render() {
      if (!this.client) return;
      let role = "member";
      try {
        role = (await this.client.status())?.role ?? "member";
      } catch {
      }
      const rank = RANK[role] ?? 0;
      if (rank < RANK.moderator) {
        this.set(this.css() + `<div class="panel muted">Admin tools are available to moderators and above.</div>`);
        return;
      }
      this.set(
        this.css(`.act{margin:14px 0;padding-top:12px;border-top:1px solid var(--line)} .act:first-of-type{border:0;padding:0}`) + `<div class="panel">
           <h2>Admin <span class="tag ok">${esc(role)}</span></h2>
           <div class="act">
             <label>Deplatform / remove content (path)</label>
             <input id="cpath" placeholder="members/<user>/posts/<slug>/index.md" />
             <div class="row" style="margin-top:8px"><button class="ghost" id="deplatform">Deplatform (draft)</button><button class="ghost" id="remove">Remove</button></div>
           </div>
           ${rank >= RANK.admin ? `<div class="act">
             <label>Ban / grandfather (github_id)</label>
             <input id="gid" placeholder="github_id" /><input id="reason" placeholder="reason (optional)" style="margin-top:6px" />
             <div class="row" style="margin-top:8px"><button class="ghost" id="ban">Ban</button><button class="ghost" id="unban">Unban</button><button class="ghost" id="grandfather">Grandfather</button><button class="ghost" id="ungrandfather">Ungrandfather</button></div>
           </div>` : ""}
           ${rank >= RANK.superadmin ? `<div class="act">
             <label>Assign role</label>
             <div class="row"><input id="rid" placeholder="github_id" /><select id="role"><option>member</option><option>moderator</option><option>admin</option><option>superadmin</option></select><button class="ghost" id="setrole">Set role</button></div>
           </div>` : ""}
           <div id="out" class="muted" style="margin-top:12px"></div>
         </div>`
      );
      const run = (action, args) => async () => {
        this.out("Working…");
        try {
          const res = await this.client.admin(action, args());
          if (res?.changed === false || res?.noop) this.out(`<span class="tag ok">No change</span> ${esc(res.message || "already in that state")}`);
          else this.out(`<span class="tag ok">PR opened</span> <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
        } catch (err) {
          this.out(esc(err.message), "danger");
        }
      };
      const cpath = () => ({ path: this.$("#cpath").value.trim() });
      const gid = () => ({ githubId: this.$("#gid").value.trim(), reason: this.$("#reason").value.trim() || void 0 });
      this.on("#deplatform", "click", run("deplatform", cpath));
      this.on("#remove", "click", run("remove", cpath));
      if (rank >= RANK.admin) {
        this.on("#ban", "click", run("ban", gid));
        this.on("#unban", "click", run("unban", () => ({ githubId: this.$("#gid").value.trim() })));
        this.on("#grandfather", "click", run("grandfather", gid));
        this.on("#ungrandfather", "click", run("ungrandfather", () => ({ githubId: this.$("#gid").value.trim() })));
      }
      if (rank >= RANK.superadmin) {
        this.on("#setrole", "click", run("role", () => ({ githubId: this.$("#rid").value.trim(), role: this.$("#role").value })));
      }
    }
    out(html, cls = "muted") {
      const o = this.$("#out");
      if (o) {
        o.className = cls;
        o.innerHTML = html;
      }
    }
  };
  define("gbti-admin", GbtiAdmin);

  // client-ui/src/saved-core.mjs
  var TYPE_INDEX = { post: "blog-index.json", product: "products-index.json", prompt: "prompts-index.json" };
  var TYPE_LABEL2 = { post: "Articles", product: "Products", prompt: "Prompts", share: "Shares" };
  var ORDER = ["post", "product", "prompt", "share"];
  function indexFileFor(type) {
    return TYPE_INDEX[type] || null;
  }
  function typeLabel(type) {
    return TYPE_LABEL2[type] || String(type || "");
  }
  var SAVED_TYPES = ORDER.slice();
  function buildItemIndex(perType = {}) {
    const map = /* @__PURE__ */ new Map();
    for (const [type, items] of Object.entries(perType || {})) {
      for (const it of items || []) {
        if (!it || !it.slug) continue;
        map.set(`${type}:${it.slug}`, { type, slug: it.slug, title: it.title || it.slug, url: it.url || null, path: it.path || null, thumb: it.thumb || null });
      }
    }
    return map;
  }
  function resolveItem(index, type, slug) {
    return index && index.get(`${type}:${slug}`) || { type, slug, title: slug, url: null, path: null, thumb: null };
  }
  function groupFavoritesByType(favorites = []) {
    const groups = /* @__PURE__ */ new Map();
    for (const f of favorites || []) {
      if (!f || !f.type || !f.slug) continue;
      if (!groups.has(f.type)) groups.set(f.type, []);
      groups.get(f.type).push({ type: f.type, slug: f.slug });
    }
    const known = ORDER.filter((t) => groups.has(t));
    const extra = [...groups.keys()].filter((t) => !ORDER.includes(t));
    return [...known, ...extra].map((t) => ({ type: t, items: groups.get(t) }));
  }
  function savedTypeCounts(activity = {}) {
    const counts = {};
    const bump = (t) => {
      if (t) counts[t] = (counts[t] || 0) + 1;
    };
    for (const f of activity.favorites || []) bump(f?.type);
    for (const c of activity.collections || []) for (const it of c?.items || []) bump(it?.type);
    return counts;
  }
  function savedTypeChips(activity = {}) {
    const counts = savedTypeCounts(activity);
    const total = Object.values(counts).reduce((n, v) => n + v, 0);
    const chips = [{ type: "all", label: "All", count: total }];
    for (const t of ORDER) if (counts[t]) chips.push({ type: t, label: typeLabel(t), count: counts[t] });
    return chips;
  }
  function filterSavedByType(activity = {}, type) {
    if (!type || type === "all") return activity;
    return {
      favorites: (activity.favorites || []).filter((f) => f?.type === type),
      collections: (activity.collections || []).map((c) => ({ ...c, items: (c?.items || []).filter((it) => it?.type === type) }))
    };
  }

  // client-ui/src/elements/gbti-superadmin-dashboard.mjs
  var SITE3 = "https://gbti.network";
  var CSS5 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; margin:0 0 16px; }
  .chip { font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; }
  .chip b { color:var(--fg); }
  table { width:100%; border-collapse:collapse; font-size:13.5px; }
  th { text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); font-weight:700; padding:0 8px 8px; border-bottom:1px solid var(--line); }
  td { padding:9px 8px; border-top:1px solid var(--line); vertical-align:middle; }
  tr:first-child td { border-top:0; }
  .who { display:flex; align-items:center; gap:9px; min-width:0; }
  .av { width:26px; height:26px; border-radius:50%; flex:none; object-fit:cover; background:var(--hover); }
  .nm { font-weight:600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; }
  a.nm:hover { color:var(--accent); }
  .id { color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .tags { display:flex; flex-wrap:wrap; gap:5px; align-items:center; }
  .tag { font-size:11px; font-weight:700; border-radius:999px; padding:2px 9px; background:var(--hover); color:var(--muted); white-space:nowrap; }
  .tag.staff { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.gf { background:rgba(201,150,43,.16); color:#a1741a; }
  .tag.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .stat { font-size:11.5px; font-weight:700; border-radius:999px; padding:2px 10px; white-space:nowrap; background:var(--hover); color:var(--muted); }
  .stat.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .stat.tr { background:rgba(201,150,43,.16); color:#a1741a; }
  .stat.ban { background:rgba(224,108,108,.16); color:var(--danger); }
  .src { color:var(--muted); font-size:11px; margin-left:6px; }
  .dash { color:var(--muted); }
  .sec-h { font-size:14px; font-weight:700; margin:26px 0 10px; display:flex; align-items:center; gap:8px; }
  .sec-h .ct { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); font-weight:600; }
  ul.prs { list-style:none; margin:0; padding:0; }
  .pr { display:flex; align-items:center; gap:10px; padding:8px 8px; border-top:1px solid var(--line); }
  .pr:first-child { border-top:0; }
  .pr-t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; font-weight:600; font-size:13.5px; }
  a.pr-t:hover { color:var(--accent); }
  .pr-m { flex:none; color:var(--muted); font-family:var(--font-mono, monospace); font-size:11.5px; }
  .muted { color:var(--muted); font-size:14px; }
  .note { color:var(--muted); font-size:12.5px; margin:14px 0 0; line-height:1.5; }
  /* SOW-038 P3: operations triggers */
  .ops { display:flex; flex-wrap:wrap; gap:10px; }
  .opbtn { font:inherit; font-weight:600; font-size:13px; padding:9px 15px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .opbtn:hover { border-color:var(--accent); color:var(--accent); }
  .opbtn[disabled] { opacity:.6; cursor:default; }
  .opnote { font-size:12.5px; margin:10px 0 0; } .opnote.ok { color:var(--accent); } .opnote.err { color:var(--danger); }
`;
  var ROLE_RANK = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
  var GbtiSuperadminDashboard = class extends GbtiElement {
    connectedCallback() {
      this._data = null;
      this._pulls = null;
      this._counts = null;
      this._error = null;
      super.connectedCallback?.();
      this._load();
    }
    // Per-member published content counts, from the PUBLIC per-type index JSONs (no auth, no new endpoint). Author
    // is the folder username; house/gbti content does not map to a member. Best-effort; a failure leaves it null.
    async _loadCounts() {
      const counts = {};
      await Promise.all(SAVED_TYPES.map(async (t) => {
        try {
          const res = await fetch(`${SITE3}/${indexFileFor(t)}`, { cache: "no-cache" });
          const items = res.ok ? (await res.json()).items || [] : [];
          for (const it of items) {
            const a = String(it?.author || "").toLowerCase();
            if (a && a !== "gbti" && a !== "house") counts[a] = (counts[a] || 0) + 1;
          }
        } catch {
        }
      }));
      this._counts = counts;
    }
    async _load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        const r = await this.client.overrides();
        this._data = { roster: r?.roster || [], summary: r?.summary || {} };
      } catch (err) {
        const code = err?.code;
        this._error = code === "forbidden" ? "forbidden" : code === "no-identity" || code === "not-authenticated" ? "auth" : "error";
        this.render();
        return;
      }
      try {
        this._pulls = (await this.client.openPulls())?.pulls || [];
      } catch {
        this._pulls = null;
      }
      await this._loadCounts();
      this.render();
    }
    // The open content-PR queue (admin overview of what is awaiting the gate / review). null = not loaded.
    _pullsSection() {
      if (this._pulls === null) return "";
      if (!this._pulls.length) return `<h3 class="sec-h">Open pull requests</h3><p class="muted">No open pull requests right now.</p>`;
      const rows = this._pulls.map((p) => {
        const author = p.author?.login ? `@${esc(p.author.login)}` : "unknown";
        const when = p.createdAt ? esc(String(p.createdAt).slice(0, 10)) : "";
        return `<li class="pr"><a class="pr-t" href="${esc(p.html_url || "#")}" target="_blank" rel="noopener">#${esc(p.number)} ${esc(p.title || "")}</a><span class="pr-m">${author}${when ? ` · ${when}` : ""}</span></li>`;
      }).join("");
      return `<h3 class="sec-h">Open pull requests <span class="ct">${this._pulls.length}</span></h3><ul class="prs">${rows}</ul>`;
    }
    // SOW-038 P3: the operations section (reconcile / E2E-smoke triggers). The dashboard is admin-gated (the roster
    // loaded), so these show only to a confirmed admin; the Worker re-checks + holds the dispatch token.
    _opsSection() {
      const note = this._opNote ? `<p class="opnote ${this._opNote.ok ? "ok" : "err"}">${esc(this._opNote.msg)}</p>` : "";
      return `<h3 class="sec-h">Operations</h3>
      <div class="ops">
        <button class="opbtn" data-op="reconcile" type="button">Run reconcile (apply)</button>
        <button class="opbtn" data-op="e2e" type="button">Run E2E smoke</button>
      </div>${note}
      <p class="note">Reconcile brings published content + Discord roles in line with Stripe + overrides (full <code>--apply</code>; idempotent). E2E smoke runs the live authenticated create &rarr; confirm &rarr; scrub cycle. Both kick off a GitHub Actions run; results appear in the repo's Actions tab.</p>`;
    }
    async _runOp(action, btn) {
      if (btn) btn.disabled = true;
      this._opNote = { ok: true, msg: "Triggering&hellip;" };
      this.render();
      try {
        await this.client.adminOp(action);
        this._opNote = { ok: true, msg: `Triggered "${action}". Watch the run in the repo's Actions tab.` };
      } catch (err) {
        this._opNote = { ok: false, msg: err?.message || "Could not trigger the operation." };
      }
      this.render();
    }
    // The effective-status cell: the resolved status badge + the override source when it overrode Stripe.
    _statusCell(m) {
      const LABEL = { paid: "paid", trialing: "trial", expired: "expired", cancelled: "cancelled", none: "none", banned: "banned", unknown: "unknown" };
      const cls = m.status === "paid" ? "ok" : m.status === "banned" ? "ban" : m.status === "trialing" ? "tr" : "";
      const src = m.source && m.source !== "stripe" ? `<span class="src">via ${esc(m.source)}</span>` : "";
      return `<span class="stat ${cls}">${esc(LABEL[m.status] || m.status)}</span>${src}`;
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS5) + `<p class="muted">Sign in with the GBTI client to view the member roster.</p>`);
        return;
      }
      if (this._error === "forbidden") {
        this.set(this.css(CSS5) + `<p class="muted">The superadmin dashboard is available to admins and superadmins.</p>`);
        return;
      }
      if (this._error === "auth") {
        this.set(this.css(CSS5) + `<p class="muted">Sign in to view the member roster.</p>`);
        return;
      }
      if (this._error) {
        this.set(this.css(CSS5) + `<p class="muted">Could not load the member roster. Try again shortly.</p>`);
        return;
      }
      if (!this._data) {
        this.set(this.css(CSS5) + `<p class="muted">Loading the member roster...</p>`);
        return;
      }
      const s = this._data.summary || {};
      const chips = `<div class="chips">
      <span class="chip"><b>${esc(s.total ?? 0)}</b> known</span>
      <span class="chip"><b>${esc(s.staff ?? 0)}</b> staff</span>
      <span class="chip"><b>${esc(s.grandfathered ?? 0)}</b> grandfathered</span>
      <span class="chip"><b>${esc(s.banned ?? 0)}</b> banned</span>
    </div>`;
      const rows = (this._data.roster || []).map((m) => {
        const u = m.username ? esc(m.username) : "";
        const who = m.username ? `<a class="nm" href="https://gbti.network/members/${u}/" target="_blank" rel="noopener">@${u}</a>` : `<span class="nm id">id ${esc(m.githubId)}</span>`;
        const av = m.username ? `<img class="av" src="https://github.com/${encodeURIComponent(m.username)}.png?size=52" alt="" loading="lazy" data-avfor="${u}" />` : `<span class="av"></span>`;
        const tags = [];
        if (m.banned) tags.push(`<span class="tag ban">banned</span>`);
        if ((ROLE_RANK[m.role] ?? 0) > 0) tags.push(`<span class="tag staff">${esc(m.role)}</span>`);
        if (m.grandfathered) tags.push(`<span class="tag gf">grandfathered${m.grandfatherUntil ? ` · until ${esc(String(m.grandfatherUntil).slice(0, 10))}` : ""}</span>`);
        if (!tags.length) tags.push(`<span class="dash">—</span>`);
        const n = this._counts && m.username ? this._counts[m.username.toLowerCase()] || 0 : null;
        const content = n == null ? `<span class="dash">—</span>` : esc(n);
        return `<tr><td><div class="who">${av}${who}</div></td><td>${this._statusCell(m)}</td><td><div class="tags">${tags.join("")}</div></td><td class="id">${content}</td><td class="id">${esc(m.githubId)}</td></tr>`;
      }).join("");
      this.set(this.css(CSS5) + `${chips}
      <table><thead><tr><th>Member</th><th>Status</th><th>Overrides</th><th>Content</th><th>github_id</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No members known yet.</td></tr>'}</tbody></table>
      <p class="note">Effective status follows ban &gt; staff &gt; grandfather &gt; Stripe. The live Stripe tier is shown when the admin Stripe endpoint is reachable (otherwise it reads "unknown"); the override tiers (ban / staff / grandfather) are always authoritative from the public repo.</p>
      ${this._pullsSection()}
      ${this._opsSection()}`);
      this.$$("[data-avfor]").forEach((img) => img.addEventListener("error", () => {
        img.style.visibility = "hidden";
      }, { once: true }));
      this.$$("[data-op]").forEach((b) => b.addEventListener("click", () => this._runOp(b.dataset.op, b)));
    }
  };
  define("gbti-superadmin-dashboard", GbtiSuperadminDashboard);

  // client-ui/src/elements/gbti-category-manager.mjs
  var CSS6 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; gap:10px; margin:0 0 6px; }
  .head h3 { margin:0; font-size:15px; }
  .hint { color:var(--muted); font-size:12px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0 10px; }
  .muted { color:var(--muted); font-size:13.5px; }
  .add-top { display:flex; gap:6px; margin:10px 0 14px; flex-wrap:wrap; }
  input { font:inherit; font-size:13px; padding:6px 9px; border:1px solid var(--line); border-radius:2px; background:var(--panel); color:var(--fg); }
  input.key { width:150px; } input.lab { flex:1; min-width:120px; }
  .btn { font:inherit; font-weight:600; font-size:13px; padding:6px 12px; border:0; border-radius:2px; background:var(--accent); color:#fff; cursor:pointer; }
  .lk { font:inherit; font-size:12.5px; font-weight:600; color:var(--accent); background:none; border:0; cursor:pointer; padding:4px 6px; border-radius:2px; }
  .lk:hover { background:var(--hover); }
  .lk.danger { color:var(--danger); }
  ul.tree { list-style:none; margin:0; padding:0 0 0 16px; } ul.tree.root { padding-left:0; }
  .node { border-top:1px solid var(--line); }
  .node:first-child { border-top:0; }
  .row { display:flex; align-items:center; gap:8px; padding:7px 2px; }
  code.key { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); min-width:120px; }
  .busy { opacity:.55; pointer-events:none; }
`;
  var GbtiCategoryManager = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._tree = null;
      this._msg = "";
      this._busy = false;
      this.load();
    }
    async load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        this._tree = (await this.client.taxonomy())?.tree || {};
      } catch {
        this._tree = {};
        this._msg = "Could not load the taxonomy.";
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS6) + `<p class="muted">Open in the GBTI client (admin) to manage categories.</p>`);
        return;
      }
      if (!this._tree) {
        this.set(this.css(CSS6) + `<p class="muted">Loading categories...</p>`);
        return;
      }
      this.set(this.css(CSS6) + `<div class="${this._busy ? "busy" : ""}">
      <div class="head"><h3>Category manager</h3><span class="hint">Edits open an auto-merged house PR.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ""}
      <div class="add-top">
        <input class="key" data-newtop-key type="text" placeholder="new-key (kebab-case)" />
        <input class="lab" data-newtop-label type="text" placeholder="Display label" />
        <button class="btn" type="button" data-addtop>Add top-level</button>
      </div>
      <ul class="tree root">${this._renderLevel(this._tree, []) || '<li class="muted">No categories yet.</li>'}</ul>
    </div>`);
      this._wire();
    }
    _renderLevel(map, path) {
      return Object.entries(map || {}).map(([key, node]) => {
        const p = [...path, key];
        const ps = p.join("/");
        const kids = node && node.children ? this._renderLevel(node.children, p) : "";
        return `<li class="node">
        <div class="row">
          <code class="key">${esc(key)}</code>
          <input class="lab" data-path="${esc(ps)}" type="text" value="${esc(node && node.label || "")}" />
          <button class="lk" type="button" data-rename="${esc(ps)}">Label</button>
          <button class="lk" type="button" data-addsub="${esc(ps)}">+ Sub</button>
          <button class="lk" type="button" data-key="${esc(ps)}">Key</button>
          <button class="lk" type="button" data-move="${esc(ps)}">Move</button>
          <button class="lk danger" type="button" data-remove="${esc(ps)}">Remove</button>
        </div>
        ${kids ? `<ul class="tree">${kids}</ul>` : ""}
      </li>`;
      }).join("");
    }
    _wire() {
      this.on("[data-addtop]", "click", () => {
        const key = (this.$("[data-newtop-key]")?.value || "").trim();
        const label = (this.$("[data-newtop-label]")?.value || "").trim();
        if (key && label) this._run(() => this.client.addCategory({ parentPath: [], key, label }));
      });
      this.$$("[data-rename]").forEach((b) => b.addEventListener("click", () => {
        const ps = b.dataset.rename;
        const label = (this.$(`input.lab[data-path="${ps}"]`)?.value || "").trim();
        if (label) this._run(() => this.client.renameCategory({ path: ps.split("/"), label }));
      }));
      this.$$("[data-addsub]").forEach((b) => b.addEventListener("click", () => {
        const ps = b.dataset.addsub;
        const key = (typeof prompt === "function" ? prompt(`New subcategory key under "${ps}" (kebab-case)`) : "") || "";
        if (!key.trim()) return;
        const label = (typeof prompt === "function" ? prompt("Display label") : "") || "";
        if (!label.trim()) return;
        this._run(() => this.client.addCategory({ parentPath: ps.split("/"), key: key.trim(), label: label.trim() }));
      }));
      this.$$("[data-key]").forEach((b) => b.addEventListener("click", () => {
        const ps = b.dataset.key;
        const newKey = (typeof prompt === "function" ? prompt(`Rename the KEY of "${ps}" (kebab-case). This rewrites every content item under it.`) : "") || "";
        if (newKey.trim()) this._migrate("rename", ps, { newKey: newKey.trim() });
      }));
      this.$$("[data-move]").forEach((b) => b.addEventListener("click", () => {
        const ps = b.dataset.move;
        const toParent = typeof prompt === "function" ? prompt(`Move "${ps}" under which parent path? (slash-joined, blank = top level). This rewrites content under it.`) : null;
        if (toParent !== null) this._migrate("move", ps, { toParent: toParent.trim() });
      }));
      this.$$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        const ps = b.dataset.remove;
        if (typeof confirm === "function" && !confirm(`Remove "${ps}"? If content uses it, the migration is REFUSED unless you reassign.`)) return;
        const reassign = typeof confirm === "function" ? confirm("Reassign affected content to the PARENT category? OK = reassign, Cancel = only remove if nothing uses it.") : false;
        this._migrate("remove", ps, { reassign });
      }));
    }
    async _migrate(action, ps, extra) {
      this._busy = true;
      this._msg = "";
      this.render();
      try {
        await this.client.adminOp("category-migrate", { action, from: ps, ...extra, apply: true });
        this._msg = `Migration triggered (${action} ${ps}). A review-gated PR opens via CI (merge it once content-check is green; it is not auto-merged). A would-orphan remove is refused — see the repo Actions tab. The tree updates after the PR merges.`;
      } catch (err) {
        this._msg = err?.message || "Could not trigger the migration.";
      }
      this._busy = false;
      this.render();
    }
    async _run(fn) {
      this._busy = true;
      this._msg = "";
      this.render();
      try {
        const r = await fn();
        this._msg = r?.noop ? "No change (already in that state)." : r?.number ? `Opened PR #${r.number} (auto-merges; the tree updates after it lands).` : "Done.";
      } catch (err) {
        this._msg = err?.message || "The edit failed.";
      }
      this._busy = false;
      await this.load();
    }
  };
  define("gbti-category-manager", GbtiCategoryManager);

  // client-ui/src/elements/gbti-news-source-manager.mjs
  var hostOf = (url) => {
    try {
      return new URL(url).host;
    } catch {
      return url || "";
    }
  };
  var CSS7 = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add input { flex:1 1 130px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .add input[data-add-url] { flex:2 1 220px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .src { border-top:1px solid var(--line); }
  .src:first-child { border-top:0; }
  .src.off { opacity:.55; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; }
  .id { font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); flex:none; }
  .nm { font-weight:600; color:var(--fg); }
  .url { font-size:12.5px; color:var(--muted); text-decoration:none; }
  .url:hover { color:var(--accent); }
  .sp { flex:1; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;
  var GbtiNewsSourceManager = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this.load();
    }
    async load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        this._sources = (await this.client.newsSourcePool())?.sources || [];
      } catch {
        this._sources = [];
        this._msg = "Could not load the news sources.";
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS7) + `<p class="muted">Open in the GBTI client (admin) to manage news sources.</p>`);
        return;
      }
      if (!this._sources) {
        this.set(this.css(CSS7) + `<p class="muted">Loading news sources...</p>`);
        return;
      }
      const enabled = this._sources.filter((s) => s && s.enabled !== false).length;
      const rows = this._sources.map((s) => {
        const on = s && s.enabled !== false;
        return `<li class="src ${on ? "" : "off"}"><div class="row"><code class="id">${esc(s.id || "")}</code><span class="nm">${esc(s.name || "")}</span><a class="url" href="${esc(s.url || "")}" target="_blank" rel="noopener nofollow">${esc(hostOf(s.url))}</a><span class="sp"></span><button class="lk" type="button" data-toggle="${esc(s.id)}" data-on="${on ? "1" : "0"}">${on ? "Disable" : "Enable"}</button><button class="lk danger" type="button" data-remove="${esc(s.id)}">Remove</button></div></li>`;
      }).join("");
      this.set(this.css(CSS7) + `<div class="${this._busy ? "busy" : ""}">
      <div class="head"><h3>News sources</h3><span class="hint">${this._sources.length} sources, ${enabled} enabled &middot; edits open an auto-merged house PR</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ""}
      <div class="add">
        <input data-add-id type="text" placeholder="source-id (optional)" />
        <input data-add-name type="text" placeholder="Name" />
        <input data-add-url type="text" placeholder="https://... RSS/Atom feed URL" />
        <button class="btn" type="button" data-add>Add source</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The next news ingest confirms the feed fetches; a source that never returns items can be removed here.</p>
      <ul class="list">${rows || '<li class="muted">No sources yet.</li>'}</ul>
    </div>`);
      this._wire();
    }
    _wire() {
      this.on("[data-add]", "click", () => {
        const id = (this.$("[data-add-id]")?.value || "").trim();
        const name = (this.$("[data-add-name]")?.value || "").trim();
        const url = (this.$("[data-add-url]")?.value || "").trim();
        if (!url) {
          this._msg = "A feed URL is required.";
          this.render();
          return;
        }
        let ok = false;
        try {
          ok = /^https?:$/.test(new URL(url).protocol);
        } catch {
          ok = false;
        }
        if (!ok) {
          this._msg = "Enter a valid http(s) RSS/Atom feed URL.";
          this.render();
          return;
        }
        this._run(() => this.client.addNewsSource({ id, name, url }));
      });
      this.$$("[data-toggle]").forEach((b) => b.addEventListener("click", () => this._run(() => this.client.setNewsSourceEnabled({ id: b.dataset.toggle, enabled: b.dataset.on !== "1" }))));
      this.$$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        const id = b.dataset.remove;
        if (typeof confirm === "function" && !confirm(`Remove news source "${id}"?`)) return;
        this._run(() => this.client.removeNewsSource({ id }));
      }));
    }
    async _run(fn) {
      this._busy = true;
      this._msg = "";
      this.render();
      try {
        const r = await fn();
        this._msg = r?.noop ? "No change (already in that state)." : r?.number ? `Opened PR #${r.number} (auto-merges; the list updates after it lands + the site redeploys).` : "Done.";
      } catch (e) {
        this._msg = e?.message || "That edit failed.";
      }
      this._busy = false;
      await this.load();
    }
  };
  define("gbti-news-source-manager", GbtiNewsSourceManager);

  // client-ui/src/elements/gbti-quote-manager.mjs
  var CSS8 = `
  :host { display:block; }
  .head { display:flex; align-items:baseline; gap:12px; flex-wrap:wrap; margin:0 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, inherit); font-size:17px; }
  .hint { font-size:12.5px; color:var(--muted); }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .add { display:flex; gap:8px; flex-wrap:wrap; margin:0 0 14px; }
  .add textarea { flex:2 1 280px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; resize:vertical; min-height:38px; }
  .add input { flex:1 1 140px; min-width:0; font:inherit; color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:7px; padding:7px 9px; }
  .btn { flex:none; border:1px solid var(--accent); background:var(--accent); color:#fff; border-radius:7px; font:inherit; font-weight:700; font-size:13px; padding:7px 14px; cursor:pointer; }
  .list { list-style:none; margin:0; padding:0; }
  .q { border-top:1px solid var(--line); }
  .q:first-child { border-top:0; }
  .q.off { opacity:.55; }
  .row { display:flex; align-items:flex-start; gap:10px; padding:10px 2px; }
  .tx { flex:1; min-width:0; }
  .quote { display:block; color:var(--fg); font-size:14px; line-height:1.45; }
  .by { display:block; font-size:12.5px; color:var(--muted); margin-top:2px; }
  .lk { flex:none; border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); border-radius:7px; font:inherit; font-size:12.5px; font-weight:600; padding:5px 11px; cursor:pointer; }
  .lk:hover { border-color:var(--accent); color:var(--accent); }
  .lk.danger:hover { border-color:var(--danger, #e06c6c); color:var(--danger, #e06c6c); }
  .muted { color:var(--muted); }
`;
  var GbtiQuoteManager = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this.load();
    }
    async load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        this._quotes = (await this.client.quotePool())?.quotes || [];
      } catch {
        this._quotes = [];
        this._msg = "Could not load the quotes.";
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS8) + `<p class="muted">Open in the GBTI client (admin) to manage quotes.</p>`);
        return;
      }
      if (!this._quotes) {
        this.set(this.css(CSS8) + `<p class="muted">Loading quotes...</p>`);
        return;
      }
      const enabled = this._quotes.filter((q) => q && q.enabled !== false).length;
      const rows = this._quotes.map((q) => {
        const on = q && q.enabled !== false;
        return `<li class="q ${on ? "" : "off"}"><div class="row"><span class="tx"><span class="quote">${esc(q.text || "")}</span><span class="by">${esc(q.author || "")}</span></span><button class="lk" type="button" data-toggle="${esc(q.text || "")}" data-on="${on ? "1" : "0"}">${on ? "Disable" : "Enable"}</button><button class="lk danger" type="button" data-remove="${esc(q.text || "")}">Remove</button></div></li>`;
      }).join("");
      this.set(this.css(CSS8) + `<div class="${this._busy ? "busy" : ""}">
      <div class="head"><h3>Splash quotes</h3><span class="hint">${this._quotes.length} quotes, ${enabled} enabled &middot; edits open an auto-merged house PR</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ""}
      <div class="add">
        <textarea data-add-text placeholder="The quote text"></textarea>
        <input data-add-author type="text" placeholder="Author" />
        <button class="btn" type="button" data-add>Add quote</button>
      </div>
      <p class="hint" style="margin:-6px 0 14px">The new-tab splash shows one enabled quote, rotating every 12 hours. Disable a quote to retire it without losing the history.</p>
      <ul class="list">${rows || '<li class="muted">No quotes yet.</li>'}</ul>
    </div>`);
      this._wire();
    }
    _wire() {
      this.on("[data-add]", "click", () => {
        const text = (this.$("[data-add-text]")?.value || "").trim();
        const author = (this.$("[data-add-author]")?.value || "").trim();
        if (!text) {
          this._msg = "A quote text is required.";
          this.render();
          return;
        }
        if (!author) {
          this._msg = "An author is required.";
          this.render();
          return;
        }
        this._run(() => this.client.addQuote({ text, author }));
      });
      this.$$("[data-toggle]").forEach((b) => b.addEventListener("click", () => this._run(() => this.client.setQuoteEnabled({ text: b.dataset.toggle, enabled: b.dataset.on !== "1" }))));
      this.$$("[data-remove]").forEach((b) => b.addEventListener("click", () => {
        const text = b.dataset.remove;
        if (typeof confirm === "function" && !confirm(`Remove this quote?

"${text}"`)) return;
        this._run(() => this.client.removeQuote({ text }));
      }));
    }
    async _run(fn) {
      this._busy = true;
      this._msg = "";
      this.render();
      try {
        const r = await fn();
        this._msg = r?.noop ? "No change (already in that state)." : r?.number ? `Opened PR #${r.number} (auto-merges; the list updates after it lands + the site redeploys).` : "Done.";
      } catch (e) {
        this._msg = e?.message || "That edit failed.";
      }
      this._busy = false;
      await this.load();
    }
  };
  define("gbti-quote-manager", GbtiQuoteManager);

  // client-ui/src/elements/gbti-syndication-tracker.mjs
  var CSS9 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; gap:10px; margin:0 0 8px; }
  .head h3 { margin:0; font-size:15px; }
  .hint { color:var(--muted); font-size:12px; }
  .msg { font-size:13px; color:var(--accent); margin:6px 0; }
  .msg.err { color:var(--danger); }
  .muted { color:var(--muted); font-size:13.5px; }
  .bucket { margin:0 0 18px; }
  .bucket h4 { margin:0 0 8px; font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .it { flex:1; min-width:0; }
  .it b { font-size:14px; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it .d { font-size:12px; color:var(--muted); }
  .src { flex:none; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .when { flex:none; font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .chs { display:flex; gap:5px; flex-wrap:wrap; }
  .ch { font-size:11px; border-radius:999px; padding:1px 7px; border:1px solid var(--line); color:var(--muted); }
  .ch.sent { color:var(--accent); border-color:var(--accent); } .ch.failed { color:var(--danger); border-color:var(--danger); }
  .ch.skipped { opacity:.7; }
  .cancel { flex:none; font:inherit; font-size:12.5px; font-weight:600; color:var(--danger); background:none; border:1px solid var(--line); border-radius:6px; padding:5px 10px; cursor:pointer; }
  .cancel:hover { border-color:var(--danger); }
  .approve { flex:none; font:inherit; font-size:12.5px; font-weight:700; color:#fff; background:var(--accent); border:1px solid var(--accent); border-radius:6px; padding:5px 12px; cursor:pointer; }
  .approve:hover { filter:brightness(1.05); }
  .busy { opacity:.55; pointer-events:none; }
`;
  var SRC_LABEL = { share: "Share", post: "Article", product: "Product", prompt: "Prompt" };
  var GbtiSyndicationTracker = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._data = null;
      this._msg = "";
      this._err = false;
      this._busy = false;
      this.load();
    }
    async load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        this._data = await this.client.syndicationQueue();
        this._err = false;
      } catch (e) {
        this._data = null;
        this._err = true;
        this._msg = e?.message || "Could not load the syndication queue.";
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS9) + `<p class="muted">Open in the GBTI client (admin) to view syndication.</p>`);
        return;
      }
      if (this._err) {
        this.set(this.css(CSS9) + `<div class="head"><h3>Syndication</h3></div><p class="msg err">${esc(this._msg)}</p><button class="cancel" data-reload type="button" style="color:var(--accent)">Retry</button>`);
        this.$("[data-reload]")?.addEventListener("click", () => this.load());
        return;
      }
      if (!this._data) {
        this.set(this.css(CSS9) + `<p class="muted">Loading syndication queue...</p>`);
        return;
      }
      const d = this._data;
      this.set(this.css(CSS9) + `<div class="${this._busy ? "busy" : ""}">
      <div class="head"><h3>Syndication queue</h3><span class="hint">Nothing posts until a superadmin approves it. Approved items post to every enabled channel on the next tick.</span></div>
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ""}
      ${this._bucket("Pending approval", d.pending, "pending")}
      ${this._bucket("Approved", d.approved, "approved")}
      ${this._bucket("Sent", d.sent, "done")}
      ${this._bucket("Failed", d.failed, "done")}
      ${this._bucket("Cancelled", d.cancelled, "done")}
    </div>`);
      this.$$("[data-approve]").forEach((b) => b.addEventListener("click", () => this._approve(b.dataset.approve)));
      this.$$("[data-cancel]").forEach((b) => b.addEventListener("click", () => this._cancel(b.dataset.cancel)));
    }
    _bucket(label, items, mode) {
      const list = Array.isArray(items) ? items : [];
      if (!list.length) return `<div class="bucket"><h4>${esc(label)} (0)</h4><p class="muted">None.</p></div>`;
      const rows = list.map((it) => {
        const src = SRC_LABEL[it.source] || it.source || "";
        const title = it.title || it.targetSlug || it.id || "(untitled)";
        let right;
        if (mode === "pending") {
          right = `<button class="approve" data-approve="${esc(it.id)}" type="button">Approve</button><button class="cancel" data-cancel="${esc(it.id)}" type="button">Reject</button>`;
        } else if (mode === "approved") {
          right = `<span class="when">posting soon</span><button class="cancel" data-cancel="${esc(it.id)}" type="button">Cancel</button>`;
        } else {
          right = `<span class="chs">${this._channels(it.perChannel)}</span>`;
        }
        return `<li class="row"><span class="src">${esc(src)}</span><span class="it"><b>${esc(title)}</b>${it.url ? `<span class="d">${esc(it.url)}</span>` : ""}</span>${right}</li>`;
      }).join("");
      return `<div class="bucket"><h4>${esc(label)} (${list.length})</h4><ul class="rows">${rows}</ul></div>`;
    }
    _channels(perChannel) {
      if (!perChannel || typeof perChannel !== "object") return "";
      return Object.entries(perChannel).map(([name, r]) => {
        const status2 = r?.status || "pending";
        const link = r?.url ? `<a class="ch ${esc(status2)}" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(name)}</a>` : `<span class="ch ${esc(status2)}">${esc(name)}: ${esc(status2)}</span>`;
        return link;
      }).join("");
    }
    async _approve(id) {
      if (!id) return;
      this._busy = true;
      this.render();
      try {
        const r = await this.client.approveSyndication({ id });
        this._msg = r?.approved ? "Approved. It posts to every enabled channel on the next tick." : `Could not approve (status: ${r?.status || "unknown"}).`;
        await this.load();
      } catch (e) {
        this._msg = e?.message || "Approve failed.";
      } finally {
        this._busy = false;
        this.render();
      }
    }
    async _cancel(id) {
      if (!id) return;
      if (typeof confirm === "function" && !confirm("Reject this syndication item? It will not be posted.")) return;
      this._busy = true;
      this.render();
      try {
        const r = await this.client.cancelSyndication({ id });
        this._msg = r?.cancelled ? "Removed from the queue." : `Could not cancel (status: ${r?.status || "unknown"}).`;
        await this.load();
      } catch (e) {
        this._msg = e?.message || "Cancel failed.";
      } finally {
        this._busy = false;
        this.render();
      }
    }
  };
  define("gbti-syndication-tracker", GbtiSyndicationTracker);

  // client-ui/src/inline.mjs
  var TYPE_RE = /^(post|product|prompt|profile)$/;
  function readHooks(dataset = {}) {
    const path = dataset.gbtiPath || null;
    const type = TYPE_RE.test(dataset.gbtiType || "") ? dataset.gbtiType : null;
    if (!path || !type) return null;
    return { path, type, slug: dataset.gbtiSlug || null, owner: dataset.gbtiOwner || null };
  }
  function canEditInPlace(hooks, identity) {
    if (!hooks || !identity?.username) return false;
    return hooks.path.startsWith(`members/${String(identity.username).toLowerCase()}/`);
  }
  function toPublishPayload(item, edits = {}) {
    if (!item || !item.frontmatter) throw new Error("no item to edit");
    const input = { ...item.frontmatter, ...edits.fields || {} };
    if (edits.title != null) input.title = edits.title;
    const type = input.type || item.type || edits.type;
    const body = edits.body != null ? edits.body : item.body;
    return { type, input, body };
  }

  // client-ui/src/elements/gbti-edit-panel.mjs
  var GbtiEditPanel = class extends GbtiElement {
    constructor() {
      super();
      this.item = null;
      this.editing = false;
      this.original = null;
      this.membership = "unknown";
    }
    hooks() {
      const fromSelf = readHooks(this.dataset || {});
      if (fromSelf) return fromSelf;
      const marked = typeof document !== "undefined" ? document.querySelector("[data-gbti-path]") : null;
      return marked ? readHooks(marked.dataset) : null;
    }
    titleEl() {
      return typeof document !== "undefined" ? document.querySelector(this.getAttribute("title-selector") || '[data-gbti-region="title"]') : null;
    }
    bodyEl() {
      return typeof document !== "undefined" ? document.querySelector(this.getAttribute("body-selector") || '[data-gbti-region="body"]') : null;
    }
    async render() {
      if (!this.client) return;
      const hooks = this.hooks();
      const id = await getIdentity();
      if (!hooks || !canEditInPlace(hooks, id)) {
        this.set("");
        return;
      }
      const blocked = this.membership !== "paid" && this.membership !== "unknown";
      const editingBar = blocked ? `<span class="muted" id="msg">Membership required to publish</span><button id="save" title="Publishing requires a paid membership">Upgrade to publish</button><button class="ghost" id="cancel">Cancel</button>` : `<span class="muted" id="msg">Editing in place</span><button id="save">Publish</button><button class="ghost" id="cancel">Cancel</button>`;
      this.set(
        this.css(`
        .bar { position: fixed; right: 18px; bottom: 18px; z-index: 2147483000; display:flex; gap:8px; align-items:center;
               background: var(--panel); border:1px solid var(--line); border-radius: 999px; padding: 8px 12px; box-shadow: 0 8px 30px rgba(0,0,0,.4); }
        .bar .muted { font-size: 13px; }
      `) + `<div class="bar">
           ${this.editing ? editingBar : `<span class="muted">You own this</span><button id="edit">Edit this page</button>`}
         </div>`
      );
      if (this.editing) {
        this.on("#save", "click", () => this.save());
        this.on("#cancel", "click", () => this.cancel());
      } else {
        this.on("#edit", "click", () => this.enter(hooks));
      }
    }
    async enter(hooks) {
      try {
        this.membership = (await this.client.status())?.membership ?? "unknown";
      } catch {
        this.membership = "unknown";
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
        title.setAttribute("contenteditable", "true");
        title.dataset.gbtiEditing = "true";
        title.focus?.();
      }
      if (body) {
        const ta = document.createElement("textarea");
        ta.value = this.item.body || "";
        ta.setAttribute("data-gbti-body-input", "true");
        ta.style.cssText = "width:100%;min-height:320px;font-family:ui-monospace,monospace;font-size:14px;padding:12px;";
        body.replaceChildren(ta);
      }
      this.editing = true;
      this.render();
    }
    collect() {
      const title = this.titleEl();
      const ta = typeof document !== "undefined" ? document.querySelector("[data-gbti-body-input]") : null;
      return {
        title: title ? title.textContent.trim() : void 0,
        body: ta ? ta.value : void 0
      };
    }
    async save() {
      this.flash("Publishing…");
      try {
        const edits = this.collect();
        const payload = toPublishPayload(this.item, edits);
        const res = await this.client.publish(payload);
        this.teardown();
        this.editing = false;
        this.render();
        this.flash(`Published: PR #${res.prNumber}`);
        this.emit("gbti-published", res);
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
        title.removeAttribute("contenteditable");
        delete title.dataset.gbtiEditing;
        if (restore && this.original?.titleText != null) title.textContent = this.original.titleText;
      }
      const body = this.bodyEl();
      if (body && restore && this.original?.bodyHtml != null) body.innerHTML = this.original.bodyHtml;
    }
    flash(msg, bad = false) {
      const el = this.$("#msg") || this.$(".muted");
      if (el) {
        el.textContent = msg;
        el.className = bad ? "danger" : "muted";
      }
    }
  };
  define("gbti-edit-panel", GbtiEditPanel);

  // client-ui/src/elements/gbti-locked-content.mjs
  var CLIP_LINES = 8;
  var PROSE = `
  .state, .locked { color: var(--muted); font-size: 14px; padding: 10px 0; }
  .locked a { color: var(--accent); font-weight: 600; }
  .unlocked :is(h1,h2,h3,h4) { font-weight: 700; margin: 1em 0 .4em; line-height: 1.25; }
  .unlocked p { margin: 0 0 1em; line-height: 1.6; }
  .unlocked ul, .unlocked ol { margin: 0 0 1em 1.2em; }
  .unlocked a { color: var(--accent); }
  .unlocked pre { background: var(--panel); padding: 12px; border-radius: 8px; overflow:auto; }
  .unlocked code { font-family: ui-monospace, monospace; }
  /* clip/reveal for a long code block */
  .codeclip { position: relative; margin: 0 0 1em; }
  .codeclip pre { margin: 0; }
  .codeclip-inner { position: relative; }
  .codeclip.collapsed .codeclip-inner pre { max-height: calc(${CLIP_LINES} * 1.5em + 24px); overflow: hidden; }
  .codeclip.collapsed .codeclip-inner::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3.2em;
    background: linear-gradient(to bottom, transparent, var(--panel)); pointer-events: none; border-radius: 0 0 8px 8px;
  }
  .codeclip-toggle {
    display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; padding: 4px 11px;
    font: inherit; font-size: 13px; font-weight: 600; line-height: 1.2;
    background: transparent; color: var(--accent); border: 1px solid var(--line, rgba(127,127,127,.32));
    border-radius: 6px; cursor: pointer;
  }
  .codeclip-toggle:hover { background: var(--panel); }
`;
  var GbtiLockedContent = class extends GbtiElement {
    async render() {
      const encPath = this.dataset?.gbtiEnc || this.getAttribute?.("data-gbti-enc");
      if (!this.client || !encPath) return;
      this.set(this.css(PROSE) + `<div class="state">Unlocking member content…</div>`);
      let text;
      try {
        ({ text } = await this.client.decrypt({ encPath }));
      } catch (err) {
        const locked = err?.code === "membership-required" || err?.code === "not-authenticated";
        this.set(this.css(PROSE) + `<div class="locked">${locked ? 'This content is for members. <a href="/membership/">Become a member</a> to unlock.' : "This content could not be unlocked right now."}</div>`);
        return;
      }
      let html = "";
      try {
        html = (await this.client.preview({ body: text }))?.html ?? "";
      } catch {
        html = "";
      }
      this.set(this.css(PROSE) + `<div class="unlocked">${html}</div>`);
      this.clipLongCode();
      this.emit("gbti-unlocked", { encPath });
    }
    /** Clip any long <pre> in the rendered body to CLIP_LINES with a Show more / Show less toggle. */
    clipLongCode() {
      const doc = this.root?.ownerDocument || (typeof document !== "undefined" ? document : null);
      if (!doc) return;
      for (const pre of this.$$(".unlocked pre")) {
        const lines = (pre.textContent || "").replace(/\n$/, "").split("\n").length;
        if (lines <= CLIP_LINES + 1) continue;
        const clip = doc.createElement("div");
        clip.className = "codeclip collapsed";
        const inner = doc.createElement("div");
        inner.className = "codeclip-inner";
        pre.replaceWith(clip);
        inner.appendChild(pre);
        clip.appendChild(inner);
        const btn = doc.createElement("button");
        btn.type = "button";
        btn.className = "codeclip-toggle";
        btn.textContent = `Show more (${lines} lines)`;
        btn.addEventListener("click", () => {
          const collapsed = clip.classList.toggle("collapsed");
          btn.textContent = collapsed ? `Show more (${lines} lines)` : "Show less";
        });
        clip.appendChild(btn);
      }
    }
  };
  define("gbti-locked-content", GbtiLockedContent);

  // client-ui/src/elements/gbti-favorite.mjs
  var heart = (filled) => `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 7.6 3.7 3.7 0 0 1 19 10.7c0 4.9-7 9.3-7 9.3z" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  var CSS10 = `
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  .pill svg { flex:none; }
  .pill .c { font-variant-numeric: tabular-nums; }
`;
  var GbtiFavorite = class extends GbtiElement {
    render() {
      const targetType = this.dataset?.gbtiTargetType;
      const targetSlug = this.dataset?.gbtiTargetSlug;
      if (this._count === void 0) {
        const n = parseInt(this.dataset?.gbtiCount || "0", 10);
        this._count = Number.isFinite(n) && n > 0 ? n : 0;
      }
      if (this._faved === void 0) this._faved = false;
      const c = Math.max(0, this._count);
      const label = !this.client ? "Sign in to favorite" : this._faved ? "Remove favorite" : "Add favorite";
      this.set(
        this.css(CSS10) + `<button class="pill ${this._faved ? "on" : ""}" type="button" aria-pressed="${this._faved}" aria-label="${label}">${heart(this._faved)}${c > 0 ? `<span class="c">${c}</span>` : ""}</button>`
      );
      this.on(".pill", "click", () => this._onClick(targetType, targetSlug));
    }
    _onClick(targetType, targetSlug) {
      if (!this.client) {
        window.location.href = "/membership/";
        return;
      }
      this._toggle(targetType, targetSlug);
    }
    async _toggle(targetType, targetSlug) {
      const next = !this._faved;
      this._faved = next;
      this._count = Math.max(0, this._count + (next ? 1 : -1));
      this.render();
      try {
        const res = await this.client.toggleFavorite({ targetType, targetSlug, on: next });
        if (res && typeof res.favorited === "boolean" && res.favorited !== next) {
          this._count = Math.max(0, this._count - (next ? 1 : -1));
          this._faved = res.favorited;
          this.render();
        }
      } catch (err) {
        this._faved = !next;
        this._count = Math.max(0, this._count + (next ? -1 : 1));
        this.render();
        if (err?.code === "not-authenticated" || err?.code === "membership-required") window.location.href = "/membership/";
      }
    }
  };
  define("gbti-favorite", GbtiFavorite);

  // client-ui/src/elements/gbti-collection.mjs
  var folder = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M4 7a2 2 0 0 1 2-2h3.2l1.6 2H18a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>`;
  var CSS11 = `
  :host { position: relative; display: inline-flex; }
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  .pop { position:absolute; z-index:50; top:calc(100% + 8px); left:0; width:260px; max-height:340px; overflow:auto;
    background:var(--panel); color:var(--fg); border:1px solid var(--line); border-radius:12px;
    box-shadow:0 12px 36px rgba(0,0,0,.18); padding:10px; }
  .pop h4 { margin:2px 6px 8px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  .row { display:flex; align-items:center; gap:8px; padding:7px 8px; border-radius:8px; cursor:pointer; font-size:13.5px; }
  .row:hover { background:var(--hover, rgba(0,0,0,.04)); }
  .row .box { width:16px; height:16px; border:1.5px solid var(--line); border-radius:4px; display:inline-flex; align-items:center; justify-content:center; flex:none; color:#fff; }
  .row.in .box { background:var(--brand); border-color:var(--brand); }
  .row .nm { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .empty { padding:8px; font-size:12.5px; color:var(--muted); }
  .new { display:flex; gap:6px; margin-top:8px; border-top:1px solid var(--line); padding-top:10px; }
  .new input { flex:1; min-width:0; font:inherit; font-size:13px; padding:6px 8px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  .new button { font:inherit; font-size:13px; font-weight:600; padding:6px 12px; border:0; border-radius:8px; background:var(--brand); color:#fff; cursor:pointer; }
  .busy { opacity:.55; pointer-events:none; }
`;
  var GbtiCollection = class extends GbtiElement {
    render() {
      const open = this._open ? this._renderPop() : "";
      const label = !this.client ? "Sign in to save to a collection" : "Save to a collection";
      this.set(this.css(CSS11) + `<button class="pill ${this._inAny() ? "on" : ""}" type="button" aria-haspopup="true" aria-expanded="${!!this._open}" aria-label="${label}">${folder}<span>Save</span></button>${open}`);
      this.on(".pill", "click", (e) => {
        e.stopPropagation();
        this._toggleOpen();
      });
      if (this._open) this._wirePop();
    }
    _inAny() {
      const t = this._target();
      return (this._collections || []).some((c) => (c.items || []).some((it) => it.type === t.type && it.slug === t.slug));
    }
    _target() {
      return { type: this.dataset?.gbtiTargetType, slug: this.dataset?.gbtiTargetSlug };
    }
    async _toggleOpen() {
      if (!this.client) {
        window.location.href = "/membership/";
        return;
      }
      this._open = !this._open;
      if (this._open) {
        this.render();
        await this._load();
        this._away = (ev) => {
          if (!this.contains(ev.target)) this._close();
        };
        this._esc = (ev) => {
          if (ev.key === "Escape") this._close();
        };
        document.addEventListener("click", this._away);
        document.addEventListener("keydown", this._esc);
      } else {
        this._close();
      }
    }
    _close() {
      this._open = false;
      if (this._away) document.removeEventListener("click", this._away);
      if (this._esc) document.removeEventListener("keydown", this._esc);
      this.render();
    }
    async _load() {
      try {
        const a = await this.client.getActivity();
        this._collections = a?.collections || [];
      } catch (err) {
        if (err?.code === "not-authenticated" || err?.code === "membership-required") {
          window.location.href = "/membership/";
          return;
        }
        this._collections = [];
      }
      this.render();
    }
    _renderPop() {
      const t = this._target();
      const rows = (this._collections || []).map((c) => {
        const inIt = (c.items || []).some((it) => it.type === t.type && it.slug === t.slug);
        return `<div class="row ${inIt ? "in" : ""}" data-id="${c.id}"><span class="box">${inIt ? "✓" : ""}</span><span class="nm">${escapeHtml(c.name)}</span></div>`;
      }).join("");
      return `<div class="pop ${this._busy ? "busy" : ""}"><h4>Save to collection</h4>${rows || '<div class="empty">No collections yet. Create one below.</div>'}<div class="new"><input type="text" placeholder="New collection" maxlength="80" /><button type="button">Create</button></div></div>`;
    }
    _wirePop() {
      this.$$(".row").forEach((row) => row.addEventListener("click", () => this._toggleItem(row.dataset.id)));
      const input = this.$(".new input");
      const create = () => this._create(input?.value || "");
      this.on(".new button", "click", create);
      if (input) input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") create();
      });
    }
    async _toggleItem(id) {
      const t = this._target();
      const c = (this._collections || []).find((x) => x.id === id);
      if (!c) return;
      const on = !(c.items || []).some((it) => it.type === t.type && it.slug === t.slug);
      this._busy = true;
      this.render();
      try {
        const res = await this.client.addToCollection({ id, targetType: t.type, targetSlug: t.slug, on });
        this._collections = res?.activity?.collections || this._collections;
      } catch (err) {
        if (err?.code === "not-authenticated" || err?.code === "membership-required") {
          window.location.href = "/membership/";
          return;
        }
      }
      this._busy = false;
      this.render();
    }
    async _create(name) {
      const nm = String(name || "").trim();
      if (!nm) return;
      const t = this._target();
      this._busy = true;
      this.render();
      try {
        const made = await this.client.createCollection({ name: nm });
        this._collections = made?.activity?.collections || this._collections;
        if (made?.id) {
          const res = await this.client.addToCollection({ id: made.id, targetType: t.type, targetSlug: t.slug, on: true });
          this._collections = res?.activity?.collections || this._collections;
        }
      } catch (err) {
        if (err?.code === "not-authenticated" || err?.code === "membership-required") {
          window.location.href = "/membership/";
          return;
        }
      }
      this._busy = false;
      this.render();
    }
  };
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  }
  define("gbti-collection", GbtiCollection);

  // client-ui/src/elements/gbti-subscribe.mjs
  var mega = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="margin-right:6px"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V6.5L6 10H4a1 1 0 0 0-1 1zM14 8v8c1.7-.6 3-2.4 3-4s-1.3-3.4-3-4zm0-4.2v2.1c2.9.9 5 3.7 5 6.1s-2.1 5.2-5 6.1v2.1c4-.9 7-4.4 7-8.2s-3-7.3-7-8.2z" fill="currentColor"/></svg>`;
  var CSS12 = `
  .btn { display:inline-flex; align-items:center; cursor:pointer; font-family:var(--font-body);
    font-size:14px; font-weight:600; border-radius:10px; padding:9px 16px;
    border:1.5px solid var(--brand); background:var(--brand); color:#08231a;
    transition:background .15s ease, color .15s ease, border-color .15s ease; }
  .btn:hover { background:var(--brand-dark); border-color:var(--brand-dark); }
  .btn.on { background:transparent; color:var(--brand); }
  .btn.on:hover { border-color:var(--danger); color:var(--danger); }
  .btn[disabled] { opacity:.6; cursor:default; }
`;
  var GbtiSubscribe = class extends GbtiElement {
    static get observedAttributes() {
      return ["data-gbti-username"];
    }
    attributeChangedCallback(name, oldV, newV) {
      if (name === "data-gbti-username" && oldV !== newV) {
        this._loaded = false;
        this._following = void 0;
        if (this.isConnected) this.render();
      }
    }
    get _username() {
      const u = (this.dataset?.gbtiUsername || "").trim().toLowerCase();
      return /^[a-z0-9](?:-?[a-z0-9])*$/.test(u) ? u : "";
    }
    render() {
      const username = this._username;
      const following = this._following === true;
      const known = this._following !== void 0;
      const label = !known ? "Subscribe to activity" : following ? "Following" : "Subscribe to activity";
      const onCls = following ? "on" : "";
      this.set(
        this.css(CSS12) + `<button class="btn ${onCls}" type="button" aria-pressed="${following}" ${username ? "" : "disabled"} aria-label="${label}">${mega}<span class="t">${label}</span></button>`
      );
      this.on(".btn", "click", () => this._onClick());
      if (this.client && username && !this._loaded) this._loadState(username);
    }
    async _loadState(username) {
      this._loaded = true;
      try {
        const r = await this.client.getFollows();
        const list = Array.isArray(r) ? r : r?.following ?? [];
        this._following = list.some((e) => (e?.username || "").toLowerCase() === username);
        this._canFollow = true;
      } catch {
        this._canFollow = false;
      }
      this.render();
    }
    _onClick() {
      const username = this._username;
      if (!username) return;
      if (!this.client || this._canFollow === false) {
        window.location.href = "/membership/";
        return;
      }
      this._toggle(username);
    }
    async _toggle(username) {
      const next = !(this._following === true);
      this._following = next;
      this.render();
      try {
        const r = await this.client.setFollow({ username, on: next });
        const list = Array.isArray(r) ? r : r?.following ?? null;
        if (list) this._following = list.some((e) => (e?.username || "").toLowerCase() === username);
        this.render();
      } catch (err) {
        this._following = !next;
        this.render();
        if (err?.code === "not-authenticated" || err?.code === "follows-failed" || /paid|sign in/i.test(err?.message || "")) {
          window.location.href = "/membership/";
        }
      }
    }
  };
  define("gbti-subscribe", GbtiSubscribe);

  // client-ui/src/elements/gbti-share-composer.mjs
  var LOCKED2 = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var CSS13 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:16px; }
  h3 { margin:0 0 4px; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .sub { margin:0 0 12px; font-size:13px; color:var(--muted); }
  textarea { width:100%; box-sizing:border-box; min-height:84px; resize:vertical; font:inherit; font-size:14px;
    padding:10px 12px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  textarea:focus { outline:none; border-color:var(--brand); }
  input.title, input.desc { width:100%; box-sizing:border-box; font:inherit; padding:9px 12px; margin-bottom:8px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  input.title { font-size:15px; font-weight:700; }
  input.desc { font-size:13px; }
  input.title:focus, input.desc:focus { outline:none; border-color:var(--brand); }
  .row { display:flex; gap:8px; margin-top:8px; flex-wrap:wrap; align-items:center; }
  input[type=url] { flex:1; min-width:160px; box-sizing:border-box; font:inherit; font-size:13px; padding:8px 10px;
    border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  select { font:inherit; font-size:13px; padding:8px 10px; border:1.5px solid var(--line); border-radius:10px; background:var(--panel); color:var(--fg); }
  .actions { display:flex; justify-content:flex-end; align-items:center; gap:10px; margin-top:12px; }
  button.post { font:inherit; font-weight:700; font-size:14px; padding:9px 18px; border:0; border-radius:10px; background:var(--brand); color:#fff; cursor:pointer; }
  button.post[disabled] { opacity:.5; cursor:default; }
  .msg { font-size:13px; }
  .msg.err { color:#c0392b; }
  .msg.ok { color:var(--brand); }
  .notice { display:flex; gap:12px; align-items:flex-start; padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--hover, rgba(0,0,0,.03)); }
  .notice h3 { margin-bottom:2px; }
  .notice a { color:var(--brand); font-weight:600; }
  .lock { font-size:22px; line-height:1; }
  .busy { opacity:.55; pointer-events:none; }
  .og { margin-top:10px; }
  .og .ogmsg { font-size:12.5px; color:var(--muted); }
  .og .ogimg { display:block; max-width:100%; max-height:200px; object-fit:cover; border-radius:10px; border:1px solid var(--line); }
  .og .ogclear { margin-top:6px; font:inherit; font-size:12px; background:none; border:0; color:var(--muted); cursor:pointer; padding:0; }
  .og .ogclear:hover { color:var(--brand); text-decoration:underline; }
`;
  var GbtiShareComposer = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._loadStatus();
    }
    async _loadStatus() {
      if (!this.client) {
        this._membership = null;
        this.render();
        return;
      }
      try {
        const s = await this.client.status();
        this._membership = s?.membership ?? "unknown";
      } catch {
        this._membership = "unknown";
      }
      this.render();
    }
    render() {
      const m = this._membership;
      if (!this.client) return this.set(this.css(CSS13) + this._noticeHtml("Open in the GBTI client", "Shares are posted from the GBTI browser extension or the desktop client. Open it to share an update.", "🧩"));
      if (m === void 0) return this.set(this.css(CSS13) + `<div class="card"><p class="sub">Loading…</p></div>`);
      if (LOCKED2.has(m)) return this._renderLocked();
      if (m === "trialing") return this._renderTrial();
      return this._renderComposer();
    }
    _noticeHtml(title, body, glyph) {
      return `<div class="notice"><span class="lock">${glyph}</span><div><h3>${esc(title)}</h3><p class="sub" style="margin:0">${body}</p></div></div>`;
    }
    _renderLocked() {
      this.set(this.css(CSS13) + this._noticeHtml(
        "Your access is locked",
        'Your membership has lapsed, so Shares are locked. <a href="https://gbti.network/membership/">Renew your membership</a> to read and post in the community stream again.',
        "🔒"
      ));
    }
    _renderTrial() {
      this.set(this.css(CSS13) + this._noticeHtml(
        "Reading only on the free trial",
        'On the trial you can READ the community Shares stream. Posting Shares is a paid feature. <a href="https://gbti.network/membership/">Upgrade your membership</a> to post.',
        "👀"
      ));
    }
    _renderComposer() {
      this.set(this.css(CSS13) + `
      <div class="card">
        <h3>Share an update</h3>
        <p class="sub">A short note or an off-network link for the co-op. Members-only by default.</p>
        <input class="title" type="text" placeholder="Title (optional)" maxlength="80" />
        <input class="desc" type="text" placeholder="Short description (optional)" maxlength="200" />
        <textarea placeholder="What are you reading, building, or finding?" maxlength="4000"></textarea>
        <div class="row">
          <input type="url" placeholder="https://… (optional link)" />
          <select aria-label="Visibility">
            <option value="members">Members only</option>
            <option value="public">Public</option>
          </select>
        </div>
        <div class="og" data-og hidden></div>
        <div class="actions">
          <span class="msg" aria-live="polite"></span>
          <button class="post" type="button">Post Share</button>
        </div>
      </div>`);
      this._image = null;
      this.on(".post", "click", () => this._post());
      this.on("input[type=url]", "change", () => this._fetchPreview());
    }
    // Fetch the link preview server-side (the Worker is SSRF-guarded). Updates ONLY the preview area + soft-prefills
    // EMPTY title/desc fields (never clobbering author text), so it does not re-render the composer.
    async _fetchPreview() {
      const url = (this.$("input[type=url]")?.value || "").trim();
      const box = this.$("[data-og]");
      if (!box) return;
      if (!/^https?:\/\//i.test(url) || !this.client?.ogPreview) {
        this._image = null;
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      box.hidden = false;
      box.innerHTML = `<span class="ogmsg">Fetching preview…</span>`;
      try {
        const og = await this.client.ogPreview({ url });
        const t = this.$("input.title");
        if (t && !t.value.trim() && og?.title) t.value = String(og.title).slice(0, 80);
        const d = this.$("input.desc");
        if (d && !d.value.trim() && og?.description) d.value = String(og.description).slice(0, 200);
        this._image = og?.image || null;
        if (this._image) {
          box.innerHTML = `<img class="ogimg" src="${esc(this._image)}" alt="" /><button class="ogclear" type="button" data-ogclear>Remove image</button>`;
          const clr = box.querySelector("[data-ogclear]");
          if (clr) clr.addEventListener("click", () => {
            this._image = null;
            box.hidden = true;
            box.innerHTML = "";
          });
        } else {
          box.hidden = true;
          box.innerHTML = "";
        }
      } catch {
        this._image = null;
        box.hidden = true;
        box.innerHTML = "";
      }
    }
    async _post() {
      const card = this.$(".card");
      const title = (this.$("input.title")?.value || "").trim();
      const shortDescription = (this.$("input.desc")?.value || "").trim();
      const body = (this.$("textarea")?.value || "").trim();
      const url = (this.$("input[type=url]")?.value || "").trim();
      const visibility = this.$("select")?.value || "members";
      const msg = this.$(".msg");
      if (!body && !url && !title) {
        this._say(msg, "Add a title, a note, or a link first.", "err");
        return;
      }
      card?.classList.add("busy");
      try {
        const input = { visibility };
        if (title) input.title = title;
        if (shortDescription) input.shortDescription = shortDescription;
        if (url) input.url = url;
        if (this._image) input.image = this._image;
        const res = await this.client.postShare({ input, body });
        this._say(msg, res?.encrypted ? "Posted (members-only)." : "Posted.", "ok");
        for (const sel of ["input.title", "input.desc", "textarea", "input[type=url]"]) {
          const el = this.$(sel);
          if (el) el.value = "";
        }
        this._image = null;
        const ogBox = this.$("[data-og]");
        if (ogBox) {
          ogBox.hidden = true;
          ogBox.innerHTML = "";
        }
        this.emit("gbti-share-posted", res);
      } catch (err) {
        if (err?.code === "membership-required") {
          this._say(msg, "Posting Shares requires a paid membership.", "err");
        } else {
          this._say(msg, err?.message || "Could not post the Share.", "err");
        }
      } finally {
        card?.classList.remove("busy");
      }
    }
    _say(el, text, kind) {
      if (!el) return;
      el.textContent = text;
      el.className = `msg ${kind || ""}`;
    }
  };
  define("gbti-share-composer", GbtiShareComposer);

  // client-ui/src/all-merge.mjs
  var SHARE_OK = /* @__PURE__ */ new Set(["paid", "trialing"]);
  function canSeeShares(membership) {
    return SHARE_OK.has(String(membership || "").toLowerCase());
  }
  function toMs(v) {
    if (v == null) return 0;
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    const t = Date.parse(v);
    return Number.isNaN(t) ? 0 : t;
  }
  function hostOf2(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "link";
    }
  }
  function shareTitle(it) {
    return it.title || it.shortDescription || (it.url ? `Link: ${hostOf2(it.url)}` : "Member share");
  }
  function shareToItem(it) {
    return {
      ...it,
      type: "share",
      title: shareTitle(it),
      excerpt: it.title ? it.shortDescription || "" : "",
      thumb: it.image || null,
      // SOW-057: the featured image drives the unified card thumbnail
      createdAt: it.createdAt
    };
  }
  function mergeAll({ items = [], shares = null, membership = "unknown" } = {}) {
    const out = Array.isArray(items) ? items.slice() : [];
    if (Array.isArray(shares)) {
      const memberOk = canSeeShares(membership);
      for (const s of shares) {
        const isPublic = String(s.visibility || "members").toLowerCase() === "public";
        if (isPublic || memberOk) out.push(shareToItem(s));
      }
    }
    return out.sort((a, b) => toMs(b.createdAt ?? b.publishedAt) - toMs(a.createdAt ?? a.publishedAt));
  }

  // client-ui/src/cat-glyph.mjs
  var GLYPH_SVG = {
    spark: '<path d="M12 3l1.8 6.2L20 11l-6.2 1.8L12 19l-1.8-6.2L4 11l6.2-1.8L12 3z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    terminal: '<rect x="3" y="4.5" width="18" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M7 9.5l3 2.5-3 2.5M12.5 15h4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    pencil: '<path d="M4 20h4L19 9a2 2 0 0 0-3-3L5 17v3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14 7l3 3" fill="none" stroke="currentColor" stroke-width="1.8"/>',
    coin: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    chart: '<path d="M4 19V5M4 19h16M8 16l3.5-4 3 2.5L20 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    box: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    heart: '<path d="M12 20s-7-4.4-7-9.3A3.7 3.7 0 0 1 12 7.6 3.7 3.7 0 0 1 19 10.7c0 4.9-7 9.3-7 9.3z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>',
    users: '<circle cx="9" cy="8" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.6M16.5 19a5.5 5.5 0 0 0-2.3-4.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>',
    skill: '<path d="M13 2.5 6 13.2h5v8.3l7-10.7h-5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    puzzle: '<path d="M9 4.5a1.8 1.8 0 0 1 3.6 0c0 .5.4.9.9.9H16a1 1 0 0 1 1 1v2.5c0 .5.4.9.9.9a1.8 1.8 0 0 1 0 3.6c-.5 0-.9.4-.9.9V17a1 1 0 0 1-1 1h-2.6c-.5 0-.9.4-.9.9a1.8 1.8 0 0 1-3.6 0c0-.5-.4-.9-.9-.9H5a1 1 0 0 1-1-1v-2.4c0-.5-.4-.9-.9-.9a1.8 1.8 0 0 1 0-3.6c.5 0 .9-.4.9-.9V6.4a1 1 0 0 1 1-1h3.1c.5 0 .9-.4.9-.9z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>',
    news: '<path d="M4 5h13a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M18 9h2a1 1 0 0 1 1 1v7a2 2 0 0 1-2 2M7 9h7M7 12.5h7M7 16h4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>'
  };
  var CAT_GLYPH = {
    ai: "spark",
    devops: "terminal",
    design: "pencil",
    blockchain: "coin",
    business: "chart",
    writing: "pencil",
    minecraft: "box",
    entertainment: "heart",
    generators: "spark",
    "member-tutorials": "users",
    gbti: "spark",
    imagegen: "spark",
    skill: "skill"
  };
  var CAT_ACCENT = {
    ai: "#6b4fb0",
    devops: "#2f63c0",
    design: "#c0392f",
    blockchain: "#b3791f",
    business: "#138178",
    writing: "#555a66",
    minecraft: "#3a7d2c",
    entertainment: "#c0392b",
    generators: "#138178",
    "member-tutorials": "#2f63c0",
    gbti: "#1f9e5f",
    imagegen: "#6b4fb0",
    skill: "#b0316f"
  };
  var OTHER_ACCENT = "#5b6472";
  var TYPE_GLYPH = { share: "coin", post: "pencil", product: "box", prompt: "spark", news: "news" };
  var TYPE_ACCENT = { share: "#b3791f", post: "#3f74c9", product: "#c9683b", prompt: "#1f9e5f", news: "#3a6ea5" };
  function glyphFor(category, type) {
    const key = String(category || "").toLowerCase();
    if (CAT_GLYPH[key]) return { svg: GLYPH_SVG[CAT_GLYPH[key]], accent: CAT_ACCENT[key] };
    const t = String(type || "").toLowerCase();
    if (TYPE_GLYPH[t]) return { svg: GLYPH_SVG[TYPE_GLYPH[t]], accent: TYPE_ACCENT[t] };
    return { svg: GLYPH_SVG.puzzle, accent: OTHER_ACCENT };
  }
  function typeAccent(type) {
    return TYPE_ACCENT[String(type || "").toLowerCase()] || OTHER_ACCENT;
  }

  // client-ui/src/elements/gbti-card-list.mjs
  var MODES = /* @__PURE__ */ new Set(["compact", "detailed", "card"]);
  var TYPE_LABEL3 = { post: "Article", product: "Product", prompt: "Prompt", share: "Share", news: "News" };
  var lc = (s) => String(s || "").toLowerCase();
  var authorName = (a) => lc(a) === "gbti" || lc(a) === "house" ? "GBTI Network" : a;
  function faviconFor(urlOrHost) {
    let host = String(urlOrHost || "").trim();
    if (!host) return "";
    try {
      host = new URL(host).hostname;
    } catch {
      host = host.replace(/^https?:\/\//i, "").split("/")[0];
    }
    if (!host) return "";
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
  }
  function avatarFor(item = {}) {
    if (lc(item.type) === "news") {
      return { src: faviconFor(item.link || item.openHref), title: item.source || item.author || "News" };
    }
    const a = lc(item.author);
    const login = a === "gbti" || a === "house" ? "gbti-network" : item.author;
    return { src: login ? `https://github.com/${encodeURIComponent(login)}.png?size=48` : "", title: authorName(item.author) };
  }
  function thumbRaw(item = {}, isCard = false) {
    return (isCard && item.thumbCard ? item.thumbCard : item.thumb || item.thumbCard) || null;
  }
  function categoryLeaf(labels) {
    const a = Array.isArray(labels) ? labels : [];
    return a.length ? String(a[a.length - 1] || "").trim() : "";
  }
  function relTime(v, now = Date.now()) {
    if (!v) return "";
    const ms = typeof v === "number" ? v : Date.parse(v);
    if (!ms) return "";
    const diff = now - ms;
    if (diff < 6e4) return "just now";
    const mins = Math.floor(diff / 6e4);
    if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
    const hrs = Math.floor(diff / 36e5);
    if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
    const d = Math.floor(diff / 864e5);
    if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
    return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? "" : "s"} ago`;
  }
  var lockIco = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>';
  var CSS14 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .media { position:relative; flex:none; display:flex; align-items:center; justify-content:center; overflow:hidden; color:#fff;
    background:linear-gradient(145deg, color-mix(in srgb, var(--ka, #5b6472) 60%, white), var(--ka, #5b6472)); }
  /* The glyph wrapper must FILL the media so the svg's % sizing + centering resolve (an unsized .gl made the
     icon render tiny + off-center). Bumped to 55% so the type glyph reads clearly. */
  .media .gl { width:100%; height:100%; display:flex; align-items:center; justify-content:center; }
  .media .gl svg { width:55%; height:55%; display:block; }
  .media .cimg { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .chip { display:inline-flex; align-items:center; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); background:var(--hover); border:1px solid transparent; border-radius:6px; padding:3px 8px; white-space:nowrap; flex:none; }
  .lock { display:inline-flex; align-items:center; gap:4px; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:2px 8px 2px 6px; white-space:nowrap; }
  .lock svg { width:11px; height:11px; }
  .meta { display:inline-flex; align-items:center; gap:7px; font-family:var(--font-mono, monospace); font-size:12px; color:var(--muted); white-space:nowrap; }
  .meta b { color:var(--fg); font-weight:500; }
  /* SOW-049: the meta avatar (member github avatar / news publisher favicon). The name/source is the title tooltip. */
  .av { position:relative; width:20px; height:20px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center;
    background:var(--hover); color:var(--muted); font-size:10px; font-weight:700; line-height:1; }
  .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .av .ini { user-select:none; }
  .meta .ago { color:var(--muted); }
  .title { font-weight:600; color:var(--fg); }
  .empty { color:var(--muted); padding:18px 2px; }
  a, .open { color:inherit; text-decoration:none; }

  /* MODES compact + detailed — a continuous DIVIDED list (hairline separators, no per-row box) */
  .compact, .detailed { display:flex; flex-direction:column; }
  .row-c, .row-d { position:relative; cursor:pointer; border-bottom:1px solid var(--line); transition:background .14s; }
  .row-c:last-child, .row-d:last-child { border-bottom:0; }
  .row-c:hover, .row-d:hover { background:var(--hover); }

  .row-c { display:flex; align-items:center; gap:12px; padding:12px 8px 12px 15px; }
  .row-c .media { width:38px; height:38px; border-radius:9px; }
  .row-c .title { flex:1; min-width:0; font-size:14.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row-c:hover .title { color:var(--accent); }
  .row-c .right { display:flex; align-items:center; gap:10px; flex:none; }

  .row-d { display:grid; grid-template-columns:62px 1fr; gap:15px; align-items:center; padding:14px 8px 14px 17px; }
  .row-d.no-media { grid-template-columns:1fr; } /* SOW-049: news has no left media -> the title spans full width */
  .row-d .media { width:62px; height:62px; border-radius:10px; }
  .row-d .body { min-width:0; }
  .row-d .top { display:flex; align-items:center; gap:9px; margin:0 0 4px; }
  .row-d .title { font-size:15.5px; }
  .row-d:hover .title { color:var(--accent); }
  .row-d .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin:2px 0 4px; }

  /* MODE card — boxed grid, image-led (mirrors the /prompts grid card: 4:3 cover image up top, body below) */
  .card { display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:13px; }
  .card-i { position:relative; display:flex; flex-direction:column; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:0; cursor:pointer; overflow:hidden; transition:border-color .14s, box-shadow .14s, transform .14s; }
  .card-i:hover { border-color:var(--accent); transform:translateY(-2px); }
  /* The lead media: full-bleed at the top, a 4:3 box like /prompts .va-lead, object-fit cover. The card rounds
     only its top corners (overflow:hidden), so the image's BOTTOM edge is square (no rounded bottom). */
  .card-i .media { width:100%; aspect-ratio:4 / 3; height:auto; border-radius:0; flex:none; }
  .card-i .cbody { display:flex; flex-direction:column; padding:14px; }
  .card-i .top { display:flex; align-items:center; justify-content:space-between; gap:8px; }
  /* SOW-067: card titles wrap FULLY (no 2-line clamp); the auto-rows grid reflows the variable-height cards. */
  .card-i .title { font-size:15px; line-height:1.3; margin:10px 0 6px; }
  .card-i:hover .title { color:var(--accent); }
  .card-i .meta { margin:0; white-space:normal; }
  /* SOW-067: the category leaf label beside the type pill (card mode only), grouped left; the lock stays right. */
  .card-i .top { gap:6px; }
  .tcluster { display:inline-flex; align-items:center; gap:6px; min-width:0; }
  .catchip { display:inline-flex; align-items:center; font-family:var(--font-mono, monospace); font-size:10px; font-weight:600; color:var(--muted); background:var(--hover); border-radius:2px; padding:3px 7px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:130px; }
  /* SOW-067: the SOW-052 squared aesthetic in CARD MODE ONLY (scoped to .card-i so compact/detailed keep their radii). */
  .card-i, .card-i .media, .card-i .chip, .card-i .lock, .card-i .av, .card-i .catchip { border-radius:2px; }

  /* SEPARATION — member contributions stand out from the (non-member, high-volume) News stream: each member
     type gets a 3px type-color accent bar + a faint tint + a colored chip; NEWS stays plain so it recedes.
     The color comes from --cbar (set per-row in _open from cat-glyph's typeAccent). */
  .row-c[data-type]:not([data-type="news"])::before,
  .row-d[data-type]:not([data-type="news"])::before,
  .card-i[data-type]:not([data-type="news"])::before { content:""; position:absolute; left:0; top:0; bottom:0; width:3px; background:var(--cbar, var(--green)); }
  .row-c[data-type]:not([data-type="news"]),
  .row-d[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 7%, transparent); }
  .row-c[data-type]:not([data-type="news"]):hover,
  .row-d[data-type]:not([data-type="news"]):hover { background:color-mix(in srgb, var(--cbar) 14%, transparent); }
  .card-i[data-type]:not([data-type="news"]) { background:color-mix(in srgb, var(--cbar) 7%, var(--panel)); }
  [data-type]:not([data-type="news"]) .chip { color:var(--cbar); background:color-mix(in srgb, var(--cbar) 13%, transparent); border-color:color-mix(in srgb, var(--cbar) 26%, transparent); }

  /* Phones (responsive rule: shrink/drop the competing secondary metadata before the title loses its room). The
     compact + detailed rows otherwise crush the title to a few characters because the avatar + relative date hold
     fixed width. Below 560px: drop the "x days ago", tighten gaps/padding, shrink the glyph + avatar + chip. */
  @media (max-width: 560px) {
    .row-c { gap:9px; padding:11px 10px 11px 12px; }
    .row-c .media { width:34px; height:34px; }
    .row-d { grid-template-columns:52px 1fr; gap:12px; padding:12px 10px 12px 14px; }
    .row-d .media { width:52px; height:52px; }
    .row-c .ago, .row-d .ago { display:none; }
    .av { width:18px; height:18px; }
    .chip { font-size:10px; padding:3px 6px; }
  }
`;
  var GbtiCardList = class extends GbtiElement {
    set items(v) {
      this._items = Array.isArray(v) ? v : [];
      this.render();
    }
    get items() {
      return this._items || [];
    }
    set mode(v) {
      this._mode = MODES.has(v) ? v : "detailed";
      this.render();
    }
    get mode() {
      return this._mode || "detailed";
    }
    // SOW-050: the resolved thumbnail URL (the card box uses the larger thumbCard derivative; dense rows use the small
    // thumb), or null when the item has no featured image. News falls back to its single og:image URL.
    _thumbUrl(item) {
      const raw = thumbRaw(item, this.mode === "card");
      return raw ? resolveAsset(raw) : null;
    }
    _media(item) {
      const isCard = this.mode === "card";
      if (lc(item.type) === "news" && !isCard) return "";
      const thumb = this._thumbUrl(item);
      if (this.mode === "detailed" && !thumb) return "";
      const g = glyphFor(item.category, item.type);
      const glyph = this.mode === "detailed" ? "" : `<span class="gl"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`;
      const img = thumb ? `<img class="cimg" src="${esc(thumb)}" alt="" loading="lazy">` : "";
      return `<span class="media" style="--ka:${esc(g.accent)}">${glyph}${img}</span>`;
    }
    _chip(item) {
      return `<span class="chip">${esc(TYPE_LABEL3[item.type] || item.type)}</span>`;
    }
    // SOW-067: the leaf taxonomy label (the human breadcrumb's last entry) shown beside the type pill in card mode.
    _categoryChip(item) {
      const leaf = categoryLeaf(item.categoryLabels);
      return leaf ? `<span class="catchip">${esc(leaf)}</span>` : "";
    }
    // News is open to the limited trial, not members-only, so it never carries the Members lock badge (SOW-050).
    _lock(item) {
      return item.visibility === "members" && lc(item.type) !== "news" ? `<span class="lock">${lockIco}Members</span>` : "";
    }
    // SOW-049: the meta leads with a small avatar (member -> github avatar; news -> publisher favicon); the name/source
    // is the avatar's hover tooltip (title), not a persistent label. Broken images fall back to an initial disc.
    _meta(item) {
      const ago = relTime(item.createdAt ?? item.publishedAt);
      const av = avatarFor(item);
      const ini = esc((av.title || "?").trim().charAt(0).toUpperCase() || "?");
      const img = av.src ? `<img class="avimg" src="${esc(av.src)}" alt="" loading="lazy">` : "";
      return `<span class="meta"><span class="av" title="${esc(av.title)}"><span class="ini">${ini}</span>${img}</span>${ago ? `<span class="ago">${esc(ago)}</span>` : ""}</span>`;
    }
    _open(item, i, cls) {
      const t = lc(item.type);
      const accent = t && t !== "news" ? ` style="--cbar:${esc(typeAccent(t))}"` : "";
      const nomedia = t === "news" && cls !== "card-i" || cls === "row-d" && !this._thumbUrl(item) ? " no-media" : "";
      const attrs = `class="${cls}${nomedia}" data-card="${i}" data-type="${esc(t)}"${accent}`;
      return item.openHref ? `<a ${attrs} href="${esc(item.openHref)}">` : `<div ${attrs} role="button" tabindex="0">`;
    }
    _close(item) {
      return item.openHref ? "</a>" : "</div>";
    }
    _compact(items) {
      return `<div class="compact">` + items.map((it, i) => `${this._open(it, i, "row-c")}${this._media(it)}${this._chip(it)}<span class="title">${esc(it.title)}</span><span class="right">${this._lock(it)}${this._meta(it)}</span>${this._close(it)}`).join("") + `</div>`;
    }
    _detailed(items) {
      return `<div class="detailed">` + items.map((it, i) => `${this._open(it, i, "row-d")}${this._media(it)}<div class="body"><div class="top">${this._chip(it)}${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ""}${this._meta(it)}</div>${this._close(it)}`).join("") + `</div>`;
    }
    _card(items) {
      return `<div class="card">` + items.map((it, i) => `${this._open(it, i, "card-i")}${this._media(it)}<div class="cbody"><div class="top"><span class="tcluster">${this._chip(it)}${this._categoryChip(it)}</span>${this._lock(it)}</div><div class="title">${esc(it.title)}</div>${this._meta(it)}</div>${this._close(it)}`).join("") + `</div>`;
    }
    render() {
      if (!this._items) return;
      if (!this._items.length) {
        this.set(this.css(CSS14) + `<p class="empty">Nothing here yet.</p>`);
        return;
      }
      const body = this.mode === "compact" ? this._compact(this._items) : this.mode === "card" ? this._card(this._items) : this._detailed(this._items);
      this.set(this.css(CSS14) + body);
      if (!this._wiredErr) {
        this.root?.addEventListener("error", (e) => {
          const t = e.target;
          if (t?.tagName === "IMG" && (t.classList?.contains("cimg") || t.classList?.contains("avimg"))) t.remove();
        }, true);
        this._wiredErr = true;
      }
      this.$$("[data-card]").forEach((el) => {
        if (el.tagName === "A") return;
        const open = () => this.emit("card-open", { item: this._items[Number(el.dataset.card)] });
        el.addEventListener("click", open);
        el.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            open();
          }
        });
      });
    }
  };
  define("gbti-card-list", GbtiCardList);

  // client-ui/src/elements/gbti-comment-box.mjs
  var LOCKED3 = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var CSS15 = `
  :host { display: block; font-family: var(--font-body); color: var(--fg); }
  .nudge { margin-top: 20px; padding: 16px; border: 1.5px dashed var(--line); border-radius: 12px; background: var(--panel); font-size: 13.5px; color: var(--muted); }
  .nudge a { color: var(--brand); font-weight: 600; }
  button.open { margin-top: 16px; font: inherit; font-weight: 600; font-size: 14px; padding: 9px 16px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg); cursor: pointer; }
  button.open:hover { border-color: var(--brand); color: var(--brand); }
  .edit { font: inherit; font-size: 12px; background: none; border: 0; color: var(--muted); cursor: pointer; padding: 0; }
  .edit:hover { color: var(--brand); text-decoration: underline; }
  .form { margin-top: 14px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 90px; resize: vertical; font: inherit; font-size: 14px; padding: 10px 12px; border: 1.5px solid var(--line); border-radius: 10px; background: var(--panel); color: var(--fg); }
  textarea:focus { outline: none; border-color: var(--brand); }
  .row { display: flex; gap: 10px; align-items: center; margin-top: 10px; flex-wrap: wrap; }
  label.chk { font: inherit; font-size: 13px; color: var(--muted); }
  .actions { margin-left: auto; display: flex; gap: 8px; align-items: center; }
  button.post { font: inherit; font-weight: 700; font-size: 14px; padding: 8px 16px; border: 0; border-radius: 10px; background: var(--brand); color: #fff; cursor: pointer; }
  button.cancel { font: inherit; font-size: 13px; background: none; border: 0; color: var(--muted); cursor: pointer; }
  .msg { font-size: 13px; } .msg.err { color: #c0392b; } .msg.ok { color: var(--brand); }
  .busy { opacity: .55; pointer-events: none; }
`;
  var GbtiCommentBox = class extends GbtiElement {
    get _editId() {
      return this.dataset?.gbtiCommentId || this.getAttribute?.("data-gbti-comment-id") || null;
    }
    get _editAuthor() {
      return this.dataset?.gbtiCommentAuthor || this.getAttribute?.("data-gbti-comment-author") || null;
    }
    _target() {
      return { type: this.dataset?.gbtiTargetType || this.getAttribute?.("data-gbti-target-type"), slug: this.dataset?.gbtiTargetSlug || this.getAttribute?.("data-gbti-target-slug") };
    }
    connectedCallback() {
      super.connectedCallback();
      this._init();
    }
    async _init() {
      if (!this.client) return;
      let s = null;
      try {
        s = await this.client.status();
      } catch {
        s = null;
      }
      this._membership = s?.membership ?? "unknown";
      this._identity = s?.identity ?? null;
      this._editId ? this._renderEditAffordance() : this._renderCompose();
    }
    // ---- EDIT mode: only the comment's author sees an Edit link ----
    _renderEditAffordance() {
      if (!this._identity || this._identity.username !== this._editAuthor) {
        this.set(this.css(CSS15) + "");
        return;
      }
      this.set(this.css(CSS15) + `<button class="edit" type="button">Edit</button>`);
      this.on(".edit", "click", () => this._openEdit());
    }
    async _openEdit() {
      this.set(this.css(CSS15) + `<p class="msg">Loading…</p>`);
      let body = "";
      try {
        body = (await this.client.getComment({ id: this._editId }))?.body ?? "";
      } catch {
        this.set(this.css(CSS15) + `<p class="msg err">Could not load the comment.</p><button class="edit" type="button">Retry</button>`);
        this.on(".edit", "click", () => this._openEdit());
        return;
      }
      this._form({ body, edit: true });
    }
    // ---- COMPOSE mode ----
    _renderCompose() {
      if (LOCKED3.has(this._membership)) {
        this.set(this.css(CSS15) + `<div class="nudge">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to comment.</div>`);
        return;
      }
      if (this._membership === "trialing") {
        this.set(this.css(CSS15) + `<div class="nudge">Commenting is a paid feature. <a href="https://gbti.network/membership/">Upgrade</a> to join the conversation.</div>`);
        return;
      }
      if (!this._identity) {
        this.set(this.css(CSS15) + `<div class="nudge">Sign in with the GBTI client to comment. <a href="https://gbti.network/membership/">Become a member</a>.</div>`);
        return;
      }
      this.set(this.css(CSS15) + `<button class="open" type="button">Write a comment</button>`);
      this.on(".open", "click", () => this._form({ body: "", edit: false }));
    }
    _form({ body, edit }) {
      const isIntroTarget = ["post", "product", "prompt"].includes(this._target().type);
      const noteRow = !edit && isIntroTarget ? `<label class="chk"><input type="checkbox" data-authornote /> Post as my public "from the author" note</label>` : "";
      this.set(this.css(CSS15) + `
      <div class="form">
        <textarea placeholder="Write your comment (markdown supported)…" maxlength="8000">${esc(body)}</textarea>
        <div class="row">
          ${noteRow}
          <div class="actions">
            <span class="msg" aria-live="polite"></span>
            <button class="cancel" type="button">Cancel</button>
            <button class="post" type="button">${edit ? "Save" : "Post"}</button>
          </div>
        </div>
      </div>`);
      this.on(".cancel", "click", () => edit ? this._renderEditAffordance() : this._renderCompose());
      this.on(".post", "click", () => edit ? this._save() : this._post());
    }
    async _post() {
      const wrap = this.$(".form");
      const msg = this.$(".msg");
      const body = (this.$("textarea")?.value || "").trim();
      if (!body) {
        this._say(msg, "Write something first.", "err");
        return;
      }
      const t = this._target();
      const authorNote = !!this.$("[data-authornote]")?.checked && ["post", "product", "prompt"].includes(t.type);
      const visibility = authorNote ? "public" : "members";
      wrap?.classList.add("busy");
      try {
        const res = await this.client.postComment({ targetType: t.type, targetSlug: t.slug, body, visibility, authorNote });
        this._done(msg, "Posted. It appears after the next build.", "gbti-comment-posted", res);
      } catch (err) {
        this._fail(msg, err);
        wrap?.classList.remove("busy");
      }
    }
    async _save() {
      const wrap = this.$(".form");
      const msg = this.$(".msg");
      const body = (this.$("textarea")?.value || "").trim();
      if (!body) {
        this._say(msg, "A comment cannot be empty.", "err");
        return;
      }
      wrap?.classList.add("busy");
      try {
        const res = await this.client.editComment({ id: this._editId, body });
        this._done(msg, "Saved. The edit appears after the next build.", "gbti-comment-edited", res);
      } catch (err) {
        this._fail(msg, err);
        wrap?.classList.remove("busy");
      }
    }
    _done(msg, text, event, detail) {
      this._say(msg, text, "ok");
      this.emit(event, detail);
    }
    _fail(msg, err) {
      if (err?.code === "membership-required") this._say(msg, "Commenting requires a paid membership.", "err");
      else if (err?.code === "not-authenticated" || err?.code === "no-identity") this._say(msg, "Sign in with the GBTI client first.", "err");
      else this._say(msg, err?.message || "Could not save the comment.", "err");
    }
    _say(el, text, kind) {
      if (el) {
        el.textContent = text;
        el.className = `msg ${kind || ""}`;
      }
    }
  };
  define("gbti-comment-box", GbtiCommentBox);

  // client-ui/src/elements/gbti-discussion.mjs
  var CSS16 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .thread { display:flex; flex-direction:column; gap:10px; margin-bottom:8px; }
  .comment { border-left:2px solid var(--line); padding-left:10px; }
  .comment.reply { margin-left:16px; }
  .cmeta { display:flex; align-items:baseline; gap:8px; font-size:12px; }
  .cmeta .cname { font-weight:700; } .cmeta .cwhen { color:var(--muted); }
  .cmeta .cbadge { font-size:9.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:0 6px; }
  .cbody { margin-top:3px; font-size:13.5px; line-height:1.5; }
  .cbody p { margin:0 0 .5em; } .cbody :is(h1,h2,h3,h4){ font-weight:700; margin:.6em 0 .2em; }
  .cbody a { color:var(--accent, var(--brand)); }
  .cbody pre { background:var(--bg, rgba(0,0,0,.05)); padding:8px; border-radius:6px; overflow:auto; }
  .clocked { font-size:12.5px; color:var(--muted); } .clocked a { color:var(--brand); font-weight:600; }
  .empty { color:var(--muted); font-size:12.5px; margin:0 0 8px; }
`;
  function relTime2(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const diff = Date.now() - t, day = 864e5;
    if (diff < day) return "today";
    const d = Math.floor(diff / day);
    if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
    return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? "" : "s"} ago`;
  }
  var authorName2 = (a) => a === "gbti" ? "GBTI Network" : a || "A member";
  var GbtiDiscussion = class extends GbtiElement {
    static get observedAttributes() {
      return ["data-gbti-target-type", "data-gbti-target-slug"];
    }
    connectedCallback() {
      super.connectedCallback?.();
      this._onComment = (e) => {
        if (e?.detail?.targetSlug === this._slug()) this.load();
      };
      document.addEventListener("gbti-comment-posted", this._onComment);
      document.addEventListener("gbti-comment-edited", this._onComment);
      this.load();
    }
    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._onComment) {
        document.removeEventListener("gbti-comment-posted", this._onComment);
        document.removeEventListener("gbti-comment-edited", this._onComment);
      }
    }
    attributeChangedCallback(name, oldV, newV) {
      if (oldV !== newV && this.isConnected) {
        this._loaded = false;
        this.load();
      }
    }
    _type() {
      return this.dataset.gbtiTargetType || "";
    }
    _slug() {
      return this.dataset.gbtiTargetSlug || "";
    }
    async load() {
      const targetType = this._type();
      const targetSlug = this._slug();
      if (!targetType || !targetSlug) {
        this.set(this.css(CSS16));
        return;
      }
      if (!this.client) {
        this.set(this.css(CSS16) + `<p class="empty">Open in the GBTI client to read the discussion.</p>`);
        return;
      }
      if (!this._loaded) this.set(this.css(CSS16) + `<p class="empty">Loading the discussion…</p>`);
      let items = [];
      try {
        items = (await this.client.listComments({ targetType, targetSlug }))?.items ?? [];
      } catch {
        this.set(this.css(CSS16) + `<p class="empty">Could not load the discussion right now.</p>` + this._composeHtml(targetType, targetSlug));
        return;
      }
      const resolved = await Promise.all(items.map((c) => this._resolveBody(c).then((html) => ({ c, html }))));
      this._render(targetType, targetSlug, resolved);
      this._loaded = true;
    }
    _render(targetType, targetSlug, rows) {
      const thread = rows.map(({ c, html }) => {
        const reply = c.parentId ? " reply" : "";
        const badge = c.visibility === "members" ? `<span class="cbadge">Members</span>` : "";
        const bodyHtml = html && html.locked ? `<div class="clocked">This reply is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>` : typeof html === "string" && html ? `<div class="cbody">${html}</div>` : "";
        return `<div class="comment${reply}">
        <div class="cmeta"><span class="cname">${esc(authorName2(c.author))}</span><span class="cwhen">${esc(relTime2(c.createdAt))}</span>${badge}</div>
        ${bodyHtml}
      </div>`;
      }).join("");
      const threadHtml = rows.length ? `<div class="thread">${thread}</div>` : `<p class="empty">No replies yet. Start the conversation.</p>`;
      this.set(this.css(CSS16) + threadHtml + this._composeHtml(targetType, targetSlug));
    }
    // A fresh <gbti-comment-box> for this target (it handles its own paid/trial/visitor gating UX). The injected
    // client is process-global, so it upgrades + talks to the same host with nothing to wire here.
    _composeHtml(targetType, targetSlug) {
      return `<gbti-comment-box data-gbti-target-type="${esc(targetType)}" data-gbti-target-slug="${esc(targetSlug)}"></gbti-comment-box>`;
    }
    async _resolveBody(c) {
      try {
        if (c.visibility === "members") {
          if (!c.encryptedBody) return "";
          const { text } = await this.client.decrypt({ encPath: c.encryptedBody });
          return (await this.client.preview({ body: text }))?.html ?? "";
        }
        return c.body ? (await this.client.preview({ body: c.body }))?.html ?? "" : "";
      } catch (err) {
        const locked = err?.code === "membership-required" || err?.code === "not-authenticated";
        return { locked };
      }
    }
  };
  define("gbti-discussion", GbtiDiscussion);

  // client-ui/src/elements/gbti-upvote.mjs
  var arrow = (filled) => `<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path d="M12 4l8 9h-5v7h-6v-7H4z" fill="${filled ? "currentColor" : "none"}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>`;
  var CSS17 = `
  .pill { display:inline-flex; align-items:center; gap:6px; cursor:pointer; font-family:var(--font-body);
    font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel);
    border:1.5px solid var(--line); border-radius:999px; padding:5px 11px;
    transition:color .15s ease, border-color .15s ease; }
  .pill:hover, .pill.on { color:var(--brand); border-color:var(--brand); }
  .pill svg { flex:none; }
  .pill .c { font-variant-numeric: tabular-nums; }
`;
  var GbtiUpvote = class extends GbtiElement {
    render() {
      const targetType = this.dataset?.gbtiTargetType || "share";
      const targetSlug = this.dataset?.gbtiTargetSlug;
      if (this._count === void 0) {
        const n = parseInt(this.dataset?.gbtiCount || "0", 10);
        this._count = Number.isFinite(n) && n > 0 ? n : 0;
      }
      if (this._voted === void 0) this._voted = this.dataset?.gbtiVoted === "true";
      const c = Math.max(0, this._count);
      const label = !this.client ? "Sign in to upvote" : this._voted ? "Remove upvote" : "Upvote";
      this.set(
        this.css(CSS17) + `<button class="pill ${this._voted ? "on" : ""}" type="button" aria-pressed="${this._voted}" aria-label="${label}" title="${label}">${arrow(this._voted)}<span class="c">${c}</span></button>`
      );
      this.on(".pill", "click", () => this._onClick(targetType, targetSlug));
    }
    _onClick(targetType, targetSlug) {
      if (!this.client) {
        window.location.href = "/membership/";
        return;
      }
      this._toggle(targetType, targetSlug);
    }
    async _toggle(targetType, targetSlug) {
      const next = !this._voted;
      this._voted = next;
      this._count = Math.max(0, this._count + (next ? 1 : -1));
      this.render();
      try {
        const res = await this.client.toggleUpvote({ targetType, targetSlug, on: next });
        if (res && typeof res.count === "number") this._count = Math.max(0, res.count);
        if (res && typeof res.upvoted === "boolean") this._voted = res.upvoted;
        this.render();
      } catch (err) {
        this._voted = !next;
        this._count = Math.max(0, this._count + (next ? -1 : 1));
        this.render();
        if (err?.code === "not-authenticated" || err?.code === "membership-required" || err?.code === "upvote-failed") {
          if (err.code !== "upvote-failed") window.location.href = "/membership/";
        }
      }
    }
  };
  define("gbti-upvote", GbtiUpvote);

  // client-ui/src/elements/gbti-shares-feed.mjs
  var LOCKED4 = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var RANK2 = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
  var CSS18 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; margin:4px 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .refresh { background:transparent; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
  .refresh:hover { color:var(--brand); }
  .muted { color:var(--muted); font-size:13.5px; }
  .empty { color:var(--muted); font-size:12.5px; margin:0 0 8px; }

  /* reading view (a focused Share + its discussion) */
  .rtop { display:flex; align-items:center; justify-content:space-between; gap:10px; margin:0 0 14px; }
  .back { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .back:hover { border-color:var(--accent); color:var(--accent); }
  .hide { border:1px solid var(--line); background:var(--panel); color:var(--danger); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .hide:hover { border-color:var(--danger); }
  .hide[disabled] { opacity:.6; cursor:default; }
  .reading .who { display:flex; align-items:baseline; gap:8px; }
  .reading .who .name { font-weight:700; font-size:14px; }
  .reading .who .when { color:var(--muted); font-size:12px; }
  .reading .badge { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .reading .title { font-weight:700; font-size:18px; margin-top:8px; }
  .reading .desc { color:var(--muted); font-size:13.5px; margin-top:2px; }
  .reading .actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; } /* SOW-050 P3: favorite + collect a Share */
  .body { margin-top:10px; font-size:14.5px; line-height:1.6; }
  .body :is(h1,h2,h3,h4){ font-weight:700; margin:.8em 0 .3em; }
  .body p { margin:0 0 .7em; } .body ul,.body ol { margin:0 0 .7em 1.2em; }
  .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--bg, rgba(0,0,0,.05)); padding:10px; border-radius:8px; overflow:auto; }
  .link { display:inline-flex; align-items:center; gap:6px; margin-top:10px; font-size:12.5px; color:var(--brand); text-decoration:none; }
  .tags { margin-top:10px; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .locked { color:var(--muted); font-size:13.5px; } .locked a { color:var(--brand); font-weight:600; }
  .splash { text-align:center; padding:40px 16px; }
  .splash .lock { font-size:30px; } .splash h3 { margin:10px 0 4px; } .splash a { color:var(--brand); font-weight:600; }

  /* SOW-032/041 discussion container (the thread itself renders inside <gbti-discussion>). */
  .discussion-wrap { margin-top:22px; border-top:1px solid var(--line); padding-top:14px; }
  .discussion-wrap h4 { margin:0 0 10px; font-size:14px; }
`;
  function relTime3(iso) {
    if (!iso) return "";
    const t = Date.parse(iso);
    if (Number.isNaN(t)) return "";
    const diff = Date.now() - t, day = 864e5;
    if (diff < day) return "today";
    const d = Math.floor(diff / day);
    if (d < 30) return `${d} day${d === 1 ? "" : "s"} ago`;
    const mo = Math.floor(d / 30);
    if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
    return `${Math.floor(d / 365)} year${Math.floor(d / 365) === 1 ? "" : "s"} ago`;
  }
  var authorName3 = (a) => a === "gbti" ? "GBTI Network" : a || "A member";
  var GbtiSharesFeed = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._items = null;
      this._reading = null;
      this._locked = false;
      this._onPosted = () => {
        this._reading = null;
        this.reload();
      };
      document.addEventListener("gbti-share-posted", this._onPosted);
      this.reload();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._onPosted) document.removeEventListener("gbti-share-posted", this._onPosted);
    }
    async reload() {
      if (!this.client) {
        this.set(this.css(CSS18) + `<p class="muted">Open in the GBTI client to read Shares.</p>`);
        return;
      }
      this.set(this.css(CSS18) + `<p class="muted">Loading the co-op stream…</p>`);
      let membership = "unknown";
      try {
        const st = await this.client.status();
        membership = st?.membership ?? "unknown";
        this._role = st?.role ?? "member";
        this._me = String(st?.identity?.username || st?.identity?.login || "").toLowerCase();
      } catch {
        membership = "unknown";
        this._role = "member";
        this._me = "";
      }
      this._locked = LOCKED4.has(membership);
      if (this._locked) return this._splash();
      try {
        this._items = (await this.client.listShares())?.items ?? [];
      } catch {
        this.set(this.css(CSS18) + `<p class="muted">Could not load Shares right now.</p>`);
        return;
      }
      this.render();
    }
    render() {
      if (this._locked) return this._splash();
      if (this._reading) {
        this._renderReading(this._reading);
        return;
      }
      this._renderList();
    }
    // The stream as the shared content-item card list. A Share has no image, so the card shows the coin category
    // glyph (glyphFor type fallback). No openHref -> the card emits card-open, which opens the reading view.
    _renderList() {
      const head = `<div class="head"><h3>Co-op stream</h3><button class="refresh" type="button">Refresh</button></div>`;
      const items = this._items || [];
      if (!items.length) {
        this.set(this.css(CSS18) + head + `<p class="muted">No Shares yet. Post the first one with the + button.</p>`);
        this.on(".refresh", "click", () => this.reload());
        return;
      }
      this.set(this.css(CSS18) + head + `<div data-list></div>`);
      this.on(".refresh", "click", () => this.reload());
      const list = document.createElement("gbti-card-list");
      list.mode = "detailed";
      list.items = items.map((it) => shareToItem(it));
      list.addEventListener("card-open", (e) => {
        const it = e.detail?.item;
        if (it) {
          this._reading = it;
          this.render();
        }
      });
      this.$("[data-list]")?.replaceChildren(list);
    }
    // The focused reading view: the Share's body + an always-open discussion thread.
    _renderReading(share) {
      const slug = share.author && share.id ? `${share.author}/${share.id}` : "";
      const badge = share.visibility === "members" ? `<span class="badge">Members</span>` : "";
      const title = share.title ? `<div class="title">${esc(share.title)}</div>` : "";
      const desc = share.shortDescription ? `<div class="desc">${esc(share.shortDescription)}</div>` : "";
      const link = share.url ? `<a class="link" href="${esc(share.url)}" target="_blank" rel="noopener nofollow">Read article on ${esc(hostOf2(share.url))}</a>` : "";
      const heroUrl = share.image ? resolveAsset(share.image) : "";
      const hero = heroUrl ? `<img class="share-hero" src="${esc(heroUrl)}" alt="" loading="lazy" style="display:block;max-width:100%;border-radius:10px;margin-top:10px" />` : "";
      const tags = (share.tags || []).length ? `<div class="tags">${share.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}</div>` : "";
      const isAuthor = !!this._me && this._me === String(share.author || "").toLowerCase();
      const upvote = slug && !isAuthor ? `<gbti-upvote data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-upvote>` : "";
      const actions = slug ? `<div class="actions">
      ${upvote}
      <gbti-favorite data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-favorite>
      <gbti-collection data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-collection>
    </div>` : "";
      const discussion = slug ? `<div class="discussion-wrap"><h4>Discussion</h4><gbti-discussion data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>` : "";
      const canHide = (RANK2[this._role] ?? 0) >= RANK2.moderator && share.author && share.id;
      const mod = canHide ? `<button class="hide" type="button" data-hide>Hide Share</button>` : "";
      this.set(this.css(CSS18) + `<div class="rtop"><button class="back" type="button" data-back>&larr; Back to the stream</button>${mod}</div>
      <article class="reading">
        <div class="who"><span class="name">${esc(authorName3(share.author))}</span><span class="when">${esc(relTime3(share.createdAt))}</span>${badge}</div>
        ${title}${desc}${actions}
        <div class="body" data-body><p class="empty">Loading…</p></div>
        ${link}${hero}${tags}${discussion}
      </article>`);
      this.on("[data-back]", "click", () => {
        this._reading = null;
        this.render();
      });
      this.on("[data-hide]", "click", () => this._hide(share));
      this._fillBody(share);
    }
    // Moderation: deplatform (status -> draft) this Share via the wired admin op; on success return to the stream,
    // where it no longer appears. Fail-soft: a forbidden/error shows inline, the Share stays.
    async _hide(share) {
      if (typeof confirm === "function" && !confirm("Hide this Share? It is set to draft and removed from the stream for everyone.")) return;
      const path = `members/${share.author}/shares/${share.id}.md`;
      const btn = this.$("[data-hide]");
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Hiding…";
      }
      try {
        await this.client.admin("deplatform", { path });
        this._reading = null;
        this.reload();
      } catch (err) {
        if (btn) {
          btn.disabled = false;
          btn.textContent = err?.code === "forbidden" ? "Not permitted" : "Hide failed — retry";
        }
      }
    }
    async _fillBody(share) {
      const html = await this._resolveBody(share);
      const el = this.$("[data-body]");
      if (!el) return;
      if (html && html.locked) el.innerHTML = `<div class="locked">This Share is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>`;
      else el.innerHTML = typeof html === "string" && html ? html : `<p class="muted">No note.</p>`;
    }
    async _resolveBody(it) {
      try {
        if (it.visibility === "members") {
          if (!it.encryptedBody) return "";
          const { text } = await this.client.decrypt({ encPath: it.encryptedBody });
          return (await this.client.preview({ body: text }))?.html ?? "";
        }
        return it.body ? (await this.client.preview({ body: it.body }))?.html ?? "" : "";
      } catch (err) {
        const locked = err?.code === "membership-required" || err?.code === "not-authenticated";
        return { locked };
      }
    }
    _splash() {
      this.set(this.css(CSS18) + `<div class="splash"><div class="lock">🔒</div><h3>Your access is locked</h3>
      <p class="muted">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to read the community Shares stream again.</p></div>`);
    }
  };
  define("gbti-shares-feed", GbtiSharesFeed);

  // client-ui/src/elements/gbti-shares.mjs
  var CSS19 = `
  :host { display:block; }
  .stack { display:flex; flex-direction:column; gap:20px; }
  hr { border:0; border-top:1px solid var(--line); margin:0; }
`;
  var GbtiShares = class extends GbtiElement {
    render() {
      this.set(this.css(CSS19) + `<div class="stack">
      <gbti-share-composer></gbti-share-composer>
      <hr />
      <gbti-shares-feed></gbti-shares-feed>
    </div>`);
    }
  };
  define("gbti-shares", GbtiShares);

  // node_modules/js-yaml/dist/js-yaml.mjs
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
      key = keys[i];
      if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
        get: ((k) => from[k]).bind(null, key),
        enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
      });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
    value: mod,
    enumerable: true
  }) : target, mod));
  var require_common = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    function isNothing(subject) {
      return typeof subject === "undefined" || subject === null;
    }
    function isObject(subject) {
      return typeof subject === "object" && subject !== null;
    }
    function toArray(sequence) {
      if (Array.isArray(sequence)) return sequence;
      else if (isNothing(sequence)) return [];
      return [sequence];
    }
    function extend(target, source) {
      if (source) {
        const sourceKeys = Object.keys(source);
        for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
          const key = sourceKeys[index];
          target[key] = source[key];
        }
      }
      return target;
    }
    function repeat(string, count) {
      let result = "";
      for (let cycle = 0; cycle < count; cycle += 1) result += string;
      return result;
    }
    function isNegativeZero(number) {
      return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
    }
    module.exports.isNothing = isNothing;
    module.exports.isObject = isObject;
    module.exports.toArray = toArray;
    module.exports.repeat = repeat;
    module.exports.isNegativeZero = isNegativeZero;
    module.exports.extend = extend;
  }));
  var require_exception = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    function formatError(exception, compact) {
      let where = "";
      const message = exception.reason || "(unknown reason)";
      if (!exception.mark) return message;
      if (exception.mark.name) where += 'in "' + exception.mark.name + '" ';
      where += "(" + (exception.mark.line + 1) + ":" + (exception.mark.column + 1) + ")";
      if (!compact && exception.mark.snippet) where += "\n\n" + exception.mark.snippet;
      return message + " " + where;
    }
    function YAMLException2(reason, mark) {
      Error.call(this);
      this.name = "YAMLException";
      this.reason = reason;
      this.mark = mark;
      this.message = formatError(this, false);
      if (Error.captureStackTrace) Error.captureStackTrace(this, this.constructor);
      else this.stack = (/* @__PURE__ */ new Error()).stack || "";
    }
    YAMLException2.prototype = Object.create(Error.prototype);
    YAMLException2.prototype.constructor = YAMLException2;
    YAMLException2.prototype.toString = function toString(compact) {
      return this.name + ": " + formatError(this, compact);
    };
    module.exports = YAMLException2;
  }));
  var require_snippet = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var common = require_common();
    function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
      let head = "";
      let tail = "";
      const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
      if (position - lineStart > maxHalfLength) {
        head = " ... ";
        lineStart = position - maxHalfLength + head.length;
      }
      if (lineEnd - position > maxHalfLength) {
        tail = " ...";
        lineEnd = position + maxHalfLength - tail.length;
      }
      return {
        str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "→") + tail,
        pos: position - lineStart + head.length
      };
    }
    function padStart(string, max) {
      return common.repeat(" ", max - string.length) + string;
    }
    function makeSnippet(mark, options) {
      options = Object.create(options || null);
      if (!mark.buffer) return null;
      if (!options.maxLength) options.maxLength = 79;
      if (typeof options.indent !== "number") options.indent = 1;
      if (typeof options.linesBefore !== "number") options.linesBefore = 3;
      if (typeof options.linesAfter !== "number") options.linesAfter = 2;
      const re = /\r?\n|\r|\0/g;
      const lineStarts = [0];
      const lineEnds = [];
      let match;
      let foundLineNo = -1;
      while (match = re.exec(mark.buffer)) {
        lineEnds.push(match.index);
        lineStarts.push(match.index + match[0].length);
        if (mark.position <= match.index && foundLineNo < 0) foundLineNo = lineStarts.length - 2;
      }
      if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
      let result = "";
      const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
      const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
      for (let i = 1; i <= options.linesBefore; i++) {
        if (foundLineNo - i < 0) break;
        const line2 = getLine(mark.buffer, lineStarts[foundLineNo - i], lineEnds[foundLineNo - i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]), maxLineLength);
        result = common.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
      }
      const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
      result += common.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
      result += common.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
      for (let i = 1; i <= options.linesAfter; i++) {
        if (foundLineNo + i >= lineEnds.length) break;
        const line2 = getLine(mark.buffer, lineStarts[foundLineNo + i], lineEnds[foundLineNo + i], mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]), maxLineLength);
        result += common.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
      }
      return result.replace(/\n$/, "");
    }
    module.exports = makeSnippet;
  }));
  var require_type = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var YAMLException2 = require_exception();
    var TYPE_CONSTRUCTOR_OPTIONS = [
      "kind",
      "multi",
      "resolve",
      "construct",
      "instanceOf",
      "predicate",
      "represent",
      "representName",
      "defaultStyle",
      "styleAliases"
    ];
    var YAML_NODE_KINDS = [
      "scalar",
      "sequence",
      "mapping"
    ];
    function compileStyleAliases(map) {
      const result = {};
      if (map !== null) Object.keys(map).forEach(function(style) {
        map[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
      return result;
    }
    function Type2(tag, options) {
      options = options || {};
      Object.keys(options).forEach(function(name) {
        if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name) === -1) throw new YAMLException2('Unknown option "' + name + '" is met in definition of "' + tag + '" YAML type.');
      });
      this.options = options;
      this.tag = tag;
      this.kind = options["kind"] || null;
      this.resolve = options["resolve"] || function() {
        return true;
      };
      this.construct = options["construct"] || function(data) {
        return data;
      };
      this.instanceOf = options["instanceOf"] || null;
      this.predicate = options["predicate"] || null;
      this.represent = options["represent"] || null;
      this.representName = options["representName"] || null;
      this.defaultStyle = options["defaultStyle"] || null;
      this.multi = options["multi"] || false;
      this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
      if (YAML_NODE_KINDS.indexOf(this.kind) === -1) throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
    module.exports = Type2;
  }));
  var require_schema = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var YAMLException2 = require_exception();
    var Type2 = require_type();
    function compileList(schema, name) {
      const result = [];
      schema[name].forEach(function(currentType) {
        let newIndex = result.length;
        result.forEach(function(previousType, previousIndex) {
          if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) newIndex = previousIndex;
        });
        result[newIndex] = currentType;
      });
      return result;
    }
    function compileMap() {
      const result = {
        scalar: {},
        sequence: {},
        mapping: {},
        fallback: {},
        multi: {
          scalar: [],
          sequence: [],
          mapping: [],
          fallback: []
        }
      };
      function collectType(type) {
        if (type.multi) {
          result.multi[type.kind].push(type);
          result.multi["fallback"].push(type);
        } else result[type.kind][type.tag] = result["fallback"][type.tag] = type;
      }
      for (let index = 0, length = arguments.length; index < length; index += 1) arguments[index].forEach(collectType);
      return result;
    }
    function Schema2(definition) {
      return this.extend(definition);
    }
    Schema2.prototype.extend = function extend(definition) {
      let implicit = [];
      let explicit = [];
      if (definition instanceof Type2) explicit.push(definition);
      else if (Array.isArray(definition)) explicit = explicit.concat(definition);
      else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
        if (definition.implicit) implicit = implicit.concat(definition.implicit);
        if (definition.explicit) explicit = explicit.concat(definition.explicit);
      } else throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
      implicit.forEach(function(type) {
        if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
        if (type.loadKind && type.loadKind !== "scalar") throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
        if (type.multi) throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      });
      explicit.forEach(function(type) {
        if (!(type instanceof Type2)) throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      });
      const result = Object.create(Schema2.prototype);
      result.implicit = (this.implicit || []).concat(implicit);
      result.explicit = (this.explicit || []).concat(explicit);
      result.compiledImplicit = compileList(result, "implicit");
      result.compiledExplicit = compileList(result, "explicit");
      result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
      return result;
    };
    module.exports = Schema2;
  }));
  var require_str = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = new (require_type())("tag:yaml.org,2002:str", {
      kind: "scalar",
      construct: function(data) {
        return data !== null ? data : "";
      }
    });
  }));
  var require_seq = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = new (require_type())("tag:yaml.org,2002:seq", {
      kind: "sequence",
      construct: function(data) {
        return data !== null ? data : [];
      }
    });
  }));
  var require_map = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = new (require_type())("tag:yaml.org,2002:map", {
      kind: "mapping",
      construct: function(data) {
        return data !== null ? data : {};
      }
    });
  }));
  var require_failsafe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = new (require_schema())({ explicit: [
      require_str(),
      require_seq(),
      require_map()
    ] });
  }));
  var require_null = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    function resolveYamlNull(data) {
      if (data === null) return true;
      const max = data.length;
      return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
    }
    function constructYamlNull() {
      return null;
    }
    function isNull(object) {
      return object === null;
    }
    module.exports = new Type2("tag:yaml.org,2002:null", {
      kind: "scalar",
      resolve: resolveYamlNull,
      construct: constructYamlNull,
      predicate: isNull,
      represent: {
        canonical: function() {
          return "~";
        },
        lowercase: function() {
          return "null";
        },
        uppercase: function() {
          return "NULL";
        },
        camelcase: function() {
          return "Null";
        },
        empty: function() {
          return "";
        }
      },
      defaultStyle: "lowercase"
    });
  }));
  var require_bool = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    function resolveYamlBoolean(data) {
      if (data === null) return false;
      const max = data.length;
      return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
    }
    function constructYamlBoolean(data) {
      return data === "true" || data === "True" || data === "TRUE";
    }
    function isBoolean(object) {
      return Object.prototype.toString.call(object) === "[object Boolean]";
    }
    module.exports = new Type2("tag:yaml.org,2002:bool", {
      kind: "scalar",
      resolve: resolveYamlBoolean,
      construct: constructYamlBoolean,
      predicate: isBoolean,
      represent: {
        lowercase: function(object) {
          return object ? "true" : "false";
        },
        uppercase: function(object) {
          return object ? "TRUE" : "FALSE";
        },
        camelcase: function(object) {
          return object ? "True" : "False";
        }
      },
      defaultStyle: "lowercase"
    });
  }));
  var require_int = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var common = require_common();
    var Type2 = require_type();
    function isHexCode(c) {
      return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
    }
    function isOctCode(c) {
      return c >= 48 && c <= 55;
    }
    function isDecCode(c) {
      return c >= 48 && c <= 57;
    }
    function resolveYamlInteger(data) {
      if (data === null) return false;
      const max = data.length;
      let index = 0;
      let hasDigits = false;
      if (!max) return false;
      let ch = data[index];
      if (ch === "-" || ch === "+") ch = data[++index];
      if (ch === "0") {
        if (index + 1 === max) return true;
        ch = data[++index];
        if (ch === "b") {
          index++;
          for (; index < max; index++) {
            ch = data[index];
            if (ch !== "0" && ch !== "1") return false;
            hasDigits = true;
          }
          return hasDigits && Number.isFinite(parseYamlInteger(data));
        }
        if (ch === "x") {
          index++;
          for (; index < max; index++) {
            if (!isHexCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && Number.isFinite(parseYamlInteger(data));
        }
        if (ch === "o") {
          index++;
          for (; index < max; index++) {
            if (!isOctCode(data.charCodeAt(index))) return false;
            hasDigits = true;
          }
          return hasDigits && Number.isFinite(parseYamlInteger(data));
        }
      }
      for (; index < max; index++) {
        if (!isDecCode(data.charCodeAt(index))) return false;
        hasDigits = true;
      }
      if (!hasDigits) return false;
      return Number.isFinite(parseYamlInteger(data));
    }
    function parseYamlInteger(data) {
      let value = data;
      let sign = 1;
      let ch = value[0];
      if (ch === "-" || ch === "+") {
        if (ch === "-") sign = -1;
        value = value.slice(1);
        ch = value[0];
      }
      if (value === "0") return 0;
      if (ch === "0") {
        if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
        if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
        if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
      }
      return sign * parseInt(value, 10);
    }
    function constructYamlInteger(data) {
      return parseYamlInteger(data);
    }
    function isInteger(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && object % 1 === 0 && !common.isNegativeZero(object);
    }
    module.exports = new Type2("tag:yaml.org,2002:int", {
      kind: "scalar",
      resolve: resolveYamlInteger,
      construct: constructYamlInteger,
      predicate: isInteger,
      represent: {
        binary: function(obj) {
          return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
        },
        octal: function(obj) {
          return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
        },
        decimal: function(obj) {
          return obj.toString(10);
        },
        hexadecimal: function(obj) {
          return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
        }
      },
      defaultStyle: "decimal",
      styleAliases: {
        binary: [2, "bin"],
        octal: [8, "oct"],
        decimal: [10, "dec"],
        hexadecimal: [16, "hex"]
      }
    });
  }));
  var require_float = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var common = require_common();
    var Type2 = require_type();
    var YAML_FLOAT_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
    var YAML_FLOAT_SPECIAL_PATTERN = /* @__PURE__ */ new RegExp("^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$");
    function resolveYamlFloat(data) {
      if (data === null) return false;
      if (!YAML_FLOAT_PATTERN.test(data)) return false;
      if (Number.isFinite(parseFloat(data, 10))) return true;
      return YAML_FLOAT_SPECIAL_PATTERN.test(data);
    }
    function constructYamlFloat(data) {
      let value = data.toLowerCase();
      const sign = value[0] === "-" ? -1 : 1;
      if ("+-".indexOf(value[0]) >= 0) value = value.slice(1);
      if (value === ".inf") return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
      else if (value === ".nan") return NaN;
      return sign * parseFloat(value, 10);
    }
    var SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
    function representYamlFloat(object, style) {
      if (isNaN(object)) switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
      else if (Number.POSITIVE_INFINITY === object) switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
      else if (Number.NEGATIVE_INFINITY === object) switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
      else if (common.isNegativeZero(object)) return "-0.0";
      const res = object.toString(10);
      return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
    }
    function isFloat(object) {
      return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common.isNegativeZero(object));
    }
    module.exports = new Type2("tag:yaml.org,2002:float", {
      kind: "scalar",
      resolve: resolveYamlFloat,
      construct: constructYamlFloat,
      predicate: isFloat,
      represent: representYamlFloat,
      defaultStyle: "lowercase"
    });
  }));
  var require_json = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = require_failsafe().extend({ implicit: [
      require_null(),
      require_bool(),
      require_int(),
      require_float()
    ] });
  }));
  var require_core = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = require_json();
  }));
  var require_timestamp = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    var YAML_DATE_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$");
    var YAML_TIMESTAMP_REGEXP = /* @__PURE__ */ new RegExp("^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$");
    function resolveYamlTimestamp(data) {
      if (data === null) return false;
      if (YAML_DATE_REGEXP.exec(data) !== null) return true;
      if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
      return false;
    }
    function constructYamlTimestamp(data) {
      let fraction = 0;
      let delta = null;
      let match = YAML_DATE_REGEXP.exec(data);
      if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
      if (match === null) throw new Error("Date resolve error");
      const year = +match[1];
      const month = +match[2] - 1;
      const day = +match[3];
      if (!match[4]) return new Date(Date.UTC(year, month, day));
      const hour = +match[4];
      const minute = +match[5];
      const second = +match[6];
      if (match[7]) {
        fraction = match[7].slice(0, 3);
        while (fraction.length < 3) fraction += "0";
        fraction = +fraction;
      }
      if (match[9]) {
        const tzHour = +match[10];
        const tzMinute = +(match[11] || 0);
        delta = (tzHour * 60 + tzMinute) * 6e4;
        if (match[9] === "-") delta = -delta;
      }
      const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
      if (delta) date.setTime(date.getTime() - delta);
      return date;
    }
    function representYamlTimestamp(object) {
      return object.toISOString();
    }
    module.exports = new Type2("tag:yaml.org,2002:timestamp", {
      kind: "scalar",
      resolve: resolveYamlTimestamp,
      construct: constructYamlTimestamp,
      instanceOf: Date,
      represent: representYamlTimestamp
    });
  }));
  var require_merge = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    function resolveYamlMerge(data) {
      return data === "<<" || data === null;
    }
    module.exports = new Type2("tag:yaml.org,2002:merge", {
      kind: "scalar",
      resolve: resolveYamlMerge
    });
  }));
  var require_binary = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    var BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
    function resolveYamlBinary(data) {
      if (data === null) return false;
      let bitlen = 0;
      const max = data.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        const code = map.indexOf(data.charAt(idx));
        if (code > 64) continue;
        if (code < 0) return false;
        bitlen += 6;
      }
      return bitlen % 8 === 0;
    }
    function constructYamlBinary(data) {
      const input = data.replace(/[\r\n=]/g, "");
      const max = input.length;
      const map = BASE64_MAP;
      let bits = 0;
      const result = [];
      for (let idx = 0; idx < max; idx++) {
        if (idx % 4 === 0 && idx) {
          result.push(bits >> 16 & 255);
          result.push(bits >> 8 & 255);
          result.push(bits & 255);
        }
        bits = bits << 6 | map.indexOf(input.charAt(idx));
      }
      const tailbits = max % 4 * 6;
      if (tailbits === 0) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      } else if (tailbits === 18) {
        result.push(bits >> 10 & 255);
        result.push(bits >> 2 & 255);
      } else if (tailbits === 12) result.push(bits >> 4 & 255);
      return new Uint8Array(result);
    }
    function representYamlBinary(object) {
      let result = "";
      let bits = 0;
      const max = object.length;
      const map = BASE64_MAP;
      for (let idx = 0; idx < max; idx++) {
        if (idx % 3 === 0 && idx) {
          result += map[bits >> 18 & 63];
          result += map[bits >> 12 & 63];
          result += map[bits >> 6 & 63];
          result += map[bits & 63];
        }
        bits = (bits << 8) + object[idx];
      }
      const tail = max % 3;
      if (tail === 0) {
        result += map[bits >> 18 & 63];
        result += map[bits >> 12 & 63];
        result += map[bits >> 6 & 63];
        result += map[bits & 63];
      } else if (tail === 2) {
        result += map[bits >> 10 & 63];
        result += map[bits >> 4 & 63];
        result += map[bits << 2 & 63];
        result += map[64];
      } else if (tail === 1) {
        result += map[bits >> 2 & 63];
        result += map[bits << 4 & 63];
        result += map[64];
        result += map[64];
      }
      return result;
    }
    function isBinary(obj) {
      return Object.prototype.toString.call(obj) === "[object Uint8Array]";
    }
    module.exports = new Type2("tag:yaml.org,2002:binary", {
      kind: "scalar",
      resolve: resolveYamlBinary,
      construct: constructYamlBinary,
      predicate: isBinary,
      represent: representYamlBinary
    });
  }));
  var require_omap = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var _toString = Object.prototype.toString;
    function resolveYamlOmap(data) {
      if (data === null) return true;
      const objectKeys = [];
      const object = data;
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        let pairHasKey = false;
        if (_toString.call(pair) !== "[object Object]") return false;
        let pairKey;
        for (pairKey in pair) if (_hasOwnProperty.call(pair, pairKey)) if (!pairHasKey) pairHasKey = true;
        else return false;
        if (!pairHasKey) return false;
        if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
        else return false;
      }
      return true;
    }
    function constructYamlOmap(data) {
      return data !== null ? data : [];
    }
    module.exports = new Type2("tag:yaml.org,2002:omap", {
      kind: "sequence",
      resolve: resolveYamlOmap,
      construct: constructYamlOmap
    });
  }));
  var require_pairs = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    var _toString = Object.prototype.toString;
    function resolveYamlPairs(data) {
      if (data === null) return true;
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        if (_toString.call(pair) !== "[object Object]") return false;
        const keys = Object.keys(pair);
        if (keys.length !== 1) return false;
        result[index] = [keys[0], pair[keys[0]]];
      }
      return true;
    }
    function constructYamlPairs(data) {
      if (data === null) return [];
      const object = data;
      const result = new Array(object.length);
      for (let index = 0, length = object.length; index < length; index += 1) {
        const pair = object[index];
        const keys = Object.keys(pair);
        result[index] = [keys[0], pair[keys[0]]];
      }
      return result;
    }
    module.exports = new Type2("tag:yaml.org,2002:pairs", {
      kind: "sequence",
      resolve: resolveYamlPairs,
      construct: constructYamlPairs
    });
  }));
  var require_set = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var Type2 = require_type();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    function resolveYamlSet(data) {
      if (data === null) return true;
      const object = data;
      for (const key in object) if (_hasOwnProperty.call(object, key)) {
        if (object[key] !== null) return false;
      }
      return true;
    }
    function constructYamlSet(data) {
      return data !== null ? data : {};
    }
    module.exports = new Type2("tag:yaml.org,2002:set", {
      kind: "mapping",
      resolve: resolveYamlSet,
      construct: constructYamlSet
    });
  }));
  var require_default = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    module.exports = require_core().extend({
      implicit: [require_timestamp(), require_merge()],
      explicit: [
        require_binary(),
        require_omap(),
        require_pairs(),
        require_set()
      ]
    });
  }));
  var require_loader = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var common = require_common();
    var YAMLException2 = require_exception();
    var makeSnippet = require_snippet();
    var DEFAULT_SCHEMA2 = require_default();
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CONTEXT_FLOW_IN = 1;
    var CONTEXT_FLOW_OUT = 2;
    var CONTEXT_BLOCK_IN = 3;
    var CONTEXT_BLOCK_OUT = 4;
    var CHOMPING_CLIP = 1;
    var CHOMPING_STRIP = 2;
    var CHOMPING_KEEP = 3;
    var PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
    var PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
    var PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
    var PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
    var PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
    function _class(obj) {
      return Object.prototype.toString.call(obj);
    }
    function isEol(c) {
      return c === 10 || c === 13;
    }
    function isWhiteSpace(c) {
      return c === 9 || c === 32;
    }
    function isWsOrEol(c) {
      return c === 9 || c === 32 || c === 10 || c === 13;
    }
    function isFlowIndicator(c) {
      return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
    }
    function fromHexCode(c) {
      if (c >= 48 && c <= 57) return c - 48;
      const lc7 = c | 32;
      if (lc7 >= 97 && lc7 <= 102) return lc7 - 97 + 10;
      return -1;
    }
    function escapedHexLen(c) {
      if (c === 120) return 2;
      if (c === 117) return 4;
      if (c === 85) return 8;
      return 0;
    }
    function fromDecimalCode(c) {
      if (c >= 48 && c <= 57) return c - 48;
      return -1;
    }
    function simpleEscapeSequence(c) {
      switch (c) {
        case 48:
          return "\0";
        case 97:
          return "\x07";
        case 98:
          return "\b";
        case 116:
          return "	";
        case 9:
          return "	";
        case 110:
          return "\n";
        case 118:
          return "\v";
        case 102:
          return "\f";
        case 114:
          return "\r";
        case 101:
          return "\x1B";
        case 32:
          return " ";
        case 34:
          return '"';
        case 47:
          return "/";
        case 92:
          return "\\";
        case 78:
          return "";
        case 95:
          return " ";
        case 76:
          return "\u2028";
        case 80:
          return "\u2029";
        default:
          return "";
      }
    }
    function charFromCodepoint(c) {
      if (c <= 65535) return String.fromCharCode(c);
      return String.fromCharCode((c - 65536 >> 10) + 55296, (c - 65536 & 1023) + 56320);
    }
    function setProperty(object, key, value) {
      if (key === "__proto__") Object.defineProperty(object, key, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
      else object[key] = value;
    }
    var simpleEscapeCheck = new Array(256);
    var simpleEscapeMap = new Array(256);
    for (let i = 0; i < 256; i++) {
      simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
      simpleEscapeMap[i] = simpleEscapeSequence(i);
    }
    function State(input, options) {
      this.input = input;
      this.filename = options["filename"] || null;
      this.schema = options["schema"] || DEFAULT_SCHEMA2;
      this.onWarning = options["onWarning"] || null;
      this.legacy = options["legacy"] || false;
      this.json = options["json"] || false;
      this.listener = options["listener"] || null;
      this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
      this.maxMergeSeqLength = typeof options["maxMergeSeqLength"] === "number" ? options["maxMergeSeqLength"] : 20;
      this.implicitTypes = this.schema.compiledImplicit;
      this.typeMap = this.schema.compiledTypeMap;
      this.length = input.length;
      this.position = 0;
      this.line = 0;
      this.lineStart = 0;
      this.lineIndent = 0;
      this.depth = 0;
      this.firstTabInLine = -1;
      this.documents = [];
      this.anchorMapTransactions = [];
    }
    function generateError(state, message) {
      const mark = {
        name: state.filename,
        buffer: state.input.slice(0, -1),
        position: state.position,
        line: state.line,
        column: state.position - state.lineStart
      };
      mark.snippet = makeSnippet(mark);
      return new YAMLException2(message, mark);
    }
    function throwError(state, message) {
      throw generateError(state, message);
    }
    function throwWarning(state, message) {
      if (state.onWarning) state.onWarning.call(null, generateError(state, message));
    }
    function storeAnchor(state, name, value) {
      const transactions = state.anchorMapTransactions;
      if (transactions.length !== 0) {
        const transaction = transactions[transactions.length - 1];
        if (!_hasOwnProperty.call(transaction, name)) transaction[name] = {
          existed: _hasOwnProperty.call(state.anchorMap, name),
          value: state.anchorMap[name]
        };
      }
      state.anchorMap[name] = value;
    }
    function beginAnchorTransaction(state) {
      state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
    }
    function commitAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const transactions = state.anchorMapTransactions;
      if (transactions.length === 0) return;
      const parent = transactions[transactions.length - 1];
      const names = Object.keys(transaction);
      for (let index = 0, length = names.length; index < length; index += 1) {
        const name = names[index];
        if (!_hasOwnProperty.call(parent, name)) parent[name] = transaction[name];
      }
    }
    function rollbackAnchorTransaction(state) {
      const transaction = state.anchorMapTransactions.pop();
      const names = Object.keys(transaction);
      for (let index = names.length - 1; index >= 0; index -= 1) {
        const entry = transaction[names[index]];
        if (entry.existed) state.anchorMap[names[index]] = entry.value;
        else delete state.anchorMap[names[index]];
      }
    }
    function snapshotState(state) {
      return {
        position: state.position,
        line: state.line,
        lineStart: state.lineStart,
        lineIndent: state.lineIndent,
        firstTabInLine: state.firstTabInLine,
        tag: state.tag,
        anchor: state.anchor,
        kind: state.kind,
        result: state.result
      };
    }
    function restoreState(state, snapshot) {
      state.position = snapshot.position;
      state.line = snapshot.line;
      state.lineStart = snapshot.lineStart;
      state.lineIndent = snapshot.lineIndent;
      state.firstTabInLine = snapshot.firstTabInLine;
      state.tag = snapshot.tag;
      state.anchor = snapshot.anchor;
      state.kind = snapshot.kind;
      state.result = snapshot.result;
    }
    var directiveHandlers = {
      YAML: function handleYamlDirective(state, name, args) {
        if (state.version !== null) throwError(state, "duplication of %YAML directive");
        if (args.length !== 1) throwError(state, "YAML directive accepts exactly one argument");
        const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
        if (match === null) throwError(state, "ill-formed argument of the YAML directive");
        const major = parseInt(match[1], 10);
        const minor = parseInt(match[2], 10);
        if (major !== 1) throwError(state, "unacceptable YAML version of the document");
        state.version = args[0];
        state.checkLineBreaks = minor < 2;
        if (minor !== 1 && minor !== 2) throwWarning(state, "unsupported YAML version of the document");
      },
      TAG: function handleTagDirective(state, name, args) {
        let prefix;
        if (args.length !== 2) throwError(state, "TAG directive accepts exactly two arguments");
        const handle = args[0];
        prefix = args[1];
        if (!PATTERN_TAG_HANDLE.test(handle)) throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
        if (_hasOwnProperty.call(state.tagMap, handle)) throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
        if (!PATTERN_TAG_URI.test(prefix)) throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
        try {
          prefix = decodeURIComponent(prefix);
        } catch (err) {
          throwError(state, "tag prefix is malformed: " + prefix);
        }
        state.tagMap[handle] = prefix;
      }
    };
    function captureSegment(state, start, end, checkJson) {
      if (start < end) {
        const _result = state.input.slice(start, end);
        if (checkJson) for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) throwError(state, "expected valid JSON character");
        }
        else if (PATTERN_NON_PRINTABLE.test(_result)) throwError(state, "the stream contains non-printable characters");
        state.result += _result;
      }
    }
    function mergeMappings(state, destination, source, overridableKeys) {
      if (!common.isObject(source)) throwError(state, "cannot merge mappings; the provided source object is unacceptable");
      const sourceKeys = Object.keys(source);
      for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
        const key = sourceKeys[index];
        if (!_hasOwnProperty.call(destination, key)) {
          setProperty(destination, key, source[key]);
          overridableKeys[key] = true;
        }
      }
    }
    function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
      if (Array.isArray(keyNode)) {
        keyNode = Array.prototype.slice.call(keyNode);
        for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
          if (Array.isArray(keyNode[index])) throwError(state, "nested arrays are not supported inside keys");
          if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") keyNode[index] = "[object Object]";
        }
      }
      if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") keyNode = "[object Object]";
      keyNode = String(keyNode);
      if (_result === null) _result = {};
      if (keyTag === "tag:yaml.org,2002:merge") if (Array.isArray(valueNode)) {
        if (valueNode.length > state.maxMergeSeqLength) throwError(state, "merge sequence length exceeded maxMergeSeqLength (" + state.maxMergeSeqLength + ")");
        const seen = /* @__PURE__ */ new Set();
        for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
          const src = valueNode[index];
          if (seen.has(src)) continue;
          seen.add(src);
          mergeMappings(state, _result, src, overridableKeys);
        }
      } else mergeMappings(state, _result, valueNode, overridableKeys);
      else {
        if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
          state.line = startLine || state.line;
          state.lineStart = startLineStart || state.lineStart;
          state.position = startPos || state.position;
          throwError(state, "duplicated mapping key");
        }
        setProperty(_result, keyNode, valueNode);
        delete overridableKeys[keyNode];
      }
      return _result;
    }
    function readLineBreak(state) {
      const ch = state.input.charCodeAt(state.position);
      if (ch === 10) state.position++;
      else if (ch === 13) {
        state.position++;
        if (state.input.charCodeAt(state.position) === 10) state.position++;
      } else throwError(state, "a line break is expected");
      state.line += 1;
      state.lineStart = state.position;
      state.firstTabInLine = -1;
    }
    function skipSeparationSpace(state, allowComments, checkIndent) {
      let lineBreaks = 0;
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          if (ch === 9 && state.firstTabInLine === -1) state.firstTabInLine = state.position;
          ch = state.input.charCodeAt(++state.position);
        }
        if (allowComments && ch === 35) do
          ch = state.input.charCodeAt(++state.position);
        while (ch !== 10 && ch !== 13 && ch !== 0);
        if (isEol(ch)) {
          readLineBreak(state);
          ch = state.input.charCodeAt(state.position);
          lineBreaks++;
          state.lineIndent = 0;
          while (ch === 32) {
            state.lineIndent++;
            ch = state.input.charCodeAt(++state.position);
          }
        } else break;
      }
      if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) throwWarning(state, "deficient indentation");
      return lineBreaks;
    }
    function testDocumentSeparator(state) {
      let _position = state.position;
      let ch = state.input.charCodeAt(_position);
      if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
        _position += 3;
        ch = state.input.charCodeAt(_position);
        if (ch === 0 || isWsOrEol(ch)) return true;
      }
      return false;
    }
    function writeFoldedLines(state, count) {
      if (count === 1) state.result += " ";
      else if (count > 1) state.result += common.repeat("\n", count - 1);
    }
    function readPlainScalar(state, nodeIndent, withinFlowCollection) {
      let captureStart;
      let captureEnd;
      let hasPendingContent;
      let _line;
      let _lineStart;
      let _lineIndent;
      const _kind = state.kind;
      const _result = state.result;
      let ch = state.input.charCodeAt(state.position);
      if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) return false;
      if (ch === 63 || ch === 45) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) return false;
      }
      state.kind = "scalar";
      state.result = "";
      captureStart = captureEnd = state.position;
      hasPendingContent = false;
      while (ch !== 0) {
        if (ch === 58) {
          const following = state.input.charCodeAt(state.position + 1);
          if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) break;
        } else if (ch === 35) {
          if (isWsOrEol(state.input.charCodeAt(state.position - 1))) break;
        } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) break;
        else if (isEol(ch)) {
          _line = state.line;
          _lineStart = state.lineStart;
          _lineIndent = state.lineIndent;
          skipSeparationSpace(state, false, -1);
          if (state.lineIndent >= nodeIndent) {
            hasPendingContent = true;
            ch = state.input.charCodeAt(state.position);
            continue;
          } else {
            state.position = captureEnd;
            state.line = _line;
            state.lineStart = _lineStart;
            state.lineIndent = _lineIndent;
            break;
          }
        }
        if (hasPendingContent) {
          captureSegment(state, captureStart, captureEnd, false);
          writeFoldedLines(state, state.line - _line);
          captureStart = captureEnd = state.position;
          hasPendingContent = false;
        }
        if (!isWhiteSpace(ch)) captureEnd = state.position + 1;
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, captureEnd, false);
      if (state.result) return true;
      state.kind = _kind;
      state.result = _result;
      return false;
    }
    function readSingleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 39) return false;
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else return true;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a single quoted scalar");
      else {
        state.position++;
        if (!isWhiteSpace(ch)) captureEnd = state.position;
      }
      throwError(state, "unexpected end of the stream within a single quoted scalar");
    }
    function readDoubleQuotedScalar(state, nodeIndent) {
      let captureStart;
      let captureEnd;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 34) return false;
      state.kind = "scalar";
      state.result = "";
      state.position++;
      captureStart = captureEnd = state.position;
      while ((ch = state.input.charCodeAt(state.position)) !== 0) if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) skipSeparationSpace(state, false, nodeIndent);
        else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (; hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) hexResult = (hexResult << 4) + tmp;
            else throwError(state, "expected hexadecimal character");
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else throwError(state, "unknown escape sequence");
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) throwError(state, "unexpected end of the document within a double quoted scalar");
      else {
        state.position++;
        if (!isWhiteSpace(ch)) captureEnd = state.position;
      }
      throwError(state, "unexpected end of the stream within a double quoted scalar");
    }
    function readFlowCollection(state, nodeIndent) {
      let readNext = true;
      let _line;
      let _lineStart;
      let _pos;
      const _tag = state.tag;
      let _result;
      const _anchor = state.anchor;
      let terminator;
      let isPair;
      let isExplicitPair;
      let isMapping;
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyNode;
      let keyTag;
      let valueNode;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 91) {
        terminator = 93;
        isMapping = false;
        _result = [];
      } else if (ch === 123) {
        terminator = 125;
        isMapping = true;
        _result = {};
      } else return false;
      if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
      ch = state.input.charCodeAt(++state.position);
      while (ch !== 0) {
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === terminator) {
          state.position++;
          state.tag = _tag;
          state.anchor = _anchor;
          state.kind = isMapping ? "mapping" : "sequence";
          state.result = _result;
          return true;
        } else if (!readNext) throwError(state, "missed comma between flow collection entries");
        else if (ch === 44) throwError(state, "expected the node content, but found ','");
        keyTag = keyNode = valueNode = null;
        isPair = isExplicitPair = false;
        if (ch === 63) {
          if (isWsOrEol(state.input.charCodeAt(state.position + 1))) {
            isPair = isExplicitPair = true;
            state.position++;
            skipSeparationSpace(state, true, nodeIndent);
          }
        }
        _line = state.line;
        _lineStart = state.lineStart;
        _pos = state.position;
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        keyTag = state.tag;
        keyNode = state.result;
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if ((isExplicitPair || state.line === _line) && ch === 58) {
          isPair = true;
          ch = state.input.charCodeAt(++state.position);
          skipSeparationSpace(state, true, nodeIndent);
          composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
          valueNode = state.result;
        }
        if (isMapping) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
        else if (isPair) _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
        else _result.push(keyNode);
        skipSeparationSpace(state, true, nodeIndent);
        ch = state.input.charCodeAt(state.position);
        if (ch === 44) {
          readNext = true;
          ch = state.input.charCodeAt(++state.position);
        } else readNext = false;
      }
      throwError(state, "unexpected end of the stream within a flow collection");
    }
    function readBlockScalar(state, nodeIndent) {
      let folding;
      let chomping = CHOMPING_CLIP;
      let didReadContent = false;
      let detectedIndent = false;
      let textIndent = nodeIndent;
      let emptyLines = 0;
      let atMoreIndented = false;
      let tmp;
      let ch = state.input.charCodeAt(state.position);
      if (ch === 124) folding = false;
      else if (ch === 62) folding = true;
      else return false;
      state.kind = "scalar";
      state.result = "";
      while (ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
        if (ch === 43 || ch === 45) if (CHOMPING_CLIP === chomping) chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        else throwError(state, "repeat of a chomping mode identifier");
        else if ((tmp = fromDecimalCode(ch)) >= 0) if (tmp === 0) throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else throwError(state, "repeat of an indentation width identifier");
        else break;
      }
      if (isWhiteSpace(ch)) {
        do
          ch = state.input.charCodeAt(++state.position);
        while (isWhiteSpace(ch));
        if (ch === 35) do
          ch = state.input.charCodeAt(++state.position);
        while (!isEol(ch) && ch !== 0);
      }
      while (ch !== 0) {
        readLineBreak(state);
        state.lineIndent = 0;
        ch = state.input.charCodeAt(state.position);
        while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
        if (!detectedIndent && state.lineIndent > textIndent) textIndent = state.lineIndent;
        if (isEol(ch)) {
          emptyLines++;
          continue;
        }
        if (!detectedIndent && textIndent === 0) throwError(state, "missing indentation for block scalar");
        if (state.lineIndent < textIndent) {
          if (chomping === CHOMPING_KEEP) state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
          else if (chomping === CHOMPING_CLIP) {
            if (didReadContent) state.result += "\n";
          }
          break;
        }
        if (folding) if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common.repeat("\n", emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) state.result += " ";
        } else state.result += common.repeat("\n", emptyLines);
        else state.result += common.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        didReadContent = true;
        detectedIndent = true;
        emptyLines = 0;
        const captureStart = state.position;
        while (!isEol(ch) && ch !== 0) ch = state.input.charCodeAt(++state.position);
        captureSegment(state, captureStart, state.position, false);
      }
      return true;
    }
    function readBlockSequence(state, nodeIndent) {
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = [];
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        if (ch !== 45) break;
        if (!isWsOrEol(state.input.charCodeAt(state.position + 1))) break;
        detected = true;
        state.position++;
        if (skipSeparationSpace(state, true, -1)) {
          if (state.lineIndent <= nodeIndent) {
            _result.push(null);
            ch = state.input.charCodeAt(state.position);
            continue;
          }
        }
        const _line = state.line;
        composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
        _result.push(state.result);
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a sequence entry");
        else if (state.lineIndent < nodeIndent) break;
      }
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "sequence";
        state.result = _result;
        return true;
      }
      return false;
    }
    function readBlockMapping(state, nodeIndent, flowIndent) {
      let allowCompact;
      let _keyLine;
      let _keyLineStart;
      let _keyPos;
      const _tag = state.tag;
      const _anchor = state.anchor;
      const _result = {};
      const overridableKeys = /* @__PURE__ */ Object.create(null);
      let keyTag = null;
      let keyNode = null;
      let valueNode = null;
      let atExplicitKey = false;
      let detected = false;
      if (state.firstTabInLine !== -1) return false;
      if (state.anchor !== null) storeAnchor(state, state.anchor, _result);
      let ch = state.input.charCodeAt(state.position);
      while (ch !== 0) {
        if (!atExplicitKey && state.firstTabInLine !== -1) {
          state.position = state.firstTabInLine;
          throwError(state, "tab characters must not be used in indentation");
        }
        const following = state.input.charCodeAt(state.position + 1);
        const _line = state.line;
        if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
          if (ch === 63) {
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = true;
            allowCompact = true;
          } else if (atExplicitKey) {
            atExplicitKey = false;
            allowCompact = true;
          } else throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
          state.position += 1;
          ch = following;
        } else {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
          if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) break;
          if (state.line === _line) {
            ch = state.input.charCodeAt(state.position);
            while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
            if (ch === 58) {
              ch = state.input.charCodeAt(++state.position);
              if (!isWsOrEol(ch)) throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
              if (atExplicitKey) {
                storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
                keyTag = keyNode = valueNode = null;
              }
              detected = true;
              atExplicitKey = false;
              allowCompact = false;
              keyTag = state.tag;
              keyNode = state.result;
            } else if (detected) throwError(state, "can not read an implicit mapping pair; a colon is missed");
            else {
              state.tag = _tag;
              state.anchor = _anchor;
              return true;
            }
          } else if (detected) throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
          else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        }
        if (state.line === _line || state.lineIndent > nodeIndent) {
          if (atExplicitKey) {
            _keyLine = state.line;
            _keyLineStart = state.lineStart;
            _keyPos = state.position;
          }
          if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) if (atExplicitKey) keyNode = state.result;
          else valueNode = state.result;
          if (!atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          skipSeparationSpace(state, true, -1);
          ch = state.input.charCodeAt(state.position);
        }
        if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) throwError(state, "bad indentation of a mapping entry");
        else if (state.lineIndent < nodeIndent) break;
      }
      if (atExplicitKey) storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
      if (detected) {
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = "mapping";
        state.result = _result;
      }
      return detected;
    }
    function readTagProperty(state) {
      let isVerbatim = false;
      let isNamed = false;
      let tagHandle;
      let tagName;
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 33) return false;
      if (state.tag !== null) throwError(state, "duplication of a tag property");
      ch = state.input.charCodeAt(++state.position);
      if (ch === 60) {
        isVerbatim = true;
        ch = state.input.charCodeAt(++state.position);
      } else if (ch === 33) {
        isNamed = true;
        tagHandle = "!!";
        ch = state.input.charCodeAt(++state.position);
      } else tagHandle = "!";
      let _position = state.position;
      if (isVerbatim) {
        do
          ch = state.input.charCodeAt(++state.position);
        while (ch !== 0 && ch !== 62);
        if (state.position < state.length) {
          tagName = state.input.slice(_position, state.position);
          ch = state.input.charCodeAt(++state.position);
        } else throwError(state, "unexpected end of the stream within a verbatim tag");
      } else {
        while (ch !== 0 && !isWsOrEol(ch)) {
          if (ch === 33) if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) throwError(state, "named tag handle cannot contain such characters");
            isNamed = true;
            _position = state.position + 1;
          } else throwError(state, "tag suffix cannot contain exclamation marks");
          ch = state.input.charCodeAt(++state.position);
        }
        tagName = state.input.slice(_position, state.position);
        if (PATTERN_FLOW_INDICATORS.test(tagName)) throwError(state, "tag suffix cannot contain flow indicator characters");
      }
      if (tagName && !PATTERN_TAG_URI.test(tagName)) throwError(state, "tag name cannot contain such characters: " + tagName);
      try {
        tagName = decodeURIComponent(tagName);
      } catch (err) {
        throwError(state, "tag name is malformed: " + tagName);
      }
      if (isVerbatim) state.tag = tagName;
      else if (_hasOwnProperty.call(state.tagMap, tagHandle)) state.tag = state.tagMap[tagHandle] + tagName;
      else if (tagHandle === "!") state.tag = "!" + tagName;
      else if (tagHandle === "!!") state.tag = "tag:yaml.org,2002:" + tagName;
      else throwError(state, 'undeclared tag handle "' + tagHandle + '"');
      return true;
    }
    function readAnchorProperty(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 38) return false;
      if (state.anchor !== null) throwError(state, "duplication of an anchor property");
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
      if (state.position === _position) throwError(state, "name of an anchor node must contain at least one character");
      state.anchor = state.input.slice(_position, state.position);
      return true;
    }
    function readAlias(state) {
      let ch = state.input.charCodeAt(state.position);
      if (ch !== 42) return false;
      ch = state.input.charCodeAt(++state.position);
      const _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) ch = state.input.charCodeAt(++state.position);
      if (state.position === _position) throwError(state, "name of an alias node must contain at least one character");
      const alias = state.input.slice(_position, state.position);
      if (!_hasOwnProperty.call(state.anchorMap, alias)) throwError(state, 'unidentified alias "' + alias + '"');
      state.result = state.anchorMap[alias];
      skipSeparationSpace(state, true, -1);
      return true;
    }
    function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
      const fallbackState = snapshotState(state);
      beginAnchorTransaction(state);
      restoreState(state, propertyStart);
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
        commitAnchorTransaction(state);
        return true;
      }
      rollbackAnchorTransaction(state);
      restoreState(state, fallbackState);
      return false;
    }
    function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
      let allowBlockScalars;
      let allowBlockCollections;
      let indentStatus = 1;
      let atNewLine = false;
      let hasContent = false;
      let propertyStart = null;
      let type;
      let flowIndent;
      let blockIndent;
      if (state.depth >= state.maxDepth) throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
      state.depth += 1;
      if (state.listener !== null) state.listener("open", state);
      state.tag = null;
      state.anchor = null;
      state.kind = null;
      state.result = null;
      const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
      if (allowToSeek) {
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          if (state.lineIndent > parentIndent) indentStatus = 1;
          else if (state.lineIndent === parentIndent) indentStatus = 0;
          else if (state.lineIndent < parentIndent) indentStatus = -1;
        }
      }
      if (indentStatus === 1) while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) break;
        if (!readTagProperty(state) && !readAnchorProperty(state)) break;
        if (propertyStart === null) propertyStart = propertyState;
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) indentStatus = 1;
          else if (state.lineIndent === parentIndent) indentStatus = 0;
          else if (state.lineIndent < parentIndent) indentStatus = -1;
        } else allowBlockCollections = false;
      }
      if (allowBlockCollections) allowBlockCollections = atNewLine || allowCompact;
      if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
        if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) flowIndent = parentIndent;
        else flowIndent = parentIndent + 1;
        blockIndent = state.position - state.lineStart;
        if (indentStatus === 1) if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) hasContent = true;
        else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(state, propertyStart, propertyStart.position - propertyStart.lineStart, flowIndent)) hasContent = true;
          else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) hasContent = true;
          else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) throwError(state, "alias node should not have any properties");
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) state.tag = "?";
          }
          if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
        }
        else if (indentStatus === 0) hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
      if (state.tag === null) {
        if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
      } else if (state.tag === "?") {
        if (state.result !== null && state.kind !== "scalar") throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
        for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
          type = state.implicitTypes[typeIndex];
          if (type.resolve(state.result)) {
            state.result = type.construct(state.result);
            state.tag = type.tag;
            if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
            break;
          }
        }
      } else if (state.tag !== "!") {
        if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) type = state.typeMap[state.kind || "fallback"][state.tag];
        else {
          type = null;
          const typeList = state.typeMap.multi[state.kind || "fallback"];
          for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type = typeList[typeIndex];
            break;
          }
        }
        if (!type) throwError(state, "unknown tag !<" + state.tag + ">");
        if (state.result !== null && type.kind !== state.kind) throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type.kind + '", not "' + state.kind + '"');
        if (!type.resolve(state.result, state.tag)) throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
        else {
          state.result = type.construct(state.result, state.tag);
          if (state.anchor !== null) storeAnchor(state, state.anchor, state.result);
        }
      }
      if (state.listener !== null) state.listener("close", state);
      state.depth -= 1;
      return state.tag !== null || state.anchor !== null || hasContent;
    }
    function readDocument(state) {
      const documentStart = state.position;
      let hasDirectives = false;
      let ch;
      state.version = null;
      state.checkLineBreaks = state.legacy;
      state.tagMap = /* @__PURE__ */ Object.create(null);
      state.anchorMap = /* @__PURE__ */ Object.create(null);
      while ((ch = state.input.charCodeAt(state.position)) !== 0) {
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
        if (state.lineIndent > 0 || ch !== 37) break;
        hasDirectives = true;
        ch = state.input.charCodeAt(++state.position);
        let _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
        const directiveName = state.input.slice(_position, state.position);
        const directiveArgs = [];
        if (directiveName.length < 1) throwError(state, "directive name must not be less than one character in length");
        while (ch !== 0) {
          while (isWhiteSpace(ch)) ch = state.input.charCodeAt(++state.position);
          if (ch === 35) {
            do
              ch = state.input.charCodeAt(++state.position);
            while (ch !== 0 && !isEol(ch));
            break;
          }
          if (isEol(ch)) break;
          _position = state.position;
          while (ch !== 0 && !isWsOrEol(ch)) ch = state.input.charCodeAt(++state.position);
          directiveArgs.push(state.input.slice(_position, state.position));
        }
        if (ch !== 0) readLineBreak(state);
        if (_hasOwnProperty.call(directiveHandlers, directiveName)) directiveHandlers[directiveName](state, directiveName, directiveArgs);
        else throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
      skipSeparationSpace(state, true, -1);
      if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      } else if (hasDirectives) throwError(state, "directives end mark is expected");
      composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
      skipSeparationSpace(state, true, -1);
      if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) throwWarning(state, "non-ASCII line breaks are interpreted as content");
      state.documents.push(state.result);
      if (state.position === state.lineStart && testDocumentSeparator(state)) {
        if (state.input.charCodeAt(state.position) === 46) {
          state.position += 3;
          skipSeparationSpace(state, true, -1);
        }
        return;
      }
      if (state.position < state.length - 1) throwError(state, "end of the stream or a document separator is expected");
    }
    function loadDocuments(input, options) {
      input = String(input);
      options = options || {};
      if (input.length !== 0) {
        if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) input += "\n";
        if (input.charCodeAt(0) === 65279) input = input.slice(1);
      }
      const state = new State(input, options);
      const nullpos = input.indexOf("\0");
      if (nullpos !== -1) {
        state.position = nullpos;
        throwError(state, "null byte is not allowed in input");
      }
      state.input += "\0";
      while (state.input.charCodeAt(state.position) === 32) {
        state.lineIndent += 1;
        state.position += 1;
      }
      while (state.position < state.length - 1) readDocument(state);
      return state.documents;
    }
    function loadAll2(input, iterator, options) {
      if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
        options = iterator;
        iterator = null;
      }
      const documents = loadDocuments(input, options);
      if (typeof iterator !== "function") return documents;
      for (let index = 0, length = documents.length; index < length; index += 1) iterator(documents[index]);
    }
    function load2(input, options) {
      const documents = loadDocuments(input, options);
      if (documents.length === 0) return;
      else if (documents.length === 1) return documents[0];
      throw new YAMLException2("expected a single document in the stream, but found more");
    }
    module.exports.loadAll = loadAll2;
    module.exports.load = load2;
  }));
  var require_dumper = /* @__PURE__ */ __commonJSMin(((exports, module) => {
    var common = require_common();
    var YAMLException2 = require_exception();
    var DEFAULT_SCHEMA2 = require_default();
    var _toString = Object.prototype.toString;
    var _hasOwnProperty = Object.prototype.hasOwnProperty;
    var CHAR_BOM = 65279;
    var CHAR_TAB = 9;
    var CHAR_LINE_FEED = 10;
    var CHAR_CARRIAGE_RETURN = 13;
    var CHAR_SPACE = 32;
    var CHAR_EXCLAMATION = 33;
    var CHAR_DOUBLE_QUOTE = 34;
    var CHAR_SHARP = 35;
    var CHAR_PERCENT = 37;
    var CHAR_AMPERSAND = 38;
    var CHAR_SINGLE_QUOTE = 39;
    var CHAR_ASTERISK = 42;
    var CHAR_COMMA = 44;
    var CHAR_MINUS = 45;
    var CHAR_COLON = 58;
    var CHAR_EQUALS = 61;
    var CHAR_GREATER_THAN = 62;
    var CHAR_QUESTION = 63;
    var CHAR_COMMERCIAL_AT = 64;
    var CHAR_LEFT_SQUARE_BRACKET = 91;
    var CHAR_RIGHT_SQUARE_BRACKET = 93;
    var CHAR_GRAVE_ACCENT = 96;
    var CHAR_LEFT_CURLY_BRACKET = 123;
    var CHAR_VERTICAL_LINE = 124;
    var CHAR_RIGHT_CURLY_BRACKET = 125;
    var ESCAPE_SEQUENCES = {};
    ESCAPE_SEQUENCES[0] = "\\0";
    ESCAPE_SEQUENCES[7] = "\\a";
    ESCAPE_SEQUENCES[8] = "\\b";
    ESCAPE_SEQUENCES[9] = "\\t";
    ESCAPE_SEQUENCES[10] = "\\n";
    ESCAPE_SEQUENCES[11] = "\\v";
    ESCAPE_SEQUENCES[12] = "\\f";
    ESCAPE_SEQUENCES[13] = "\\r";
    ESCAPE_SEQUENCES[27] = "\\e";
    ESCAPE_SEQUENCES[34] = '\\"';
    ESCAPE_SEQUENCES[92] = "\\\\";
    ESCAPE_SEQUENCES[133] = "\\N";
    ESCAPE_SEQUENCES[160] = "\\_";
    ESCAPE_SEQUENCES[8232] = "\\L";
    ESCAPE_SEQUENCES[8233] = "\\P";
    var DEPRECATED_BOOLEANS_SYNTAX = [
      "y",
      "Y",
      "yes",
      "Yes",
      "YES",
      "on",
      "On",
      "ON",
      "n",
      "N",
      "no",
      "No",
      "NO",
      "off",
      "Off",
      "OFF"
    ];
    var DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
    function compileStyleMap(schema, map) {
      if (map === null) return {};
      const result = {};
      const keys = Object.keys(map);
      for (let index = 0, length = keys.length; index < length; index += 1) {
        let tag = keys[index];
        let style = String(map[tag]);
        if (tag.slice(0, 2) === "!!") tag = "tag:yaml.org,2002:" + tag.slice(2);
        const type = schema.compiledTypeMap["fallback"][tag];
        if (type && _hasOwnProperty.call(type.styleAliases, style)) style = type.styleAliases[style];
        result[tag] = style;
      }
      return result;
    }
    function encodeHex(character) {
      let handle;
      let length;
      const string = character.toString(16).toUpperCase();
      if (character <= 255) {
        handle = "x";
        length = 2;
      } else if (character <= 65535) {
        handle = "u";
        length = 4;
      } else if (character <= 4294967295) {
        handle = "U";
        length = 8;
      } else throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
      return "\\" + handle + common.repeat("0", length - string.length) + string;
    }
    var QUOTING_TYPE_SINGLE = 1;
    var QUOTING_TYPE_DOUBLE = 2;
    function State(options) {
      this.schema = options["schema"] || DEFAULT_SCHEMA2;
      this.indent = Math.max(1, options["indent"] || 2);
      this.noArrayIndent = options["noArrayIndent"] || false;
      this.skipInvalid = options["skipInvalid"] || false;
      this.flowLevel = common.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
      this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
      this.sortKeys = options["sortKeys"] || false;
      this.lineWidth = options["lineWidth"] || 80;
      this.noRefs = options["noRefs"] || false;
      this.noCompatMode = options["noCompatMode"] || false;
      this.condenseFlow = options["condenseFlow"] || false;
      this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
      this.forceQuotes = options["forceQuotes"] || false;
      this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
      this.implicitTypes = this.schema.compiledImplicit;
      this.explicitTypes = this.schema.compiledExplicit;
      this.tag = null;
      this.result = "";
      this.duplicates = [];
      this.usedDuplicates = null;
    }
    function indentString(string, spaces) {
      const ind = common.repeat(" ", spaces);
      let position = 0;
      let result = "";
      const length = string.length;
      while (position < length) {
        let line;
        const next = string.indexOf("\n", position);
        if (next === -1) {
          line = string.slice(position);
          position = length;
        } else {
          line = string.slice(position, next + 1);
          position = next + 1;
        }
        if (line.length && line !== "\n") result += ind;
        result += line;
      }
      return result;
    }
    function generateNextLine(state, level) {
      return "\n" + common.repeat(" ", state.indent * level);
    }
    function testImplicitResolving(state, str) {
      for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) if (state.implicitTypes[index].resolve(str)) return true;
      return false;
    }
    function isWhitespace(c) {
      return c === CHAR_SPACE || c === CHAR_TAB;
    }
    function isPrintable(c) {
      return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
    }
    function isNsCharOrWhitespace(c) {
      return isPrintable(c) && c !== CHAR_BOM && c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
    }
    function isPlainSafe(c, prev, inblock) {
      const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
      const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
      return (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && c !== CHAR_SHARP && !(prev === CHAR_COLON && !cIsNsChar) || isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || prev === CHAR_COLON && cIsNsChar;
    }
    function isPlainSafeFirst(c) {
      return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
    }
    function isPlainSafeLast(c) {
      return !isWhitespace(c) && c !== CHAR_COLON;
    }
    function codePointAt(string, pos) {
      const first = string.charCodeAt(pos);
      let second;
      if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
        second = string.charCodeAt(pos + 1);
        if (second >= 56320 && second <= 57343) return (first - 55296) * 1024 + second - 56320 + 65536;
      }
      return first;
    }
    function needIndentIndicator(string) {
      return /^\n* /.test(string);
    }
    var STYLE_PLAIN = 1;
    var STYLE_SINGLE = 2;
    var STYLE_LITERAL = 3;
    var STYLE_FOLDED = 4;
    var STYLE_DOUBLE = 5;
    function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
      let i;
      let char = 0;
      let prevChar = null;
      let hasLineBreak = false;
      let hasFoldableLine = false;
      const shouldTrackWidth = lineWidth !== -1;
      let previousLineBreak = -1;
      let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
      if (singleLineOnly || forceQuotes) for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) return STYLE_DOUBLE;
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      else {
        for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
          char = codePointAt(string, i);
          if (char === CHAR_LINE_FEED) {
            hasLineBreak = true;
            if (shouldTrackWidth) {
              hasFoldableLine = hasFoldableLine || i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
              previousLineBreak = i;
            }
          } else if (!isPrintable(char)) return STYLE_DOUBLE;
          plain = plain && isPlainSafe(char, prevChar, inblock);
          prevChar = char;
        }
        hasFoldableLine = hasFoldableLine || shouldTrackWidth && i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
      }
      if (!hasLineBreak && !hasFoldableLine) {
        if (plain && !forceQuotes && !testAmbiguousType(string)) return STYLE_PLAIN;
        return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
      }
      if (indentPerLevel > 9 && needIndentIndicator(string)) return STYLE_DOUBLE;
      if (!forceQuotes) return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    function writeScalar(state, string, level, iskey, inblock) {
      state.dump = (function() {
        if (string.length === 0) return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
        if (!state.noCompatMode) {
          if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
        const indent = state.indent * Math.max(1, level);
        const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
        const singleLineOnly = iskey || state.flowLevel > -1 && level >= state.flowLevel;
        function testAmbiguity(string2) {
          return testImplicitResolving(state, string2);
        }
        switch (chooseScalarStyle(string, singleLineOnly, state.indent, lineWidth, testAmbiguity, state.quotingType, state.forceQuotes && !iskey, inblock)) {
          case STYLE_PLAIN:
            return string;
          case STYLE_SINGLE:
            return "'" + string.replace(/'/g, "''") + "'";
          case STYLE_LITERAL:
            return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
          case STYLE_FOLDED:
            return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
          case STYLE_DOUBLE:
            return '"' + escapeString(string, lineWidth) + '"';
          default:
            throw new YAMLException2("impossible error: invalid scalar style");
        }
      })();
    }
    function blockHeader(string, indentPerLevel) {
      const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
      const clip = string[string.length - 1] === "\n";
      return indentIndicator + (clip && (string[string.length - 2] === "\n" || string === "\n") ? "+" : clip ? "" : "-") + "\n";
    }
    function dropEndingNewline(string) {
      return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
    }
    function foldString(string, width) {
      const lineRe = /(\n+)([^\n]*)/g;
      let result = (function() {
        let nextLF = string.indexOf("\n");
        nextLF = nextLF !== -1 ? nextLF : string.length;
        lineRe.lastIndex = nextLF;
        return foldLine(string.slice(0, nextLF), width);
      })();
      let prevMoreIndented = string[0] === "\n" || string[0] === " ";
      let moreIndented;
      let match;
      while (match = lineRe.exec(string)) {
        const prefix = match[1];
        const line = match[2];
        moreIndented = line[0] === " ";
        result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
        prevMoreIndented = moreIndented;
      }
      return result;
    }
    function foldLine(line, width) {
      if (line === "" || line[0] === " ") return line;
      const breakRe = / [^ ]/g;
      let match;
      let start = 0;
      let end;
      let curr = 0;
      let next = 0;
      let result = "";
      while (match = breakRe.exec(line)) {
        next = match.index;
        if (next - start > width) {
          end = curr > start ? curr : next;
          result += "\n" + line.slice(start, end);
          start = end + 1;
        }
        curr = next;
      }
      result += "\n";
      if (line.length - start > width && curr > start) result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
      else result += line.slice(start);
      return result.slice(1);
    }
    function escapeString(string) {
      let result = "";
      let char = 0;
      for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        const escapeSeq = ESCAPE_SEQUENCES[char];
        if (!escapeSeq && isPrintable(char)) {
          result += string[i];
          if (char >= 65536) result += string[i + 1];
        } else result += escapeSeq || encodeHex(char);
      }
      return result;
    }
    function writeFlowSequence(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) value = state.replacer.call(object, String(index), value);
        if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
          if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = "[" + _result + "]";
    }
    function writeBlockSequence(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      for (let index = 0, length = object.length; index < length; index += 1) {
        let value = object[index];
        if (state.replacer) value = state.replacer.call(object, String(index), value);
        if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
          if (!compact || _result !== "") _result += generateNextLine(state, level);
          if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) _result += "-";
          else _result += "- ";
          _result += state.dump;
        }
      }
      state.tag = _tag;
      state.dump = _result || "[]";
    }
    function writeFlowMapping(state, level, object) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (_result !== "") pairBuffer += ", ";
        if (state.condenseFlow) pairBuffer += '"';
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
        if (!writeNode(state, level, objectKey, false, false)) continue;
        if (state.dump.length > 1024) pairBuffer += "? ";
        pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
        if (!writeNode(state, level, objectValue, false, false)) continue;
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = "{" + _result + "}";
    }
    function writeBlockMapping(state, level, object, compact) {
      let _result = "";
      const _tag = state.tag;
      const objectKeyList = Object.keys(object);
      if (state.sortKeys === true) objectKeyList.sort();
      else if (typeof state.sortKeys === "function") objectKeyList.sort(state.sortKeys);
      else if (state.sortKeys) throw new YAMLException2("sortKeys must be a boolean or a function");
      for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
        let pairBuffer = "";
        if (!compact || _result !== "") pairBuffer += generateNextLine(state, level);
        const objectKey = objectKeyList[index];
        let objectValue = object[objectKey];
        if (state.replacer) objectValue = state.replacer.call(object, objectKey, objectValue);
        if (!writeNode(state, level + 1, objectKey, true, true, true)) continue;
        const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
        if (explicitPair) if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += "?";
        else pairBuffer += "? ";
        pairBuffer += state.dump;
        if (explicitPair) pairBuffer += generateNextLine(state, level);
        if (!writeNode(state, level + 1, objectValue, true, explicitPair)) continue;
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) pairBuffer += ":";
        else pairBuffer += ": ";
        pairBuffer += state.dump;
        _result += pairBuffer;
      }
      state.tag = _tag;
      state.dump = _result || "{}";
    }
    function detectType(state, object, explicit) {
      const typeList = explicit ? state.explicitTypes : state.implicitTypes;
      for (let index = 0, length = typeList.length; index < length; index += 1) {
        const type = typeList[index];
        if ((type.instanceOf || type.predicate) && (!type.instanceOf || typeof object === "object" && object instanceof type.instanceOf) && (!type.predicate || type.predicate(object))) {
          if (explicit) if (type.multi && type.representName) state.tag = type.representName(object);
          else state.tag = type.tag;
          else state.tag = "?";
          if (type.represent) {
            const style = state.styleMap[type.tag] || type.defaultStyle;
            let _result;
            if (_toString.call(type.represent) === "[object Function]") _result = type.represent(object, style);
            else if (_hasOwnProperty.call(type.represent, style)) _result = type.represent[style](object, style);
            else throw new YAMLException2("!<" + type.tag + '> tag resolver accepts not "' + style + '" style');
            state.dump = _result;
          }
          return true;
        }
      }
      return false;
    }
    function writeNode(state, level, object, block, compact, iskey, isblockseq) {
      state.tag = null;
      state.dump = object;
      if (!detectType(state, object, false)) detectType(state, object, true);
      const type = _toString.call(state.dump);
      const inblock = block;
      if (block) block = state.flowLevel < 0 || state.flowLevel > level;
      const objectOrArray = type === "[object Object]" || type === "[object Array]";
      let duplicateIndex;
      let duplicate;
      if (objectOrArray) {
        duplicateIndex = state.duplicates.indexOf(object);
        duplicate = duplicateIndex !== -1;
      }
      if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) compact = false;
      if (duplicate && state.usedDuplicates[duplicateIndex]) state.dump = "*ref_" + duplicateIndex;
      else {
        if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) state.usedDuplicates[duplicateIndex] = true;
        if (type === "[object Object]") if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
        else if (type === "[object Array]") if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) writeBlockSequence(state, level - 1, state.dump, compact);
          else writeBlockSequence(state, level, state.dump, compact);
          if (duplicate) state.dump = "&ref_" + duplicateIndex + state.dump;
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) state.dump = "&ref_" + duplicateIndex + " " + state.dump;
        }
        else if (type === "[object String]") {
          if (state.tag !== "?") writeScalar(state, state.dump, level, iskey, inblock);
        } else if (type === "[object Undefined]") return false;
        else {
          if (state.skipInvalid) return false;
          throw new YAMLException2("unacceptable kind of an object to dump " + type);
        }
        if (state.tag !== null && state.tag !== "?") {
          let tagStr = encodeURI(state.tag[0] === "!" ? state.tag.slice(1) : state.tag).replace(/!/g, "%21");
          if (state.tag[0] === "!") tagStr = "!" + tagStr;
          else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") tagStr = "!!" + tagStr.slice(18);
          else tagStr = "!<" + tagStr + ">";
          state.dump = tagStr + " " + state.dump;
        }
      }
      return true;
    }
    function getDuplicateReferences(object, state) {
      const objects = [];
      const duplicatesIndexes = [];
      inspectNode(object, objects, duplicatesIndexes);
      const length = duplicatesIndexes.length;
      for (let index = 0; index < length; index += 1) state.duplicates.push(objects[duplicatesIndexes[index]]);
      state.usedDuplicates = new Array(length);
    }
    function inspectNode(object, objects, duplicatesIndexes) {
      if (object !== null && typeof object === "object") {
        const index = objects.indexOf(object);
        if (index !== -1) {
          if (duplicatesIndexes.indexOf(index) === -1) duplicatesIndexes.push(index);
        } else {
          objects.push(object);
          if (Array.isArray(object)) for (let i = 0, length = object.length; i < length; i += 1) inspectNode(object[i], objects, duplicatesIndexes);
          else {
            const objectKeyList = Object.keys(object);
            for (let i = 0, length = objectKeyList.length; i < length; i += 1) inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
          }
        }
      }
    }
    function dump2(input, options) {
      options = options || {};
      const state = new State(options);
      if (!state.noRefs) getDuplicateReferences(input, state);
      let value = input;
      if (state.replacer) value = state.replacer.call({ "": value }, "", value);
      if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
      return "";
    }
    module.exports.dump = dump2;
  }));
  var import_js_yaml = /* @__PURE__ */ __toESM((/* @__PURE__ */ __commonJSMin(((exports, module) => {
    var loader = require_loader();
    var dumper = require_dumper();
    function renamed(from, to) {
      return function() {
        throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
      };
    }
    module.exports.Type = require_type();
    module.exports.Schema = require_schema();
    module.exports.FAILSAFE_SCHEMA = require_failsafe();
    module.exports.JSON_SCHEMA = require_json();
    module.exports.CORE_SCHEMA = require_core();
    module.exports.DEFAULT_SCHEMA = require_default();
    module.exports.load = loader.load;
    module.exports.loadAll = loader.loadAll;
    module.exports.dump = dumper.dump;
    module.exports.YAMLException = require_exception();
    module.exports.types = {
      binary: require_binary(),
      float: require_float(),
      map: require_map(),
      null: require_null(),
      pairs: require_pairs(),
      set: require_set(),
      timestamp: require_timestamp(),
      bool: require_bool(),
      int: require_int(),
      merge: require_merge(),
      omap: require_omap(),
      seq: require_seq(),
      str: require_str()
    };
    module.exports.safeLoad = renamed("safeLoad", "load");
    module.exports.safeLoadAll = renamed("safeLoadAll", "loadAll");
    module.exports.safeDump = renamed("safeDump", "dump");
  })))(), 1);
  var { Type, Schema, FAILSAFE_SCHEMA, JSON_SCHEMA, CORE_SCHEMA, DEFAULT_SCHEMA, load, loadAll, dump, YAMLException, types, safeLoad, safeLoadAll, safeDump } = import_js_yaml.default;
  var index_vite_proxy_tmp_default = import_js_yaml.default;

  // client/src/roles.mjs
  var ROLE = Object.freeze({ member: "member", moderator: "moderator", admin: "admin", superadmin: "superadmin" });
  var RANK3 = Object.freeze({ member: 0, moderator: 1, admin: 2, superadmin: 3 });

  // client/src/membership.mjs
  var STAFF = /* @__PURE__ */ new Set([ROLE.moderator, ROLE.admin, ROLE.superadmin]);
  var LOCKED_MEMBERSHIP = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  function isLockedMembership(membership) {
    return LOCKED_MEMBERSHIP.has(membership);
  }

  // client-ui/src/elements/gbti-lock-gate.mjs
  var CSS20 = `
  :host { display: block; }
  .checking { color: var(--muted); font-size: 13px; padding: 12px 0; }
  .splash { text-align: center; padding: 56px 20px; }
  .splash .lock { font-size: 34px; line-height: 1; }
  .splash h2 { margin: 12px 0 6px; font-family: var(--font-display, var(--font-body)); }
  .splash p { color: var(--muted); margin: 0 auto; max-width: 380px; font-size: 14px; line-height: 1.5; }
  .splash a.cta { display: inline-block; margin-top: 18px; background: var(--brand); color: #fff; font-weight: 700;
    text-decoration: none; padding: 10px 20px; border-radius: 10px; }
`;
  var GbtiLockGate = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._check();
    }
    async _check() {
      this.set(this.css(CSS20) + `<div class="checking">Checking your membership…</div>`);
      let membership = "unknown";
      try {
        membership = (await this.client?.status())?.membership ?? "unknown";
      } catch {
        membership = "unknown";
      }
      if (isLockedMembership(membership)) {
        this.set(this.css(CSS20) + `<div class="splash">
        <div class="lock">🔒</div>
        <h2>Your access is locked</h2>
        <p>Your GBTI membership has lapsed, so the extension is locked. Renew to rejoin the co-op, read the
           community stream, and publish again.</p>
        <a class="cta" href="https://gbti.network/membership/">Renew membership</a>
      </div>`);
        return;
      }
      this.set(this.css(CSS20) + `<slot></slot>`);
    }
  };
  define("gbti-lock-gate", GbtiLockGate);

  // client-ui/src/elements/gbti-onboarding.mjs
  var STEP_IDS = ["signin", "fork", "install"];
  var check = (filled) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${filled ? "var(--brand)" : "none"}" stroke="${filled ? "var(--brand)" : "var(--line)"}" stroke-width="2"/>${filled ? '<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : ""}</svg>`;
  var BTN_ICON = {
    signin: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
    fork: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`,
    install: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`
  };
  var CSS21 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:center; justify-content:space-between; margin-bottom:6px; }
  .head h2 { font-family:var(--font-display); font-size:16px; margin:0; text-transform:none; letter-spacing:0; color:var(--fg); }
  .count { font-size:12px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .bar { height:3px; border-radius:999px; background:var(--line); overflow:hidden; margin-bottom:14px; }
  .bar > i { display:block; height:100%; background:var(--brand); transition:width .25s ease; }
  ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:8px; }
  .row { display:flex; gap:10px; align-items:flex-start; }
  .row .ic { flex:none; margin-top:1px; }
  .row.done .t { color:var(--muted); font-size:13px; padding-top:1px; }
  .card { flex:1; min-width:0; border:1px solid var(--line); border-radius:10px; padding:12px 13px; background:var(--panel); }
  .card .title { font-family:var(--font-display); font-size:16px; font-weight:700; margin:0 0 3px; }
  .card .why { font-size:12.5px; color:var(--muted); margin:0 0 7px; line-height:1.45; }
  .card .see { font-size:12px; color:var(--fg); margin:0 0 11px; display:flex; gap:6px; align-items:flex-start; }
  .card .see svg { flex:none; margin-top:1px; opacity:.7; }
  /* Primary action. Used as BOTH a <button> (Sign in) and an <a> (Open github.com/login/device), so it must be a
     block-level flex box (an inline <a> let its green background wrap mid-text into two ragged pieces) with WHITE
     text to match the site's green CTA. */
  .btn { display:flex; align-items:center; justify-content:center; gap:6px; width:100%; box-sizing:border-box;
    border:0; border-radius:9px; background:var(--brand); color:#fff; text-decoration:none; text-align:center;
    font:inherit; font-weight:700; font-size:14px; padding:11px 14px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .btn svg { flex:none; }
  .again { display:block; margin-top:8px; text-align:right; font-size:12px; color:var(--accent); background:none; border:0; cursor:pointer; }
  .code { display:inline-flex; align-items:center; gap:8px; margin:2px 0 10px; font-family:ui-monospace,monospace; font-size:18px; font-weight:700; letter-spacing:.06em; background:var(--hover); padding:7px 11px; border-radius:8px; }
  .copy { font-family:var(--font-body); font-size:11px; font-weight:600; letter-spacing:0; border:1px solid var(--line); background:var(--panel); color:var(--accent); border-radius:6px; padding:3px 8px; cursor:pointer; }
  .copy:hover { border-color:var(--accent); }
  .note { font-size:12px; color:var(--muted); margin:8px 0 0; }
  .note.warn { color:var(--danger); }
  /* Decodes GitHub's scary-sounding "Act on your behalf" wording on the authorize screen. */
  .reassure { display:flex; gap:8px; align-items:flex-start; margin:0 0 11px; padding:9px 11px; border:1px solid var(--line); border-radius:8px; background:var(--hover); }
  .reassure svg { flex:none; margin-top:1px; color:var(--accent); }
  .reassure p { margin:0; font-size:12px; line-height:1.5; color:var(--fg); }
  .reassure b { font-weight:700; }
  .ready { text-align:center; padding:6px 0 2px; }
  .ready .big { font-family:var(--font-display); font-size:17px; font-weight:700; margin:8px 0 4px; }
  .foot { margin-top:12px; font-size:11.5px; color:var(--muted); text-align:center; }
  .foot.err { color:var(--danger); }
`;
  var GbtiOnboarding = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this._onVis = () => {
        if (!document.hidden) this.refresh();
      };
      document.addEventListener("visibilitychange", this._onVis);
      window.addEventListener("focus", this._onVis);
      this.refresh();
    }
    disconnectedCallback() {
      super.disconnectedCallback?.();
      this._stopPolling();
      document.removeEventListener("visibilitychange", this._onVis);
      window.removeEventListener("focus", this._onVis);
    }
    _startPolling() {
      if (!this._timer) this._timer = setInterval(() => {
        if (!document.hidden) this.refresh();
      }, 5e3);
    }
    _stopPolling() {
      if (this._timer) {
        clearInterval(this._timer);
        this._timer = null;
      }
    }
    /** The host (which runs the device flow) feeds the user code in so the sign-in card can show it. */
    setCode(code, url) {
      this._code = code ? { code, url } : null;
      this.render();
    }
    /** Re-probe durable GitHub state and re-render. Never advances on an error (the probe returns reachedGithub:false). */
    async refresh() {
      if (this._busy) return;
      this._busy = true;
      try {
        const s = await this.client?.onboardingStatus?.();
        if (s) {
          const becameReady = s.ready && !(this._status && this._status.ready);
          this._status = s;
          if (s.signedIn) this._code = null;
          if (s.ready) {
            this._stopPolling();
            if (becameReady) this.emit("gbti:onboarding-ready", { login: s.login });
          } else this._startPolling();
        }
      } catch {
        this._status = { ...this._status || {}, reachedGithub: false };
      } finally {
        this._busy = false;
        this.render();
      }
    }
    render() {
      const s = this._status;
      if (!s) {
        this.set(this.css(CSS21) + `<p class="note">Checking your setup...</p>`);
        return;
      }
      if (s.ready) {
        this.set(this.css(CSS21) + `<div class="ready">${check(true)}<div class="big">You are ready to publish</div>
        <p class="note">Your drafts save to your copy, and we open the review request for you.</p>
        <button class="btn" data-start style="margin-top:12px">Complete Integration</button></div>`);
        this.on("[data-start]", "click", () => this.emit("gbti:onboarding-start"));
        return;
      }
      const done = [s.signedIn, s.forkReady, s.installReady];
      const nDone = done.filter(Boolean).length;
      const active = s.activeStep || (s.signedIn ? null : "signin");
      const rows = STEP_IDS.map((id, i) => {
        const meta = s.steps?.[id] || {};
        if (done[i]) return `<li class="row done"><span class="ic">${check(true)}</span><span class="t">${esc(meta.doneLabel || meta.title || id)}</span></li>`;
        if (id !== active) return "";
        return `<li class="row"><span class="ic">${check(false)}</span>${this._card(id, meta, s)}</li>`;
      }).filter(Boolean).join("");
      const reached = s.reachedGithub !== false;
      this.set(this.css(CSS21) + `
      <div class="head"><h2>Set up publishing</h2><span class="count">${nDone} of 3</span></div>
      <div class="bar"><i style="width:${Math.round(nDone / 3 * 100)}%"></i></div>
      <ul>${rows}</ul>
      <p class="foot${reached ? "" : " err"}">${reached ? "Reached GitHub just now." : "We could not reach GitHub. Trying again."}</p>`);
      this.on("[data-again]", "click", () => this.refresh());
      this.on("[data-signin]", "click", () => this.emit("gbti:onboarding-signin"));
      const copy = this.$("[data-copy]");
      if (copy) copy.addEventListener("click", () => {
        try {
          navigator.clipboard?.writeText?.(this._code?.code || "");
          copy.textContent = "Copied";
        } catch {
        }
      });
      const open = this.$("[data-open]");
      if (open) open.addEventListener("click", () => {
        const u = open.getAttribute("data-open");
        if (u) window.open(u, "_blank", "noopener");
        setTimeout(() => this.refresh(), 1500);
      });
    }
    _card(id, meta, s) {
      const eye = `<svg viewBox="0 0 24 24" width="14" height="14"><path d="M12 5c-5 0-8.5 4.5-9 7 0.5 2.5 4 7 9 7s8.5-4.5 9-7c-.5-2.5-4-7-9-7zm0 11a4 4 0 110-8 4 4 0 010 8z" fill="currentColor"/></svg>`;
      const why = `<p class="why">${esc(meta.why || "")}</p>`;
      const see = `<p class="see">${eye}<span>${esc(meta.preview || "")}</span></p>`;
      const again = `<button class="again" data-again type="button">Check again</button>`;
      if (id === "signin") {
        const verifyUrl = this._code?.url || "https://github.com/login/device";
        const shield = `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`;
        const reassure = `<div class="reassure">${shield}<p><b>"Act on your behalf" is GitHub's standard wording for any app you connect, not full account access.</b> GBTI Network can only open pull requests and save drafts to the copy you choose. It cannot read your private code, change your account, or reach any other repository. You can remove it at any time in your GitHub settings.</p></div>`;
        const code = this._code ? `<div class="code"><span data-codeval>${esc(this._code.code)}</span><button class="copy" data-copy type="button" title="Copy the code">Copy</button></div>
           <a class="btn" href="${esc(verifyUrl)}" target="_blank" rel="noopener">${BTN_ICON.signin}<span>Open github.com/login/device</span></a>
           <p class="note">Copy the code, open the GitHub page, paste it there, and Authorize. Leave this tab open: it checks off on its own when you come back.</p>` : `<button class="btn" data-signin type="button">${BTN_ICON.signin}<span>${esc(meta.button || "Sign in with GitHub")}</span></button>`;
        return `<div class="card"><p class="title">${esc(meta.title || "Sign in with GitHub")}</p>${why}${see}${reassure}${code}${again}</div>`;
      }
      if (id === "install" && s.allReposGrant) {
        return `<div class="card"><p class="title">Switch to just your copy</p>
        <p class="why">You granted GBTI access to <b>all</b> your repositories. For your security we only want your one copy. Open the installation, choose <b>Only select repositories</b>, pick gbti.network, and save.</p>
        <button class="btn" data-open="${esc(s.links?.manage || "https://github.com/settings/installations")}" type="button">${BTN_ICON.install}<span>Fix access on GitHub</span></button>${again}
        <p class="note warn">Access to all repositories is not accepted.</p></div>`;
      }
      const link = id === "fork" ? s.links?.fork : s.links?.install;
      return `<div class="card"><p class="title">${esc(meta.title)}</p>${why}${see}
      <button class="btn" data-open="${esc(link || "")}" type="button">${BTN_ICON[id] || ""}<span>${esc(meta.button)}</span></button>${again}</div>`;
    }
  };
  define("gbti-onboarding", GbtiOnboarding);

  // client-ui/src/welcome-core.mjs
  function phaseLabel(membership) {
    switch (membership) {
      case "paid":
        return { phase: "paid", title: "You are a paid member", body: "Your profile, posts, products, and prompts publish under your name. Welcome to the co-op.", upgrade: false };
      case "trialing":
        return { phase: "trial", title: "You are in your 90-day trial", body: "Explore the community and stage drafts now. Upgrade any time to publish under your name.", upgrade: true };
      default:
        return { phase: "neutral", title: "Welcome to GBTI Network", body: "You are set up to author and publish through the co-op.", upgrade: false };
    }
  }
  function shuffle(list, rng = Math.random) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function excludeSelf(members, ownUsername) {
    const me = String(ownUsername || "").toLowerCase();
    return me ? members.filter((m) => String(m?.username || "").toLowerCase() !== me) : [...members];
  }
  function paginate(list, p, size = 10) {
    const pages = Math.max(1, Math.ceil(list.length / size));
    const page = Math.min(Math.max(1, p | 0 || 1), pages);
    const start = (page - 1) * size;
    return { page, pages, items: list.slice(start, start + size) };
  }

  // client-ui/src/discord.mjs
  var DISCORD_INVITE_URL = "https://discord.gg/gbti-network";

  // client-ui/src/topic-picker-core.mjs
  function topicsFromJson(data) {
    const list = Array.isArray(data && data.topics) ? data.topics : [];
    return list.filter((t) => t && typeof t.key === "string" && t.key).map((t) => ({ key: t.key, label: typeof t.label === "string" && t.label ? t.label : t.key }));
  }
  function toggleTopic(selection, key) {
    const cur = (Array.isArray(selection) ? selection : []).filter((k) => typeof k === "string" && k);
    if (!key || typeof key !== "string") return [...new Set(cur)];
    const set = new Set(cur);
    if (set.has(key)) {
      set.delete(key);
      return cur.filter((k) => k !== key);
    }
    return [.../* @__PURE__ */ new Set([...cur, key])];
  }
  function selectedTopics(categories) {
    return [...new Set((Array.isArray(categories) ? categories : []).filter((k) => typeof k === "string" && k))];
  }

  // client-ui/src/elements/gbti-topic-picker.mjs
  var SITE4 = "https://gbti.network";
  var CSS22 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font:inherit; font-size:13px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:7px 14px; cursor:pointer; }
  .chip:hover { color:var(--fg); border-color:var(--accent); }
  .chip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .chips.busy { opacity:.6; pointer-events:none; }
`;
  var GbtiTopicPicker = class extends GbtiElement {
    connectedCallback() {
      this._topics = null;
      this._selected = [];
      this._busy = false;
      super.connectedCallback?.();
      this._load();
    }
    async _load() {
      try {
        const r = await fetch(`${SITE4}/topics.json`, { cache: "no-cache" });
        this._topics = topicsFromJson(await r.json());
      } catch {
        this._topics = [];
      }
      if (this.client?.getPrefs) {
        try {
          const p = await this.client.getPrefs();
          this._selected = selectedTopics(p?.categories);
        } catch {
          this._selected = [];
        }
      }
      this.render();
    }
    /** The current selection (topic keys), for a host that wants to read it on a Continue/Save action. */
    get selected() {
      return [...this._selected];
    }
    render() {
      if (!this._topics) {
        this.set(this.css(CSS22) + `<p class="muted">Loading topics...</p>`);
        return;
      }
      if (!this._topics.length) {
        this.set(this.css(CSS22) + `<p class="muted">No topics available right now.</p>`);
        return;
      }
      const sel = new Set(this._selected);
      const chips = this._topics.map((t) => `<button class="chip ${sel.has(t.key) ? "on" : ""}" data-topic="${esc(t.key)}" type="button" aria-pressed="${sel.has(t.key)}">${esc(t.label)}</button>`).join("");
      this.set(this.css(CSS22) + `<div class="chips ${this._busy ? "busy" : ""}">${chips}</div>`);
      this.$$("[data-topic]").forEach((b) => b.addEventListener("click", () => this._toggle(b.dataset.topic)));
    }
    async _toggle(key) {
      const next = toggleTopic(this._selected, key);
      this._selected = next;
      this.render();
      this.dispatchEvent(new CustomEvent("topics-change", { detail: { topics: [...next] }, bubbles: true, composed: true }));
      if (this.client?.setPrefs) {
        this._busy = true;
        try {
          const p = await this.client.setPrefs({ categories: next });
          this._selected = selectedTopics(p?.categories);
        } catch {
        }
        this._busy = false;
        this.render();
      }
    }
  };
  define("gbti-topic-picker", GbtiTopicPicker);

  // client-ui/src/elements/gbti-welcome.mjs
  var SITE5 = "https://gbti.network";
  var PAGE_SIZE = 10;
  var DISCORD_DONE_KEY = "gbti-welcome-discord-joined";
  var STEPS = ["discord", "follow", "topics"];
  var lc2 = (s) => String(s || "").toLowerCase();
  var check2 = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  var discordIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.3.5c1.4.4 2 .8 2.8 1.3a11 11 0 0 0-8.9 0c.8-.5 1.5-.9 2.8-1.3L11.2 4A17 17 0 0 0 7 5.4C4.3 9.3 3.6 13.1 3.9 16.8a16 16 0 0 0 4.8 2.4l.6-1c-.5-.2-1-.5-1.6-.9l.4-.3a11 11 0 0 0 9.6 0l.4.3c-.5.4-1 .7-1.6.9l.6 1a16 16 0 0 0 4.8-2.4c.4-4.3-.6-8-2.6-11.4zM9.6 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>`;
  var githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;
  var megaIco = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="margin-right:6px"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V6.5L6 10H4a1 1 0 0 0-1 1zM14 8v8c1.7-.6 3-2.4 3-4s-1.3-3.4-3-4z" fill="currentColor"/></svg>`;
  var CSS23 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); padding:32px 28px; max-width:680px; margin:0 auto; }
  .head { text-align:center; margin-bottom:22px; }
  .head .ic { display:inline-grid; place-items:center; }
  .phase { display:inline-block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
    color:var(--accent); background:var(--hover); border-radius:999px; padding:3px 11px; margin:10px 0 0; }
  .head h2 { font-family:var(--font-display); font-size:24px; margin:8px 0 6px; }
  .head p { color:var(--muted); margin:0 auto; max-width:46ch; line-height:1.5; }
  .up { display:inline-block; margin-top:10px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; background:var(--panel); }
  .card h3 { font-family:var(--font-display); font-size:16px; margin:0 0 4px; display:flex; align-items:center; gap:8px; }
  .card .sub { color:var(--muted); font-size:13px; margin:0 0 13px; line-height:1.5; }
  .btn { display:inline-flex; align-items:center; justify-content:center; gap:6px; border:0; border-radius:9px;
    background:var(--brand); color:#fff; text-decoration:none; font:inherit; font-weight:700; font-size:14px; padding:10px 16px; cursor:pointer; }
  .btn:hover { background:var(--brand-dark); color:#fff; }
  .check { display:flex; align-items:center; gap:9px; margin-top:12px; font-size:13.5px; color:var(--fg); cursor:pointer; user-select:none; }
  .check input { width:17px; height:17px; accent-color:var(--brand); cursor:pointer; }
  ul.members { list-style:none; margin:6px 0 0; padding:0; }
  .m { display:flex; align-items:center; gap:12px; padding:9px 0; border-top:1px solid var(--line); }
  .av { flex:none; width:38px; height:38px; border-radius:50%; background:var(--hover); color:var(--muted);
    display:grid; place-items:center; font-weight:700; overflow:hidden; position:relative; }
  .av img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .mi { flex:1; min-width:0; } .mi b { display:block; font-size:14px; }
  .mi span { display:block; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fbtn { flex:none; border:1.5px solid var(--brand); background:var(--brand); color:#fff; border-radius:8px;
    font:inherit; font-weight:700; font-size:13px; padding:6px 13px; cursor:pointer; }
  .fbtn:hover { background:var(--brand-dark); border-color:var(--brand-dark); }
  .fbtn.on { background:transparent; color:var(--accent); }
  /* "Following" hover: a soft on-brand green fill (inviting), not an alarming red unfollow signal. */
  .fbtn.on:hover { background:var(--hover); border-color:var(--brand-dark); color:var(--brand-dark); }
  .pager { display:flex; align-items:center; justify-content:space-between; margin-top:13px; }
  .pager button { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-size:13px; padding:6px 12px; cursor:pointer; }
  .pager button[disabled] { opacity:.4; cursor:default; }
  .pager .pg { font-size:12.5px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .note { color:var(--muted); font-size:12.5px; line-height:1.5; margin:0; }
  .note a { color:var(--accent); }
  .done { width:100%; box-sizing:border-box; margin-top:6px; padding:12px; }
  .loading { color:var(--muted); text-align:center; padding:30px 0; }
  /* SOW-041 stepper: a step indicator + a bottom nav bar (Back / Continue / I am all set). */
  .stepind { display:block; text-align:center; font-size:12px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); margin:0 0 14px; }
  .stepnav { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-top:6px; }
  .stepnav .grow { flex:1; }
  .btn.ghost { background:transparent; color:var(--fg-soft); border:1.5px solid var(--line); }
  .btn.ghost:hover { background:var(--hover); color:var(--fg); border-color:var(--line-2); }
  /* SOW-048: the forced-sign-in (login splash) mode. */
  .btn.signin { width:100%; box-sizing:border-box; padding:13px; font-size:15px; }
  .codebox { text-align:center; }
  .codebox .sub { color:var(--muted); font-size:13.5px; margin:0 0 8px; }
  .codeval { display:flex; align-items:center; justify-content:center; gap:10px; margin:8px 0 14px; flex-wrap:wrap; }
  .codeval code { font-family:var(--font-mono, monospace); font-size:22px; font-weight:700; letter-spacing:.14em; background:var(--hover); border:1px solid var(--line); border-radius:8px; padding:8px 14px; }
  .codeval .btn { padding:8px 13px; font-size:13px; }
`;
  var GbtiWelcome = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this._page = 1;
      this._step = 0;
      this.load();
    }
    async load() {
      this._authGate = this.hasAttribute("auth-gate");
      let s = null;
      try {
        s = await this.client?.status?.();
        this._membership = s?.membership ?? "unknown";
        this._own = lc2(s?.identity?.username || s?.identity?.login);
      } catch {
        this._membership = "unknown";
        this._own = "";
      }
      this._authenticated = Boolean(s?.authenticated && (s?.identity?.login || s?.identity?.username));
      if (this._authGate && !this._authenticated) {
        this._loaded = true;
        this.render();
        return;
      }
      try {
        const res = await fetch(`${SITE5}/members-index.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        this._members = excludeSelf(shuffle(Array.isArray(data?.members) ? data.members : []), this._own);
      } catch {
        this._members = null;
      }
      try {
        const r = await this.client?.getFollows?.();
        const list = Array.isArray(r) ? r : r?.following ?? [];
        this._follows = new Set(list.map((e) => lc2(e?.username)).filter(Boolean));
      } catch {
        this._follows = null;
      }
      try {
        this._discordJoined = localStorage.getItem(DISCORD_DONE_KEY) === "1";
      } catch {
        this._discordJoined = false;
      }
      this._discordInviteUrl = DISCORD_INVITE_URL;
      try {
        const inv = await this.client?.discordInvite?.();
        if (inv?.url) this._discordInviteUrl = inv.url;
      } catch {
      }
      this._loaded = true;
      this.render();
    }
    // SOW-048: feed the device-flow user code into the splash (host calls this from the gbti:welcome-signin handler).
    setCode(userCode, verificationUri) {
      this._code = userCode || null;
      if (verificationUri) this._verifyUri = verificationUri;
      this.render();
    }
    // SOW-048: the login splash (signed-out, auth-gate mode). Sign in with GitHub via the device flow; once the host
    // hands back a user code we show it + the github.com/login/device link. Authentication, not payment — a new
    // visitor with a GitHub account can sign in and lands in the normal (membership-gated) app afterward.
    _renderSignedOut() {
      const code = this._code;
      const verify = this._verifyUri || "https://github.com/login/device";
      const action = code ? `<div class="codebox">
           <p class="sub">Enter this code at GitHub to finish signing in:</p>
           <div class="codeval"><code>${esc(code)}</code><button class="btn ghost" data-copy type="button">Copy</button></div>
           <a class="btn" href="${esc(verify)}" target="_blank" rel="noopener">Open github.com/login/device</a>
           <p class="note" style="margin-top:12px">Waiting for you to authorize&hellip;</p>
         </div>` : `<button class="btn signin" data-auth-signin type="button">${githubIco} Sign in with GitHub</button>`;
      const expired = this.hasAttribute("expired") ? `<p class="note" style="margin:0 0 12px; color:var(--accent)">Your session expired. Please sign in again to pick up where you left off.</p>` : "";
      this.set(this.css(CSS23) + `
      <div class="head">
        <span class="ic">${check2}</span>
        <h2>Sign in to GBTI Network</h2>
        <p>The developer co-op. Sign in with your GitHub account to publish articles, products, and prompts, follow members, read the members-only news, and join the community.</p>
      </div>
      <div class="card">
        ${expired}${action}
        <p class="note" style="margin-top:14px">New here? <a href="${SITE5}/membership/" target="_blank" rel="noopener">Become a member</a> &mdash; the trial is free.</p>
      </div>`);
      this.on("[data-auth-signin]", "click", () => this.emit("gbti:welcome-signin"));
      this.on("[data-copy]", "click", () => {
        try {
          navigator.clipboard?.writeText(code);
        } catch {
        }
      });
    }
    render() {
      if (!this._loaded) {
        this.set(this.css(CSS23) + `<p class="loading">Setting up your welcome...</p>`);
        return;
      }
      if (this._authGate && !this._authenticated) {
        this._renderSignedOut();
        return;
      }
      const ph = phaseLabel(this._membership);
      const up = ph.upgrade ? `<a class="up" href="${SITE5}/membership/" target="_blank" rel="noopener">Upgrade to publish</a>` : "";
      if (this._step < 0) this._step = 0;
      if (this._step > STEPS.length - 1) this._step = STEPS.length - 1;
      const step = STEPS[this._step];
      const card = step === "discord" ? this._discordCard() : step === "topics" ? this._topicsCard() : this._followCard();
      const isLast = this._step >= STEPS.length - 1;
      const nav = `<div class="stepnav">
      ${this._step > 0 ? `<button class="btn ghost" data-step-back type="button">&larr; Back</button>` : '<span class="grow"></span>'}
      ${isLast ? `<button class="btn done" data-done type="button">I am all set</button>` : `<button class="btn" data-step-next type="button">Continue &rarr;</button>`}
    </div>`;
      this.set(this.css(CSS23) + `
      <div class="head">
        <span class="ic">${check2}</span>
        <div class="phase">${esc(ph.phase === "paid" ? "Paid membership" : ph.phase === "trial" ? "Trial phase" : "Welcome")}</div>
        <h2>${esc(ph.title)}</h2>
        <p>${esc(ph.body)}</p>
        ${up}
      </div>
      <span class="stepind">Step ${this._step + 1} of ${STEPS.length}</span>
      ${card}
      ${nav}`);
      this.on("[data-step-next]", "click", () => {
        this._step++;
        this.render();
      });
      this.on("[data-step-back]", "click", () => {
        this._step--;
        this.render();
      });
      this.on("[data-done]", "click", () => this.emit("gbti:welcome-done"));
      if (step === "discord") {
        this.on("[data-discord-join]", "click", () => window.open(this._discordInviteUrl || DISCORD_INVITE_URL, "_blank", "noopener"));
        const cb = this.$("[data-discord-cb]");
        if (cb) cb.addEventListener("change", () => {
          this._discordJoined = cb.checked;
          try {
            cb.checked ? localStorage.setItem(DISCORD_DONE_KEY, "1") : localStorage.removeItem(DISCORD_DONE_KEY);
          } catch {
          }
        });
      } else {
        this.$$("[data-follow]").forEach((b) => b.addEventListener("click", () => this._toggleFollow(b.getAttribute("data-follow"))));
        this.on("[data-prev]", "click", () => {
          this._page--;
          this.render();
        });
        this.on("[data-next]", "click", () => {
          this._page++;
          this.render();
        });
        this.$$(".av img").forEach((img) => img.addEventListener("error", () => img.remove(), { once: true }));
      }
    }
    _discordCard() {
      const done = this._discordJoined ? "checked" : "";
      return `<div class="card">
      <h3>${discordIco} Join our Discord</h3>
      <p class="sub">The community is the heart of the co-op: weekly sessions, help, and the people you build with. If you have not joined yet, hop in.</p>
      <button class="btn" data-discord-join type="button">${discordIco} Join the Discord</button>
      <label class="check"><input type="checkbox" data-discord-cb ${done} /> I have joined the Discord</label>
    </div>`;
    }
    // SOW-054: the Topics step. The shared <gbti-topic-picker> fetches the vocabulary + the member's current
    // selection and self-persists each toggle via setPrefs; the step is skippable (an empty selection = the feed and
    // news show everything, the current default).
    _topicsCard() {
      return `<div class="card">
      <h3>${megaIco} Follow topics</h3>
      <p class="sub">Pick the topics you care about. Your activity feed and news default to them, and you can change this any time in Settings. Skip to see everything.</p>
      <gbti-topic-picker></gbti-topic-picker>
    </div>`;
    }
    _followCard() {
      const note = `<p class="note">Following a member alerts you when they publish new articles, prompts, and products (in your Following feed).</p>`;
      if (this._follows === null) {
        return `<div class="card"><h3>${megaIco} Follow members</h3>
        <p class="sub">We could not load your follow list right now. This is a temporary problem on our side.</p>${note}
        <p class="note" style="margin-top:10px">Try again shortly, or follow members any time from a member profile.</p></div>`;
      }
      if (!this._members) {
        return `<div class="card"><h3>${megaIco} Follow members</h3>
        <p class="sub">We could not load the member directory right now. You can follow members any time from a member profile.</p>${note}</div>`;
      }
      if (this._members.length === 0) {
        return `<div class="card"><h3>${megaIco} Follow members</h3>
        <p class="sub">No members to show yet. Check back as the co-op grows.</p>${note}</div>`;
      }
      const { page, pages, items } = paginate(this._members, this._page, PAGE_SIZE);
      this._page = page;
      const rows = items.map((m) => this._row(m)).join("");
      const pager = pages > 1 ? `<div class="pager"><button data-prev type="button" ${page <= 1 ? "disabled" : ""}>Back</button>
         <span class="pg">Page ${page} of ${pages}</span>
         <button data-next type="button" ${page >= pages ? "disabled" : ""}>More</button></div>` : "";
      return `<div class="card"><h3>${megaIco} Follow members</h3>${note}<ul class="members">${rows}</ul>${pager}</div>`;
    }
    _row(m) {
      const u = lc2(m.username);
      const followed = this._follows.has(u);
      const initial = esc((m.displayName || m.username || "?").trim().charAt(0).toUpperCase());
      const av = m.avatar ? `<span class="ini">${initial}</span><img src="${esc(m.avatar)}" alt="" />` : `<span class="ini">${initial}</span>`;
      const sub = m.headline ? `<span>${esc(m.headline)}</span>` : "";
      return `<li class="m">
      <span class="av">${av}</span>
      <span class="mi"><b>${esc(m.displayName || m.username)}</b>${sub}</span>
      <button class="fbtn ${followed ? "on" : ""}" data-follow="${esc(u)}" type="button">${followed ? "Following" : "Follow"}</button>
    </li>`;
    }
    async _toggleFollow(username) {
      const u = lc2(username);
      if (!u || !this._follows) return;
      const was = this._follows.has(u);
      was ? this._follows.delete(u) : this._follows.add(u);
      this.render();
      try {
        const r = await this.client.setFollow({ username: u, on: !was });
        const list = Array.isArray(r) ? r : r?.following ?? null;
        if (list) this._follows = new Set(list.map((e) => lc2(e?.username)).filter(Boolean));
      } catch {
        was ? this._follows.add(u) : this._follows.delete(u);
      }
      this.render();
    }
  };
  define("gbti-welcome", GbtiWelcome);

  // client-ui/src/workspace-core.mjs
  var WORKSPACE_TABS = /* @__PURE__ */ new Set(["overview", "post", "prompt", "product", "prs", "inbox", "saved", "subs", "earnings"]);
  function parseWorkspaceTab(hash) {
    const m = String(hash || "").replace(/^#/, "").match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
    return m && WORKSPACE_TABS.has(m[1]) ? m[1] : null;
  }
  var WORKSPACE_NEW_TYPES = /* @__PURE__ */ new Set(["post", "prompt", "product"]);
  function parseWorkspaceNew(hash) {
    const m = String(hash || "").replace(/^#/, "").match(/(?:^|&)new=([a-z]+)(?:&|$)/);
    return m && WORKSPACE_NEW_TYPES.has(m[1]) ? m[1] : null;
  }
  function classifyPull(pr = {}, status2 = null) {
    if (pr.merged === true || pr.state === "merged") return { label: "Accepted", tone: "ok" };
    if (pr.state === "closed") return { label: "Declined", tone: "muted" };
    switch (status2?.state) {
      case "success":
        return { label: "Proposed", tone: "ok" };
      // mergeable / auto-merging
      case "failure":
        return { label: "Needs changes", tone: "bad" };
      // held / rejected-not-paid / changes requested
      case "error":
        return { label: "Error", tone: "bad" };
      default:
        return { label: "Proposed", tone: "" };
    }
  }

  // client-ui/src/workbench-cache.mjs
  var WB_CACHE_PREFIX = "gbti:wb";
  var WB_DEFAULT_TTL_MS = 10 * 60 * 1e3;
  var mem = /* @__PURE__ */ new Map();
  function store() {
    try {
      const s = globalThis.chrome?.storage?.local;
      return s && typeof s.get === "function" && typeof s.set === "function" ? s : null;
    } catch {
      return null;
    }
  }
  function wbKey(memberKey, type) {
    return `${WB_CACHE_PREFIX}:${memberKey}:${type}`;
  }
  async function rawGet(key) {
    const s = store();
    if (s) {
      try {
        const r = await s.get(key);
        return r?.[key] ?? null;
      } catch {
        return null;
      }
    }
    return mem.has(key) ? mem.get(key) : null;
  }
  async function rawSet(key, value) {
    const s = store();
    if (s) {
      try {
        await s.set({ [key]: value });
      } catch {
      }
      return;
    }
    mem.set(key, value);
  }
  async function rawDel(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const s = store();
    if (s) {
      try {
        await s.remove(list);
      } catch {
      }
      return;
    }
    for (const k of list) mem.delete(k);
  }
  async function wbCacheGet(memberKey, type, { ttl = WB_DEFAULT_TTL_MS, now = Date.now } = {}) {
    if (!memberKey || !type) return null;
    const v = await rawGet(wbKey(memberKey, type));
    if (!v || !Array.isArray(v.items)) return null;
    const at = Number(v.at) || 0;
    return { items: v.items, at, fresh: now() - at < ttl };
  }
  async function wbCacheSet(memberKey, type, items, { now = Date.now, allowEmpty = false } = {}) {
    if (!memberKey || !type || !Array.isArray(items)) return;
    if (!items.length && !allowEmpty) return;
    await rawSet(wbKey(memberKey, type), { at: now(), items });
  }
  async function wbCacheInvalidateMany(memberKey, types2 = []) {
    if (!memberKey || !Array.isArray(types2) || !types2.length) return;
    await rawDel(types2.map((t) => wbKey(memberKey, t)));
  }

  // client-ui/src/elements/gbti-saved.mjs
  var SITE6 = "https://gbti.network";
  var CSS24 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { margin:0 0 26px; }
  .sec h3 { font-size:15px; margin:0 0 12px; }
  .grp { margin:0 0 14px; }
  .grp h4 { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); margin:0 0 6px; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--fg); text-decoration:none; font-weight:600; font-size:14px; }
  a.t:hover { color:var(--accent); }
  .badge { flex:none; font-size:11px; color:var(--muted); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .lk { flex:none; background:none; border:0; font:inherit; font-size:13px; font-weight:600; color:var(--accent); cursor:pointer; padding:4px 6px; border-radius:6px; }
  .lk:hover { background:var(--hover); }
  .lk.danger { color:var(--danger); }
  .coll { border:1px solid var(--line); border-radius:12px; padding:12px 14px; margin:0 0 12px; }
  .coll-h { display:flex; align-items:center; gap:10px; margin:0 0 6px; }
  .coll-nm { font-size:14.5px; }
  .coll-ct { font-size:12px; color:var(--muted); }
  .coll-act { margin-left:auto; display:flex; gap:2px; }
  .empty { color:var(--muted); font-size:13px; padding:6px 2px; list-style:none; }
  .muted { color:var(--muted); font-size:14px; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 16px; }
  .chip { font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; cursor:pointer; }
  .chip:hover { color:var(--fg); border-color:var(--accent); }
  .chip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .chip .n { opacity:.7; font-variant-numeric:tabular-nums; }
  .newc { display:flex; gap:8px; margin-top:10px; }
  .newc input { flex:1; min-width:0; font:inherit; font-size:13.5px; padding:8px 10px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); }
  .btn { flex:none; font:inherit; font-weight:600; font-size:13px; padding:8px 14px; border:0; border-radius:8px; background:var(--accent); color:#fff; cursor:pointer; }
  .busy { opacity:.6; pointer-events:none; }
`;
  var GbtiSaved = class extends GbtiElement {
    connectedCallback() {
      this._activity = null;
      this._index = null;
      this._busy = false;
      this._filter = "all";
      super.connectedCallback?.();
      this._load();
    }
    async _load() {
      if (!this.client) {
        this.render();
        return;
      }
      await this._reloadActivity(false);
      try {
        const perType = {};
        await Promise.all(SAVED_TYPES.map(async (t) => {
          const file = indexFileFor(t);
          if (!file) return;
          const res = await fetch(`${SITE6}/${file}`, { cache: "no-cache" });
          perType[t] = res.ok ? (await res.json()).items || [] : [];
        }));
        this._index = buildItemIndex(perType);
      } catch {
        this._index = buildItemIndex({});
      }
      this.render();
    }
    async _reloadActivity(rerender = true) {
      try {
        const a = await this.client.getActivity();
        this._activity = { favorites: a?.favorites || [], collections: a?.collections || [] };
      } catch (err) {
        this._activity = { favorites: [], collections: [], error: err?.code || "error" };
      }
      if (rerender) this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS24) + `<p class="muted">Sign in with the GBTI client to manage your saved items.</p>`);
        return;
      }
      if (!this._activity) {
        this.set(this.css(CSS24) + `<p class="muted">Loading your saved items...</p>`);
        return;
      }
      if (this._activity.error === "not-authenticated") {
        this.set(this.css(CSS24) + `<p class="muted">Sign in to manage favorites and collections.</p>`);
        return;
      }
      const idx = this._index || buildItemIndex({});
      const chips = savedTypeChips(this._activity);
      if (!chips.some((c) => c.type === this._filter)) this._filter = "all";
      const chipsHtml = chips.length > 1 ? `<div class="chips">${chips.map((c) => `<button class="chip ${c.type === this._filter ? "on" : ""}" type="button" data-chip="${esc(c.type)}">${esc(c.label)} <span class="n">${c.count}</span></button>`).join("")}</div>` : "";
      const view = filterSavedByType(this._activity, this._filter);
      const favGroups = groupFavoritesByType(view.favorites);
      const favHtml = favGroups.length ? favGroups.map((g) => `<div class="grp"><h4>${esc(typeLabel(g.type))}</h4><ul class="rows">${g.items.map((f) => this._itemRow(resolveItem(idx, f.type, f.slug), { fav: true })).join("")}</ul></div>`).join("") : `<p class="muted">No favorites yet. Tap the heart on any article, product, prompt, or Share to save it here.</p>`;
      const colls = view.collections;
      const collHtml = colls.length ? colls.map((c) => `<div class="coll">
          <div class="coll-h"><b class="coll-nm">${esc(c.name)}</b><span class="coll-ct">${(c.items || []).length} item${(c.items || []).length === 1 ? "" : "s"}</span>
            <span class="coll-act"><button class="lk" data-rename data-cid="${esc(c.id)}" type="button">Rename</button><button class="lk danger" data-del data-cid="${esc(c.id)}" type="button">Delete</button></span></div>
          <ul class="rows">${(c.items || []).length ? (c.items || []).map((it) => this._itemRow(resolveItem(idx, it.type, it.slug), { cid: c.id })).join("") : '<li class="empty">Empty collection.</li>'}</ul>
        </div>`).join("") : `<p class="muted">No collections yet. Use "Save to a collection" on any item to start one.</p>`;
      this.set(this.css(CSS24) + `<div class="${this._busy ? "busy" : ""}">
      ${chipsHtml}
      <section class="sec"><h3>Favorites</h3>${favHtml}</section>
      <section class="sec"><h3>Collections</h3>${collHtml}
        <div class="newc"><input type="text" placeholder="New collection name" maxlength="80" data-newc /><button class="btn" data-newc-go type="button">Create</button></div>
      </section></div>`);
      this._wire();
    }
    _itemRow(item, { fav, cid } = {}) {
      const title = esc(item.title);
      const t = item.url ? `<a class="t" href="${SITE6}${esc(item.url)}" target="_blank" rel="noopener">${title}</a>` : `<span class="t">${title}</span>`;
      const rm = fav ? `<button class="lk danger" data-unfav data-type="${esc(item.type)}" data-slug="${esc(item.slug)}" type="button">Remove</button>` : `<button class="lk danger" data-rmitem data-cid="${esc(cid)}" data-type="${esc(item.type)}" data-slug="${esc(item.slug)}" type="button">Remove</button>`;
      return `<li class="row"><span class="badge">${esc(typeLabel(item.type))}</span>${t}${rm}</li>`;
    }
    _wire() {
      this.$$("[data-chip]").forEach((b) => b.addEventListener("click", () => {
        this._filter = b.dataset.chip;
        this.render();
      }));
      this.$$("[data-unfav]").forEach((b) => b.addEventListener("click", () => this._run(() => this.client.toggleFavorite({ targetType: b.dataset.type, targetSlug: b.dataset.slug, on: false }))));
      this.$$("[data-rmitem]").forEach((b) => b.addEventListener("click", () => this._run(() => this.client.addToCollection({ id: b.dataset.cid, targetType: b.dataset.type, targetSlug: b.dataset.slug, on: false }))));
      this.$$("[data-rename]").forEach((b) => b.addEventListener("click", () => {
        const name = (typeof prompt === "function" ? prompt("Rename collection") : "") || "";
        if (name.trim()) this._run(() => this.client.renameCollection({ id: b.dataset.cid, name: name.trim() }));
      }));
      this.$$("[data-del]").forEach((b) => b.addEventListener("click", () => {
        if (typeof confirm !== "function" || confirm("Delete this collection? The saved items stay; only the list is removed.")) {
          this._run(() => this.client.deleteCollection({ id: b.dataset.cid }));
        }
      }));
      const input = this.$("[data-newc]");
      const create = () => {
        const n = (input?.value || "").trim();
        if (n) this._run(() => this.client.createCollection({ name: n }));
      };
      this.on("[data-newc-go]", "click", create);
      if (input) input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") create();
      });
    }
    // Run a mutation, then refetch the activity (the edge store is the source of truth). Fail-soft.
    async _run(fn) {
      this._busy = true;
      this.render();
      try {
        await fn();
      } catch (err) {
      }
      this._busy = false;
      await this._reloadActivity();
    }
  };
  define("gbti-saved", GbtiSaved);

  // client-ui/src/elements/gbti-subscriptions.mjs
  var SITE7 = "https://gbti.network";
  var MEMBERSHIP = { paid: "Paid member", trial: "Trial", trialing: "Trial" };
  var lc3 = (s) => String(s || "").toLowerCase();
  var followList = (r) => Array.isArray(r) ? r : r?.following ?? [];
  var CSS25 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { margin:0 0 26px; }
  .sec h3 { font-size:15px; margin:0 0 12px; }
  .card { display:flex; align-items:center; gap:12px; border:1px solid var(--line); border-radius:12px; padding:14px 16px; }
  .card .who { flex:1; min-width:0; }
  .card .who b { display:block; font-size:14.5px; }
  .card .who span { font-size:13px; color:var(--muted); }
  .tag { flex:none; font-size:12px; font-weight:700; border-radius:999px; padding:3px 11px; background:var(--hover); color:var(--muted); }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .btn { flex:none; font:inherit; font-weight:600; font-size:13px; padding:8px 14px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; text-decoration:none; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .subtabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:8px; padding:4px; margin:0 0 14px; }
  .subtab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 14px; border-radius:6px; cursor:pointer; }
  .subtab.on { background:var(--hover); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; gap:11px; padding:9px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .av { width:30px; height:30px; border-radius:50%; flex:none; object-fit:cover; background:var(--hover); }
  .ico { width:30px; height:30px; border-radius:8px; flex:none; display:flex; align-items:center; justify-content:center; background:var(--hover); color:var(--muted); font-weight:800; font-size:13px; }
  .row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:600; font-size:14px; color:var(--fg); text-decoration:none; }
  .row .nm .d { display:block; font-weight:500; font-size:12px; color:var(--muted); }
  a.nm:hover { color:var(--accent); }
  .lk { flex:none; background:none; border:0; font:inherit; font-size:13px; font-weight:600; color:var(--danger); cursor:pointer; padding:4px 6px; border-radius:6px; }
  .lk:hover { background:var(--hover); }
  .muted { color:var(--muted); font-size:14px; }
  .find { margin-top:12px; }
  .find a { color:var(--accent); font-weight:600; font-size:13.5px; text-decoration:none; }
  .busy { opacity:.6; pointer-events:none; }
`;
  var GbtiSubscriptions = class extends GbtiElement {
    connectedCallback() {
      this._membership = null;
      this._view = "members";
      this._follows = null;
      this._channels = null;
      this._channelsError = false;
      this._busy = false;
      super.connectedCallback?.();
      this._load();
    }
    async _load() {
      if (!this.client) {
        this.render();
        return;
      }
      try {
        this._membership = (await this.client.status())?.membership ?? "unknown";
      } catch {
        this._membership = "unknown";
      }
      await this._reloadFollows(false);
      this.render();
    }
    async _reloadFollows(rerender = true) {
      try {
        this._follows = followList(await this.client.getFollows()).filter((f) => f && f.username);
      } catch {
        this._follows = null;
      }
      if (rerender) this.render();
    }
    // SOW-046: the news channels the member follows = the sources whose id is in prefs.followedChannels.
    async _reloadChannels(rerender = true) {
      try {
        if (!this.client.getNewsSources || !this.client.getPrefs) {
          this._channels = [];
          return;
        }
        const [src, prefs] = await Promise.all([this.client.getNewsSources(), this.client.getPrefs()]);
        const sources = src?.sources || [];
        const followed = new Set((prefs?.followedChannels || []).map(lc3));
        this._channels = sources.filter((s) => followed.has(lc3(s.id))).map((s) => ({
          id: s.id,
          name: s.name || s.id,
          meta: s.category || s.description || ""
        }));
        this._channelsError = false;
      } catch {
        this._channels = null;
        this._channelsError = true;
      }
      if (rerender) this.render();
    }
    _setView(v) {
      if (this._view === v) return;
      this._view = v;
      if (v === "channels" && this._channels === null && !this._channelsError) {
        this._reloadChannels(true);
        return;
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS25) + `<p class="muted">Sign in with the GBTI client to manage who you follow.</p>`);
        return;
      }
      if (this._membership === null) {
        this.set(this.css(CSS25) + `<p class="muted">Loading your follows...</p>`);
        return;
      }
      const m = this._membership;
      const label = MEMBERSHIP[m] || (m === "unknown" ? "Not signed in" : "Inactive");
      const card = `<div class="card">
      <div class="who"><b>Your membership</b><span>GBTI Network</span></div>
      <span class="tag ${m === "paid" ? "ok" : ""}">${esc(label)}</span>
      <a class="btn" href="${SITE7}/membership/" target="_blank" rel="noopener">Manage</a>
    </div>`;
      const subtabs = `<div class="subtabs">
      <button class="subtab ${this._view === "members" ? "on" : ""}" data-view="members" type="button">Network members</button>
      <button class="subtab ${this._view === "channels" ? "on" : ""}" data-view="channels" type="button">News channels</button>
    </div>`;
      const body = this._view === "channels" ? this._channelsHtml() : this._membersHtml();
      this.set(this.css(CSS25) + `<div class="${this._busy ? "busy" : ""}">
      <section class="sec"><h3>Membership</h3>${card}</section>
      <section class="sec"><h3>Following</h3>${subtabs}${body}</section>
    </div>`);
      this.$$("[data-view]").forEach((b) => b.addEventListener("click", () => this._setView(b.dataset.view)));
      this.$$("[data-avfor]").forEach((img) => img.addEventListener("error", () => {
        img.style.visibility = "hidden";
      }, { once: true }));
      this.$$("[data-unfollow]").forEach((b) => b.addEventListener("click", () => this._unfollow(b.dataset.unfollow)));
      this.$$("[data-unfollowchan]").forEach((b) => b.addEventListener("click", () => this._unfollowChannel(b.dataset.unfollowchan)));
    }
    _membersHtml() {
      if (this._follows === null) {
        return `<p class="muted">We could not load your follows right now. You can follow members any time from a member profile.</p><div class="find"><a href="${SITE7}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
      }
      if (!this._follows.length) {
        return `<p class="muted">You are not following any members yet.</p><div class="find"><a href="${SITE7}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
      }
      const rows = this._follows.map((f) => {
        const u = esc(f.username);
        return `<li class="row">
        <img class="av" src="https://github.com/${encodeURIComponent(f.username)}.png?size=60" alt="" loading="lazy" data-avfor="${u}" />
        <a class="nm" href="${SITE7}/members/${u}/" target="_blank" rel="noopener">@${u}</a>
        <button class="lk" data-unfollow="${u}" type="button">Unfollow</button>
      </li>`;
      }).join("");
      return `<ul class="rows">${rows}</ul><div class="find"><a href="${SITE7}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
    }
    _channelsHtml() {
      if (this._channels === null && this._channelsError) {
        return `<p class="muted">Could not load your news channels right now.</p>`;
      }
      if (this._channels === null) {
        return `<p class="muted">Loading news channels...</p>`;
      }
      if (!this._channels.length) {
        return `<p class="muted">You are not following any news channels yet. Open <b>News &rarr; Channels</b> to follow sources, and they show up here.</p>`;
      }
      const rows = this._channels.map((c) => {
        const id = esc(c.id);
        const ini = esc((c.name || "?").trim().charAt(0).toUpperCase() || "#");
        const meta = c.meta ? `<span class="d">${esc(c.meta)}</span>` : "";
        return `<li class="row">
        <span class="ico">${ini}</span>
        <span class="nm">${esc(c.name)}${meta}</span>
        <button class="lk" data-unfollowchan="${id}" type="button">Unfollow</button>
      </li>`;
      }).join("");
      return `<ul class="rows">${rows}</ul>`;
    }
    async _unfollow(username) {
      this._busy = true;
      this.render();
      try {
        this._follows = followList(await this.client.setFollow({ username, on: false })).filter((f) => f && f.username);
      } catch {
        await this._reloadFollows(false);
      }
      this._busy = false;
      this.render();
    }
    async _unfollowChannel(id) {
      this._busy = true;
      this.render();
      try {
        const prefs = await this.client.setPrefs({ followChannel: { id, on: false } });
        const followed = new Set((prefs?.followedChannels || []).map(lc3));
        this._channels = (this._channels || []).filter((c) => followed.has(lc3(c.id)));
      } catch {
        await this._reloadChannels(false);
      }
      this._busy = false;
      this.render();
    }
  };
  define("gbti-subscriptions", GbtiSubscriptions);

  // client-ui/src/elements/gbti-workspace.mjs
  var WB_CONTENT_TYPES = /* @__PURE__ */ new Set(["post", "prompt", "product"]);
  var TABS = [
    { id: "overview", label: "Overview" },
    // SOW-052: the WorkBench hub (tiles + counts + PRs needing attention)
    { id: "post", label: "Articles", type: "post" },
    { id: "prompt", label: "Prompts", type: "prompt" },
    { id: "product", label: "Products", type: "product" },
    { id: "prs", label: "Pull requests" },
    { id: "inbox", label: "Inbox" },
    { id: "saved", label: "Saved" },
    // SOW-037: favorites + collections
    { id: "subs", label: "Following" },
    // SOW-037: follows + membership (network members + news channels)
    { id: "earnings", label: "Earnings" }
    // SOW-052: placeholder for referrals + rewards (SOW-007/008)
  ];
  var MEMBERSHIP_LABEL = { paid: "Paid member", trial: "Trial", trialing: "Trial", expired: "Expired", cancelled: "Cancelled", none: "Not a member", banned: "Suspended", unknown: "Not signed in" };
  var CSS26 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:2px; padding:4px; margin:0 0 16px; flex-wrap:wrap; } /* SOW-052 squared aesthetic: 2px nav bar */
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:2px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .tbadge { display:inline-block; min-width:16px; margin-left:6px; padding:0 5px; border-radius:999px; background:var(--accent); color:#fff; font-size:11px; font-weight:800; line-height:16px; text-align:center; vertical-align:text-top; }
  .profile { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:2px; padding:11px 14px; margin:0 0 14px; background:var(--panel); font-size:14px; }
  .profile .lbl { color:var(--muted); font-size:12px; }
  .profile button { margin-left:auto; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { flex:1; min-width:0; overflow:hidden; }
  .row .gl { flex:none; width:34px; height:34px; border-radius:9px; display:grid; place-items:center; color:var(--ka, var(--accent)); background:color-mix(in srgb, var(--ka, var(--accent)) 12%, transparent); }
  .row .gl svg { width:19px; height:19px; }
  .row .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12.5px; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--hover); font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.bad { background:rgba(224,108,108,.16); color:var(--danger); }
  .btn { flex:none; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .right { display:flex; align-items:center; gap:8px; flex:none; }
  .pager { display:flex; align-items:center; justify-content:center; gap:14px; margin:16px 0 2px; }
  .pager-n { font-size:12.5px; color:var(--muted); font-family:var(--font-mono, monospace); }
  .btn[disabled] { opacity:.42; cursor:default; }
  .btn[disabled]:hover { border-color:var(--line); color:var(--fg); }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:18px 2px; }
  .back { margin:0 0 14px; }
  a { color:var(--accent); }
  /* SOW-052: the Overview hub */
  .ov-hero { display:flex; align-items:center; justify-content:space-between; gap:12px; flex-wrap:wrap; border:1px solid var(--line); border-radius:2px; padding:14px 16px; background:var(--panel); margin:0 0 16px; }
  .ov-hero b { font-size:15px; }
  .ov-hero .muted { font-size:12.5px; }
  .ov-draft { font-size:12.5px; color:var(--accent); font-weight:700; }
  .ov-tiles { display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:12px; margin:0 0 22px; }
  .ov-tile { display:flex; flex-direction:column; gap:4px; border:1px solid var(--line); border-radius:2px; padding:14px; background:var(--panel); text-decoration:none; color:var(--fg); transition:border-color .14s, transform .14s; }
  .ov-tile:hover { border-color:var(--accent); transform:translateY(-2px); }
  .ov-n { font-weight:800; font-size:22px; line-height:1; color:var(--accent); min-height:16px; }
  .ov-nm { font-weight:600; font-size:13.5px; color:var(--fg); }
  .ov-h3 { font-weight:700; font-size:15px; margin:0 0 10px; }
  .ov-att { list-style:none; margin:0; padding:0; }
  .ov-att li { display:flex; align-items:center; gap:10px; padding:9px 2px; border-top:1px solid var(--line); }
  .ov-att li:first-child { border-top:0; }
`;
  var GbtiWorkspace = class extends GbtiElement {
    connectedCallback() {
      this._tab = typeof location !== "undefined" && parseWorkspaceTab(location.hash) || "overview";
      this._cache = {};
      this._prs = null;
      this._overview = null;
      const newType = typeof location !== "undefined" && parseWorkspaceNew(location.hash) || null;
      this._editing = newType ? { type: newType, frontmatter: {}, body: "" } : null;
      this._page = 0;
      this._reviewing = null;
      this._inboxCount = null;
      super.connectedCallback?.();
      this._loadProfile();
      this._ensureTab(this._tab);
      this._loadInboxCount();
      this._onHash = () => {
        const nt = typeof location !== "undefined" && parseWorkspaceNew(location.hash) || null;
        if (nt && !this._editing && this._reviewing == null) {
          this._editing = { type: nt, frontmatter: {}, body: "" };
          this.render();
          return;
        }
        const t = typeof location !== "undefined" && parseWorkspaceTab(location.hash) || "overview";
        if (t !== this._tab && !this._editing && this._reviewing == null) {
          this._tab = t;
          this._page = 0;
          this.render();
          this._ensureTab(t);
        }
      };
      if (typeof window !== "undefined") window.addEventListener("hashchange", this._onHash);
      this._wireStorageSync();
    }
    disconnectedCallback() {
      if (typeof window !== "undefined" && this._onHash) window.removeEventListener("hashchange", this._onHash);
      try {
        if (this._onStorage) globalThis.chrome?.storage?.onChanged?.removeListener?.(this._onStorage);
      } catch {
      }
      super.disconnectedCallback?.();
    }
    // SOW-052: load the overview hub data — content counts (+ drafts), PR + saved + follow counts, membership, and
    // the "needs attention" PR list. Fail-soft: every read defaults to 0/empty, never throws. Reuses _cache/_prs.
    async _ensureOverview() {
      if (this._overview && this._overview._trusted) return;
      if (!this._overview) {
        const ck = await this._memberKey();
        const cached = ck ? await wbCacheGet(ck, "overview") : null;
        if (cached?.items?.[0]) {
          this._overview = cached.items[0];
          if (this._tab === "overview" && !this._editing) this.render();
        }
      }
      const num = (p) => Promise.resolve(p).then((v) => v).catch(() => null);
      const [post, prompt2, product, prs, activity, follows, status2] = await Promise.all([
        num(this.client?.listContent?.({ type: "post" })),
        num(this.client?.listContent?.({ type: "prompt" })),
        num(this.client?.listContent?.({ type: "product" })),
        num(this.client?.listPRs?.()),
        num(this.client?.getActivity?.()),
        num(this.client?.getFollows?.()),
        num(this.client?.status?.())
      ]);
      const items = (r) => Array.isArray(r?.items) ? r.items : [];
      this._cache.post = items(post);
      this._cache.prompt = items(prompt2);
      this._cache.product = items(product);
      this._prs = Array.isArray(prs?.prs) ? prs.prs : this._prs || [];
      const drafts = [...items(post), ...items(prompt2), ...items(product)].filter((it) => it.status === "draft").length;
      const favs = (activity?.favorites?.length || 0) + (activity?.collections?.length || 0);
      const followN = Array.isArray(follows) ? follows.length : follows?.following?.length || 0;
      const attention = (this._prs || []).map((pr) => ({ pr, c: classifyPull(pr, null) })).filter(({ pr, c }) => c.label === "Declined" || pr.state !== "closed" && pr.merged !== true).slice(0, 6).map(({ pr, c }) => ({ title: pr.title || `PR #${pr.number}`, url: pr.html_url || "", label: c.label, tone: c.tone }));
      const trusted = !!(status2 && status2.authenticated !== false);
      this._overview = {
        membership: status2?.membership || "unknown",
        role: status2?.role || "member",
        counts: { post: items(post).length, prompt: items(prompt2).length, product: items(product).length, prs: (this._prs || []).length, saved: favs, subs: followN, drafts },
        attention,
        _trusted: trusted
      };
      if (trusted) {
        const ck = await this._memberKey();
        if (ck) {
          wbCacheSet(ck, "overview", [this._overview], { allowEmpty: true });
          wbCacheSet(ck, "post", this._cache.post, { allowEmpty: true });
          wbCacheSet(ck, "prompt", this._cache.prompt, { allowEmpty: true });
          wbCacheSet(ck, "product", this._cache.product, { allowEmpty: true });
          if (Array.isArray(this._prs)) wbCacheSet(ck, "prs", this._prs, { allowEmpty: true });
        }
      }
      if (this._tab === "overview" && !this._editing) this.render();
      if (!trusted && !this._overviewRetried) {
        this._overviewRetried = true;
        setTimeout(() => {
          this._overview = null;
          this._ensureOverview();
        }, 2e3);
      }
    }
    // SOW-028 P5: poll the incoming-contribution count on open (batch-first, like the rest of the client) so the
    // Inbox tab carries a "N to review" badge without the member having to open it. Fail-soft to no badge.
    async _loadInboxCount() {
      try {
        this._inboxCount = (await this.client?.listContributions?.())?.contributions?.length ?? 0;
      } catch {
        this._inboxCount = 0;
      }
      if (!this._editing && this._reviewing == null) this.render();
    }
    // ----- data loaders (each fail-soft to an empty state, like gbti-content-list/gbti-pr-list) -----
    async _loadProfile() {
      try {
        const items = (await this.client?.listContent?.({ type: "profile" }))?.items ?? [];
        this._profile = items[0] || null;
      } catch {
        this._profile = null;
      }
      if (!this._editing) this.render();
    }
    async _ensureTab(id) {
      const tab = TABS.find((t) => t.id === id);
      if (!tab) return;
      if (id === "overview") {
        this._ensureOverview();
        return;
      }
      if (id === "earnings") return;
      if (id === "inbox" || id === "saved" || id === "subs") return;
      if (tab.type) {
        await this._swrContent(id, tab.type);
        return;
      }
      if (id === "prs") {
        await this._swrPrs(id);
      }
    }
    /** SOW-073: the per-member cache key (immutable github_id, falling back to login). Cached after the first read. */
    async _memberKey() {
      if (this._mk !== void 0) return this._mk;
      try {
        const id = await getIdentity();
        this._mk = id?.githubId || id?.login ? String(id.githubId || id.login) : null;
      } catch {
        this._mk = null;
      }
      return this._mk;
    }
    // SOW-073: stale-while-revalidate a content tab. Paint the cached items INSTANTLY (no "Loading"/"none" flash),
    // then revalidate in the background and re-render only if the fresh result differs. Within a session the in-memory
    // this._cache[type] is the fast path (a tab revisit does not refetch); the persistent cache hydrates the FIRST
    // access of a session (so a reload is instant too). A genuinely-empty list (the success path) is cached as [].
    async _swrContent(id, type) {
      if (this._cache[type]) return;
      const key = await this._memberKey();
      let fresh = false;
      if (key) {
        const cached = await wbCacheGet(key, type);
        if (cached) {
          this._cache[type] = cached.items;
          if (this._tab === id && !this._editing) this.render();
          fresh = cached.fresh;
        }
      }
      if (fresh) return;
      try {
        const items = (await this.client?.listContent?.({ type }))?.items ?? [];
        const changed = !this._cache[type] || JSON.stringify(this._cache[type]) !== JSON.stringify(items);
        this._cache[type] = items;
        if (key) await wbCacheSet(key, type, items, { allowEmpty: true });
        if (changed && this._tab === id && !this._editing) this.render();
      } catch {
        if (!this._cache[type]) this._cache[type] = [];
        if (this._tab === id && !this._editing) this.render();
      }
    }
    // SOW-073: SWR for the PR tab (cached as the 'prs' pseudo-type). The per-PR gate labels still resolve live via
    // _loadPrStatuses after the list paints (their server-side inlining is SOW-073 P4).
    async _swrPrs(id) {
      if (this._prs) {
        if (id === "prs") this._loadPrStatuses();
        return;
      }
      const key = await this._memberKey();
      let fresh = false, painted = false;
      if (key) {
        const cached = await wbCacheGet(key, "prs");
        if (cached) {
          this._prs = cached.items;
          painted = true;
          if (this._tab === id && !this._editing) this.render();
          if (id === "prs") this._loadPrStatuses();
          fresh = cached.fresh;
        }
      }
      if (fresh) return;
      try {
        const prs = (await this.client?.listPRs?.())?.prs ?? [];
        const changed = !painted || JSON.stringify(this._prs) !== JSON.stringify(prs);
        this._prs = prs;
        if (key) await wbCacheSet(key, "prs", prs, { allowEmpty: true });
        if (changed) {
          if (this._tab === id && !this._editing) this.render();
          if (id === "prs") this._loadPrStatuses();
        }
      } catch {
        if (!this._prs) {
          this._prs = [];
          if (this._tab === id && !this._editing) this.render();
        }
      }
    }
    // SOW-073: a just-published/edited content type invalidates that type + the Overview snapshot + the PR list (a
    // publish opens a PR), in BOTH the in-memory and the persistent cache, then refetches what the member will see.
    async _onPublished(type) {
      const t = type && WB_CONTENT_TYPES.has(type) ? type : null;
      if (t) delete this._cache[t];
      this._overview = null;
      this._prs = null;
      const key = await this._memberKey();
      if (key) await wbCacheInvalidateMany(key, [t, "overview", "prs"].filter(Boolean));
      if (!this._editing) this._ensureTab(this._tab);
    }
    // SOW-073: if ANOTHER extension page invalidates this member's cache (e.g. a publish in a second workbench tab),
    // chrome.storage.onChanged fires here. React ONLY to REMOVALS (an invalidation), never to our own cache writes (a
    // revalidate SET), so this can never loop. Drops the in-memory caches + refetches the open tab.
    _wireStorageSync() {
      try {
        const oc = globalThis.chrome?.storage?.onChanged;
        if (!oc?.addListener) return;
        this._onStorage = async (changes, area) => {
          if (area !== "local") return;
          const key = await this._memberKey();
          if (!key) return;
          const prefix = `gbti:wb:${key}:`;
          const removed = Object.entries(changes || {}).some(([k, c]) => k.startsWith(prefix) && c && c.newValue === void 0);
          if (!removed) return;
          this._cache = {};
          this._prs = null;
          this._overview = null;
          if (!this._editing && this._reviewing == null) this._ensureTab(this._tab);
        };
        oc.addListener(this._onStorage);
      } catch {
      }
    }
    _loadPrStatuses() {
      for (const pr of this._prs || []) {
        if (pr.merged === true || pr.state === "closed" || pr.state === "merged") this._renderPrLabel(pr, null);
        else this._loadPrStatus(pr.number);
      }
    }
    async _loadPrStatus(number) {
      let status2 = null;
      try {
        status2 = await this.client?.prStatus?.({ number });
      } catch {
      }
      const pr = (this._prs || []).find((p) => p.number === number);
      if (pr) this._renderPrLabel(pr, status2);
    }
    _renderPrLabel(pr, status2) {
      const tag = this.$(`.gate[data-n="${pr.number}"]`);
      if (!tag) return;
      const { label, tone } = classifyPull(pr, status2);
      tag.className = `gate tag ${tone}`;
      tag.textContent = label;
      if (status2?.description) tag.title = status2.description;
    }
    // ----- rendering -----
    render() {
      if (this._editing) {
        this.set(this.css(CSS26) + `<button class="btn back" data-back type="button">&larr; Back to my work</button><gbti-content-editor></gbti-content-editor>`);
        this.on("[data-back]", "click", () => {
          this._editing = null;
          this.render();
        });
        const ed = this.$("gbti-content-editor");
        const e = this._editing;
        if (ed?.load) ed.load(e.type, e.frontmatter, e.body);
        ed?.addEventListener("gbti-published", () => this._onPublished(e.type));
        return;
      }
      if (this._reviewing != null) {
        this.set(this.css(CSS26) + `<button class="btn back" data-back type="button">&larr; Back to inbox</button><gbti-contrib-review number="${esc(this._reviewing)}"></gbti-contrib-review>`);
        this.on("[data-back]", "click", () => {
          this._reviewing = null;
          this.render();
        });
        this.$("gbti-contrib-review")?.addEventListener("contrib-decided", () => {
          this._reviewing = null;
          this.render();
          this._loadInboxCount();
        });
        return;
      }
      const tabs = TABS.map((t) => {
        const badge = t.id === "inbox" && this._inboxCount ? `<span class="tbadge">${esc(this._inboxCount)}</span>` : "";
        return `<button class="tab ${t.id === this._tab ? "on" : ""}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}${badge}</button>`;
      }).join("");
      this.set(this.css(CSS26) + `${this._profileHtml()}<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
      this.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        this._tab = b.dataset.tab;
        this.render();
        this._ensureTab(this._tab);
      }));
      this._wireBody();
    }
    _profileHtml() {
      if (!this._profile) return "";
      const f = this._profile.frontmatter || {};
      const name = f.displayName || f.title || this._profile.title || "Your profile";
      return `<div class="profile"><span class="lbl">Profile</span> <b>${esc(name)}</b><button class="btn" data-profile type="button">Edit profile</button></div>`;
    }
    _body() {
      const tab = TABS.find((t) => t.id === this._tab);
      if (this._tab === "overview") return this._overviewHtml();
      if (this._tab === "earnings") return `<div class="ov-hero"><div><b>Earnings</b><br/><span class="muted">Referral revenue-share and contributor rewards.</span></div></div><p class="empty">Earnings are coming soon. When live, this is where your referral commissions (30% lifetime of members you bring in) and accepted-contribution rewards will show, with payout status. Today you can manage your referral link + membership under <a href="account.html">Settings</a>.</p>`;
      if (this._tab === "inbox") return `<gbti-contrib-inbox></gbti-contrib-inbox>`;
      if (this._tab === "saved") return `<gbti-saved></gbti-saved>`;
      if (this._tab === "subs") return `<gbti-subscriptions></gbti-subscriptions>`;
      if (this._tab === "prs") {
        const prs = this._prs;
        if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
        if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
        return `<ul class="rows">${prs.map((pr) => `<li class="row">
        <span class="t"><b>${esc(pr.title || "PR #" + pr.number)}</b><span class="meta"><a href="${esc(pr.html_url || "#")}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub</span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`).join("")}</ul>`;
      }
      const items = this._cache?.[tab?.type];
      if (!items) return `<p class="empty">Loading...</p>`;
      if (items.length === 0) return `<p class="empty">No ${esc(tab.label.toLowerCase())} yet.</p>`;
      const PAGE = 15;
      const pages = Math.max(1, Math.ceil(items.length / PAGE));
      const page = Math.min(this._page || 0, pages - 1);
      const start = page * PAGE;
      const rows = items.slice(start, start + PAGE).map((it, j) => {
        const i = start + j;
        const g = glyphFor(null, it.type);
        const status2 = it.status ? `<span class="tag ${it.status === "published" ? "ok" : ""}">${esc(it.status)}</span>` : "";
        const vis = it.visibility === "members" ? `<span class="tag">members</span>` : "";
        return `<li class="row"><span class="gl" style="--ka:${esc(g.accent)}"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span><span class="t"><b>${esc(it.title)}</b><span class="meta">${esc(it.type || "")}</span></span><span class="right">${status2} ${vis}<button class="btn" data-edit="${i}" type="button">Manage</button></span></li>`;
      }).join("");
      const pager = pages > 1 ? `<div class="pager"><button class="btn" data-page="${page - 1}" type="button"${page === 0 ? " disabled" : ""}>&larr; Prev</button><span class="pager-n">Page ${page + 1} of ${pages}</span><button class="btn" data-page="${page + 1}" type="button"${page >= pages - 1 ? " disabled" : ""}>Next &rarr;</button></div>` : "";
      return `<ul class="rows">${rows}</ul>${pager}`;
    }
    // SOW-052: the Overview hub — a membership line, a tile per section (with counts; tiles deep-link via #tab=),
    // and the pull requests needing attention. Tiles are <a> links so they need no JS wiring.
    _overviewHtml() {
      const ov = this._overview;
      if (!ov) return `<p class="empty">Loading your WorkBench...</p>`;
      const c = ov.counts;
      const mLabel = MEMBERSHIP_LABEL[ov.membership] || "Member";
      const isStaff = ["moderator", "admin", "superadmin"].includes(ov.role);
      const tiles = [
        { nm: "Articles", href: "workspace.html#tab=post", n: c.post },
        { nm: "Prompts", href: "workspace.html#tab=prompt", n: c.prompt },
        { nm: "Products", href: "workspace.html#tab=product", n: c.product },
        { nm: "Pull requests", href: "workspace.html#tab=prs", n: c.prs },
        { nm: "Saved", href: "workspace.html#tab=saved", n: c.saved },
        { nm: "Following", href: "workspace.html#tab=subs", n: c.subs },
        { nm: "Earnings", href: "workspace.html#tab=earnings", n: null },
        { nm: "Settings", href: "account.html", n: null },
        ...isStaff ? [{ nm: "Admin tools", href: "admin.html", n: null }] : []
      ];
      const tileHtml = tiles.map((t) => `<a class="ov-tile" href="${esc(t.href)}"><span class="ov-n">${t.n == null ? "" : esc(t.n)}</span><span class="ov-nm">${esc(t.nm)}</span></a>`).join("");
      const draft = c.drafts ? `<span class="ov-draft">${esc(c.drafts)} draft${c.drafts === 1 ? "" : "s"} in progress</span>` : "";
      const att = ov.attention.length ? `<ul class="ov-att">${ov.attention.map((a) => `<li><span class="tag ${esc(a.tone)}">${esc(a.label)}</span> <a href="${esc(a.url || "#")}" target="_blank" rel="noopener">${esc(a.title)}</a></li>`).join("")}</ul>` : `<p class="muted">No pull requests need your attention.</p>`;
      return `<div class="ov">
      <div class="ov-hero"><div><b>Your WorkBench</b><br/><span class="muted">Membership: ${esc(mLabel)}</span></div>${draft}</div>
      <div class="ov-tiles">${tileHtml}</div>
      <h3 class="ov-h3">Pull requests</h3>
      ${att}
    </div>`;
    }
    _wireBody() {
      this.on("[data-profile]", "click", () => this._openItem(this._profile?.path, "profile"));
      if (this._tab === "inbox") {
        this.$("gbti-contrib-inbox")?.addEventListener("contrib-open", (e) => {
          this._reviewing = e.detail?.number ?? null;
          this.render();
        });
      }
      const tab = TABS.find((t) => t.id === this._tab);
      if (tab?.type) {
        this.$$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
          const it = (this._cache[tab.type] || [])[Number(b.dataset.edit)];
          if (it) this._openItem(it.path, it.type);
        }));
        this.$$("[data-page]").forEach((b) => b.addEventListener("click", () => {
          if (b.hasAttribute("disabled")) return;
          this._page = Number(b.dataset.page) || 0;
          this.render();
        }));
      }
    }
    async _openItem(path, type) {
      if (!path) return;
      try {
        const full = await this.client.getContentItem({ path });
        this._editing = { type, frontmatter: full.frontmatter, body: full.body };
        this.render();
      } catch {
      }
    }
  };
  define("gbti-workspace", GbtiWorkspace);

  // client-ui/src/activity-bell.mjs
  var BELL_GROUPS = [
    { key: "replies", label: "Replies" },
    { key: "following", label: "Following" },
    { key: "prs", label: "Your PRs" },
    { key: "review", label: "To review" }
  ];
  function unreadItems(group, items, seen = {}) {
    const list = Array.isArray(items) ? items : [];
    if (group === "prs") {
      const seenIds = new Set((seen.prsSeen || []).map(String));
      return list.filter((it) => !seenIds.has(String(it.id)));
    }
    const since = Number(seen[group]) || 0;
    return list.filter((it) => toMs(it.ts) > since);
  }
  function buildBell(sources = {}, seen = {}) {
    const groups = BELL_GROUPS.map((g) => {
      const items = (Array.isArray(sources[g.key]) ? sources[g.key] : []).slice().sort((a, b) => toMs(b.ts) - toMs(a.ts));
      return { key: g.key, label: g.label, items, unread: unreadItems(g.key, items, seen).length };
    });
    return { total: groups.reduce((s, g) => s + g.unread, 0), groups };
  }
  function markSeen(sources = {}, now = Date.now()) {
    const prsSeen = (Array.isArray(sources.prs) ? sources.prs : []).map((it) => String(it.id));
    return { replies: now, following: now, review: now, prsSeen };
  }

  // client-ui/src/browse-hash.mjs
  var TAB_IDS = /* @__PURE__ */ new Set(["all", "post", "product", "prompt", "share", "news"]);
  function buildReadHash(type, path) {
    const t = TAB_IDS.has(type) ? type : "post";
    return path ? `tab=${t}&read=${encodeURIComponent(path)}` : `tab=${t}`;
  }
  function parseBrowseHash(hash) {
    const s = String(hash || "").replace(/^#/, "");
    const tabM = s.match(/(?:^|&)tab=([a-z]+)(?:&|$)/);
    const readM = s.match(/(?:^|&)read=([^&]+)/);
    const tab = tabM && TAB_IDS.has(tabM[1]) ? tabM[1] : null;
    let read = null;
    if (readM) {
      try {
        read = decodeURIComponent(readM[1]);
      } catch {
        read = readM[1];
      }
    }
    return { tab, read };
  }

  // client-ui/src/elements/gbti-activity-bell.mjs
  var SITE8 = "https://gbti.network";
  var POLL_MS = 12e4;
  var SEEN_KEY = "gbti-bell-seen";
  var MAX_OWN_SHARES = 20;
  var BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M10.3 21a2 2 0 0 0 3.4 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
  function loadSeen() {
    try {
      return JSON.parse(localStorage.getItem(SEEN_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveSeen(s) {
    try {
      localStorage.setItem(SEEN_KEY, JSON.stringify(s));
    } catch {
    }
  }
  var CSS27 = `
  :host { position:relative; display:inline-flex; font-family:var(--font-body); }
  .btn { width:40px; height:40px; border-radius:50%; border:1.5px solid var(--line); background:var(--panel); color:var(--muted); display:flex; align-items:center; justify-content:center; cursor:pointer; padding:0; transition:border-color .15s, color .15s; }
  .btn:hover { color:var(--fg); }
  .btn svg { width:19px; height:19px; }
  .dot { position:absolute; top:-3px; right:-3px; min-width:18px; height:18px; padding:0 4px; border-radius:999px; background:var(--danger,#d8453b); color:#fff; font-family:var(--font-mono, monospace); font-size:11px; font-weight:700; line-height:18px; text-align:center; box-shadow:0 0 0 2px var(--panel); }
  .panel { position:absolute; top:calc(100% + 8px); right:0; width:340px; max-height:70vh; overflow-y:auto; background:var(--panel); border:1.5px solid var(--line); border-radius:14px; box-shadow:0 16px 40px -12px rgba(0,0,0,.4); padding:6px; z-index:90; }
  .panel[hidden] { display:none; }
  .phead { display:flex; align-items:baseline; justify-content:space-between; padding:8px 10px 6px; }
  .phead b { font-family:var(--font-display, var(--font-body)); font-size:15px; }
  .phead .clr { background:transparent; border:0; color:var(--muted); font:inherit; font-size:12px; cursor:pointer; }
  .phead .clr:hover { color:var(--accent); }
  .grp { padding:6px 4px 2px; }
  .grp-h { display:flex; align-items:center; gap:7px; padding:4px 8px; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); }
  .grp-h .n { background:var(--hover); color:var(--fg); border-radius:999px; padding:0 6px; font-size:10px; }
  .it { display:block; padding:8px 10px; border-radius:9px; color:var(--fg); cursor:pointer; }
  .it:hover { background:var(--hover); }
  .it .t { font-size:13.5px; font-weight:600; display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it .s { font-size:12px; color:var(--muted); display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .it.unread .t::before { content:''; display:inline-block; width:7px; height:7px; border-radius:50%; background:var(--accent); margin-right:7px; vertical-align:middle; }
  .empty { color:var(--muted); font-size:13px; padding:18px 12px; text-align:center; }
`;
  var GbtiActivityBell = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._seen = loadSeen();
      this._bell = null;
      this._sources = null;
      this._gated = true;
      this._open = false;
      this._login = null;
      this._busy = false;
      this.render();
      this._load();
      this._timer = setInterval(() => {
        if (!this._open && !this._hidden()) this._load();
      }, POLL_MS);
      this._onVis = () => {
        if (!this._hidden() && !this._open) this._load();
      };
      if (typeof document !== "undefined") document.addEventListener("visibilitychange", this._onVis);
      this._onDoc = (e) => {
        if (this._open && !this.contains(e.target)) this._close();
      };
      document.addEventListener("click", this._onDoc);
    }
    _hidden() {
      return typeof document !== "undefined" && document.hidden === true;
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      clearInterval(this._timer);
      if (this._onDoc) document.removeEventListener("click", this._onDoc);
      if (this._onVis && typeof document !== "undefined") document.removeEventListener("visibilitychange", this._onVis);
    }
    _safe(fn) {
      return Promise.resolve().then(fn).catch(() => []);
    }
    async _load() {
      if (this._busy) return;
      this._busy = true;
      try {
        let membership = "unknown";
        try {
          const st = await this.client?.status?.();
          membership = st?.membership ?? "unknown";
          this._login = st?.identity?.login || null;
        } catch {
          membership = "unknown";
          this._login = null;
        }
        if (!canSeeShares(membership) || !this._login) {
          this._gated = true;
          this._bell = { total: 0, groups: [] };
          this.render();
          return;
        }
        this._gated = false;
        const sources = await this._fetchSources(this._login);
        this._sources = sources;
        this._bell = buildBell(sources, this._seen);
        this.render();
      } finally {
        this._busy = false;
      }
    }
    async _fetchSources(login) {
      const [review, prs, following, replies] = await Promise.all([
        this._safe(() => this._review()),
        this._safe(() => this._prs()),
        this._safe(() => this._following(login)),
        this._safe(() => this._replies(login))
      ]);
      return { review, prs, following, replies };
    }
    async _review() {
      const { contributions = [] } = await this.client.listContributions() || {};
      return contributions.map((c) => ({
        id: `c${c.number}`,
        ts: toMs(c.updatedAt ?? c.createdAt),
        title: c.title || `Contribution #${c.number}`,
        sub: c.author?.login ? `from @${c.author.login}` : "awaiting your review",
        href: "workspace.html#tab=inbox"
      }));
    }
    async _prs() {
      const { prs = [] } = await this.client.listPRs() || {};
      return prs.filter((p) => p.merged === true || p.state === "merged" || p.state === "closed").map((p) => ({
        id: p.number,
        ts: p.number,
        // no reliable timestamp in both host modes; the number is a recency proxy for display sort
        title: p.title || `PR #${p.number}`,
        sub: p.merged === true || p.state === "merged" ? "Accepted" : "Declined",
        href: p.html_url || SITE8
      }));
    }
    async _following(login) {
      const f = await this.client.getFollows() || {};
      const set = new Set((f.following || []).map((x) => String(x?.username || "").toLowerCase()).filter(Boolean));
      if (!set.size) return [];
      const res = await fetch(`${SITE8}/activity-index.json`, { cache: "no-cache" });
      const data = res.ok ? await res.json() : {};
      const entries = Array.isArray(data?.entries) ? data.entries : [];
      return entries.filter((e) => set.has(String(e.author).toLowerCase())).map((e) => ({
        id: `f:${e.type}:${e.path || e.url || e.title}`,
        ts: toMs(e.publishedAt),
        title: e.title || "New activity",
        sub: `@${e.author}`,
        href: e.path ? `newtab.html#${buildReadHash(e.type, e.path)}` : `${SITE8}${e.url || ""}`
      }));
    }
    // v1: replies on the caller's OWN Shares (the conversational surface the owner asked about). Content-item replies
    // (post/product/prompt) need a per-item comment walk and defer to P4's server aggregator. Hard-bounded fan-out.
    async _replies(login) {
      const lc7 = String(login).toLowerCase();
      const { items = [] } = await this.client.listShares() || {};
      const mine = items.filter((s) => String(s.author).toLowerCase() === lc7).slice(0, MAX_OWN_SHARES);
      const lists = await Promise.all(mine.map((s) => this._safe(async () => {
        const slug = s.author && s.id ? `${s.author}/${s.id}` : "";
        if (!slug) return [];
        const r = await this.client.listShareComments({ targetSlug: slug }) || {};
        return (r.items || []).filter((c) => String(c.author).toLowerCase() !== lc7).map((c) => ({
          id: `cmt:${c.path || `${slug}:${c.id || c.createdAt}`}`,
          ts: toMs(c.createdAt),
          title: `Reply on ${s.title || s.shortDescription || "your Share"}`,
          sub: `@${c.author}`,
          href: "newtab.html#tab=share"
        }));
      })));
      return lists.flat();
    }
    _close() {
      this._open = false;
      this.render();
    }
    _toggle() {
      this._open = !this._open;
      if (this._open && this._sources) {
        this._seen = markSeen(this._sources);
        saveSeen(this._seen);
        this._bell = buildBell(this._sources, this._seen);
      }
      this.render();
    }
    _markAllSeen() {
      if (this._sources) {
        this._seen = markSeen(this._sources);
        saveSeen(this._seen);
        this._bell = buildBell(this._sources, this._seen);
      }
      this.render();
    }
    render() {
      if (!this.root) return;
      if (this._gated) {
        this.hidden = true;
        this.set("");
        return;
      }
      this.hidden = false;
      const total = this._bell?.total || 0;
      const dot = total > 0 ? `<span class="dot">${total > 99 ? "99+" : total}</span>` : "";
      const panel = this._open ? this._panelHtml() : "";
      this.set(this.css(CSS27) + `<button class="btn" type="button" data-bell aria-label="Activity${total ? `, ${total} new` : ""}" aria-haspopup="true" aria-expanded="${this._open}">${BELL}${dot}</button>${panel}`);
      this.on("[data-bell]", "click", (e) => {
        e.stopPropagation();
        this._toggle();
      });
      this.on("[data-clear]", "click", (e) => {
        e.stopPropagation();
        this._markAllSeen();
      });
    }
    _panelHtml() {
      const seen = this._seen || {};
      const groups = (this._bell?.groups || []).filter((g) => g.items.length);
      const unreadSet = /* @__PURE__ */ new Map();
      for (const g of this._bell?.groups || []) {
        const since = Number(seen[g.key]) || 0;
        const seenIds = new Set((seen.prsSeen || []).map(String));
        unreadSet.set(g.key, new Set(g.items.filter((it) => g.key === "prs" ? !seenIds.has(String(it.id)) : toMs(it.ts) > since).map((it) => it.id)));
      }
      const body = groups.length ? groups.map((g) => {
        const un = unreadSet.get(g.key) || /* @__PURE__ */ new Set();
        const rows = g.items.slice(0, 8).map((it) => {
          const cls = un.has(it.id) ? "it unread" : "it";
          const ext = /^https?:\/\//.test(it.href) ? ' target="_blank" rel="noopener"' : "";
          return `<a class="${cls}" href="${esc(it.href)}"${ext}><span class="t">${esc(it.title)}</span><span class="s">${esc(it.sub || "")}</span></a>`;
        }).join("");
        const moreN = g.items.length - Math.min(g.items.length, 8);
        return `<div class="grp"><div class="grp-h">${esc(g.label)}${g.unread ? `<span class="n">${g.unread}</span>` : ""}</div>${rows}${moreN > 0 ? `<div class="it s" style="color:var(--muted)">+${moreN} more</div>` : ""}</div>`;
      }).join("") : `<div class="empty">You are all caught up.</div>`;
      return `<div class="panel"><div class="phead"><b>Activity</b><button class="clr" type="button" data-clear>Mark all read</button></div>${body}</div>`;
    }
  };
  define("gbti-activity-bell", GbtiActivityBell);

  // client-ui/src/news.mjs
  var UTM = Object.freeze({ utm_source: "gbti-network", utm_medium: "extension", utm_campaign: "news" });
  var secToMs = (s) => typeof s === "number" && s > 0 ? s * 1e3 : null;
  function newsTargetSlug(guid) {
    const s = String(guid ?? "");
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return `news-${(h >>> 0).toString(36)}${(s.length % 36).toString(36)}`;
  }
  function utmLink(link, params = UTM) {
    if (typeof link !== "string" || !link) return "";
    try {
      const u = new URL(link);
      for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
      return u.toString();
    } catch {
      return link;
    }
  }
  function newsToItem(n = {}) {
    return {
      type: "news",
      kind: "news",
      supplementary: true,
      guid: n.guid ?? null,
      title: n.title || n.source || "News",
      author: n.source || "News",
      source: n.source || null,
      visibility: "members",
      // SOW-046 F: the source article's image (RSS enclosure/media:* surfaced by the news worker's /feed). The
      // card-list resolves an absolute URL straight through (resolveAsset), so a news card shows the article image
      // and falls back to the news glyph when the feed carried none.
      thumb: n.image || n.ogImage || null,
      category: n.category ?? null,
      excerpt: n.digest || n.summary || "",
      // SOW-046 A: prefer the AI summary; fall back to the feed excerpt
      createdAt: secToMs(n.publishedAt) ?? secToMs(n.fetchedAt),
      // epoch seconds -> ms (the feed serves seconds)
      openHref: n.link ? utmLink(n.link) : null,
      link: n.link ?? null
    };
  }

  // membership/topic-map.mjs
  function topicMapFromParsed(parsed) {
    const out = {};
    const src = parsed && typeof parsed === "object" ? parsed.topics ?? parsed : {};
    if (!src || typeof src !== "object" || Array.isArray(src)) return out;
    for (const [topic, val] of Object.entries(src)) {
      if (typeof topic !== "string" || !topic) continue;
      const list = Array.isArray(val) ? val : val && Array.isArray(val.newsCategories) ? val.newsCategories : [];
      const seen = /* @__PURE__ */ new Set();
      const cats = [];
      for (const c of list) {
        if (typeof c !== "string") continue;
        const v = c.trim();
        if (!v || seen.has(v)) continue;
        seen.add(v);
        cats.push(v);
      }
      out[topic] = cats;
    }
    return out;
  }
  function newsCategoriesForTopics(topics, map) {
    const m = topicMapFromParsed(map);
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const t of Array.isArray(topics) ? topics : []) {
      for (const c of m[t] ?? []) {
        if (!seen.has(c)) {
          seen.add(c);
          out.push(c);
        }
      }
    }
    return out;
  }
  function prioritizeNewsByTopics(items, followedNewsCats) {
    const set = new Set(Array.isArray(followedNewsCats) ? followedNewsCats : []);
    const list = Array.isArray(items) ? items : [];
    if (!set.size) return [...list];
    const followed = [];
    const rest = [];
    for (const it of list) (set.has(it && it.category) ? followed : rest).push(it);
    return [...followed, ...rest];
  }

  // client-ui/src/elements/gbti-news.mjs
  var SITE9 = "https://gbti.network";
  var nudge = (msg) => `<div class="nudge">${esc(msg)} <a href="${SITE9}/membership/">Become a member</a> to unlock the news feed.</div>`;
  var lc4 = (s) => String(s ?? "").toLowerCase();
  var CSS28 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin:0 0 14px; flex-wrap:wrap; }
  .head .t h3 { margin:0 0 2px; font-family:var(--font-display, var(--font-body)); font-size:18px; }
  .head .t .sub { margin:0; color:var(--muted); font-size:13px; }
  .tabs { display:flex; gap:2px; background:var(--hover); border:1px solid var(--line); border-radius:999px; padding:3px; }
  .tabs button { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:12.5px; padding:6px 13px; border-radius:999px; cursor:pointer; }
  .tabs button.on { background:var(--panel); color:var(--accent); }
  .muted { color:var(--muted); font-size:14px; }
  .nudge { padding:16px; border:1.5px dashed var(--line); border-radius:12px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  button.retry { font:inherit; font-size:13px; font-weight:600; margin-left:8px; padding:5px 11px; border:1px solid var(--line); border-radius:8px; background:var(--panel); color:var(--fg); cursor:pointer; }
  ul.chans { list-style:none; margin:0; padding:0; }
  .chan { display:flex; align-items:center; gap:12px; padding:12px 2px; border-top:1px solid var(--line); }
  .chan:first-child { border-top:0; }
  .chan .ci { min-width:0; flex:1; }
  .chan .ci b { display:block; font-size:14.5px; }
  .chan .ci .d { display:block; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .chan .ci .n { color:var(--muted); font-size:11.5px; }
  .fbtn { flex:none; font:inherit; font-weight:600; font-size:12.5px; padding:6px 13px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .fbtn:hover { border-color:var(--accent); color:var(--accent); }
  .fbtn.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .fbtn[disabled] { opacity:.6; cursor:default; }

  /* the in-element summary reader */
  .rd { background:var(--panel); border:1px solid var(--line); border-radius:14px; padding:18px 20px; }
  .rd .back { font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:transparent; border:0; padding:0; margin:0 0 12px; cursor:pointer; }
  .rd .back:hover { color:var(--accent); }
  .rd h4 { margin:0 0 6px; font-family:var(--font-display, var(--font-body)); font-size:19px; line-height:1.3; }
  .rd .by { margin:0 0 14px; color:var(--muted); font-size:12.5px; }
  .rd .sum { margin:0 0 18px; font-size:14.5px; line-height:1.6; color:var(--fg); }
  .rd .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .rd a.src { font:inherit; font-weight:600; font-size:13px; padding:8px 14px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); text-decoration:none; }
  .rd a.src:hover { border-color:var(--accent); color:var(--accent); }
  .rd button.disc { font:inherit; font-weight:700; font-size:13px; padding:8px 15px; border:1px solid var(--brand); border-radius:9px; background:var(--brand); color:#fff; cursor:pointer; }
  .rd button.disc:hover { filter:brightness(1.05); }
  .rd button.disc[disabled] { opacity:.6; cursor:default; }
  .rd .note { font-size:12.5px; margin:12px 0 0; }
  .rd .note.ok { color:var(--brand); }
  .rd .note.err { color:#d4495a; }
  .rd .disc-wrap { margin-top:20px; padding-top:16px; border-top:1px solid var(--line); }
  .rd .disc-wrap h5 { margin:0 0 10px; font-family:var(--font-display, var(--font-body)); font-size:14px; }
`;
  var GbtiNews = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._view = "feed";
      this._state = "loading";
      this._open = null;
      this._canCurate = false;
      this._onComment = (e) => {
        const it = this._open;
        if (!it?.guid || !this.client?.newsDiscussed) return;
        if (e?.detail?.targetSlug !== newsTargetSlug(it.guid)) return;
        Promise.resolve(this.client.newsDiscussed(it.guid)).catch(() => {
        });
      };
      document.addEventListener("gbti-comment-posted", this._onComment);
      this.render();
      this._load();
    }
    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._onComment) document.removeEventListener("gbti-comment-posted", this._onComment);
    }
    async _load() {
      if (!this.client) {
        this._state = "inert";
        this.render();
        return;
      }
      try {
        this._canCurate = Boolean((await this.client.status())?.canCurate);
      } catch {
        this._canCurate = false;
      }
      try {
        const { items } = await this.client.getNews({ limit: 60 });
        let raw = Array.isArray(items) ? items : [];
        try {
          const [prefs, tj] = await Promise.all([
            this.client.getPrefs ? this.client.getPrefs() : Promise.resolve(null),
            fetch(`${SITE9}/topics.json`, { cache: "no-cache" }).then((r) => r.json())
          ]);
          const map = Object.fromEntries((tj?.topics || []).map((t) => [t.key, t.newsCategories || []]));
          raw = prioritizeNewsByTopics(raw, newsCategoriesForTopics(prefs?.categories, map));
        } catch {
        }
        this._items = raw.map(newsToItem);
        this._state = "ready";
      } catch (err) {
        this._state = err?.code === "membership-required" ? "locked" : err?.code === "not-authenticated" ? "signin" : "error";
      }
      this.render();
    }
    async _loadChannels() {
      this._chanState = "loading";
      this.render();
      try {
        const [{ sources }, prefs] = await Promise.all([this.client.getNewsSources(), this.client.getPrefs()]);
        this._sources = Array.isArray(sources) ? sources : [];
        this._followed = new Set((prefs?.followedChannels || []).map(lc4));
        this._chanState = "ready";
      } catch (err) {
        this._chanState = err?.code === "membership-required" ? "locked" : err?.code === "not-authenticated" ? "signin" : "error";
      }
      this.render();
    }
    _setView(v) {
      if (v === this._view) return;
      this._view = v;
      this._open = null;
      if (v === "channels" && !this._chanState) {
        this._loadChannels();
        return;
      }
      this.render();
    }
    async _toggleFollow(id, btn) {
      const on = !this._followed.has(lc4(id));
      if (btn) {
        btn.disabled = true;
        btn.textContent = on ? "Following…" : "Unfollowing…";
      }
      try {
        const prefs = await this.client.setPrefs({ followChannel: { id, on } });
        this._followed = new Set((prefs?.followedChannels || []).map(lc4));
      } catch {
      }
      this.render();
    }
    async _publishToDiscord(btn) {
      const item = this._open;
      if (!item) return;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Posting…";
      }
      this._postNote = null;
      try {
        const r = await this.client.publishNews(item);
        this._postNote = r?.posted ? { ok: true, msg: "Posted to Discord." } : r?.alreadyPosted ? { ok: true, msg: "Already posted to Discord." } : { ok: false, msg: r?.reason || "No Discord channel is mapped for this category yet." };
      } catch (err) {
        this._postNote = { ok: false, msg: err?.message || "Could not post to Discord." };
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS28) + `<p class="muted">Open in the GBTI client to read the news.</p>`);
        return;
      }
      const tabs = `<div class="tabs"><button data-view="feed" class="${this._view === "feed" ? "on" : ""}" type="button">Feed</button><button data-view="channels" class="${this._view === "channels" ? "on" : ""}" type="button">Channels</button></div>`;
      const head = `<div class="head"><div class="t"><h3>News</h3><p class="sub">Curated developer news, refreshed hourly. A members-only perk.</p></div>${tabs}</div>`;
      this.set(this.css(CSS28) + head + `<div data-body></div>`);
      this.$$("[data-view]").forEach((b) => b.addEventListener("click", () => this._setView(b.dataset.view)));
      if (this._view === "channels") {
        this._renderChannels();
        return;
      }
      this._open ? this._renderReader() : this._renderFeed();
    }
    _renderFeed() {
      const host = this.$("[data-body]");
      if (!host) return;
      if (this._state === "loading") {
        host.innerHTML = `<p class="muted">Loading the latest news…</p>`;
        return;
      }
      if (this._state === "signin") {
        host.innerHTML = nudge("Sign in to read the members-only news feed.");
        return;
      }
      if (this._state === "locked") {
        host.innerHTML = nudge("The news feed is a members-only perk.");
        return;
      }
      if (this._state === "error") {
        host.innerHTML = `<p class="muted">Could not load the news right now.<button class="retry" data-retry type="button">Retry</button></p>`;
        this.$("[data-retry]")?.addEventListener("click", () => {
          this._state = "loading";
          this.render();
          this._load();
        });
        return;
      }
      const items = this._items || [];
      if (!items.length) {
        host.innerHTML = `<p class="muted">No news right now. Check back soon.</p>`;
        return;
      }
      const list = document.createElement("gbti-card-list");
      list.mode = "detailed";
      list.items = items.map(({ openHref, ...rest }) => rest);
      list.addEventListener("card-open", (e) => {
        const it = e.detail?.item;
        if (!it) return;
        this._open = items.find((x) => x.guid === it.guid) || it;
        this._postNote = null;
        this.render();
      });
      host.replaceChildren(list);
    }
    _renderReader() {
      const host = this.$("[data-body]");
      if (!host) return;
      const it = this._open;
      const by = [it.source, it.category].filter(Boolean).map((s) => esc(String(s))).join(" · ");
      const src = it.openHref ? `<a class="src" href="${esc(it.openHref)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : "";
      const disc = this._canCurate ? `<button class="disc" data-disc type="button">Add to Discord</button>` : "";
      const note = this._postNote ? `<p class="note ${this._postNote.ok ? "ok" : "err"}">${esc(this._postNote.msg)}</p>` : "";
      const slug = it.guid ? newsTargetSlug(it.guid) : "";
      const discussion = slug ? `<div class="disc-wrap"><h5>Discussion</h5><gbti-discussion data-gbti-target-type="news" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>` : "";
      host.innerHTML = `<div class="rd"><button class="back" data-back type="button">← Back to feed</button><h4>${esc(it.title)}</h4>` + (by ? `<p class="by">${by}</p>` : "") + `<p class="sum">${esc(it.excerpt || "No summary available.")}</p><div class="acts">${src}${disc}</div>${note}${discussion}</div>`;
      this.$("[data-back]")?.addEventListener("click", () => {
        this._open = null;
        this._postNote = null;
        this.render();
      });
      this.$("[data-disc]")?.addEventListener("click", (e) => this._publishToDiscord(e.currentTarget));
    }
    _renderChannels() {
      const host = this.$("[data-body]");
      if (!host) return;
      if (!this._chanState || this._chanState === "loading") {
        host.innerHTML = `<p class="muted">Loading channels…</p>`;
        return;
      }
      if (this._chanState === "signin") {
        host.innerHTML = nudge("Sign in to follow news channels.");
        return;
      }
      if (this._chanState === "locked") {
        host.innerHTML = nudge("Following news channels is a members-only perk.");
        return;
      }
      if (this._chanState === "error") {
        host.innerHTML = `<p class="muted">Could not load channels.<button class="retry" data-retry type="button">Retry</button></p>`;
        this.$("[data-retry]")?.addEventListener("click", () => this._loadChannels());
        return;
      }
      const sources = this._sources || [];
      if (!sources.length) {
        host.innerHTML = `<p class="muted">No channels available yet.</p>`;
        return;
      }
      const followed = this._followed || /* @__PURE__ */ new Set();
      const rows = sources.map((s) => {
        const on = followed.has(lc4(s.id));
        const meta = [s.description, s.count != null ? `${s.count} items` : null].filter(Boolean).join(" · ");
        return `<li class="chan"><div class="ci"><b>${esc(s.name || s.id)}</b>${meta ? `<span class="d">${esc(meta)}</span>` : ""}</div><button class="fbtn ${on ? "on" : ""}" data-follow="${esc(s.id)}" type="button">${on ? "Following" : "Follow"}</button></li>`;
      }).join("");
      host.innerHTML = `<p class="muted" style="margin:0 0 10px">Follow channels to drill into them from your <b>Following</b> feed.</p><ul class="chans">${rows}</ul>`;
      this.$$("[data-follow]").forEach((b) => b.addEventListener("click", () => this._toggleFollow(b.dataset.follow, b)));
    }
  };
  define("gbti-news", GbtiNews);

  // client-ui/src/elements/gbti-news-reader.mjs
  var lc5 = (s) => String(s ?? "").toLowerCase();
  var CSS29 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); max-width:760px; }
  .pub { display:flex; align-items:center; gap:12px; padding:0 0 16px; margin:0 0 16px; border-bottom:1px solid var(--line); }
  .pav { position:relative; width:40px; height:40px; border-radius:10px; overflow:hidden; flex:none; background:var(--hover); }
  .pav img { position:absolute; inset:0; width:100%; height:100%; object-fit:cover; }
  .pub .pi { min-width:0; flex:1; }
  .pub .pi b { display:block; font-size:15px; }
  .pub .pi .d { display:block; color:var(--muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .fbtn { flex:none; font:inherit; font-weight:600; font-size:12.5px; padding:7px 15px; border:1px solid var(--line); border-radius:999px; background:var(--panel); color:var(--fg); cursor:pointer; }
  .fbtn:hover { border-color:var(--accent); color:var(--accent); }
  .fbtn.on { background:var(--brand); border-color:var(--brand); color:#fff; }
  .fbtn[disabled] { opacity:.6; cursor:default; }
  .hero { display:block; width:100%; aspect-ratio:16 / 9; object-fit:cover; border-radius:12px; margin:0 0 18px; background:var(--hover); }
  h2 { font-family:var(--font-display, var(--font-body)); font-size:23px; line-height:1.3; margin:0 0 12px; }
  .sum { font-size:15px; line-height:1.6; color:var(--fg); margin:0 0 20px; }
  .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  a.src { font:inherit; font-weight:600; font-size:13.5px; padding:9px 16px; border:1px solid var(--line); border-radius:9px; background:var(--panel); color:var(--fg); text-decoration:none; }
  a.src:hover { border-color:var(--accent); color:var(--accent); }
  button.disc { font:inherit; font-weight:700; font-size:13.5px; padding:9px 16px; border:1px solid var(--brand); border-radius:9px; background:var(--brand); color:#fff; cursor:pointer; }
  button.disc[disabled] { opacity:.6; cursor:default; }
  .note { font-size:12.5px; margin:12px 0 0; } .note.ok { color:var(--brand); } .note.err { color:#d4495a; }
  .disc-wrap { margin-top:24px; padding-top:18px; border-top:1px solid var(--line); }
  .disc-wrap h4 { margin:0 0 12px; font-family:var(--font-display, var(--font-body)); font-size:15px; }
  .muted { color:var(--muted); }
`;
  var GbtiNewsReader = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this._onComment = (e) => {
        const it = this._item;
        if (!it?.guid || !this.client?.newsDiscussed) return;
        if (e?.detail?.targetSlug !== newsTargetSlug(it.guid)) return;
        Promise.resolve(this.client.newsDiscussed(it.guid)).catch(() => {
        });
      };
      document.addEventListener("gbti-comment-posted", this._onComment);
    }
    disconnectedCallback() {
      super.disconnectedCallback?.();
      if (this._onComment) document.removeEventListener("gbti-comment-posted", this._onComment);
    }
    /** Mirrors <gbti-reader>.open(item): the new-tab mounts this then calls open() with the news card item. */
    async open(item) {
      this._item = item || null;
      this._postNote = null;
      this._canCurate = false;
      this._publisher = null;
      this._followed = null;
      this.render();
      if (!item || !this.client) return;
      try {
        const [status2, srcs, prefs] = await Promise.all([
          this.client.status?.().catch(() => null),
          this.client.getNewsSources?.().catch(() => null),
          this.client.getPrefs?.().catch(() => null)
        ]);
        this._canCurate = Boolean(status2?.canCurate);
        const sid = lc5(item.source);
        this._publisher = (srcs?.sources || []).find((s) => lc5(s.id) === sid || lc5(s.name) === sid) || null;
        this._followed = new Set((prefs?.followedChannels || []).map(lc5));
      } catch {
      }
      this.render();
    }
    async _toggleFollow(btn) {
      const id = this._item?.source;
      if (!id || !this._followed) return;
      const on = !this._followed.has(lc5(id));
      if (btn) {
        btn.disabled = true;
        btn.textContent = on ? "Following…" : "Unfollowing…";
      }
      try {
        const prefs = await this.client.setPrefs({ followChannel: { id, on } });
        this._followed = new Set((prefs?.followedChannels || []).map(lc5));
      } catch {
      }
      this.render();
    }
    async _publishToDiscord(btn) {
      const it = this._item;
      if (!it) return;
      if (btn) {
        btn.disabled = true;
        btn.textContent = "Posting…";
      }
      this._postNote = null;
      try {
        const r = await this.client.publishNews(it);
        this._postNote = r?.posted ? { ok: true, msg: "Posted to Discord." } : r?.alreadyPosted ? { ok: true, msg: "Already posted to Discord." } : { ok: false, msg: r?.reason || "No Discord channel is mapped for this category yet." };
      } catch (err) {
        this._postNote = { ok: false, msg: err?.message || "Could not post to Discord." };
      }
      this.render();
    }
    render() {
      if (!this.client) {
        this.set(this.css(CSS29) + `<p class="muted">Open in the GBTI client to read the news.</p>`);
        return;
      }
      const it = this._item;
      if (!it) {
        this.set(this.css(CSS29) + `<p class="muted">No item selected.</p>`);
        return;
      }
      const fav = faviconFor(it.link || it.openHref);
      const pub = this._publisher;
      const followable = Boolean(this.client?.setPrefs && it.source && this._followed);
      const followed = followable && this._followed.has(lc5(it.source));
      const meta = [pub?.description, pub?.count != null ? `${pub.count} items` : null].filter(Boolean).join(" · ");
      const open = it.openHref || (it.link ? utmLink(it.link) : "");
      const disc = this._canCurate ? `<button class="disc" data-disc type="button">Add to Discord</button>` : "";
      const note = this._postNote ? `<p class="note ${this._postNote.ok ? "ok" : "err"}">${esc(this._postNote.msg)}</p>` : "";
      const slug = it.guid ? newsTargetSlug(it.guid) : "";
      const discussion = slug ? `<div class="disc-wrap"><h4>Discussion</h4><gbti-discussion data-gbti-target-type="news" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></div>` : "";
      const heroSrc = it.thumb || it.image || "";
      const hero = heroSrc ? `<img class="hero" src="${esc(heroSrc)}" alt="" loading="lazy">` : "";
      this.set(this.css(CSS29) + `<div class="pub"><span class="pav">${fav ? `<img class="avimg" src="${esc(fav)}" alt="">` : ""}</span><div class="pi"><b>${esc(pub?.name || it.source || "Publisher")}</b>${meta ? `<span class="d">${esc(meta)}</span>` : ""}</div>` + (followable ? `<button class="fbtn ${followed ? "on" : ""}" data-follow type="button">${followed ? "Following" : "Follow"}</button>` : "") + `</div>` + hero + `<h2>${esc(it.title || "News")}</h2><p class="sum">${esc(it.excerpt || "No summary available.")}</p><div class="acts">${open ? `<a class="src" href="${esc(open)}" target="_blank" rel="noopener noreferrer">Open source ↗</a>` : ""}${disc}</div>${note}` + discussion);
      if (!this._wiredErr) {
        this.root?.addEventListener("error", (e) => {
          const t = e.target;
          if (t?.tagName === "IMG" && (t.classList?.contains("avimg") || t.classList?.contains("hero"))) t.remove();
        }, true);
        this._wiredErr = true;
      }
      this.$("[data-follow]")?.addEventListener("click", (e) => this._toggleFollow(e.currentTarget));
      this.$("[data-disc]")?.addEventListener("click", (e) => this._publishToDiscord(e.currentTarget));
    }
  };
  define("gbti-news-reader", GbtiNewsReader);

  // client-ui/src/elements/gbti-reader.mjs
  var SITE10 = "https://gbti.network";
  var lc6 = (s) => String(s || "").toLowerCase();
  var isHouse = (a) => {
    const x = lc6(a);
    return !x || x === "gbti" || x === "house";
  };
  var authorName4 = (a) => isHouse(a) ? "GBTI Network" : a;
  var githubLogin = (a) => lc6(a) === "gbti" || lc6(a) === "house" ? "gbti-network" : a;
  var githubAvatar = (a) => a ? `https://github.com/${encodeURIComponent(githubLogin(a))}.png?size=96` : "";
  function targetSlugFor(it) {
    if (it.type === "share") return it.author && it.id ? `${it.author}/${it.id}` : "";
    if (it.slug) return String(it.slug);
    const m = String(it.path || "").match(/\/(?:posts|products|prompts)\/([^/]+)\/index\.md$/);
    return m ? m[1] : "";
  }
  var TYPE_LABEL4 = { post: "Article", product: "Product", prompt: "Prompt", share: "Share" };
  var dateStr = (ms) => {
    try {
      return ms ? new Date(ms).toLocaleDateString(void 0, { year: "numeric", month: "long", day: "numeric" }) : "";
    } catch {
      return "";
    }
  };
  var lockNotice = (what) => `<div class="locked">${esc(what)} is for members. <a href="${SITE10}/membership/" target="_blank" rel="noopener">Become a member</a> to unlock.</div>`;
  var _directory = null;
  function loadDirectory() {
    if (_directory) return _directory;
    _directory = fetch(`${SITE10}/members-index.json`).then((r) => r.ok ? r.json() : { members: [] }).then((j) => new Map((j.members || []).map((m) => [lc6(m.username), m]))).catch(() => /* @__PURE__ */ new Map());
    return _directory;
  }
  var SOCIALS = [
    ["github", "GitHub", "https://github.com/"],
    ["website", "Website", ""],
    ["x", "X", "https://x.com/"],
    ["bluesky", "Bluesky", "https://bsky.app/profile/"],
    ["youtube", "YouTube", "https://youtube.com/"],
    ["devto", "DEV", "https://dev.to/"],
    ["reddit", "Reddit", "https://reddit.com/user/"],
    ["mastodon", "Mastodon", ""],
    ["linkedin", "LinkedIn", "https://linkedin.com/in/"]
  ];
  function linkUrl(value, base) {
    const v = String(value || "").trim();
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (!base) return /^[\w.-]+\.[a-z]{2,}/i.test(v) ? `https://${v}` : "";
    return `${base}${v.replace(/^@/, "")}`;
  }
  var CSS30 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .wrap { max-width:1160px; margin:0 auto; }
  .cols { display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:40px; align-items:start; }
  @media (max-width:960px) { .cols { grid-template-columns:1fr; gap:28px; } }
  article { min-width:0; }
  h1 { font-family:var(--font-display); font-size:30px; line-height:1.2; margin:0 0 12px; }

  .meta { color:var(--muted); font-size:13px; margin:0 0 18px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .meta .who { display:inline-flex; align-items:center; gap:8px; }
  .meta .av { width:24px; height:24px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-size:11px; font-weight:700; }
  .meta .av img { width:100%; height:100%; object-fit:cover; }
  .meta .who b { color:var(--fg); font-weight:600; }
  .meta .m-actions { margin-left:auto; display:inline-flex; align-items:center; gap:8px; }
  .meta gbti-favorite, .meta gbti-collection { display:inline-flex; }
  .meta .m-act { display:inline-flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:8px; border:1px solid var(--line); background:transparent; color:var(--muted); cursor:pointer; }
  .meta .m-act:hover { color:var(--accent); border-color:var(--accent); }
  /* Mobile: lift the favorite + collection actions to their own right-justified row ABOVE the author meta. */
  @media (max-width:650px) { .meta .m-actions { order:-1; width:100%; justify-content:flex-end; margin-left:0; margin-bottom:2px; } }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .cats { display:flex; gap:6px; flex-wrap:wrap; }
  .cat { font-size:11px; font-weight:600; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:999px; padding:2px 9px; }

  /* SOW-050: the hero cover is contained by WIDTH only (height auto, no object-fit crop), so the whole image
     shows at full resolution with no clipping. */
  .cover { display:block; width:100%; height:auto; border-radius:12px; border:1px solid var(--line); margin:0 0 22px; }

  .body { font-size:15.5px; line-height:1.7; }
  .body h1,.body h2,.body h3 { font-family:var(--font-display); margin:1.4em 0 .5em; }
  .body p { margin:0 0 1em; }
  .body a { color:var(--accent); }
  .body img { max-width:100%; height:auto; border-radius:10px; }
  .body ul,.body ol { padding-left:1.4em; margin:0 0 1em; }
  .body blockquote { margin:0 0 1em; padding:2px 0 2px 14px; border-left:3px solid var(--line); color:var(--muted); }
  .body > pre, .body code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
  .body :not(pre) > code { background:var(--hover); border:1px solid var(--line); border-radius:5px; padding:.08em .35em; font-size:.9em; }

  /* SOW-050: code cards (built from <pre> in _enhanceCode) — a header bar with the language + a Copy button, a
     dark, horizontally-scrollable body that preserves whitespace. */
  .codecard { margin:0 0 1.2em; border:1px solid var(--line); border-radius:10px; overflow:hidden; background:var(--code-bg, #11131a); }
  .codebar { display:flex; align-items:center; justify-content:space-between; gap:8px; padding:6px 10px; background:color-mix(in srgb, var(--line) 40%, transparent); border-bottom:1px solid var(--line); }
  .codelang { font-family:ui-monospace,monospace; font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:var(--muted); }
  .copybtn { font:inherit; font-size:11px; font-weight:600; color:var(--muted); background:transparent; border:1px solid var(--line); border-radius:6px; padding:2px 9px; cursor:pointer; }
  .copybtn:hover { color:var(--fg); border-color:var(--accent); }
  .codecard pre { margin:0; padding:13px 14px; overflow-x:auto; }
  .codecard pre code { display:block; white-space:pre; color:var(--code-fg, #e6e6e6); font-size:13px; line-height:1.55; background:none; border:0; padding:0; }

  .locked { border:1px solid var(--line); background:var(--hover); border-radius:10px; padding:14px 16px; color:var(--fg); font-size:14px; margin:14px 0; }
  .locked a { color:var(--accent); }
  .muted { color:var(--muted); }
  .view { display:inline-block; margin-top:22px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }

  /* The right drawer */
  .side { display:flex; flex-direction:column; gap:22px; }
  .author { border:1px solid var(--line); background:var(--panel); border-radius:14px; padding:18px; }
  .author .a-top { display:flex; align-items:center; gap:12px; }
  .author .a-av { width:48px; height:48px; border-radius:50%; overflow:hidden; flex:none; display:grid; place-items:center; background:var(--hover); color:var(--muted); font-weight:700; }
  .author .a-av img { width:100%; height:100%; object-fit:cover; }
  .author .a-name { font-family:var(--font-display); font-size:17px; font-weight:700; line-height:1.2; }
  .author .a-user { font-size:12px; color:var(--muted); }
  .author .a-note { font-size:13.5px; line-height:1.5; color:var(--fg); margin:12px 0 0; }
  .author .follow { display:inline-flex; align-items:center; justify-content:center; gap:6px; margin-top:14px; width:100%; font:inherit; font-size:13px; font-weight:700; padding:8px 12px; border-radius:9px; cursor:pointer; border:1px solid var(--accent); background:var(--accent); color:#fff; text-decoration:none; }
  .author .follow.on { background:transparent; color:var(--fg); border-color:var(--line); }
  .author .follow.muted { background:transparent; color:var(--muted); border-color:var(--line); cursor:default; }
  .author .socials { display:flex; flex-wrap:wrap; gap:7px; margin-top:14px; }
  .author .soc { font-size:12px; font-weight:600; color:var(--muted); background:var(--hover); border:1px solid var(--line); border-radius:8px; padding:4px 9px; text-decoration:none; display:inline-flex; align-items:center; gap:5px; }
  .author .soc:hover { color:var(--fg); border-color:var(--accent); }
  .author .soc.discord b { color:var(--fg); font-weight:600; }

  .discussion h3 { font-family:var(--font-display); font-size:17px; margin:0 0 12px; }
  @media (max-width:960px) { .discussion { border-top:1px solid var(--line); padding-top:18px; } }
`;
  var GbtiReader = class extends GbtiElement {
    /** open(item): { type, path, title, author, publishedAt, url, visibility, thumb?, thumbCard?, thumbWide?,
     *  categoryLabels?, body?, encryptedBody? }. For share, body/encryptedBody come from the summary; for
     *  post/product/prompt they come from readItem(path). */
    open(item) {
      this._item = item;
      this._html = null;
      this._author = void 0;
      this.render();
      this._resolve();
    }
    async _resolve() {
      const it = this._item || {};
      const [html, author] = await Promise.all([this._resolveBody(it), this._resolveAuthor(it)]);
      this._html = html;
      this._author = author;
      this.render();
    }
    async _resolveBody(it) {
      try {
        if (it.type === "share") return await this._body(it.visibility, it.body, it.encryptedBody);
        const { frontmatter, body } = await this.client.readItem({ path: it.path });
        return await this._body(it.visibility, body, frontmatter?.encryptedBody);
      } catch {
        return { error: true };
      }
    }
    // Resolve the author drawer model: directory entry (avatar/name/headline/links), whether the viewer follows
    // them, and whether the viewer CAN follow (SOW-060: any signed-in member). House content yields a branded, non-followable card.
    async _resolveAuthor(it) {
      const username = lc6(it.author);
      if (isHouse(username)) return { house: true };
      const [dir, status2] = await Promise.all([
        loadDirectory(),
        this.client.status ? this.client.status().catch(() => null) : Promise.resolve(null)
      ]);
      const entry = dir.get(username) || null;
      const me = lc6(status2?.identity?.username || status2?.identity?.login);
      const canFollow = !!status2?.canFollow;
      let following = false;
      if (canFollow && this.client.getFollows) {
        try {
          const f = await this.client.getFollows();
          const list = Array.isArray(f) ? f : f?.following ?? [];
          following = list.some((x) => lc6(x.username) === username);
        } catch {
        }
      }
      return { house: false, username, entry, canFollow, following, isSelf: !!me && me === username };
    }
    // Render the public body via preview, then append the members part (decrypt -> preview) or a locked notice.
    async _body(visibility, publicBody, encPath) {
      let html = publicBody ? (await this.client.preview({ body: publicBody }))?.html ?? "" : "";
      if (encPath) {
        try {
          const { text } = await this.client.decrypt({ encPath });
          html += (await this.client.preview({ body: text }))?.html ?? "";
        } catch (err) {
          const locked = err?.code === "membership-required" || err?.code === "not-authenticated";
          html += locked ? lockNotice("This part") : `<p class="muted">Could not load the members-only part right now.</p>`;
        }
      }
      if (!html && visibility === "members") html = lockNotice("This");
      return html;
    }
    _metaHtml(it, when) {
      const t = TYPE_LABEL4[it.type] || it.type || "";
      const name = authorName4(it.author);
      const avUrl = this._author?.entry?.avatar || githubAvatar(it.author);
      const ini = esc((name || "?").trim().charAt(0).toUpperCase() || "?");
      const av = `<span class="av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span>`;
      const cats = Array.isArray(it.categoryLabels) && it.categoryLabels.length ? `<span class="cats">${it.categoryLabels.map((c) => `<span class="cat">${esc(c)}</span>`).join("")}</span>` : "";
      const slug = it.type === "share" ? "" : targetSlugFor(it);
      const HEART = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 20.3S3.6 15.2 3.6 9.5A4 4 0 0 1 12 7.3a4 4 0 0 1 8.4 2.2c0 5.7-8.4 10.8-8.4 10.8z"/></svg>';
      const COLL = '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 7h11M4 12h9M4 17h6"/><path d="M17 13.5v6M14 16.5h6"/></svg>';
      const acts = slug ? `<span class="m-actions"><gbti-favorite data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}" data-gbti-region="favorite"><button type="button" class="m-act" aria-label="Favorite">${HEART}</button></gbti-favorite><gbti-collection data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"><button type="button" class="m-act" aria-label="Add to collection">${COLL}</button></gbti-collection></span>` : "";
      return `<div class="meta"><span class="badge">${esc(t)}</span><span class="who">${av}<b>${esc(name)}</b></span>${when ? `<span>· ${esc(dateStr(when))}</span>` : ""}${cats}${acts}</div>`;
    }
    _authorCardHtml(it) {
      const a = this._author;
      if (!a || a.house) {
        return `<div class="author"><div class="a-top"><span class="a-av"><img src="${esc(githubAvatar("gbti"))}" alt=""></span><div><div class="a-name">GBTI Network</div><div class="a-user">The co-op</div></div></div><p class="a-note">Articles, products, and prompts from the GBTI Network co-op.</p></div>`;
      }
      const e = a.entry || {};
      const name = e.displayName || it.author;
      const avUrl = e.avatar || githubAvatar(it.author);
      const ini = esc((name || "?").trim().charAt(0).toUpperCase() || "?");
      const note = e.headline ? `<p class="a-note">${esc(e.headline)}</p>` : "";
      let follow = "";
      if (a.isSelf) follow = "";
      else if (a.canFollow) follow = `<button class="follow${a.following ? " on" : ""}" data-follow type="button">${a.following ? "Following" : "Follow"}</button>`;
      else follow = `<a class="follow muted" href="${SITE10}/membership/" target="_blank" rel="noopener" title="Members can follow other members">Follow</a>`;
      const links = e.links || {};
      const chips = [];
      for (const [key, label, base] of SOCIALS) {
        const url = linkUrl(links[key], base);
        if (url) chips.push(`<a class="soc" href="${esc(url)}" target="_blank" rel="noopener nofollow">${esc(label)}</a>`);
      }
      if (links.discord) {
        const handle = String(links.discord).trim();
        chips.push(`<span class="soc discord" title="Discord: ${esc(handle)}">Discord <b>${esc(handle)}</b></span>`);
      }
      const socials = chips.length ? `<div class="socials">${chips.join("")}</div>` : "";
      return `<div class="author"><div class="a-top"><span class="a-av">${avUrl ? `<img src="${esc(avUrl)}" alt="">` : ini}</span><div><div class="a-name">${esc(name)}</div><div class="a-user">@${esc(it.author)}</div></div></div>${note}${follow}${socials}</div>`;
    }
    render() {
      const it = this._item;
      if (!it) {
        this.set(this.css(CSS30));
        return;
      }
      const view = it.type === "share" ? it.url ? `<a class="view" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">Read article on ${esc(hostOf2(it.url))}</a>` : "" : it.url ? `<a class="view" href="${esc(SITE10 + it.url)}" target="_blank" rel="noopener">View on gbti.network</a>` : "";
      const when = it.publishedAt ?? (it.createdAt ? Date.parse(it.createdAt) : null);
      const meta = this._metaHtml(it, when);
      const coverUrl = resolveAsset(it.thumbWide || it.thumbCard || it.thumb);
      const cover = coverUrl ? `<img class="cover" src="${esc(coverUrl)}" alt="" loading="lazy">` : "";
      let body;
      if (this._html === null) body = `<p class="muted">Loading...</p>`;
      else if (this._html && this._html.error) body = `<p class="muted">Could not load this content. Try opening it on gbti.network.</p>`;
      else body = `<div class="body">${typeof this._html === "string" ? this._html : ""}</div>`;
      const resolved = this._html !== null;
      const slug = targetSlugFor(it);
      const discussion = resolved && slug ? `<section class="discussion"><h3>Discussion</h3><gbti-discussion data-gbti-target-type="${esc(it.type)}" data-gbti-target-slug="${esc(slug)}"></gbti-discussion></section>` : "";
      const side = resolved ? `<aside class="side">${this._authorCardHtml(it)}${discussion}</aside>` : '<aside class="side"></aside>';
      const shareUpvote = it.type === "share" && slug && this._author && !this._author.isSelf ? `<div class="share-actions" style="margin-top:12px"><gbti-upvote data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-upvote></div>` : "";
      this.set(this.css(CSS30) + `<div class="wrap"><div class="cols"><article><h1>${esc(it.title || "")}</h1>${meta}${cover}${body}${view}${shareUpvote}</article>${side}</div></div>`);
      if (resolved) {
        this._enhanceCode();
        this._wireFollow(it);
      }
    }
    // SOW-050: upgrade each <pre> code block into a code card (language label + Copy button). Idempotent per render.
    _enhanceCode() {
      this.$$(".body pre").forEach((pre) => {
        const code = pre.querySelector("code");
        const lang = code && code.dataset && code.dataset.lang || "";
        const card = document.createElement("div");
        card.className = "codecard";
        const bar = document.createElement("div");
        bar.className = "codebar";
        const tag = document.createElement("span");
        tag.className = "codelang";
        tag.textContent = lang || "code";
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "copybtn";
        btn.textContent = "Copy";
        btn.addEventListener("click", async () => {
          try {
            await navigator.clipboard.writeText(code ? code.innerText : pre.innerText);
            btn.textContent = "Copied";
            setTimeout(() => {
              btn.textContent = "Copy";
            }, 1200);
          } catch {
            btn.textContent = "Copy failed";
            setTimeout(() => {
              btn.textContent = "Copy";
            }, 1200);
          }
        });
        bar.append(tag, btn);
        pre.replaceWith(card);
        card.append(bar, pre);
      });
    }
    // Toggle follow in place (no full re-render, which would remount the discussion). Optimistic; reverts on error.
    _wireFollow(it) {
      const btn = this.$("[data-follow]");
      if (!btn || !this.client.setFollow) return;
      btn.addEventListener("click", async () => {
        const want = !btn.classList.contains("on");
        btn.disabled = true;
        btn.classList.toggle("on", want);
        btn.textContent = want ? "Following" : "Follow";
        try {
          await this.client.setFollow({ username: it.author, on: want });
          if (this._author) this._author.following = want;
        } catch {
          btn.classList.toggle("on", !want);
          btn.textContent = !want ? "Following" : "Follow";
        } finally {
          btn.disabled = false;
        }
      });
    }
  };
  define("gbti-reader", GbtiReader);

  // client-ui/src/browse-filter-core.mjs
  function segChips(items, depth, underPrimary) {
    const map = /* @__PURE__ */ new Map();
    for (const it of Array.isArray(items) ? items : []) {
      const cats = Array.isArray(it && it.categories) ? it.categories : [];
      if (depth === 1 && cats[0] !== underPrimary) continue;
      const key = cats[depth];
      if (typeof key !== "string" || !key) continue;
      const labels = Array.isArray(it && it.categoryLabels) ? it.categoryLabels : [];
      const label = typeof labels[depth] === "string" && labels[depth] || key;
      const cur = map.get(key) || { key, label, count: 0 };
      cur.count += 1;
      map.set(key, cur);
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }
  function primaryChips(items) {
    return segChips(items, 0);
  }
  function subChips(items, primaryKey) {
    return primaryKey ? segChips(items, 1, primaryKey) : [];
  }
  function filterByCategoryPath(items, path) {
    const p = (Array.isArray(path) ? path : []).filter((s) => typeof s === "string" && s);
    const list = Array.isArray(items) ? items : [];
    if (!p.length) return list;
    return list.filter((it) => {
      const cats = Array.isArray(it && it.categories) ? it.categories : [];
      return p.every((seg, i) => cats[i] === seg);
    });
  }

  // client-ui/src/elements/gbti-browse.mjs
  var SITE11 = "https://gbti.network";
  var TABS2 = [
    { id: "all", label: "All" },
    { id: "post", label: "Articles", json: "blog-index.json" },
    { id: "product", label: "Products", json: "products-index.json" },
    { id: "prompt", label: "Prompts", json: "prompts-index.json" },
    { id: "share", label: "Shares" },
    { id: "news", label: "News" }
    // SOW-043: a self-loading members-only feed (not a per-type index)
  ];
  var CONTENT_TYPES = ["post", "product", "prompt"];
  var CSS31 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 2px; border-top:1px solid var(--line); cursor:pointer; }
  .row:first-child { border-top:0; }
  .row:hover { background:var(--hover); }
  .row .thumb { flex:none; width:46px; height:46px; object-fit:cover; border-radius:8px; background:var(--hover); border:1px solid var(--line); }
  /* Category-glyph fallback (no image): a rounded square with the category accent gradient + a white glyph,
     matching the main app's PromptCard .kglyph. --ka is set inline per row from cat-glyph.mjs. */
  .row .thumb.glyph { display:flex; align-items:center; justify-content:center; border:0; color:#fff;
    background:linear-gradient(145deg, color-mix(in srgb, var(--ka) 66%, white), var(--ka)); }
  .row .thumb.glyph svg { width:24px; height:24px; }
  .row .t { min-width:0; flex:1; }
  .row .t b { display:block; font-size:15px; }
  .row .t .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .row .go { flex:none; color:var(--accent); font-size:13px; font-weight:700; }
  .empty { color:var(--muted); padding:18px 2px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; margin:0 0 14px; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  /* SOW-054: the category drill-down chip rows (primary, then subcategory when a primary is selected). */
  .cchips { display:flex; flex-wrap:wrap; gap:6px; margin:0 0 12px; }
  .cchips.sub { margin-top:-4px; }
  .cchip { font:inherit; font-size:12.5px; font-weight:600; color:var(--muted); background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:5px 12px; cursor:pointer; }
  .cchip:hover { color:var(--fg); border-color:var(--accent); }
  .cchip.on { color:#fff; background:var(--accent); border-color:var(--accent); }
  .cchip .n { opacity:.7; font-variant-numeric:tabular-nums; margin-left:4px; }
`;
  var GbtiBrowse = class extends GbtiElement {
    connectedCallback() {
      const { tab, read } = parseBrowseHash(typeof location !== "undefined" ? location.hash : "");
      this._tab = tab && TABS2.some((t) => t.id === tab) ? tab : "all";
      this._openPath = this._tab !== "share" && this._tab !== "all" && this._tab !== "news" ? read : null;
      this._cache = {};
      this._cat = [];
      this._shares = null;
      this._membership = null;
      this._reading = null;
      super.connectedCallback?.();
      this.root?.addEventListener("error", (e) => {
        const t = e.target;
        if (t && t.tagName === "IMG" && t.classList?.contains("thumb")) t.style.display = "none";
      }, true);
      this._onHash = () => {
        const { tab: tab2, read: read2 } = parseBrowseHash(typeof location !== "undefined" ? location.hash : "");
        const t = tab2 && TABS2.some((x) => x.id === tab2) ? tab2 : this._tab;
        if (read2 && t !== "share" && t !== "all" && t !== "news") {
          this._tab = t;
          this._reading = (this._cache[t] || []).find((x) => x.path === read2) || { type: t, path: read2 };
          this.render();
          this._ensure(t);
          return;
        }
        if (t !== this._tab || this._reading) {
          this._tab = t;
          this._cat = [];
          this._reading = null;
          this.render();
          this._ensureTab(t);
        }
      };
      if (typeof window !== "undefined") window.addEventListener("hashchange", this._onHash);
      this._init();
    }
    disconnectedCallback() {
      if (this._onHash && typeof window !== "undefined") window.removeEventListener("hashchange", this._onHash);
      super.disconnectedCallback?.();
    }
    // Load the active tab's index, then (if deep-linked via read=<path>) open that item in the reader.
    async _init() {
      await this._ensureTab(this._tab);
      if (this._openPath) {
        const found = (this._cache[this._tab] || []).find((x) => x.path === this._openPath);
        this._reading = found || { type: this._tab, path: this._openPath };
        this._openPath = null;
        this.render();
      }
    }
    // Route a tab to its loader: 'all' fans out across the per-type indexes + Shares, every other tab loads its index.
    _ensureTab(id) {
      return id === "all" ? this._ensureAll() : this._ensure(id);
    }
    async _ensure(id) {
      const tab = TABS2.find((t) => t.id === id);
      if (!tab?.json || this._cache[id]) return;
      try {
        const res = await fetch(`${SITE11}/${tab.json}`, { cache: "no-cache" });
        this._cache[id] = res.ok ? (await res.json()).items || [] : [];
      } catch {
        this._cache[id] = [];
      }
      if (this._tab === id && !this._reading && !this._openPath) this.render();
    }
    // SOW-042: the All directory. Load the three per-type indexes IN PARALLEL, then (once) the member's Shares —
    // gated by effective status so a Locked/unknown account never sees Shares. Each source fails soft to [].
    async _ensureAll() {
      await Promise.all(CONTENT_TYPES.map((t) => this._ensure(t)));
      if (this._shares === null) {
        try {
          const st = await this.client?.status?.();
          this._membership = st?.membership ?? "unknown";
        } catch {
          this._membership = "unknown";
        }
        if (canSeeShares(this._membership)) {
          try {
            this._shares = (await this.client.listShares())?.items ?? [];
          } catch {
            this._shares = [];
          }
        } else {
          this._shares = [];
        }
      }
      if (this._tab === "all" && !this._reading && !this._openPath) this.render();
    }
    // The merged, newest-first directory items, or null while any per-type index / the Shares read is still pending.
    _allItems() {
      const ready = CONTENT_TYPES.every((t) => this._cache[t]);
      if (!ready || this._shares === null) return null;
      const items = CONTENT_TYPES.flatMap((t) => this._cache[t] || []);
      return mergeAll({ items, shares: this._shares, membership: this._membership });
    }
    render() {
      if (this._reading) {
        const label = TABS2.find((t) => t.id === this._reading.type)?.label || "list";
        this.set(this.css(CSS31) + `<button class="btn" data-back type="button">&larr; Back to ${esc(label)}</button><div data-reader></div>`);
        this.on("[data-back]", "click", () => {
          this._reading = null;
          this.render();
          this._ensureTab(this._tab);
        });
        const host = this.$("[data-reader]");
        const r = document.createElement("gbti-reader");
        host.replaceChildren(r);
        r.open(this._reading);
        return;
      }
      const tabs = TABS2.map((t) => `<button class="tab ${t.id === this._tab ? "on" : ""}" data-tab="${t.id}" type="button">${esc(t.label)}</button>`).join("");
      this.set(this.css(CSS31) + `<div class="tabs" role="tablist">${tabs}</div><div data-body></div>`);
      this.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        this._tab = b.dataset.tab;
        this._cat = [];
        this.render();
        this._ensureTab(this._tab);
      }));
      this._renderBody();
    }
    // SOW-041/042: the content tabs (incl. the All directory) render through the shared <gbti-card-list>; clicking a
    // card opens it IN PLACE in the reader (the card has no openHref, so it emits card-open). The Shares tab keeps its
    // existing authenticated feed. All == the per-type indexes + Shares merged newest-first (SOW-042).
    _renderBody() {
      const host = this.$("[data-body]");
      if (!host) return;
      if (this._tab === "share") {
        host.replaceChildren(document.createElement("gbti-shares-feed"));
        return;
      }
      if (this._tab === "news") {
        host.replaceChildren(document.createElement("gbti-news"));
        return;
      }
      const items = this._tab === "all" ? this._allItems() : this._cache?.[this._tab];
      if (!items) {
        host.innerHTML = `<p class="empty">Loading...</p>`;
        return;
      }
      const cat = this._cat || [];
      const primaries = primaryChips(items);
      const primaryLabel = (primaries.find((p) => p.key === cat[0]) || {}).label || cat[0] || "";
      const chipRow = (chips, depth, allLabel) => `<div class="cchips${depth ? " sub" : ""}"><button class="cchip ${cat.length === depth ? "on" : ""}" data-cat="${depth}" type="button">${esc(allLabel)}</button>` + chips.map((c) => `<button class="cchip ${cat[depth] === c.key ? "on" : ""}" data-cat="${depth}" data-key="${esc(c.key)}" type="button">${esc(c.label)}<span class="n">${c.count}</span></button>`).join("") + `</div>`;
      let chrome2 = "";
      if (primaries.length) {
        chrome2 += chipRow(primaries, 0, "All");
        const subs = cat.length ? subChips(items, cat[0]) : [];
        if (subs.length) chrome2 += chipRow(subs, 1, `All ${primaryLabel}`);
      }
      host.innerHTML = chrome2 + `<div data-list></div>`;
      host.querySelectorAll("[data-cat]").forEach((b) => b.addEventListener("click", () => {
        const depth = Number(b.dataset.cat);
        this._cat = "key" in b.dataset ? cat.slice(0, depth).concat(b.dataset.key) : cat.slice(0, depth);
        this._renderBody();
      }));
      const list = document.createElement("gbti-card-list");
      list.mode = "detailed";
      list.items = filterByCategoryPath(items, cat);
      list.addEventListener("card-open", (e) => {
        const it = e.detail?.item;
        if (it) {
          this._reading = it;
          this.render();
        }
      });
      (host.querySelector("[data-list]") || host).replaceChildren(list);
    }
  };
  define("gbti-browse", GbtiBrowse);

  // client-ui/src/elements/gbti-app.mjs
  var TABS3 = [
    { id: "author", label: "Author", tag: "gbti-content-editor" },
    { id: "shares", label: "Shares", tag: "gbti-shares" },
    // SOW-018: composer + co-op reading feed (extension/client-only)
    { id: "content", label: "My Content", tag: "gbti-content-list" },
    { id: "prs", label: "PRs", tag: "gbti-pr-list" },
    { id: "members", label: "Members-only", tag: "gbti-members-portal" },
    { id: "settings", label: "Settings", tag: "gbti-settings" },
    { id: "admin", label: "Admin", tag: "gbti-admin", minRole: "moderator" }
  ];
  var RANK4 = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
  var GbtiApp = class extends GbtiElement {
    constructor() {
      super();
      this.active = "author";
      this.role = "member";
    }
    async render() {
      if (!this.client) {
        this.set(this.css() + `<div class="panel muted">Connecting…</div>`);
        return;
      }
      try {
        this.role = (await this.client.status())?.role ?? "member";
      } catch {
        this.role = "member";
      }
      const tabs = TABS3.filter((t) => !t.minRole || RANK4[this.role] >= RANK4[t.minRole]);
      const active = tabs.find((t) => t.id === this.active) ? this.active : "author";
      this.set(
        this.css(`
        header { display:flex; align-items:center; justify-content:space-between; padding:14px 0; }
        header h1 { font-size:20px; } header h1 span { color: var(--brand); }
        nav { display:flex; gap:4px; flex-wrap:wrap; border-bottom:1px solid var(--line); margin-bottom:16px; }
        nav button { background:transparent; color:var(--muted); border:0; border-bottom:2px solid transparent; padding:9px 14px; font-weight:500; }
        nav button.active { color:var(--text); border-bottom-color: var(--brand); }
        .wrap { max-width: 860px; margin: 0 auto; }
      `) + `<div class="wrap">
           <header><h1>GBTI <span>Network</span> · local CMS</h1></header>
           <gbti-auth></gbti-auth>
           <nav>${tabs.map((t) => `<button data-id="${t.id}" class="${t.id === active ? "active" : ""}">${esc(t.label)}</button>`).join("")}</nav>
           <div id="pane"></div>
         </div>`
      );
      const pane = this.$("#pane");
      const el = document.createElement(tabs.find((t) => t.id === active).tag);
      if (active === "author") this.editor = el;
      pane.replaceChildren(el);
      this.$$("nav button").forEach(
        (b) => b.addEventListener("click", () => {
          this.active = b.dataset.id;
          this.render();
        })
      );
      this.addEventListener("gbti-edit", (e) => {
        this.active = "author";
        this.render();
        queueMicrotask(() => this.editor?.load?.(e.detail.type, e.detail.frontmatter, e.detail.body));
      });
    }
  };
  define("gbti-app", GbtiApp);

  // client-ui/src/client.mjs
  var GbtiClientError = class extends Error {
    constructor(code, message) {
      super(message || code);
      this.name = "GbtiClientError";
      this.code = code;
    }
  };
  function createHttpClient({ baseUrl = "", token, fetch: fetch2 = globalThis.fetch } = {}) {
    async function request(method, path, body) {
      const headers = { Authorization: `Bearer ${token}` };
      const init2 = { method, headers };
      if (body !== void 0) {
        headers["Content-Type"] = "application/json";
        init2.body = JSON.stringify(body);
      }
      const res = await fetch2(`${baseUrl}${path}`, init2);
      let json = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }
      if (!res.ok) {
        throw new GbtiClientError(json?.error || `http-${res.status}`, json?.message || json?.error || `request failed (${res.status})`);
      }
      return json;
    }
    const qs = (params) => {
      const p = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) if (v != null && v !== "") p.set(k, String(v));
      const s = p.toString();
      return s ? `?${s}` : "";
    };
    return {
      status: () => request("GET", "/api/status"),
      listContent: ({ type } = {}) => request("GET", `/api/content${qs({ type })}`),
      getContentItem: ({ path }) => request("GET", `/api/content/item${qs({ path })}`),
      readItem: ({ path }) => request("GET", `/api/read${qs({ path })}`),
      // SOW-031: read ANY published index.md for the in-extension reader -> { path, frontmatter, body }
      validateContent: (b) => request("POST", "/api/validate", b),
      publish: (b) => request("POST", "/api/publish", b),
      postShare: (b) => request("POST", "/api/share", b),
      // SOW-018: returns { id, path, visibility, encrypted }
      listShares: ({ limit } = {}) => request("GET", `/api/shares${qs({ limit })}`),
      // SOW-018: returns { items: [share summaries] }
      listShareComments: ({ targetSlug, limit } = {}) => request("GET", `/api/share-comments${qs({ targetSlug, limit })}`),
      // SOW-032: a Share's discussion -> { items: [comment summaries] }
      listComments: ({ targetType, targetSlug, limit } = {}) => request("GET", `/api/comments${qs({ targetType, targetSlug, limit })}`),
      // SOW-041: the generic thread for any content type
      discordInvite: () => request("GET", "/api/discord-invite"),
      // on-demand Discord invite -> { url, source }
      getNews: ({ category, since, limit } = {}) => request("GET", `/api/news${qs({ category, since, limit })}`),
      // SOW-043: members-only news -> { items, updatedAt }
      getNewsSources: () => request("GET", "/api/news-sources"),
      // SOW-046: followable news channels -> { sources }
      getPrefs: () => request("GET", "/api/prefs"),
      // SOW-046: member prefs -> { categories, followedChannels }
      setPrefs: (patch) => request("POST", "/api/prefs", patch),
      // SOW-046: { categories } or { followChannel: { id, on } } -> { categories, followedChannels }
      publishNews: (item) => request("POST", "/api/news-publish", { item }),
      // SOW-046 C: curator-only "Add to Discord" -> { ok, posted }
      newsDiscussed: (guid) => request("POST", "/api/news-discussed", { guid }),
      // SOW-046 D: reflect discussion onto Discord -> { ok, reflected }
      postComment: (b) => request("POST", "/api/comment", b),
      // SOW-027: { targetType, targetSlug, body, authorNote?, parentId?, visibility? } -> { id, path }
      editComment: (b) => request("POST", "/api/comment/edit", b),
      // SOW-027: { id, body, authorNote? } -> { id, edited }
      getComment: ({ id }) => request("GET", `/api/comment${qs({ id })}`),
      // SOW-027: edit prefill -> { path, frontmatter, body }
      listPRs: () => request("GET", "/api/prs"),
      prStatus: ({ number }) => request("GET", `/api/pr-status${qs({ number })}`),
      listContributions: () => request("GET", "/api/contributions"),
      // SOW-028: incoming contributions to review -> { contributions: [...] }
      getContribution: ({ number }) => request("GET", `/api/contribution${qs({ number })}`),
      // SOW-028: one contribution's diff + proposed body
      reviewContribution: (b) => request("POST", "/api/contribution-review", b),
      // SOW-028: { number, decision: approve|request-changes|decline, message? }
      formFields: ({ type }) => request("GET", `/api/form-fields${qs({ type })}`),
      preview: ({ body }) => request("POST", "/api/preview", { body }),
      stageImage: (b) => request("POST", "/api/image", b),
      listMembersOnly: () => request("GET", "/api/members-content"),
      decrypt: ({ encPath }) => request("POST", "/api/member-decrypt", { encPath }),
      // SOW-016: returns { text }
      // SOW-024: favorites live in the deletable edge store (KV), NOT git. toggleFavorite SETS the favorite to
      // `on` via the activity store and derives the resulting `favorited` from the returned activity (no global
      // count: the public aggregate count comes from house/favorite-counts.yml on the next build).
      toggleFavorite: async ({ targetType, targetSlug, on }) => {
        const r = await request("POST", "/api/activity", { action: "favorite", targetType, targetSlug, on });
        const favs = r && r.activity && r.activity.favorites || [];
        return { favorited: favs.some((f) => f.type === targetType && f.slug === targetSlug) };
      },
      // SOW-057: upvote a share (effective-paid; two distinct non-author upvotes enqueue it for syndication). The
      // count is the live per-target distinct count returned by the Worker.
      toggleUpvote: async ({ targetType = "share", targetSlug, on }) => {
        const r = await request("POST", "/api/upvote", { type: targetType, slug: targetSlug, on });
        return { upvoted: !!r?.upvoted, count: r?.upvoteCount };
      },
      // SOW-057: a link's OpenGraph preview ({ image, title, description }), fetched server-side (SSRF-guarded).
      ogPreview: ({ url }) => request("POST", "/api/og-preview", { url }),
      // SOW-024: member activity (favorites + collections) in the deletable edge store.
      getActivity: ({ types: types2 } = {}) => request("GET", `/api/activity${qs({ types: Array.isArray(types2) && types2.length ? types2.join(",") : void 0 })}`),
      // returns { favorites, collections }; SOW-050 P2 optional type filter
      createCollection: ({ name }) => request("POST", "/api/activity", { action: "collection.create", name }),
      // returns { id, activity }
      addToCollection: ({ id, targetType, targetSlug, on = true }) => request("POST", "/api/activity", { action: "collection.item", id, targetType, targetSlug, on }),
      // SOW-037: manage collections from the member's "Saved" view (the ops already support these actions).
      renameCollection: ({ id, name }) => request("POST", "/api/activity", { action: "collection.rename", id, name }),
      // returns { activity }
      deleteCollection: ({ id }) => request("POST", "/api/activity", { action: "collection.delete", id }),
      // returns { activity }
      // SOW-023: the follow graph (subscriptions) in the deletable edge store (paid-only).
      getFollows: () => request("GET", "/api/follows"),
      // returns { following: [{ username, addedAt }] }
      setFollow: ({ username, on = true }) => request("POST", "/api/follows", { username, on }),
      // returns { following }
      // SOW-026: first-run onboarding readiness (token/fork/install) from durable GitHub state.
      onboardingStatus: () => request("GET", "/api/onboarding-status"),
      // returns { appMode, signedIn, forkReady, installReady, activeStep, ready, ... }
      getSettings: () => request("GET", "/api/settings"),
      updateSettings: (patch) => request("POST", "/api/settings", patch),
      getBilling: () => request("GET", "/api/billing"),
      getReferral: () => request("GET", "/api/referral"),
      admin: (action, args = {}) => request("POST", "/api/admin", { action, ...args }),
      overrides: () => request("GET", "/api/overrides"),
      // SOW-038 P2: admin-gated roster { roster, summary }
      taxonomy: () => request("GET", "/api/taxonomy"),
      // SOW-055: the canonical category tree { tree } for the manager
      addCategory: ({ parentPath, key, label }) => request("POST", "/api/admin", { action: "category-add", parentPath, key, label }),
      // SOW-055
      renameCategory: ({ path, label }) => request("POST", "/api/admin", { action: "category-rename", path, label }),
      // SOW-055
      newsSourcePool: () => request("GET", "/api/news-source-pool"),
      // SOW-056 P2: the news-source pool { sources } for the manager
      addNewsSource: ({ id, name, url, description }) => request("POST", "/api/admin", { action: "news-source-add", id, name, url, description }),
      // SOW-056 P2
      removeNewsSource: ({ id }) => request("POST", "/api/admin", { action: "news-source-remove", id }),
      // SOW-056 P2
      setNewsSourceEnabled: ({ id, enabled }) => request("POST", "/api/admin", { action: "news-source-toggle", id, enabled }),
      // SOW-056 P2
      quotePool: () => request("GET", "/api/quote-pool"),
      // SOW-063 P3: the splash quote pool { quotes } for the manager
      addQuote: ({ text, author }) => request("POST", "/api/admin", { action: "quote-add", text, author }),
      // SOW-063 P3
      removeQuote: ({ text }) => request("POST", "/api/admin", { action: "quote-remove", text }),
      // SOW-063 P3
      setQuoteEnabled: ({ text, enabled }) => request("POST", "/api/admin", { action: "quote-toggle", text, enabled }),
      // SOW-063 P3
      openPulls: () => request("GET", "/api/open-pulls"),
      // SOW-038 P2: admin-gated open content-PR queue { pulls }
      syndicationQueue: () => request("GET", "/api/syndication"),
      // SOW-058: superadmin tracker { pending, sent, cancelled, failed }
      cancelSyndication: ({ id }) => request("POST", "/api/syndication/cancel", { id }),
      // SOW-058: superadmin reject/cancel
      approveSyndication: ({ id }) => request("POST", "/api/syndication/approve", { id }),
      // SOW-058: superadmin approve -> posts next drain tick
      adminOp: (action, params) => request("POST", "/api/admin-ops", params ? { action, params } : { action })
      // SOW-038 P3 (reconcile/e2e); SOW-055 category-migrate carries params
    };
  }

  // extension/src/onboarding.mjs
  var esc2 = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  async function messagingFetch(url, init2 = {}) {
    const u = new URL(url, "https://gbti.network");
    const req = {
      method: init2.method || "GET",
      pathname: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      body: init2.body ? JSON.parse(init2.body) : void 0
    };
    const result = await chrome.runtime.sendMessage({ type: "api", req });
    const r = result || { status: 500, json: { error: "no_response" } };
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.json };
  }
  var client = createHttpClient({ baseUrl: "", token: "extension", fetch: messagingFetch });
  client.login = (onPrompt) => new Promise((resolve, reject) => {
    const onMsg = (m) => {
      if (m?.type === "login-prompt") onPrompt?.({ userCode: m.userCode, verificationUri: m.verificationUri });
    };
    chrome.runtime.onMessage.addListener(onMsg);
    chrome.runtime.sendMessage({ type: "login" }).then((r) => {
      chrome.runtime.onMessage.removeListener(onMsg);
      r?.ok ? resolve(r) : reject(new Error(r?.error || "sign-in failed"));
    }).catch((e) => {
      chrome.runtime.onMessage.removeListener(onMsg);
      reject(e);
    });
  });
  setClient(client);
  var SITE12 = "https://gbti.network";
  var LOCKED5 = ["expired", "cancelled", "none", "banned"];
  async function status() {
    const r = await chrome.runtime.sendMessage({ type: "api", req: { method: "GET", pathname: "/api/status", query: {} } });
    return r?.json ?? null;
  }
  async function signOut() {
    await chrome.runtime.sendMessage({ type: "signout" });
    mount();
    refreshAccount();
  }
  async function refreshAccount() {
    const el = document.querySelector("[data-account]");
    if (!el) return;
    let s = null;
    try {
      s = await status();
    } catch {
      return;
    }
    const id = s?.identity;
    if (id && s.authenticated) {
      const lapsed = LOCKED5.includes(s.membership) ? ` Your membership has lapsed. <a href="${SITE12}/membership/" target="_blank" rel="noopener">Renew</a> to publish again.` : "";
      el.innerHTML = `Signed in as <strong>@${esc2(id.login)}</strong>. <button class="linkbtn" data-signout type="button">Sign out</button>${lapsed}`;
      el.querySelector("[data-signout]")?.addEventListener("click", signOut);
    } else {
      el.innerHTML = `Not a member yet? <a href="${SITE12}/membership/" target="_blank" rel="noopener">Join GBTI Network</a> to publish.`;
    }
  }
  function mount() {
    const app = document.getElementById("app");
    if (!app) return;
    const el = document.createElement("gbti-onboarding");
    app.replaceChildren(el);
    el.addEventListener("gbti:onboarding-signin", () => {
      client.login(({ userCode, verificationUri }) => el.setCode?.(userCode, verificationUri)).then(() => {
        el.refresh?.();
        refreshAccount();
      }).catch(() => el.setCode?.(null));
    });
    el.addEventListener("gbti:onboarding-ready", () => refreshAccount());
    el.addEventListener("gbti:onboarding-start", () => {
      const w = document.createElement("gbti-welcome");
      w.addEventListener("gbti:welcome-done", () => {
        window.location.href = chrome.runtime.getURL("newtab.html");
      });
      const shell = document.querySelector("main.shell");
      if (shell) {
        shell.style.gridTemplateColumns = "1fr";
        shell.replaceChildren(w);
      } else {
        (document.getElementById("app") || document.body).replaceChildren(w);
      }
    });
  }
  function init() {
    mount();
    refreshAccount();
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) refreshAccount();
    });
  }
  if (typeof document !== "undefined" && typeof chrome !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
  }
})();
