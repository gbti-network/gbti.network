// The extension store (SOW-006 v2 P4). The core's store interface is SYNCHRONOUS (operations read
// store.get('githubToken') etc. synchronously), but chrome.storage is async. So the worker hydrates this
// in-memory store from chrome.storage.local ONCE at startup, exposes sync get/set, and persists writes back
// to chrome.storage in the background. Holds: githubToken, identity, status, upstream. NO endpoint token
// (the extension has no HTTP server) and no card data.

export function createExtStore(initial = {}, persist = () => {}) {
  const data = { ...initial };
  return {
    get(key) {
      return data[key];
    },
    set(patch) {
      Object.assign(data, patch);
      try {
        persist({ ...data });
      } catch {
        /* persistence is best-effort; the in-memory value is authoritative for this session */
      }
      return { ...data };
    },
    snapshot() {
      return { ...data };
    },
  };
}
