// Canonical registry of image-generation models (SOW-006 follow-up). Single source of truth for the
// question "is this prompt target an image generator?", shared by the client schemas, the authoring
// form descriptors (so the image-upload field is offered only for image-gen prompts), the build-time
// content validator, and the Astro content schema. A prompt may carry a result `image` ONLY when at
// least one of its `targets` is an image generator (Nano Banana, MidJourney, and the rest below).
//
// `targets` are free-form strings (e.g. "Midjourney v6", "DALL-E 3", "Stable Diffusion XL"), so we
// match by normalized substring against the canonical tokens rather than by exact equality.

// Display-friendly canonical names (used for documentation / any UI listing).
export const IMAGE_GEN_MODELS = Object.freeze([
  'Nano Banana',
  'MidJourney',
  'DALL-E',
  'Stable Diffusion',
  'Flux',
  'Imagen',
  'Ideogram',
  'Leonardo',
  'Firefly',
  'Recraft',
  'Qwen Image',
  'Seedream',
]);

// Normalized tokens we look for inside a target string (lowercase, alphanumerics only). Includes the
// common spellings/aliases that normalize to the same token (e.g. "DALL·E", "DALL-E", "DALLE" -> "dalle").
const MODEL_TOKENS = Object.freeze([
  'nanobanana',
  'midjourney',
  'dalle',
  'stablediffusion',
  'flux',
  'imagen',
  'ideogram',
  'leonardo',
  'firefly',
  'recraft',
  'qwenimage',
  'seedream',
]);

/** Normalize a target string to lowercase alphanumerics so spacing/punctuation/version suffixes do not matter. */
function normalize(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** True when a single target string names an image generator. */
export function isImageGenModel(target) {
  const n = normalize(target);
  if (!n) return false;
  return MODEL_TOKENS.some((tok) => n.includes(tok));
}

/** True when ANY of a prompt's targets is an image generator. Accepts an array (or undefined). */
export function isImageGenTarget(targets) {
  return Array.isArray(targets) && targets.some(isImageGenModel);
}
