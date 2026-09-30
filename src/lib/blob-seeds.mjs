// sow-428: the site's blobatars as FILES. A page can show the same member many times (the homepage draws about 200
// avatars for a couple of dozen people), and an inline `data:` URL repeats the whole drawing at every one, which
// measured +200 KB of HTML and +9 KB compressed on the homepage. So every known member folder gets one file,
// /blobatar/<folder>.svg (src/pages/blobatar/[seed].svg.ts), which the browser downloads once. A seed the build does
// not know (a display name, a login from the change history) still gets the inline `data:` URL.
//
// Build-time only: it reads the repository, so only server-rendered components import it.
import fs from 'node:fs';
import path from 'node:path';
import { parseMembersIndex } from '../../membership/hosted-author.mjs';
import { NETWORK_FOLDERS, isFolder } from '../../membership/member-avatar.mjs';
import { memberBlob } from '../../membership/member-blob.mjs';

let seeds = null;

/** Every folder the build can name: the members index, every members/ directory, and the network identities. */
export function blobSeeds(root = process.cwd()) {
  if (seeds) return seeds;
  const out = new Set(NETWORK_FOLDERS);
  try {
    for (const f of parseMembersIndex(fs.readFileSync(path.join(root, 'house/members-index.yml'), 'utf8')).values()) out.add(f);
  } catch { /* the directory listing below still names every folder with content */ }
  try {
    for (const d of fs.readdirSync(path.join(root, 'members'))) if (isFolder(d)) out.add(d);
  } catch { /* no members tree */ }
  seeds = out;
  return out;
}

/** The blobatar for a seed: the shared file for a known folder, else an inline `data:` URL. */
export function blobSrc(seed) {
  const s = String(seed ?? '').trim().toLowerCase();
  return blobSeeds().has(s) ? `/blobatar/${s}.svg` : memberBlob(seed);
}
