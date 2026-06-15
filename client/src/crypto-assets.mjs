// SOW-015: member-only encrypted asset crypto core. Node-free WebCrypto (globalThis.crypto.subtle),
// so the SAME module runs in the npm client, the Chrome extension, the build-time CI guard, and node
// tests. AES-256-GCM only, a fresh 96-bit IV per asset, and the asset id as AAD so a ciphertext cannot
// be transplanted onto another asset. The auth tag is verified on decrypt; a tag failure is access-denied,
// never a partial read.
//
// HONEST CAVEAT (kept in code on purpose): this is obfuscation, not confidentiality. The key is handed to
// active members by design, so a member can leak it, and the public ciphertext is permanent. Do NOT put a
// true secret behind this. See .data/sow/1_progressing/sow-015-member-only-encrypted-content.md section 1.

const subtle = () => {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error('WebCrypto crypto.subtle is unavailable in this runtime');
  return c.subtle;
};

const te = new TextEncoder();
const td = new TextDecoder();

/** Access-denied: any decrypt failure (wrong key, wrong AAD, tampered ciphertext/iv/tag) raises this. */
export class AssetAccessError extends Error {
  constructor(message = 'asset could not be decrypted') {
    super(message);
    this.name = 'AssetAccessError';
  }
}

// ---- portable base64 (Workers + browser + node; no Buffer) ----
export function bytesToB64(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  const CHUNK = 0x8000; // avoid call-stack limits on String.fromCharCode for large inputs
  for (let i = 0; i < u8.length; i += CHUNK) bin += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  return btoa(bin);
}
export function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Coerce a key (32 raw bytes as Uint8Array/ArrayBuffer, or a base64 string of 32 bytes) to a CryptoKey. */
async function importAesKey(key, usages) {
  let raw;
  if (typeof key === 'string') raw = b64ToBytes(key);
  else if (key instanceof Uint8Array) raw = key;
  else if (key instanceof ArrayBuffer) raw = new Uint8Array(key);
  else if (key && key.type === 'secret') {
    // Already a CryptoKey: enforce the same AES-256-GCM guarantee as the raw/base64 paths (do not silently
    // accept a downgraded AES-128 key).
    if (key.algorithm?.name !== 'AES-GCM' || key.algorithm?.length !== 256) throw new Error('CryptoKey must be AES-256-GCM');
    return key;
  } else throw new Error('key must be 32 raw bytes or a base64 string');
  if (raw.length !== 32) throw new Error('AES-256-GCM requires a 32-byte key (got ' + raw.length + ')');
  return subtle().importKey('raw', raw, { name: 'AES-GCM' }, false, usages);
}

const asBytes = (data) => (typeof data === 'string' ? te.encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data));

// ---- low-level primitive (KAT-tested against NIST AES-256-GCM vectors) ----

/** Encrypt with an explicit 12-byte IV. Returns ciphertext WITH the 16-byte GCM tag appended. */
export async function aesGcmEncrypt(key, iv, plaintext, aad = new Uint8Array(0)) {
  const ck = await importAesKey(key, ['encrypt']);
  const params = { name: 'AES-GCM', iv: asBytes(iv), tagLength: 128 };
  if (aad && aad.length) params.additionalData = asBytes(aad);
  const ct = await subtle().encrypt(params, ck, asBytes(plaintext));
  return new Uint8Array(ct);
}

/** Decrypt ciphertext-with-tag using an explicit IV. Throws AssetAccessError on any tag/auth failure. */
export async function aesGcmDecrypt(key, iv, ctWithTag, aad = new Uint8Array(0)) {
  const ck = await importAesKey(key, ['decrypt']);
  const params = { name: 'AES-GCM', iv: asBytes(iv), tagLength: 128 };
  if (aad && aad.length) params.additionalData = asBytes(aad);
  try {
    const pt = await subtle().decrypt(params, ck, asBytes(ctWithTag));
    return new Uint8Array(pt);
  } catch {
    throw new AssetAccessError();
  }
}

// ---- high-level asset envelope (what gets committed as <id>.enc) ----

export const ENVELOPE_VERSION = 1;

/**
 * Encrypt an asset into a JSON envelope. A FRESH random 96-bit IV is generated per call (IV reuse under one
 * key is catastrophic for GCM). The asset id is bound as AAD, so the ciphertext cannot be moved to another id.
 *   plaintext: string | Uint8Array | ArrayBuffer
 *   key:       32 raw bytes or a base64 string (the epoch key)
 *   assetId:   stable id of the asset (also the AAD)
 *   kid:       epoch/key id, recorded so a reader knows which epoch key to request
 * Returns { v, kid, iv, aad, ct } with iv/ct base64.
 */
export async function encryptAsset({ plaintext, key, assetId, kid = '1' }) {
  if (!assetId) throw new Error('assetId is required (it is the AAD that binds the ciphertext to the asset)');
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const aad = te.encode(String(assetId));
  const ct = await aesGcmEncrypt(key, iv, plaintext, aad);
  return { v: ENVELOPE_VERSION, kid: String(kid), iv: bytesToB64(iv), aad: String(assetId), ct: bytesToB64(ct) };
}

/**
 * Decrypt a JSON envelope produced by encryptAsset. Returns the plaintext Uint8Array. Throws AssetAccessError
 * on any failure (wrong key/epoch, tampered fields, mismatched asset id). FAIL CLOSED: never returns partial
 * or unauthenticated data.
 */
export async function decryptAsset({ envelope, key }) {
  if (!envelope || typeof envelope !== 'object') throw new AssetAccessError('missing envelope');
  if (envelope.v !== ENVELOPE_VERSION) throw new AssetAccessError('unsupported envelope version');
  let iv, ct;
  try {
    iv = b64ToBytes(envelope.iv);
    ct = b64ToBytes(envelope.ct);
  } catch {
    throw new AssetAccessError('malformed envelope');
  }
  if (iv.length !== 12) throw new AssetAccessError('bad iv length');
  const aad = te.encode(String(envelope.aad ?? ''));
  return aesGcmDecrypt(key, iv, ct, aad);
}

/** Decrypt and decode as UTF-8 text. */
export async function decryptAssetText(args) {
  return td.decode(await decryptAsset(args));
}

// ---- epoch key helpers (rotation tooling, CI guard) ----

/** Mint a new 32-byte epoch key, returned base64. Used by the rotation tool; the key lives only in the Worker secret + KV. */
export function generateEpochKey() {
  return bytesToB64(globalThis.crypto.getRandomValues(new Uint8Array(32)));
}

/** A non-reversible fingerprint of a key (SHA-256, first 8 bytes hex) for logs/CI without revealing the key. */
export async function keyFingerprint(key) {
  const raw = typeof key === 'string' ? b64ToBytes(key) : asBytes(key);
  const digest = new Uint8Array(await subtle().digest('SHA-256', raw));
  return Array.from(digest.subarray(0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
