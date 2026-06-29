// <gbti-welcome> (SOW-029): the post-setup welcome view, mounted by the extension when the onboarding wizard's
// ready button ("Complete Integration") fires gbti:onboarding-start. It tells the member which membership PHASE
// they are in (trial vs paid, from client.status()), then walks them through final-association to-dos:
//   1. Join our Discord (invite link + a self-reported "I have joined" checkbox, persisted in localStorage).
//   2. Follow members (10 per page, randomized once; reuses the SOW-023 follow graph via client.getFollows /
//      setFollow). Following surfaces a member's new work in the Following feed (NOT push notifications).
// Host-agnostic: it consumes only the injected client + a public fetch of /members-index.json, so it runs in
// the extension now and the npm CMS later. Emits gbti:welcome-done when the member finishes.
import { GbtiElement, define, esc } from '../base.mjs';
import { phaseLabel, shuffle, excludeSelf, paginate } from '../welcome-core.mjs';
import { DISCORD_INVITE_URL } from '../discord.mjs';
import './gbti-topic-picker.mjs'; // SOW-054: the followed-topics step control

const SITE = 'https://gbti.network';
const PAGE_SIZE = 10;
const DISCORD_DONE_KEY = 'gbti-welcome-discord-joined';
// The welcome flow is a stepper: one to-do per screen (SOW-029 originally showed them stacked). SOW-054 adds the
// 'topics' step (follow content topics, drives the feed + news default); keep this list as the single source of step order.
const STEPS = ['discord', 'follow', 'topics'];

const lc = (s) => String(s || '').toLowerCase();
const check = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const discordIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.3.5c1.4.4 2 .8 2.8 1.3a11 11 0 0 0-8.9 0c.8-.5 1.5-.9 2.8-1.3L11.2 4A17 17 0 0 0 7 5.4C4.3 9.3 3.6 13.1 3.9 16.8a16 16 0 0 0 4.8 2.4l.6-1c-.5-.2-1-.5-1.6-.9l.4-.3a11 11 0 0 0 9.6 0l.4.3c-.5.4-1 .7-1.6.9l.6 1a16 16 0 0 0 4.8-2.4c.4-4.3-.6-8-2.6-11.4zM9.6 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>`;
// SOW-048: the GitHub mark for the forced-sign-in (login splash) mode.
const githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;
const megaIco = `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" style="margin-right:6px"><path d="M3 11v2a1 1 0 0 0 1 1h2l3.5 3.5V6.5L6 10H4a1 1 0 0 0-1 1zM14 8v8c1.7-.6 3-2.4 3-4s-1.3-3.4-3-4z" fill="currentColor"/></svg>`;

const CSS = `
  :host { display:block; font-family:var(--font-body); color:var(--fg); padding:32px 28px; max-width:680px; margin:0 auto; }
  .head { text-align:center; margin-bottom:22px; }
  .head .ic { display:inline-grid; place-items:center; }
  .phase { display:inline-block; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:.05em;
    color:var(--accent); background:var(--hover); border-radius:999px; padding:3px 11px; margin:10px 0 0; }
  .head h2 { font-family:var(--font-display); font-size:24px; margin:8px 0 6px; }
  .head p { color:var(--muted); margin:0 auto; max-width:46ch; line-height:1.5; }
  .up { display:inline-block; margin-top:10px; font-size:13px; font-weight:700; color:var(--accent); text-decoration:underline; }
  .card { border:1px solid var(--line); border-radius:12px; padding:16px 18px; margin:0 0 14px; background:var(--panel); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
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

class GbtiWelcome extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._page = 1;
    this._step = 0; // SOW-041: the welcome is a one-to-do-per-screen stepper (Discord, then Follow members)
    this.load();
  }

  async load() {
    // SOW-048: in auth-gate mode this element doubles as the extension's LOGIN SPLASH. Phase + own identity + the
    // authenticated flag all come from the one status read.
    this._authGate = this.hasAttribute('auth-gate');
    let s = null;
    try {
      s = await this.client?.status?.();
      this._membership = s?.membership ?? 'unknown';
      this._own = lc(s?.identity?.username || s?.identity?.login);
    } catch {
      this._membership = 'unknown';
      this._own = '';
    }
    this._authenticated = Boolean(s?.authenticated && (s?.identity?.login || s?.identity?.username));
    // Signed-out + auth-gate: show ONLY the sign-in splash; skip every member fetch (they 403 / are pointless).
    if (this._authGate && !this._authenticated) { this._loaded = true; this.render(); return; }
    // The randomized members list (shuffled ONCE so paging does not churn). Fail gracefully if the site is not
    // deployed yet (the JSON 404s) — show a friendly notice, never crash.
    try {
      const res = await fetch(`${SITE}/members-index.json`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      this._members = excludeSelf(shuffle(Array.isArray(data?.members) ? data.members : []), this._own);
    } catch {
      this._members = null; // could not load
    }
    // Pre-mark already-followed members. SOW-060: following is a free-tier perk, so this succeeds for any signed-in
    // member; a throw means the read was unavailable (or a banned/unknown account) -> follows = null.
    try {
      const r = await this.client?.getFollows?.();
      const list = Array.isArray(r) ? r : (r?.following ?? []);
      this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
    } catch {
      this._follows = null; // unavailable -> the follow card shows a retry, not an upgrade notice
    }
    try { this._discordJoined = localStorage.getItem(DISCORD_DONE_KEY) === '1'; } catch { this._discordJoined = false; }
    // Prefer a fresh, bot-minted invite from the Worker; fall back to the static DISCORD_INVITE_URL when the
    // endpoint is unavailable (not provisioned / signed out). The bot token never reaches the page.
    this._discordInviteUrl = DISCORD_INVITE_URL;
    try {
      const inv = await this.client?.discordInvite?.();
      if (inv?.url) this._discordInviteUrl = inv.url;
    } catch { /* keep the static fallback */ }
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
    const verify = this._verifyUri || 'https://github.com/login/device';
    const action = code
      ? `<div class="codebox">
           <p class="sub">Enter this code at GitHub to finish signing in:</p>
           <div class="codeval"><code>${esc(code)}</code><button class="btn ghost" data-copy type="button">Copy</button></div>
           <a class="btn" href="${esc(verify)}" target="_blank" rel="noopener">Open github.com/login/device</a>
           <p class="note" style="margin-top:12px">Waiting for you to authorize&hellip;</p>
         </div>`
      : `<button class="btn signin" data-auth-signin type="button">${githubIco} Sign in with GitHub</button>`;
    // SOW: when the host gates BECAUSE the prior session's token expired (not a fresh sign-in), say so, so the
    // member understands why they are back at the splash instead of in their hub.
    const expired = this.hasAttribute('expired')
      ? `<p class="note" style="margin:0 0 12px; color:var(--accent)">Your session expired. Please sign in again to pick up where you left off.</p>`
      : '';
    this.set(this.css(CSS) + `
      <div class="head">
        <span class="ic">${check}</span>
        <h2>Sign in to GBTI Network</h2>
        <p>The developer co-op. Sign in with your GitHub account to publish articles, products, and prompts, follow members, read the members-only news, and join the community.</p>
      </div>
      <div class="card">
        ${expired}${action}
        <p class="note" style="margin-top:14px">New here? <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a> &mdash; the trial is free.</p>
      </div>`);
    this.on('[data-auth-signin]', 'click', () => this.emit('gbti:welcome-signin'));
    this.on('[data-copy]', 'click', () => { try { navigator.clipboard?.writeText(code); } catch { /* clipboard blocked */ } });
  }

  render() {
    if (!this._loaded) { this.set(this.css(CSS) + `<p class="loading">Setting up your welcome...</p>`); return; }
    if (this._authGate && !this._authenticated) { this._renderSignedOut(); return; } // SOW-048 login splash
    const ph = phaseLabel(this._membership);
    const up = ph.upgrade ? `<a class="up" href="${SITE}/membership/" target="_blank" rel="noopener">Upgrade to publish</a>` : '';
    // SOW-041: one to-do per screen. Show the head once, then the current step's card + a bottom nav.
    if (this._step < 0) this._step = 0;
    if (this._step > STEPS.length - 1) this._step = STEPS.length - 1;
    const step = STEPS[this._step];
    const card = step === 'discord' ? this._discordCard() : step === 'topics' ? this._topicsCard() : this._followCard();
    const isLast = this._step >= STEPS.length - 1;
    const nav = `<div class="stepnav">
      ${this._step > 0 ? `<button class="btn ghost" data-step-back type="button">&larr; Back</button>` : '<span class="grow"></span>'}
      ${isLast
        ? `<button class="btn done" data-done type="button">I am all set</button>`
        : `<button class="btn" data-step-next type="button">Continue &rarr;</button>`}
    </div>`;
    this.set(this.css(CSS) + `
      <div class="head">
        <span class="ic">${check}</span>
        <div class="phase">${esc(ph.phase === 'paid' ? 'Paid membership' : ph.phase === 'trial' ? 'Trial phase' : 'Welcome')}</div>
        <h2>${esc(ph.title)}</h2>
        <p>${esc(ph.body)}</p>
        ${up}
      </div>
      <span class="stepind">Step ${this._step + 1} of ${STEPS.length}</span>
      ${card}
      ${nav}`);

    // Step navigation.
    this.on('[data-step-next]', 'click', () => { this._step++; this.render(); });
    this.on('[data-step-back]', 'click', () => { this._step--; this.render(); });
    this.on('[data-done]', 'click', () => this.emit('gbti:welcome-done'));

    if (step === 'discord') {
      // Use the resolved invite (live bot-minted URL, or the static fallback).
      this.on('[data-discord-join]', 'click', () => window.open(this._discordInviteUrl || DISCORD_INVITE_URL, '_blank', 'noopener'));
      const cb = this.$('[data-discord-cb]');
      if (cb) cb.addEventListener('change', () => {
        this._discordJoined = cb.checked;
        try { cb.checked ? localStorage.setItem(DISCORD_DONE_KEY, '1') : localStorage.removeItem(DISCORD_DONE_KEY); } catch { /* storage blocked */ }
      });
    } else {
      // Follow toggles + paging (the pager's Back/More is within the list, distinct from the step Back).
      this.$$('[data-follow]').forEach((b) => b.addEventListener('click', () => this._toggleFollow(b.getAttribute('data-follow'))));
      this.on('[data-prev]', 'click', () => { this._page--; this.render(); });
      this.on('[data-next]', 'click', () => { this._page++; this.render(); });
      // Avatar fallback: drop a broken image so the letter disc shows through.
      this.$$('.av img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    }
  }

  _discordCard() {
    const done = this._discordJoined ? 'checked' : '';
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
    // SOW-060: following is a FREE perk for any signed-in member, so there is no paywall state here. A null follow
    // list means a transient read failure (or a stale/missing KV overrides mirror for a since-banned account), not
    // a membership gate, so show a retry, never an upgrade prompt.
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
    this._page = page; // clamp
    const rows = items.map((m) => this._row(m)).join('');
    const pager = pages > 1
      ? `<div class="pager"><button data-prev type="button" ${page <= 1 ? 'disabled' : ''}>Back</button>
         <span class="pg">Page ${page} of ${pages}</span>
         <button data-next type="button" ${page >= pages ? 'disabled' : ''}>More</button></div>`
      : '';
    return `<div class="card"><h3>${megaIco} Follow members</h3>${note}<ul class="members">${rows}</ul>${pager}</div>`;
  }

  _row(m) {
    const u = lc(m.username);
    const followed = this._follows.has(u);
    const initial = esc((m.displayName || m.username || '?').trim().charAt(0).toUpperCase());
    const av = m.avatar ? `<span class="ini">${initial}</span><img src="${esc(m.avatar)}" alt="" />` : `<span class="ini">${initial}</span>`;
    const sub = m.headline ? `<span>${esc(m.headline)}</span>` : '';
    return `<li class="m">
      <span class="av">${av}</span>
      <span class="mi"><b>${esc(m.displayName || m.username)}</b>${sub}</span>
      <button class="fbtn ${followed ? 'on' : ''}" data-follow="${esc(u)}" type="button">${followed ? 'Following' : 'Follow'}</button>
    </li>`;
  }

  async _toggleFollow(username) {
    const u = lc(username);
    if (!u || !this._follows) return;
    const was = this._follows.has(u);
    was ? this._follows.delete(u) : this._follows.add(u); // optimistic
    this.render();
    try {
      const r = await this.client.setFollow({ username: u, on: !was });
      const list = Array.isArray(r) ? r : (r?.following ?? null);
      if (list) this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
    } catch {
      was ? this._follows.add(u) : this._follows.delete(u); // revert
    }
    this.render();
  }
}

define('gbti-welcome', GbtiWelcome);
export { GbtiWelcome };
