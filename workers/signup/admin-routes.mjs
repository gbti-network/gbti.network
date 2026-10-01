// The /membership/admin/* routes of the signup Worker's router. Moved out of index.mjs at the 900-line limit
// (owner, 2026-09-30). The blocks keep their order. Each path here is matched exactly and is matched nowhere else
// in the router, so no check in another group can answer one of them first.

import { membershipAdminStatuses, membershipAdminOverrides } from './membership-admin.mjs';
import { membershipAdminOps } from './membership-admin-ops.mjs';
import { membershipAdminMail } from './membership-admin-mail.mjs';
import { membershipCouponUsage } from './membership-coupons-admin.mjs'; // SOW-119
import { membershipInviteCreate, membershipInviteList, membershipInviteUpdate } from './membership-invites-admin.mjs'; // sow-231
import { membershipPreparedGet, membershipPreparedPost } from './membership-prepared-admin.mjs'; // sow-427: prepared project listings (superadmin)
import { preparedFinalizeHook } from './membership-claim.mjs'; // sow-427: finalize claims as the manager loads
import { editorialList, editorialDecide } from './membership-editorial.mjs'; // sow-323: the editorial review queue
import { newsItemDecide, newsRemovedList } from './membership-admin-news.mjs'; // sow-338: superadmin news removal
import { sendEditorialApprovedEmail } from './editorial-alert.mjs'; // sow-323
import { membershipMemberLookup } from './membership-member-lookup.mjs'; // sow-331: the superadmin member lookup
import { membershipAdminCtaPool } from './membership-admin-ctas.mjs'; // sow-281: the CTA registry pool read (superadmin)
import { membershipAdminSkillInstallPool } from './membership-admin-skills.mjs'; // sow-109: Skill install, every tool and its steps (superadmin)
import { membershipAdminAuthor, membershipAdminQuotePool, membershipAdminNewsSourcePool, membershipAdminCouponPool, membershipAdminSiteSettings, membershipAdminTaxonomy, membershipAdminContentChannelPool, membershipAdminModerationFlagPool, membershipAdminSyndicationTemplatePool, membershipAdminNewsEngagement, membershipAdminSyndicationSettings, membershipAdminDigestConfig } from './membership-admin-author.mjs'; // sow-161: server-side admin mutations + config pool reads; sow-271: site-settings pool; sow-161 A: taxonomy pool; sow-161 B: the channel-map manager pool reads (superadmin)
import { listSponsorInquiries } from './sponsor-inquiry.mjs'; // sow-266: the superadmin read of what came in through the sponsorship form
import { drainMail } from './mail-drain.mjs'; // SOW-166: smoothed send drain on the shared 5-minute tick, behind the fail-closed gate
import { mailDrainDeps } from './cron.mjs'; // the mail drain's one composition root, shared with the scheduled drain
import { corsHeaders } from './cors.mjs'; // sow-158 Phase 1b: credentialed reflected-origin CORS for cookie routes
import { json, MEMBERSHIP_CORS } from './route-helpers.mjs';

/**
 * The admin checks from the router, in the order they stood there. Returns the Response for a path and method
 * this group serves, or null so the router goes on to its next check.
 */
export async function handleAdminRoutes(request, env, ctx, { pathname, method }) {
  // SOW-038 P2: admin-only per-member Stripe status for the superadmin dashboard. Sensitive billing status,
  // so admin-gated (fail-closed via the overrides mirror) + never cached, varied on the bearer.
  // sow-161: cookie-enabled (credentialed reflected-origin CORS + allowCookie) so the website admin dashboard
  // reads it over the session; a GET carries no CSRF (safe method). The extension bearer path is unchanged.
  if (pathname === '/membership/admin/statuses') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminStatuses(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-213 R3: admin-only bans + grandfather grants from the KV mirror, for the dashboard roster (the two
  // house/*.yml files left the public repo). SEPARATE from /statuses so the AUTHORITATIVE overrides fail
  // closed/loud rather than riding a best-effort Stripe enumeration that can 502. Same cookie-enabled,
  // fail-closed, never-cached posture as /statuses; the ban moderation reason is stripped server-side.
  if (pathname === '/membership/admin/overrides') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminOverrides(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-331: the superadmin member lookup (an email or a GitHub username -> everything held about the account).
  // Superadmin-only and view-only; cookie-enabled for the website admin page (a GET carries no CSRF). Never cached,
  // and corsHeaders(credentials) already varies on Origin and Authorization.
  if (pathname === '/membership/admin/member-lookup') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipMemberLookup(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-038 P3: admin-gated OPERATIONS triggers (reconcile / E2E-smoke) via an allow-listed repository_dispatch.
  // The dispatch token stays in the Worker; the caller can only name an allow-listed action. Never cached.
  if (pathname === '/membership/admin/ops') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'POST') {
      // sow-161 A: allow the WEBSITE cookie session (category-migrate from the categories workspace). A POST
      // over the cookie path enforces the double-submit CSRF gate in resolveIdentity (see resolveCaller);
      // the bearer path (extension/npm) is unchanged.
      const r = await membershipAdminOps(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-166 follow-up: admin-gated MANUAL mail triggers (compile / test-compile / drain / discard). Before this
  // route, compileWeeklyIssue and drainMail were reachable only from the cron map (CRON_JOBS in cron.mjs), so the
  // first end-to-end proof of the mail chain could not happen before the next weekly cron. It calls the SAME
  // production functions the cron calls and grants no new send authority: the drain refuses every recipient
  // outside MAIL_SEND_ALLOWLIST and resolveSendGate still defaults to closed. The drain's IO is composed by
  // mailDrainDeps (cron.mjs) rather than inside the route module, so there is exactly one composition root and a
  // manual drain cannot drift from the scheduled one. Never cached.
  if (pathname === '/membership/admin/mail') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'POST') {
      const r = await membershipAdminMail(request, env, {
        drain: async (e, opts) => drainMail(e, { ...(await mailDrainDeps(e)), ...opts }),
      });
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // SOW-119: admin-gated coupon usage (the git file holds the config; KV holds the runtime redemption counts).
  // sow-161: credentialed CORS + allowCookie so the WEBSITE coupon manager reads counts over the cookie session
  // (same treatment as /membership/admin/statuses; the extension's bearer call is unaffected). Never cached.
  if (pathname === '/membership/admin/coupon-usage') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipCouponUsage(request, env, { allowCookie: true });
      // corsHeaders(credentials) already sets Vary: 'Origin, Authorization'; don't override it to drop Origin.
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-323: the superadmin EDITORIAL REVIEW QUEUE. Every member article, project and prompt starts
  // members-only and a superadmin decides what becomes public (owner, 2026-09-12), so listing shows work
  // waiting and deciding PUBLISHES it. Both sit at the superadmin bar. Never cached.
  // sow-338: a superadmin removes one news story from the index, or puts it back. KV, not a pull request,
  // so it lives in its own module beside the news store rather than with the file-editing actions.
  if (pathname === '/membership/admin/news-item') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await newsRemovedList(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (method === 'POST') {
      const r = await newsItemDecide(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  if (pathname === '/membership/admin/editorial') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await editorialList(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (method === 'POST') {
      // The author notice is injected rather than fired here, because it must go AFTER the record is
      // stored and only on an approval; the route holds that order and this only supplies the send.
      const r = await editorialDecide(request, env, {
        allowCookie: true,
        notifyAuthor: (record) => {
          const send = sendEditorialApprovedEmail(env, record);
          if (ctx?.waitUntil) { ctx.waitUntil(send); return undefined; }
          return send;
        },
      });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-231: admin-gated ISSUED INVITES. A campaign (house/coupons.yml) says what an invite is worth; an
  // invite (KV) says who we handed one to. Same credentialed-CORS + allowCookie treatment as coupon-usage
  // so the WEBSITE coupon manager can issue over the cookie session (the extension's bearer call still
  // works). Person-keyed and note-bearing, so it is admin-gated and NEVER cached.
  if (pathname === '/membership/admin/invites') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipInviteList(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (method === 'POST') {
      const r = await membershipInviteCreate(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (method === 'PATCH') {
      const r = await membershipInviteUpdate(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  // sow-427: PREPARED PROJECT LISTINGS, superadmin only (owner decision 10). A project written for someone who is
  // not a member yet, and the invitation that lets them claim it. Same credentialed-CORS + allowCookie shape as
  // the invites route above (the POST is CSRF-gated for a cookie caller). Person-keyed: NEVER cached.
  if (pathname === '/membership/admin/prepared') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      // sow-427 C2: finalize up to FINALIZE_PER_LIST publishing rows as the manager loads (notice via waitUntil).
      const r = await membershipPreparedGet(request, env, { allowCookie: true, finalize: preparedFinalizeHook(env, ctx) });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
    if (method === 'POST') {
      const r = await membershipPreparedPost(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-161: server-side admin mutations (increment 1: content moderation). Staff (moderator+) names an action
  // + a target path; the Worker computes the change server-side and opens a hosted-admin PR with the
  // installation token; the SOW-005 gate re-checks the caller's role vs the path and merges. Cookie-enabled
  // (credentialed CORS + allowCookie; the POST enforces CSRF in resolveIdentity); the extension bearer path also works.
  if (pathname === '/membership/admin/author') {
    const cors = corsHeaders(request, env, { credentials: true, methods: 'POST, OPTIONS' });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipAdminAuthor(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-161 increment 4: the config-manager pool reads (admin-gated, cookie-enabled). A GET carries no CSRF.
  // sow-281: the CTA registry pool read for the CTAs manager. SUPERADMIN-gated inside, read-only, no-store.
  if (pathname === '/membership/admin/cta-pool') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminCtaPool(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  if (pathname === '/membership/admin/quote-pool') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminQuotePool(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  if (pathname === '/membership/admin/news-source-pool') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminNewsSourcePool(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  if (pathname === '/membership/admin/coupon-pool') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminCouponPool(request, env, { allowCookie: true });
      // corsHeaders(credentials) already sets Vary: 'Origin, Authorization'; don't override it to drop Origin.
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  // sow-271: the site-settings pool read for the WEBSITE admin page. Admin-gated (cookie-enabled), read-only.
  if (pathname === '/membership/admin/site-settings') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminSiteSettings(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  // sow-161 A: the taxonomy pool read for the WEBSITE categories workspace. Admin-gated, read-only.
  if (pathname === '/membership/admin/taxonomy') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAdminTaxonomy(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  // sow-161 B: the channel-map manager's SIX pool reads for the WEBSITE Channels workspace. ALL SUPERADMIN
  // (membershipAdmin* default to authorizeSuperadmin), read-only, cookie-enabled (a GET carries no CSRF). One
  // route each; the shape mirrors what the extension host gets from admin-ops so the shared element renders
  // identically. Grouped in a table to keep the six routes uniform (same CORS + no-store + Vary contract).
  {
    const CHANNEL_MAP_POOLS = {
      '/membership/admin/content-channel-pool': membershipAdminContentChannelPool,
      '/membership/admin/moderation-flag-pool': membershipAdminModerationFlagPool,
      '/membership/admin/syndication-template-pool': membershipAdminSyndicationTemplatePool,
      '/membership/admin/news-engagement': membershipAdminNewsEngagement,
      '/membership/admin/syndication-settings': membershipAdminSyndicationSettings,
      // sow-266: the weekly digest's membership pitch + sponsor slot. Superadmin for the same reason the rest of
      // this table is, and because the sponsor markup is a commercial arrangement before the issue goes out.
      '/membership/admin/digest-config': membershipAdminDigestConfig,
      // sow-266 Phase 4: what came in through the sponsorship form. Superadmin, and here the reason IS
      // confidentiality: unlike the settings beside it, these are private messages from named people and
      // they are nowhere public.
      '/membership/admin/sponsor-inquiries': listSponsorInquiries,
      // sow-109: every tool a skill can be made for, with its install steps. Superadmin, matching the writes.
      '/membership/admin/skill-install': membershipAdminSkillInstallPool,
    };
    const poolFn = CHANNEL_MAP_POOLS[pathname];
    if (poolFn) {
      const cors = corsHeaders(request, env, { credentials: true });
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (method === 'GET') {
        const r = await poolFn(request, env, { allowCookie: true });
        return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
      }
    }
  }

  return null;
}
