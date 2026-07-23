// SOW-016: the client side of member-only content. The AES key NEVER reaches the client now (this supersedes
// the SOW-015 local-decrypt path). The client is a thin transport: it POSTs the ciphertext envelope to the
// Worker to DECRYPT (read), or POSTs plaintext to ENCRYPT (publish). The Worker holds the key and applies the
// effective-paid gate; a 403 means locked. The publish-time split at the `<!-- members-only -->` marker is
// pure and lives here too. Node-free (fetch only), so it runs in the npm host and the Chrome extension.

/** Thrown when the member is not entitled (locked): a 401/403 from the Worker. Distinct from a transport error. */
export class MemberContentLockedError extends Error {
  constructor(message = 'member content is locked (an active paid membership is required)') {
    super(message);
    this.name = 'MemberContentLockedError';
  }
}

const base = (signupBase) => String(signupBase || '').replace(/\/$/, '');

/**
 * Decrypt a .enc envelope via the Worker. Returns the plaintext markdown string. Throws
 * MemberContentLockedError on 401/403 (not entitled), or Error on any other failure. The key never reaches us.
 */
export async function decryptViaWorker({ envelope, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new MemberContentLockedError('not signed in');
  const res = await fetch(base(signupBase) + '/membership/decrypt', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(envelope),
  });
  if (res.status === 401 || res.status === 403) throw new MemberContentLockedError();
  if (!res.ok) throw new Error('decrypt failed (' + res.status + ')');
  const data = await res.json();
  if (!data || data.ok !== true || typeof data.text !== 'string') throw new Error('decrypt: malformed response');
  return data.text;
}

/** Fetch a published .enc by URL (the public ciphertext on the CDN) and decrypt it via the Worker. */
export async function fetchAndDecrypt({ url, token, signupBase, fetch = globalThis.fetch }) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('could not fetch the encrypted asset (' + res.status + ')');
  const envelope = await res.json();
  return decryptViaWorker({ envelope, token, signupBase, fetch });
}

/**
 * Encrypt plaintext via the Worker (encrypt-on-publish). Returns the .enc envelope to commit as <assetId>.enc.
 * Throws MemberContentLockedError if the author is not effective-paid. The plaintext leaves the client only
 * over TLS to the Worker; the key never comes back.
 */
export async function encryptViaWorker({ plaintext, assetId, token, signupBase, fetch = globalThis.fetch }) {
  if (!token || !signupBase) throw new MemberContentLockedError('not signed in');
  const res = await fetch(base(signupBase) + '/membership/encrypt', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ plaintext, assetId }),
  });
  if (res.status === 401 || res.status === 403) throw new MemberContentLockedError('cannot encrypt: an active paid membership is required');
  if (!res.ok) throw new Error('encrypt failed (' + res.status + ')');
  const data = await res.json();
  if (!data || data.ok !== true || !data.envelope) throw new Error('encrypt: malformed response');
  return data.envelope;
}

// ---- publish-time marker split (pure) ----

export const MEMBER_MARKER = '<!-- members-only -->';

/**
 * Split an authored body at the first `<!-- members-only -->` marker. Returns { publicPart, memberPart }:
 * everything before the marker is the public teaser, everything after is the gated member part (trimmed).
 * If there is no marker, memberPart is null (a plain public body).
 */
export function splitMemberMarkdown(body) {
  const text = String(body ?? '');
  const idx = text.indexOf(MEMBER_MARKER);
  if (idx === -1) return { publicPart: text, memberPart: null };
  return {
    publicPart: text.slice(0, idx).trimEnd(),
    memberPart: text.slice(idx + MEMBER_MARKER.length).replace(/^\s+/, ''),
  };
}

/** The repo-relative path + asset id for a content item's encrypted body envelope (SOW-016 convention). */
// SOW-145: `scope` places the ciphertext beside its item — 'member' -> members/<username>/_enc/, 'house' ->
// house/_enc/ (a house members-only body; the decrypt allowlist ENC_PATH_RE already permits house/_enc/). The
// assetId stays scope-free: it is embedded in the envelope, so decrypt round-trips regardless of the folder.
export function encAssetFor(type, username, slug, scope = 'member') {
  const assetId = `${type}:${slug}:body`;
  const folder = scope === 'house' ? 'house' : `members/${username}`;
  const path = `${folder}/_enc/${type}-${slug}-body.enc`;
  return { assetId, path };
}
