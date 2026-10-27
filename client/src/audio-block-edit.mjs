// sow-483 Phase 2 (owner, 2026-10-27, "A, one form"): the WorkBench edits an ```audio block through a form, and the form
// changes the fence one line at a time. These pure helpers do that editing, so a line nobody touched is never rewritten
// and a block nobody changed is written back byte for byte as it was read. Shared by the form
// (client-ui/src/audio-block-ui.mjs) and test/audio-block-edit.test.mjs.
import { AUDIO_PROVIDERS, PROVIDER_NAMES, audioEmbed, embedProblem } from './audio-embed.mjs';

/** The Source choices, in the order the form shows them. An upload is written as a `src:` line. */
export const AUDIO_SOURCES = ['upload', ...AUDIO_PROVIDERS];
export const SOURCE_NAMES = { upload: 'Upload', ...PROVIDER_NAMES };
const SOURCE_KEYS = ['src', ...AUDIO_PROVIDERS];
const keyFor = (kind) => (kind === 'upload' ? 'src' : kind);

/** About an hour of speech as MP3 (owner, 2026-10-27: "about 20 MB per file"). */
export const AUDIO_MAX_BYTES = 20 * 1024 * 1024;
/** What an upload may be. An .opus file is Opus in an Ogg container and is stored as .ogg (see AUDIO_SRC_RE). */
export const AUDIO_EXTS = ['mp3', 'ogg', 'opus'];

// Where a NEW line goes. A line that already exists keeps its place.
const LINE_ORDER = ['style', 'length', ...SOURCE_KEYS, 'link', 'link-label'];

// The same reading as content-blocks.mjs keyValue(): the key is everything before the first colon.
const keyOf = (line) => { const i = String(line).indexOf(':'); return i > 0 ? line.slice(0, i).trim().toLowerCase() : null; };
const valueOf = (line) => String(line).slice(String(line).indexOf(':') + 1).trim();

/** The label from the fence's info string (`audio Listen to the podcast version` gives the words after `audio`). */
export function audioLabelOf(lang) {
  return String(lang ?? '').replace(/^audio(\s+|$)/, '');
}

/** The info string with a new label. An empty label leaves bare `audio`, which shows the site's default. */
export function setAudioLabel(lang, label) {
  const v = String(label ?? '').replace(/\s+/g, ' ').trim();
  if (v === audioLabelOf(lang).replace(/\s+/g, ' ').trim()) return String(lang ?? '') || 'audio';
  return v ? `audio ${v}` : 'audio';
}

/** The value of the first `key:` line, or ''. */
export function audioLineValue(body, key) {
  const k = String(key).toLowerCase();
  const line = String(body ?? '').split('\n').find((l) => keyOf(l) === k);
  return line === undefined ? '' : valueOf(line);
}

/**
 * The body with one key set. The first line with that key is rewritten where it stands (left exactly as it was when the
 * value is unchanged), any later line with the same key goes, and an empty value removes the key. A new key is placed
 * in the usual order. Every other line, including one the form does not know, is kept as written.
 */
export function setAudioLine(body, key, value) {
  const k = String(key).toLowerCase();
  const v = String(value ?? '').replace(/\s*\n\s*/g, ' ').trim();
  const lines = String(body ?? '') === '' ? [] : String(body).split('\n');
  const first = lines.findIndex((l) => keyOf(l) === k);
  const out = [];
  lines.forEach((l, i) => {
    if (keyOf(l) !== k) out.push(l);
    else if (i === first && v) out.push(valueOf(l) === v ? l : `${k}: ${v}`);
  });
  if (first < 0 && v) {
    const rank = LINE_ORDER.indexOf(k);
    const at = out.findIndex((l) => LINE_ORDER.indexOf(keyOf(l)) > rank);
    out.splice(at < 0 ? out.length : at, 0, `${k}: ${v}`);
  }
  return out.join('\n');
}

/** The block's source: `{ kind, value }` from its first source line, or null when it has none. */
export function audioSourceOf(body) {
  for (const l of String(body ?? '').split('\n')) {
    const k = keyOf(l);
    if (SOURCE_KEYS.includes(k)) return { kind: k === 'src' ? 'upload' : k, value: valueOf(l) };
  }
  return null;
}

/** The body with exactly one source: this kind's line is set where it stands, and every other source line goes. */
export function setAudioSource(body, kind, value) {
  const key = keyFor(kind);
  let out = setAudioLine(body, key, value);
  for (const k of SOURCE_KEYS) if (k !== key) out = setAudioLine(out, k, '');
  return out;
}

/**
 * The line under a provider's link field: `{ ok, text, page }`, or null while the field is empty. Recognized, it names
 * the service and what the link is (a track, a playlist, an episode, a show); otherwise it says what was pasted.
 */
export function audioLinkNote(provider, value) {
  const v = String(value ?? '').trim();
  if (!v) return null;
  const e = audioEmbed(provider, v);
  if (!e) return { ok: false, text: embedProblem(provider, v) };
  const name = PROVIDER_NAMES[provider];
  const where = provider === 'apple' ? 'the Apple Podcasts player' : `${name}'s own player`;
  return { ok: true, text: `${/^[AEIOU]/.test(name) ? 'An' : 'A'} ${name} ${e.kind}. It plays in ${where}.`, page: e.page };
}

/** 7.9 MB, 231 MB, 512 KB: binary units, as Windows and most file pickers show them. */
export function formatBytes(n) {
  const b = Math.max(0, Number(n) || 0);
  if (b < 1024 * 1024) return `${Math.max(1, Math.round(b / 1024))} KB`;
  const mb = b / (1024 * 1024);
  return `${mb < 100 ? mb.toFixed(1).replace(/\.0$/, '') : Math.round(mb)} MB`;
}

// The recordings an author is likely to have instead, with the article each name takes.
const OTHER_FORMATS = { wav: 'a WAV', m4a: 'an M4A', m4b: 'an M4B', aac: 'an AAC', flac: 'a FLAC', aif: 'an AIFF', aiff: 'an AIFF',
  wma: 'a WMA', webm: 'a WebM', mp4: 'an MP4', mov: 'a QuickTime', amr: 'an AMR' };

/** The file's extension, lower case, or ''. */
export const audioExt = (name) => ((/\.([A-Za-z0-9]+)$/.exec(String(name ?? '')) || [])[1] || '').toLowerCase();

/**
 * Why a picked file cannot be used, as `{ title, name, rest }` (the form shows the name in mono, then the rest), or null
 * when it is an MP3 or Ogg recording within the limit.
 */
export function audioFileProblem({ name, size } = {}) {
  const ext = audioExt(name);
  const okFormat = AUDIO_EXTS.includes(ext);
  const tooBig = Number(size) > AUDIO_MAX_BYTES;
  if (okFormat && !tooBig) return null;
  const file = String(name ?? '') || 'This file';
  const what = OTHER_FORMATS[ext] ? `is ${OTHER_FORMATS[ext]} recording` : 'is a kind of file the player cannot play';
  const title = tooBig ? `This file is ${formatBytes(size)}. The limit is 20 MB.` : 'The player takes MP3 or Ogg files.';
  const rest = okFormat
    ? ' can be exported again at a lower bitrate, such as 64 kbps for speech. Then choose it again.'
    : ` ${what}. Export it as MP3, then choose it again.`;
  return { title, name: file, rest };
}

/**
 * The name a picked file is stored and committed under: lowercase, every other run of characters a hyphen, at most 60
 * characters before the extension. An .opus file is Opus in an Ogg container and becomes .ogg, the extension the site
 * serves with byte ranges (content-blocks.mjs AUDIO_SRC_RE). Null for any other kind of file. The Worker accepts exactly
 * these names (membership/draft-audio.mjs AUDIO_NAME_RE).
 */
export function stagedAudioName(fileName) {
  const m = /^(.*)\.([A-Za-z0-9]+)$/.exec(String(fileName ?? '').split(/[\\/]/).pop() || '');
  if (!m) return null;
  const ext = { mp3: 'mp3', ogg: 'ogg', opus: 'ogg' }[m[2].toLowerCase()];
  if (!ext) return null;
  const stem = m[1].toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^[-_]+|[-_]+$/g, '').slice(0, 60).replace(/[-_]+$/, '');
  return `${stem || 'recording'}.${ext}`;
}

/** The Length words for a duration in seconds ("22 minutes", "1 hour 5 minutes"), or '' when it is unknown. */
export function lengthWords(seconds) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return '';
  if (s < 60) return `${Math.round(s)} seconds`;
  const m = Math.round(s / 60);
  if (m < 60) return m === 1 ? '1 minute' : `${m} minutes`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return `${h} hour${h > 1 ? 's' : ''}${r ? ` ${r} minute${r > 1 ? 's' : ''}` : ''}`;
}
