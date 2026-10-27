// sow-483 Phase 3: the WorkBench's staged recordings, on the Worker's /membership/draft-audio route
// (workers/signup/membership-draft-audio.mjs). A recording is uploaded once, as raw bytes, when the author picks it in the
// podcast block; the publish then names it and the Worker commits it, so 20 MB never rides inside the publish request.
// Its own module so workbench-client.ts stays under the line cap; bound to the client's Worker origin like the transport.
import { readCsrf } from './workbench-client-transport';

export function createAudioStaging(base: string) {
  const q = (name: string, item: string) => `name=${encodeURIComponent(name)}&item=${encodeURIComponent(item)}`;

  /** PUT the file's bytes, reporting progress from 0 to 1. Resolves `{ name, bytes }`; rejects with the Worker's words. */
  function stageAudio({ file, name, item, onProgress }: { file: Blob; name: string; item: string; onProgress?: (p: number) => void }): Promise<{ name: string; bytes: number }> {
    return new Promise((resolve, reject) => {
      // XMLHttpRequest rather than fetch: fetch reports no upload progress, and a 20 MB upload needs some.
      const xhr = new XMLHttpRequest();
      xhr.open('PUT', `${base}/membership/draft-audio?${q(name, item)}`);
      xhr.withCredentials = true;
      const csrf = readCsrf();
      if (csrf) xhr.setRequestHeader('X-GBTI-CSRF', csrf);
      xhr.setRequestHeader('Content-Type', name.endsWith('.ogg') ? 'audio/ogg' : 'audio/mpeg');
      xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total); };
      xhr.onload = () => {
        let body: any = null;
        try { body = JSON.parse(xhr.responseText); } catch { body = null; }
        if (xhr.status >= 200 && xhr.status < 300 && body?.ok) resolve({ name: body.name, bytes: Number(body.bytes) || file.size });
        else reject(new Error(body?.message || `The upload did not finish (the server answered ${xhr.status}).`));
      };
      xhr.onerror = () => reject(new Error('The upload stopped. Check the connection, then choose the file again.'));
      xhr.send(file);
    });
  }

  /** The size of a staged recording, or null when none is staged under that item and name. Never throws. */
  async function stagedAudioBytes(name: string, item: string): Promise<number | null> {
    try {
      const r = await fetch(`${base}/membership/draft-audio?${q(name, item)}&meta=1`, { credentials: 'include' });
      if (!r.ok) return null;
      const body = await r.json();
      return body?.ok ? Number(body.bytes) || 0 : null;
    } catch {
      return null;
    }
  }

  /** Drop a staged recording once it is published. Best effort: a leftover key expires on its own after 30 days. */
  async function deleteStagedAudio(name: string, item: string): Promise<void> {
    const csrf = readCsrf();
    try {
      await fetch(`${base}/membership/draft-audio?${q(name, item)}`, { method: 'DELETE', credentials: 'include', headers: csrf ? { 'X-GBTI-CSRF': csrf } : {} });
    } catch { /* see above */ }
  }

  return { stageAudio, stagedAudioBytes, deleteStagedAudio };
}
