// sow-316: the one decision behind upgrading the site's save controls (<gbti-favorite>, <gbti-collection>)
// for a WEBSITE session, kept pure so it can be unit-tested, and kept in one place so no surface has to
// remember it.
//
// History, because it is the reason this file exists: the upgrade was written per surface. The feed pages
// had it, the content pages gained it on 2026-09-08, and an audit of the built site the same afternoon found
// the prompt and project directories, every member profile, every share page and two utility pages still
// inert: a signed-in member clicked a heart there and met the sign-in dialog. Each surface that copied the
// wiring was right; each that did not was wrong; nothing made the next surface copy it. The upgrade now runs
// from the layout every page uses, and this helper says whether it should.
//
// WEBSITE FIRST, 2026-09-12 (owner report): the upgrade used to stand down whenever the browser extension was
// installed, on the stated grounds that the extension "upgrades them itself". It does not and cannot. Its content
// script runs in Chrome's isolated world, where it has no access to the page's custom elements registry, so with
// the extension installed every heart and Save pill on the site stayed inert. A content page deep-linked the click
// into the extension; the feeds, directories, profiles and share pages opened the sign-in dialog for a member who
// was already signed in. Reproduced by driving the built site with the extension marker stamped and a website
// session present, then controlled by the same drive with the marker removed, which saved on every page. The
// extension is now irrelevant here: a website session is what upgrades the controls.

/**
 * @param signal      the member signal, or null when nobody is signed in
 * @param csrf        the gbti_csrf cookie value, or null (a session that cannot write must not be upgraded
 *                    into a control that fails on every press)
 * @param hasControls whether the page renders any save control at all
 * @param wired       whether this page already upgraded (the signal can fire more than once)
 *
 * The signal must come from the website cookie session. With the extension installed its display-only signal can
 * arrive first, possibly for a different account, and the client is built once from whichever signal upgrades it.
 */
export function shouldUpgradeSaveControls({ signal, csrf, hasControls, wired }) {
  if (wired) return false;
  if (!hasControls) return false;
  if (!signal || !signal.login) return false;
  if (signal.source !== 'cookie') return false;
  if (!csrf) return false;
  return true;
}

// sow-330 (2026-09-12): shouldDeepLinkSaveToExtension is GONE. It sent a heart or Save click from a visitor with the
// extension and no website session into the extension. The owner rule "All save and collection behavior initiated
// from the website will stay on the website" retires that path entirely; that visitor now meets the same website
// sign-in dialog as anyone else, and their save completes after sign-in (save-intent-core.mjs).

/** The arguments the website client is built from, in one shape, so every caller builds the same client. */
export function websiteClientArgs(signal, signupBase) {
  return {
    signupBase: signupBase || '',
    login: String(signal.login),
    githubId: signal.githubId != null ? String(signal.githubId) : null,
  };
}

/** Read one cookie by name from a document.cookie string. */
export function cookieValue(cookieString, name) {
  for (const part of String(cookieString || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq >= 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim() || null;
  }
  return null;
}
