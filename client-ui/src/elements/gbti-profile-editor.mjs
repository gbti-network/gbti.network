// <gbti-profile-editor> (SOW-129): the member-facing Profile management surface. A dedicated, Settings-styled
// editor for the member's own members/<username>/profile.md: identity (display name, headline, avatar), a
// markdown bio, presence toggles (for hire, member directory), skills + roles tags, and a branded-icon social
// links repeater across the comprehensive platform set. Host-agnostic: it talks ONLY to the injected client and
// reuses the existing content pipeline (listContent -> getContentItem to load; publish/saveDraft to save through
// the network's pull request, so profile.md drives the public build). Named `-editor` to leave `<gbti-profile>` free for
// SOW-067's deferred read-only view. Presentation copies <gbti-account>'s "GBTI Settings" cards. Inert in public
// (no client -> a sign-in nudge). Publishing is PAID-ONLY (SOW-011): a non-paid member saves a private draft.
//
// sow-346: mounted as the WorkBench Profile tab (website and npm CMS; the extension hands off to the website).
// It loads through readOwnProfile, and a read that did not answer shows a message and NO Save: the old load
// turned every failure into "no profile", so on the website (which lists no profile) it opened blank for a
// member who has one, and a save would have replaced their real profile.
import { GbtiElement, define, esc } from '../base.mjs';
import { socialIcon, SOCIAL_KEYS, SOCIAL_LABELS, buildSocialUrl } from '../social-icons.mjs';
import { isSanctionedAvatar, githubAvatarUrl, mergeStagedLinks } from '../profile-fields.mjs'; // SOW-129: the avatar host allowlist + the welcome-socials prefill
import { accountKey } from '../welcome-core.mjs'; // sow-345: the staged handles live under an account-scoped key
import { readOwnProfile } from '../own-profile.mjs'; // sow-346: found / absent / failed
import { browserStorage } from '../storage.mjs'; // sow-347

const SITE = 'https://gbti.network';

const STATUS_LABEL = {
  paid: 'Paid member', trialing: 'Free trial', trial: 'Free trial', expired: 'Trial expired',
  cancelled: 'Cancelled', none: 'Not a member', banned: 'Suspended', unknown: 'Unknown',
};

// Turn a free-typed role into the slug convention the schema + public render use (mcp-developer). Skills stay free.
const slugifyRole = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const prettyRole = (s) => String(s || '').split(/[-_]/).filter(Boolean).map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); }
  .sec { background:var(--panel); border:1.5px solid var(--line); border-radius:16px; box-shadow:0 1px 2px rgba(0,0,0,.05); overflow:hidden; margin:0 0 22px; -webkit-backdrop-filter:var(--glass-blur); backdrop-filter:var(--glass-blur); }
  .sec-h { padding:20px 24px 16px; }
  .sec-h h3 { margin:0; font-family:var(--font-display, var(--font-body)); font-weight:700; font-size:20px; letter-spacing:-.005em; display:flex; align-items:center; gap:10px; }
  .sec-h p { margin:5px 0 0; color:var(--muted); font-size:14px; line-height:1.5; max-width:60ch; }
  .body { padding:4px 24px 20px; display:flex; flex-direction:column; gap:18px; }
  .rows { border-top:1.5px solid var(--line); }
  .row { display:grid; grid-template-columns:1fr auto; gap:24px; align-items:center; padding:16px 24px; }
  .row + .row { border-top:1px solid var(--line); }
  .row .rl .t { font-weight:600; font-size:15px; }
  .row .rl .d { color:var(--muted); font-size:13.5px; line-height:1.45; margin-top:3px; max-width:48ch; }
  @media (max-width:560px) { .row { grid-template-columns:1fr; } }
  /* stacked field */
  .fld label { display:block; font-weight:600; font-size:14px; margin:0 0 3px; }
  .fld .d { color:var(--muted); font-size:13px; line-height:1.4; margin:0 0 7px; max-width:60ch; }
  .fld input[type=text], .fld input[type=url], .fld textarea, .lv input { width:100%; box-sizing:border-box; font:inherit; font-size:14px; padding:10px 12px; border:1.5px solid var(--line); border-radius:9px; background:var(--bg, var(--panel)); color:var(--fg); }
  .fld input:focus, .fld textarea:focus, .lv input:focus { outline:none; border-color:var(--accent); }
  .fld textarea { min-height:120px; resize:vertical; line-height:1.55; font-family:var(--font-mono, ui-monospace, monospace); }
  /* avatar field: preview + input */
  .avrow { display:flex; gap:14px; align-items:flex-start; }
  .avprev { width:64px; height:64px; flex:none; border-radius:50%; object-fit:cover; border:1.5px solid var(--line); background:var(--hover); }
  .avfield { flex:1; min-width:0; }
  .averr { color:#b3261e; font-size:12.5px; margin-top:5px; min-height:14px; }
  /* segmented toggle */
  .seg { display:inline-flex; background:var(--hover); border:1.5px solid var(--line); border-radius:9px; padding:3px; gap:2px; }
  .seg .segbtn { border:0; background:transparent; font:inherit; font-weight:600; font-size:14px; padding:7px 16px; border-radius:6px; color:var(--muted); cursor:pointer; }
  .seg .segbtn.on { background:var(--brand); color:#fff; }
  .badge { display:inline-block; font-family:var(--font-mono, monospace); font-size:10.5px; font-weight:700; letter-spacing:.05em; text-transform:uppercase; border-radius:999px; padding:3px 9px; background:var(--hover); color:var(--fg); }
  .badge.paid { background:var(--green-tint, #e9f6ef); color:var(--green-700, #0f6f40); }
  /* tags (skills + roles) */
  .tags { display:flex; flex-wrap:wrap; gap:7px; margin:0 0 9px; }
  .tag { display:inline-flex; align-items:center; gap:6px; font-size:12.5px; font-weight:600; padding:5px 8px 5px 11px; border-radius:999px; border:1.5px solid var(--line); background:var(--hover); }
  .tag.role { border-color:var(--accent); color:var(--fg); background:color-mix(in srgb, var(--accent) 10%, transparent); }
  .tag button { border:0; background:transparent; color:var(--muted); cursor:pointer; font:inherit; font-size:14px; line-height:1; padding:0; }
  .tag button:hover { color:#b3261e; }
  .taginput { display:flex; gap:8px; }
  .taginput input { flex:1; }
  .taginput button { font:inherit; font-weight:600; font-size:13px; padding:9px 14px; border-radius:9px; border:1.5px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; white-space:nowrap; }
  .taginput button:hover { border-color:var(--accent); color:var(--accent); }
  /* social repeater */
  .lrow { display:grid; grid-template-columns:auto 1fr auto; gap:10px; align-items:center; margin:0 0 9px; }
  .lico { width:34px; height:34px; flex:none; display:inline-flex; align-items:center; justify-content:center; border-radius:9px; border:1.5px solid var(--line); background:var(--hover); color:var(--fg); }
  .lico svg { width:16px; height:16px; }
  .lv { min-width:0; }
  .lv .llabel { font-size:11.5px; font-weight:700; color:var(--muted); text-transform:uppercase; letter-spacing:.03em; margin:0 0 2px; }
  .lrm { border:0; background:transparent; color:var(--muted); cursor:pointer; font-size:18px; line-height:1; padding:6px; border-radius:8px; }
  .lrm:hover { color:#b3261e; background:var(--hover); }
  .picker { display:flex; flex-wrap:wrap; gap:8px; margin-top:6px; }
  .pk { display:inline-flex; align-items:center; gap:7px; font:inherit; font-size:13px; font-weight:600; padding:8px 12px; border-radius:9px; border:1.5px solid var(--line); background:var(--panel); color:var(--fg); cursor:pointer; }
  .pk:hover { border-color:var(--accent); color:var(--accent); }
  .pk svg { width:15px; height:15px; }
  .addbtn { font:inherit; font-weight:600; font-size:13.5px; padding:9px 15px; border-radius:9px; border:1.5px dashed var(--line); background:transparent; color:var(--fg); cursor:pointer; }
  .addbtn:hover { border-color:var(--accent); color:var(--accent); }
  /* save bar */
  .savebar { position:sticky; bottom:0; display:flex; align-items:center; gap:14px; flex-wrap:wrap; padding:16px 4px 4px; background:linear-gradient(to top, var(--bg, var(--panel)) 60%, transparent); }
  .savebar .save { font:inherit; font-weight:700; font-size:14px; padding:11px 22px; border-radius:10px; border:1.5px solid var(--accent); background:var(--accent); color:#fff; cursor:pointer; }
  .savebar .save[disabled] { opacity:.6; cursor:default; }
  .note { font-size:13px; color:var(--muted); }
  .msg { font-size:13px; } .msg.ok { color:var(--green-700, #0f6f40); } .msg.err { color:#b3261e; }
  .nudge { padding:18px 20px; border:1.5px dashed var(--line); border-radius:16px; background:var(--panel); font-size:14px; color:var(--muted); }
  .nudge a { color:var(--brand); font-weight:600; }
  /* sow-346: on a phone the sticky bar covered a sixth of the screen, over the fields being edited; there it sits
     at the end of the form instead. Last in the template: a media rule adds no specificity. */
  @media (max-width:560px) { .savebar { position:static; background:none; } }
`;

class GbtiProfileEditor extends GbtiElement {
  _loaded = false;
  _loading = false;
  _addingLink = false;
  _saving = false;
  _msg = '';
  _msgKind = '';

  connectedCallback() {
    // sow-346: the WorkBench keeps ONE editor across its own re-renders and moves it back in. A move must not
    // rebuild the form, because typed text lives only in the inputs until a structural change gathers it.
    this._moved = this._loaded && Boolean(this.root?.firstChild);
    super.connectedCallback();
    this._moved = false;
  }

  // sow-346: a client broadcast (the WorkBench page has a second, late setClient caller) must not rebuild a form
  // that may hold unsaved edits. A view with no form (signed out, or a failed read) loads again instead.
  skipClientRender() {
    if (this._loaded && this._signedIn && this._readState !== 'failed') return true;
    if (this._loaded && !this._loading) this._loaded = false;
    return false;
  }

  _maybeLoad() {
    if (this.client && !this._loaded && !this._loading) { this._loading = true; this._load(); }
  }

  async _load() {
    let status = null;
    try { status = (await this.client.status?.()) ?? null; } catch { status = null; }
    this._status = status;
    const r = await readOwnProfile(this.client, { identity: status?.identity ?? null });
    this._readState = r.state;
    this._path = r.path;
    // Only a read that ANSWERED "not found" starts a new profile, named after the member's login.
    const login = status?.identity?.username || status?.identity?.login || '';
    const fm = r.item ? r.item.frontmatter : (r.state === 'absent' ? { displayName: status?.identity?.name || login } : {});
    this._fm = fm;
    this._model = this._modelFromFm(fm, r.item?.body || '');
    if (r.state !== 'failed') await this._offerKept(status);
    this._loaded = true; this._loading = false;
    this.render();
  }

  // Handles typed during welcome that never reached the profile: this browser's (under an account-scoped key,
  // sow-345) and a trial member's, kept on the account (sow-343). They fill only EMPTY links; a saved value wins.
  async _offerKept(status) {
    let staged = null;
    const key = accountKey('gbti-welcome-socials', status?.identity); // sow-345: never the bare key
    try { staged = key ? JSON.parse(browserStorage()?.getItem(key) || 'null') : null; } catch { staged = null; }
    let kept = null;
    try { kept = (await this.client.getPrefs?.())?.onboarding?.socials ?? null; } catch { kept = null; }
    const offered = { ...(kept && typeof kept === 'object' ? kept : {}), ...(staged && typeof staged === 'object' ? staged : {}) };
    if (!Object.keys(offered).length) return;
    this._model.links = mergeStagedLinks(this._model.links, offered, SOCIAL_KEYS);
    if (staged) { try { browserStorage()?.removeItem(key); } catch { /* nothing to clear */ } }
  }

  _modelFromFm(fm, body) {
    // Coerce every text field to a string on load. YAML parses an unquoted numeric/boolean value (e.g. a
    // numeric social handle `discord: 123456789`) as a Number/Boolean; the model then feeds `.trim()` in
    // _buildInput / render, which would throw on a non-string. The editor's own serializer quotes such values
    // (so a round-trip is safe) and content-check rejects an unquoted-numeric profile.md at the gate, but a
    // hand-crafted or migrated file could still reach here, so coerce defensively (matches the String(x ?? '')
    // pattern in buildSocialUrl / isSanctionedAvatar). Pure string data is unaffected.
    const str = (v) => (v == null ? '' : String(v));
    const links = {};
    for (const [k, v] of Object.entries(fm.links || {})) links[k] = str(v);
    return {
      displayName: str(fm.displayName),
      headline: str(fm.headline),
      avatar: str(fm.avatar),
      location: str(fm.location), // preserved, never surfaced (owner decision)
      forHire: fm.forHire === true,
      directory: fm.directory === true,
      skills: Array.isArray(fm.skills) ? fm.skills.map(str) : [],
      roles: Array.isArray(fm.roles) ? fm.roles.map(str) : [],
      links,
      visibility: fm.visibility || 'public',
      body: body || '',
    };
  }

  get _signedIn() { return Boolean(this._status?.authenticated && this._status?.identity?.login); }
  get _login() { return this._status?.identity?.login || null; }
  get _membership() { return this._status?.membership || 'unknown'; }
  get _paid() { return this._membership === 'paid'; }

  // Sync the free-text inputs (which are NOT re-rendered per keystroke) into the model before any structural render.
  _gather() {
    if (!this._model) return;
    const val = (sel) => this.$(sel)?.value;
    if (this.$('[data-field="displayName"]')) this._model.displayName = val('[data-field="displayName"]') ?? this._model.displayName;
    if (this.$('[data-field="headline"]')) this._model.headline = val('[data-field="headline"]') ?? this._model.headline;
    if (this.$('[data-field="avatar"]')) this._model.avatar = val('[data-field="avatar"]') ?? this._model.avatar;
    if (this.$('[data-field="body"]')) this._model.body = val('[data-field="body"]') ?? this._model.body;
    this.$$('[data-link-key]').forEach((inp) => { this._model.links[inp.dataset.linkKey] = inp.value; });
  }

  render() {
    if (this._moved) return;
    this._maybeLoad();
    if (!this.client) { this.set(this.css(CSS) + `<div class="nudge">Sign in to edit your profile.</div>`); return; }
    if (!this._loaded) { this.set(this.css(CSS) + `<section class="sec"><div class="sec-h"><p style="margin:0">Loading your profile…</p></div></section>`); return; }
    if (!this._signedIn) { this.set(this.css(CSS) + `<div class="nudge">Sign in to edit your profile. <a href="${SITE}/membership/">Become a member</a>.</div>`); return; }
    if (this._readState === 'failed') {
      this.set(this.css(CSS) + `<section class="sec" data-read-failed><div class="sec-h"><h3>Profile</h3><p>Your profile could not be read just now, so it cannot be edited safely. Reload the page to try again.</p></div></section>`);
      return;
    }
    const m = this._model || this._modelFromFm({}, '');
    let sections;
    try {
      sections = this._identity(m) + this._bio(m) + this._presence(m) + this._skills(m) + this._roles(m) + this._socials(m) + this._saveBar();
    } catch {
      sections = `<section class="sec"><div class="sec-h"><h3>Profile</h3><p>Your profile could not load. Reopen this page to retry.</p></div></section>`;
    }
    this.set(this.css(CSS) + sections);
    this._wire();
  }

  _identity(m) {
    const badge = this._paid ? '<span class="badge paid">Paid</span>' : `<span class="badge">${esc(STATUS_LABEL[this._membership] || this._membership)}</span>`;
    return `<section class="sec">
      <div class="sec-h"><h3>Profile ${badge}</h3><p>How you appear across gbti.network: your public profile page, the member directory, and content you author. Signed in as <b>@${esc(this._login || '')}</b>.</p></div>
      <div class="body">
        <div class="fld"><label for="pf-name">Display name</label><div class="d">Your name as it shows on your profile and cards.</div><input id="pf-name" type="text" data-field="displayName" value="${esc(m.displayName)}" maxlength="80" /></div>
        <div class="fld"><label for="pf-headline">Headline</label><div class="d">A short line under your name (a role, a company, or a tagline).</div><input id="pf-headline" type="text" data-field="headline" value="${esc(m.headline)}" maxlength="120" /></div>
        <div class="fld"><label for="pf-avatar">Avatar</label><div class="d">Your profile picture. Leave blank to use your GitHub avatar, or paste a Gravatar image URL. Other image hosts are not allowed.</div>
          <div class="avrow">
            <img class="avprev" data-avatar-preview alt="Avatar preview" src="${esc(this._avatarSrc(m.avatar))}" />
            <div class="avfield">
              <input id="pf-avatar" type="url" data-field="avatar" data-avatar-input value="${esc(m.avatar)}" placeholder="Blank = GitHub avatar, or https://gravatar.com/avatar/…" />
              <div class="averr" data-avatar-err></div>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  }

  // The preview src: the entered avatar when it is a sanctioned https URL, else the member's GitHub avatar default.
  _avatarSrc(v) {
    const val = String(v || '').trim();
    if (val && isSanctionedAvatar(val)) return val;
    return githubAvatarUrl(this._login);
  }

  _bio(m) {
    return `<section class="sec">
      <div class="sec-h"><h3>Bio</h3><p>Your longer introduction, in Markdown. It renders below your name on your profile page.</p></div>
      <div class="body"><div class="fld"><textarea data-field="body" placeholder="Write a few lines about yourself…">${esc(m.body)}</textarea></div></div>
    </section>`;
  }

  _presence(m) {
    const seg = (key, on) => `<div class="seg"><button type="button" class="segbtn${on ? '' : ' on'}" data-toggle="${key}" data-val="off">Off</button><button type="button" class="segbtn${on ? ' on' : ''}" data-toggle="${key}" data-val="on">On</button></div>`;
    return `<section class="sec">
      <div class="sec-h"><h3>Presence</h3><p>Where you show up on the network.</p></div>
      <div class="rows">
        <div class="row"><div class="rl"><div class="t">Available for hire</div><div class="d">Shows a "for hire" chip on your directory card.</div></div><div class="rc">${seg('forHire', m.forHire)}</div></div>
        <div class="row"><div class="rl"><div class="t">List in the member directory</div><div class="d">Include your profile in the public members grid at /members/.</div></div><div class="rc">${seg('directory', m.directory)}</div></div>
      </div>
    </section>`;
  }

  _skills(m) {
    const tags = m.skills.map((s, i) => `<span class="tag">${esc(s)}<button type="button" data-rm-skill="${i}" aria-label="Remove ${esc(s)}">×</button></span>`).join('');
    return `<section class="sec">
      <div class="sec-h"><h3>Skills</h3><p>Technologies and tools you work with. They render as tags on your profile.</p></div>
      <div class="body">
        ${m.skills.length ? `<div class="tags">${tags}</div>` : ''}
        <div class="taginput"><input type="text" data-tag-add="skills" placeholder="Add a skill and press Enter (e.g. TypeScript)" /><button type="button" data-tag-btn="skills">Add</button></div>
      </div>
    </section>`;
  }

  _roles(m) {
    const tags = m.roles.map((r, i) => `<span class="tag role">${esc(prettyRole(r))}<button type="button" data-rm-role="${i}" aria-label="Remove ${esc(r)}">×</button></span>`).join('');
    return `<section class="sec">
      <div class="sec-h"><h3>Specialties</h3><p>Your developer specialties (for example MCP Developer). They render as badges on your profile.</p></div>
      <div class="body">
        ${m.roles.length ? `<div class="tags">${tags}</div>` : ''}
        <div class="taginput"><input type="text" data-tag-add="roles" placeholder="Add a specialty and press Enter (e.g. WordPress Developer)" /><button type="button" data-tag-btn="roles">Add</button></div>
      </div>
    </section>`;
  }

  _socials(m) {
    const setKeys = SOCIAL_KEYS.filter((k) => typeof m.links[k] === 'string' && m.links[k].trim() !== '' || Object.prototype.hasOwnProperty.call(m.links, k) && m.links[k] === '');
    const rows = setKeys.map((k) => `<div class="lrow">
      <span class="lico" aria-hidden="true">${socialIcon(k, 16)}</span>
      <span class="lv"><span class="llabel">${esc(SOCIAL_LABELS[k] || k)}</span><input type="text" data-link-key="${esc(k)}" value="${esc(m.links[k] || '')}" placeholder="${esc(this._placeholder(k))}" /></span>
      <button type="button" class="lrm" data-rm-link="${esc(k)}" aria-label="Remove ${esc(SOCIAL_LABELS[k] || k)}">×</button>
    </div>`).join('');
    const unused = SOCIAL_KEYS.filter((k) => !setKeys.includes(k));
    const picker = this._addingLink && unused.length
      ? `<div class="picker">${unused.map((k) => `<button type="button" class="pk" data-add-link="${esc(k)}">${socialIcon(k, 15)}${esc(SOCIAL_LABELS[k] || k)}</button>`).join('')}</div>`
      : '';
    const addBtn = unused.length ? `<button type="button" class="addbtn" data-add-toggle>${this._addingLink ? 'Close' : '+ Add a link'}</button>` : '';
    return `<section class="sec">
      <div class="sec-h"><h3>Social links</h3><p>Your profiles across the web. Paste a full URL or a handle; we build the link. These also credit you when your content is shared to X and Bluesky.</p></div>
      <div class="body">
        ${rows || '<div class="note">No links yet. Add one below.</div>'}
        ${addBtn}
        ${picker}
      </div>
    </section>`;
  }

  _placeholder(k) {
    if (k === 'website') return 'https://your-site.com';
    if (k === 'discord') return 'your_handle';
    if (k === 'mastodon') return '@you@instance.social';
    return '@handle or full URL';
  }

  _saveBar() {
    const label = this._saving ? 'Saving…' : (this._paid ? 'Publish profile' : 'Save privately');
    const note = this._paid
      ? 'Publishing updates your public profile on gbti.network within a couple of minutes.'
      : 'Publishing your profile needs a paid membership. Your changes save privately and publish when you upgrade.';
    return `<div class="savebar">
      <button class="save" type="button" data-save ${this._saving ? 'disabled' : ''}>${label}</button>
      <span class="note">${esc(note)}</span>
      <span class="msg ${this._msgKind}" data-msg aria-live="polite">${esc(this._msg)}</span>
    </div>`;
  }

  _wire() {
    // Presence toggles (gather text first so unsaved input survives the re-render).
    this.$$('[data-toggle]').forEach((b) => b.addEventListener('click', () => {
      this._gather();
      this._model[b.dataset.toggle] = b.dataset.val === 'on';
      this.render();
    }));
    // Skills / roles tag add (Enter or the Add button) + remove.
    const addTag = (kind) => {
      const inp = this.$(`[data-tag-add="${kind}"]`);
      if (!inp) return;
      let raw = inp.value.trim();
      if (!raw) return;
      const value = kind === 'roles' ? slugifyRole(raw) : raw;
      if (value && !this._model[kind].includes(value)) { this._gather(); this._model[kind].push(value); this.render(); this.$(`[data-tag-add="${kind}"]`)?.focus(); }
    };
    ['skills', 'roles'].forEach((kind) => {
      const inp = this.$(`[data-tag-add="${kind}"]`);
      if (inp) inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(kind); } });
      this.$(`[data-tag-btn="${kind}"]`)?.addEventListener('click', () => addTag(kind));
    });
    this.$$('[data-rm-skill]').forEach((b) => b.addEventListener('click', () => { this._gather(); this._model.skills.splice(Number(b.dataset.rmSkill), 1); this.render(); }));
    this.$$('[data-rm-role]').forEach((b) => b.addEventListener('click', () => { this._gather(); this._model.roles.splice(Number(b.dataset.rmRole), 1); this.render(); }));
    // Social repeater.
    this.$('[data-add-toggle]')?.addEventListener('click', () => { this._gather(); this._addingLink = !this._addingLink; this.render(); });
    this.$$('[data-add-link]').forEach((b) => b.addEventListener('click', () => { this._gather(); this._model.links[b.dataset.addLink] = ''; this._addingLink = false; this.render(); this.$(`[data-link-key="${b.dataset.addLink}"]`)?.focus(); }));
    this.$$('[data-rm-link]').forEach((b) => b.addEventListener('click', () => { this._gather(); delete this._model.links[b.dataset.rmLink]; this.render(); }));
    // Avatar: live preview + inline restriction message (no full re-render, to keep input focus).
    const avInput = this.$('[data-avatar-input]');
    const avPrev = this.$('[data-avatar-preview]');
    const avErr = this.$('[data-avatar-err]');
    if (avInput) avInput.addEventListener('input', () => {
      const v = avInput.value.trim();
      const bad = v && !isSanctionedAvatar(v);
      if (avErr) avErr.textContent = bad ? 'Use your GitHub or Gravatar image only. Other hosts are not allowed.' : '';
      if (avPrev) avPrev.src = this._avatarSrc(bad ? '' : v);
    });
    // A broken image falls back once to the GitHub default (inline onerror is blocked by the extension CSP).
    if (avPrev) avPrev.addEventListener('error', () => {
      const fb = githubAvatarUrl(this._login);
      if (fb && avPrev.getAttribute('src') !== fb) avPrev.src = fb;
    });
    // Save.
    this.$('[data-save]')?.addEventListener('click', () => this._save());
  }

  _buildInput() {
    const m = this._model;
    // sow-346: start from the loaded frontmatter, so fields this editor does not manage (status, anything added
    // later) survive a save. The optional fields it does manage are dropped first, so clearing one removes it.
    const input = { ...(this._fm || {}) };
    for (const k of ['headline', 'avatar', 'location', 'links']) delete input[k];
    const links = {};
    for (const k of SOCIAL_KEYS) {
      const raw = (m.links[k] || '').trim();
      if (raw) links[k] = buildSocialUrl(k, raw);
    }
    Object.assign(input, {
      displayName: (m.displayName || '').trim() || this._login || 'Member',
      forHire: m.forHire === true,
      directory: m.directory === true,
      skills: m.skills,
      roles: m.roles,
      visibility: m.visibility || 'public',
    });
    if ((m.headline || '').trim()) input.headline = m.headline.trim();
    if ((m.avatar || '').trim() && isSanctionedAvatar(m.avatar.trim())) input.avatar = m.avatar.trim();
    if ((m.location || '').trim()) input.location = m.location.trim(); // preserved, not surfaced
    if (Object.keys(links).length) input.links = links;
    return input;
  }

  async _save() {
    if (this._saving || !this._model || !['found', 'absent'].includes(this._readState)) return; // sow-346: never over an unread profile
    this._gather();
    const av = (this._model.avatar || '').trim();
    if (av && !isSanctionedAvatar(av)) {
      this._msg = 'Your avatar must be a GitHub or Gravatar image URL. Please fix it before saving.'; this._msgKind = 'err';
      this.render();
      return;
    }
    this._saving = true; this._msg = ''; this._msgKind = '';
    this.render();
    const input = this._buildInput();
    const body = this._model.body || '';
    const path = this._readState === 'found' ? (this._path || undefined) : undefined; // a new profile takes the member's own path
    let published = false;
    try {
      if (this._paid) {
        await this.client.publish({ type: 'profile', input, body, path });
        this._msg = 'Profile published. It appears on gbti.network in a couple of minutes.'; this._msgKind = 'ok';
        published = true;
      } else {
        await this.client.saveDraft({ type: 'profile', input, body, path });
        this._msg = 'Saved privately. Upgrade to a paid membership to publish it.'; this._msgKind = 'ok';
      }
      // Optimistic: treat the saved model as the current profile (the app reflects it now; the site rebuilds later).
      this._fm = { ...input };
    } catch (e) {
      this._msg = e?.message ? `Could not save: ${e.message}` : 'Could not save just now. Try again in a moment.'; this._msgKind = 'err';
    }
    if (published) {
      // sow-346: the profile now exists, and a publish that carries links finishes the setup card's socials step
      // (and clears the handles a trial member kept on the account).
      this._readState = 'found';
      if (input.links) { try { await this.client.setPrefs?.({ onboardingSocialsSaved: true }); } catch { /* the card also reads the profile */ } }
      this.emit('gbti-profile-saved', { frontmatter: input });
    }
    this._saving = false;
    this.render();
  }
}

define('gbti-profile-editor', GbtiProfileEditor);
export { GbtiProfileEditor };
