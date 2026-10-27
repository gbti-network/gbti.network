// sow-483 Phase 3: the staged-recording store's pure half (keys, names, validation, quota), beside draft-images.mjs and
// shaped like it. No KV, no network, no secrets; workers/signup/membership-draft-audio.mjs does the IO.
//
// A recording is uploaded ONCE, when the author picks it in the WorkBench, as raw bytes under the member's own key, and
// the publish names it rather than carrying it: the Worker reads the key and commits the file (owner, 2026-10-27, the
// sow-483 plan). Sending 20 MB through the browser a second time inside the publish request is what this avoids. The
// key is built from the AUTHENTICATED github_id, the item it belongs to, and a sanitized name, so one member cannot
// address another member's recording.

import { itemTokenOf } from './draft-images.mjs';

export { itemTokenOf };

/** One recording per key: about an hour of speech as MP3 (owner, 2026-10-27), inside KV's 25 MiB value limit. */
export const DRAFT_AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** Per-member ceilings, so the staging area cannot be used as free audio hosting. */
export const DRAFT_AUDIO_MAX_COUNT = 6;
export const DRAFT_AUDIO_MAX_TOTAL_BYTES = 80 * 1024 * 1024;
/** A staged recording that is never published goes away on its own after 30 days. */
export const DRAFT_AUDIO_TTL_SECONDS = 30 * 24 * 60 * 60;

export class DraftAudioError extends Error {}

/** The KV key prefix for one member's staged recordings (also the list() prefix for quota and erasure). */
export const draftAudioPrefix = (githubId) => `draftaudio:${String(githubId)}:`;
/** `draftaudio:<github_id>:<type>:<slug>:<name>`. `item` and `name` must already be validated. */
export const draftAudioKey = (githubId, item, name) => `${draftAudioPrefix(githubId)}${item}:${name}`;

/** What a committed recording may be called: lowercase letters, digits, - and _, then .mp3 or .ogg. */
export const AUDIO_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}\.(mp3|ogg)$/;

/** The validated recording name, or null. */
export function audioNameOf(name) {
  const n = String(name ?? '').trim();
  return AUDIO_NAME_RE.test(n) ? n : null;
}

export const audioContentType = (name) => (/\.ogg$/.test(String(name)) ? 'audio/ogg' : 'audio/mpeg');

/**
 * Do the bytes start like the named kind of file? An Ogg file opens with `OggS`; an MP3 with an ID3 tag or an MPEG
 * audio frame header (eleven set bits). A renamed WAV or video is refused here rather than published as a player
 * that never plays.
 */
export function looksLikeAudio(bytes, name) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  if (b.length < 4) return false;
  if (/\.ogg$/.test(String(name))) return b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53;
  const id3 = b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33;
  const frame = b[0] === 0xff && (b[1] & 0xe0) === 0xe0;
  return id3 || frame;
}

/** Throws DraftAudioError when one more recording (replacing `id` if it is already staged) would pass a ceiling. */
export function checkDraftAudioQuota(existing, { id, bytes } = {}) {
  const others = (existing || []).filter((e) => e && e.id !== id);
  if (others.length + 1 > DRAFT_AUDIO_MAX_COUNT) {
    throw new DraftAudioError(`You have ${others.length} recordings waiting to be published. Publish or discard one of those drafts first.`);
  }
  const total = others.reduce((n, e) => n + (Number(e.bytes) || 0), 0) + (Number(bytes) || 0);
  if (total > DRAFT_AUDIO_MAX_TOTAL_BYTES) {
    throw new DraftAudioError('Your staged recordings are at their limit. Publish or discard a draft first.');
  }
  return { count: others.length + 1, totalBytes: total };
}

/** The checks one upload passes before it is stored: a valid item and name, a size within the cap, and audio bytes. */
export function validateDraftAudio({ item, name, bytes }) {
  const it = itemTokenOf(item);
  if (!it) throw new DraftAudioError('A recording belongs to an article, project or prompt; that item was not recognized.');
  const n = audioNameOf(name);
  if (!n) throw new DraftAudioError('A recording is an MP3 or Ogg file named with lowercase letters, digits, - and _.');
  const size = bytes?.byteLength ?? 0;
  if (!size) throw new DraftAudioError('That file is empty.');
  if (size > DRAFT_AUDIO_MAX_BYTES) throw new DraftAudioError('That file is over 20 MB. Export it at a lower bitrate, then choose it again.');
  if (!looksLikeAudio(bytes, n)) throw new DraftAudioError(`That file is not ${/\.ogg$/.test(n) ? 'an Ogg' : 'an MP3'} recording. Export it as MP3, then choose it again.`);
  return { item: it, name: n, bytes: size };
}
