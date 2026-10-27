// sow-483 Phase 3: a publish names its recordings rather than carrying them (membership/hosted-author.mjs validates the
// reference). checkAudioEntries confirms each one before the branch is touched; resolveAudioEntry turns it into the
// base64 entry commitHostedFiles writes, one at a time, so a 20 MB recording crosses the browser once, when it is
// picked, and never inside the publish request:
//   { path, stagedAudio: { item, name } }  -> the caller's OWN staged copy (draftaudio:<their github_id>:...)
//   { path, copyFrom }                     -> a recording already on main, for an item that moved (rename or reassignment)
// Every other entry passes through untouched. Injectable (kv, fetch) so it unit-tests with fakes.

import { readStagedAudioBase64, listStagedAudio } from './membership-draft-audio.mjs';
import { draftAudioKey, itemTokenOf, audioNameOf } from '../../membership/draft-audio.mjs';
import { GH_HEADERS, ghJson } from './hosted-commit.mjs';

const GH = 'https://api.github.com';

/**
 * Read a committed file's bytes from main as base64. The contents call returns no content past 1 MB (it answers
 * `encoding: none`, measured 2026-10-27 on a 20 MiB file), so the sha it does return is read from the blob API, which
 * serves up to 100 MB.
 */
export async function readMainBase64({ fetchImpl, instToken, upstream, path }) {
  const meta = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/${path}?ref=main`, { headers: GH_HEADERS(instToken) });
  if (!meta.res.ok || !meta.data?.sha || Array.isArray(meta.data)) return null;
  if (meta.data.content && meta.data.encoding === 'base64') return String(meta.data.content).replace(/\s+/g, '');
  const blob = await ghJson(fetchImpl, `${GH}/repos/${upstream}/git/blobs/${meta.data.sha}`, { headers: GH_HEADERS(instToken) });
  if (!blob.res.ok || blob.data?.encoding !== 'base64' || typeof blob.data?.content !== 'string') return null;
  return blob.data.content.replace(/\s+/g, '');
}

/**
 * Check every recording reference BEFORE the branch is touched, cheaply: a staged copy by its key's metadata (no bytes
 * fetched), a moved recording by its sha on main. `{ ok: true }`, or `{ ok: false, status, message }` naming the file.
 */
export async function checkAudioEntries({ files, kv, githubId, fetchImpl, instToken, upstream }) {
  const refs = (files || []).filter((f) => f && (f.stagedAudio !== undefined || f.copyFrom !== undefined));
  if (!refs.length) return { ok: true };
  const staged = refs.some((f) => f.stagedAudio !== undefined) ? new Set((await listStagedAudio(kv, githubId)).map((x) => x.key)) : new Set();
  for (const f of refs) {
    const name = String(f.path).split('/').pop();
    if (f.stagedAudio !== undefined) {
      const item = itemTokenOf(f.stagedAudio.item);
      const n = audioNameOf(f.stagedAudio.name);
      if (!item || !n || !staged.has(draftAudioKey(githubId, item, n))) {
        return { ok: false, status: 409, message: `The recording ${name} is no longer staged. Choose it again in the podcast block, then publish.` };
      }
    } else {
      const meta = await ghJson(fetchImpl, `${GH}/repos/${upstream}/contents/${f.copyFrom}?ref=main`, { headers: GH_HEADERS(instToken) });
      if (!meta.res.ok || !meta.data?.sha) {
        return { ok: false, status: 409, message: `The recording ${name} could not be found where the item used to be. Choose it again in the podcast block, then publish.` };
      }
    }
  }
  return { ok: true };
}

/**
 * One entry as it is written: a recording reference becomes `{ path, contentBase64 }` (the caller's OWN staged copy, or
 * the bytes on main for a moved item), anything else is returned as it is. Null when the bytes cannot be read. Used as
 * commitHostedFiles' resolveFile, so recordings are read one at a time.
 */
export async function resolveAudioEntry(f, { kv, githubId, fetchImpl, instToken, upstream }) {
  if (f && f.stagedAudio !== undefined) {
    const b64 = await readStagedAudioBase64(kv, githubId, f.stagedAudio.item, f.stagedAudio.name);
    return b64 ? { path: f.path, contentBase64: b64 } : null;
  }
  if (f && f.copyFrom !== undefined) {
    const b64 = await readMainBase64({ fetchImpl, instToken, upstream, path: f.copyFrom });
    return b64 ? { path: f.path, contentBase64: b64 } : null;
  }
  return f;
}
