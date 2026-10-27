// sow-483 Phase 3: which uploaded recordings one publish commits, and how. Pure: the caller (the website's publish,
// src/lib/workbench-client-publish.ts) supplies the two lookups, so every branch is tested in node.
//
// The recordings are the ones the body's ```audio blocks name as `./audio/<file>`, in the PUBLIC part only: a members
// item, or a block below the members-only marker, is encrypted, and a recording beside it would sit in the public
// repository as plain bytes, so it is left out (the podcast form tells the author why). Each one is
//   staged       -> a reference the Worker resolves from the member's own store (the bytes never ride in the request)
//   on main      -> nothing to send
//   moved        -> on main beside the OLD item: copied by reference, and deleted there
//   none of them -> the publish is refused, with words the author can act on
import { audioUploadNames } from './content-blocks.mjs';
import { MEMBER_MARKER } from './member-content.mjs';

const audioDirOf = (indexPath) => `${String(indexPath).replace(/\/[^/]*$/, '')}/audio`;

/**
 * `{ files, cleanup }` (entries to add to the publish, and the staged copies to delete once it succeeds), or
 * `{ refuse }` with the message to show. `itemTokens` is the draft's `<type>:<slug>` first, then any earlier slug.
 */
export async function planPublishAudio({ body, visibility, builtPath, oldPath = null, moved = false, itemTokens = [] }, { stagedBytes, onMain }) {
  const publicBody = String(visibility || 'public') === 'members' ? '' : String(body ?? '').split(MEMBER_MARKER)[0];
  const audioDir = audioDirOf(builtPath);
  const oldDir = moved && oldPath ? audioDirOf(oldPath) : null;
  const files = [];
  const cleanup = [];
  for (const name of audioUploadNames(publicBody)) {
    let stagedFor = null;
    for (const it of itemTokens) {
      if ((await stagedBytes(name, it)) != null) { stagedFor = it; break; }
    }
    if (stagedFor) {
      files.push({ path: `${audioDir}/${name}`, stagedAudio: { item: stagedFor, name } });
      for (const it of itemTokens) cleanup.push({ name, item: it });
      continue;
    }
    if (await onMain(`${audioDir}/${name}`)) continue;
    if (oldDir && oldDir !== audioDir && (await onMain(`${oldDir}/${name}`))) {
      files.push({ path: `${audioDir}/${name}`, copyFrom: `${oldDir}/${name}` }, { path: `${oldDir}/${name}`, content: null });
      continue;
    }
    return { refuse: `the recording ${name} is no longer staged; choose it again in the podcast block before publishing` };
  }
  return { files, cleanup };
}
