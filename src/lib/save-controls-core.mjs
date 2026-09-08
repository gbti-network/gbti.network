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

/**
 * @param signal      the member signal, or null when nobody is signed in
 * @param csrf        the gbti_csrf cookie value, or null (a session that cannot write must not be upgraded
 *                    into a control that fails on every press)
 * @param extension   truthy when the browser extension owns the page's controls (it upgrades them itself)
 * @param hasControls whether the page renders any save control at all
 * @param wired       whether this page already upgraded (the signal can fire more than once)
 */
export function shouldUpgradeSaveControls({ signal, csrf, extension, hasControls, wired }) {
  if (wired) return false;
  if (extension) return false;
  if (!hasControls) return false;
  if (!signal || !signal.login) return false;
  if (!csrf) return false;
  return true;
}

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
