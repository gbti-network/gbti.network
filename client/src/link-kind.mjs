// sow-417: what kind of thing a shared link points at, so its button says the right verb. Pure and node-free, the
// shape of ./video-embed.mjs and ./share-source.mjs, so the website share page and the extension (reader and Shares
// feed) make ONE decision instead of three.
//
// WHY. Every link that was not a recognised video said "Read article", and a DJ's mix shared from Mixcloud is not an
// article. Owner, 2026-09-26: "for shares from mixcloud and other known audio website that highlight musicians we need
// it to say 'Listen to...' rather than 'Read...'". The owner picked the wording ("Listen to it on mixcloud.com") and
// all four groups of sites below.
//
// WORDS ONLY. This decides what the button says and nothing else. A YouTube Music link still plays inline through
// embedUrl() exactly as before; it just says Listen, because what is on the other end is music.
//
// FAIL TO "read". An unknown, malformed or non-http link reads as it always did, so the list can only ever change the
// wording of the hosts it names.
import { embedUrl } from './video-embed.mjs';

/**
 * The audio hosts, each matching itself and its true subdomains (so every <artist>.bandcamp.com, open.spotify.com,
 * listen.tidal.com and link.deezer.com count, and mixcloud.com.example.net does not). Apple and YouTube are listed by
 * their audio subdomain only, because apple.com and youtube.com are mostly not audio.
 */
export const AUDIO_HOSTS = Object.freeze([
  // Music for artists: where musicians and DJs publish their own work.
  'mixcloud.com', 'soundcloud.com', 'bandcamp.com', 'audiomack.com',
  // Streaming catalogs (Spotify covers its podcast episodes too; spotify.link is its short link).
  'spotify.com', 'spotify.link', 'music.apple.com', 'tidal.com', 'deezer.com',
  // YouTube Music.
  'music.youtube.com',
  // Podcasts (pca.st is Pocket Casts' short link).
  'podcasts.apple.com', 'pocketcasts.com', 'pca.st', 'overcast.fm',
]);

function hostOf(raw) {
  let u;
  try { u = new URL(String(raw ?? '').trim()); } catch { return null; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  return u.hostname.toLowerCase().replace(/\.$/, '').replace(/^(?:www|m)\./, '');
}

/** Whether a link points at one of the audio hosts above. */
export function isAudioLink(url) {
  const host = hostOf(url);
  if (!host) return false;
  return AUDIO_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

/** 'audio', 'video' or 'read'. Audio is checked first, so a YouTube Music link says Listen rather than Watch. */
export function linkKind(url) {
  if (isAudioLink(url)) return 'audio';
  if (embedUrl(url)) return 'video';
  return 'read';
}

/** The extension's words for a share's outbound link, before " on <host>". The website page keeps its own. */
export function shareLinkVerb(url) {
  return { audio: 'Listen to it', video: 'Watch video', read: 'Read article' }[linkKind(url)];
}
