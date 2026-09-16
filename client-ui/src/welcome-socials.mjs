// sow-343: what Continue on the welcome wizard's socials step does with the handles the member typed.
//
// Until this existed the step said "you review and save these on your profile at the end", and nothing ever did:
// the only code that merged them (<gbti-profile-editor>) is mounted nowhere, and the website has no other way to
// edit profile links. Owner ruling, 2026-09-16: Continue saves them to the profile.
//
// A paid member's profile is published now, through the same publish call every host already uses. A trial member
// cannot publish a profile, so their handles are kept on the account (the onboarding record) and saved the first
// time they continue here as a paid member.
//
// THE ONE THING THIS MUST NEVER DO is write a bare new profile over a real one. It creates a profile only when the
// caller established that none exists (`profileRead` with no `profile`); a read that failed leaves `profileRead`
// false and the save refuses. Kept outside the element so it is testable without a DOM.
import { wizardProfileLinks } from './welcome-core.mjs';
import { SOCIAL_KEYS } from './social-icons.mjs';

/**
 * @param {object} a
 * @param {object} a.client          the host client (publish, setPrefs)
 * @param {object|null} a.profile    { path, frontmatter, body } of the saved profile, or null when there is none
 * @param {boolean} a.profileRead    true only when the profile read ANSWERED (found, or definitely absent)
 * @param {object} a.draft           the handles in the step's fields
 * @param {string} a.membership      the effective membership
 * @param {string} a.login           the member's login, a new profile's display name
 * @returns {Promise<{ outcome: 'nothing'|'kept'|'saved'|'unread'|'failed', profile?: object, error?: string }>}
 */
export async function saveWizardSocials({ client, profile = null, profileRead = false, draft = {}, membership, login = '' } = {}) {
  const prefs = (patch) => Promise.resolve().then(() => client?.setPrefs?.(patch)).catch(() => null);
  const { links, changed } = wizardProfileLinks(profile?.frontmatter?.links, draft, SOCIAL_KEYS);
  if (!changed) return { outcome: 'nothing' };
  if (membership !== 'paid') {
    await prefs({ onboardingSocials: draft });
    return { outcome: 'kept' };
  }
  if (!profileRead) {
    return { outcome: 'unread', error: 'We could not read your profile just now, so nothing was saved. Your handles are kept here. Try again in a moment, or skip for now.' };
  }
  const frontmatter = profile ? { ...profile.frontmatter, links } : { displayName: login, links };
  try {
    await client.publish({ type: 'profile', input: frontmatter, body: profile?.body ?? '', ...(profile?.path ? { path: profile.path } : {}) });
  } catch (e) {
    await prefs({ onboardingSocials: draft });
    return { outcome: 'failed', error: `Your handles were not saved (${e?.message || 'the network did not answer'}). They are kept, so you can try again, or skip for now.` };
  }
  // The save carried the kept handles, so the record drops them and remembers the step is done while the change is
  // on its way to the live site.
  await prefs({ onboardingSocialsSaved: true });
  return { outcome: 'saved', profile: { path: profile?.path ?? null, body: profile?.body ?? '', frontmatter } };
}
