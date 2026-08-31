const WEB_IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|gif)$/;

export function sanitizeImageName(filename) {
  const base = String(filename ?? '').trim().toLowerCase().split(/[\\/]/).pop() || '';
  const cleaned = base.replace(/[^a-z0-9._-]+/g, '-').replace(/^[.-]+/, '').replace(/-+/g, '-');
  if (!/^[a-z0-9]/.test(cleaned) || !WEB_IMAGE_EXT_RE.test(cleaned)) return null;
  return cleaned;
}
