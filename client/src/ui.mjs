// The CMS browser UI (SOW-006), served by the hardened local server at `/`. Dependency-free, single page,
// tabbed: Author, My Content, PRs, Members-only, Settings, Billing, Referrals, and (role-gated) Admin. It
// captures the per-install token from its own URL (?token=...) once, strips it from the address bar, and
// uses the Bearer header for every /api call. Thin presentation over the same operations the MCP + CLI use;
// the SOW-005 gate stays authoritative. Richer per-type forms + local preview iterate on these routes.

export const UI_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>GBTI Network — local CMS</title>
<style>
  :root { --bg:#25232b; --panel:#2f2d37; --ink:#1f1f1e; --brand:#45c08d; --brand-dark:#37a074; --text:#e8e6ee; --muted:#a8a5b2; --line:#3a3743; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:15px/1.5 "Open Sans",system-ui,sans-serif; }
  header { display:flex; align-items:center; justify-content:space-between; padding:14px 22px; background:#1f1d24; border-bottom:1px solid var(--line); }
  header h1 { font-size:18px; margin:0; font-weight:700; } header h1 span { color:var(--brand); }
  .who { font-size:13px; color:var(--muted); }
  nav { display:flex; gap:4px; flex-wrap:wrap; padding:10px 22px 0; background:#1f1d24; border-bottom:1px solid var(--line); }
  nav button { background:transparent; color:var(--muted); border:0; border-bottom:2px solid transparent; padding:9px 14px; cursor:pointer; font:inherit; }
  nav button.active { color:var(--text); border-bottom-color:var(--brand); }
  nav button.hidden { display:none; }
  main { max-width:920px; margin:0 auto; padding:22px; }
  .pane { display:none; } .pane.active { display:grid; gap:18px; }
  .panel { background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:18px 20px; }
  .panel h2 { margin:0 0 12px; font-size:14px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); }
  label { display:block; font-size:13px; color:var(--muted); margin:10px 0 4px; }
  input, select, textarea { width:100%; padding:9px 11px; background:#26242c; border:1px solid #44414e; border-radius:8px; color:var(--text); font:inherit; }
  textarea { min-height:120px; resize:vertical; font-family:ui-monospace,monospace; }
  .row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
  button.act { background:var(--brand); color:var(--ink); border:0; border-radius:999px; padding:9px 18px; font-weight:600; cursor:pointer; }
  button.sec { background:transparent; color:var(--text); border:1px solid #55525f; border-radius:999px; padding:9px 18px; cursor:pointer; }
  button.act:hover { background:var(--brand-dark); }
  .actions { margin-top:14px; display:flex; gap:10px; flex-wrap:wrap; }
  ul { list-style:none; margin:0; padding:0; } li { padding:8px 0; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:12px; }
  li:last-child { border-bottom:0; }
  .tag { font-size:12px; padding:2px 8px; border-radius:999px; background:var(--line); color:var(--muted); }
  .tag.mergeable { background:#1f4a37; color:var(--brand); } .tag.held { background:#4a2b2b; color:#f0a6a6; }
  .msg { margin-top:10px; font-size:13px; min-height:18px; } .msg.err { color:#f0a6a6; } .msg.ok { color:var(--brand); }
  a { color:var(--brand); } code { background:#26242c; padding:2px 6px; border-radius:6px; font-size:12px; word-break:break-all; }
  .mono { font-family:ui-monospace,monospace; }
</style>
</head>
<body>
<header>
  <h1><span>GBTI</span> Network · local CMS</h1>
  <div class="who" id="who">…</div>
</header>
<nav id="tabs">
  <button data-tab="author" class="active">Author</button>
  <button data-tab="content">My Content</button>
  <button data-tab="prs">PRs</button>
  <button data-tab="members">Members-only</button>
  <button data-tab="settings">Settings</button>
  <button data-tab="billing">Billing</button>
  <button data-tab="referrals">Referrals</button>
  <button data-tab="admin" class="hidden">Admin</button>
</nav>
<main>
  <section class="pane active" data-pane="author">
    <div class="panel">
      <h2>New content</h2>
      <label>Type</label>
      <select id="type"><option value="post">Post</option><option value="product">Product</option><option value="prompt">Prompt</option><option value="profile">Profile</option></select>
      <div id="dynFields"></div>
      <label>Body (Markdown)</label><textarea id="body"></textarea>
      <div class="actions">
        <input type="file" id="imgFile" accept="image/*" style="display:none" />
        <button class="sec" id="imgBtn">Add image</button>
        <button class="sec" id="previewBtn">Preview</button>
        <button class="sec" id="validateBtn">Validate</button>
        <button class="act" id="publishBtn">Publish (open PR)</button>
      </div>
      <div class="msg" id="formMsg"></div>
      <div id="preview" class="panel" style="display:none;margin-top:12px;background:#26242c"></div>
    </div>
  </section>

  <section class="pane" data-pane="content"><div class="panel"><h2>My content</h2><ul id="contentList"><li>…</li></ul></div></section>
  <section class="pane" data-pane="prs"><div class="panel"><h2>My pull requests</h2><ul id="prList"><li>…</li></ul></div></section>
  <section class="pane" data-pane="members"><div class="panel"><h2>Members-only content</h2><ul id="membersList"><li>…</li></ul></div></section>

  <section class="pane" data-pane="settings">
    <div class="panel">
      <h2>Settings</h2>
      <label>Endpoint token (paste into your agent / MCP config)</label><div><code id="tokenView">…</code></div>
      <div class="row" style="margin-top:12px">
        <div><label>Preferred port</label><input id="setPort" /></div>
        <div><label>Local content repo path</label><input id="setRepo" placeholder="/path/to/gbti.network" /></div>
      </div>
      <div class="actions">
        <label style="margin:0"><input type="checkbox" id="setMcp" style="width:auto" /> MCP enabled</label>
        <label style="margin:0"><input type="checkbox" id="setAuto" style="width:auto" /> Launch at login (peg-startup)</label>
        <button class="act" id="saveSettings">Save</button>
      </div>
      <div class="msg" id="settingsMsg"></div>
    </div>
  </section>

  <section class="pane" data-pane="billing"><div class="panel"><h2>Billing</h2><p id="billNote" class="who"></p><div class="actions"><a id="billLink" class="act" target="_blank" rel="noopener">Open Stripe portal</a></div></div></section>

  <section class="pane" data-pane="referrals">
    <div class="panel"><h2>Referrals</h2><p id="refNote" class="who"></p>
      <label>Your referral link</label><div><code id="refLink">…</code></div>
      <div class="actions"><a id="refConnect" class="sec" target="_blank" rel="noopener">Set up payouts (Stripe Connect)</a><a id="refTerms" class="sec" target="_blank" rel="noopener">Referral terms</a></div>
    </div>
  </section>

  <section class="pane" data-pane="admin">
    <div class="panel">
      <h2>Admin / superadmin</h2>
      <p class="who">Each action opens the appropriate PR; the gate + CODEOWNERS are authoritative.</p>
      <div class="row">
        <div><label>Action</label><select id="admAction">
          <option value="deplatform">deplatform (path)</option><option value="remove">remove (path)</option>
          <option value="ban">ban (githubId)</option><option value="unban">unban (githubId)</option>
          <option value="grandfather">grandfather (githubId)</option><option value="ungrandfather">ungrandfather (githubId)</option>
          <option value="role">role (githubId + role)</option>
        </select></div>
        <div><label>Target (githubId or content path)</label><input id="admTarget" /></div>
      </div>
      <div class="row">
        <div><label>Role (for role action)</label><select id="admRole"><option>member</option><option>moderator</option><option>admin</option><option>superadmin</option></select></div>
        <div><label>Reason / until (optional)</label><input id="admReason" /></div>
      </div>
      <div class="actions"><button class="act" id="admRun">Run (open PR)</button></div>
      <div class="msg" id="admMsg"></div>
    </div>
  </section>
</main>
<script>
(function () {
  var url = new URL(location.href);
  var TOKEN = url.searchParams.get('token') || sessionStorage.getItem('gbtiToken') || '';
  if (url.searchParams.has('token')) { sessionStorage.setItem('gbtiToken', TOKEN); url.searchParams.delete('token'); history.replaceState(null, '', url.toString()); }
  function api(p, o) { o = o || {}; o.headers = Object.assign({ Authorization: 'Bearer ' + TOKEN }, o.headers || {}); if (o.body && typeof o.body !== 'string') { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(o.body); } return fetch(p, o).then(function (r) { return r.json().then(function (j) { return { status: r.status, json: j }; }); }); }
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;' })[c]; }); };
  function msg(el, t, c) { el.textContent = t; el.className = 'msg ' + (c || ''); }

  // tabs
  var loaded = {};
  document.querySelectorAll('#tabs button').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.remove('active'); });
      document.querySelectorAll('.pane').forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      var name = b.getAttribute('data-tab');
      document.querySelector('.pane[data-pane="' + name + '"]').classList.add('active');
      if (LOADERS[name] && !loaded[name]) { loaded[name] = true; LOADERS[name](); }
    };
  });

  // Author — per-type dynamic fields
  var FIELD_KINDS = {};
  var FIELDS = [];
  function normTok(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ''); }
  // Evaluate a serializable showIf ({field, includesModel:[...]}) — mirrors client/src/image-models.mjs.
  function showIfOk(showIf, raw) {
    if (!showIf) return true;
    if (showIf.includesModel && showIf.includesModel.length) {
      var models = showIf.includesModel.map(normTok).filter(Boolean);
      var parts = String(raw || '').split(',').map(normTok).filter(Boolean);
      return parts.some(function (p) { return models.some(function (m) { return p.indexOf(m) !== -1; }); });
    }
    return true;
  }
  function rawVal(key) { var el = document.querySelector('[data-key="' + key + '"]'); return el ? (el.type === 'checkbox' ? el.checked : el.value) : ''; }
  function fieldVisible(fld) { return !fld.showIf || showIfOk(fld.showIf, rawVal(fld.showIf.field)); }
  function syncCond() {
    FIELDS.forEach(function (fld) {
      if (!fld.showIf) return;
      var wrap = document.getElementById('field-' + fld.key);
      if (wrap) wrap.hidden = !fieldVisible(fld);
    });
  }
  function renderFields(type) {
    api('/api/form-fields?type=' + encodeURIComponent(type)).then(function (r) {
      var c = $('dynFields'); c.innerHTML = ''; FIELD_KINDS = {}; FIELDS = (r.json.fields || []);
      FIELDS.forEach(function (fld) {
        FIELD_KINDS[fld.key] = fld.kind;
        var wrap = document.createElement('div'); wrap.id = 'field-' + fld.key;
        var label = document.createElement('label'); label.textContent = fld.label + (fld.required ? ' *' : ''); wrap.appendChild(label);
        var el;
        if (fld.kind === 'enum') { el = document.createElement('select'); var blank = document.createElement('option'); blank.value=''; blank.textContent='(none)'; el.appendChild(blank); (fld.options || []).forEach(function (o) { var op = document.createElement('option'); op.value = o; op.textContent = o; el.appendChild(op); }); }
        else if (fld.kind === 'textarea' || fld.kind === 'json') { el = document.createElement('textarea'); el.style.minHeight = '70px'; if (fld.kind === 'json') el.placeholder = '{ }'; }
        else if (fld.kind === 'boolean') { el = document.createElement('input'); el.type = 'checkbox'; el.style.width = 'auto'; }
        else { el = document.createElement('input'); if (fld.placeholder) el.placeholder = fld.placeholder; if (fld.kind === 'date') el.placeholder = 'YYYY-MM-DD'; }
        el.setAttribute('data-key', fld.key); wrap.appendChild(el); c.appendChild(wrap);
      });
      // Live-toggle conditional fields as their dependency (e.g. targets) changes; set the initial state.
      var deps = {};
      FIELDS.forEach(function (fld) { if (fld.showIf && fld.showIf.field) deps[fld.showIf.field] = true; });
      Object.keys(deps).forEach(function (dep) {
        var el = document.querySelector('[data-key="' + dep + '"]');
        if (el) { el.addEventListener('input', syncCond); el.addEventListener('change', syncCond); }
      });
      syncCond();
    });
  }
  function gather() {
    var input = {};
    Object.keys(FIELD_KINDS).forEach(function (key) {
      var el = document.querySelector('[data-key="' + key + '"]'); if (!el) return;
      var wrap = document.getElementById('field-' + key); if (wrap && wrap.hidden) return; // skip hidden conditional fields
      var kind = FIELD_KINDS[key];
      if (kind === 'boolean') { if (el.checked) input[key] = true; return; }
      var v = (el.value || '').trim(); if (!v) return;
      if (kind === 'array') input[key] = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (kind === 'number') input[key] = Number(v);
      else if (kind === 'json') { try { input[key] = JSON.parse(v); } catch (e) { throw new Error(key + ': invalid JSON'); } }
      else input[key] = v;
    });
    return { type: $('type').value, input: input, body: $('body').value };
  }
  $('type').onchange = function () { renderFields($('type').value); };
  $('previewBtn').onclick = function () { api('/api/preview', { method: 'POST', body: { body: $('body').value } }).then(function (r) { var p = $('preview'); p.style.display = 'block'; p.innerHTML = r.json.html || ''; }); };
  $('imgBtn').onclick = function () { $('imgFile').click(); };
  $('imgFile').onchange = function () { var file = this.files[0]; if (!file) return; var rd = new FileReader(); rd.onload = function () { var b64 = String(rd.result).split(',')[1]; api('/api/image', { method: 'POST', body: { filename: file.name, dataBase64: b64 } }).then(function (r) {
    if (r.status !== 200) { msg($('formMsg'), r.json.message || r.json.error, 'err'); return; }
    // Drop the staged path into a visible, empty image field (e.g. a prompt result image) if one is present.
    var imgFld = FIELDS.filter(function (f) { return f.kind === 'image'; })[0];
    var el = imgFld && document.querySelector('[data-key="' + imgFld.key + '"]');
    var wrap = imgFld && document.getElementById('field-' + imgFld.key);
    if (el && !el.value && wrap && !wrap.hidden) { el.value = r.json.path; msg($('formMsg'), 'Staged image → ' + r.json.path + ' (added to ' + (imgFld.label || imgFld.key) + ')', 'ok'); }
    else { msg($('formMsg'), 'Staged image → ' + r.json.path + ' (reference it in an image field)', 'ok'); }
  }); }; rd.readAsDataURL(file); };
  $('validateBtn').onclick = function () { var p; try { p = gather(); } catch (e) { return msg($('formMsg'), e.message, 'err'); } api('/api/validate', { method: 'POST', body: p }).then(function (r) { r.json.valid ? msg($('formMsg'), 'Valid → ' + r.json.path, 'ok') : msg($('formMsg'), r.json.error || 'Invalid', 'err'); }); };
  $('publishBtn').onclick = function () { var p; try { p = gather(); } catch (e) { return msg($('formMsg'), e.message, 'err'); } msg($('formMsg'), 'Publishing…'); api('/api/publish', { method: 'POST', body: p }).then(function (r) { if (r.status === 200) { msg($('formMsg'), (r.json.updated ? 'Updated PR #' : 'Opened PR #') + r.json.prNumber, 'ok'); loaded.prs = loaded.content = false; } else msg($('formMsg'), (r.json.message || r.json.error) + (r.json.issues ? ': ' + r.json.issues.map(function (i) { return i.message; }).join('; ') : ''), 'err'); }); };
  renderFields('post');

  function fillList(elId, items, render) { var ul = $(elId); ul.innerHTML = items.length ? '' : '<li class="who">Nothing here.</li>'; items.forEach(function (it) { var li = document.createElement('li'); li.innerHTML = render(it); ul.appendChild(li); }); }

  var LOADERS = {
    content: function () { api('/api/content').then(function (r) { fillList('contentList', (r.json.items) || [], function (it) { return '<span>' + esc(it.title) + '</span><span class="tag">' + esc(it.type) + ' · ' + esc(it.status) + '</span>'; }); }); },
    prs: function () { api('/api/prs').then(function (r) { if (r.status !== 200) return fillList('prList', [], function () {}); fillList('prList', r.json.prs || [], function (p) { return '<a href="' + p.html_url + '" target="_blank" rel="noopener">#' + p.number + ' ' + esc(p.title) + '</a>'; }); }); },
    members: function () { api('/api/members-content').then(function (r) { fillList('membersList', (r.json.items) || [], function (it) { return '<span>' + esc(it.title) + '</span><span class="tag">' + esc(it.author) + '</span>'; }); }); },
    settings: function () { api('/api/settings').then(function (r) { var s = r.json; $('tokenView').textContent = s.endpointToken || '(none)'; $('setPort').value = s.preferredPort; $('setRepo').value = s.repoPath || ''; $('setMcp').checked = s.mcpEnabled !== false; $('setAuto').checked = !!(s.autostart && s.autostart.installed); }); },
    billing: function () { api('/api/billing').then(function (r) { $('billNote').textContent = r.json.note || ''; $('billLink').href = r.json.portal; }); },
    referrals: function () { api('/api/referral').then(function (r) { $('refNote').textContent = r.json.note || ''; $('refLink').textContent = r.json.link || '(sign in)'; $('refConnect').href = r.json.connectOnboarding; $('refTerms').href = r.json.terms; }); }
  };

  $('saveSettings').onclick = function () { api('/api/settings', { method: 'POST', body: { mcpEnabled: $('setMcp').checked, preferredPort: Number($('setPort').value), repoPath: $('setRepo').value, autostart: $('setAuto').checked } }).then(function (r) { r.status === 200 ? msg($('settingsMsg'), 'Saved.', 'ok') : msg($('settingsMsg'), r.json.message || r.json.error, 'err'); }); };

  $('admRun').onclick = function () { var action = $('admAction').value, target = $('admTarget').value.trim(); var body = { action: action }; if (action === 'deplatform' || action === 'remove') body.path = target; else body.githubId = target; if (action === 'role') body.role = $('admRole').value; if ($('admReason').value.trim()) { body.reason = $('admReason').value.trim(); body.until = $('admReason').value.trim(); } msg($('admMsg'), 'Working…'); api('/api/admin', { method: 'POST', body: body }).then(function (r) { r.status === 200 ? msg($('admMsg'), 'Opened PR #' + r.json.prNumber, 'ok') : msg($('admMsg'), r.json.message || r.json.error, 'err'); }); };

  // status + role-gated admin tab
  api('/api/status').then(function (r) { var id = r.json.identity, role = r.json.role; $('who').textContent = (id ? '@' + (id.login || id.username) : 'not signed in') + (role && role !== 'member' ? ' · ' + role : '') + (r.json.authenticated ? '' : ' · run gbti login'); if (role && role !== 'member') document.querySelector('#tabs button[data-tab="admin"]').classList.remove('hidden'); });
  LOADERS.content(); loaded.content = true;
})();
</script>
</body>
</html>`;
