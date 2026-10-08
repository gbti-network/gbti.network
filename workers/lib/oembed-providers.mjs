// SOW-102: provider oEmbed fallbacks for the share link preview. YouTube (and some other big providers)
// serve NO OpenGraph markup to a datacenter fetch, so the generic scrape in membership-og.mjs comes back
// empty for exactly the links members share most. Their public oEmbed APIs answer fine from the Worker
// (title + author + thumbnail, no API key), so a matched URL is previewed oEmbed-FIRST, with the generic
// scrape kept as the fallback. Pure + node-free: URL matching and JSON mapping only; the caller fetches.
//
// SSRF posture: the returned endpoint is a CONSTANT provider host with the member URL only ever carried as
// an encoded query value, so this adds no new fetch surface beyond youtube.com / vimeo.com / app.mixcloud.com.
//
// sow-417: Mixcloud joins them. Its mix pages DO carry og:image, but they do not answer the Worker: on 2026-09-26 the
// live preview returned `reason: 'unreachable'` for a mix whose page served og:image to a laptop and to the GitHub
// Actions cover job, so the owner's share published with no picture until that job filled it in. Its oEmbed answers
// with the cover, under the key `image` rather than the standard `thumbnail_url`, which previewFromOembed reads too.

/** The oEmbed endpoint URL for a supported provider link, or null when the URL is not a match.
 *  YouTube: watch?v=, youtu.be/<id>, shorts/live/embed/<id>. Vimeo: vimeo.com/<digits>. */
export function oembedEndpointFor(rawUrl) {
  let u;
  try { u = new URL(String(rawUrl || '')); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\.|^m\./, '');
  const enc = encodeURIComponent(u.toString());

  if (host === 'youtube.com' || host === 'music.youtube.com') {
    const watch = u.pathname === '/watch' && u.searchParams.get('v');
    const pathId = /^\/(shorts|live|embed)\/[\w-]{6,}/.test(u.pathname);
    if (watch || pathId) return `https://www.youtube.com/oembed?url=${enc}&format=json`;
    return null;
  }
  if (host === 'youtu.be') {
    if (/^\/[\w-]{6,}$/.test(u.pathname)) return `https://www.youtube.com/oembed?url=${enc}&format=json`;
    return null;
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    if (/^\/(video\/)?\d{6,}/.test(u.pathname)) return `https://vimeo.com/api/oembed.json?url=${enc}`;
    return null;
  }
  // sow-417: a mix (/<user>/<mix>/) or a profile (/<user>/). www.mixcloud.com/oembed/ only redirects here.
  if (host === 'mixcloud.com') {
    if (/^\/[^/]+\/(?:[^/]+\/?)?$/.test(u.pathname)) return `https://app.mixcloud.com/oembed/?url=${enc}&format=json`;
    return null;
  }
  return null;
}

/** sow-417: Mixcloud's oEmbed names a 600x600 cover from its thumbnailer, which serves any size from one path.
 *  1200x1200 clears the minimum-width floor some scrapers apply (the same reason YouTube is upsized below), and the
 *  thumbnailer answers it for every cover, so no confirming request is needed. Anything else is returned as is. */
export function largeMixcloudImage(imageUrl) {
  let u;
  try { u = new URL(String(imageUrl || '')); } catch { return imageUrl; }
  if (u.protocol !== 'https:' || u.hostname !== 'thumbnailer.mixcloud.com') return imageUrl;
  u.pathname = u.pathname.replace(/^\/unsafe\/\d+x\d+\//, '/unsafe/1200x1200/');
  return u.toString();
}

/** Map an oEmbed JSON response onto the preview shape membership-og returns ({ image, title, description,
 *  tags, creatorUrl, creatorName, siteName }). The description is a factual by-line (oEmbed carries no description
 *  field); tags stay empty so the topic suggester works from the title alone. Returns null when the JSON has
 *  no usable title/thumb.
 *
 *  sow-222: `author_url` is the CHANNEL, and it was read from this response and dropped for a year while the
 *  by-line beside it was kept. A YouTube or Vimeo link carries its creator nowhere in the url, so this is the
 *  only chance to learn it, and the share stores it at publish time. https only: it ends up as an href. */
export function previewFromOembed(json) {
  const j = json && typeof json === 'object' ? json : {};
  const title = typeof j.title === 'string' && j.title.trim() ? j.title.trim() : null;
  // sow-417: `thumbnail_url` is the standard key; Mixcloud uses `image` for the same thing.
  const httpsStr = (v) => (typeof v === 'string' && /^https:\/\//.test(v) ? v : null);
  const image = httpsStr(j.thumbnail_url) || largeMixcloudImage(httpsStr(j.image)) || null;
  if (!title && !image) return null;
  const author = typeof j.author_name === 'string' && j.author_name.trim() ? j.author_name.trim() : null;
  const provider = typeof j.provider_name === 'string' && j.provider_name.trim() ? j.provider_name.trim() : null;
  // The oEmbed type is a noun only for video and photo. Mixcloud answers "rich", and "A rich by Dms519" is not a
  // sentence, so a mix is called a mix and any other rich or link answer drops the noun.
  const type = typeof j.type === 'string' ? j.type.trim() : '';
  const kind = type === 'video' || type === 'photo' ? type : (provider === 'Mixcloud' ? 'mix' : null);
  const description = author
    ? (kind ? `A ${kind} by ${author}${provider ? ` on ${provider}` : ''}` : `By ${author}${provider ? ` on ${provider}` : ''}`)
    : null;
  const creatorUrl = typeof j.author_url === 'string' && /^https:\/\//.test(j.author_url.trim()) ? j.author_url.trim() : null;
  // sow-445: the provider is the publication a share's link card names ("| YouTube"); null when it is not stated.
  return { image, title, description, tags: [], creatorUrl, creatorName: author, siteName: provider };
}

/** YouTube's oEmbed only ever hands back the 480x360 `hqdefault` thumbnail. That is under the minimum-width
 *  floor several scrapers apply before they will use an image at all, so a shared link previews with the
 *  video thumbnail on X and with nothing on daily.dev. The same video usually also has a 1280x720
 *  `maxresdefault` at a predictable path, but ONLY when it was uploaded at 720p or above: YouTube answers
 *  404 for the rest, and there is no field in the oEmbed response that says which.
 *
 *  So this returns the CANDIDATE url and nothing more. The caller must confirm it with a request before
 *  swapping it in, and keep the original when the check does not come back OK. Returns null for a URL that
 *  is not a recognized YouTube thumbnail, including one already at maxres. */
export function maxresThumbCandidate(thumbUrl) {
  let u;
  try { u = new URL(String(thumbUrl || '')); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const host = u.hostname.toLowerCase().replace(/^www\./, '');
  if (host !== 'i.ytimg.com' && host !== 'i9.ytimg.com' && host !== 'img.youtube.com') return null;
  const m = /^\/vi\/([\w-]+)\/(hqdefault|sddefault|mqdefault|default)\.jpg$/.exec(u.pathname);
  if (!m) return null;
  return `https://i.ytimg.com/vi/${m[1]}/maxresdefault.jpg`;
}
