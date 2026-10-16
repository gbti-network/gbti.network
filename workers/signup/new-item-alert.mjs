// sow-458: tell the owner when a member CREATES an article, project, prompt or share. It replaces sow-323's
// editorial-alert.mjs ("waiting for review"), which went with editorial review on 2026-10-16. The owner kept the
// email: "I still want to be emailed every time a user creates a project / prompt / article / share".
//
// TWO HALVES, both used by the hosted author route (membership-author.mjs):
//   - newItemsOnMain decides which items of a publish are NEW: an item whose path, and every path it had before a
//     rename, is ABSENT from main. It answers only on a definite 404, so a GitHub error never mails an edit as new.
//   - sendNewItemsAlert sends one email per publish, FAIL-SOFT BY CONTRACT like coupon-alert.mjs: it runs after the
//     publish, through waitUntil, and a notice that fails (or is unprovisioned) must never undo or delay it.
//
// A pull request merges a few minutes after it opens, and an author can publish the same new item twice in that
// window, so a sent item is remembered in KV for a week and not mailed again.

import { createResendClient } from '../../clients/resend.mjs';
import { newItemsNotice } from '../../membership/new-item-notify.mjs';

const GH = 'https://api.github.com';
const trimmed = (v) => String(v ?? '').trim();
export const NEW_ITEM_SEEN_PREFIX = 'newitem:';
const SEEN_TTL_SECONDS = 7 * 24 * 3600;

/** Is this repository path on main? true, false (a definite 404), or null (could not tell). */
async function onMain({ fetchImpl, instToken, upstream, path }) {
  try {
    const r = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, {
      method: 'GET',
      signal: typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(4000) : undefined, // never hold a publish up
      headers: { Authorization: `Bearer ${instToken}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' },
    });
    if (r?.status === 200) return true;
    if (r?.status === 404) return false;
    return null;
  } catch { return null; }
}

/**
 * The items (from contentItemsIn) that do not exist on main under their path or any path they had before a rename.
 * Never throws; an item it cannot decide is left out.
 */
export async function newItemsOnMain({ fetchImpl, instToken, upstream, items }) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const paths = [item?.path, ...(Array.isArray(item?.priorPaths) ? item.priorPaths : [])].filter((p) => typeof p === 'string' && p && !p.includes('..'));
    if (!paths.length) continue;
    let isNew = true;
    for (const path of paths) {
      const seen = await onMain({ fetchImpl, instToken, upstream, path });
      if (seen !== false) { isNew = false; break; } // on main, or unknown: not mailed as new
    }
    if (isNew) out.push(item);
  }
  return out;
}

function resolveSend(env, sendEmail) {
  if (sendEmail) return sendEmail;
  const apiKey = trimmed(env?.RESEND_API_KEY);
  return apiKey ? createResendClient({ apiKey }).sendEmail : null;
}

/**
 * Email the owner about the new items of one publish. `kv` (optional) remembers what was sent so a second publish of
 * the same new item before it merges is not mailed again.
 *
 * @returns `{ sent, reason?, message? }`. Never throws.
 */
export async function sendNewItemsAlert(env, items, { sendEmail, kv = env?.SIGNUP_KV } = {}) {
  let list = Array.isArray(items) ? items.filter(Boolean) : [];
  if (!list.length) return { sent: false, reason: 'nothing_new' };
  try {
    if (kv?.get) {
      const fresh = [];
      for (const it of list) if (!(await kv.get(`${NEW_ITEM_SEEN_PREFIX}${trimmed(it.path)}`).catch(() => null))) fresh.push(it);
      list = fresh;
      if (!list.length) return { sent: false, reason: 'already_sent' };
    }
    const to = trimmed(env?.NEW_ITEM_EMAIL || env?.EDITORIAL_REVIEW_EMAIL || env?.CREATOR_APPLICATION_EMAIL || env?.COUPON_ALERT_EMAIL);
    const from = trimmed(env?.MAIL_FROM || env?.RESEND_FROM);
    if (!to || !from) { warn(list, 'no recipient or no sender'); return { sent: false, reason: 'unconfigured' }; }
    const send = resolveSend(env, sendEmail);
    if (!send) { warn(list, 'no RESEND_API_KEY and no injected sender'); return { sent: false, reason: 'unconfigured' }; }
    const { subject, text, html } = newItemsNotice(list, { origin: trimmed(env?.SITE_ORIGIN) || undefined });
    await send({ from, to, subject, text, html });
    if (kv?.put) {
      for (const it of list) await kv.put(`${NEW_ITEM_SEEN_PREFIX}${trimmed(it.path)}`, '1', { expirationTtl: SEEN_TTL_SECONDS }).catch(() => {});
    }
    return { sent: true };
  } catch (err) {
    // Swallowing is not saying nothing: without this line a rejected send leaves no trace at all.
    const message = err?.message ?? String(err);
    console.warn(`new-item-alert: notice FAILED for ${describe(list)}: ${message}. The items ARE published; the owner was not told.`);
    return { sent: false, reason: 'error', message };
  }
}

function describe(list) {
  return list.length > 1 ? `${list.length} items from ${trimmed(list[0]?.login) || '?'}` : (trimmed(list[0]?.path) || '?');
}

function warn(list, why) {
  console.warn(`new-item-alert: notice NOT SENT for ${describe(list)}: ${why}. Expected in sandbox; in production the owner is not told about new work.`);
}
