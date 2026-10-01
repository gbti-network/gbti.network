// sow-337: the file-writing plumbing of the admin write route (membership-admin-author.mjs), moved here because
// that file was at the size cap. It PUTs or DELETEs one file on a hosted-admin branch through the Contents API.
// A text entry ({ path, content }) is base64-encoded from its UTF-8 string; a binary entry ({ path,
// contentBase64 }) is already base64 and passes through un-re-encoded, the same shape the member publish route
// uses (membership-author.mjs), so a call-to-action image lands byte for byte as the shared check accepted it.
// `content: null` deletes. The security is not here: the route authorizes, picks the paths, and re-checks their
// rank before calling this.

import yaml from 'js-yaml'; // already in the Worker bundle (content-ops)

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

// The house-file READ helpers of the admin routes, moved here from membership-admin-author.mjs at the 900-line
// limit. The CTA and Skill install modules import them from here, which keeps them out of an import cycle with
// the author file; the author file re-exports leadingComment and loadHouseYaml for its existing importers.

// Preserve the leading comment block (a run of `#`/blank lines at the top) of a config file across a re-serialize,
// mirroring client/src/admin-ops.mjs leadingComment. Governance files have none, so this is config-only.
export function leadingComment(raw) { // sow-109: exported for the Skill install writes
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line);
    else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}

// Read + parse a house YAML file from canonical main, FAIL CLOSED. Shared by the governance + config branches so
// they cannot disagree about "malformed = 502, not a silent reset". Returns { ok:true, parsed, raw } (raw kept for
// the config leading-comment preserve), or { ok:false, status, body }. A 404 is a legitimate empty fresh start.
export async function loadHouseYaml(fetchImpl, instToken, upstream, path) {
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { ok: true, parsed: {}, raw: '' };
  if (!cur.ok) return { ok: false, status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  const raw = decodeContent((await cur.json().catch(() => ({})))?.content) ?? '';
  let loaded;
  try { loaded = raw ? yaml.load(raw) : {}; }
  catch { return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } }; }
  if (loaded === undefined || loaded === null) return { ok: true, parsed: {}, raw };
  if (typeof loaded !== 'object' || Array.isArray(loaded)) return { ok: false, status: 502, body: { error: 'parse_failed', message: 'the governance file is malformed' } };
  return { ok: true, parsed: loaded, raw };
}

// sow-161 A: read a RAW file (a content .md, which is not YAML). 404 -> { ok, raw: null } so a stale path in a
// batch is skipped, not fatal. Same contents API + App token loadHouseYaml uses.
export async function loadRawFile(fetchImpl, instToken, upstream, path) {
  const cur = await fetchImpl(`${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (cur.status === 404) return { ok: true, raw: null };
  if (!cur.ok) return { ok: false, status: 502, body: { error: 'read_failed', message: `GitHub returned ${cur.status}` } };
  return { ok: true, raw: decodeContent((await cur.json().catch(() => ({})))?.content) ?? '' };
}
