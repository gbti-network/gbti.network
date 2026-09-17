// <gbti-welcome> (SOW-029): the post-setup welcome view, mounted by the extension when the onboarding wizard's
// ready button ("Complete Integration") fires gbti:onboarding-start. Styled per the owner's Claude Design
// handoff (2026-07-20, "Welcome Flow.dc.html"): a left rail stepper (numbered circles, clickable), a per-step
// heading + progress bar, the step content, and a Back/Skip/Continue footer, in the handoff's dark + light
// palettes. sow-344 (2026-09-16) took the CARD away: the two columns sit on the page itself with one hairline
// between them, nothing scrolls inside, and both hosts get the same look. It walks the member through five to-dos:
//   Discord (connect + role), Follow the channels (the GBTI properties grid), Your socials (staged handles),
//   Follow members (the directory grid), Follow topics (the shared picker) -> a done state with stats.
// Host-agnostic: it consumes only the injected client + a public fetch of /members-index.json, so it runs in
// the extension now and the npm CMS later. Emits gbti:welcome-done when the member finishes.
import { GbtiElement, define, esc } from '../base.mjs';
import { phaseLabel, shuffle, excludeSelf, paginate, resumeStep, accountKey, socialPrefill, mergeChannelFollows, requestedStep } from '../welcome-core.mjs';
import { ONBOARDING_STEPS } from '../../../membership/onboarding.mjs'; // sow-343: the one step list (the WorkBench card reads it too)
import { saveWizardSocials } from '../welcome-socials.mjs'; // sow-343: Continue on the socials step saves
import { readOwnProfile } from '../own-profile.mjs'; // sow-346: the one safe read of your own profile
import { DISCORD_LINK_URL } from '../discord.mjs';
import { discordJoinAllowed } from '../../../membership/discord-roles.mjs'; // sow-356: the community is a paid perk
import { socialIcon, SOCIAL_KEYS, SOCIAL_LABELS } from '../social-icons.mjs';
import { recallProfileSocials } from '../profile-fields.mjs'; // SOW-129 QA: recall saved profile socials into the welcome step
import './gbti-topic-picker.mjs'; // SOW-054: the followed-topics step control
import { WELCOME_CSS as CSS } from './welcome-css.mjs'; // sow-349: the stylesheet lives in its own module

const SITE = 'https://gbti.network';
const PAGE_SIZE = 12;
// sow-345: these are key BASES. Every read and write goes through _lsGet/_lsSet, which scope them by the signed-in
// account (accountKey), because a bare key leaks between the accounts that share one browser. The bare keys are
// purged on load and never read again.
const DISCORD_DONE_KEY = 'gbti-welcome-discord-joined';
const CHAN_FOLLOWED_KEY = 'gbti-welcome-chan-followed'; // channels the member opened Follow on (local, best-effort)

// The five steps. sow-343 moved the list to membership/onboarding.mjs, because the WorkBench progress card and the
// stored skips must agree with the wizard on what the steps are: `label` + `sub` feed the rail, `heading` the pane.
const STEPS = ONBOARDING_STEPS;
const DONE_HEADING = 'You are all set';

// GBTI's own channels (mirrors src/lib/social.ts, the site footer; the extension cannot import site TS).
// Rendered as a card grid per the design handoff; Follow opens the channel and marks the card followed.
const GBTI_CHANNELS = [
  ['reddit', 'Reddit', 'https://www.reddit.com/r/GBTI_network', 'Member articles, projects, and prompts syndicate to our community subreddit. Open it and hit Join.', 'r/GBTI_network'],
  ['x', 'X', 'https://x.com/gbti_network', 'Syndicated member work and network updates, as they publish.', '@gbti_network'],
  ['bluesky', 'Bluesky', 'https://bsky.app/profile/gbti.bsky.social', 'The same syndicated stream on Bluesky.', '@gbti.bsky.social'],
  ['youtube', 'YouTube', 'https://www.youtube.com/@gbti_network', 'Video sessions and walkthroughs from the network.', '@gbti_network'],
  ['github', 'GitHub', 'https://github.com/gbti-network', 'The public content repo and our open source work.', 'gbti-network'],
  ['devto', 'Dev.to', 'https://dev.to/gbti', 'Member articles crossposted to the GBTI organization on DEV.', '@gbti'],
  // sow-217: the Hashnode follow tile is REMOVED with the footer link. Retiring the channel while still
  // inviting new members to follow the publication would point them at something nobody maintains.
  ['dailydev', 'daily.dev', 'https://daily.dev/squads/gbti_network/', 'Follow the GBTI squad inside your daily.dev feed.', 'GBTI squad'],
  ['linkedin', 'LinkedIn', 'https://www.linkedin.com/company/gbti-network/posts', 'Network updates and member work on LinkedIn.', 'GBTI Network'],
];

// The socials step: raw handles stage here while the member types. sow-343: Continue saves them onto the profile
// (_saveSocials), and a trial member's are kept on the account until they can publish one.
const SOCIALS_STAGE_KEY = 'gbti-welcome-socials';
// Shown by default: the syndication-mentioned platforms first (X / Bluesky / Mastodon get automatic handle
// mentions today), then the common presence links. GitHub is implicit (they signed in with it) and Discord
// connects in step 1, so neither is collected here.
const SOCIAL_STARTERS = ['x', 'bluesky', 'linkedin', 'youtube', 'website']; // sow-159: mastodon retired
const SOCIAL_HIDDEN = new Set(['github', 'discord']);

// The member-card avatar fallback palette (the design handoff's initials discs).
const AV_COLORS = ['#1f9e5f', '#c98a2b', '#5a8ad6', '#9b6fd0', '#d0715f', '#3fa88a', '#c85b8e'];
const avColor = (name) => { let h = 0; for (const c of String(name || '?')) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV_COLORS[h % AV_COLORS.length]; };

const lc = (s) => String(s || '').toLowerCase();
const check = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="var(--brand)"/><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const discordIco = `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" fill="currentColor"><path d="M19.3 5.4A17 17 0 0 0 15.1 4l-.3.5c1.4.4 2 .8 2.8 1.3a11 11 0 0 0-8.9 0c.8-.5 1.5-.9 2.8-1.3L11.2 4A17 17 0 0 0 7 5.4C4.3 9.3 3.6 13.1 3.9 16.8a16 16 0 0 0 4.8 2.4l.6-1c-.5-.2-1-.5-1.6-.9l.4-.3a11 11 0 0 0 9.6 0l.4.3c-.5.4-1 .7-1.6.9l.6 1a16 16 0 0 0 4.8-2.4c.4-4.3-.6-8-2.6-11.4zM9.6 14.5c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8zm4.8 0c-.9 0-1.6-.8-1.6-1.8s.7-1.8 1.6-1.8 1.6.8 1.6 1.8-.7 1.8-1.6 1.8z"/></svg>`;
// SOW-048: the GitHub mark for the forced-sign-in (login splash) mode.
const githubIco = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49l-.01-1.7c-2.78.62-3.37-1.37-3.37-1.37-.46-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.62.07-.62 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.36-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.3.1-2.71 0 0 .84-.28 2.75 1.05a9.34 9.34 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.41.2 2.45.1 2.71.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.81-4.57 5.06.36.32.68.94.68 1.9l-.01 2.81c0 .27.18.6.69.49A10.02 10.02 0 0 0 22 12.25C22 6.58 17.52 2 12 2z"/></svg>`;


class GbtiWelcome extends GbtiElement {
  connectedCallback() {
    super.connectedCallback?.();
    this._page = 1;
    this._step = 0;
    this._done = false;
    this.load();
  }

  disconnectedCallback() {
    super.disconnectedCallback?.();
    this._stopDiscordPoll();
  }

  // SOW: after the member opens the Discord OAuth tab, poll /discord/link/status (always fresh, fail-closed) until
  // it reports linked, then mark the step done and auto-advance. Bounded (~3 min) so a bailed-out link never spins
  // forever; the step's Continue button stays available as a manual advance the whole time.
  _startDiscordPoll() {
    if (this._discordWaiting) return;
    this._discordWaiting = true;
    this._discordPollUntil = Date.now() + 180000;
    this.render();
    const tick = async () => {
      if (!this._discordWaiting) return; // stopped (manual nav / disconnect)
      let linked = false;
      try { linked = Boolean((await this.client?.discordLinkStatus?.())?.linked); } catch { linked = false; }
      if (!this._discordWaiting || !this.isConnected) return; // a stop() DURING the await must win: no re-arm, no stale mutation
      if (linked) { this._onDiscordLinked(); return; }
      if (Date.now() > this._discordPollUntil) { this._discordWaiting = false; this.render(); return; } // timed out
      this._discordPollTimer = setTimeout(tick, 2500);
    };
    this._discordPollTimer = setTimeout(tick, 2500);
  }

  _onDiscordLinked() {
    this._stopDiscordPoll();
    this._discordJoined = true;
    this._lsSet('discord', '1');
    // Auto-advance off the Discord step to the next to-do.
    if (STEPS[this._step]?.key === 'discord' && this._step < STEPS.length - 1) this._step++;
    this.render();
  }

  /**
   * sow-218: disconnect the linked Discord account.
   *
   * Server first, local state second. The wizard remembers "joined" in localStorage (DISCORD_DONE_KEY), and
   * clearing that eagerly would show a member the Connect button while their account was still linked and still
   * holding guild roles, which is a worse lie than the one this feature fixes. So the flag is cleared only on a
   * confirmed unlink, and a failure is surfaced in the card rather than swallowed.
   *
   * A host with no client (the inert public-site embed) simply does nothing.
   */
  async _disconnectDiscord() {
    if (this._discordUnlinking || !this.client?.discordUnlink) return;
    this._discordUnlinking = true;
    this._discordUnlinkError = null;
    this.render();
    let ok = false;
    try {
      const r = await this.client.discordUnlink();
      ok = Boolean(r?.ok);
      if (!ok) this._discordUnlinkError = 'We could not disconnect Discord just now. Nothing was changed. Please try again in a moment.';
    } catch {
      this._discordUnlinkError = 'We could not reach the network to disconnect Discord. Nothing was changed. Please try again in a moment.';
    }
    this._discordUnlinking = false;
    if (ok) {
      this._stopDiscordPoll();
      this._discordJoined = false;
      this._lsRemove('discord');
    }
    this.render();
  }

  _stopDiscordPoll() {
    this._discordWaiting = false;
    if (this._discordPollTimer) { clearTimeout(this._discordPollTimer); this._discordPollTimer = null; }
  }

  async load() {
    // SOW-048: in auth-gate mode this element doubles as the extension's LOGIN SPLASH. Phase + own identity + the
    // authenticated flag all come from the one status read.
    this._authGate = this.hasAttribute('auth-gate');
    let s = null;
    try {
      s = await this.client?.status?.();
      this._membership = s?.membership ?? 'unknown';
      this._couponUntil = s?.couponUntil ?? null; // SOW-119 QA: a live coupon grant reframes the paid banner
      this._own = lc(s?.identity?.username || s?.identity?.login);
      this._login = s?.identity?.login || s?.identity?.username || ''; // sow-343: a new profile's display name
    } catch {
      this._membership = 'unknown';
      this._couponUntil = null;
      this._own = '';
    }
    this._authenticated = Boolean(s?.authenticated && (s?.identity?.login || s?.identity?.username));
    // sow-345: per-account storage keys, then purge the bare keys this browser may still hold from ANY account.
    this._keys = { discord: accountKey(DISCORD_DONE_KEY, s?.identity), chan: accountKey(CHAN_FOLLOWED_KEY, s?.identity), socials: accountKey(SOCIALS_STAGE_KEY, s?.identity) };
    for (const k of [DISCORD_DONE_KEY, CHAN_FOLLOWED_KEY, SOCIALS_STAGE_KEY]) { try { localStorage.removeItem(k); } catch { /* storage blocked */ } }
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
    // The done-state stats seed (best-effort): the current followed-topics count.
    try {
      const p = await this.client?.getPrefs?.();
      this._topicsCount = Array.isArray(p?.categories) ? p.categories.length : 0;
      this._record = p?.onboarding ?? null; // sow-343: the stored progress (null = nothing stored yet)
    } catch { this._topicsCount = 0; this._record = undefined; }
    // Discord connectedness: localStorage FIRST, then the SERVER, which is the actual authority.
    //
    // This used to read localStorage alone, and localStorage is per-browser. A member who linked Discord on one
    // machine and opened the welcome flow on another was shown "Connect Discord account" for an account that was
    // already linked, and the resume logic counted the step as incomplete. Connecting again is not harmless
    // either: it re-runs the whole signup chain to re-assign roles.
    //
    // The server read is what caught this. `discordLinkStatus` was already here, already fail-closed, and was
    // only ever polled AFTER clicking connect, never consulted on load. A `true` from the server upgrades the
    // local flag and writes it back, so the next load is instant; a `false` never downgrades a local `true`,
    // because the poll fails closed and an unreachable Worker must not un-tick a step the member finished.
    this._discordJoined = this._lsGet('discord') === '1';
    if (!this._discordJoined && this.client?.discordLinkStatus) {
      try {
        if ((await this.client.discordLinkStatus())?.linked) {
          this._discordJoined = true;
          this._lsSet('discord', '1');
        }
      } catch { /* unreachable: keep the local answer */ }
    }
    try {
      const raw = JSON.parse(this._lsGet('chan') || '[]');
      this._chanFollowed = new Set(Array.isArray(raw) ? raw : []);
    } catch { this._chanFollowed = new Set(); }
    // sow-343: the channels opened are on the account too. Show both, and hand the account any this browser alone knew.
    const chans = mergeChannelFollows([...this._chanFollowed], this._record?.networkFollows);
    this._chanFollowed = new Set(chans.all);
    if (chans.missing.length && this._record !== undefined) this._prefs({ onboardingFollows: chans.missing });
    // The socials step's staged draft (survives a mid-flow abandon; consumed by the profile editor).
    try {
      const raw = JSON.parse(this._lsGet('socials') || 'null');
      this._socialDraft = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
    } catch { this._socialDraft = {}; }
    this._socialDraft = { ...(this._record?.socials || {}), ...this._socialDraft }; // sow-343: kept on the account
    // SOW-129 QA (2026-07-20): RECALL the member's SAVED profile socials so a welcome RESET does not clear them.
    // The staged draft (an in-flight edit) always wins; the saved profile fills the rest. Time-boxed + fail-open:
    // a brand-new member with no profile, a slow read, or any error leaves the fields blank and the welcome
    // proceeds. sow-346: the read is readOwnProfile (own-profile.mjs), shared with the profile editor and the card.
    try {
      await Promise.race([
        (async () => {
          // sow-343: a missing profile is an ANSWER (the save creates one); a failed read is not, and leaves
          // _profileRead false so the save refuses rather than writing a bare profile over a real one.
          const r = await readOwnProfile(this.client, { identity: s?.identity ?? null });
          if (r.state === 'failed') return;
          this._profile = r.item;
          this._profileRead = true;
          this._socialDraft = socialPrefill(recallProfileSocials(r.item?.frontmatter?.links, SOCIAL_KEYS), this._socialDraft, SOCIAL_KEYS);
        })().catch(() => {}),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    } catch { /* keep the staged draft (possibly empty) */ }
    this._loaded = true;
    // sow-207 QA: RESUME where the member actually is, rather than reopening at step 1 every time. Computed
    // here because this is the point where every signal has landed. Guarded by _resumed so a second load()
    // (the setClient fan-out can re-run it) never yanks a member out of the step they are reading.
    if (!this._resumed) {
      this._resumed = true;
      const asked = requestedStep(this.getAttribute('start-step'), STEPS); // sow-343: the WorkBench card links to a step
      this._step = asked >= 0 ? asked : resumeStep(this._resumeFlags(), STEPS.length);
    }
    this.render();
  }

  /**
   * Per-step "already done", in STEPS order. Each flag reads REAL state rather than a remembered click, so
   * work done outside this wizard counts (see resumeStep).
   *
   * Every unknown resolves to NOT done. `_follows` is null when the read failed and `_topicsCount` is 0 when
   * prefs were unreadable, and in both cases showing the step again is the harmless direction: the member
   * sees a step they may not need, instead of being skipped past one they do.
   */
  _stepDone() {
    const socials = this._socialDraft && Object.values(this._socialDraft).some((v) => String(v ?? '').trim());
    return [
      Boolean(this._discordJoined),          // discord  — the link landed (localStorage, set by the poll)
      (this._chanFollowed?.size ?? 0) > 0,   // subreddit — at least one network channel followed
      Boolean(socials),                      // socials   — a staged or already-saved handle
      (this._follows?.size ?? 0) > 0,        // follow    — following at least one member
      (this._topicsCount ?? 0) > 0,          // topics    — at least one topic in the stored prefs
    ];
  }

  /**
   * What RESUME treats as settled, which is not the same thing as what the rail ticks.
   *
   * sow-356: a free account cannot connect Discord, so resuming would park it on that step forever. Resume steps
   * past it; the rail still shows it as outstanding rather than done, because the member has not done it and a
   * tick would say they had.
   */
  /**
   * The step heading. sow-356: "Connect Discord" is an instruction, and it is the wrong one for an account that
   * may not join. Caught by driving the step, where the card explained that the server is for paying members
   * under a heading telling the reader to connect. Kept short enough not to clip at phone width (measured).
   */
  _headingText() {
    if (this._done) return DONE_HEADING;
    const step = STEPS[this._step];
    if (step?.key === 'discord' && !this._mayJoinDiscord()) return 'Discord community';
    return step.heading;
  }

  _resumeFlags() {
    const done = this._stepDone();
    // Only when the membership was READ and says no. An unread one keeps the step: skipping it there would mean a
    // paying member whose status read failed never lands on Discord at all, and never sees the card saying the
    // check failed. Caught by driving the wizard: every membership resumed on step two, unread included.
    if (this._membership !== 'unknown' && !this._mayJoinDiscord()) done[0] = true;
    return done;
  }

  // SOW-048: feed the device-flow user code into the splash (host calls this from the gbti:welcome-signin handler).
  // sow-345: account-scoped browser storage (see accountKey). No account means no key, and these are no-ops rather
  // than guesses; a blocked storage reads as absent.
  _lsGet(which) { const k = this._keys?.[which]; if (!k) return null; try { return localStorage.getItem(k); } catch { return null; } }
  _lsSet(which, v) { const k = this._keys?.[which]; if (!k) return; try { localStorage.setItem(k, v); } catch { /* storage blocked */ } }
  _lsRemove(which) { const k = this._keys?.[which]; if (!k) return; try { localStorage.removeItem(k); } catch { /* storage blocked */ } }

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
    this.set(this.css(CSS) + `<div class="splashwrap">
      <div class="head">
        <span class="ic">${check}</span>
        <h2>Sign in to GBTI Network</h2>
        <p>The developer co-op. Sign in with your GitHub account to publish articles, projects, and prompts, follow members, read the members-only news, and join the community.</p>
      </div>
      <div class="card">
        ${expired}${action}
        <p class="note" style="margin-top:14px">New here? <a href="${SITE}/membership/" target="_blank" rel="noopener">Become a member</a>. The trial is free.</p>
      </div></div>`);
    this.on('[data-auth-signin]', 'click', () => this.emit('gbti:welcome-signin'));
    this.on('[data-copy]', 'click', () => { try { navigator.clipboard?.writeText(code); } catch { /* clipboard blocked */ } });
  }

  _goto(i) {
    this._stopDiscordPoll();
    this._done = false;
    this._step = Math.min(Math.max(i, 0), STEPS.length - 1);
    this.render();
  }

  async _next({ skip = false } = {}) {
    this._stopDiscordPoll();
    const key = STEPS[this._step]?.key;
    if (this._socialSaving) return;
    if (key === 'socials' && !skip && !(await this._saveSocials())) return;
    // sow-343: moving on from a step that is not done is a skip, and the account remembers it. A rail jump is not.
    if (key && !this._stepDone()[this._step]) this._prefs({ onboardingSkip: { step: key } });
    if (this._step >= STEPS.length - 1) this._done = true;
    else this._step++;
    this.render();
  }

  /** sow-343: best-effort write to the progress record. The card treats an unreadable record as unknown. */
  _prefs(patch) { return Promise.resolve().then(() => this.client?.setPrefs?.(patch)).catch(() => null); }

  // sow-343: Continue on the socials step saves the handles (welcome-socials.mjs). False keeps the member here.
  async _saveSocials() {
    this._socialSaving = true;
    this._socialError = null;
    this.render();
    const r = await saveWizardSocials({ client: this.client, profile: this._profile, profileRead: this._profileRead, draft: this._socialDraft, membership: this._membership, login: this._login || this._own });
    this._socialSaving = false;
    if (r.profile) { this._profile = r.profile; this._lsRemove('socials'); }
    this._socialError = r.error || null;
    this.render();
    return !r.error;
  }

  _back() {
    this._stopDiscordPoll();
    if (this._done) this._done = false;
    else if (this._step > 0) this._step--;
    this.render();
  }

  _railHtml() {
    // sow-207 QA: the rail was PURELY positional (`_step > i`), which resume makes visibly wrong. A member who
    // skipped socials but followed members and picked topics now resumes ON socials, and a positional rail would
    // then show Members and Topics as still to-do, re-asking for work already finished. sow-343: the real flags
    // ALONE decide, so a check means "this is done", never "you walked past this" or "the link opened a later step".
    const done = this._stepDone();
    const rows = STEPS.map((s, i) => {
      const isDone = Boolean(done[i]);
      const isActive = !this._done && this._step === i;
      const cls = `rstep${isDone ? ' done' : ''}${isActive ? ' active' : ''}`;
      const mark = isDone ? '&#10003;' : String(i + 1);
      return `<button class="${cls}" data-goto="${i}" type="button">
        <span class="circ">${mark}</span>
        <span class="rl"><b>${esc(s.label)}</b><span>${esc(s.sub)}</span></span>
      </button>`;
    }).join('');
    // sow-344: the rail's own light/dark button went with the card. Each host already owns the theme (the site
    // header toggle; the extension stamps the saved theme at takeover), and the dissolved layout has no panel
    // foot for a control to sit in.
    return `<aside class="rail">
      <span class="brand"><span class="mark">G</span><b>GBTI Network</b></span>
      <span class="railhead">Get set up</span>
      <div class="rsteps">${rows}</div>
    </aside>`;
  }

  render() {
    if (!this._loaded) { this.set(this.css(CSS) + `<div class="splashwrap"><p class="loading">Setting up your welcome...</p></div>`); return; }
    if (this._authGate && !this._authenticated) { this._renderSignedOut(); return; } // SOW-048 login splash
    const ph = phaseLabel(this._membership, { couponUntil: this._couponUntil });
    const phase = ph.phase === 'coupon' ? 'Free membership period' : ph.phase === 'paid' ? 'Paid membership' : ph.phase === 'trial' ? 'Trial phase' : '';
    this._step = Math.min(Math.max(this._step, 0), STEPS.length - 1);
    const step = STEPS[this._step].key;
    const heading = this._headingText();
    const stepText = this._done ? 'COMPLETE' : `STEP ${this._step + 1} OF ${STEPS.length}`;
    const progress = this._done ? 100 : Math.round((this._step / STEPS.length) * 100 + 12);
    const card = this._done ? this._doneCard()
      : step === 'discord' ? this._discordCard()
        : step === 'subreddit' ? this._channelsCard()
          : step === 'socials' ? this._socialsCard()
            : step === 'topics' ? this._topicsCard()
              : this._membersCard();
    const isLast = this._step >= STEPS.length - 1;
    const backOff = this._step === 0 && !this._done;
    const showSkip = !this._done && this._step >= 1 && this._step <= 3;
    const footR = this._done
      ? `<button class="gbtn" data-review type="button">Review steps</button>
         <button class="pbtn" data-done type="button">Go to your profile</button>`
      : `${showSkip ? `<button class="skipbtn" data-step-skip type="button">Skip</button>` : ''}
         <button class="pbtn" data-step-next type="button"${this._socialSaving ? ' disabled' : ''}>${this._socialSaving ? 'Saving&hellip;' : isLast ? 'I am all set' : 'Continue &rarr;'}</button>`;
    this.set(this.css(CSS) + `<div class="wf">
      ${this._railHtml()}
      <div class="main">
        <div class="top">
          <div class="eyebrow">Welcome${phase ? `<span class="phasepill">${esc(phase)}</span>` : ''}</div>
          <div class="heads"><h2>${esc(heading)}</h2><span class="stepmono">${esc(stepText)}</span></div>
          ${ph.phase === 'coupon' ? `<p class="couponline">${esc(ph.body)}</p>` : ''}
          <div class="bar"><i style="width:${progress}%"></i></div>
        </div>
        <div class="content"><div class="stepin">${card}</div></div>
        <div class="foot">
          <button class="gbtn${backOff ? ' off' : ''}" data-step-back type="button" ${backOff ? 'disabled' : ''}>&larr; Back</button>
          <div class="footr">${footR}</div>
        </div>
      </div>
    </div>`);

    // Navigation: the rail jumps anywhere (every step is skippable); the footer walks linearly.
    this.$$('[data-goto]').forEach((b) => b.addEventListener('click', () => this._goto(Number(b.dataset.goto))));
    this.$$('[data-step-next]').forEach((b) => b.addEventListener('click', () => this._next()));
    this.on('[data-step-skip]', 'click', () => this._next({ skip: true })); // sow-343: Skip never saves
    this.on('[data-step-back]', 'click', () => this._back());
    this.on('[data-review]', 'click', () => this._goto(0));
    this.on('[data-done]', 'click', () => this.emit('gbti:welcome-done'));
    if (this._done) return;
    if (step === 'discord') {
      // SOW: "Connect Discord account" opens the token-bound OAuth link in a new tab (joins the guild, assigns the
      // role, links discord_user_id, then redirects the member INTO Discord). We then poll /discord/link/status and
      // auto-advance to the next step the moment the link lands, so there is nothing else to click.
      this.on('[data-discord-connect]', 'click', async () => {
        let url = DISCORD_LINK_URL;
        try { const r = await this.client?.discordLinkUrl?.(); if (r && r.url) url = r.url; } catch { /* fall back to the static link */ }
        window.open(url, '_blank', 'noopener');
        this._startDiscordPoll();
      });
      // sow-218: Disconnect. Clears the LOCAL joined memory only after the server confirms, so a failed unlink
      // never leaves the step claiming disconnected while the account is still linked.
      this.on('[data-discord-unlink]', 'click', () => this._disconnectDiscord());
    } else if (step === 'subreddit') {
      // A channel card's Follow opens the property in a new tab and marks the card followed (local memory,
      // best-effort: none of these platforms report a follow back to us).
      this.$$('[data-chan-open]').forEach((b) => b.addEventListener('click', () => {
        const key = b.dataset.chanOpen;
        const chan = GBTI_CHANNELS.find(([k]) => k === key);
        if (!chan) return;
        window.open(chan[2], '_blank', 'noopener');
        this._chanFollowed.add(key);
        this._lsSet('chan', JSON.stringify([...this._chanFollowed]));
        this._prefs({ onboardingFollows: [key] }); // sow-343
        this.render();
      }));
    } else if (step === 'socials') {
      // Persist on input, no re-render (a re-render would steal focus mid-typing). Empty clears the key.
      this.$$('[data-social-key]').forEach((inp) => inp.addEventListener('input', () => {
        const k = inp.dataset.socialKey;
        if (inp.value.trim()) this._socialDraft[k] = inp.value; else delete this._socialDraft[k];
        this._lsSet('socials', JSON.stringify(this._socialDraft));
      }));
      this.on('[data-social-more]', 'click', () => { this._socialsMore = !this._socialsMore; this.render(); });
      this.$$('[data-social-add]').forEach((b) => b.addEventListener('click', () => {
        const k = b.dataset.socialAdd;
        if (!(k in this._socialDraft)) this._socialDraft[k] = '';
        this._socialsMore = false;
        this.render();
        this.$(`[data-social-key="${k}"]`)?.focus();
      }));
    } else if (step === 'topics') {
      // Track the picked count for the done-state stats (the picker self-persists via setPrefs).
      this.$('gbti-topic-picker')?.addEventListener('topics-change', (e) => {
        this._topicsCount = Array.isArray(e.detail?.topics) ? e.detail.topics.length : this._topicsCount;
      });
    } else {
      // Follow toggles + paging (the pager's Back/More is within the list, distinct from the step Back).
      this.$$('[data-follow]').forEach((b) => b.addEventListener('click', () => this._toggleFollow(b.getAttribute('data-follow'))));
      this.on('[data-prev]', 'click', () => { this._page--; this.render(); });
      this.on('[data-next]', 'click', () => { this._page++; this.render(); });
      // Avatar fallback: drop a broken image so the letter disc shows through.
      this.$$('.mav img').forEach((img) => img.addEventListener('error', () => img.remove(), { once: true }));
    }
  }

  // sow-356: may this account be in the server at all? The community is a paid perk (owner, 2026-09-17), so a
  // free or lapsed account is shown what it is rather than a button that now refuses. `unknown` (the status read
  // failed) is neither: it says so, and offers nothing, because guessing either way is wrong.
  _mayJoinDiscord() { return discordJoinAllowed(this._membership); }

  _discordLockedCard() {
    const unread = this._membership === 'unknown';
    const note = unread
      ? 'We could not check your membership just now. Reload to try again.'
      : 'The Discord community is part of the Network Supporter membership.';
    const link = unread
      ? ''
      : `<a class="dbtn" href="${SITE}/membership/" target="_blank" rel="noopener">See what membership includes</a>`;
    return `
      <div class="dhead">
        <span class="ico-tile">${discordIco}</span>
        <p class="dlede">Our Discord community is for paying members.</p>
      </div>
      <p class="intro" style="max-width:58ch">Announcements and agile discussions happen in the server, and it is the best place to network in real time with network members. ${esc(note)}</p>
      ${link}`;
  }

  _discordCard() {
    if (!this._mayJoinDiscord()) return this._discordLockedCard();
    const joined = this._discordJoined;
    // sow-218: the connected state used to be a permanently DISABLED button and nothing else, so a member who
    // linked the wrong Discord account had no route back. It now offers Disconnect.
    const btn = joined
      ? `<div class="drow">
           <button class="dbtn on" type="button" disabled>&#10003; Discord connected</button>
           <button class="dlink" data-discord-unlink type="button"${this._discordUnlinking ? ' disabled' : ''}>${this._discordUnlinking ? 'Disconnecting&hellip;' : 'Disconnect'}</button>
         </div>`
      : this._discordWaiting
        ? `<button class="dbtn" data-discord-connect type="button" disabled>Waiting for Discord&hellip;</button>`
        : `<button class="dbtn" data-discord-connect type="button">Connect Discord account</button>`;
    // The old connected copy asserted "you have the member role". That was FALSE for a fresh invitee, because
    // signup assigned Locked to everyone until sow-218; and it is not this component's fact to state in any
    // case, since reconcile owns the role. Describe what was actually done instead.
    const err = this._discordUnlinkError
      ? `<div class="callout"><span class="gl">&#9888;</span><span>${esc(this._discordUnlinkError)}</span></div>`
      : '';
    const callout = joined
      ? `<div class="callout"><span class="gl">&#8250;</span><span>Your Discord account is connected. Disconnecting removes your network roles in the server and unlinks the account; it does not remove you from the server.</span></div>${err}`
      : `<div class="callout"><span class="gl">&#8250;</span><span>A new tab opens for Discord sign-in. When you finish, you land in the server and this step continues automatically.</span></div>${err}`;
    return `
      <div class="dhead">
        <span class="ico-tile">${discordIco}</span>
        <p class="dlede">Come participate in our Discord community.</p>
      </div>
      <p class="intro" style="max-width:58ch">Announcements and agile discussions frequently occur here, and it is the best place to network in real time with network members. Connect Discord to join the server and claim your member role.</p>
      ${btn}
      ${callout}`;
  }

  // The Follow GBTI channels grid (the design handoff's platform cards). Follow opens the channel in a new
  // tab and flips the card to a followed state (local memory).
  _channelsCard() {
    const cards = GBTI_CHANNELS.map(([k, label, , blurb, handle]) => {
      const on = this._chanFollowed?.has(k);
      return `<div class="pcard">
        <div class="ph">
          <span class="ico-tile">${socialIcon(k, 19)}</span>
          <div class="pn"><b>${esc(label)}</b><span>${esc(handle)}</span></div>
        </div>
        <div class="pd">${esc(blurb)}</div>
        <button class="sbtn${on ? ' on' : ''}" data-chan-open="${esc(k)}" type="button">${on ? '&#10003; Following' : 'Follow'}</button>
      </div>`;
    }).join('');
    return `
      <p class="intro">Please follow the network's channels to help member content travel. We syndicate everyone's articles, prompts, and projects through these, including yours. Following these channels will help build the network's reach.</p>
      <div class="grid">${cards}</div>`;
  }

  // The socials step: collect the member's handles across the platform set. Raw values stage locally
  // (SOCIALS_STAGE_KEY) while typing; Continue saves them (_saveSocials). Fully skippable.
  _socialsCard() {
    const draft = this._socialDraft || {};
    const visible = [...new Set([...SOCIAL_STARTERS, ...Object.keys(draft)])]
      .filter((k) => SOCIAL_KEYS.includes(k) && !SOCIAL_HIDDEN.has(k));
    const rows = visible.map((k) => `<div class="srow">
      <span class="ico-tile" aria-hidden="true">${socialIcon(k, 19)}</span>
      <input type="text" data-social-key="${esc(k)}" value="${esc(draft[k] || '')}"
        placeholder="${esc(SOCIAL_LABELS[k] || k)}: @handle or full URL" aria-label="${esc(SOCIAL_LABELS[k] || k)}" />
    </div>`).join('');
    const rest = SOCIAL_KEYS.filter((k) => !visible.includes(k) && !SOCIAL_HIDDEN.has(k));
    const picker = this._socialsMore && rest.length
      ? `<div class="pkrow">${rest.map((k) => `<button type="button" class="pk" data-social-add="${esc(k)}">${socialIcon(k, 14)}${esc(SOCIAL_LABELS[k] || k)}</button>`).join('')}</div>`
      : '';
    const more = rest.length ? `<button type="button" class="addmore" data-social-more>${this._socialsMore ? 'Close' : '+ More platforms'}</button>` : '';
    return `
      <p class="intro">Tell us where else you publish. When your work syndicates to a GBTI channel, the handle you list is mentioned automatically, pointing readers back to you. ${this._membership === 'paid' ? 'Continue adds them to your public profile.' : 'We keep them on your account and add them to your public profile once your membership is paid.'}</p>
      ${this._socialError ? `<div class="callout" role="alert" style="margin-bottom:12px"><span class="gl">&#9888;</span><span>${esc(this._socialError)}</span></div>` : ''}
      ${rows}
      ${more}
      ${picker}`;
  }

  // SOW-054: the Topics step. The shared <gbti-topic-picker> fetches the vocabulary + the member's current
  // selection and self-persists each toggle via setPrefs; the step is skippable (an empty selection = the feed
  // and news show everything, the current default).
  _topicsCard() {
    return `
      <p class="intro">We have started you off with a few popular topics. Add the others you care about, or remove any you do not. Your activity feed and news default to them, and you can change this any time in Settings.</p>
      <gbti-topic-picker seed-defaults></gbti-topic-picker>`;
  }

  _membersCard() {
    const intro = `<p class="intro">Following a member alerts you when they publish new articles, prompts, and projects in your feed.</p>`;
    // SOW-060: following is a FREE perk for any signed-in member, so there is no paywall state here. A null follow
    // list means a transient read failure (or a stale/missing KV overrides mirror for a since-banned account), not
    // a membership gate, so show a retry, never an upgrade prompt.
    if (this._follows === null) {
      return `${intro}<p class="note">We could not load your follow list right now. This is a temporary problem on our side. Try again shortly, or follow members any time from a member profile.</p>`;
    }
    if (!this._members) {
      return `${intro}<p class="note">We could not load the member directory right now. You can follow members any time from a member profile.</p>`;
    }
    if (this._members.length === 0) {
      return `${intro}<p class="note">No members to show yet. Check back as the co-op grows.</p>`;
    }
    const { page, pages, items } = paginate(this._members, this._page, PAGE_SIZE);
    this._page = page; // clamp
    const cards = items.map((m) => this._memberCard(m)).join('');
    const pager = pages > 1
      ? `<div class="pager"><button data-prev type="button" ${page <= 1 ? 'disabled' : ''}>Back</button>
         <span class="pg">Page ${page} of ${pages}</span>
         <button data-next type="button" ${page >= pages ? 'disabled' : ''}>More</button></div>`
      : '';
    const count = this._follows?.size ?? 0;
    return `
      <div class="mtop">${intro}<span class="mcount">${count} following</span></div>
      <div class="mgrid">${cards}</div>
      ${pager}`;
  }

  _memberCard(m) {
    const u = lc(m.username);
    const followed = this._follows.has(u);
    const name = m.displayName || m.username || '?';
    const initial = esc(String(name).trim().charAt(0).toUpperCase());
    const av = `<span class="mav" style="background:${avColor(name)}">${initial}${m.avatar ? `<img src="${esc(m.avatar)}" alt="" />` : ''}</span>`;
    const sub = m.headline ? `<span>${esc(m.headline)}</span>` : '';
    return `<div class="mcard">
      ${av}
      <span class="mi"><b>${esc(name)}</b>${sub}</span>
      <button class="sbtn${followed ? ' on' : ''}" data-follow="${esc(u)}" type="button">${followed ? '&#10003; Following' : 'Follow'}</button>
    </div>`;
  }

  _doneCard() {
    const follows = this._follows?.size ?? 0;
    const topics = this._topicsCount ?? 0;
    return `<div class="donewrap">
      <span class="donecheck">&#10003;</span>
      <h3>${esc(DONE_HEADING)}</h3>
      <p>Welcome to the co-op. Your channels are followed, your handles are saved, and your feed is tuned. Time to publish.</p>
      <div class="stats">
        <div class="stat"><b>${follows}</b><span>Following</span></div>
        <div class="stat"><b>${topics}</b><span>Topics</span></div>
      </div>
    </div>`;
  }

  /**
   * Repaint ONLY what a follow toggle changes: each Follow button's state and the "N following" count.
   *
   * This exists because `render()` calls `this.set(...)`, which replaces the whole component's markup. Using
   * it for a follow toggle tore down and rebuilt the entire wizard TWICE per click (once optimistically, once
   * on the network response), which read as the panel flashing and reloading under the cursor, and threw away
   * scroll position mid-list. <gbti-topic-picker> already learned this and re-renders its chips in place for
   * the same reason; this is that pattern applied to the members grid.
   *
   * Deriving every button from `this._follows` rather than touching just the clicked one is deliberate: the
   * response REPLACES the whole set, so a follow made in another tab shows up here too.
   */
  _refreshFollowUi() {
    const count = this.$('.mcount');
    if (count) count.textContent = `${this._follows?.size ?? 0} following`;
    this.$$('[data-follow]').forEach((b) => {
      const on = this._follows?.has(lc(b.getAttribute('data-follow'))) ?? false;
      b.classList.toggle('on', on);
      b.innerHTML = on ? '&#10003; Following' : 'Follow'; // static markup, mirrors _memberCard exactly
    });
  }

  async _toggleFollow(username) {
    const u = lc(username);
    if (!u || !this._follows) return;
    const was = this._follows.has(u);
    was ? this._follows.delete(u) : this._follows.add(u); // optimistic
    this._refreshFollowUi();
    try {
      const r = await this.client.setFollow({ username: u, on: !was });
      const list = Array.isArray(r) ? r : (r?.following ?? null);
      if (list) this._follows = new Set(list.map((e) => lc(e?.username)).filter(Boolean));
    } catch {
      was ? this._follows.add(u) : this._follows.delete(u); // revert
    }
    this._refreshFollowUi();
  }
}

define('gbti-welcome', GbtiWelcome);
export { GbtiWelcome };
