// The website WorkBench client's admin surface (split out of workbench-client.ts at the 900-line cap, owner
// ruling 2026-09-30): the staff reads and config writes, the superadmin channel-map and syndication methods, the
// issued invites and the editorial review queue. createWorkbenchClient spreads the object this returns into its
// own, at the position these methods always held, so the method names and their order are unchanged. The Worker
// re-checks the role on every route; the superadmin gate below is defense in depth over that boundary.

/** The transport the admin methods call, plus the one role flag that decides whether the channel-map subset exists. */
export type AdminContext = {
  workerGet: (path: string) => Promise<any>;
  workerPost: (path: string, body: unknown) => Promise<any>;
  workerPatch: (path: string, body: unknown) => Promise<any>;
  isSuperadmin: boolean;
};

export function adminMethods({ workerGet, workerPost, workerPatch, isSuperadmin }: AdminContext) {
  // sow-161 B (owner-approved Option A, band seq 35): the SUPERADMIN channel-map surface, THE ROLE GATE.
  // These methods are attached ONLY when the viewer is a superadmin. That is deliberate and load-bearing: the
  // shared <gbti-categories-workspace> decides whether to draw its channel column with a CAPABILITY check
  // (`typeof this.client.contentChannelPool === 'function' && typeof this.client.discordChannels === 'function'`),
  // which cannot express a role. If these methods were present for an admin, the admin would see the channel
  // column and every write would 403 at the Worker (writes are superadmin via the category-batch max-rank gate).
  // Making the CAPABILITY itself superadmin-scoped is what lets the capability check reflect the role: an admin's
  // client simply does not have the methods, so the column stays off AND the admin cannot call them at all
  // (defense in depth over the server gate, which is still the real boundary: reads default to authorizeSuperadmin,
  // writes re-check rank). This object is EMPTY for every non-superadmin caller and for every other host page that
  // never passes isSuperadmin, so no other surface is affected.
  const channelMapMethods: Record<string, any> = isSuperadmin ? {
    // The category -> Discord channel picker source (SOW-100). authorizeAdmin server-side (shared with the
    // extension), but only a superadmin client exposes it, so the categories channel column is superadmin-only UX.
    discordChannels() { return workerGet('/membership/discord-channels'); }, // [{ id, name, type, parentId }]
    // The <gbti-channel-map-manager> surface (six reads + six writes). Reads mirror admin-ops' shapes; writes land
    // as auto-gated PRs against the superadmin-pinned moderation-flags.yml / syndication-config.yml. contentChannelPool
    // is read here (the matrix) but the channel -> Discord map is EDITED via the categories workspace (category-batch),
    // so no setContentChannel method is needed.
    contentChannelPool() { return workerGet('/membership/admin/content-channel-pool'); }, // { channels }
    moderationFlagPool() { return workerGet('/membership/admin/moderation-flag-pool'); }, // { lists }
    syndicationTemplatePool() { return workerGet('/membership/admin/syndication-template-pool'); }, // { templates, channelTemplates, ..., types, channels }
    newsEngagementSettings() { return workerGet('/membership/admin/news-engagement'); }, // { settings, tiers }
    syndicationSettings() { return workerGet('/membership/admin/syndication-settings'); }, // { settings, channelNames, autoTypes, ... }
    async addModerationFlagTerm(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'flag-term-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeModerationFlagTerm(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'flag-term-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setSyndicationTemplates(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'syndication-templates-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setNewsEngagement(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-engagement-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setSyndicationSettings(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'syndication-settings-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-338: the news item controls. Pulling a story writes KV and takes effect within the feed's five-minute
    // cache; weighting a source is a pull request against the superadmin-pinned weights file like its neighbours
    // above, so it lands with the next deploy. Two different clocks, and the page says which is which.
    removeNewsItem(guid: string) { return workerPost('/membership/admin/news-item', { action: 'remove', guid }); },
    restoreNewsItem(guid: string) { return workerPost('/membership/admin/news-item', { action: 'restore', guid }); },
    async setNewsSourceWeight(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-weight', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-399: the rest of syndication, moved here from the extension. Publishing Activity (the queue with approve
    // and cancel), the Social Queue, and Manually syndicate. The same Worker routes the extension used, now
    // cookie-enabled; a write carries the CSRF echo (workerPost) and the Worker re-checks superadmin on each one.
    syndicationQueue() { return workerGet('/membership/syndication'); }, // { pending, approved, sent, cancelled, failed }
    approveSyndication({ id }: { id: string }) { return workerPost('/membership/syndication/approve', { id }); },
    cancelSyndication({ id }: { id: string }) { return workerPost('/membership/syndication/cancel', { id }); },
    socialQueue() { return workerGet('/membership/social-queue'); }, // { pending, done }
    socialQueueAction({ action, id, ...rest }: any = {}) { return workerPost('/membership/social-queue', { action, id, ...rest }); },
    getSyndicateNow() { return workerGet('/membership/syndicate-now'); }, // destinations + templates + channel map
    syndicateNow(p: any = {}) { return workerPost('/membership/syndicate-now', p); }, // every field passes through
  } : {};

  return {
    // ----- sow-161 admin surface (read): the per-member Stripe status map for the dashboard roster. Admin-gated
    // server-side over the cookie session (authorizeAdmin + allowCookie); a non-admin session 403s. -----
    adminStatuses() { return workerGet('/membership/admin/statuses'); }, // { ok, statuses: { <github_id>: '<status>' } }
    // sow-161 admin mutation dispatch (increment 1: content moderation deplatform/republish/remove with { path }).
    // The Worker computes the change server-side + gates by role; a non-staff session 403s, an unsupported action
    // 400s (ban/role land in later increments). Cookie POST -> CSRF enforced by workerPost. Normalize the Worker's
    // { number, html_url } to the { prNumber, prUrl } shape <gbti-admin> renders (parity with the extension host).
    async admin(action: string, args: any = {}) {
      const r = await workerPost('/membership/admin/author', { action, ...args });
      return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null };
    },
    // sow-161 A: the categories workspace + tag explorer. taxonomy() reads house/taxonomy.yml { tree }; adminOp()
    // fires an allow-listed operation (category-migrate) over the cookie session (the Worker enforces CSRF on the
    // POST). category-batch + tag-edit go through admin() above (the Worker resolves their multi-file writes).
    taxonomy() { return workerGet('/membership/admin/taxonomy'); }, // { ok, tree }
    async adminOp(action: string, params: any = null) { return workerPost('/membership/admin/ops', params ? { action, params } : { action }); },
    // sow-161 increment 4: the quotes config manager. Read the full pool (admin-gated) + the three write actions,
    // each normalized to the { noop, prNumber } shape gbti-quote-manager renders.
    quotePool() { return workerGet('/membership/admin/quote-pool'); }, // { ok, quotes }
    async addQuote(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeQuote(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setQuoteEnabled(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'quote-toggle', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-271: the site-wide presentation toggles (superadmin). siteSettings reads house/site-settings.yml resolved;
    // setSiteToggle lands as an auto-gated house PR. `enabled` is coerced to a real boolean on the wire so a stray
    // "false" cannot switch a toggle ON (the Worker's siteToggleInput rejects a non-boolean regardless).
    siteSettings() { return workerGet('/membership/admin/site-settings'); }, // { ok, settings, toggles }
    async setSiteToggle(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'site-setting-set', ...args, enabled: args?.enabled === true }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-266: the weekly digest's membership pitch + sponsor slot (superadmin). digestConfig returns what is
    // STORED, so an empty field shows empty rather than pre-filled with the copy the renderer falls back to.
    //
    // NO `enabled: args?.enabled === true` HERE, deliberately, unlike the two methods above. Both writes are
    // PATCHES: an absent key means leave it alone, and coercing an absent switch to false would turn the pitch
    // off every time somebody saved only the wording. The Worker rejects a non-boolean switch regardless, so
    // passing the value through unchanged is both safe and the only correct thing.
    digestConfig() { return workerGet('/membership/admin/digest-config'); }, // { ok, cta, sponsor, defaults, limits }
    // sow-109: Admin tools > Skill install (superadmin; the Worker checks the role on both routes).
    skillInstallPool() { return workerGet('/membership/admin/skill-install'); }, // { ok, tools: [{ key, label, steps }] }
    async setSkillInstallSteps(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'skill-install-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async addSkillInstallTool(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'skill-install-tool-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setDigestCta(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'digest-cta-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setDigestSponsor(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'digest-sponsor-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-270: the double opt-in switch. Forwarded as sent, like the two above: the core rejects a missing
    // value, so coercing an absent `double` to false here would silently turn confirmation off on any other save.
    async setDigestOptin(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'digest-optin-set', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-266 Phase 4: the sponsorship inquiries. Unlike the settings above, these ARE private: messages from
    // named people, held nowhere public, so the route is superadmin for the reason it looks like.
    sponsorInquiries() { return workerGet('/membership/admin/sponsor-inquiries'); }, // { ok, inquiries, limits }
    // sow-281: the CTA registry (superadmin). ctaPool reads house/ctas.yml in full; the five writes land as
    // auto-merged house PRs. `enabled` is coerced to a real boolean on the wire, as setSiteToggle does.
    ctaPool() { return workerGet('/membership/admin/cta-pool'); }, // { ok, ctas, types }
    async addCta(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'cta-add', ...args, enabled: args?.enabled === true }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async updateCta(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'cta-update', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setCtaEnabled(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'cta-toggle', ...args, enabled: args?.enabled === true }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async assignCta(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'cta-assign', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async unassignCta(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'cta-unassign', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-161 increment 4: the news-source config manager (full pool read + the three write actions).
    newsSourcePool() { return workerGet('/membership/admin/news-source-pool'); }, // { ok, sources }
    async addNewsSource(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeNewsSource(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async setNewsSourceEnabled(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-source-toggle', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-372: the words that keep a story out of the news stream (superadmin; newsSourcePool carries the list).
    async addNewsBanword(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-banword-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async removeNewsBanword(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'news-banword-remove', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    // sow-161 increment 4: the coupons config manager. couponPool reads house/coupons.yml (config); couponUsage reads
    // the KV redemption counts; add/update land as auto-gated house PRs. A coupon is deactivated, never deleted.
    couponPool() { return workerGet('/membership/admin/coupon-pool'); }, // { ok, coupons }
    couponUsage() { return workerGet('/membership/admin/coupon-usage'); }, // { ok, usage }
    async addCoupon(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'coupon-add', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },
    async updateCoupon(args: any = {}) { const r = await workerPost('/membership/admin/author', { action: 'coupon-update', ...args }); return { ...r, prNumber: r?.number ?? null, prUrl: r?.html_url ?? null }; },

    // sow-161 B: the SUPERADMIN channel-map surface (six manager reads/writes + discordChannels for the categories
    // channel column). Attached only when isSuperadmin (see channelMapMethods above): the role gate lives HERE, in
    // the presence of the methods, so the shared elements' capability checks reflect the role and no admin ever
    // meets a channel control that would 403. Empty spread for every non-superadmin caller.
    ...channelMapMethods,

    // sow-231 Phase 3: ISSUED INVITES. Unlike the coupon config above, these are NOT git-native and open no
    // PR: an invite is per-person state carrying an administration note, so it lives in KV per the storage
    // boundary. That is why these go straight to the Worker rather than through the author route.
    inviteList() { return workerGet('/membership/admin/invites'); }, // { ok, invites }
    inviteCreate(args: any = {}) { return workerPost('/membership/admin/invites', args); }, // { campaign, note?, expiresAt? }
    inviteUpdate(args: any = {}) { return workerPatch('/membership/admin/invites', args); }, // { code, action: 'revoke'|'note', note? }

    // sow-323: the EDITORIAL REVIEW QUEUE. Same disposition as the invites above and for the same reason: a
    // queue record is per-person state about work in progress, so it is KV per the storage boundary. The
    // decision opens no pull request from HERE either: the Worker does the commit, because only the Worker
    // holds the key that can read an encrypted members-only body. Both gate at authorizeSuperadmin, because
    // approving publishes a member's work to the open web.
    editorialQueue() { return workerGet('/membership/admin/editorial'); }, // sow-323 { ok, items }
    decideEditorial(args: any = {}) { return workerPost('/membership/admin/editorial', args); }, // { path, decision }
  };
}
