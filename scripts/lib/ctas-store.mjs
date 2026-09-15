// sow-281: the one reader of house/ctas.yml for node callers (the build's card and artifact, the content check).
// It validates before it answers, so a malformed registry fails the build loudly instead of shipping a card with a
// bad link, and it knows where each item type lives on disk so the content check can refuse an assignment that
// names nothing. Pure logic stays in membership/cta-edits.mjs and src/lib/ctas.mjs; this module owns the file.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateCtas, validRef } from '../../membership/cta-edits.mjs';
import { ctaImagePath, webpInfo } from '../../membership/cta-image.mjs';

export const CTAS_PATH = 'house/ctas.yml';

const cache = new Map(); // root -> parsed; a build reads the file many times and it cannot change mid-build

/** The parsed, validated registry. A missing file is an empty registry (a fork with no CTAs); a malformed one throws. */
export function readCtas(root, { fresh = false } = {}) {
  if (!fresh && cache.has(root)) return cache.get(root);
  const file = path.join(root, CTAS_PATH);
  let parsed = { ctas: [] };
  if (fs.existsSync(file)) {
    parsed = yaml.load(fs.readFileSync(file, 'utf8'));
    if (parsed === null || parsed === undefined) parsed = { ctas: [] };
  }
  const problems = validateCtas(parsed);
  if (problems.length) throw new Error(`${CTAS_PATH} is invalid:\n  ${problems.join('\n  ')}`);
  cache.set(root, parsed);
  return parsed;
}

const DIRS = { post: ['posts'], project: ['projects', 'products'], prompt: ['prompts'] };

/** Does the item a CTA assignment names exist on disk? Members' folders and house/ both count; a draft counts too
 *  (the card decides live-ness; the check only asks whether the reference is real). */
export function ctaItemExists(root, type, ref) {
  if (!validRef(type, ref)) return false;
  if (type === 'share') {
    const [author, id] = String(ref).split('/');
    return fs.existsSync(path.join(root, 'members', author, 'shares', `${id}.md`));
  }
  const dirs = DIRS[type];
  if (!dirs) return false;
  const bases = [path.join(root, 'house')];
  const members = path.join(root, 'members');
  if (fs.existsSync(members)) for (const u of fs.readdirSync(members)) bases.push(path.join(members, u));
  for (const base of bases) {
    for (const dir of dirs) {
      for (const name of ['index.md', 'index.mdx']) {
        if (fs.existsSync(path.join(base, dir, String(ref), name))) return true;
      }
    }
  }
  return false;
}

/**
 * sow-337: a card image on disk, checked. { ok: true, width, height, abs } for a committed, metadata-free still WebP;
 * { ok: false, problem } otherwise (a bad name, a missing file, or whatever membership/cta-image.mjs refuses). The
 * card reads its dimensions from here so the page reserves the image's space, and the content check refuses a card
 * whose image fails.
 */
export function ctaImageInfo(root, file) {
  const rel = ctaImagePath(file);
  if (!rel) return { ok: false, problem: `"${file}" is not a card image file name` };
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return { ok: false, problem: `${rel} does not exist` };
  const info = webpInfo(new Uint8Array(fs.readFileSync(abs)));
  return info.ok ? { ...info, abs } : info;
}
