// SOW-062 Phase 5d: the ONE YouTube/Vimeo id-extractor, shared by the reader renderer (client/src/markdown.mjs),
// the Astro <VideoEmbed> component, and the rehype content-blocks plugin, so a body ```embed and the frontmatter
// `video:` field resolve identically everywhere. Returns a NORMALIZED provider embed URL (never author-supplied raw
// HTML), or null for anything that is not a recognized YouTube/Vimeo URL/id (the caller degrades to a plain link).
export function embedUrl(v) {
  const s = String(v || '').trim();
  let m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  if (/^[\w-]{11}$/.test(s)) return `https://www.youtube.com/embed/${s}`;
  if (/^\d+$/.test(s)) return `https://player.vimeo.com/video/${s}`;
  return null;
}
