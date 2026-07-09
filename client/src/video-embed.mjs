// SOW-062 Phase 5d: the ONE video id-extractor, shared by the reader renderer (client/src/markdown.mjs),
// the Astro <VideoEmbed> component, the rehype content-blocks plugin, and (SOW-092) the share views, so a
// body ```embed, the frontmatter `video:` field, and a shared video link resolve identically everywhere.
// Returns a NORMALIZED provider embed URL (never author-supplied raw HTML), or null for anything that is
// not recognized (the caller degrades to a plain link / the share image).
// Providers: YouTube, Vimeo, TikTok, Rumble. Rumble is embeddable ONLY from a rumble.com/embed/<code> URL
// (the watch page's v-code is a different id that cannot be derived client-side), so a Rumble watch URL
// returns null and falls back to the image + link.
export function embedUrl(v) {
  const s = String(v || '').trim();
  let m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}`;
  m = s.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (m) return `https://player.vimeo.com/video/${m[1]}`;
  m = s.match(/tiktok\.com\/@[\w.-]+\/video\/(\d+)/);
  if (m) return `https://www.tiktok.com/embed/v2/${m[1]}`;
  m = s.match(/rumble\.com\/embed\/([a-z0-9]+)/i);
  if (m) return `https://rumble.com/embed/${m[1]}/`;
  if (/^[\w-]{11}$/.test(s)) return `https://www.youtube.com/embed/${s}`;
  if (/^\d+$/.test(s)) return `https://player.vimeo.com/video/${s}`;
  return null;
}

/** SOW-092: portrait providers (TikTok) render in a tall 9:16 frame instead of the default 16:9. */
export function isPortraitEmbed(src) {
  return /tiktok\.com\/embed\//.test(String(src || ''));
}
