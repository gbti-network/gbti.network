// The member routes of the signup Worker's router: every /membership/* route outside /membership/admin/*, and the
// anonymous reads that sat among them (/invite/listing, /news/feed, /membership/deploy-status). Moved out of
// index.mjs at the 900-line limit (owner, 2026-09-30). The blocks keep their order. Each path here is matched
// exactly and is matched nowhere else in the router, so no check in another group can answer one of them first.

import { createStripeClient } from '../../clients/stripe.mjs';
import { discordJoinEligibility } from './signup.mjs'; // sow-356: the shared Discord join rule
import { buildEnvPriceTierMap } from '../../membership/tier-gate.mjs'; // sow-185: price -> tier map for the Creator badge
import { membershipStatus } from './membership-status.mjs';
import { membershipDecrypt, membershipEncrypt } from './membership-content.mjs';
import { inviteListingRead, inviteListingImage, inviteTitleRead } from './prepared-claim-read.mjs'; // sow-427: the signed-out read of a prepared listing by its code
import { membershipClaimStatus, membershipClaimPost } from './membership-claim.mjs'; // sow-427: claiming a prepared listing
import { sendListingClaimedAlert } from './listing-claimed-alert.mjs'; // sow-427: the owner notice when a claim merges
import { sendEditorialQueueAlert } from './editorial-alert.mjs'; // sow-323
import { membershipDiscordChannels } from './membership-discord-channels.mjs'; // SOW-100: channel names for the categories workspace
import { handleActivity } from './membership-activity.mjs';
import { handleOgPreview } from './membership-og.mjs';
import { handleSyndicationTracker, handleSyndicationCancel, handleSyndicationApprove } from './syndication-admin.mjs';
import { handleSocialQueueGet, handleSocialQueueAction } from './social-queue-admin.mjs'; // SOW-121
import { handleSyndicateNowInfo, handleSyndicateNow } from './membership-syndicate-now.mjs'; // SOW-088: manual syndicate
import { handleFollows } from './membership-follows.mjs';
import { handleNotifications } from './membership-notifications.mjs'; // SOW-150/186: the per-member notification store (bell source)
import { handleDrafts } from './membership-drafts.mjs'; // SOW-157: the hosted draft store
import { handleDraftImage } from './membership-draft-images.mjs'; // the staged image bytes beside those drafts
import { handleEarnings } from './membership-earnings.mjs'; // SOW-083 P2: the member's own earnings ledger
import { handleCommentEcho } from './membership-comment-echo.mjs'; // SOW-076 P1: optimistic comment echoes (instant-feel)
import { membershipNews, membershipNewsCategories, membershipNewsSources, publicNews } from './membership-news.mjs'; // SOW-043/046 proxy; sow-139 public list
import { handlePrefs } from './membership-prefs.mjs'; // SOW-046: member prefs (categories + followed news channels)
import { handleShoptalk } from './membership-shoptalk.mjs'; // sow-314: the Shop Talk call guest list
import { handleDigestSwitch } from './membership-digest.mjs'; // sow-202: the member's weekly digest switch
import { createGoogleCalendarClient } from '../../clients/google-calendar.mjs'; // sow-314
import { membershipNewsPublish } from './membership-news-publish.mjs'; // SOW-046 C: curator-gated news -> Discord publish
import { membershipNewsDiscussed } from './membership-news-discussed.mjs'; // SOW-046 D: reflect news discussion onto Discord
import { membershipNewsOpened } from './membership-news-opened.mjs'; // SOW-111: the detail-open engagement beacon
import { membershipNewsFollowing } from './membership-news-following.mjs'; // sow-386: members-only news alerts for the bells
import { membershipDeployStatus } from './membership-deploy-status.mjs'; // sow-185: public "still deploying" status check
import { handleDiscordInvite } from './discord-invite.mjs';
import { listMemberPulls, memberPrStatus, listOpenPullsForReview, reviewFileContent, itemRevisions } from './github-app.mjs';
import { listRepoDrafts } from './membership-repo-drafts.mjs'; // sow-194: owner-scoped repo-draft listing
import { listSharesFeed, listMyShares } from './membership-shares.mjs';
import { listNetworkContent, listNetworkShares } from './membership-network.mjs'; // sow-317: every member's content, superadmin-only // sow-158 Part 3: tier-gated community Shares feed; sow-304: the caller's own shares
import { membershipAuthor, membershipAuthorTargets } from './membership-author.mjs'; // SOW-156 spike: hosted authoring (flagged); sow-183: superadmin reassignment targets
import { corsHeaders } from './cors.mjs'; // sow-158 Phase 1b: credentialed reflected-origin CORS for cookie routes
import { json, clientsFromEnv, MEMBERSHIP_CORS } from './route-helpers.mjs';

/**
 * sow-314: the Shop Talk calendar client, or null when the credential is not provisioned.
 *
 * Returning NULL rather than throwing is deliberate. The route degrades to reporting eligibility and opt-out
 * state with `enrolled: null` (unknown), which is honest, instead of 500ing a member who only wanted to know
 * whether they are on the call. It also means shipping this route before the Worker secrets are set is safe.
 */
function shoptalkCalendar(env) {
  if (!env?.GOOGLE_CALENDAR_CLIENT_ID || !env?.GOOGLE_CALENDAR_CLIENT_SECRET || !env?.GOOGLE_CALENDAR_REFRESH_TOKEN) return null;
  return createGoogleCalendarClient({
    clientId: env.GOOGLE_CALENDAR_CLIENT_ID,
    clientSecret: env.GOOGLE_CALENDAR_CLIENT_SECRET,
    refreshToken: env.GOOGLE_CALENDAR_REFRESH_TOKEN,
    calendarId: env.GOOGLE_CALENDAR_ID || 'primary',
  });
}

/**
 * sow-323: tell the owner that a publish put work into the editorial review queue.
 *
 * FIRED ONLY ON RECORDS ALREADY STORED. Both publish routes write the queue record before they open the pull
 * request and hand back exactly what they stored as `queued`, so a notice that fails costs the owner's
 * awareness of work waiting and never the work itself. Through waitUntil, so it never delays the response the
 * member is waiting on.
 */
function queueAlert(env, ctx, queued) {
  if (!Array.isArray(queued) || !queued.length) return;
  const send = sendEditorialQueueAlert(env, queued);
  if (ctx?.waitUntil) ctx.waitUntil(send);
}

/**
 * The member checks from the router, in the order they stood there. Returns the Response for a path and method
 * this group serves, or null so the router goes on to its next check.
 */
export async function handleMemberRoutes(request, env, ctx, { pathname, method }) {
  // SOW-011: the membership-status oracle for the local client (GitHub-bearer-token authenticated).
  // Cross-origin (the extension + the npm host call it), and it carries no cookies, so a wildcard CORS
  // origin with an Authorization allow-header is safe (no ambient credentials are exposed).
  if (pathname === '/membership/status') {
    // sow-158 Phase 1b: cookie-eligible, so credentialed reflected-origin CORS (corsHeaders sets
    // Vary: Origin, Authorization). A GET carries no CSRF gate. Bearer callers (the extension background +
    // the npm host) are not browser-CORS-bound, so reflecting only allow-listed origins does not affect them.
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipStatus(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-016: server-side member-content crypto. The AES-256-GCM epoch key NEVER leaves the Worker
  // (this supersedes the SOW-015 /membership/key handout). Both are POST, effective-paid gated, and
  // fail-closed; the decrypt response carries plaintext, so it is never cached.
  // sow-158 Phase 3a/3b: BOTH decrypt and encrypt are cookie-eligible now. decrypt lets the website
  // reader/editor read a member's own members-only body; encrypt (Phase 3b) lets a website member POST a
  // members-only comment (the body is encrypted server-side before the git write). Same posture for both:
  // credentialed reflected-origin CORS + automatic CSRF on the POST + effective-PAID gate, and the key never
  // leaves the Worker. encrypt grants a paid cookie member no new capability (the git write still rides the
  // own-folder-gated /membership/author), it just reaches the same oracle the bearer hosts already do.
  if (pathname === '/membership/decrypt') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipDecrypt(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  if (pathname === '/membership/encrypt') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipEncrypt(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-024: member activity (favorites + collections) in the deletable edge store. Token-authenticated,
  // per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
  if (pathname === '/membership/activity') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleActivity(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-057: server-side OpenGraph preview for the share composer. Authenticated (any signed-in member),
  // SSRF-guarded, bounded, never cached. Cookie-enabled (credentialed reflected-origin CORS + allowCookie)
  // so the WEBSITE share composer (homepage + /account/) can fetch previews over the gbti_session cookie; a
  // cookie POST clears the CSRF gate inside resolveIdentity. The extension/npm bearer path is unchanged.
  if (pathname === '/membership/og-preview') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await handleOgPreview(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-100: the guild's channel names (admin-gated, KV-cached) for the categories workspace picker.
  if (pathname === '/membership/discord-channels') {
    // sow-161 B: cookie-enabled for the WEBSITE categories channel column (superadmin). Credentialed CORS
    // (reflected origin + Allow-Credentials), matching the other cookie routes; the extension calls this from
    // its background service worker under host_permissions, which bypasses CORS, so the switch off the
    // wildcard MEMBERSHIP_CORS does not affect the bearer path. A GET carries no CSRF.
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipDiscordChannels(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-427: the SIGNED-OUT read of a prepared listing by the code in its link, for the claim page. Anonymous,
  // IP rate limited, and one identical 404 for every inactive case. The code is a bearer secret and the body is
  // about a person, so never cached, and varied on the bearer like the membership oracle.
  // sow-437: /invite/title is the personal title only, asked for by the site's edge function for the claim page head.
  if (pathname === '/invite/listing' || pathname === '/invite/listing-image' || pathname === '/invite/title') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'GET') {
      const r = pathname === '/invite/listing' ? await inviteListingRead(request, env)
        : pathname === '/invite/title' ? await inviteTitleRead(request, env)
          : await inviteListingImage(request, env);
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  // sow-427 C2: CLAIMING a prepared listing. Signed in (bearer, or the website cookie with CSRF on the POST), so
  // credentialed CORS and never cached. The claim publishes the stored record plus the claimant's own note; the
  // POST reads only `code` and `note`. A response may carry `notify` (the merge was noticed here): the owner
  // notice goes out through waitUntil, fail-soft, and never delays the page.
  if (pathname === '/membership/claim') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = method === 'GET'
        ? await membershipClaimStatus(request, env, { allowCookie: true })
        : await membershipClaimPost(request, env, { allowCookie: true });
      if (r.notify && ctx?.waitUntil) ctx.waitUntil(sendListingClaimedAlert(env, r.notify));
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  // SOW-023: the member follow graph (subscriptions) in the deletable edge store. Signed-in, non-banned
  // (the FREE tier, SOW-060; authorizeMember denies banned), per-member, private, ERASABLE. Per-token body, so
  // never cached and varied on the bearer.
  if (pathname === '/membership/follows') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleFollows(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-150 / SOW-186: the per-member NOTIFICATION store (the activity bell's server-backed source) in the
  // deletable edge store. Signed-in, non-banned (the FREE tier, SOW-060; authorizeMember denies banned),
  // per-member, private, ERASABLE (SOW-024). The caller only ever reads/marks THEIR OWN. Per-token body, so
  // never cached and varied on the bearer. The WRITE path is server-side (deliverNotification), not exposed
  // here, so a member cannot post rows into a bell. GET reads the list; POST /seen marks seen.
  if (pathname === '/membership/notifications' || pathname === '/membership/notifications/seen') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    const isSeen = pathname === '/membership/notifications/seen';
    if ((isSeen && method === 'POST') || (!isSeen && method === 'GET')) {
      const r = await handleNotifications(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-157: the hosted draft store (a hosted member has no fork to stage on). Signed-in, non-banned
  // (trial may stage; SOW-011 keeps trial drafts OFF the canonical repo, and this store never touches
  // git). Per-member, private, ERASABLE (SOW-024). Per-token body: never cached, varied on the bearer.
  if (pathname === '/membership/drafts') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleDrafts(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // The staged IMAGE bytes for those drafts. They cannot live inside the draft record (a draft is capped
  // at 150,000 bytes and one image may be 1,048,576), so they get their own keys under `draftimg:<id>:`.
  // Same auth bar as the draft store, same privacy properties: per-member, private, ERASABLE (SOW-024),
  // never cached and varied on the bearer. The key is derived from the AUTHENTICATED id, so a caller
  // cannot address another member's image.
  if (pathname === '/membership/draft-image') {
    const cors = corsHeaders(request, env, { credentials: true }); // credentialed cookie route (POST -> CSRF gate in resolveIdentity, as /membership/drafts)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleDraftImage(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-083 P2: a member's OWN earnings ledger (the SOW-059 revenue dashboard data), written by the offline
  // payout job. Signed-in + non-banned (Stripe-free); a free / non-earning member gets an empty ledger. Per-token
  // body, so never cached and varied on the bearer.
  if (pathname === '/membership/earnings') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await handleEarnings(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-076 P1: optimistic comment echoes (instant-feel). A member's own pending comment appears in <1s from KV
  // while its SOW-072 PR auto-merges + deploys behind it. Signed-in + non-banned; read-your-writes (a member sees
  // only their own echoes). Per-token body, so never cached, varied on the bearer.
  if (pathname === '/membership/comment-echo') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleCommentEcho(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-139: the PUBLIC news list (owner-directed policy change; see membership-news.mjs). Anonymous,
  // metadata-only, capped, and browser-cacheable; the NEWS_API_KEY still never leaves this Worker.
  if (pathname === '/news/feed') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'GET') {
      const r = await publicNews(request, env);
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'public, max-age=300' });
    }
  }

  // sow-185: PUBLIC "still deploying" status check for a content item. Anonymous, cheap, briefly
  // edge-cacheable (short max-age so a visitor's own poll loop still sees a fresh read within a few
  // seconds of the real state changing, while many simultaneous visitors on the same slug share one edge
  // read instead of each hitting KV directly).
  if (pathname === '/membership/deploy-status') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'GET') {
      const r = await membershipDeployStatus(request, env);
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'public, max-age=15' });
    }
  }

  // sow-386: the recent stories from the news sources the caller follows, for the notification bells. Members only
  // (authorizePaid, fail closed). Per-member, so private; five minutes of browser cache so moving between pages
  // does not ask again. Cookie-readable for the website header bell.
  if (pathname === '/membership/news-following') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipNewsFollowing(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': r.status === 200 ? 'private, max-age=300' : 'no-store', Vary: 'Authorization, Cookie' });
    }
  }

  // SOW-043: the members-only news proxy. Effective-paid gated; the news worker's NEWS_API_KEY is held by this
  // Worker and never reaches the client. Per-token body, so never cached and varied on the bearer.
  if (pathname === '/membership/news' || pathname === '/membership/news-categories' || pathname === '/membership/news-sources') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-readable (the website /news mount)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = pathname === '/membership/news' ? await membershipNews(request, env, { allowCookie: true })
        : pathname === '/membership/news-sources' ? await membershipNewsSources(request, env, { allowCookie: true })
        : await membershipNewsCategories(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // SOW-046: member prefs (category interests + followed news channels) in the deletable edge store.
  // Effective-paid, per-member, private, ERASABLE. Per-token body, so never cached and varied on the bearer.
  // sow-314: the Shop Talk Saturday call. Enrollment is AUTOMATIC via the reconcile sweep; this route is
  // how a member SEES where they stand and opts out. Signed-in and non-banned rather than paid-only, so a
  // free or lapsed member gets a real answer and the reason instead of a 403 that reads as breakage.
  if (pathname === '/membership/shoptalk') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleShoptalk(request, env, { stripe: createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }), calendar: shoptalkCalendar(env) });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-202: the signed-in member's weekly digest on/off switch (/account/notifications/). Credentialed cookie
  // route, so a POST passes the CSRF gate in resolveIdentity like /membership/prefs below.
  if (pathname === '/membership/digest') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handleDigestSwitch(request, env, { stripe: createStripeClient({ apiKey: env.STRIPE_SECRET_KEY }) });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  if (pathname === '/membership/prefs') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 1b: credentialed cookie route (POST -> CSRF gate in resolveIdentity)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET' || method === 'POST') {
      const r = await handlePrefs(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-046 C: publish a members-only news item to its mapped Discord channel. CURATOR-gated (admin/superadmin
  // OR an explicit roles.yml curators: listing, checked server-side from the KV mirror). The Discord bot token
  // never leaves this Worker; posts once, deduped on the news guid. Per-token, so never cached, varied on bearer.
  if (pathname === '/membership/news-publish') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'POST') {
      const r = await membershipNewsPublish(request, env);
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // SOW-046 D: reflect a news DISCUSSION onto its Discord post. Effective-paid (any member who can comment);
  // appends a one-time "members are discussing this" notice to the curator-posted message. No-op if the item
  // was never posted to Discord. Per-token, so never cached, varied on bearer.
  if (pathname === '/membership/news-discussed') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-writable (POST -> CSRF gate)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipNewsDiscussed(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // SOW-111: the news detail-open engagement beacon. Tier-gated by the mirrored news_engagement config; at
  // the open threshold the item auto-posts ONCE to its mapped category channel (the shared post-once core).
  if (pathname === '/membership/news-opened') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158: cookie-writable (POST -> CSRF gate)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipNewsOpened(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-274 Part 4: POST /membership/open-pr (opening a pull request from a member's own fork) is retired;
  // every member publishes through the hosted author route below.

  // SOW-156 (spike, flag MEMBERSHIP_AUTHOR_ENABLED): hosted authoring. A paid member with no fork and no
  // App install POSTs own-folder files; the Worker validates fail-closed, commits them to a
  // hosted/<github_id>/<itemId> branch on the CANONICAL repo, and opens the PR. The gate stays the only
  // merger. The App token never leaves the Worker.
  if (pathname === '/membership/author') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: website (cookie) publish (POST -> CSRF)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'POST') {
      const r = await membershipAuthor(request, env, { allowCookie: true });
      queueAlert(env, ctx, r.queued); // sow-323: fail-soft, and only on records already stored
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-183: superadmin-only, the Author-reassignment picker source (GET, no CSRF). Same member index the
  // gate + /membership/author already trust; house is not an entry here, the editor adds it as a fixed option.
  if (pathname === '/membership/author/targets') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await membershipAuthorTargets(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // sow-274 Part 4: POST /membership/sync-fork (syncing a member fork's main) is retired with the fork path.

  // SOW-026 + SOW-157: the member's own pull requests and their gate status, read with GBTI's installation
  // token and SCOPED to the caller: network-opened PRs by the github_id in the branch, and PRs a member opened
  // from their own fork before sow-274 by head owner. Public data; member-scoped.
  if (pathname === '/membership/my-pulls') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable (authMemberLogin)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await listMemberPulls(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  if (pathname === '/membership/pr-status') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await memberPrStatus(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  // sow-158 Part 3: the community Shares feed for the /account hub. Tier-gated (paid/trial see the members
  // stream; free/banned see PUBLIC shares only), members bodies pointer-only. Cookie-or-bearer, per-caller.
  if (pathname === '/membership/shares') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await listSharesFeed(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  // sow-304: the caller's OWN shares for the WorkBench Shares tab (drafts included, members bodies as pointers).
  if (pathname === '/membership/my-shares') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await listMyShares(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization, Cookie' });
    }
  }

  // sow-317: the WorkBench's Network content scope, superadmin-only: every member's items for a type (the
  // site's published index plus what sits unpublished on main) and every member's shares, drafts included.
  if (pathname === '/membership/network-content' || pathname === '/membership/network-shares') {
    const cors = corsHeaders(request, env, { credentials: true });
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      // allowCookie: the WorkBench on the website has no bearer token; without it the second superadmin saw
      // "a GitHub bearer token is required" on Network shares (2026-09-11). The role is still the fresh mirror.
      const r = pathname === '/membership/network-content' ? await listNetworkContent(request, env, { allowCookie: true }) : await listNetworkShares(request, env, { allowCookie: true });
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Authorization, Cookie' });
    }
  }

  // Read proxies with GBTI's installation token. /membership/open-pulls feeds the superadmin open-PR queue
  // (SOW-038) and /membership/file feeds publishing and the reader. They are not head-owner-scoped, which is
  // safe because the canonical repo is public. sow-274 removed the two that only the contribution review
  // inbox used (/membership/pr and /membership/pr-files) along with the inbox.
  if (pathname === '/membership/open-pulls') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'GET') {
      const r = await listOpenPullsForReview(request, env);
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }
  if (pathname === '/membership/file') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-158 Phase 3a: cookie-readable (the WorkBench reader)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await reviewFileContent(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }
  if (pathname === '/membership/revisions') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-232: the editor's Live revisions tile (cookie or bearer)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await itemRevisions(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': r.status === 200 ? 'private, max-age=600' : 'no-store', Vary: 'Authorization, Cookie' });
    }
  }
  if (pathname === '/membership/repo-drafts') {
    const cors = corsHeaders(request, env, { credentials: true }); // sow-194: owner-scoped repo-draft listing (cookie or bearer)
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (method === 'GET') {
      const r = await listRepoDrafts(request, env);
      return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store' });
    }
  }

  // SOW-058: the superadmin syndication tracker (admin read) + approve/cancel (superadmin only), the SOW-121
  // Social Queue and the SOW-088 "Manually Syndicate" rail. Fail-closed via the overrides mirror; never cached.
  // sow-399: syndication management moved from the extension to the WEBSITE, which signs in by cookie. So these
  // routes take credentialed CORS and pass allowCookie; a cookie POST must clear the double-submit CSRF gate
  // (resolveIdentity). A bearer token (the agent server) still works. Vary keeps Origin (credentialed CORS
  // reflects it) and adds Cookie, since the answer now depends on either credential.
  {
    const SYNDICATION_ROUTES = {
      '/membership/syndication': { GET: handleSyndicationTracker },
      '/membership/syndication/approve': { POST: handleSyndicationApprove },
      '/membership/syndication/cancel': { POST: handleSyndicationCancel },
      '/membership/social-queue': { GET: handleSocialQueueGet, POST: handleSocialQueueAction },
      '/membership/syndicate-now': { GET: handleSyndicateNowInfo, POST: handleSyndicateNow },
    };
    const verbs = SYNDICATION_ROUTES[pathname];
    if (verbs) {
      const cors = corsHeaders(request, env, { credentials: true, methods: `${Object.keys(verbs).join(', ')}, OPTIONS` });
      if (method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      const handler = verbs[method];
      if (handler) {
        const r = await handler(request, env, { allowCookie: true });
        return json(r.body, r.status, { ...cors, 'Cache-Control': 'no-store', Vary: 'Origin, Authorization, Cookie' });
      }
    }
  }

  // On-demand Discord guild invite for the welcome view. The bot mints a real invite (token never leaves the
  // Worker), cached in KV so we do not spam Discord; fail-closed to the static DISCORD_INVITE_URL. Auth = a
  // verified GitHub token; channel access is still governed by the reconcile role sync.
  if (pathname === '/membership/discord-invite') {
    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: MEMBERSHIP_CORS });
    if (method === 'GET') {
      // Build the bot client defensively: if DISCORD_BOT_TOKEN is unset, the handler falls back to the
      // static DISCORD_INVITE_URL rather than 500-ing.
      let discord = null;
      try { discord = clientsFromEnv(env).discord; } catch { discord = null; }
      // sow-356: the invite is gated by the same rule as the join; an unwired gate refuses.
      const checkJoin = (githubId) => discordJoinEligibility({ kv: env.SIGNUP_KV, stripe: clientsFromEnv(env).stripe, githubId, priceTierMap: buildEnvPriceTierMap(env) });
      const r = await handleDiscordInvite(request, env, { discord, checkJoin });
      return json(r.body, r.status, { ...MEMBERSHIP_CORS, 'Cache-Control': 'no-store', Vary: 'Authorization' });
    }
  }

  return null;
}
