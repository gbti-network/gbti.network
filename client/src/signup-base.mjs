// The signup Worker base URL (SOW-002 / SOW-011 / SOW-016). Kept in its own NODE-FREE module so importing it
// (e.g. from operations.mjs, which the Chrome extension bundles) never drags in the node-only settings/autostart
// graph. Override locally with GBTI_SIGNUP_BASE; defaults to production.
export const SIGNUP_BASE = (globalThis.process?.env?.GBTI_SIGNUP_BASE) || 'https://signup.gbti.network';

// The PUBLIC device-flow GitHub OAuth app client id. Public by design (device flow has no client secret), so it
// ships in BOTH the extension and the npm client; the same app serves local + production. Override with
// GBTI_GITHUB_CLIENT_ID (node only); the extension bundles the baked default. (globalThis.process is undefined in
// the MV3 service worker, so the optional chaining safely falls through to the default there.)
export const GITHUB_CLIENT_ID = (globalThis.process?.env?.GBTI_GITHUB_CLIENT_ID) || 'Ov23limR5x7taIm33sTY';

// SOW-026: the GitHub App client, used for sign-in by the extension (which bakes the real id at build time). With
// no install of its own, an App user token identifies the member and can touch nothing else. The fallback here is
// a PLACEHOLDER, which is why the command line tool signs in with the OAuth app above instead. UPSTREAM_REPO is
// the canonical repository.
export const GITHUB_APP_CLIENT_ID = (globalThis.process?.env?.GBTI_GITHUB_APP_CLIENT_ID) || 'Iv1.gbti-app-placeholder';
export const GITHUB_APP_SLUG = (globalThis.process?.env?.GBTI_GITHUB_APP_SLUG) || 'gbti-network';
export const UPSTREAM_REPO = (globalThis.process?.env?.GBTI_UPSTREAM_REPO) || 'gbti-network/gbti.network';

// AUTH_MODE = 'classic' | 'app' | 'hosted'. Since sow-274 Part 2 this selects the SIGN-IN client only (which
// GitHub client id and scope the device flow asks for); every mode publishes through the network, see
// authModeFor below. Defaults to classic, which is what the command line tool and the agent server sign in with.
const rawAuthMode = globalThis.process?.env?.GBTI_AUTH_MODE;
export const AUTH_MODE = rawAuthMode === 'app' ? 'app' : rawAuthMode === 'hosted' ? 'hosted' : 'classic';
export const isAppMode = () => AUTH_MODE === 'app';
export const isHostedMode = () => AUTH_MODE === 'hosted';
/** The device-flow client id for the active auth mode. Hosted uses the App id too (identity-only: with no
 *  install granted, an App user token identifies the member and can touch nothing else). */
export const activeClientId = () => (AUTH_MODE === 'classic' ? GITHUB_CLIENT_ID : GITHUB_APP_CLIENT_ID);
/**
 * The OAuth scope the sign-in asks for: IDENTITY ONLY, on every host.
 *
 * sow-274 Part 4: the command line tool and the agent server used to ask for `public_repo read:user`, which is
 * write access to every public repository the member owns. They needed it only to publish from the member's own
 * copy of the repository, and that path is gone, so the grant is gone too. `read:user` identifies the member and
 * nothing more. GitHub Apps ignore scope (permissions come from an install, and members are no longer asked to
 * install anything), so the App client sends none. A member who granted the old scope keeps that grant until they
 * sign in again or revoke it (owner, 2026-09-15: stop asking, do not force anyone out).
 */
export const activeScope = () => (AUTH_MODE === 'classic' ? 'read:user' : '');

// ---- sow-274 Part 2: every host publishes through the network ----
//
// SOW-157 stored a per-member mode here (authModeFor, isHostedCtx, decideAuthMode) that chose between
// publishing through the network and publishing from the member's own copy of the repository. The second path
// is retired, so the chooser is deleted rather than pinned: with nothing to ask, no caller can ask it the wrong
// way, and a session that still carries a stored 'app' or 'classic' value has nothing left that reads it.
//
// The baked AUTH_MODE above still selects the SIGN-IN client (activeClientId / activeScope) until Part 4 retires
// it. That is deliberate and temporary: the command line tool's alternative client id is a placeholder outside
// the extension build, so switching sign-in here would break sign-in rather than narrow it. It no longer decides
// where anything is written.
