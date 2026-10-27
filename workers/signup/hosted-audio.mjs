// sow-483 Phase 3: a publish names its recordings rather than carrying them (membership/hosted-author.mjs validates the
// reference). This turns each reference into the base64 entry commitHostedFiles writes, so a 20 MB recording crosses
// the browser once, when it is picked, and never inside the publish request:
//   { path, stagedAudio: { item, name } }  -> the caller's OWN staged copy (draftaudio:<their github_id>:...)
//   { path, copyFrom }                     -> a recording already on main, for an item that moved (rename or reassignment)
// Every other entry passes through untouched. Injectable (kv, fetch) so it unit-tests with fakes.

import { readStagedAudioBase64 } from './membership-draft-audio.mjs';
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

/** `{ ok: true, files }` with every recording reference replaced by its bytes, or `{ ok: false, status, message }`. */
export async function resolveAudioEntries({ files, kv, githubId, fetchImpl, instToken, upstream }) {
  const out = [];
  for (const f of files || []) {
    const name = String(f?.path ?? '').split('/').pop();
    if (f && f.stagedAudio !== undefined) {
      const b64 = await readStagedAudioBase64(kv, githubId, f.stagedAudio.item, f.stagedAudio.name);
      if (!b64) return { ok: false, status: 409, message: `The recording ${name} is no longer staged. Choose it again in the podcast block, then publish.` };
      out.push({ path: f.path, contentBase64: b64 });
    } else if (f && f.copyFrom !== undefined) {
      const b64 = await readMainBase64({ fetchImpl, instToken, upstream, path: f.copyFrom });
      if (!b64) return { ok: false, status: 409, message: `The recording ${name} could not be found where the item used to be. Choose it again in the podcast block, then publish.` };
      out.push({ path: f.path, contentBase64: b64 });
    } else out.push(f);
  }
  return { ok: true, files: out };
}
