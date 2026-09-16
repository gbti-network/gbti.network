// sow-343 Phase 3: the WorkBench onboarding card's data and markup, kept out of the element so node tests can
// drive both. The owner asked for a card that stays while any welcome step is outstanding, with no dismiss
// (2026-09-16), and ruled the same day that a skipped step keeps it showing.
//
// It reads real account state the same way the welcome wizard does and merges it with the stored record
// (membership/onboarding.mjs onboardingProgress). Any read that fails makes the whole view unknown, and an
// unknown view renders nothing: a reminder that lists finished work as unfinished is worse than no reminder.
import { onboardingProgress, profileHasSocials } from '../../membership/onboarding.mjs';
import { SOCIAL_KEYS } from './social-icons.mjs';
import { esc } from './base.mjs';

export const WELCOME_SITE_URL = 'https://gbti.network/welcome/';

const answer = (p) => Promise.resolve().then(p).then((v) => ({ ok: true, v }), (e) => ({ ok: false, e }));

/**
 * Read everything the card needs through the host client. Returns the onboardingProgress input, with `null` (or
 * `undefined` for the record) wherever a read failed. Never throws.
 */
export async function loadOnboardingState(client) {
  if (!client) return {};
  const status = await answer(() => client.status());
  const who = status.ok ? (status.v?.identity?.username || status.v?.identity?.login || '') : '';
  const [prefs, follows, discord, profile] = await Promise.all([
    answer(() => client.getPrefs()),
    answer(() => client.getFollows()),
    answer(() => client.discordLinkStatus()),
    answer(async () => {
      const list = await Promise.resolve(client.listContent?.({ type: 'profile' })).catch(() => null);
      const path = list?.items?.[0]?.path || (who ? `members/${who}/profile.md` : '');
      if (!path) throw new Error('no identity to read a profile for');
      try { return await client.getContentItem({ path }); } catch (e) { if (e?.code === 'not-found') return null; throw e; }
    }),
  ]);
  const followList = follows.ok ? (Array.isArray(follows.v) ? follows.v : follows.v?.following) : null;
  return {
    discordLinked: discord.ok && typeof discord.v?.linked === 'boolean' ? discord.v.linked : null,
    follows: Array.isArray(followList) ? followList : null,
    topics: prefs.ok && Array.isArray(prefs.v?.categories) ? prefs.v.categories : null,
    profileSocials: profile.ok ? profileHasSocials(profile.v?.frontmatter?.links, SOCIAL_KEYS) : null,
    record: prefs.ok ? (prefs.v?.onboarding ?? null) : undefined,
  };
}

/** The card's view: the loaded state merged with the record. `known: false` when anything could not be read. */
export async function loadProgress(client) {
  return onboardingProgress(await loadOnboardingState(client));
}

// A short per-account memory, because the WorkBench overview re-renders often and each render recreates the card.
// A recreated card cannot know the account synchronously, so the page's last account is remembered alongside.
const CACHE = new Map();
let LAST = null;
export const CARD_TTL_MS = 60_000;
export function cachedProgress(key = LAST, now = Date.now()) {
  const hit = key ? CACHE.get(key) : null;
  return hit ? { progress: hit.progress, fresh: now - hit.at < CARD_TTL_MS } : null;
}
export function rememberProgress(key, progress, now = Date.now()) { CACHE.set(key, { at: now, progress }); LAST = key; }
export function forgetProgress() { CACHE.clear(); LAST = null; }

/**
 * The card markup, or '' when there is nothing honest to say (every step done, or the view unknown). Unfinished
 * steps link to the welcome wizard at that step; `external` opens it in a new tab (the extension, which has no
 * welcome page of its own on the site's origin). There is deliberately no dismiss control.
 */
export function onboardingCardHtml(progress, { welcomeUrl = '/welcome/', external = false } = {}) {
  if (!progress?.known || progress.complete) return '';
  const target = external ? ' target="_blank" rel="noopener"' : '';
  const total = progress.steps.length;
  const done = total - progress.outstanding;
  const rows = progress.steps.map((s) => {
    const href = `${welcomeUrl}?step=${encodeURIComponent(s.key)}`;
    if (s.state === 'done') return `<li class="st done" data-state="done"><span class="mk" aria-hidden="true">&#10003;</span><span>${esc(s.title)}</span></li>`;
    const tag = s.state === 'skipped' ? '<span class="tag">Skipped</span>' : '';
    return `<li class="st ${esc(s.state)}" data-state="${esc(s.state)}"><span class="mk" aria-hidden="true"></span><a href="${esc(href)}"${target}>${esc(s.title)}</a>${tag}</li>`;
  }).join('');
  return `<section class="ob" aria-label="Finish setting up">
    <div class="ob-head"><b>Finish setting up your membership</b><span class="ob-count">${done} of ${total} done</span></div>
    <p class="ob-sub">Each step makes the network more useful to you. This stays here until every step is done.</p>
    <ol class="ob-steps">${rows}</ol>
  </section>`;
}
