// Image-gen model registry + the "a prompt result image is image-gen only" gate (schema + form descriptor).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { isImageGenModel, isImageGenTarget, IMAGE_GEN_MODELS } from '../client/src/image-models.mjs';
import { schemaFor } from '../client/src/schemas.mjs';
import { FIELDS, fieldsFor } from '../client/src/form-fields.mjs';

test('isImageGenModel matches known generators regardless of spacing/punctuation/version', () => {
  for (const m of ['Nano Banana', 'nano-banana', 'MidJourney', 'Midjourney v6', 'DALL-E 3', 'DALL·E', 'dalle', 'Stable Diffusion XL', 'Flux.1', 'Imagen 3', 'Ideogram']) {
    assert.equal(isImageGenModel(m), true, `${m} should be an image generator`);
  }
});

test('isImageGenModel rejects text models and junk', () => {
  for (const m of ['Claude', 'Claude Code', 'GPT-4o', 'Gemini', 'ChatGPT', '', null, undefined, 'banana bread']) {
    assert.equal(isImageGenModel(m), false, `${m} should not be an image generator`);
  }
});

test('isImageGenTarget is true when ANY target is a generator', () => {
  assert.equal(isImageGenTarget(['Claude', 'Nano Banana']), true);
  assert.equal(isImageGenTarget(['Claude', 'GPT-4o']), false);
  assert.equal(isImageGenTarget([]), false);
  assert.equal(isImageGenTarget(undefined), false);
});

test('every canonical display name is recognized by the matcher (self-consistency)', () => {
  for (const m of IMAGE_GEN_MODELS) assert.equal(isImageGenModel(m), true, `${m} listed but not matched`);
});

test('promptSchema rejects an image when no target is an image generator', () => {
  const schema = schemaFor('prompt');
  const base = { title: 'T', slug: 'a-slug', shortDescription: 'sd', author: 'naresh', image: 'members/naresh/images/x.webp' };
  assert.equal(schema.safeParse({ ...base, targets: ['Claude'] }).success, false);
  assert.equal(schema.safeParse({ ...base, targets: [] }).success, false);
  assert.equal(schema.safeParse({ ...base, targets: ['Nano Banana'] }).success, true);
  // No image => valid regardless of targets.
  assert.equal(schema.safeParse({ title: 'T', slug: 'a-slug', shortDescription: 'sd', author: 'naresh', targets: ['Claude'] }).success, true);
});

test('the prompt form image field is gated by a serializable showIf carrying the model list', () => {
  const img = FIELDS.prompt.find((f) => f.key === 'image');
  assert.ok(img, 'prompt form should offer an image field');
  assert.equal(img.kind, 'image');
  assert.equal(img.showIf?.field, 'targets');
  assert.ok(Array.isArray(img.showIf?.includesModel) && img.showIf.includesModel.includes('Nano Banana'));
  // form-fields mirrors the schema (drift guard already enforces keys; assert the parity copy too).
  assert.ok(fieldsFor('prompt').some((f) => f.key === 'image'));
});
