// sow-337: the file-writing plumbing of the admin write route (membership-admin-author.mjs), moved here because
// that file is at the size cap. It PUTs or DELETEs one file on a hosted-admin branch through the Contents API.
// A text entry ({ path, content }) is base64-encoded from its UTF-8 string; a binary entry ({ path,
// contentBase64 }) is already base64 and passes through un-re-encoded, the same shape the member publish route
// uses (membership-author.mjs), so a call-to-action image lands byte for byte as the shared check accepted it.
// `content: null` deletes. The security is not here: the route authorizes, picks the paths, and re-checks their
// rank before calling this.

const GH = 'https://api.github.com';
const GH_HEADERS = (token) => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'gbti-network' });

/** Standard base64 of a UTF-8 string. */
export function b64utf8(s) {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode a GitHub Contents API base64 blob to a UTF-8 string, or null. */
export function decodeContent(b64) {
  try {
    const bin = atob(String(b64 || '').replace(/\s+/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  } catch { return null; }
}

/** PUT (or DELETE for content: null) one file on the branch; one retry on a 409 sha race. */
export async function applyFile(fetchImpl, instToken, upstream, branch, f, attempt = 0) {
  const url = `${GH}/repos/${upstream}/contents/${f.path}`;
  const existing = await fetchImpl(`${url}?ref=${encodeURIComponent(branch)}`, { headers: GH_HEADERS(instToken) });
  const exData = await existing.json().catch(() => ({}));
  const sha = existing.ok ? exData?.sha : undefined;
  const isBinary = f.contentBase64 !== undefined && f.contentBase64 !== null;
  if (f.content === null && !isBinary) {
    if (!sha) return { ok: true, skipped: true }; // deleting a file that is already gone is a no-op
    const res = await fetchImpl(url, {
      method: 'DELETE', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: `content: remove ${f.path}`, sha, branch }),
    });
    if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
    return { ok: res.ok };
  }
  const encoded = isBinary ? String(f.contentBase64) : b64utf8(f.content);
  const res = await fetchImpl(url, {
    method: 'PUT', headers: { ...GH_HEADERS(instToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: `content: update ${f.path}`, content: encoded, branch, ...(sha ? { sha } : {}) }),
  });
  if (res.status === 409 && attempt === 0) return applyFile(fetchImpl, instToken, upstream, branch, f, 1);
  return { ok: res.ok };
}
