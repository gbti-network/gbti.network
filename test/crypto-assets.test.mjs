// SOW-015: crypto core tests. Validates the primitive against a NIST AES-256-GCM known-answer vector, then
// adversarially exercises the asset envelope: round-trips, fail-closed on wrong key / wrong asset-id (AAD) /
// tampered ciphertext / tampered iv / truncated tag, and a fresh IV per encryption.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  aesGcmEncrypt, aesGcmDecrypt, encryptAsset, decryptAsset, decryptAssetText,
  bytesToB64, b64ToBytes, generateEpochKey, keyFingerprint, AssetAccessError, ENVELOPE_VERSION,
} from '../client/src/crypto-assets.mjs';

const hexToBytes = (h) => new Uint8Array(h.match(/.{2}/g).map((b) => parseInt(b, 16)));
const bytesToHex = (u8) => Array.from(u8).map((b) => b.toString(16).padStart(2, '0')).join('');

test('NIST AES-256-GCM known-answer vector (the primitive is real AES-256-GCM)', async () => {
  // NIST GCM test vector: 256-bit zero key, zero IV, 16-byte zero plaintext, empty AAD.
  // Expected CT = cea7403d4d606b6e074ec5d3baf39d18, Tag = d0d1c8a799996bf0265b98b5d48ab919.
  const key = hexToBytes('00'.repeat(32));
  const iv = hexToBytes('00'.repeat(12));
  const pt = hexToBytes('00'.repeat(16));
  const out = await aesGcmEncrypt(key, iv, pt); // ciphertext || tag
  assert.equal(bytesToHex(out), 'cea7403d4d606b6e074ec5d3baf39d18d0d1c8a799996bf0265b98b5d48ab919');
  // And it round-trips back.
  const back = await aesGcmDecrypt(key, iv, out);
  assert.equal(bytesToHex(back), '00'.repeat(16));
});

test('base64 helpers round-trip arbitrary bytes', () => {
  const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64, 13, 10]);
  assert.deepEqual(b64ToBytes(bytesToB64(bytes)), bytes);
});

test('envelope round-trips text, unicode, empty, and binary', async () => {
  const key = generateEpochKey();
  for (const pt of ['hello network', 'unicode: café, 日本語, emoji 🔐', '', 'x'.repeat(5000)]) {
    const env = await encryptAsset({ plaintext: pt, key, assetId: 'asset-1' });
    assert.equal(env.v, ENVELOPE_VERSION);
    assert.equal(env.aad, 'asset-1');
    assert.equal(await decryptAssetText({ envelope: env, key }), pt);
  }
  const bin = new Uint8Array([1, 2, 3, 0, 255, 254]);
  const env = await encryptAsset({ plaintext: bin, key, assetId: 'bin-asset' });
  assert.deepEqual(await decryptAsset({ envelope: env, key }), bin);
});

test('a fresh IV is used per encryption (no IV reuse, so ciphertext differs)', async () => {
  const key = generateEpochKey();
  const a = await encryptAsset({ plaintext: 'same', key, assetId: 'id' });
  const b = await encryptAsset({ plaintext: 'same', key, assetId: 'id' });
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ct, b.ct);
  assert.equal(b64ToBytes(a.iv).length, 12);
});

test('FAIL CLOSED: a wrong key cannot decrypt', async () => {
  const env = await encryptAsset({ plaintext: 'secret perk', key: generateEpochKey(), assetId: 'id' });
  await assert.rejects(decryptAsset({ envelope: env, key: generateEpochKey() }), AssetAccessError);
});

test('FAIL CLOSED: a transplanted ciphertext (wrong asset id / AAD) cannot decrypt', async () => {
  const key = generateEpochKey();
  const env = await encryptAsset({ plaintext: 'for asset A only', key, assetId: 'asset-A' });
  // Move the ciphertext onto a different asset id by rewriting the AAD field.
  await assert.rejects(decryptAsset({ envelope: { ...env, aad: 'asset-B' }, key }), AssetAccessError);
});

test('FAIL CLOSED: tampered ciphertext, iv, or truncated tag all reject', async () => {
  const key = generateEpochKey();
  const env = await encryptAsset({ plaintext: 'integrity matters', key, assetId: 'id' });
  // flip a ciphertext byte
  const ct = b64ToBytes(env.ct); ct[0] ^= 0x01;
  await assert.rejects(decryptAsset({ envelope: { ...env, ct: bytesToB64(ct) }, key }), AssetAccessError);
  // flip an iv byte
  const iv = b64ToBytes(env.iv); iv[0] ^= 0x01;
  await assert.rejects(decryptAsset({ envelope: { ...env, iv: bytesToB64(iv) }, key }), AssetAccessError);
  // truncate the GCM tag
  const trunc = b64ToBytes(env.ct).subarray(0, b64ToBytes(env.ct).length - 4);
  await assert.rejects(decryptAsset({ envelope: { ...env, ct: bytesToB64(trunc) }, key }), AssetAccessError);
});

test('FAIL CLOSED: malformed/old-version/short-iv envelopes reject', async () => {
  const key = generateEpochKey();
  await assert.rejects(decryptAsset({ envelope: null, key }), AssetAccessError);
  await assert.rejects(decryptAsset({ envelope: { v: 99, iv: 'AAAA', ct: 'AAAA', aad: 'x' }, key }), AssetAccessError);
  const env = await encryptAsset({ plaintext: 'x', key, assetId: 'id' });
  await assert.rejects(decryptAsset({ envelope: { ...env, iv: bytesToB64(new Uint8Array(8)) }, key }), AssetAccessError);
});

test('encryptAsset requires an assetId (the AAD binding)', async () => {
  await assert.rejects(encryptAsset({ plaintext: 'x', key: generateEpochKey(), assetId: '' }), /assetId is required/);
});

test('a non-32-byte key is rejected', async () => {
  await assert.rejects(encryptAsset({ plaintext: 'x', key: bytesToB64(new Uint8Array(16)), assetId: 'id' }), /32-byte key/);
});

test('a pre-imported CryptoKey must be AES-256-GCM (a 128-bit key is rejected)', async () => {
  const k128 = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(16), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  await assert.rejects(encryptAsset({ plaintext: 'x', key: k128, assetId: 'id' }), /CryptoKey must be AES-256-GCM/);
  const k256 = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(32), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
  const env = await encryptAsset({ plaintext: 'ok', key: k256, assetId: 'id' });
  assert.equal(await decryptAssetText({ envelope: env, key: k256 }), 'ok');
});

test('keyFingerprint is stable and non-reversible-looking', async () => {
  const key = 'A'.repeat(43) + '='; // 32 bytes base64
  const fp1 = await keyFingerprint(key);
  const fp2 = await keyFingerprint(key);
  assert.equal(fp1, fp2);
  assert.match(fp1, /^[0-9a-f]{16}$/);
});
