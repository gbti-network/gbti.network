// <gbti-workspace> (SOW-033): the member's management surface inside the extension. A tabbed view of everything
// they own (Articles / Prompts / Products) plus their pull requests with live gate status, and a pinned profile
// row. Each content row opens the item IN PLACE in an embedded <gbti-content-editor> (open-inside-the-extension,
// the SOW-031 tie), reusing the exact gbti-content-list -> editor.load flow. PR rows classify into Proposed /
// Needs changes / Accepted / Declined via the pure classifyPull helper. Host-agnostic (consumes only the
// injected client) so it runs in the extension now and the npm CMS later. Fail-soft: every read falls back to an
// empty state, never throws.
import { GbtiElement, define, esc, getIdentity } from '../base.mjs';
import { classifyPull, classifyDraft, parseWorkspaceTab, parseWorkspaceNew } from '../workspace-core.mjs';
import { wbCacheGet, wbCacheSet, wbCacheInvalidateMany } from '../workbench-cache.mjs'; // SOW-073: SWR workbench cache

const WB_CONTENT_TYPES = new Set(['post', 'prompt', 'product']); // SOW-073: types whose publish invalidates a tab
import { glyphFor } from '../cat-glyph.mjs'; // SOW-062: the SOW-049 type glyph, reused on the WorkBench list rows
import './gbti-content-editor.mjs';
import './gbti-contrib-inbox.mjs';
import './gbti-contrib-review.mjs';
import './gbti-saved.mjs';
import './gbti-subscriptions.mjs';

const TABS = [
  { id: 'overview', label: 'Overview' }, // SOW-052: the WorkBench hub (tiles + counts + PRs needing attention)
  { id: 'post', label: 'Articles', type: 'post' },
  { id: 'prompt', label: 'Prompts', type: 'prompt' },
  { id: 'product', label: 'Products', type: 'product' },
  { id: 'drafts', label: 'Drafts' }, // SOW-082: fork-staged drafts (Save -> review -> Publish)
  { id: 'prs', label: 'Pull requests' },
  { id: 'inbox', label: 'Inbox' },
  { id: 'saved', label: 'Saved' }, // SOW-037: favorites + collections
  { id: 'subs', label: 'Following' }, // SOW-037: follows + membership (network members + news channels)
  { id: 'earnings', label: 'Earnings' }, // SOW-052: placeholder for referrals + rewards (SOW-007/008)
];

// SOW-052: the overview tiles — each is a section of the WorkBench. `count` is filled from the loaded data;
// `href` deep-links (the workbench rail + the element both honor #tab=). Settings/Admin are separate pages.
const MEMBERSHIP_LABEL = { paid: 'Paid member', trial: 'Trial', trialing: 'Trial', expired: 'Expired', cancelled: 'Cancelled', none: 'Not a member', banned: 'Suspended', unknown: 'Not signed in' };

const CSS = `
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
  .ov-trial { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; border:1px solid var(--accent); border-radius:2px; padding:13px 16px; background:color-mix(in srgb, var(--accent) 9%, var(--panel)); margin:0 0 16px; }
  .ov-trial b { font-size:13.5px; }
  .ov-trial span { font-size:12.5px; color:var(--muted); }
  .ov-trial .ov-up { flex:none; font-weight:700; font-size:12.5px; padding:7px 14px; border-radius:2px; background:var(--accent); color:#fff; text-decoration:none; white-space:nowrap; }
  .ov-trial .ov-up:hover { filter:brightness(1.05); }
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

class GbtiWorkspace extends GbtiElement {
  connectedCallback() {
    // Initialize state BEFORE super.connectedCallback(), which synchronously calls render() (base.mjs) -> _body()
    // dereferences this._cache/_tab, so they must exist first; otherwise a TypeError aborts the whole mount and
    // the workspace renders nothing. (Same fix as gbti-browse.)
    // SOW-036 P4: open on the tab named by the deep-link hash (workspace.html#tab=prompt), falling back to 'post'.
    // Lets the avatar menu route the member straight to "My prompts" / "My products" / "My pull requests".
    this._tab = (typeof location !== 'undefined' && parseWorkspaceTab(location.hash)) || 'overview'; // SOW-052 default
    this._cache = {};   // type -> items[]
    this._prs = null;   // { prs }
    this._overview = null; // SOW-052: { membership, role, counts, attention[] }
    // SOW-064: a #new=<type> deep-link (from the "+" quick-create menu) opens a BLANK editor for that content type,
    // so the member lands straight in a new article/prompt/product. Empty frontmatter + body = a blank form.
    const newType = (typeof location !== 'undefined' && parseWorkspaceNew(location.hash)) || null;
    this._editing = newType ? { type: newType, frontmatter: {}, body: '' } : null;
    this._page = 0; // SOW-062: the current content-list page (client-side paging; resets on tab switch)
    this._reviewing = null; // SOW-028: the PR number being reviewed in the drill-in, or null
    this._inboxCount = null; // SOW-028 P5: count of contributions awaiting review, for the Inbox tab badge
    super.connectedCallback?.(); // base now renders the initial view with fields in place
    this._loadProfile();
    this._ensureTab(this._tab);
    this._loadInboxCount();
    // SOW-052: the WorkBench rail deep-links to #tab=<id>; switch the tab on a same-document hash change.
    this._onHash = () => {
      // SOW-064: a #new=<type> deep-link opens a blank editor (unless one is already open).
      const nt = (typeof location !== 'undefined' && parseWorkspaceNew(location.hash)) || null;
      if (nt && !this._editing && this._reviewing == null) { this._editing = { type: nt, frontmatter: {}, body: '' }; this.render(); return; }
      const t = (typeof location !== 'undefined' && parseWorkspaceTab(location.hash)) || 'overview';
      if (t !== this._tab && !this._editing && this._reviewing == null) { this._tab = t; this._page = 0; this.render(); this._ensureTab(t); }
    };
    if (typeof window !== 'undefined') window.addEventListener('hashchange', this._onHash);
    this._wireStorageSync(); // SOW-073: cross-tab cache invalidation sync
  }

  disconnectedCallback() {
    if (typeof window !== 'undefined' && this._onHash) window.removeEventListener('hashchange', this._onHash);
    try { if (this._onStorage) globalThis.chrome?.storage?.onChanged?.removeListener?.(this._onStorage); } catch { /* ignore */ }
    super.disconnectedCallback?.();
  }

  // SOW-052: load the overview hub data — content counts (+ drafts), PR + saved + follow counts, membership, and
  // the "needs attention" PR list. Fail-soft: every read defaults to 0/empty, never throws. Reuses _cache/_prs.
  async _ensureOverview() {
    // Re-fetch if the cached snapshot was built while the session looked UNAUTHENTICATED. Caching that empty
    // "Not signed in / 0" state permanently (e.g. it first rendered under a momentarily-dead token) was the
    // WorkBench-shows-nothing bug: the data layer recovered but the frozen snapshot never did.
    if (this._overview && this._overview._trusted) return;
    // SOW-073: paint a cached overview snapshot INSTANTLY (no zero-counts flash) before the seven-call revalidate.
    if (!this._overview) {
      const ck = await this._memberKey();
      const cached = ck ? await wbCacheGet(ck, 'overview') : null;
      if (cached?.items?.[0]) { this._overview = cached.items[0]; if (this._tab === 'overview' && !this._editing) this.render(); }
    }
    const num = (p) => Promise.resolve(p).then((v) => v).catch(() => null); // tolerate a missing client method (undefined)
    const [post, prompt, product, prs, activity, follows, status] = await Promise.all([
      num(this.client?.listContent?.({ type: 'post' })),
      num(this.client?.listContent?.({ type: 'prompt' })),
      num(this.client?.listContent?.({ type: 'product' })),
      num(this.client?.listPRs?.()),
      num(this.client?.getActivity?.()),
      num(this.client?.getFollows?.()),
      num(this.client?.status?.()),
    ]);
    const items = (r) => (Array.isArray(r?.items) ? r.items : []);
    this._cache.post = items(post); this._cache.prompt = items(prompt); this._cache.product = items(product);
    this._prs = Array.isArray(prs?.prs) ? prs.prs : (this._prs || []);
    const drafts = [...items(post), ...items(prompt), ...items(product)].filter((it) => it.status === 'draft').length;
    const favs = (activity?.favorites?.length || 0) + (activity?.collections?.length || 0);
    const followN = Array.isArray(follows) ? follows.length : (follows?.following?.length || 0);
    const attention = (this._prs || [])
      .map((pr) => ({ pr, c: classifyPull(pr, null) }))
      .filter(({ pr, c }) => c.label === 'Declined' || (pr.state !== 'closed' && pr.merged !== true)) // declined or still open
      .slice(0, 6)
      .map(({ pr, c }) => ({ title: pr.title || `PR #${pr.number}`, url: pr.html_url || '', label: c.label, tone: c.tone }));
    // `_trusted` = the status read came back authenticated. Only a trusted snapshot is cached permanently; an
    // untrusted one renders once (so the hub is not blank) but is re-fetched on the next call + the retry below.
    const trusted = !!(status && status.authenticated !== false);
    this._overview = {
      membership: status?.membership || 'unknown',
      role: status?.role || 'member',
      counts: { post: items(post).length, prompt: items(prompt).length, product: items(product).length, prs: (this._prs || []).length, saved: favs, subs: followN, drafts },
      attention,
      _trusted: trusted,
    };
    // SOW-073: persist a TRUSTED snapshot (+ the per-type lists this call already fetched) so the next open is instant.
    if (trusted) {
      const ck = await this._memberKey();
      if (ck) {
        wbCacheSet(ck, 'overview', [this._overview], { allowEmpty: true });
        wbCacheSet(ck, 'post', this._cache.post, { allowEmpty: true });
        wbCacheSet(ck, 'prompt', this._cache.prompt, { allowEmpty: true });
        wbCacheSet(ck, 'product', this._cache.product, { allowEmpty: true });
        if (Array.isArray(this._prs)) wbCacheSet(ck, 'prs', this._prs, { allowEmpty: true });
      }
    }
    if (this._tab === 'overview' && !this._editing) this.render();
    // Self-heal: if the session looked unauthenticated (a token that may have since recovered/refreshed), retry
    // ONCE shortly so the hub fills in without a manual page refresh.
    if (!trusted && !this._overviewRetried) {
      this._overviewRetried = true;
      setTimeout(() => { this._overview = null; this._ensureOverview(); }, 2000);
    }
  }

  // SOW-028 P5: poll the incoming-contribution count on open (batch-first, like the rest of the client) so the
  // Inbox tab carries a "N to review" badge without the member having to open it. Fail-soft to no badge.
  async _loadInboxCount() {
    try { this._inboxCount = (await this.client?.listContributions?.())?.contributions?.length ?? 0; }
    catch { this._inboxCount = 0; }
    if (!this._editing && this._reviewing == null) this.render();
  }

  // ----- data loaders (each fail-soft to an empty state, like gbti-content-list/gbti-pr-list) -----
  async _loadProfile() {
    try {
      const items = (await this.client?.listContent?.({ type: 'profile' }))?.items ?? [];
      this._profile = items[0] || null;
    } catch { this._profile = null; }
    if (!this._editing) this.render();
  }

  async _ensureTab(id) {
    const tab = TABS.find((t) => t.id === id);
    if (!tab) return;
    if (id === 'overview') { this._ensureOverview(); return; } // SOW-052
    if (id === 'earnings') return; // SOW-052: static placeholder, nothing to load
    // The Inbox / Saved / Subscriptions tabs are self-loading elements (they fetch their own data on connect),
    // so there is nothing to preload here; render() already mounted them. Returning avoids a redundant render.
    if (id === 'inbox' || id === 'saved' || id === 'subs') return;
    if (id === 'drafts') { await this._loadDrafts(id); return; } // SOW-082
    if (tab.type) { await this._swrContent(id, tab.type); return; }
    if (id === 'prs') { await this._swrPrs(id); }
  }

  /** SOW-073: the per-member cache key (immutable github_id, falling back to login). Cached after the first read. */
  async _memberKey() {
    if (this._mk !== undefined) return this._mk;
    try { const id = await getIdentity(); this._mk = (id?.githubId || id?.login) ? String(id.githubId || id.login) : null; }
    catch { this._mk = null; }
    return this._mk;
  }

  // SOW-073: stale-while-revalidate a content tab. Paint the cached items INSTANTLY (no "Loading"/"none" flash),
  // then revalidate in the background and re-render only if the fresh result differs. Within a session the in-memory
  // this._cache[type] is the fast path (a tab revisit does not refetch); the persistent cache hydrates the FIRST
  // access of a session (so a reload is instant too). A genuinely-empty list (the success path) is cached as [].
  async _swrContent(id, type) {
    if (this._cache[type]) return; // already loaded this session
    const key = await this._memberKey();
    let fresh = false;
    if (key) {
      const cached = await wbCacheGet(key, type);
      if (cached) {
        this._cache[type] = cached.items;
        if (this._tab === id && !this._editing) this.render(); // instant paint from cache
        fresh = cached.fresh;
      }
    }
    if (fresh) return; // fresh enough: skip the revalidate
    try {
      const items = (await this.client?.listContent?.({ type }))?.items ?? [];
      const changed = !this._cache[type] || JSON.stringify(this._cache[type]) !== JSON.stringify(items);
      this._cache[type] = items;
      if (key) await wbCacheSet(key, type, items, { allowEmpty: true }); // success path: [] means truly none
      if (changed && this._tab === id && !this._editing) this.render();
    } catch {
      if (!this._cache[type]) this._cache[type] = []; // no cache + fetch failed -> empty (prior behavior)
      if (this._tab === id && !this._editing) this.render();
    }
  }

  // SOW-073: SWR for the PR tab (cached as the 'prs' pseudo-type). The per-PR gate labels still resolve live via
  // _loadPrStatuses after the list paints (their server-side inlining is SOW-073 P4).
  async _swrPrs(id) {
    if (this._prs) { if (id === 'prs') this._loadPrStatuses(); return; } // loaded this session
    const key = await this._memberKey();
    let fresh = false, painted = false;
    if (key) {
      const cached = await wbCacheGet(key, 'prs');
      if (cached) {
        this._prs = cached.items; painted = true;
        if (this._tab === id && !this._editing) this.render();
        if (id === 'prs') this._loadPrStatuses();
        fresh = cached.fresh;
      }
    }
    if (fresh) return;
    try {
      const prs = (await this.client?.listPRs?.())?.prs ?? [];
      const changed = !painted || JSON.stringify(this._prs) !== JSON.stringify(prs);
      this._prs = prs;
      if (key) await wbCacheSet(key, 'prs', prs, { allowEmpty: true });
      if (changed) {
        if (this._tab === id && !this._editing) this.render();
        if (id === 'prs') this._loadPrStatuses();
      }
    } catch {
      if (!this._prs) { this._prs = []; if (this._tab === id && !this._editing) this.render(); }
    }
  }

  // SOW-082: load the member's fork-staged drafts (in-memory per session; the staged set changes on save/publish/
  // discard, so it is invalidated there rather than persistently cached). `this._drafts` null = loading.
  async _loadDrafts(id) {
    if (this._drafts) return; // already loaded this session
    try {
      this._drafts = (await this.client?.listDrafts?.())?.drafts ?? [];
    } catch {
      this._drafts = [];
    }
    if (this._tab === id && !this._editing) this.render();
  }

  // SOW-082: a Save-draft from the embedded editor changed the staged set (+ the overview count). Drop the in-memory
  // drafts + overview so the next visit reloads. The editor stays open after a save, so the refresh lands on return.
  async _onDraftSaved() {
    this._drafts = null;
    this._overview = null;
    const key = await this._memberKey();
    if (key) await wbCacheInvalidateMany(key, ['overview']);
    if (!this._editing) this._ensureTab(this._tab);
  }

  // SOW-073: a just-published/edited content type invalidates that type + the Overview snapshot + the PR list (a
  // publish opens a PR), in BOTH the in-memory and the persistent cache, then refetches what the member will see.
  async _onPublished(type) {
    const t = type && WB_CONTENT_TYPES.has(type) ? type : null;
    if (t) delete this._cache[t];
    this._overview = null;
    this._prs = null;
    this._drafts = null; // SOW-082: a publish moves a draft Staged -> Submitted
    const key = await this._memberKey();
    if (key) await wbCacheInvalidateMany(key, [t, 'overview', 'prs'].filter(Boolean));
    if (!this._editing) this._ensureTab(this._tab); // refresh the visible tab (skip while still in the editor)
  }

  // SOW-073: if ANOTHER extension page invalidates this member's cache (e.g. a publish in a second workbench tab),
  // chrome.storage.onChanged fires here. React ONLY to REMOVALS (an invalidation), never to our own cache writes (a
  // revalidate SET), so this can never loop. Drops the in-memory caches + refetches the open tab.
  _wireStorageSync() {
    try {
      const oc = globalThis.chrome?.storage?.onChanged;
      if (!oc?.addListener) return;
      this._onStorage = async (changes, area) => {
        if (area !== 'local') return;
        const key = await this._memberKey();
        if (!key) return;
        const prefix = `gbti:wb:${key}:`;
        const removed = Object.entries(changes || {}).some(([k, c]) => k.startsWith(prefix) && c && c.newValue === undefined);
        if (!removed) return;
        this._cache = {}; this._prs = null; this._overview = null;
        if (!this._editing && this._reviewing == null) this._ensureTab(this._tab);
      };
      oc.addListener(this._onStorage);
    } catch { /* no chrome.storage: nothing to sync */ }
  }

  _loadPrStatuses() {
    for (const pr of this._prs || []) {
      // SOW-033 P4: a merged/closed PR is already terminal (classifyPull decides Accepted/Declined from
      // pr.state/merged, ignoring the gate), so label it immediately and skip the per-PR gate fetch — one fewer
      // API call per terminal PR, and the label shows instantly instead of waiting on the network.
      if (pr.merged === true || pr.state === 'closed' || pr.state === 'merged') this._renderPrLabel(pr, null);
      else this._loadPrStatus(pr.number);
    }
  }
  async _loadPrStatus(number) {
    let status = null;
    try { status = await this.client?.prStatus?.({ number }); } catch { /* leave null */ }
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
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to my work</button><gbti-content-editor></gbti-content-editor>`);
      this.on('[data-back]', 'click', () => { this._editing = null; this.render(); });
      const ed = this.$('gbti-content-editor');
      const e = this._editing;
      if (ed?.load) ed.load(e.type, e.frontmatter, e.body);
      // SOW-073: publishing/editing from the embedded editor invalidates the affected type (+ Overview + PRs) so the
      // workbench reflects the change immediately on return, never a stale list.
      ed?.addEventListener('gbti-published', () => this._onPublished(e.type));
      ed?.addEventListener('gbti-draft-saved', () => this._onDraftSaved()); // SOW-082
      return;
    }
    if (this._reviewing != null) {
      // SOW-028 drill-in: review one incoming contribution. On a decision the review element emits
      // `contrib-decided`; we return to the Inbox, which remounts <gbti-contrib-inbox> and refetches, so the
      // decided PR drops off the list.
      this.set(this.css(CSS) + `<button class="btn back" data-back type="button">&larr; Back to inbox</button><gbti-contrib-review number="${esc(this._reviewing)}"></gbti-contrib-review>`);
      this.on('[data-back]', 'click', () => { this._reviewing = null; this.render(); });
      this.$('gbti-contrib-review')?.addEventListener('contrib-decided', () => { this._reviewing = null; this.render(); this._loadInboxCount(); });
      return;
    }
    const tabs = TABS.map((t) => {
      const badge = t.id === 'inbox' && this._inboxCount ? `<span class="tbadge">${esc(this._inboxCount)}</span>` : '';
      return `<button class="tab ${t.id === this._tab ? 'on' : ''}" data-tab="${t.id}" type="button" role="tab" aria-selected="${t.id === this._tab}">${esc(t.label)}${badge}</button>`;
    }).join('');
    this.set(this.css(CSS) + `${this._profileHtml()}<div class="tabs" role="tablist">${tabs}</div><div data-body>${this._body()}</div>`);
    this.$$('[data-tab]').forEach((b) => b.addEventListener('click', () => { this._tab = b.dataset.tab; this.render(); this._ensureTab(this._tab); }));
    this._wireBody();
  }

  _profileHtml() {
    if (!this._profile) return '';
    const f = this._profile.frontmatter || {};
    const name = f.displayName || f.title || this._profile.title || 'Your profile';
    return `<div class="profile"><span class="lbl">Profile</span> <b>${esc(name)}</b><button class="btn" data-profile type="button">Edit profile</button></div>`;
  }

  _body() {
    const tab = TABS.find((t) => t.id === this._tab);
    if (this._tab === 'overview') return this._overviewHtml(); // SOW-052
    if (this._tab === 'earnings') return `<div class="ov-hero"><div><b>Earnings</b><br/><span class="muted">Referral revenue-share and contributor rewards.</span></div></div><p class="empty">Earnings are coming soon. When live, this is where your referral commissions (30% lifetime of members you bring in) and accepted-contribution rewards will show, with payout status. Today you can manage your referral link + membership under <a href="account.html">Settings</a>.</p>`; // SOW-052 placeholder (SOW-007/008)
    // SOW-028: the incoming-contribution review inbox is its own self-loading element. It fetches + renders
    // independently (and is inert with no client), so the workspace just mounts the tag.
    if (this._tab === 'inbox') return `<gbti-contrib-inbox></gbti-contrib-inbox>`;
    if (this._tab === 'saved') return `<gbti-saved></gbti-saved>`; // SOW-037
    if (this._tab === 'subs') return `<gbti-subscriptions></gbti-subscriptions>`; // SOW-037
    if (this._tab === 'prs') {
      const prs = this._prs;
      if (prs === null) return `<p class="empty">Loading your pull requests...</p>`;
      if (prs.length === 0) return `<p class="empty">No pull requests yet. Publish from the site or the CMS and they show here.</p>`;
      return `<ul class="rows">${prs.map((pr) => `<li class="row">
        <span class="t"><b>${esc(pr.title || ('PR #' + pr.number))}</b><span class="meta"><a href="${esc(pr.html_url || '#')}" target="_blank" rel="noopener">#${esc(pr.number)}</a> on GitHub</span></span>
        <span class="right"><span class="gate tag" data-n="${esc(pr.number)}">checking...</span></span></li>`).join('')}</ul>`;
    }
    if (this._tab === 'drafts') return this._draftsHtml(); // SOW-082
    const items = this._cache?.[tab?.type]; // optional chain: never throw if render runs before init
    if (!items) return `<p class="empty">Loading...</p>`;
    if (items.length === 0) return `<p class="empty">No ${esc(tab.label.toLowerCase())} yet.</p>`;
    // SOW-062 Phase 1: each row leads with the SOW-049 type glyph; "Open" is now "Manage"; the list pages
    // client-side (15/page) so a member with many items does not scroll a long flat list.
    const PAGE = 15;
    const pages = Math.max(1, Math.ceil(items.length / PAGE));
    const page = Math.min(this._page || 0, pages - 1);
    const start = page * PAGE;
    const rows = items.slice(start, start + PAGE).map((it, j) => {
      const i = start + j; // absolute index into _cache[type] for data-edit
      const g = glyphFor(null, it.type);
      const status = it.status ? `<span class="tag ${it.status === 'published' ? 'ok' : ''}">${esc(it.status)}</span>` : '';
      const vis = it.visibility === 'members' ? `<span class="tag">members</span>` : '';
      return `<li class="row"><span class="gl" style="--ka:${esc(g.accent)}"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`
        + `<span class="t"><b>${esc(it.title)}</b><span class="meta">${esc(it.type || '')}</span></span>`
        + `<span class="right">${status} ${vis}<button class="btn" data-edit="${i}" type="button">Manage</button></span></li>`;
    }).join('');
    const pager = pages > 1 ? `<div class="pager">`
      + `<button class="btn" data-page="${page - 1}" type="button"${page === 0 ? ' disabled' : ''}>&larr; Prev</button>`
      + `<span class="pager-n">Page ${page + 1} of ${pages}</span>`
      + `<button class="btn" data-page="${page + 1}" type="button"${page >= pages - 1 ? ' disabled' : ''}>Next &rarr;</button></div>` : '';
    return `<ul class="rows">${rows}</ul>${pager}`;
  }

  // SOW-052: the Overview hub — a membership line, a tile per section (with counts; tiles deep-link via #tab=),
  // and the pull requests needing attention. Tiles are <a> links so they need no JS wiring.
  _overviewHtml() {
    const ov = this._overview;
    if (!ov) return `<p class="empty">Loading your WorkBench...</p>`;
    const c = ov.counts;
    const mLabel = MEMBERSHIP_LABEL[ov.membership] || 'Member';
    const isStaff = ['moderator', 'admin', 'superadmin'].includes(ov.role);
    const tiles = [
      { nm: 'Articles', href: 'workspace.html#tab=post', n: c.post },
      { nm: 'Prompts', href: 'workspace.html#tab=prompt', n: c.prompt },
      { nm: 'Products', href: 'workspace.html#tab=product', n: c.product },
      { nm: 'Drafts', href: 'workspace.html#tab=drafts', n: this._drafts ? this._drafts.length : null }, // SOW-082: fork-staged
      { nm: 'Pull requests', href: 'workspace.html#tab=prs', n: c.prs },
      { nm: 'Saved', href: 'workspace.html#tab=saved', n: c.saved },
      { nm: 'Following', href: 'workspace.html#tab=subs', n: c.subs },
      { nm: 'Earnings', href: 'workspace.html#tab=earnings', n: null },
      { nm: 'Settings', href: 'account.html', n: null },
      ...(isStaff ? [{ nm: 'Admin tools', href: 'admin.html', n: null }] : []),
    ];
    const tileHtml = tiles.map((t) => `<a class="ov-tile" href="${esc(t.href)}"><span class="ov-n">${t.n == null ? '' : esc(t.n)}</span><span class="ov-nm">${esc(t.nm)}</span></a>`).join('');
    const draft = c.drafts ? `<span class="ov-draft">${esc(c.drafts)} draft${c.drafts === 1 ? '' : 's'} in progress</span>` : '';
    // SOW-075: a trial member can author + stage drafts on their own fork but cannot publish; the Overview gave no
    // explanation. This banner makes the fork-only / paid-to-publish reality clear where the trial member spends time.
    const trialBanner = ov.membership === 'trialing'
      ? `<div class="ov-trial"><div><b>You are on the free trial</b><br/><span>Author and stage drafts on your own fork now. Publishing to gbti.network (opening canonical pull requests) requires a paid membership.</span></div><a class="ov-up" href="https://gbti.network/membership/" target="_blank" rel="noopener">Upgrade to publish</a></div>`
      : '';
    const att = ov.attention.length
      ? `<ul class="ov-att">${ov.attention.map((a) => `<li><span class="tag ${esc(a.tone)}">${esc(a.label)}</span> <a href="${esc(a.url || '#')}" target="_blank" rel="noopener">${esc(a.title)}</a></li>`).join('')}</ul>`
      : `<p class="muted">No pull requests need your attention.</p>`;
    return `<div class="ov">
      <div class="ov-hero"><div><b>Your WorkBench</b><br/><span class="muted">Membership: ${esc(mLabel)}</span></div>${draft}</div>
      ${trialBanner}
      <div class="ov-tiles">${tileHtml}</div>
      <h3 class="ov-h3">Pull requests</h3>
      ${att}
    </div>`;
  }

  // SOW-082: the fork-staged drafts review view. Each draft shows its lifecycle state (Staged -> Submitted / Needs
  // changes -> Published / Declined via classifyDraft) and opens in the editor; a paid member publishes it here.
  _draftsHtml() {
    const drafts = this._drafts;
    if (drafts == null) return `<p class="empty">Loading your drafts...</p>`;
    const msg = this._draftMsg ? `<div class="notice">${esc(this._draftMsg)}</div>` : '';
    const intro = `<p class="muted draft-intro">Drafts live on your own fork. Save work here, review it, then publish it to the network when you are ready.</p>`;
    if (!drafts.length) return msg + intro + `<p class="empty">No drafts yet. Use <b>Save draft</b> in the editor to stage an article, product, or prompt on your fork.</p>`;
    const paid = this._overview ? this._overview.membership === 'paid' : true; // unknown -> show Publish; the server gates
    return msg + intro + `<ul class="rows">${drafts.map((d, i) => this._draftRow(d, i, paid)).join('')}</ul>`;
  }

  _draftRow(d, i, paid) {
    const g = glyphFor(null, d.type);
    const { label, tone } = classifyDraft({ pull: d.pull });
    const vis = d.visibility === 'members' ? `<span class="tag">members</span>` : '';
    const pub = label === 'Published' ? ''
      : paid
        ? `<button class="btn" data-draft-publish="${i}" type="button">Publish</button>`
        : `<a class="btn" href="https://gbti.network/membership/" target="_blank" rel="noopener" title="Publishing requires a paid membership">Upgrade to publish</a>`;
    return `<li class="row"><span class="gl" style="--ka:${esc(g.accent)}"><svg viewBox="0 0 24 24" aria-hidden="true">${g.svg}</svg></span>`
      + `<span class="t"><b>${esc(d.title)}</b><span class="meta">${esc(d.type)}</span></span>`
      + `<span class="right"><span class="tag ${esc(tone)}">${esc(label)}</span>${vis}`
      + `<button class="btn" data-draft-edit="${i}" type="button">Manage</button>${pub}`
      + `<button class="btn" data-draft-discard="${i}" type="button">Discard</button></span></li>`;
  }

  _wireBody() {
    this.on('[data-profile]', 'click', () => this._openItem(this._profile?.path, 'profile'));
    if (this._tab === 'drafts') {
      const drafts = this._drafts || [];
      this.$$('[data-draft-edit]').forEach((b) => b.addEventListener('click', () => this._openDraft(drafts[Number(b.dataset.draftEdit)])));
      this.$$('[data-draft-publish]').forEach((b) => b.addEventListener('click', () => this._publishDraft(drafts[Number(b.dataset.draftPublish)], b)));
      this.$$('[data-draft-discard]').forEach((b) => b.addEventListener('click', () => this._discardDraft(drafts[Number(b.dataset.draftDiscard)], b)));
    }
    // SOW-028: the Inbox tab's <gbti-contrib-inbox> emits `contrib-open` (composed) when a Review button is
    // clicked; open the review drill-in. The listener sits on the element node the bubbling event passes through.
    if (this._tab === 'inbox') {
      this.$('gbti-contrib-inbox')?.addEventListener('contrib-open', (e) => { this._reviewing = e.detail?.number ?? null; this.render(); });
    }
    const tab = TABS.find((t) => t.id === this._tab);
    if (tab?.type) {
      this.$$('[data-edit]').forEach((b) => b.addEventListener('click', () => {
        const it = (this._cache[tab.type] || [])[Number(b.dataset.edit)];
        if (it) this._openItem(it.path, it.type);
      }));
      this.$$('[data-page]').forEach((b) => b.addEventListener('click', () => { // SOW-062 Phase 1: client-side paging
        if (b.hasAttribute('disabled')) return;
        this._page = Number(b.dataset.page) || 0;
        this.render(); // re-renders the slice + re-wires via _wireBody
      }));
    }
  }

  async _openItem(path, type) {
    if (!path) return;
    try {
      const full = await this.client.getContentItem({ path });
      this._editing = { type, frontmatter: full.frontmatter, body: full.body };
      this.render();
    } catch { /* could not load: stay on the list */ }
  }

  // SOW-082: open a fork-staged draft in the editor. readDraft (NOT getContentItem) reads from the staged branch on
  // the fork, decrypting a members-only body for the prefill so a re-save never replaces the gated text with a stub.
  async _openDraft(d) {
    if (!d) return;
    this._draftMsg = null;
    try {
      const full = await this.client.readDraft({ type: d.type, slug: d.slug });
      this._editing = { type: d.type, frontmatter: full.frontmatter, body: full.body };
      this.render();
    } catch { this._draftMsg = 'Could not open that draft.'; this.render(); }
  }

  // SOW-082: publish a staged draft to the network (opens the canonical PR from its branch). Paid-only; a gate
  // rejection surfaces inline. On success the draft becomes Submitted and the list + caches refresh.
  async _publishDraft(d, btn) {
    if (!d) return;
    this._draftMsg = null;
    if (btn) { btn.disabled = true; btn.textContent = 'Publishing...'; }
    try {
      await this.client.publishDraft({ type: d.type, slug: d.slug });
      await this._onPublished(d.type); // clears _drafts + overview + prs and refreshes the visible tab
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Publish'; }
      this._draftMsg = err?.message || 'Could not publish this draft.';
      this.render();
    }
  }

  // SOW-082: discard a staged draft (deletes its fork branch). Refused server-side if it has an open PR.
  async _discardDraft(d, btn) {
    if (!d) return;
    if (typeof confirm === 'function' && !confirm(`Discard the draft "${d.title}"? This deletes it from your fork.`)) return;
    this._draftMsg = null;
    if (btn) { btn.disabled = true; btn.textContent = 'Discarding...'; }
    try {
      await this.client.discardDraft({ type: d.type, slug: d.slug });
      this._drafts = null;
      this._overview = null;
      this._ensureTab('drafts');
    } catch (err) {
      if (btn) { btn.disabled = false; btn.textContent = 'Discard'; }
      this._draftMsg = err?.message || 'Could not discard this draft.';
      this.render();
    }
  }
}

define('gbti-workspace', GbtiWorkspace);
export { GbtiWorkspace };
