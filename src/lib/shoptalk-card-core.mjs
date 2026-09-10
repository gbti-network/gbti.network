// sow-314: what the account page's Shop Talk card says, from the Worker's answer. Pure, so every state is a
// unit test rather than a screenshot. The Worker answer is { eligible, status, enrolled, address, optedOut,
// nextCall, declined, dropped }; `enrolled` is null when the calendar could not be read, which must read as
// "unknown", never as "no". The action is what the button does next: 'leave', 'rejoin', or nothing.
//
// TWO STATES ADDED 2026-09-10, when the owner ruled that the invitation goes out once and the member decides
// the rest: `declined` (on the list, answered No on the calendar) and `dropped` (invited once, since removed
// from the list, by anyone). In both the sweep will never mail them again on its own, so the card says so
// and Rejoin is the member's one way back. It sends exactly one fresh invitation.

const when = (iso) => {
  const t = Date.parse(String(iso || ''));
  if (!Number.isFinite(t)) return null;
  return new Date(t).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
};

export function shoptalkCardState(res) {
  const r = res && typeof res === 'object' ? res : {};
  const next = when(r.nextCall);
  const nextLine = next ? ` The next call is ${next}.` : '';
  if (!r.eligible) {
    return {
      headline: 'Saturday Shop Talk',
      body: 'The Saturday call is part of paid and trial membership. Join a tier and your seat is added automatically.',
      action: null, actionLabel: null, href: '/membership/', hrefLabel: 'See membership',
    };
  }
  if (r.optedOut) {
    return {
      headline: 'You stepped off the Saturday call list',
      body: `Rejoin and your invitation is sent again${r.address ? ` to ${r.address}` : ''}.${nextLine}`,
      action: 'rejoin', actionLabel: 'Rejoin the call list', href: null, hrefLabel: null,
    };
  }
  if (!r.address) {
    return {
      headline: 'Saturday Shop Talk',
      body: 'We have no email address for this account, so no invitation can be sent. Reach the team on Discord to add one.',
      action: null, actionLabel: null, href: null, hrefLabel: null,
    };
  }
  if (r.enrolled === true && r.declined) {
    return {
      headline: 'You declined the Saturday call invitation',
      body: `Nothing more is sent unless you ask. Rejoin and a fresh invitation goes to ${r.address}.${nextLine}`,
      action: 'rejoin', actionLabel: 'Rejoin the call list', href: null, hrefLabel: null,
    };
  }
  if (r.enrolled === false && r.dropped) {
    return {
      headline: 'You are off the Saturday call list',
      body: `Your seat under ${r.address} was removed, and nothing more is sent unless you ask. Rejoin and a fresh invitation goes to ${r.address}.${nextLine}`,
      action: 'rejoin', actionLabel: 'Rejoin the call list', href: null, hrefLabel: null,
    };
  }
  if (r.enrolled === true) {
    return {
      headline: 'You are on the Saturday call',
      body: `Your invitation went to ${r.address}. Accept it there and the Google Meet admits you without knocking.${nextLine}`,
      action: 'leave', actionLabel: 'Leave the call list', href: null, hrefLabel: null,
    };
  }
  if (r.enrolled === false) {
    return {
      headline: 'Your seat is being added',
      body: `The invitation goes to ${r.address} on the next nightly sweep.${nextLine}`,
      action: 'leave', actionLabel: 'Leave the call list', href: null, hrefLabel: null,
    };
  }
  return {
    headline: 'Saturday Shop Talk',
    body: `Your seat is under ${r.address}. The calendar could not be read just now, so the guest list is unconfirmed.${nextLine}`,
    action: 'leave', actionLabel: 'Leave the call list', href: null, hrefLabel: null,
  };
}

/** What the card shows right after a leave or rejoin answered. */
export function shoptalkAfterAction(res, action) {
  const r = res && typeof res === 'object' ? res : {};
  if (r.message) return { note: r.message };
  if (action === 'leave') return { note: r.applied ? 'Removed from the guest list. Google sends the update to your inbox.' : 'Recorded; the change reaches the calendar on the next sweep.' };
  return { note: r.applied ? 'Invitation sent. Accept it in your inbox and the Meet admits you.' : 'You are already on the guest list.' };
}
