// SOW-015 P5: epoch rotation re-encrypt helper. A re-encrypted envelope decrypts under the NEW key (with the
// new kid + same asset id) and NOT under the old key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateEpochKey, encryptAsset, decryptAssetText, decryptAsset, AssetAccessError } from '../client/src/crypto-assets.mjs';
import { reencryptEnvelope, planReencrypt } from '../scripts/rotate-member-key.mjs';

test('reencryptEnvelope moves an asset to the new epoch key, preserving the asset id', async () => {
  const oldKey = generateEpochKey();
  const newKey = generateEpochKey();
  const env1 = await encryptAsset({ plaintext: 'perk body', key: oldKey, assetId: 'asset-7', kid: '1' });

  const env2 = await reencryptEnvelope(env1, oldKey, newKey, '2');
  assert.equal(env2.kid, '2');
  assert.equal(env2.aad, 'asset-7');
  assert.equal(await decryptAssetText({ envelope: env2, key: newKey }), 'perk body');
  // the OLD key cannot read the re-encrypted envelope
  await assert.rejects(decryptAsset({ envelope: env2, key: oldKey }), AssetAccessError);
});

test('reencryptEnvelope throws if the old key is wrong (cannot silently lose data)', async () => {
  const env = await encryptAsset({ plaintext: 'x', key: generateEpochKey(), assetId: 'a', kid: '1' });
  await assert.rejects(reencryptEnvelope(env, generateEpochKey(), generateEpochKey(), '2'), AssetAccessError);
});

test('planReencrypt is all-or-nothing: a single bad asset reports a failure so the caller writes nothing', async () => {
  const oldKey = generateEpochKey();
  const newKey = generateEpochKey();
  const good1 = await encryptAsset({ plaintext: 'a', key: oldKey, assetId: 'g1', kid: '1' });
  const good2 = await encryptAsset({ plaintext: 'b', key: oldKey, assetId: 'g2', kid: '1' });
  const wrongEpoch = await encryptAsset({ plaintext: 'c', key: generateEpochKey(), assetId: 'bad', kid: '0' });

  // All good -> all planned, none failed.
  const okPlan = await planReencrypt([{ id: 'g1', envelope: good1 }, { id: 'g2', envelope: good2 }], oldKey, newKey, '2');
  assert.equal(okPlan.planned.length, 2);
  assert.equal(okPlan.failed.length, 0);

  // One asset cannot be decrypted with the old key -> it lands in failed, so main() aborts before any write.
  const mixed = await planReencrypt([{ id: 'g1', envelope: good1 }, { id: 'bad', envelope: wrongEpoch }], oldKey, newKey, '2');
  assert.equal(mixed.failed.length, 1);
  assert.equal(mixed.failed[0].id, 'bad');
});
