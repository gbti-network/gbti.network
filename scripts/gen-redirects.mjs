#!/usr/bin/env node
// Emit a Cloudflare Pages `public/_redirects` from .data/legacy/redirect-map.csv (flattened legacy post paths
// + /author/* -> /members/*), VISIBILITY-AWARE (SOW-016). A legacy URL whose destination content is no longer
// a public page (members-only with no stub = Mode A, a draft, or a removed slug) must NOT 301 to a 404, which
// would lose the SEO equity and serve a broken redirect. Such a destination is retargeted to /membership/ (a
// real page that explains the content is members-only). Run after migration and after any visibility change;
// the file is copied verbatim into the build output.
//   node scripts/gen-redirects.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUTBOUND_MARKER } from '../membership/outbound-link-edits.mjs'; // sow-359: the rows land at build, not here

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// Build the set of /<seg>/<slug>/ paths that WILL be public pages: published AND (public OR a Mode B stub).
const SEG = { posts: 'articles', projects: 'projects', products: 'projects', prompts: 'prompts' };
const field = (txt, k) => {
  const m = new RegExp('^' + k + ':\\s*"?([^"\\n]+?)"?\\s*$', 'm').exec(txt);
  return m ? m[1].trim() : null;
};
const publicPaths = new Set();
function scan(baseDir) {
  for (const [sub, seg] of Object.entries(SEG)) {
    const dir = path.join(baseDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const slugDir of fs.readdirSync(dir)) {
      const idx = path.join(dir, slugDir, 'index.md');
      if (!fs.existsSync(idx)) continue;
      const txt = fs.readFileSync(idx, 'utf8');
      const status = field(txt, 'status') ?? 'draft';
      const visibility = field(txt, 'visibility') ?? 'public';
      const publicStub = /^true$/i.test(String(field(txt, 'publicStub') ?? ''));
      const slug = field(txt, 'slug') ?? slugDir;
      if (status === 'published' && (visibility === 'public' || publicStub)) publicPaths.add(`/${seg}/${slug}/`);
    }
  }
}
scan(path.join(ROOT, 'house'));
const membersDir = path.join(ROOT, 'members');
const memberPaths = new Set(); // /members/<username>/ for each published+public profile (a real public page)
if (fs.existsSync(membersDir)) {
  for (const u of fs.readdirSync(membersDir)) {
    const b = path.join(membersDir, u);
    try {
      if (!fs.statSync(b).isDirectory()) continue;
    } catch { continue; }
    scan(b);
    // A member-profile redirect target (/author/* -> /members/<u>/) must point at a profile that actually
    // builds. Add it to the resolved set only if the profile is published + public.
    const prof = path.join(b, 'profile.md');
    if (fs.existsSync(prof)) {
      const txt = fs.readFileSync(prof, 'utf8');
      const status = field(txt, 'status') ?? 'draft';
      const visibility = field(txt, 'visibility') ?? 'public';
      const username = field(txt, 'username') ?? u;
      if (status === 'published' && visibility === 'public') memberPaths.add(`/members/${username}/`);
    }
  }
}

const CONTENT_DEST = /^\/(articles|projects|products|prompts)\/[^/]+\/$/;
const MEMBER_DEST = /^\/members\/[^/]+\/$/;
const MEMBERS_INDEX = '/members/';
const MEMBERSHIP = '/membership/';
const csv = fs.readFileSync(path.join(ROOT, '.data/legacy/redirect-map.csv'), 'utf8').trim().split(/\r?\n/).slice(1);

const lines = [
  '# Generated from .data/legacy/redirect-map.csv by scripts/gen-redirects.mjs (visibility-aware, SOW-016).',
  '# Cloudflare Pages _redirects: <source> <destination> <status>. Do not edit by hand; re-run the generator.',
];
let n = 0;
const retargeted = [];
for (const row of csv) {
  const [oldPath, newPathRaw, code] = row.split(',');
  if (!oldPath || !newPathRaw) continue;
  let newPath = newPathRaw;
  // A content destination that is no longer a public page (Mode A / draft / removed) must not 301 to a 404.
  if (CONTENT_DEST.test(newPath) && !publicPaths.has(newPath)) {
    retargeted.push(`${newPath} -> ${MEMBERSHIP}`);
    newPath = MEMBERSHIP;
  } else if (MEMBER_DEST.test(newPath) && !memberPaths.has(newPath)) {
    // A member-profile destination that no longer resolves (a renamed/removed member, a draft profile) falls
    // back to the members directory rather than 301-ing to a 404.
    retargeted.push(`${newPath} -> ${MEMBERS_INDEX}`);
    newPath = MEMBERS_INDEX;
  }
  lines.push(`${oldPath} ${newPath} ${code || 301}`);
  n++;
}

// Non-legacy redirects (site reclassifications, not from the legacy CSV). SOW-022: the two GBTI tools moved
// from the `project` collection to the `applet` collection, so their old /projects/<slug>/ detail URLs now
// 301 to the running tool at /utilities/<slug>/ (which is also each applet card's launchUrl).
const EXTRA = [
  // sow-230: /linkedin-invite/ is RETIRED into /member-invite/. It shipped 2026-08-15 with benefit prose
  // inherited from the Creator page it was copied from, so a member-tier invite advertised publishing,
  // syndication, a creator profile, weekly shop talk and the first-touch revenue program, none of which a
  // Member gets. Redirected rather than deleted because the link was created to be SENT to a specific
  // person: a 404 is the worst outcome for anyone already holding it, and leaving it up was not an option
  // while it made claims the tier does not support. The replacement is audience-neutral, so there is
  // nothing LinkedIn-specific to preserve at the old path.
  ['/linkedin-invite/', '/member-invite/'],

  ['/products/js-animate-hue/', '/utilities/js-animate-hue/'],
  ['/products/email-signature-generator/', '/utilities/email-signature-generator/'],

  // sow-289: the outbound PARTNER links (Codeable, BugHerd, Cloudways, Tailscale) live in house/outbound-links.yml
  // now, one store for the redirect, the superadmin board and the daily click rollup, with each link's provenance
  // kept as its `note`. They are spliced in HERE, in file order, so public/_redirects reads exactly as it did when
  // the rows were inline (the migration was proven by an empty diff). Only five of the ten sit under /outbound/;
  // the rest are legacy WordPress paths that still carry Codeable traffic, which is why the store, not a prefix,
  // is the source of truth. A `retired` entry is still emitted: a path an old post links must never 404.
  // sow-359: the rows themselves now come from the store at BUILD time (compose-redirects), so this file
  // carries only the marker that says where they land. Before this, regenerating them was a manual run of
  // this script, which meant the store and the file that serves could disagree without anything noticing.
  OUTBOUND_MARKER,

  // A Share moved between member folders, added 2026-09-12. Moving a Share (sow-183) changes its page address
  // and leaves nothing at the old one, and shares have no frontmatter redirectFrom for compose-redirects to
  // read. Two things kept pointing at the old address: the social queue item enqueued at creation, which
  // baked the URL in and was not re-enqueued by the move, and Cloudflare Pages itself, which keeps serving a
  // page removed from a deploy for up to seven days, referencing a stylesheet the next deploy deleted, so the
  // old address rendered unstyled. A zone purge by URL did not evict that copy. A redirect does, because
  // Pages evaluates _redirects before it looks for the page.
  ['/shares/atwellpub/20260910215127-google-deepmind-releases-predictions-for-9-billi/', '/shares/gbtilabs/20260910215127-google-deepmind-releases-predictions-for-9-billi/'],
];
// A string entry is a raw line (the sow-359 outbound marker); a pair is a redirect.
for (const e of EXTRA) {
  if (typeof e === 'string') { lines.push(e); continue; }
  const [oldPath, newPath] = e;
  lines.push(`${oldPath} ${newPath} 301`); n++;
}

// The blog section was renamed to /articles/ (one canonical path). Catch any remaining /blog/<slug>/ link
// (including ones inside older post bodies) with a splat so it lands on the live /articles/ page. This MUST
// come after the specific legacy rows above so a slug that was also renamed (e.g. the snapshots-for-ai post)
// keeps its exact destination instead of being swept to a same-slug /articles/ 404. The splat destination is
// skipped by check-redirects (it carries a `:` placeholder), so it never fails the build guard.
lines.push('/blog/* /articles/:splat 301');
n++;

// sow-196 (2026-09-02): the `product` content type became `project`, so /products/ became /projects/.
// Per-ITEM 301s compose from each item's frontmatter redirectFrom (scripts/compose-redirects.mjs); these
// are the COLLECTION-level routes, which have no frontmatter to carry one. They are emitted here, after
// the splat, rather than hand-written into public/_redirects, because that file is regenerated wholesale
// and anything added to it by hand is silently dropped on the next run.
lines.push('');
lines.push('# sow-196 (2026-09-02): the `product` content type became `project`. Per-item /products/<slug>/ 301s are');
lines.push('# composed from each item\'s frontmatter redirectFrom by scripts/compose-redirects.mjs; these are the');
lines.push('# collection-level routes, which have no frontmatter to carry them.');
for (const [from, to] of [
  ['/products/', '/projects/'],
  ['/feeds/products/', '/feeds/projects/'],
  ['/products-index.json', '/projects-index.json'],
]) { lines.push(`${from} ${to} 301`); n++; }
lines.push('# The two SOW-022 applet URLs keep their existing /products/ lines above; these are their /projects/ twins.');
for (const [from, to] of [
  ['/projects/js-animate-hue/', '/utilities/js-animate-hue/'],
  ['/projects/email-signature-generator/', '/utilities/email-signature-generator/'],
]) { lines.push(`${from} ${to} 301`); n++; }

fs.mkdirSync(path.join(ROOT, 'public'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'public/_redirects'), lines.join('\n') + '\n');
console.log(`Wrote public/_redirects with ${n} redirects.`);
if (retargeted.length) {
  console.log(`Retargeted ${retargeted.length} redirect(s) whose destination is not a public page (to ${MEMBERSHIP}):`);
  for (const r of retargeted) console.log('  - ' + r);
}
