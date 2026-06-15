// SOW-024: the cookie-consent decision logic (geofenced). Analytics (a non-essential cookie category) needs
// prior consent in the EU/EEA + UK; everywhere else it loads with no prompt. The REFERRAL cookie is handled
// separately (ReferralCapture) and is NOT gated by this, per the owner decision that referral attribution is
// always on (see data-protection.md section 6 for the honest residual-risk note). The session cookie is
// strictly necessary and also out of scope here.
//
// Plain .mjs (no node imports), so node --test can import the pure logic AND the CookieConsent component's
// bundled <script> can reuse it. Region is detected client-side via Cloudflare's /cdn-cgi/trace (no Worker
// needed); an unknown region fails CLOSED (prompt + hold analytics), so we never silently fire analytics for a
// possibly-EU visitor we could not geolocate.

// EU 27 + EEA (Iceland, Liechtenstein, Norway) + UK (PECR, materially the same consent regime).
export const CONSENT_REGIONS = new Set([
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU',
  'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  'IS', 'LI', 'NO',
  'GB',
]);

export const CONSENT_KEY = 'gbti-cookie-consent'; // localStorage; storing the consent choice is strictly necessary
export const ANALYTICS_EVENT = 'gbti:analytics-consent';
export const OPEN_PREFS_EVENT = 'gbti:open-cookie-prefs';

/** Parse the country code from a Cloudflare /cdn-cgi/trace body ("...\nloc=US\n..."). null if absent. */
export function parseLoc(traceText) {
  const m = /(^|\n)loc=([A-Za-z]{2})/.exec(String(traceText || ''));
  return m ? m[2].toUpperCase() : null;
}

/** Does this country code require a consent prompt before a non-essential cookie? */
export function isConsentRegion(loc) {
  return !!loc && CONSENT_REGIONS.has(loc);
}

/**
 * The decision. `stored` is the persisted analytics choice ('granted'|'denied'|null); `loc` is the visitor
 * country code (null if unknown). Fail-closed: an unknown region with no stored choice needs consent (we hold
 * analytics + show the banner) so we never fire analytics for a possibly-EU visitor we could not geolocate.
 * @returns {{ showBanner: boolean, analyticsAllowed: boolean, needsConsent: boolean }}
 */
export function decide({ stored, loc } = {}) {
  const needsConsent = loc == null ? true : isConsentRegion(loc);
  if (stored === 'granted') return { showBanner: false, analyticsAllowed: true, needsConsent };
  if (stored === 'denied') return { showBanner: false, analyticsAllowed: false, needsConsent };
  if (!needsConsent) return { showBanner: false, analyticsAllowed: true, needsConsent }; // outside the EU/UK: implicit allow
  return { showBanner: true, analyticsAllowed: false, needsConsent }; // EU/UK (or unknown): prompt, hold analytics
}
