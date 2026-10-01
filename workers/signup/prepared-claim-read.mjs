// sow-427 B4: the SIGNED-OUT read of a prepared listing, by the invitation code in its link.
//
//   GET /invite/listing?code=<CODE>                    -> 200 { ok, listing: publicListingView }  |  404 inactive
//   GET /invite/listing-image?code=<CODE>&name=<file>  -> 200 { ok, name, dataBase64, contentType } | 404 inactive
//
//   GET /invite/title?code=<CODE>                      -> 200 { ok, title }                    | 404 inactive  (sow-437)
//
// Anyone may call these: the person the link was sent to has no account yet, and the claim page has to show them
// the project before they decide. So the code IS the authorization (the bearer property sow-231 accepted), and the
// route is built so that holding a wrong code teaches nothing:
//   - the code's shape is checked before anything else, so a malformed code costs no KV read;
//   - every read is rate limited per IP (rl:listing-read: 30 and rl:listing-img: 120 per ten minutes), and an
//     absent IP is refused, because the limiter fails closed;
//   - EVERY inactive case (unknown, malformed, revoked, claimed, expired, deleted, a code replaced by "Send
//     again", an unlisted image name, a stored image gone missing) answers the SAME 404 body, byte for byte, with
//     nothing about the project in it: not the title, not the person's name, not whether a listing ever existed.
//
// What a readable listing shows is publicListingView: the project, the greeting and the personal message, the
// suggested note, the preparer's login, the tied account's login (sow-434, for the example profile's GitHub link),
// and the campaign's tier and length. Never the administration note (that lives on the invite and is not read into
// the answer), never a code, never an account number, so never the number a tie is stored by.
//
// THE CAMPAIGN IS READ FOR ITS TERMS ONLY, WITHOUT THE ACTIVE GATE (sow-231 trap 1, sow-427 trap 6): switching a
// campaign off closes its walk-up code, and must not void a prepared invitation already in someone's inbox. A
// registry that cannot be read leaves the tier and length null; the page then omits that line rather than guess.
//
// No logging: the code is a bearer secret, and everything in the answer is about a person.

import { rateLimit } from './abuse.mjs';
import { readInvite } from './invites-store.mjs';
import { readCouponsConfig } from './coupons.mjs';
import { readListing, readListingImage } from './prepared-store.mjs';
import { COUPON_CODE_RE, couponsFromParsed, normalizeCouponCode } from '../../membership/coupons.mjs';
import { isListingId, isListingImageName, publicReadable, publicListingView, invitationTitle } from '../../membership/prepared-listings.mjs';

/** The per-IP limits on the two public reads. An image page load asks for several images, so its limit is wider. */
export const LISTING_READ_LIMIT = Object.freeze({ limit: 30, windowSeconds: 600, prefix: 'rl:listing-read:' });
export const LISTING_IMAGE_LIMIT = Object.freeze({ limit: 120, windowSeconds: 600, prefix: 'rl:listing-img:' });
/**
 * sow-437: the personal title is asked for by the site's own edge function, whose calls may all arrive from one shared
 * Cloudflare address, so this limit is wider than the page read's, and a call with no address is counted under one
 * shared key instead of being refused. Going over it costs nothing but the personalization: the function then serves
 * the generic title. The code space (about 49 bits) remains the control on guessing, as it is for the page read.
 */
export const LISTING_TITLE_LIMIT = Object.freeze({ limit: 60, windowSeconds: 600, prefix: 'rl:listing-title:' });
const SHARED_EDGE_KEY = 'edge';

/** The one answer for every case that is not a readable listing. A fresh object each time, never shared state. */
export const inactiveResponse = () => ({ status: 404, body: { ok: false, error: 'inactive' } });

const msOf = (now) => (now instanceof Date ? now.getTime() : new Date(now).getTime());

/**
 * The invite and listing a public request may read, or the response to send instead. In this order: the code's
 * shape (no KV), the per-IP limit, the invite, the listing it names, then publicReadable over both.
 */
async function readable(request, env, { kv, now, limiter, limit, ipFallback = '' }) {
  if (!kv) return { res: { status: 503, body: { ok: false, error: 'unavailable' } } };
  const params = new URL(request.url).searchParams;
  const code = normalizeCouponCode(params.get('code'));
  if (!COUPON_CODE_RE.test(code)) return { res: inactiveResponse() };

  const ip = request.headers.get('CF-Connecting-IP') || ipFallback;
  let rl;
  try { rl = await limiter({ kv, ip, ...limit, now: msOf(now) }); } catch { rl = null; }
  if (!rl?.allowed) return { res: { status: 429, body: { ok: false, error: 'rate_limited' } } };

  const invite = await readInvite(kv, code);
  if (!invite || !isListingId(invite.listingId)) return { res: inactiveResponse() };
  const listing = await readListing(kv, invite.listingId);
  if (!publicReadable(invite, listing, now)) return { res: inactiveResponse() };
  return { invite, listing, params };
}

/** GET /invite/listing?code= : the prepared project and the invitation text, for the claim page. */
export async function inviteListingRead(request, env, { kv = env?.SIGNUP_KV, now = new Date(), limiter = rateLimit } = {}) {
  const r = await readable(request, env, { kv, now, limiter, limit: LISTING_READ_LIMIT });
  if (r.res) return r.res;
  let terms = null;
  const config = await readCouponsConfig(kv, now instanceof Date ? now : new Date(now));
  if (config) {
    const c = couponsFromParsed(config).get(normalizeCouponCode(r.invite.campaign));
    if (c) terms = { tier: c.tier, freeDays: c.freeDays };
  }
  return { status: 200, body: { ok: true, listing: publicListingView(r.listing, terms) } };
}

/**
 * GET /invite/listing-image?code=&name= : one image the prepared project uses, as base64 in JSON (the shape the
 * website's staged-image loader already reads). Only a name the listing itself lists is served, and the check runs
 * after the listing is known to be readable, so a guessed name on a dead code learns nothing either.
 */
export async function inviteListingImage(request, env, { kv = env?.SIGNUP_KV, now = new Date(), limiter = rateLimit } = {}) {
  const r = await readable(request, env, { kv, now, limiter, limit: LISTING_IMAGE_LIMIT });
  if (r.res) return r.res;
  const name = String(r.params.get('name') ?? '');
  if (!isListingImageName(name) || !Array.isArray(r.listing.images) || !r.listing.images.includes(name)) return inactiveResponse();
  const img = await readListingImage(kv, r.listing.id, name);
  if (!img) return inactiveResponse();
  return { status: 200, body: { ok: true, name, dataBase64: img.dataBase64, contentType: img.contentType } };
}

/**
 * GET /invite/title?code= (sow-437): the personal title of a live invitation, and nothing else, for the site's edge
 * function to put in the page title and the link-preview tags. Every inactive case answers the same 404 as the page
 * read, so a dead link keeps the generic title. Never logged.
 */
export async function inviteTitleRead(request, env, { kv = env?.SIGNUP_KV, now = new Date(), limiter = rateLimit } = {}) {
  const r = await readable(request, env, { kv, now, limiter, limit: LISTING_TITLE_LIMIT, ipFallback: SHARED_EDGE_KEY });
  if (r.res) return r.res;
  const title = invitationTitle({ recipientName: r.listing.recipientName, title: r.listing.frontmatter?.title ?? r.listing.title });
  if (!title) return inactiveResponse();
  return { status: 200, body: { ok: true, title } };
}
