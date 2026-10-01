// The data half of <gbti-workspace>: the Overview load, the profile and earnings reads, the content scope, the
// stale-while-revalidate caches, the draft list, cache invalidation, and the pull request status poll. Split out of
// gbti-workspace.mjs at the 900-line limit (owner, 2026-09-30) and moved verbatim, in the same order. The element
// keeps TABS, the lifecycle, the actions and every render method; these methods reach those (render, _ensureTab,
// _authoring, _renderAllPrLabels, _renderPrLabel) through `this`, and none of them calls `super`.
import { getIdentity } from '../base.mjs';
import { prAttention, prLifecycle, shouldPollPr, scopeFor, WORKSPACE_SCOPE_KEY } from '../workspace-core.mjs';
import { setContentRef } from '../assets.mjs'; // sow-315: pin image URLs to the content commit
import { wbCacheGet, wbCacheSet, wbCacheInvalidateMany } from '../workbench-cache.mjs'; // SOW-073: SWR workbench cache
import { readStored } from '../storage.mjs'; // sow-347: a stored-setting read that cannot throw
import { readOwnProfile } from '../own-profile.mjs'; // sow-346: the profile strip reads found / absent / failed

const WB_CONTENT_TYPES = new Set(['post', 'prompt', 'project']); // SOW-073: types whose publish invalidates a tab

/** The data methods of <gbti-workspace>, as a mixin over its base element class. */
export const withWorkspaceData = (Base) => class extends Base {
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
    const [post, prompt, project, activity, follows, status, shares] = await Promise.all([
      num(this.client?.listContent?.({ type: 'post' })),
      num(this.client?.listContent?.({ type: 'prompt' })),
      num(this.client?.listContent?.({ type: 'project' })),
      num(this.client?.getActivity?.()),
      num(this.client?.getFollows?.()),
      num(this.client?.status?.()),
      this._authoring() ? num(this.client?.myShares?.()) : Promise.resolve(null), // sow-304: the Shares tile count (website only)
    ]);
    const items = (r) => (Array.isArray(r?.items) ? r.items : []);
    this._cache.post = items(post); this._cache.prompt = items(prompt); this._cache.project = items(project);
    // `_trusted` = the status read came back authenticated. Only a trusted snapshot is cached permanently; an
    // untrusted one renders once (so the hub is not blank) but is re-fetched on the next call + the retry below.
    const trusted = !!(status && status.authenticated !== false);
    // sow-404: pull requests are read for a SUPERADMIN only, once the status read says so (hence not in the batch).
    const superadmin = trusted && status?.role === 'superadmin';
    if (superadmin) { const prs = await num(this.client?.listPRs?.()); this._prs = Array.isArray(prs?.prs) ? prs.prs : (this._prs || []); }
    const drafts = [...items(post), ...items(prompt), ...items(project)].filter((it) => it.status === 'draft').length;
    const favs = (activity?.favorites?.length || 0) + (activity?.collections?.length || 0);
    const followN = Array.isArray(follows) ? follows.length : (follows?.following?.length || 0);
    const attention = superadmin ? prAttention(this._prs) : []; // sow-404: see prAttention in workspace-core
    this._overview = {
      membership: status?.membership || 'unknown',
      role: status?.role || 'member',
      paidTier: status?.paidTier || 'none', // sow-316: the Curator banner reads this; absent -> 'none' -> banner shows, the safe direction
      counts: { post: items(post).length, prompt: items(prompt).length, project: items(project).length, share: items(shares).length, prs: superadmin ? (this._prs || []).length : 0, saved: favs, subs: followN, drafts },
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
        wbCacheSet(ck, 'project', this._cache.project, { allowEmpty: true });
        if (superadmin && Array.isArray(this._prs)) wbCacheSet(ck, 'prs', this._prs, { allowEmpty: true });
      }
    }
    // SOW-145: resolve the content scope now that the caller's REAL role + personal counts are known (only on a
    // trusted snapshot, once per mount). A superadmin whose member folder is empty (e.g. gbtilabs) lands on the
    // house scope; everyone else stays 'member'. If the resolution moves us off 'member', reload the visible tab.
    if (trusted && !this._scopeResolved) {
      this._scopeResolved = true;
      const stored = readStored(WORKSPACE_SCOPE_KEY); // sow-347
      const personalCount = items(post).length + items(prompt).length + items(project).length;
      const resolved = scopeFor(stored, { personalCount, role: this._overview.role });
      const moved = resolved !== this._scopeNow(); // compare BEFORE assigning
      this._scope = resolved;
      // A share deep link the list looked for BEFORE this resolve was kept for it (the loaded listener); a
      // member cannot be moved to Network shares, so nothing will look again: drop it rather than let a stale
      // id ride into the next Shares render.
      if (this._editShareId && !this._canScope()) this._editShareId = null;
      // Guard every render here with !this._editing (mirrors the other overview-time renders). An UNGUARDED
      // render() while the editor is open re-mounts <gbti-content-editor> and wipes in-progress edits — reachable
      // via a #new= / #edit= deep-link whose editor opens before this async resolve lands. When the scope MOVED,
      // reset + reload the visible list. Re-render (to surface the now-known superadmin toggle) only when the
      // scope moved or the toggle should appear. While editing, preload the resolved scope's list silently
      // (_ensureTab's own renders are !editing-guarded) so it is ready when the member exits the editor.
      if (!this._editing) {
        if (moved) { this._page = 0; this._statusFilter = 'all'; this._ensureTab(this._tab); }
        if (moved || this._canScope()) this.render();
      } else if (moved) {
        this._ensureTab(this._tab);
      }
    }
    if (this._tab === 'overview' && !this._editing) this.render();
    // sow-404: a held #tab=prs deep link, now the role is known: a superadmin's list loads, anyone else falls back.
    if (trusted && this._tab === 'prs' && !this._editing) { if (superadmin) this._swrPrs('prs'); else this.render(); }
    // Self-heal: if the session looked unauthenticated (a token that may have since recovered/refreshed), retry
    // ONCE shortly so the hub fills in without a manual page refresh.
    if (!trusted && !this._overviewRetried) {
      this._overviewRetried = true;
      setTimeout(() => { this._overview = null; this._ensureOverview(); }, 2000);
    }
  }

  // ----- data loaders (each fail-soft to an empty state, like gbti-content-list/gbti-pr-list) -----
  async _loadProfile() {
    if (!this.client || this._ownProfileAsked) return; // sow-346: once per mount; render() asks again when the client arrives
    this._ownProfileAsked = true;
    const r = await readOwnProfile(this.client); // the website lists no profile, so the old listing never found one there
    this._ownProfile = r; // profileStrip shows nothing for a failed read
    if (!this._editing) this.render();
  }

  // SOW-083 P2: the member's own earnings ledger (held + payable + paid), served by the Worker from earnings:<id>.
  async _loadEarnings() {
    try { this._earnings = (await this.client?.getEarnings?.()) ?? null; }
    catch { this._earnings = null; }
    this.render();
  }

  // SOW-145: the active scope (member until the Overview resolves it), and the scope-keyed content-cache key so
  // house + member lists of the same type never collide in this._cache or the persistent cache.
  _scopeNow() { return this._scope || 'member'; }
  _ck(type) { return this._scopeNow() === 'house' ? `house:${type}` : type; }
  /** SOW-145: whether the superadmin scope toggle should render (a superadmin, from the trusted Overview). */
  _canScope() { return this._overview?.role === 'superadmin'; }
  /** sow-404: the role from a TRUSTED Overview; undefined before (superadmin-only tabs hidden, a deep link held). */
  _role() { return this._overview?._trusted ? (this._overview.role || 'member') : undefined; }

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
    // SOW-145: cache + fetch under the SCOPE-keyed slot so the house list never overwrites the member list of
    // the same type (and the persistent cache keeps them separate). Member scope keeps the plain `type` key.
    const ck = this._ck(type);
    const scope = this._scopeNow();
    if (this._cache[ck]) return; // already loaded this session (this scope)
    const key = await this._memberKey();
    let fresh = false;
    if (key) {
      const cached = await wbCacheGet(key, ck);
      if (cached) {
        this._cache[ck] = cached.items;
        if (this._tab === id && !this._editing) this.render(); // instant paint from cache
        fresh = cached.fresh;
      }
    }
    if (fresh) return; // fresh enough: skip the revalidate
    try {
      const items = (await this.client?.listContent?.({ type, scope }))?.items ?? [];
      const changed = !this._cache[ck] || JSON.stringify(this._cache[ck]) !== JSON.stringify(items);
      this._cache[ck] = items;
      if (key) await wbCacheSet(key, ck, items, { allowEmpty: true }); // success path: [] means truly none
      if (changed && this._tab === id && !this._editing) this.render();
    } catch {
      if (!this._cache[ck]) this._cache[ck] = []; // no cache + fetch failed -> empty (prior behavior)
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
      // sow-315: this one call is where both non-website hosts learn the content commit, so the pin is set
      // here rather than in either transport (the extension's adapter and the npm client's fetch client are
      // separate implementations of the same contract and share no request path).
      const res = await this.client?.listDrafts?.();
      setContentRef(res?.contentRef);
      this._drafts = res?.drafts ?? [];
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
    // SOW-145: invalidate BOTH the plain (member) slot AND the active scope's slot, so a house publish refreshes
    // the house list (and a member publish the member list) without leaving the other scope stale.
    const keys = t ? [...new Set([t, this._ck(t)])] : [];
    keys.forEach((k) => delete this._cache[k]);
    this._overview = null;
    this._prs = null;
    this._drafts = null; // SOW-082: a publish moves a draft Staged -> Submitted
    const key = await this._memberKey();
    if (key) await wbCacheInvalidateMany(key, [...keys, 'overview', 'prs']);
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
        if (!this._editing) this._ensureTab(this._tab);
      };
      oc.addListener(this._onStorage);
    } catch { /* no chrome.storage: nothing to sync */ }
  }

  _loadPrStatuses() {
    this._pollTries = 0; // a fresh load (tab open / refresh) resets the live-poll budget
    this._renderAllPrLabels();
    this._schedulePrPoll(); // SOW-072 P3: keep the list fresh while any PR is still in flight, so a row flips live
  }
  async _loadPrStatus(number) {
    let status = null;
    try { status = await this.client?.prStatus?.({ number }); } catch { /* leave null */ }
    const pr = (this._prs || []).find((p) => p.number === number);
    if (pr) this._renderPrLabel(pr, status);
  }
  // SOW-072 P3: while ANY PR is still open (in flight), re-fetch the PR LIST on a backoff and re-render the labels, so a
  // row flips Submitted -> Accepted (merged) / Declined (closed) without a manual refresh. The gate STATUS alone never
  // carries merged/closed, so we must refresh the PR list itself. ONE workspace-level timer. Self-stops off the PR tab
  // / in an editor; bounded by MAX_TRIES per viewing session (the poll only runs while the tab is open). Cleared on
  // re-render + disconnect. _pollTries is NOT reset by _clearPolls (only a fresh _loadPrStatuses resets it), so the cap
  // is not silently defeated by a re-render mid-poll.
  _schedulePrPoll() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
    const BASE_MS = 10000, CAP_MS = 30000, MAX_TRIES = 20;
    // "still in flight" = an open PR: prLifecycle with no gate status classifies any non-merged/closed PR as the
    // pollable 'pending' phase (shouldPollPr), so the poll runs until every PR is merged or closed.
    const anyOpen = (this._prs || []).some((pr) => shouldPollPr(prLifecycle(pr, null)));
    if (!anyOpen || (this._pollTries || 0) >= MAX_TRIES) return;
    this._pollTimer = setTimeout(async () => {
      this._pollTimer = null;
      if (this._tab !== 'prs' || this._editing) return; // self-stop off the PR tab / in an editor
      this._pollTries = (this._pollTries || 0) + 1;
      let prs = null;
      try { prs = (await this.client?.listPRs?.())?.prs; } catch { /* keep the current list */ }
      if (this._tab !== 'prs' || this._editing) return; // re-check after the await
      if (Array.isArray(prs)) this._prs = prs;
      this._renderAllPrLabels();
      this._schedulePrPoll();
    }, Math.min(BASE_MS * ((this._pollTries || 0) + 1), CAP_MS));
  }
  _clearPolls() {
    if (this._pollTimer) { clearTimeout(this._pollTimer); this._pollTimer = null; }
  }
};
