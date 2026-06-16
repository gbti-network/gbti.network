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
    if (!HAS_DOM || customElements.get(tag)) return;
    customElements.define(tag, ctor);
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
      let status = null;
      try {
        status = await this.client.status();
      } catch {
      }
      const id = status?.identity ?? null;
      const role = status?.role ?? "member";
      const authed = Boolean(status?.authenticated);
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

  // client-ui/src/elements/gbti-content-editor.mjs
  var TYPES = ["post", "product", "prompt", "profile"];
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
      this.set(
        this.css(`
        .grid { display: grid; gap: 2px; }
        .actions { display:flex; gap:10px; margin-top:14px; flex-wrap:wrap; }
        #out { margin-top:12px; }
        .preview { background:#201e26; border:1px solid var(--line); border-radius:8px; padding:12px 14px; }
        .notice { background:#2a2330; border:1px solid var(--accent); border-radius:8px; padding:10px 14px; margin-bottom:12px; }
        .notice a { color: var(--accent); }
      `) + `<div class="panel">
           <h2>Author</h2>
           ${blocked ? `<div class="notice">Publishing requires a paid membership. You can write and stage your work now; it stays on your fork until you upgrade. <a href="https://gbti.network" target="_blank" rel="noopener">Upgrade to publish</a>.</div>` : ""}
           <label>Type</label>
           <select id="type">${TYPES.map((t) => `<option ${t === this.type ? "selected" : ""}>${t}</option>`).join("")}</select>
           <div class="grid" id="fields">${this.fields.map((f) => this.fieldHtml(f, p[f.key], this.fieldVisible(f, (k) => this.presetStr(p[k])))).join("")}</div>
           <label>Body (Markdown)</label>
           <textarea id="body">${esc(this.preset?.body ?? "")}</textarea>
           <div class="actions">
             <button id="preview" class="ghost">Preview</button>
             <button id="validate" class="ghost">Validate</button>
             <button id="publish"${blocked ? ' title="Publishing requires a paid membership"' : ""}>${blocked ? "Membership required to publish" : "Publish (open PR)"}</button>
             <input type="file" id="img" accept="image/*" style="display:none" />
             <button id="imgbtn" class="ghost">Add image</button>
           </div>
           <div id="out" class="muted"></div>
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
      const status = it.status ? `<span class="tag ${it.status === "published" ? "ok" : ""}">${esc(it.status)}</span>` : "";
      const vis = it.visibility === "members" ? `<span class="tag">members</span>` : "";
      return `<li class="row" style="justify-content:space-between">
      <span><strong>${esc(it.title)}</strong> <span class="muted">${esc(it.type || "")}</span> ${status} ${vis}</span>
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
      const del = referral?.delegation ?? {};
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
           <p class="muted">Set <code>delegation</code> on a post/product/prompt to share up to ${Math.round((del.contributionCap ?? 0.07) * 100)}% with contributors and ${Math.round((del.commentCap ?? 0.03) * 100)}% with commenters. Default: you keep 100%.</p>
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
          this.out(`<span class="tag ok">PR opened</span> <a href="${esc(res.prUrl)}" target="_blank" rel="noopener">#${esc(res.prNumber)}</a>`);
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
  var CSS = `
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
        this.css(CSS) + `<button class="pill ${this._faved ? "on" : ""}" type="button" aria-pressed="${this._faved}" aria-label="${label}">${heart(this._faved)}${c > 0 ? `<span class="c">${c}</span>` : ""}</button>`
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
  var CSS2 = `
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
      this.set(this.css(CSS2) + `<button class="pill ${this._inAny() ? "on" : ""}" type="button" aria-haspopup="true" aria-expanded="${!!this._open}" aria-label="${label}">${folder}<span>Save</span></button>${open}`);
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
  var CSS3 = `
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
        this.css(CSS3) + `<button class="btn ${onCls}" type="button" aria-pressed="${following}" ${username ? "" : "disabled"} aria-label="${label}">${mega}<span class="t">${label}</span></button>`
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
  var LOCKED = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var CSS4 = `
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
      if (!this.client) return this.set(this.css(CSS4) + this._noticeHtml("Open in the GBTI client", "Shares are posted from the GBTI browser extension or the desktop client. Open it to share an update.", "🧩"));
      if (m === void 0) return this.set(this.css(CSS4) + `<div class="card"><p class="sub">Loading…</p></div>`);
      if (LOCKED.has(m)) return this._renderLocked();
      if (m === "trialing") return this._renderTrial();
      return this._renderComposer();
    }
    _noticeHtml(title, body, glyph) {
      return `<div class="notice"><span class="lock">${glyph}</span><div><h3>${esc(title)}</h3><p class="sub" style="margin:0">${body}</p></div></div>`;
    }
    _renderLocked() {
      this.set(this.css(CSS4) + this._noticeHtml(
        "Your access is locked",
        'Your membership has lapsed, so Shares are locked. <a href="https://gbti.network/membership/">Renew your membership</a> to read and post in the community stream again.',
        "🔒"
      ));
    }
    _renderTrial() {
      this.set(this.css(CSS4) + this._noticeHtml(
        "Reading only on the free trial",
        'On the trial you can READ the community Shares stream. Posting Shares is a paid feature. <a href="https://gbti.network/membership/">Upgrade your membership</a> to post.',
        "👀"
      ));
    }
    _renderComposer() {
      this.set(this.css(CSS4) + `
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
        <div class="actions">
          <span class="msg" aria-live="polite"></span>
          <button class="post" type="button">Post Share</button>
        </div>
      </div>`);
      this.on(".post", "click", () => this._post());
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
        const res = await this.client.postShare({ input, body });
        this._say(msg, res?.encrypted ? "Posted (members-only)." : "Posted.", "ok");
        for (const sel of ["input.title", "input.desc", "textarea", "input[type=url]"]) {
          const el = this.$(sel);
          if (el) el.value = "";
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

  // client-ui/src/elements/gbti-shares-feed.mjs
  var LOCKED2 = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var CSS5 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .head { display:flex; align-items:baseline; justify-content:space-between; margin:4px 0 12px; }
  .head h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-size:16px; }
  .refresh { background:transparent; border:0; color:var(--muted); cursor:pointer; font:inherit; font-size:13px; }
  .refresh:hover { color:var(--brand); }
  .feed { display:flex; flex-direction:column; gap:12px; }
  .share { border:1px solid var(--line); border-radius:12px; padding:14px 16px; background:var(--panel); }
  .who { display:flex; align-items:baseline; gap:8px; }
  .who .name { font-weight:700; font-size:14px; }
  .who .when { color:var(--muted); font-size:12px; }
  .badge { margin-left:auto; font-size:10.5px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .title { font-weight:700; margin-top:8px; }
  .desc { color:var(--muted); font-size:13px; margin-top:2px; }
  .body { margin-top:6px; font-size:14px; line-height:1.55; }
  .body :is(h1,h2,h3,h4){ font-weight:700; margin:.8em 0 .3em; }
  .body p { margin:0 0 .7em; } .body ul,.body ol { margin:0 0 .7em 1.2em; }
  .body a { color:var(--accent, var(--brand)); }
  .body pre { background:var(--bg, rgba(0,0,0,.05)); padding:10px; border-radius:8px; overflow:auto; }
  .link { display:inline-flex; align-items:center; gap:6px; margin-top:8px; font-size:12.5px; color:var(--brand); text-decoration:none; }
  .tags { margin-top:8px; display:flex; gap:6px; flex-wrap:wrap; }
  .chip { font-size:11px; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 8px; }
  .muted { color:var(--muted); font-size:13.5px; }
  .locked { color:var(--muted); font-size:13.5px; } .locked a { color:var(--brand); font-weight:600; }
  .splash { text-align:center; padding:40px 16px; }
  .splash .lock { font-size:30px; } .splash h3 { margin:10px 0 4px; } .splash a { color:var(--brand); font-weight:600; }
  /* SOW-032 discussion */
  .foot { margin-top:10px; display:flex; }
  .discuss { background:transparent; border:0; padding:0; color:var(--muted); cursor:pointer; font:inherit; font-size:12.5px; }
  .discuss:hover { color:var(--brand); }
  .discussion { margin-top:10px; border-top:1px solid var(--line); padding-top:10px; }
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
  function relTime(iso) {
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
  var authorName = (a) => a === "gbti" ? "GBTI Network" : a || "A member";
  var GbtiSharesFeed = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback();
      this._onPosted = () => this.reload();
      document.addEventListener("gbti-share-posted", this._onPosted);
      this._onComment = (e) => {
        const slug = e?.detail?.targetSlug;
        if (slug) this._reloadOpenThread(slug);
      };
      document.addEventListener("gbti-comment-posted", this._onComment);
      document.addEventListener("gbti-comment-edited", this._onComment);
      this.reload();
    }
    disconnectedCallback() {
      super.disconnectedCallback();
      if (this._onPosted) document.removeEventListener("gbti-share-posted", this._onPosted);
      if (this._onComment) {
        document.removeEventListener("gbti-comment-posted", this._onComment);
        document.removeEventListener("gbti-comment-edited", this._onComment);
      }
    }
    async reload() {
      if (!this.client) {
        this.set(this.css(CSS5) + `<p class="muted">Open in the GBTI client to read Shares.</p>`);
        return;
      }
      this.set(this.css(CSS5) + `<p class="muted">Loading the co-op stream…</p>`);
      let membership = "unknown";
      try {
        membership = (await this.client.status())?.membership ?? "unknown";
      } catch {
        membership = "unknown";
      }
      if (LOCKED2.has(membership)) return this._splash();
      let items = [];
      try {
        items = (await this.client.listShares())?.items ?? [];
      } catch {
        this.set(this.css(CSS5) + `<p class="muted">Could not load Shares right now.</p>`);
        return;
      }
      if (!items.length) {
        this._render([]);
        return;
      }
      const resolved = await Promise.all(items.map((it) => this._resolveBody(it).then((html) => ({ it, html }))));
      this._render(resolved);
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
      this.set(this.css(CSS5) + `<div class="splash"><div class="lock">🔒</div><h3>Your access is locked</h3>
      <p class="muted">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to read the community Shares stream again.</p></div>`);
    }
    _render(rows) {
      const head = `<div class="head"><h3>Co-op stream</h3><button class="refresh" type="button">Refresh</button></div>`;
      if (!rows.length) {
        this.set(this.css(CSS5) + head + `<p class="muted">No Shares yet. Post the first one above.</p>`);
        this.on(".refresh", "click", () => this.reload());
        return;
      }
      const cards = rows.map(({ it, html }) => {
        const bodyHtml = html && html.locked ? `<div class="locked">This Share is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>` : typeof html === "string" && html ? `<div class="body">${html}</div>` : "";
        const link = it.url ? `<a class="link" href="${esc(it.url)}" target="_blank" rel="noopener nofollow">🔗 ${esc(hostOf(it.url))}</a>` : "";
        const tags = (it.tags || []).length ? `<div class="tags">${it.tags.map((t) => `<span class="chip">#${esc(t)}</span>`).join("")}</div>` : "";
        const badge = it.visibility === "members" ? `<span class="badge">Members</span>` : "";
        const title = it.title ? `<div class="title">${esc(it.title)}</div>` : "";
        const desc = it.shortDescription ? `<div class="desc">${esc(it.shortDescription)}</div>` : "";
        const slug = it.author && it.id ? `${it.author}/${it.id}` : "";
        const foot = slug ? `<div class="foot"><button class="discuss" type="button" data-slug="${esc(slug)}" aria-expanded="false">💬 Discuss</button></div>
           <div class="discussion" data-slug="${esc(slug)}" hidden></div>` : "";
        return `<article class="share">
        <div class="who"><span class="name">${esc(authorName(it.author))}</span><span class="when">${esc(relTime(it.createdAt))}</span>${badge}</div>
        ${title}${desc}${bodyHtml}${link}${tags}${foot}
      </article>`;
      }).join("");
      this.set(this.css(CSS5) + head + `<div class="feed">${cards}</div>`);
      this.on(".refresh", "click", () => this.reload());
      for (const btn of this.$$(".discuss")) {
        btn.addEventListener("click", () => this._toggleDiscussion(btn));
      }
    }
    /** Toggle one Share's discussion panel; lazy-load the thread on first open. */
    _toggleDiscussion(btn) {
      const slug = btn.getAttribute("data-slug");
      const panel = this.$(`.discussion[data-slug="${cssEscape(slug)}"]`);
      if (!panel) return;
      const open = panel.hasAttribute("hidden") === false;
      if (open) {
        panel.setAttribute("hidden", "");
        btn.setAttribute("aria-expanded", "false");
        btn.textContent = panel.dataset.count ? `💬 Discuss (${panel.dataset.count})` : "💬 Discuss";
        return;
      }
      panel.removeAttribute("hidden");
      btn.setAttribute("aria-expanded", "true");
      this._loadThread(slug);
    }
    /** Reload an OPEN thread in place (after a reply is posted/edited); no-op if its panel is collapsed/absent. */
    _reloadOpenThread(slug) {
      const panel = this.$(`.discussion[data-slug="${cssEscape(slug)}"]`);
      if (panel && !panel.hasAttribute("hidden")) this._loadThread(slug);
    }
    async _loadThread(slug) {
      const panel = this.$(`.discussion[data-slug="${cssEscape(slug)}"]`);
      if (!panel) return;
      if (!this.client) {
        panel.innerHTML = `<p class="empty">Open in the GBTI client to read the discussion.</p>`;
        return;
      }
      if (!panel.dataset.loaded) panel.innerHTML = `<p class="empty">Loading the discussion…</p>`;
      let items = [];
      try {
        items = (await this.client.listShareComments({ targetSlug: slug }))?.items ?? [];
      } catch {
        panel.innerHTML = `<p class="empty">Could not load the discussion right now.</p>` + this._composeHtml(slug);
        this._mountCompose(panel);
        return;
      }
      const resolved = await Promise.all(items.map((c) => this._resolveCommentBody(c).then((html) => ({ c, html }))));
      this._renderThread(panel, slug, resolved);
      panel.dataset.count = String(items.length);
      panel.dataset.loaded = "1";
      const btn = this.$(`.discuss[data-slug="${cssEscape(slug)}"]`);
      if (btn) btn.textContent = `💬 Discuss (${items.length})`;
    }
    _renderThread(panel, slug, rows) {
      const thread = rows.map(({ c, html }) => {
        const reply = c.parentId ? " reply" : "";
        const badge = c.visibility === "members" ? `<span class="cbadge">Members</span>` : "";
        const bodyHtml = html && html.locked ? `<div class="clocked">This reply is for members. <a href="https://gbti.network/membership/">Become a member</a> to unlock.</div>` : typeof html === "string" && html ? `<div class="cbody">${html}</div>` : "";
        return `<div class="comment${reply}">
        <div class="cmeta"><span class="cname">${esc(authorName(c.author))}</span><span class="cwhen">${esc(relTime(c.createdAt))}</span>${badge}</div>
        ${bodyHtml}
      </div>`;
      }).join("");
      const threadHtml = rows.length ? `<div class="thread">${thread}</div>` : `<p class="empty">No replies yet. Start the conversation.</p>`;
      panel.innerHTML = threadHtml + this._composeHtml(slug);
      this._mountCompose(panel);
    }
    // A fresh <gbti-comment-box> for this Share (the element handles its own paid/trial/visitor gating UX).
    _composeHtml(slug) {
      return `<gbti-comment-box data-gbti-target-type="share" data-gbti-target-slug="${esc(slug)}"></gbti-comment-box>`;
    }
    // The injected client is process-global (getClient), so a <gbti-comment-box> placed in this shadow tree
    // upgrades and talks to the same host; nothing to wire here. Kept as a seam for future per-thread wiring.
    _mountCompose() {
    }
    async _resolveCommentBody(c) {
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
  function hostOf(u) {
    try {
      return new URL(u).hostname.replace(/^www\./, "");
    } catch {
      return "link";
    }
  }
  function cssEscape(s) {
    return String(s ?? "").replace(/["\\]/g, "\\$&");
  }
  define("gbti-shares-feed", GbtiSharesFeed);

  // client-ui/src/elements/gbti-shares.mjs
  var CSS6 = `
  :host { display:block; }
  .stack { display:flex; flex-direction:column; gap:20px; }
  hr { border:0; border-top:1px solid var(--line); margin:0; }
`;
  var GbtiShares = class extends GbtiElement {
    render() {
      this.set(this.css(CSS6) + `<div class="stack">
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
      const lc2 = c | 32;
      if (lc2 >= 97 && lc2 <= 102) return lc2 - 97 + 10;
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
  var RANK2 = Object.freeze({ member: 0, moderator: 1, admin: 2, superadmin: 3 });

  // client/src/membership.mjs
  var STAFF = /* @__PURE__ */ new Set([ROLE.moderator, ROLE.admin, ROLE.superadmin]);
  var LOCKED_MEMBERSHIP = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  function isLockedMembership(membership) {
    return LOCKED_MEMBERSHIP.has(membership);
  }

  // client-ui/src/elements/gbti-lock-gate.mjs
  var CSS7 = `
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
      this.set(this.css(CSS7) + `<div class="checking">Checking your membership…</div>`);
      let membership = "unknown";
      try {
        membership = (await this.client?.status())?.membership ?? "unknown";
      } catch {
        membership = "unknown";
      }
      if (isLockedMembership(membership)) {
        this.set(this.css(CSS7) + `<div class="splash">
        <div class="lock">🔒</div>
        <h2>Your access is locked</h2>
        <p>Your GBTI membership has lapsed, so the extension is locked. Renew to rejoin the co-op, read the
           community stream, and publish again.</p>
        <a class="cta" href="https://gbti.network/membership/">Renew membership</a>
      </div>`);
        return;
      }
      this.set(this.css(CSS7) + `<slot></slot>`);
    }
  };
  define("gbti-lock-gate", GbtiLockGate);

  // client-ui/src/elements/gbti-comment-box.mjs
  var LOCKED3 = /* @__PURE__ */ new Set(["expired", "cancelled", "none", "banned"]);
  var CSS8 = `
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
  select, label.chk { font: inherit; font-size: 13px; color: var(--muted); }
  select { padding: 7px 9px; border: 1.5px solid var(--line); border-radius: 8px; background: var(--panel); color: var(--fg); }
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
    get _target() {
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
        this.set(this.css(CSS8) + "");
        return;
      }
      this.set(this.css(CSS8) + `<button class="edit" type="button">Edit</button>`);
      this.on(".edit", "click", () => this._openEdit());
    }
    async _openEdit() {
      this.set(this.css(CSS8) + `<p class="msg">Loading…</p>`);
      let body = "";
      try {
        body = (await this.client.getComment({ id: this._editId }))?.body ?? "";
      } catch {
        this.set(this.css(CSS8) + `<p class="msg err">Could not load the comment.</p><button class="edit" type="button">Retry</button>`);
        this.on(".edit", "click", () => this._openEdit());
        return;
      }
      this._form({ body, edit: true });
    }
    // ---- COMPOSE mode ----
    _renderCompose() {
      if (LOCKED3.has(this._membership)) {
        this.set(this.css(CSS8) + `<div class="nudge">Your membership has lapsed. <a href="https://gbti.network/membership/">Renew</a> to comment.</div>`);
        return;
      }
      if (this._membership === "trialing") {
        this.set(this.css(CSS8) + `<div class="nudge">Commenting is a paid feature. <a href="https://gbti.network/membership/">Upgrade</a> to join the conversation.</div>`);
        return;
      }
      if (!this._identity) {
        this.set(this.css(CSS8) + `<div class="nudge">Sign in with the GBTI client to comment. <a href="https://gbti.network/membership/">Become a member</a>.</div>`);
        return;
      }
      this.set(this.css(CSS8) + `<button class="open" type="button">Write a comment</button>`);
      this.on(".open", "click", () => this._form({ body: "", edit: false }));
    }
    _form({ body, edit }) {
      const visibilityRow = edit ? "" : `<select aria-label="Visibility"><option value="public">Public</option><option value="members">Members only</option></select>`;
      this.set(this.css(CSS8) + `
      <div class="form">
        <textarea placeholder="Write your comment (markdown supported)…" maxlength="8000">${esc(body)}</textarea>
        <div class="row">
          ${visibilityRow}
          <label class="chk"><input type="checkbox" data-authornote /> Mark as my author note</label>
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
      const visibility = this.$("select")?.value || "public";
      const authorNote = !!this.$("[data-authornote]")?.checked;
      wrap?.classList.add("busy");
      try {
        const t = this._target();
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
      const authorNote = !!this.$("[data-authornote]")?.checked;
      wrap?.classList.add("busy");
      try {
        const res = await this.client.editComment({ id: this._editId, body, authorNote });
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

  // client-ui/src/elements/gbti-onboarding.mjs
  var STEP_IDS = ["signin", "fork", "install"];
  var check = (filled) => `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="${filled ? "var(--brand)" : "none"}" stroke="${filled ? "var(--brand)" : "var(--line)"}" stroke-width="2"/>${filled ? '<path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>' : ""}</svg>`;
  var BTN_ICON = {
    signin: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z"/></svg>`,
    fork: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M5 5.372v.878c0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75v-.878a2.25 2.25 0 1 1 1.5 0v.878a2.25 2.25 0 0 1-2.25 2.25h-1.5v2.128a2.251 2.251 0 1 1-1.5 0V8.5h-1.5A2.25 2.25 0 0 1 3.5 6.25v-.878a2.25 2.25 0 1 1 1.5 0ZM5 3.25a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Zm6.75.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5Zm-3 8.75a.75.75 0 1 0-1.5 0 .75.75 0 0 0 1.5 0Z"/></svg>`,
    install: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="currentColor"><path d="M8 0c.265 0 .529.06.77.179l5.5 2.75A1.75 1.75 0 0 1 15 4.493v3.32c0 4.142-2.957 6.83-6.66 7.998a1.12 1.12 0 0 1-.68 0C3.957 14.643 1 11.955 1 7.813v-3.32a1.75 1.75 0 0 1 .73-1.564l5.5-2.75A1.71 1.71 0 0 1 8 0Zm3.28 6.53a.75.75 0 0 0-1.06-1.06L7.25 8.44 5.78 6.97a.75.75 0 0 0-1.06 1.06l2 2a.75.75 0 0 0 1.06 0Z"/></svg>`
  };
  var CSS9 = `
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
        this.set(this.css(CSS9) + `<p class="note">Checking your setup...</p>`);
        return;
      }
      if (s.ready) {
        this.set(this.css(CSS9) + `<div class="ready">${check(true)}<div class="big">You are ready to publish</div>
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
      this.set(this.css(CSS9) + `
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

  // client-ui/src/elements/gbti-welcome.mjs
  var SITE = "https://gbti.network";
  var PAGE_SIZE = 10;
  var DISCORD_DONE_KEY = "gbti-welcome-discord-joined";
  var lc = (s) => String(s || "").toLowerCase();
  var check2 = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  var discordIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.3.5c1.4.4 2 .8 2.8 1.3a11 11 0 0 0-8.9 0c.8-.5 1.5-.9 2.8-1.3L11.2 4A17 17 0 0 0 7 5.4C4.3 9.3 3.6 13.1 3.9 16.8a16 16 0 0 0 4.8 2.4l.6-1c-.5-.2-1-.5-1.6-.9l.4-.3a11 11 0 0 0 9.6 0l.4.3c-.5.4-1 .7-1.6.9l.6 1a16 16 0 0 0 4.8-2.4c.4-4.3-.6-8-2.6-11.4zM9.6 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>`;
  var megaIco = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="margin-right:6px"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V6.5L6 10H4a1 1 0 0 0-1 1zM14 8v8c1.7-.6 3-2.4 3-4s-1.3-3.4-3-4z" fill="currentColor"/></svg>`;
  var CSS10 = `
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
  .fbtn.on:hover { border-color:var(--danger); color:var(--danger); }
  .pager { display:flex; align-items:center; justify-content:space-between; margin-top:13px; }
  .pager button { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-size:13px; padding:6px 12px; cursor:pointer; }
  .pager button[disabled] { opacity:.4; cursor:default; }
  .pager .pg { font-size:12.5px; color:var(--muted); font-variant-numeric:tabular-nums; }
  .note { color:var(--muted); font-size:12.5px; line-height:1.5; margin:0; }
  .note a { color:var(--accent); }
  .done { width:100%; box-sizing:border-box; margin-top:6px; padding:12px; }
  .loading { color:var(--muted); text-align:center; padding:30px 0; }
`;
  var GbtiWelcome = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this._page = 1;
      this.load();
    }
    async load() {
      try {
        const s = await this.client?.status?.();
        this._membership = s?.membership ?? "unknown";
        this._own = lc(s?.identity?.username || s?.identity?.login);
      } catch {
        this._membership = "unknown";
        this._own = "";
      }
      try {
        const res = await fetch(`${SITE}/members-index.json`, { cache: "no-cache" });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        this._members = excludeSelf(shuffle(Array.isArray(data?.members) ? data.members : []), this._own);
      } catch {
        this._members = null;
      }
      try {
        const r = await this.client?.getFollows?.();
        const list = Array.isArray(r) ? r : r?.following ?? [];
        this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
      } catch {
        this._follows = null;
      }
      try {
        this._discordJoined = localStorage.getItem(DISCORD_DONE_KEY) === "1";
      } catch {
        this._discordJoined = false;
      }
      this._loaded = true;
      this.render();
    }
    render() {
      if (!this._loaded) {
        this.set(this.css(CSS10) + `<p class="loading">Setting up your welcome...</p>`);
        return;
      }
      const ph = phaseLabel(this._membership);
      const up = ph.upgrade ? `<a class="up" href="${SITE}/membership/" target="_blank" rel="noopener">Upgrade to publish</a>` : "";
      this.set(this.css(CSS10) + `
      <div class="head">
        <span class="ic">${check2}</span>
        <div class="phase">${esc(ph.phase === "paid" ? "Paid membership" : ph.phase === "trial" ? "Trial phase" : "Welcome")}</div>
        <h2>${esc(ph.title)}</h2>
        <p>${esc(ph.body)}</p>
        ${up}
      </div>
      ${this._discordCard()}
      ${this._followCard()}
      <button class="btn done" data-done type="button">I am all set</button>`);
      this.on("[data-discord-join]", "click", () => window.open(DISCORD_INVITE_URL, "_blank", "noopener"));
      const cb = this.$("[data-discord-cb]");
      if (cb) cb.addEventListener("change", () => {
        this._discordJoined = cb.checked;
        try {
          cb.checked ? localStorage.setItem(DISCORD_DONE_KEY, "1") : localStorage.removeItem(DISCORD_DONE_KEY);
        } catch {
        }
      });
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
      this.on("[data-done]", "click", () => this.emit("gbti:welcome-done"));
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
    _followCard() {
      const note = `<p class="note">Following a member alerts you when they publish new articles, prompts, and products (in your Following feed).</p>`;
      if (this._follows === null) {
        return `<div class="card"><h3>${megaIco} Follow members</h3>
        <p class="sub">Following members is a paid feature.</p>${note}
        <p class="note" style="margin-top:10px"><a href="${SITE}/membership/" target="_blank" rel="noopener">Upgrade</a> to follow members and build your feed.</p></div>`;
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
      const u = lc(m.username);
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
      const u = lc(username);
      if (!u || !this._follows) return;
      const was = this._follows.has(u);
      was ? this._follows.delete(u) : this._follows.add(u);
      this.render();
      try {
        const r = await this.client.setFollow({ username: u, on: !was });
        const list = Array.isArray(r) ? r : r?.following ?? null;
        if (list) this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
      } catch {
        was ? this._follows.add(u) : this._follows.delete(u);
      }
      this.render();
    }
  };
  define("gbti-welcome", GbtiWelcome);

  // client-ui/src/workspace-core.mjs
  function classifyPull(pr = {}, status = null) {
    if (pr.merged === true || pr.state === "merged") return { label: "Accepted", tone: "ok" };
    if (pr.state === "closed") return { label: "Declined", tone: "muted" };
    switch (status?.state) {
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

  // client-ui/src/elements/gbti-workspace.mjs
  var TABS = [
    { id: "post", label: "Articles", type: "post" },
    { id: "prompt", label: "Prompts", type: "prompt" },
    { id: "product", label: "Products", type: "product" },
    { id: "prs", label: "Pull requests" }
  ];
  var CSS11 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  .profile { display:flex; align-items:center; gap:10px; border:1px solid var(--line); border-radius:12px; padding:11px 14px; margin:0 0 14px; background:var(--panel); font-size:14px; }
  .profile .lbl { color:var(--muted); font-size:12px; }
  .profile button { margin-left:auto; }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:11px 2px; border-top:1px solid var(--line); }
  .row:first-child { border-top:0; }
  .row .t { min-width:0; overflow:hidden; }
  .row .t b { display:block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12.5px; }
  .tag { display:inline-block; padding:2px 8px; border-radius:999px; background:var(--hover); font-size:11.5px; color:var(--muted); white-space:nowrap; }
  .tag.ok { background:rgba(31,158,95,.14); color:var(--accent); }
  .tag.bad { background:rgba(224,108,108,.16); color:var(--danger); }
  .btn { flex:none; border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
  .right { display:flex; align-items:center; gap:8px; flex:none; }
  .muted { color:var(--muted); }
  .empty { color:var(--muted); padding:18px 2px; }
  .back { margin:0 0 14px; }
  a { color:var(--accent); }
`;
  var GbtiWorkspace = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      this._tab = "post";
      this._cache = {};
      this._prs = null;
      this._editing = null;
      this.render();
      this._loadProfile();
      this._ensureTab("post");
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
      if (tab.type && !this._cache[tab.type]) {
        try {
          this._cache[tab.type] = (await this.client?.listContent?.({ type: tab.type }))?.items ?? [];
        } catch {
          this._cache[tab.type] = [];
        }
      } else if (id === "prs" && !this._prs) {
        try {
          this._prs = (await this.client?.listPRs?.())?.prs ?? [];
        } catch {
          this._prs = [];
        }
      }
      if (this._tab === id && !this._editing) this.render();
      if (id === "prs") this._loadPrStatuses();
    }
    _loadPrStatuses() {
      for (const pr of this._prs || []) {
        if (pr.merged === true || pr.state === "closed" || pr.state === "merged") this._renderPrLabel(pr, null);
        else this._loadPrStatus(pr.number);
      }
    }
    async _loadPrStatus(number) {
      let status = null;
      try {
        status = await this.client?.prStatus?.({ number });
      } catch {
      }
      const pr = (this._prs || []).find((p) => p.number === number);
      if (pr) this._renderPrLabel(pr, status);
    }
    _renderPrLabel(pr, status) {
      const tag = this.$(`.gate[data-n="${pr.number}"]`);
      if (!tag) return;
      const { label, tone } = classifyPull(pr, status);
      tag.className = `gate tag ${tone}`;
      tag.textContent = label;
      if (status?.description) tag.title = status.description;
    }
    // ----- rendering -----
    render() {
      if (this._editing) {
        this.set(this.css(CSS11) + `<button class="btn back" data-back type="button">&larr; Back to my work</button><gbti-content-editor></gbti-content-editor>`);
        this.on("[data-back]", "click", () => {
          this._editing = null;
          this.render();
        });
        const ed = this.$("gbti-content-editor");
        const e = this._editing;
        if (ed?.load) ed.load(e.type, e.frontmatter, e.body);
        return;
      }
      const tabs = TABS.map((t) => `<button class="tab ${t.id === this._tab ? "on" : ""}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}</button>`).join("");
      this.set(this.css(CSS11) + `${this._profileHtml()}<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
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
      if (this._tab === "prs") {
        const prs = this._prs;
        if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
        if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
        return `<ul class="rows">${prs.map((pr) => `<li class="row">
        <span class="t"><b>${esc(pr.title || "PR #" + pr.number)}</b><span class="meta"><a href="${esc(pr.html_url || "#")}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub</span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`).join("")}</ul>`;
      }
      const items = this._cache[tab.type];
      if (!items) return `<p class="empty">Loading...</p>`;
      if (items.length === 0) return `<p class="empty">No ${esc(tab.label.toLowerCase())} yet.</p>`;
      return `<ul class="rows">${items.map((it, i) => {
        const status = it.status ? `<span class="tag ${it.status === "published" ? "ok" : ""}">${esc(it.status)}</span>` : "";
        const vis = it.visibility === "members" ? `<span class="tag">members</span>` : "";
        return `<li class="row"><span class="t"><b>${esc(it.title)}</b><span class="meta">${esc(it.type || "")}</span></span>
        <span class="right">${status} ${vis}<button class="btn" data-edit="${i}" type="button">Open</button></span></li>`;
      }).join("")}</ul>`;
    }
    _wireBody() {
      this.on("[data-profile]", "click", () => this._openItem(this._profile?.path, "profile"));
      const tab = TABS.find((t) => t.id === this._tab);
      if (tab?.type) {
        this.$$("[data-edit]").forEach((b) => b.addEventListener("click", () => {
          const it = (this._cache[tab.type] || [])[Number(b.dataset.edit)];
          if (it) this._openItem(it.path, it.type);
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

  // client-ui/src/elements/gbti-reader.mjs
  var SITE2 = "https://gbti.network";
  var authorName2 = (a) => a === "gbti" ? "GBTI Network" : a;
  var TYPE_LABEL = { post: "Article", product: "Product", prompt: "Prompt", share: "Share" };
  var dateStr = (ms) => {
    try {
      return ms ? new Date(ms).toLocaleDateString(void 0, { year: "numeric", month: "long", day: "numeric" }) : "";
    } catch {
      return "";
    }
  };
  var lockNotice = (what) => `<div class="locked">${esc(what)} is for members. <a href="${SITE2}/membership/" target="_blank" rel="noopener">Become a member</a> to unlock.</div>`;
  var CSS12 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  article { max-width:680px; margin:0 auto; }
  h1 { font-family:var(--font-display); font-size:28px; line-height:1.2; margin:0 0 8px; }
  .meta { color:var(--muted); font-size:13px; margin:0 0 18px; display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  .badge { font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.04em; color:var(--accent); background:var(--hover); border-radius:999px; padding:2px 9px; }
  .body { font-size:15.5px; line-height:1.7; }
  .body h1,.body h2,.body h3 { font-family:var(--font-display); margin:1.4em 0 .5em; }
  .body p { margin:0 0 1em; }
  .body pre { background:var(--hover); padding:12px 14px; border-radius:10px; overflow:auto; }
  .body code { font-family:ui-monospace,monospace; font-size:.92em; }
  .body a { color:var(--accent); }
  .body img { max-width:100%; height:auto; border-radius:10px; }
  .locked { border:1px solid var(--line); background:var(--hover); border-radius:10px; padding:14px 16px; color:var(--fg); font-size:14px; margin:14px 0; }
  .locked a { color:var(--accent); }
  .muted { color:var(--muted); }
  .view { display:inline-block; margin-top:22px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }
`;
  var GbtiReader = class extends GbtiElement {
    /** open(item): { type, path, title, author, publishedAt, url, visibility, body?, encryptedBody? }.
     *  For share, body/encryptedBody come from the summary; for post/product/prompt they come from readItem(path). */
    open(item) {
      this._item = item;
      this._html = null;
      this.render();
      this._resolve();
    }
    async _resolve() {
      const it = this._item || {};
      try {
        if (it.type === "share") {
          this._html = await this._body(it.visibility, it.body, it.encryptedBody);
        } else {
          const { frontmatter, body } = await this.client.readItem({ path: it.path });
          this._html = await this._body(it.visibility, body, frontmatter?.encryptedBody);
        }
      } catch {
        this._html = { error: true };
      }
      this.render();
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
    render() {
      const it = this._item;
      if (!it) {
        this.set(this.css(CSS12));
        return;
      }
      const t = TYPE_LABEL[it.type] || it.type || "";
      const view = it.url ? `<a class="view" href="${esc(SITE2 + it.url)}" target="_blank" rel="noopener">View on gbti.network</a>` : "";
      const meta = `<div class="meta"><span class="badge">${esc(t)}</span><span>${esc(authorName2(it.author))}</span>${it.publishedAt ? `<span>· ${esc(dateStr(it.publishedAt))}</span>` : ""}</div>`;
      let body;
      if (this._html === null) body = `<p class="muted">Loading...</p>`;
      else if (this._html && this._html.error) body = `<p class="muted">Could not load this content. Try opening it on gbti.network.</p>`;
      else body = `<div class="body">${typeof this._html === "string" ? this._html : ""}</div>`;
      this.set(this.css(CSS12) + `<article><h1>${esc(it.title || "")}</h1>${meta}${body}${view}</article>`);
    }
  };
  define("gbti-reader", GbtiReader);

  // client-ui/src/elements/gbti-browse.mjs
  var SITE3 = "https://gbti.network";
  var TABS2 = [
    { id: "post", label: "Blog", json: "blog-index.json" },
    { id: "product", label: "Products", json: "products-index.json" },
    { id: "prompt", label: "Prompts", json: "prompts-index.json" },
    { id: "share", label: "Shares" }
  ];
  var authorName3 = (a) => a === "gbti" ? "GBTI Network" : a;
  var CSS13 = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .tabs { display:flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:999px; padding:4px; margin:0 0 16px; flex-wrap:wrap; }
  .tab { border:0; background:transparent; color:var(--muted); font:inherit; font-weight:700; font-size:13px; padding:7px 15px; border-radius:999px; cursor:pointer; }
  .tab.on { background:var(--hover); color:var(--accent); }
  ul.rows { list-style:none; margin:0; padding:0; }
  .row { display:flex; align-items:center; justify-content:space-between; gap:12px; padding:13px 2px; border-top:1px solid var(--line); cursor:pointer; }
  .row:first-child { border-top:0; }
  .row:hover { background:var(--hover); }
  .row .t { min-width:0; }
  .row .t b { display:block; font-size:15px; }
  .row .t .ex { display:block; color:var(--muted); font-size:13px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .row .t .meta { color:var(--muted); font-size:12px; margin-top:2px; }
  .row .go { flex:none; color:var(--accent); font-size:13px; font-weight:700; }
  .empty { color:var(--muted); padding:18px 2px; }
  .btn { border:1px solid var(--line); background:var(--panel); color:var(--fg); border-radius:8px; font:inherit; font-weight:600; font-size:13px; padding:6px 13px; cursor:pointer; margin:0 0 14px; }
  .btn:hover { border-color:var(--accent); color:var(--accent); }
`;
  var GbtiBrowse = class extends GbtiElement {
    connectedCallback() {
      super.connectedCallback?.();
      const m = (typeof location !== "undefined" ? location.hash : "").match(/tab=([a-z]+)/);
      this._tab = m && TABS2.some((t) => t.id === m[1]) ? m[1] : "post";
      this._cache = {};
      this._reading = null;
      this.render();
      this._ensure(this._tab);
    }
    async _ensure(id) {
      const tab = TABS2.find((t) => t.id === id);
      if (!tab?.json || this._cache[id]) return;
      try {
        const res = await fetch(`${SITE3}/${tab.json}`, { cache: "no-cache" });
        this._cache[id] = res.ok ? (await res.json()).items || [] : [];
      } catch {
        this._cache[id] = [];
      }
      if (this._tab === id && !this._reading) this.render();
    }
    render() {
      if (this._reading) {
        const label = TABS2.find((t) => t.id === this._reading.type)?.label || "list";
        this.set(this.css(CSS13) + `<button class="btn" data-back type="button">&larr; Back to ${esc(label)}</button><div data-reader></div>`);
        this.on("[data-back]", "click", () => {
          this._reading = null;
          this.render();
          this._ensure(this._tab);
        });
        const host = this.$("[data-reader]");
        const r = document.createElement("gbti-reader");
        host.replaceChildren(r);
        r.open(this._reading);
        return;
      }
      const tabs = TABS2.map((t) => `<button class="tab ${t.id === this._tab ? "on" : ""}" data-tab="${t.id}" type="button">${esc(t.label)}</button>`).join("");
      this.set(this.css(CSS13) + `<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
      this.$$("[data-tab]").forEach((b) => b.addEventListener("click", () => {
        this._tab = b.dataset.tab;
        this.render();
        this._ensure(this._tab);
      }));
      if (this._tab !== "share") {
        this.$$("[data-open]").forEach((el) => el.addEventListener("click", () => {
          const it = (this._cache[this._tab] || [])[Number(el.dataset.open)];
          if (it) {
            this._reading = it;
            this.render();
          }
        }));
      }
    }
    _body() {
      if (this._tab === "share") return `<gbti-shares-feed></gbti-shares-feed>`;
      const items = this._cache[this._tab];
      if (!items) return `<p class="empty">Loading...</p>`;
      if (!items.length) return `<p class="empty">Nothing here yet.</p>`;
      return `<ul class="rows">${items.map((it, i) => `<li class="row" data-open="${i}">
      <span class="t"><b>${esc(it.title)}</b>${it.excerpt ? `<span class="ex">${esc(it.excerpt)}</span>` : ""}<span class="meta">${esc(authorName3(it.author))}${it.visibility === "members" ? " · members" : ""}</span></span>
      <span class="go">Read &rarr;</span></li>`).join("")}</ul>`;
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
  var RANK3 = { member: 0, moderator: 1, admin: 2, superadmin: 3 };
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
      const tabs = TABS3.filter((t) => !t.minRole || RANK3[this.role] >= RANK3[t.minRole]);
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
      const init = { method, headers };
      if (body !== void 0) {
        headers["Content-Type"] = "application/json";
        init.body = JSON.stringify(body);
      }
      const res = await fetch2(`${baseUrl}${path}`, init);
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
      postComment: (b) => request("POST", "/api/comment", b),
      // SOW-027: { targetType, targetSlug, body, authorNote?, parentId?, visibility? } -> { id, path }
      editComment: (b) => request("POST", "/api/comment/edit", b),
      // SOW-027: { id, body, authorNote? } -> { id, edited }
      getComment: ({ id }) => request("GET", `/api/comment${qs({ id })}`),
      // SOW-027: edit prefill -> { path, frontmatter, body }
      listPRs: () => request("GET", "/api/prs"),
      prStatus: ({ number }) => request("GET", `/api/pr-status${qs({ number })}`),
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
      // SOW-024: member activity (favorites + collections) in the deletable edge store.
      getActivity: () => request("GET", "/api/activity"),
      // returns { favorites, collections }
      createCollection: ({ name }) => request("POST", "/api/activity", { action: "collection.create", name }),
      // returns { id, activity }
      addToCollection: ({ id, targetType, targetSlug, on = true }) => request("POST", "/api/activity", { action: "collection.item", id, targetType, targetSlug, on }),
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
      admin: (action, args = {}) => request("POST", "/api/admin", { action, ...args })
    };
  }

  // extension/src/identity-signal.mjs
  function buildMemberSignal(status) {
    if (!status || typeof status !== "object") return null;
    const id = status.identity;
    if (!status.authenticated || !id) return null;
    return {
      authenticated: true,
      login: typeof id.login === "string" ? id.login : null,
      githubId: id.githubId != null ? String(id.githubId) : null,
      username: typeof id.username === "string" ? id.username : null,
      role: typeof status.role === "string" ? status.role : "member",
      membership: typeof status.membership === "string" ? status.membership : "unknown",
      canPublish: status.canPublish === true
    };
  }

  // extension/src/content.mjs
  async function messagingFetch(url, init = {}) {
    const u = new URL(url, "https://gbti.network");
    const req = {
      method: init.method || "GET",
      pathname: u.pathname,
      query: Object.fromEntries(u.searchParams.entries()),
      body: init.body ? JSON.parse(init.body) : void 0
    };
    const result = await chrome.runtime.sendMessage({ type: "api", req });
    const r = result || { status: 500, json: { error: "no_response" } };
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.json
    };
  }
  var client = createHttpClient({ baseUrl: "", token: "extension", fetch: messagingFetch });
  client.login = (onPrompt) => new Promise((resolve, reject) => {
    const onPromptMsg = (m) => {
      if (m?.type === "login-prompt") onPrompt({ userCode: m.userCode, verificationUri: m.verificationUri });
    };
    chrome.runtime.onMessage.addListener(onPromptMsg);
    chrome.runtime.sendMessage({ type: "login" }).then((r) => {
      chrome.runtime.onMessage.removeListener(onPromptMsg);
      if (r?.ok) resolve(r);
      else reject(new Error(r?.error || "sign-in failed"));
    }).catch((e) => {
      chrome.runtime.onMessage.removeListener(onPromptMsg);
      reject(e);
    });
  });
  setClient(client);
  try {
    const version = chrome.runtime.getManifest().version;
    document.documentElement.dataset.gbtiExtension = version;
    document.dispatchEvent(new CustomEvent("gbti:extension-ready", { detail: { version } }));
    document.addEventListener("gbti:request-signin", () => {
      document.dispatchEvent(new CustomEvent("gbti:open-auth"));
    });
  } catch {
  }
  async function stampMemberSignal() {
    try {
      const r = await chrome.runtime.sendMessage({ type: "api", req: { method: "GET", pathname: "/api/status", query: {} } });
      const signal = buildMemberSignal(r?.json);
      if (signal) document.documentElement.dataset.gbtiMember = JSON.stringify(signal);
      else delete document.documentElement.dataset.gbtiMember;
      document.dispatchEvent(new CustomEvent("gbti:identity", { detail: signal }));
    } catch {
    }
  }
  try {
    stampMemberSignal();
    chrome.runtime.onMessage.addListener((m) => {
      if (m?.type === "auth-changed") stampMemberSignal();
    });
  } catch {
  }
})();
