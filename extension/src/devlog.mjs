// SOW-124: the extension realm's devlog singleton + the shared on/off flag. The service worker and the new-tab
// page are SEPARATE JS realms, so each bundle that imports this module gets its OWN devlog instance (its own
// ring); the Debug panel merges the two over a message. The flag lives in chrome.storage.local (NOT localStorage:
// the service worker has no localStorage), so both realms read the same switch and react to a toggle. Everything
// is chrome-optional and guarded, so importing this in a node unit test is a safe no-op (chrome is undefined ->
// the flag stays false -> the devlog no-ops). Redaction + the ring are the pure core; this only wires the gate.

import { createDevlog } from '../../membership/devlog-core.mjs';

export const DEVLOG_FLAG_KEY = 'gbti-devlog';

// The cached flag, kept in sync so the devlog `enabled` thunk can read it synchronously on every call.
let FLAG = false;
try {
  chrome?.storage?.local?.get?.(DEVLOG_FLAG_KEY)?.then?.((r) => { FLAG = r?.[DEVLOG_FLAG_KEY] === true; })?.catch?.(() => {});
  chrome?.storage?.onChanged?.addListener?.((changes, area) => {
    if (area === 'local' && changes?.[DEVLOG_FLAG_KEY]) FLAG = changes[DEVLOG_FLAG_KEY].newValue === true;
  });
} catch { /* no chrome (node/tests): the flag stays false and the devlog is inert */ }

/** The current on/off flag (superadmin sets it from the Debug panel; a non-superadmin never sees the toggle). */
export function devlogFlagOn() { return FLAG === true; }

/** Turn the flag on/off (called by the panel). Persists to chrome.storage.local so both realms pick it up. */
export async function setDevlogFlag(on) {
  FLAG = !!on;
  try { await chrome?.storage?.local?.set?.({ [DEVLOG_FLAG_KEY]: !!on }); } catch { /* best-effort */ }
}

// One devlog per realm. `enabled` is the flag thunk (re-read each call); superadmin is enforced at the UI (the
// Debug menu item is superadmin-only) and at the background ring-read (gated on the resolved role). Output is
// always redacted by the core, so even a manually-flipped flag can never surface a secret.
export const devlog = createDevlog({ enabled: devlogFlagOn, sink: console });
