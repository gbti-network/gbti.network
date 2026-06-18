// SOW-036: the allowlist + validator for "open an in-extension page in a new tab". Two callers ask for this: the
// site header's avatar menu (which CANNOT link to chrome-extension:// because it does not know the extension id,
// so it dispatches a gbti:open page event the content script relays to the background) and the new-tab dropdown.
// The BACKGROUND is the authoritative boundary (it resolves + opens the chrome-extension:// URL); the content
// script also pre-validates (defense in depth). Only a fixed set of pages can be opened, and only with a hash that
// matches a safe token pattern, so a hostile gbti.network page cannot relay a request to open an arbitrary URL.
// Node-free + DOM-free so it unit-tests with no harness.

// Every standalone extension page reachable from a menu. newtab/onboarding are included for completeness even
// though they have their own entry points; an unlisted or off-origin string is rejected.
const PAGES = new Set([
  'newtab.html',
  'workspace.html',
  'shares.html',
  'admin.html',
  'account.html',
  'onboarding.html',
]);

// A hash hint like "tab=prompt" or "tab=post&read=members%2Falice%2F...". Restricted to URL-safe tokens (no
// spaces, quotes, scheme, or path separators) so it cannot smuggle anything past chrome.runtime.getURL.
const HASH_RE = /^[A-Za-z0-9=&_%.,-]{1,300}$/;

/**
 * Validate { page, hash } into a relative path ("page.html" or "page.html#hash") safe to pass to
 * chrome.runtime.getURL, or null when rejected. The leading '#' on hash is optional.
 */
export function resolveOpenPage({ page, hash } = {}) {
  if (typeof page !== 'string' || !PAGES.has(page)) return null;
  if (hash == null || hash === '') return page;
  const h = String(hash).replace(/^#/, '');
  if (h === '') return page;
  if (!HASH_RE.test(h)) return null;
  return `${page}#${h}`;
}

export const OPENABLE_PAGES = PAGES;
