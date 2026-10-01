// sow-427: the WorkBench project editor's PREPARED MODE. A superadmin writes a project for someone who is not a member
// yet; saving stores it privately in KV with a personal invitation (never the repository), and the person claims it
// under their own name with a free year. <gbti-content-editor> was far over the 900-line cap when this was written, so it carries HOOK
// LINES only (test/prepared-editor.test.mjs still holds it to that) and everything about prepared mode lives here: the rail card, the toggle, the save, the image reads,
// and the two WorkBench deep links (`#new=project&prepare=1`, `#prepare=<listing id>`).
//
// WHAT PREPARED MODE CHANGES IN THE EDITOR, AND WHY.
//   - Publish, Save draft and Preview are hidden: nothing is published and nothing lands in the superadmin's own
//     draft store. The one action is Save listing, which calls client.preparedSave.
//   - The From the author section is hidden. The author note is the claimant's alone (owner decision 4): they write
//     it in the claim step, and a note written here would put words in their mouth under their name.
//   - The audience switch is hidden. A claimed project is always published to everyone (the Worker refuses any
//     members-only gating in a prepared project), so the switch would offer a choice that does not exist.
//   - Hiding is done by one class on the editor host (`prep-on`) and !important rules, not by re-rendering, so an
//     author who flips the toggle half way through keeps everything they typed.
//
// THE SAVE PAYLOAD NEVER CARRIES `authorNote`, `authorTarget` OR `path` (test/prepared-editor.test.mjs). The Worker
// builds the claim from the stored record alone, own folder only, and a prepared project has no path until then.
//
// IMAGES go through the existing staged draft image path: the editor stages them under `project:<slug>` in the
// superadmin's own `draftimg:` store exactly as for a draft, and the save names that item as `stagedItem`, so the
// Worker copies the bytes into the listing's own store and then deletes the staged copies. Reading one back for an
// open listing tries the staged copy first, then the listing store (preparedImageReader).
//
// Nothing here logs. The invitation code in the link is a bearer secret, and the greeting, the message and the
// project are about a person who has not agreed to anything yet.

import { failHint } from './workspace-core.mjs';
import { isListingId, validateInvitationText, normalizeGithubLogin, MAX_MESSAGE, MAX_RECIPIENT_NAME } from '../../membership/prepared-listings-shared.mjs';

// The same escape as base.mjs, kept here so this module stays DOM-free and node-testable without loading the element
// base (and the avatar layer it pulls in). cta-manager-view.mjs does the same for the same reason.
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---- the prepared state ----------------------------------------------------------------------------------------

const PREP_KEYS = ['id', 'recipientName', 'message', 'githubLogin', 'campaign', 'code', 'link', 'state', 'inviteState'];

/** The prepared state of a listing that has not been saved yet. */
export function blankPrepared() {
  return { id: null, recipientName: '', message: '', githubLogin: '', campaign: '', code: null, link: null, state: null, inviteState: null };
}

/** The `prepared` option handed to the editor's load(), as a fresh prepared state, or null when absent. */
export function preparedFromLoad(p) {
  if (!p || typeof p !== 'object') return null;
  const out = blankPrepared();
  for (const k of PREP_KEYS) if (p[k] !== undefined && p[k] !== null) out[k] = typeof p[k] === 'string' ? p[k] : out[k];
  if (!isListingId(out.id)) out.id = null;
  return out;
}

/**
 * Whether the editor offers the "Prepare for someone who is not a member yet" toggle: a superadmin, a NEW project
 * (no path yet, not already a saved listing), and a client that can save one. The Worker re-checks superadmin on the
 * save regardless; this only keeps the toggle away from everyone who would be refused.
 */
export function canOfferPrepare({ role, type, itemPath, prepared, client } = {}) {
  return role === 'superadmin' && type === 'project' && !itemPath && !isListingId(prepared?.id) && typeof client?.preparedSave === 'function';
}

/** Why a listing cannot be opened for editing, as a sentence, or null when it can. The Worker refuses the same. */
export function preparedEditRefusal(listing) {
  const st = listing?.state;
  if (st === 'claimed') return 'This listing was claimed, so its project now lives in the member folder and is edited there.';
  if (st === 'publishing') return 'A claim for this listing is being published, so it cannot be edited until that pull request merges or closes.';
  if (st !== 'prepared' && st !== 'revoked') return 'That prepared listing could not be read.';
  return null;
}

/** The workspace `_editing` state for a listing, from `client.preparedGet(id)`. Throws a sentence when it cannot open. */
export function preparedEditingFrom(res) {
  const l = res?.listing;
  if (!l || !isListingId(l.id)) throw new Error('That prepared listing could not be read.');
  const refusal = preparedEditRefusal(l);
  if (refusal) throw new Error(refusal);
  if (!l.frontmatter || typeof l.frontmatter !== 'object') throw new Error('That prepared listing has no project to edit.');
  return {
    type: 'project',
    frontmatter: { ...l.frontmatter },
    body: typeof l.body === 'string' ? l.body : '',
    path: '',
    prepared: preparedFromLoad({
      id: l.id, recipientName: l.recipientName || '', message: l.message || '', githubLogin: l.bound ? (l.boundLogin || '') : '',
      campaign: l.campaign || '', code: l.code || null, link: typeof res.link === 'string' ? res.link : null,
      state: l.state || null, inviteState: l.inviteState || null,
    }),
  };
}

/** Read one listing for the editor. Throws a sentence the workspace can show. */
export async function openPreparedListing(client, id) {
  if (!isListingId(id)) throw new Error('That is not a prepared listing link.');
  if (typeof client?.preparedGet !== 'function') throw new Error('Prepared listings open in the website WorkBench.');
  return preparedEditingFrom(await client.preparedGet(id));
}

/**
 * The workspace hook for `#prepare=<id>`: open the listing in the editor, or land on the Projects tab with the reason.
 * `ws` is the <gbti-workspace> element; only its public state and helpers are touched.
 */
export async function openPreparedInto(ws, id) {
  try {
    ws._editing = await openPreparedListing(ws.client, id);
    ws._writeHash?.(`#prepare=${id}`);
  } catch (err) {
    ws._editing = null;
    ws._draftMsg = err?.message || 'Could not open that prepared listing.';
    ws._tab = 'project';
    ws._writeHash?.('#tab=project');
    ws._ensureTab?.('project');
  }
  ws.render();
}

/**
 * The workspace hook for the editor's `gbti-prepared-change` event. The workspace re-creates the editor from its own
 * `_editing` on every repaint, so the prepared state (and, after a save, the saved project) is written back there,
 * and a saved listing's hash becomes `#prepare=<id>` so a reload reopens it rather than a blank form.
 */
export function preparedChanged(ws, detail = {}) {
  const e = ws?._editing;
  if (!e) return;
  e.prepared = detail?.prepared ? { ...detail.prepared } : null;
  if (detail?.frontmatter && typeof detail.frontmatter === 'object') {
    e.frontmatter = { ...detail.frontmatter };
    e.body = typeof detail.body === 'string' ? detail.body : e.body;
  }
  if (isListingId(detail?.prepared?.id)) ws._writeHash?.(`#prepare=${detail.prepared.id}`);
}

// ---- campaigns -------------------------------------------------------------------------------------------------

/** The active campaigns from the coupon registry, as `{ code, freeDays }`, upper case codes, each once. */
export function activeCampaigns(coupons) {
  const seen = new Set();
  const out = [];
  for (const c of Array.isArray(coupons) ? coupons : []) {
    if (!c || c.active === false || !c.code) continue;
    const code = String(c.code).toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);
    out.push({ code, freeDays: Number.isFinite(Number(c.freeDays)) ? Number(c.freeDays) : null });
  }
  return out;
}

/** The campaigns, read once per editor element. A failed read is an empty list, never a retry from render(). */
export async function preparedCampaigns(editor) {
  if (!editor._prepCampaigns) {
    editor._prepCampaigns = Promise.resolve()
      .then(() => editor.client?.couponPool?.())
      .then((r) => activeCampaigns(r?.coupons))
      .catch(() => []);
  }
  editor._prepCampaignList = await editor._prepCampaigns;
  return editor._prepCampaignList;
}

// ---- markup ----------------------------------------------------------------------------------------------------

// Hiding is by the host class, with !important, because several of these carry an explicit display (an `.ebtn` is
// inline-flex, `.fld` is flex) that would beat the hidden attribute in a shadow root. Every button class here names
// its own hover background: BASE_CSS gives a bare `button:hover` the brand green, which outranks one class.
export const PREPARED_CSS = `
  :host(.prep-on) #publish, :host(.prep-on) #draft, :host(.prep-on) #preview, :host(.prep-on) #secAuthorNote, :host(.prep-on) .visfield { display:none !important; }
  :host(:not(.prep-on)) #prepsave, :host(:not(.prep-on)) #prepcard { display:none !important; }
  .preptoggle[hidden], .prepcard [hidden] { display:none !important; }
  .preptoggle .pt-row { display:flex; gap:10px; align-items:flex-start; margin:0; padding:13px 16px; cursor:pointer; color:var(--s-fg); font-size:13.5px; line-height:1.4; }
  .preptoggle input[type="checkbox"] { width:auto; margin:2px 0 0; padding:0; flex:none; accent-color:var(--s-green); }
  .preptoggle .pt-txt { display:flex; flex-direction:column; gap:3px; }
  .preptoggle .pt-sub { font-size:12px; line-height:1.5; color:var(--s-fg-mute); }
  .prepcard .pfld { display:flex; flex-direction:column; gap:5px; }
  .prepcard label { margin:0; font-size:12px; font-weight:600; color:var(--s-fg-mute); }
  .prepcard input, .prepcard select, .prepcard textarea { width:100%; box-sizing:border-box; font:inherit; font-size:13.5px; color:var(--s-fg); background:var(--s-surface-2); border:1.5px solid var(--s-line-2); border-radius:8px; padding:8px 10px; }
  .prepcard textarea { min-height:120px; resize:vertical; line-height:1.5; font-family:inherit; }
  .prepcard input:focus, .prepcard select:focus, .prepcard textarea:focus { outline:none; border-color:var(--s-green); background:var(--s-surface); }
  .prepcard input[readonly], .prepcard select[disabled] { color:var(--s-fg-soft); }
  .prepcard .plinkval { font-family:var(--font-mono, monospace); font-size:12px; }
  .prepcard .pnote { font-size:12px; line-height:1.5; color:var(--s-fg-mute); margin:0; }
  .prepcard .pnote.warn { color:var(--s-amber-fg, #8a5500); }
  .prepcard .plink { display:flex; flex-direction:column; gap:7px; padding-top:4px; border-top:1px solid var(--s-line); }
  .prepcard .pbtns { display:flex; gap:7px; flex-wrap:wrap; }
  .prepbtn { font:inherit; font-size:12.5px; font-weight:700; color:var(--s-fg); background:var(--s-surface); border:1.5px solid var(--s-line-2); border-radius:7px; padding:5px 12px; cursor:pointer; }
  .prepbtn:hover { background:var(--s-surface-2); color:var(--s-green-fg); border-color:var(--s-green); }
  .prepbtn:focus-visible { outline:2px solid var(--s-green); outline-offset:2px; }
  .ebtn.prepsave { background:var(--accent); border-color:var(--accent); color:var(--on-accent); }
  .ebtn.prepsave:hover { background:var(--accent); border-color:var(--s-fg); color:var(--on-accent); }
`;

/** The toolbar's Save listing button. Shown only in prepared mode (the host class), beside the hidden Publish. */
export function preparedToolbarHtml() {
  return '<button class="ebtn prepsave" id="prepsave" type="button">Save listing</button>';
}

/** The rail toggle that turns a new project into a prepared one. */
export function preparedToggleHtml(on) {
  return `<section class="rcard preptoggle" id="preptoggle">
    <label class="pt-row"><input type="checkbox" id="prepon"${on ? ' checked' : ''} /><span class="pt-txt"><b>Prepare for someone who is not a member yet</b><span class="pt-sub">Saved privately with a personal invitation. They claim it under their own name with a free year and write their own author note.</span></span></label>
  </section>`;
}

const bindingLockedFor = (p) => isListingId(p?.id) && !['issued', 'revoked', 'expired'].includes(String(p?.inviteState || ''));

/**
 * The "Prepared for" rail card: the greeting name, the optional GitHub account, the personal message, the campaign,
 * and once saved the invitation link with Copy and Open. `p` null renders the card empty, hidden until the toggle.
 */
export function preparedCardHtml(p, campaigns = []) {
  const s = p || blankPrepared();
  const saved = isListingId(s.id);
  const revoked = s.state === 'revoked';
  const locked = bindingLockedFor(s);
  const camps = Array.isArray(campaigns) ? campaigns : [];
  const opt = (c, sel) => `<option value="${esc(c.code)}"${sel ? ' selected' : ''}>${esc(c.code)}${c.freeDays ? ` (${esc(String(c.freeDays))} free days)` : ''}</option>`;
  const chosen = s.campaign || camps[0]?.code || '';
  const campaignField = saved
    ? `<select id="prep-camp" data-prep="campaign" disabled>${opt({ code: s.campaign, freeDays: camps.find((c) => c.code === s.campaign)?.freeDays }, true)}</select>
       <p class="pnote">The campaign is fixed while this invitation is out. To change it, revoke the invitation and send it again with another campaign.</p>`
    : camps.length
      ? `<select id="prep-camp" data-prep="campaign">${camps.map((c) => opt(c, c.code === chosen)).join('')}</select>
         <p class="pnote">The free year the invitation carries.</p>`
      : `<select id="prep-camp" data-prep="campaign"><option value="">No active campaign</option></select>
         <p class="pnote warn">Activate a campaign in Admin, Coupons first. The invitation needs one for its free year.</p>`;
  const status = !saved
    ? '<p class="pnote">Nothing is sent. Save listing stores this project privately and gives you an invitation link to send yourself.</p>'
    : revoked
      ? '<p class="pnote warn">This invitation is revoked, so its link no longer works. Edits still save; Send again in the invite manager gives it a new link.</p>'
      : '';
  const link = saved && !revoked && s.link
    ? `<div class="plink"><label for="prep-link">Invitation link</label><input id="prep-link" class="plinkval" readonly value="${esc(s.link)}" />
        <div class="pbtns"><button type="button" class="prepbtn" data-prep-copy>Copy link</button><button type="button" class="prepbtn" data-prep-open>Open</button></div>
        <p class="pnote">Send it yourself; nothing is emailed. Opening it while signed in as you shows the page without a Publish button.</p></div>`
    : '';
  return `<section class="rcard prepcard" id="prepcard">
    <div class="rcard-h"><span class="rcard-t">Prepared for</span></div>
    <div class="rcard-b">
      ${status}
      <div class="pfld"><label for="prep-name">Greeting name</label><input id="prep-name" data-prep="recipientName" type="text" maxlength="${MAX_RECIPIENT_NAME}" autocomplete="off" placeholder="Sam" value="${esc(s.recipientName)}" /></div>
      <div class="pfld"><label for="prep-login">GitHub account (optional)</label><input id="prep-login" data-prep="githubLogin" type="text" maxlength="40" autocomplete="off" spellcheck="false" placeholder="@their-login" value="${esc(s.githubLogin)}"${locked ? ' readonly' : ''} />
        <p class="pnote">${locked ? 'The free year was already taken through this link, so the account it is tied to can no longer change.' : 'Ties the invitation to that one account. Leave it empty and whoever opens the link first can claim it.'}</p></div>
      <div class="pfld"><label for="prep-msg">Personal message</label><textarea id="prep-msg" data-prep="message" maxlength="${MAX_MESSAGE}" placeholder="Why you thought of them, in your own words.">${esc(s.message)}</textarea>
        <p class="pnote">Shown to them as plain text above the listing, after a greeting the page adds on its own ("Hi Sam,"), so start after the greeting. Their author note is theirs to write when they claim it.</p></div>
      <div class="pfld"><label for="prep-camp">Campaign</label>${campaignField}</div>
      ${link}
    </div>
  </section>`;
}

/**
 * The prepared markup for one render, as `{ toolbar, rail }`. Empty unless prepared mode is on or on offer. A blank
 * prepared state that the caller may not use (not a superadmin, or not a new project) is dropped here, so a deep link
 * cannot put a member in a mode whose every save the Worker would refuse.
 */
export async function preparedParts(editor) {
  const offer = canOfferPrepare({ role: editor._statusRole, type: editor.type, itemPath: editor.itemPath, prepared: editor._prepared, client: editor.client });
  if (editor._prepared && !isListingId(editor._prepared.id) && !offer) editor._prepared = null;
  if (!offer && !editor._prepared) return { toolbar: '', rail: '' };
  const campaigns = await preparedCampaigns(editor);
  return {
    toolbar: preparedToolbarHtml(),
    rail: (offer ? preparedToggleHtml(Boolean(editor._prepared)) : '') + preparedCardHtml(editor._prepared, campaigns),
  };
}

// ---- save --------------------------------------------------------------------------------------------------------

// Fields the save never forwards inside the project. The first three are the claimant's or do not exist yet; the rest
// are the Worker's to set at the claim (it strips them too, so this only keeps the stored copy honest).
const NEVER_IN_PROJECT = ['authorNote', 'authorTarget', 'path', 'type', 'author', 'status', 'visibility', 'publishedAt', 'updatedAt', 'contributors', 'redirectFrom'];

/** Why the invitation fields cannot be saved yet, as a sentence, or null. The Worker re-checks all of it. */
export function preparedTextProblem(p) {
  const t = validateInvitationText({ recipientName: p?.recipientName, message: p?.message });
  if (!t.ok) return t.message;
  if (!isListingId(p?.id) && !String(p?.campaign || '').trim()) return 'Choose the campaign whose free year the invitation carries.';
  const login = String(p?.githubLogin || '').trim();
  if (login && !normalizeGithubLogin(login)) return 'That is not a GitHub account name. Use letters, digits and single hyphens, or leave it empty.';
  return null;
}

/**
 * The body for `client.preparedSave`. Creating (no listing id) sends the campaign and a GitHub account only when one
 * was given (blank means first come). Editing sends the id, never the campaign (it is fixed while the invitation is
 * out), and always the account field, where blank unties and the stored login leaves the binding as it is.
 */
export function buildPreparedPayload({ prepared, gathered } = {}) {
  const p = prepared || {};
  const input = gathered?.input && typeof gathered.input === 'object' ? { ...gathered.input } : {};
  for (const k of NEVER_IN_PROJECT) delete input[k];
  const slug = String(input.slug ?? '').trim();
  const creating = !isListingId(p.id);
  const login = String(p.githubLogin ?? '').trim();
  return {
    op: 'save',
    ...(creating ? { campaign: String(p.campaign ?? '').trim().toUpperCase() } : { id: p.id }),
    recipientName: String(p.recipientName ?? ''),
    message: String(p.message ?? ''),
    ...(creating ? (login ? { githubLogin: login } : {}) : { githubLogin: login }),
    draft: { type: 'project', slug, frontmatter: input, body: String(gathered?.body ?? '') },
    stagedItem: `project:${slug}`,
  };
}

/** The prepared state after a successful save, from the Worker's `{ listing, code, link }`. */
export function preparedAfterSave(p, res) {
  const row = res?.listing && typeof res.listing === 'object' ? res.listing : {};
  return {
    id: isListingId(row.id) ? row.id : (isListingId(p?.id) ? p.id : null),
    code: typeof res?.code === 'string' ? res.code : (p?.code ?? null),
    link: typeof res?.link === 'string' ? res.link : (p?.link ?? null),
    state: row.state || p?.state || null,
    inviteState: row.inviteState || p?.inviteState || null,
    githubLogin: row.bound === true ? (row.boundLogin || p?.githubLogin || '') : (row.bound === false ? '' : (p?.githubLogin ?? '')),
    campaign: row.campaign || p?.campaign || '',
    recipientName: typeof row.recipientName === 'string' && row.recipientName ? row.recipientName : (p?.recipientName ?? ''),
  };
}

/** Fold the card's live field values into the prepared state (a disabled or read-only field keeps its stored value). */
function readPreparedInputs(editor) {
  const p = editor?._prepared;
  if (!p) return null;
  for (const el of editor.$$?.('[data-prep]') || []) {
    if (el.disabled || el.readOnly) continue;
    p[el.dataset.prep] = el.value;
  }
  return p;
}

/**
 * Save the listing: validate the invitation fields, gather the project, send the allow-listed payload, then show the
 * invitation link. Returns the Worker's answer, or null when nothing was sent or the save was refused.
 */
export async function savePrepared(editor, client = editor?.client) {
  const p = readPreparedInputs(editor);
  if (!p) return null;
  if (typeof client?.preparedSave !== 'function') { editor.out('Prepared listings are saved from the website WorkBench.', 'danger'); return null; }
  const problem = preparedTextProblem(p);
  if (problem) { editor.out(esc(problem), 'danger'); return null; }
  let gathered;
  try { gathered = editor.gather(); } catch (err) { editor.out(esc(failHint(err).text), 'danger'); return null; }
  const payload = buildPreparedPayload({ prepared: p, gathered });
  if (!payload.draft.slug) { editor.out('Give the project a permalink before saving it.', 'danger'); return null; }
  const restore = editor._btnBusy?.('#prepsave', 'Saving…') || (() => {});
  editor._setChip?.('Saving…', 'busy');
  try {
    const res = await client.preparedSave(payload);
    Object.assign(p, preparedAfterSave(p, res));
    editor._setChip?.('Saved', 'ok');
    editor.out(`<span class="tag ok">saved</span> ${esc(res?.created
      ? 'Saved privately with its invitation. Copy the link from the Prepared for card and send it yourself.'
      : 'Saved. The invitation link has not changed.')}`);
    refreshPreparedCard(editor);
    editor.emit?.('gbti-prepared-change', { prepared: { ...p }, frontmatter: payload.draft.frontmatter, body: payload.draft.body });
    return res;
  } catch (err) {
    editor._setChip?.('');
    const text = failHint(err).text;
    editor._banner?.(esc(text), 'danger');
    editor.out(esc(text), 'danger');
    return null;
  } finally {
    restore();
  }
}

// ---- wiring ------------------------------------------------------------------------------------------------------

/** Turn prepared mode on or off for a new project. A saved listing stays a listing. */
export function setPreparedMode(editor, on) {
  if (on) {
    editor._prepared = editor._prepared || editor._prepStash || blankPrepared();
    editor._prepStash = null;
    readPreparedInputs(editor);
    editor.out?.('Prepared mode: Save listing stores the project privately with an invitation. Publish and the author note are hidden, because the person you invite writes their own note when they claim it.');
  } else {
    if (isListingId(editor._prepared?.id)) return;
    editor._prepStash = editor._prepared;
    editor._prepared = null;
    editor.out?.('');
  }
  editor.classList?.toggle?.('prep-on', Boolean(editor._prepared));
  editor.emit?.('gbti-prepared-change', { prepared: editor._prepared ? { ...editor._prepared } : null });
}

function wireCard(editor) {
  for (const el of editor.$$('[data-prep]')) {
    const sync = () => { if (editor._prepared && !el.disabled && !el.readOnly) editor._prepared[el.dataset.prep] = el.value; };
    el.addEventListener('input', sync);
    el.addEventListener('change', sync);
  }
  editor.$('[data-prep-copy]')?.addEventListener('click', async (e) => {
    const b = e.currentTarget;
    const link = editor._prepared?.link;
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      b.textContent = 'Copied';
      setTimeout(() => { b.textContent = 'Copy link'; }, 1500);
    } catch { /* the clipboard was refused; the link is in the box above */ }
  });
  editor.$('[data-prep-open]')?.addEventListener('click', () => {
    const link = editor._prepared?.link;
    if (link && typeof window !== 'undefined') window.open(link, '_blank', 'noopener');
  });
}

/** Repaint just the card after a save, so the rest of the editor (and the caret) is left alone. */
function refreshPreparedCard(editor) {
  const card = editor.$?.('#prepcard');
  if (card) card.outerHTML = preparedCardHtml(editor._prepared, editor._prepCampaignList || []);
  const toggle = editor.$?.('#preptoggle');
  if (toggle && isListingId(editor._prepared?.id)) toggle.hidden = true;
  if (editor.$) wireCard(editor);
}

/** The render hook: set the host class, then wire the toggle, the card and the Save listing button. */
export function wirePrepared(editor) {
  editor.classList?.toggle?.('prep-on', Boolean(editor._prepared));
  editor.$('#prepon')?.addEventListener('change', (e) => setPreparedMode(editor, e.currentTarget.checked === true));
  editor.$('#prepsave')?.addEventListener('click', () => savePrepared(editor));
  wireCard(editor);
}

// ---- images ------------------------------------------------------------------------------------------------------

/**
 * A staged-image reader for an open listing: the caller's own staged copy first (an image picked in this session and
 * not yet saved), then the listing's stored copy. `{ dataBase64, contentType }` or null, never a throw, so a miss
 * falls back exactly as the draft path does.
 */
export function preparedImageReader(client, id, item) {
  return async (name) => {
    let staged = null;
    try { staged = await client?.getStagedImage?.(name, item); } catch { staged = null; }
    if (staged?.dataBase64) return staged;
    if (!isListingId(id) || typeof client?.preparedImage !== 'function') return null;
    try {
      const r = await client.preparedImage(id, name);
      return r?.dataBase64 ? { dataBase64: r.dataBase64, contentType: r.contentType || 'image/png' } : null;
    } catch { return null; }
  };
}

/** The client with its staged-image read widened to the listing store; every other method is the client's own. */
export function preparedClient(client, id) {
  if (!client || !isListingId(id)) return client;
  const wrapped = Object.create(client);
  wrapped.getStagedImage = (name, item) => preparedImageReader(client, id, item)(name);
  return wrapped;
}

/** The client the editor reads staged images through: widened for a saved listing, the plain client otherwise. */
export function imageClientFor(editor) {
  return isListingId(editor?._prepared?.id) ? preparedClient(editor.client, editor._prepared.id) : editor?.client;
}
