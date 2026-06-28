// <gbti-subscriptions> (SOW-037; renamed surface "Following"): the member's follow management, shown in the
// workspace "Following" tab. A compact "Your membership" card (client.status()) sits on top, then a sub-tab
// toggle splits Following into two lists:
//   - NETWORK MEMBERS: the follow graph (SOW-023) from client.getFollows(), with an unfollow control per member.
//   - NEWS CHANNELS: the news sources the member follows (SOW-046), from client.getNewsSources() filtered by
//     client.getPrefs().followedChannels, with an unfollow control per channel.
// SOW-060: follows + channel-follows are a FREE-tier perk (any signed-in non-banned member; the Worker is the
// authority, fail-closed). A failed read is a transient error, not a paywall. Host-agnostic + inert in public.
import { GbtiElement, define, esc } from '../base.mjs';

const SITE = 'https://gbti.network';
const MEMBERSHIP = { paid: 'Paid member', trial: 'Trial', trialing: 'Trial' };
const lc = (s) => String(s || '').toLowerCase();
const followList = (r) => (Array.isArray(r) ? r : (r?.following ?? []));

const CSS = `
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

class GbtiSubscriptions extends GbtiElement {
  connectedCallback() {
    this._membership = null;
    this._view = 'members'; // 'members' | 'channels' | 'topics'
    this._follows = null; // array, or null when not loaded / paid-denied
    this._channels = null; // [{ id, name, meta }] followed channels, or null
    this._channelsError = false;
    this._busy = false;
    super.connectedCallback?.();
    this._load();
  }

  async _load() {
    if (!this.client) { this.render(); return; }
    try { this._membership = (await this.client.status())?.membership ?? 'unknown'; } catch { this._membership = 'unknown'; }
    await this._reloadFollows(false);
    this.render();
  }

  async _reloadFollows(rerender = true) {
    try {
      this._follows = followList(await this.client.getFollows()).filter((f) => f && f.username);
    } catch {
      this._follows = null; // SOW-060: a free-tier read failed (unreachable, or a banned/unknown account)
    }
    if (rerender) this.render();
  }

  // SOW-046: the news channels the member follows = the sources whose id is in prefs.followedChannels.
  async _reloadChannels(rerender = true) {
    try {
      if (!this.client.getNewsSources || !this.client.getPrefs) { this._channels = []; return; }
      const [src, prefs] = await Promise.all([this.client.getNewsSources(), this.client.getPrefs()]);
      const sources = (src?.sources || []);
      const followed = new Set((prefs?.followedChannels || []).map(lc));
      this._channels = sources.filter((s) => followed.has(lc(s.id))).map((s) => ({
        id: s.id,
        name: s.name || s.id,
        meta: s.category || s.description || '',
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
    if (v === 'channels' && this._channels === null && !this._channelsError) { this._reloadChannels(true); return; }
    this.render();
  }

  render() {
    if (!this.client) { this.set(this.css(CSS) + `<p class="muted">Sign in with the GBTI client to manage who you follow.</p>`); return; }
    if (this._membership === null) { this.set(this.css(CSS) + `<p class="muted">Loading your follows...</p>`); return; }

    const m = this._membership;
    const label = MEMBERSHIP[m] || (m === 'unknown' ? 'Not signed in' : 'Inactive');
    const card = `<div class="card">
      <div class="who"><b>Your membership</b><span>GBTI Network</span></div>
      <span class="tag ${m === 'paid' ? 'ok' : ''}">${esc(label)}</span>
      <a class="btn" href="${SITE}/membership/" target="_blank" rel="noopener">Manage</a>
    </div>`;

    const subtabs = `<div class="subtabs">
      <button class="subtab ${this._view === 'members' ? 'on' : ''}" data-view="members" type="button">Network members</button>
      <button class="subtab ${this._view === 'channels' ? 'on' : ''}" data-view="channels" type="button">News channels</button>
      <button class="subtab ${this._view === 'topics' ? 'on' : ''}" data-view="topics" type="button">Topics</button>
    </div>`;

    const body = this._view === 'channels' ? this._channelsHtml()
      : this._view === 'topics' ? this._topicsHtml()
        : this._membersHtml();

    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      <section class="sec"><h3>Membership</h3>${card}</section>
      <section class="sec"><h3>Following</h3>${subtabs}${body}</section>
    </div>`);

    this.$$('[data-view]').forEach((b) => b.addEventListener('click', () => this._setView(b.dataset.view)));
    this.$$('[data-avfor]').forEach((img) => img.addEventListener('error', () => { img.style.visibility = 'hidden'; }, { once: true }));
    this.$$('[data-unfollow]').forEach((b) => b.addEventListener('click', () => this._unfollow(b.dataset.unfollow)));
    this.$$('[data-unfollowchan]').forEach((b) => b.addEventListener('click', () => this._unfollowChannel(b.dataset.unfollowchan)));
  }

  _membersHtml() {
    if (this._follows === null) {
      return `<p class="muted">We could not load your follows right now. You can follow members any time from a member profile.</p><div class="find"><a href="${SITE}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
    }
    if (!this._follows.length) {
      return `<p class="muted">You are not following any members yet.</p><div class="find"><a href="${SITE}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
    }
    const rows = this._follows.map((f) => {
      const u = esc(f.username);
      return `<li class="row">
        <img class="av" src="https://github.com/${encodeURIComponent(f.username)}.png?size=60" alt="" loading="lazy" data-avfor="${u}" />
        <a class="nm" href="${SITE}/members/${u}/" target="_blank" rel="noopener">@${u}</a>
        <button class="lk" data-unfollow="${u}" type="button">Unfollow</button>
      </li>`;
    }).join('');
    return `<ul class="rows">${rows}</ul><div class="find"><a href="${SITE}/members/" target="_blank" rel="noopener">Find members to follow &rarr;</a></div>`;
  }

  // SOW-080: followed-topic management moved here from the extension Settings page. The shared <gbti-topic-picker>
  // self-loads /topics.json + self-persists prefs.categories via the global client (base.mjs get client()), so this
  // is a mount-only branch (no per-element wiring, no reload on subtab switch beyond the picker's own load).
  _topicsHtml() {
    return `<p class="muted" style="margin:0 0 12px">Follow the topics you care about. Your activity feed and news prioritize them; leave it empty to see everything.</p><gbti-topic-picker></gbti-topic-picker>`;
  }

  _channelsHtml() {
    if (this._channels === null && this._channelsError) {
      return `<p class="muted">Could not load your news channels right now.</p>`;
    }
    if (this._channels === null) { return `<p class="muted">Loading news channels...</p>`; }
    if (!this._channels.length) {
      return `<p class="muted">You are not following any news channels yet. Open <b>News &rarr; Channels</b> to follow sources, and they show up here.</p>`;
    }
    const rows = this._channels.map((c) => {
      const id = esc(c.id);
      const ini = esc((c.name || '?').trim().charAt(0).toUpperCase() || '#');
      const meta = c.meta ? `<span class="d">${esc(c.meta)}</span>` : '';
      return `<li class="row">
        <span class="ico">${ini}</span>
        <span class="nm">${esc(c.name)}${meta}</span>
        <button class="lk" data-unfollowchan="${id}" type="button">Unfollow</button>
      </li>`;
    }).join('');
    return `<ul class="rows">${rows}</ul>`;
  }

  async _unfollow(username) {
    this._busy = true; this.render();
    try { this._follows = followList(await this.client.setFollow({ username, on: false })).filter((f) => f && f.username); }
    catch { await this._reloadFollows(false); }
    this._busy = false; this.render();
  }

  async _unfollowChannel(id) {
    this._busy = true; this.render();
    try {
      const prefs = await this.client.setPrefs({ followChannel: { id, on: false } });
      const followed = new Set((prefs?.followedChannels || []).map(lc));
      this._channels = (this._channels || []).filter((c) => followed.has(lc(c.id)));
    } catch { await this._reloadChannels(false); }
    this._busy = false; this.render();
  }
}

define('gbti-subscriptions', GbtiSubscriptions);
export { GbtiSubscriptions };
