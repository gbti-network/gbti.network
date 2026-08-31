// sow-290: one local-image intake path for the document editor and Preview.
// Decisions stay pure below; only processImageFile touches browser decode/canvas APIs.
import { sanitizeImageName } from '../../src/lib/image-name.mjs';

export const IMAGE_MAX_BYTES = 1_048_576;
export const IMAGE_MAX_EDGE = 2400;
export const IMAGE_WEBP_QUALITY = 0.82;

const INPUT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const OUTPUT_EXT = {
  'image/jpeg': 'webp',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const INPUT_EXT_TYPE = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

export function imageMimeForFile(file) {
  const stated = String(file?.type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (INPUT_TYPES.has(stated)) return stated;
  const ext = String(file?.name || '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || '';
  return INPUT_EXT_TYPE[ext] || '';
}

export function isSupportedImage(file) {
  return Boolean(file && imageMimeForFile(file));
}

export function transferHasFiles(transfer) {
  if (!transfer) return false;
  const types = Array.from(transfer.types || []);
  return types.includes('Files') || Boolean(transfer.files?.length);
}

export function firstImageFile(transfer) {
  if (!transferHasFiles(transfer)) return null;
  const direct = Array.from(transfer.files || []).find(isSupportedImage);
  if (direct) return direct;
  for (const item of Array.from(transfer.items || [])) {
    if (item?.kind !== 'file') continue;
    const file = item.getAsFile?.();
    if (isSupportedImage(file)) return file;
  }
  return null;
}

export function shouldReencode({ type } = {}) {
  const mime = String(type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  return INPUT_TYPES.has(mime) && mime !== 'image/gif';
}

export function planReencode({ width, height, type } = {}) {
  const w = Number(width);
  const h = Number(height);
  const mime = String(type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  if (!INPUT_TYPES.has(mime) || !Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  if (mime === 'image/gif') {
    return { passthrough: true, width: Math.round(w), height: Math.round(h), outputType: mime, quality: null };
  }
  const scale = Math.min(1, IMAGE_MAX_EDGE / Math.max(w, h));
  return {
    passthrough: false,
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    outputType: mime === 'image/png' ? 'image/png' : 'image/webp',
    quality: mime === 'image/png' ? null : IMAGE_WEBP_QUALITY,
  };
}

const leafName = (value) => String(value || '').split(/[\\/]/).pop().toLowerCase();

export function outputNameFor(name, type, usedNames = []) {
  const clean = sanitizeImageName(name);
  const ext = OUTPUT_EXT[String(type || '').toLowerCase().replace('image/jpg', 'image/jpeg')];
  if (!clean || !ext) return null;
  const stem = clean.replace(/\.[^.]+$/, '');
  const used = new Set(Array.from(usedNames || [], leafName));
  let candidate = `${stem}.${ext}`;
  let copy = 2;
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-${copy}.${ext}`;
    copy += 1;
  }
  return candidate;
}

export function formatImageBytes(bytes) {
  const n = Math.max(0, Number(bytes) || 0);
  return n >= 1_048_576 ? `${(n / 1_048_576).toFixed(2)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;
}

function defaultCanvas(width, height) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  throw new Error('Image processing is not available in this browser.');
}

async function encodeCanvas(canvas, type, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type, ...(quality == null ? {} : { quality }) });
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('The browser could not encode this image.')),
      type, quality == null ? undefined : quality);
  });
}

export async function blobToBase64(blob) {
  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
      reader.onerror = () => reject(new Error('The processed image could not be read.'));
      reader.readAsDataURL(blob);
    });
  }
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

// Production CSP intentionally allows data: images but not blob: URLs. Build
// the transient preview from the processed bytes already sent to the stager so
// the editor can display it immediately without weakening that policy.
export function processedImageDataUrl(blob, dataBase64) {
  const type = String(blob?.type || '').toLowerCase().replace('image/jpg', 'image/jpeg');
  const payload = String(dataBase64 || '');
  if (!INPUT_TYPES.has(type) || !payload) {
    throw new Error('The processed image preview could not be created.');
  }
  return `data:${type};base64,${payload}`;
}

export async function processImageFile(file, {
  usedNames = [],
  decode = (value) => createImageBitmap(value),
  makeCanvas = defaultCanvas,
} = {}) {
  const type = imageMimeForFile(file);
  if (!type) throw new Error('Use a PNG, JPG, WebP, or GIF image.');
  const fallbackName = `pasted-image.${OUTPUT_EXT[type]}`;
  const sourceName = String(file?.name || '').trim() || fallbackName;
  const beforeBytes = Number(file?.size) || 0;

  if (type === 'image/gif') {
    if (beforeBytes > IMAGE_MAX_BYTES) {
      throw new Error('This animated GIF is over 1 MB. Compress it before uploading so its animation is preserved.');
    }
    const name = outputNameFor(sourceName, type, usedNames);
    if (!name) throw new Error('Use a PNG, JPG, WebP, or GIF image.');
    return {
      blob: file, name, type, width: null, height: null, beforeBytes, afterBytes: beforeBytes,
      reencoded: false,
      message: `Animated GIF kept unchanged at ${formatImageBytes(beforeBytes)}.`,
    };
  }

  let bitmap;
  try {
    bitmap = await decode(file);
  } catch {
    throw new Error('This image could not be decoded. No original bytes were uploaded.');
  }
  const plan = planReencode({ width: bitmap?.width, height: bitmap?.height, type });
  if (!plan) {
    bitmap?.close?.();
    throw new Error('This image had invalid dimensions. No original bytes were uploaded.');
  }

  let blob;
  try {
    const canvas = makeCanvas(plan.width, plan.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image processing is not available in this browser.');
    context.drawImage(bitmap, 0, 0, plan.width, plan.height);
    blob = await encodeCanvas(canvas, plan.outputType, plan.quality);
  } finally {
    bitmap?.close?.();
  }
  if (!blob || blob.size > IMAGE_MAX_BYTES) {
    const got = formatImageBytes(blob?.size || 0);
    throw new Error(`This image is still over 1 MB after processing (${got}). Choose a smaller image.`);
  }
  const name = outputNameFor(sourceName, plan.outputType, usedNames);
  if (!name) throw new Error('Use a PNG, JPG, WebP, or GIF image.');
  return {
    blob,
    name,
    type: plan.outputType,
    width: plan.width,
    height: plan.height,
    beforeBytes,
    afterBytes: blob.size,
    reencoded: true,
    message: `Processed ${formatImageBytes(beforeBytes)} to ${formatImageBytes(blob.size)}. Embedded metadata removed.`,
  };
}
