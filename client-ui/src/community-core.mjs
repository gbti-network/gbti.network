// sow-494: the pure view rules for Community, shared by the list, the entry page, the discussion and the manager.
// Node-free and DOM-free, so test/community-core.test.mjs pins every label a member reads.
import { KIND_LABEL, isPollKind, LIMITS, REACTIONS, normalizeTyped, typedMax } from '../../membership/community-shared.mjs';
import { idAvatarUrl, NETWORK_AVATAR, NETWORK_FOLDERS } from '../../membership/member-avatar.mjs';
import { avatarLayers } from './member-avatars.mjs';

export { KIND_LABEL, isPollKind, LIMITS, REACTIONS, normalizeTyped, typedMax };

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * sow-498: a member's real picture. Every person Community knows carries their GitHub ACCOUNT NUMBER, so the face is
 * GitHub's own picture for that number: the same picture /avatar/<folder> redirects to (sow-428), with no folder
 * lookup, and never github.com/<name>.png (a name can belong to someone else). The network account shows its
 * Gravatar, as everywhere else on the site. '' when there is no number: the blobatar alone then.
 */
export function faceSrc(person) {
  const name = String(person?.login ?? person?.username ?? '').trim().toLowerCase();
  if (NETWORK_FOLDERS.includes(name)) return NETWORK_AVATAR;
  return idAvatarUrl(person?.githubId, 96);
}

/** A round face: the blobatar underneath (seeded by the name), the picture over it. A picture that fails is removed
 *  by base.mjs's fallback listener, so the blobatar shows. */
export function faceHtml(person, cls = '') {
  const seed = String(person?.login || person?.username || person?.githubId || 'member');
  return `<span class="cm-av${cls ? ` ${cls}` : ''}" aria-hidden="true">${avatarLayers(seed, faceSrc(person))}</span>`;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-07" as "November 7". Read as a calendar date, so no time zone can move it a day. */
export function meetingDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || ''));
  if (!m) return '';
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}` : '';
}

/** The meeting an entry belongs to: "Shop Talk, November 7", or "Between meetings". */
export function meetingText(meeting) {
  const label = String(meeting?.label || '').trim();
  if (!label) return 'Between meetings';
  const d = meetingDate(meeting?.date);
  return d ? `${label}, ${d}` : label;
}

/** The pill an entry carries, if any. */
export function statusPill(entry) {
  const poll = isPollKind(entry?.kind);
  switch (entry?.status) {
    case 'live': return { tone: 'live', text: 'Live' };
    case 'closed': return { tone: 'muted', text: poll ? 'Voting closed' : 'Closed' };
    case 'published': return { tone: 'outline', text: 'Results' };
    case 'draft': return { tone: 'muted', text: 'Draft' };
    default: return null;
  }
}

/**
 * The line under a list row's title: the meeting, and who it is shared with when that is a chosen group. The state
 * is the pill beside the kind badge, and the host is always a superadmin, so neither is repeated here (sow-498).
 */
export function rowMeta(entry) {
  const parts = [meetingText(entry?.meeting)];
  // sow-501: a row that carries its faces says "Shared with N members" on the faces line instead (cardPeopleLine).
  if (entry?.access?.mode === 'chosen' && !entry?.people) parts.push(`Shared with ${plural(entry.access.count ?? 0, 'member')}`);
  return parts.join(' · ');
}

/**
 * sow-501: the words beside the faces on a list card. Shared with chosen members: "Shared with 6 members". Open to all
 * members: "4 members took part", or nothing (and no faces line) while nobody has.
 */
export function cardPeopleLine(entry) {
  const p = entry?.people;
  if (!p) return '';
  const n = Number(p.count) || 0;
  if (p.mode === 'shared') return `Shared with ${plural(n, 'member')}`;
  return n ? `${plural(n, 'member')} took part` : '';
}

/**
 * The list's Activity column, every number labelled (sow-498): a poll leads with its answers, a topic with its posts.
 * A draft has none yet, so it says so instead of showing zeros.
 */
export function discussionCell(entry) {
  if (entry?.status === 'draft') return { primary: 'Not open yet', secondary: '', quiet: true };
  const c = entry?.counts || {};
  const posts = plural(Number(c.posts) || 0, 'post');
  if (isPollKind(entry?.kind)) return { primary: plural(Number(c.answers) || 0, 'answer'), secondary: posts, quiet: false };
  const photos = Number(c.withImages) || 0;
  return { primary: posts, secondary: photos ? `${photos} with photos` : '', quiet: false };
}

/** A published poll's one-line result for the list: "Results: Agents led with 52% of 23 answers". */
export function resultLine(entry) {
  const lead = entry?.lead;
  if (!lead || !lead.total || entry?.status !== 'published') return '';
  return `Results: ${lead.label} led with ${Math.round((lead.count / lead.total) * 100)}% of ${plural(lead.total, 'answer')}`;
}

export const entryHref = (id) => `/community/entry/?id=${encodeURIComponent(String(id || ''))}`;
/** sow-500: the host's share link, which adds a signed-in member who opens it. The plain address when there is no code. */
export const joinHref = (id, code) => (code ? `${entryHref(id)}&join=${encodeURIComponent(String(code))}` : entryHref(id));

/**
 * Result bars from a results block: label, count, a whole percent of the total, the leading group (or groups, on a
 * tie) and the viewer's own. An empty poll leads with nothing.
 */
export function barRows(results) {
  const groups = Array.isArray(results?.groups) ? results.groups : [];
  const total = Number(results?.total) || 0;
  const max = groups.reduce((m, g) => Math.max(m, Number(g.count) || 0), 0);
  return groups.map((g) => {
    const count = Number(g.count) || 0;
    return { key: g.key, label: g.label, count, pct: total ? Math.round((count / total) * 100) : 0, lead: max > 0 && count === max, mine: g.mine === true };
  });
}

/** Where a member stands on a poll. */
export function answerState(entry, mine) {
  if (!entry) return 'missing';
  if (entry.status === 'draft') return 'draft';
  if (entry.status === 'published') return 'published';
  if (entry.status === 'closed') return 'closed';
  return mine ? 'answered' : 'open';
}

/** How long the entry page waits before asking for changes: often while live and in view, rarely otherwise. */
export function pollDelay({ live, visible }) {
  if (!visible) return null;
  return live ? 4000 : 20000;
}

export function formatBytes(n) {
  const b = Number(n) || 0;
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  return `${(b / (1024 * 1024)).toFixed(1)} MB`;
}

export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

/** Why a picked file cannot be attached, as the two lines the composer shows, or null when it can. */
export function uploadProblem({ name, size, type } = {}) {
  const n = String(name || 'That file');
  if (!IMAGE_TYPES.includes(String(type || ''))) return { title: `${n} is not a picture we can show.`, detail: 'Use a PNG, JPG, WebP or GIF.' };
  if ((Number(size) || 0) > LIMITS.imageBytes) return { title: `${n} is ${formatBytes(size)}.`, detail: 'Images can be up to 1 MB. Save a smaller copy and add it again.' };
  return null;
}

/** The address of an image's bytes. The cookie rides along because the site and the Worker are the same site. */
export function imageSrc(base, entryId, imageId) {
  return `${String(base || '').replace(/\/$/, '')}/membership/community/image?id=${encodeURIComponent(entryId)}&img=${encodeURIComponent(imageId)}`;
}

/** "Shared with 6 members", or "Shared with all members". */
export function sharedLine(access) {
  if (!access || access.mode === 'all') return 'Shared with all members';
  return `Shared with ${plural(Number(access.count ?? access.members?.length ?? 0), 'member')}`;
}

/** Posts and replies in a discussion, for "9 posts · 23 replies". */
export function threadCounts(discussion) {
  const posts = Array.isArray(discussion?.posts) ? discussion.posts : [];
  let top = 0;
  let replies = 0;
  for (const p of posts) {
    if (!p.deleted) top++;
    replies += (p.replies || []).filter((r) => !r.deleted).length;
  }
  return { posts: top, replies };
}

/** The count line under a poll's answer card. */
export function answeredLine(entry) {
  const n = Number(entry?.counts?.answers) || 0;
  const who = n === 1 ? '1 member has answered' : `${n} members have answered`;
  if (entry?.status === 'published') return `${who}.`;
  return `${who}. Results appear here once they are published.`;
}

/** The newest rows first when a member opens the page, the way the list is ordered: live, then recent activity. */
export function sortEntries(entries) {
  return [...(entries || [])].sort((a, b) => (b.status === 'live') - (a.status === 'live') || (b.activityAt || 0) - (a.activityAt || 0));
}

/** The meeting choices a superadmin picks from: the next four Saturdays' Shop Talk and the last two. */
export function shoptalkMeetings(now = new Date(), { label = 'Shop Talk', back = 2, ahead = 4 } = {}) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const toSat = (6 - d.getDay() + 7) % 7;
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + toSat);
  const out = [];
  for (let i = -back; i < ahead; i++) {
    const s = new Date(next.getFullYear(), next.getMonth(), next.getDate() + i * 7);
    const ymd = `${s.getFullYear()}-${String(s.getMonth() + 1).padStart(2, '0')}-${String(s.getDate()).padStart(2, '0')}`;
    out.push({ label, date: ymd, text: `${label}, Saturday ${meetingDate(ymd)}`, next: i === 0 });
  }
  return out;
}

/**
 * sow-498: the host's run sheet, the numbered steps in the entry page's sidebar (design round 4, option C). Each step
 * is `done`, `current` (outlined, with its button), `ready` (step 2 before the entry is live: its link always works)
 * or `next` (muted). `op` and `label` are the current step's button, sent to the existing host actions; `quiet` is a
 * small link under a step (`op`, or `access` for Manage access). Sharing the link counts as done once the entry has
 * been live and moved on, so a finished poll reads 5 of 5.
 *
 * `total` is the answer count; `openedText` is how the page writes the opening time ("11:04").
 */
/** Step 2's line: when to paste the link, and who it lets in. */
function shareDetail({ st, poll, chosen, n, joins }) {
  const thing = poll ? 'poll' : 'topic';
  const after = st === 'closed' || st === 'published';
  if (joins) {
    if (st === 'live') return `The ${thing} is open, so paste it now. Anyone signed in who opens this link is added to who can see it.`;
    if (after) return 'The link keeps working, and still adds anyone signed in who opens it.';
    return `Paste it once the ${thing} is open. Anyone signed in who opens it then is added to who can see it.`;
  }
  const when = st === 'live' ? `The ${thing} is open, so paste it now.` : after ? 'The link keeps working.' : `Paste it once the ${thing} is open.`;
  return `${when} ${chosen ? `Only the ${plural(n, 'chosen member')} can open it.` : 'Every member can open it.'}`;
}

export function runSheet(entry, { total = 0, openedText = '' } = {}) {
  const poll = isPollKind(entry?.kind);
  const st = entry?.status || 'draft';
  const access = entry?.access || {};
  const chosen = access.mode === 'chosen';
  const n = Number(access.count ?? access.members?.length ?? 0);
  const answers = Number(total) || 0;
  const after = st === 'closed' || st === 'published';
  const steps = [
    {
      key: 'access', title: 'Choose who can see it', status: 'done',
      detail: `${chosen ? plural(n, 'chosen member') : 'All members'}. Change it at any time.`,
      quiet: { action: 'access', label: 'Change who can see it' },
    },
    {
      key: 'share', title: 'Share the link in the call chat', link: true,
      status: st === 'live' ? 'current' : after ? 'done' : 'ready',
      detail: shareDetail({ st, poll, chosen, n, joins: chosen && !!entry?.joinCode }),
      // sow-500: on an entry shared with chosen members, the join link can be turned off, made new, or turned on.
      ...(chosen ? { joinLink: entry?.joinCode ? 'on' : 'off' } : {}),
    },
    {
      key: 'open', title: poll ? 'Open the poll' : 'Open the topic',
      status: st === 'draft' ? 'current' : 'done',
      detail: st === 'draft' ? (poll ? 'Members can answer from the moment it opens.' : 'Members can post from the moment it opens.') : (openedText ? `Opened at ${openedText}.` : 'Opened.'),
      ...(st === 'draft' ? { op: 'open', label: poll ? 'Open the poll' : 'Open the topic' } : {}),
    },
  ];
  if (poll) {
    steps.push({
      key: 'close', title: 'Close voting',
      status: st === 'live' ? 'current' : after ? 'done' : 'next',
      detail: st === 'live' ? `${plural(answers, 'answer')} so far. Answers stay hidden from members.` : after ? `${plural(answers, 'answer')} ${answers === 1 ? 'is' : 'are'} in.` : 'Answers stay hidden from members until you publish.',
      ...(st === 'live' ? { op: 'close', label: 'Close voting' } : {}),
      ...(st === 'closed' ? { quiet: { op: 'open', label: 'Reopen voting' } } : {}),
    }, {
      key: 'publish', title: 'Publish the results',
      status: st === 'closed' ? 'current' : st === 'published' ? 'done' : 'next',
      detail: st === 'published' ? 'Everyone on this entry can see them.' : 'Members see the results the moment you publish.',
      ...(st === 'closed' ? { op: 'publish', label: 'Publish results' } : {}),
      ...(st === 'published' ? { quiet: { op: 'unpublish', label: 'Unpublish results' } } : {}),
    });
  } else {
    steps.push({
      key: 'close', title: 'Close the topic',
      status: st === 'live' ? 'current' : st === 'closed' ? 'done' : 'next',
      detail: st === 'closed' ? 'Closed. Everything posted stays to read.' : 'Closing turns new posts and replies off. Everything posted stays to read.',
      ...(st === 'live' ? { op: 'close', label: 'Close the topic' } : {}),
      ...(st === 'closed' ? { quiet: { op: 'open', label: 'Reopen topic' } } : {}),
    });
  }
  return { title: poll ? 'Run this poll' : 'Run this topic', steps, done: steps.filter((s) => s.status === 'done').length };
}

/** The member's Status card line in the entry sidebar. */
export function memberStatusLine(entry) {
  const poll = isPollKind(entry?.kind);
  switch (entry?.status) {
    case 'live':
      if (!poll) return 'Open now. Post and reply below.';
      return entry.settings?.changeable === false ? 'Open now. Your first answer is the one that counts.' : 'Open now. You can change your answer until the host closes voting.';
    case 'closed': return poll ? 'Voting is closed. The host publishes the results soon.' : 'This topic is closed. Everything posted stays to read.';
    case 'published': return 'The results are published.';
    default: return '';
  }
}

/**
 * sow-498, the list page's sidebar (round 4b, option L1 "Now and next"). What is live, and for a superadmin what is
 * waiting on them: drafts to open, and polls whose voting closed with the results not yet published.
 */
export function listOverview(entries) {
  const list = Array.isArray(entries) ? entries : [];
  return {
    live: list.filter((e) => e.status === 'live'),
    drafts: list.filter((e) => e.status === 'draft'),
    toPublish: list.filter((e) => e.status === 'closed' && isPollKind(e.kind)),
  };
}

/** A live entry's count line in the sidebar: answers for a poll, posts for a topic. */
export function liveCountLine(entry) {
  const c = entry?.counts || {};
  return isPollKind(entry?.kind) ? plural(Number(c.answers) || 0, 'answer') : plural(Number(c.posts) || 0, 'post');
}

/** The next Shop Talk (a Saturday) as the sidebar names it: "Today" on the day, else "Saturday, November 21". */
export function nextShoptalk(now = new Date()) {
  const m = shoptalkMeetings(now, { back: 0, ahead: 1 })[0];
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const ymd = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
  const today = m.date === ymd;
  return { date: m.date, today, day: today ? 'Today' : `Saturday, ${meetingDate(m.date)}` };
}

/**
 * sow-499: under a result bar, after the public names: how many answered anonymously. "All 3 anonymous" when nobody
 * on that bar is public, "2 anonymous" beside names, nothing when everyone is public or nobody answered.
 */
export function peopleLine(group) {
  const count = Number(group?.count) || 0;
  const shown = Array.isArray(group?.people) ? group.people.length : 0;
  const anon = count - shown;
  if (anon <= 0) return '';
  return !shown && count > 1 ? `All ${count} anonymous` : `${anon} anonymous`;
}

/** A public answerer's profile address, only when their GBTI name has a public profile page (`known`). */
export function profileHref(folder, known) {
  const f = String(folder || '').trim().toLowerCase();
  if (!f || !known || typeof known.has !== 'function' || !known.has(f)) return '';
  return `/members/${encodeURIComponent(f)}/`;
}
