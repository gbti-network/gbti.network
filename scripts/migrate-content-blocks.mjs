// SOW-062 Phase 5f: the content MIGRATION for the Phase-5 block encodings. The only SEMANTIC change the new editor
// makes to legacy bodies is normalizing a bare-URL body embed (a lone `https://youtu.be/...` line) into a ```embed
// fence. This proactively rewrites JUST those items, so an author never opens an old article and sees a surprise
// diff. It does NOT reflow whitespace on unaffected files (that would be a huge cosmetic churn; the editor
// canonicalizes spacing naturally on the next real edit). The SOW-016 `<!-- members-only -->` marker and all standard
// Markdown are untouched. Opens ONE review-gated PR (content-check gates it), never auto-merged.
//
// Run: node scripts/migrate-content-blocks.mjs           # DRY RUN (lists the items that would be normalized)
//      node scripts/migrate-content-blocks.mjs --apply   # open the review-gated normalize PR

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { parseContentFile, serializeContentFile } from '../client/src/content-ops.mjs';
import { createGitHubClient } from '../clients/github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['posts', 'products', 'prompts'];

/** Walk every content item (house + members) -> [{ path, frontmatter, body }]. */
export function scanBodies(root) {
  const bases = TYPES.map((t) => path.join(root, 'house', t));
  const membersDir = path.join(root, 'members');
  if (fs.existsSync(membersDir)) {
    for (const user of fs.readdirSync(membersDir)) {
      if (user.startsWith('.')) continue;
      for (const t of TYPES) bases.push(path.join(membersDir, user, t));
    }
  }
  const items = [];
  for (const base of bases) {
    if (!fs.existsSync(base) || !fs.statSync(base).isDirectory()) continue;
    for (const slug of fs.readdirSync(base)) {
      const idx = path.join(base, slug, 'index.md');
      if (!fs.existsSync(idx)) continue;
      let parsed;
      try { parsed = parseContentFile(fs.readFileSync(idx, 'utf8')); } catch { continue; }
      items.push({ path: path.relative(root, idx).split(path.sep).join('/'), frontmatter: parsed.frontmatter || {}, body: parsed.body || '' });
    }
  }
  return items;
}

/** PURE: the canonical body the Phase-5 editor would serialize (fences bare-URL embeds; normalizes spacing). */
export const canonicalBody = (body) => serializeBlocks(parseBlocks(String(body || '')));

/** PURE: does this body carry a LEGACY bare-URL embed (an embed block that is not already a ```embed fence)? */
export function needsEmbedNormalization(body) {
  const embeds = parseBlocks(String(body || '')).filter((b) => b.type === 'embed').length;
  if (!embeds) return false;
  const fenced = (String(body || '').match(/^```embed\s*$/gm) || []).length;
  return embeds > fenced; // at least one embed came from a bare URL -> normalize it to a fence
}

/** The items that need the semantic normalization, with the rewritten body. */
export function planNormalize(items) {
  return items.filter((it) => needsEmbedNormalization(it.body)).map((it) => ({ ...it, nextBody: canonicalBody(it.body) }));
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

async function applyMigration(github, rewrites, { base = 'main', now }) {
  const branch = `gbti/content-blocks-normalize-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`cannot resolve ${base} head sha`);
  await github.createRef(branch, baseSha);
  for (const r of rewrites) {
    const existing = await github.getContent(r.path, branch);
    const text = existing?.content ? Buffer.from(existing.content, 'base64').toString('utf8') : fs.readFileSync(path.join(ROOT, r.path), 'utf8');
    const { frontmatter, body } = parseContentFile(text);
    const next = canonicalBody(body); // recompute from the branch content, so it is never stale
    await github.putContent(r.path, { message: `SOW-062: normalize body embed in ${r.path}`, content: b64(serializeContentFile(frontmatter ?? {}, next)), branch, sha: existing?.sha });
  }
  const pull = await github.createPull({ title: 'SOW-062: normalize legacy bare-URL body embeds', head: branch, base, body: `SOW-062 Phase 5f content migration: fence ${rewrites.length} legacy bare-URL body embed(s) into \`\`\`embed blocks (the Phase-5 editor's only semantic change to existing bodies). Review + merge once content-check is green.` });
  return pull.number;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const now = process.env.MIGRATE_NOW ? new Date(process.env.MIGRATE_NOW) : new Date();
  const items = scanBodies(ROOT);
  const rewrites = planNormalize(items);

  // Also verify the round-trip is IDEMPOTENT for every body (the safety guarantee the audit test locks in).
  const drift = items.filter((it) => canonicalBody(canonicalBody(it.body)) !== canonicalBody(it.body));
  console.log(`migrate-content-blocks: scanned ${items.length} content item(s).`);
  if (drift.length) {
    console.error(`WARNING: ${drift.length} body(ies) are NOT idempotent through the block model (this is a model bug, not a migration):`);
    for (const d of drift) console.error(`  - ${d.path}`);
  }
  if (!rewrites.length) { console.log('No legacy bare-URL body embeds found. Existing content is already in the Phase-5 schema; nothing to migrate.'); process.exit(0); }

  console.log(`Plan: normalize ${rewrites.length} item(s) with a legacy bare-URL body embed:`);
  for (const r of rewrites) console.log(`  - ${r.path}`);
  if (!apply) { console.log('\nDRY RUN (no changes). Re-run with --apply to OPEN the review-gated normalize PR.'); process.exit(0); }

  const token = process.env.GITHUB_BOT_TOKEN || process.env.GH_BOT_TOKEN;
  const repo = process.env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
  if (!token) { console.error('--apply needs GITHUB_BOT_TOKEN (a content-write PAT).'); process.exit(1); }
  const github = createGitHubClient({ token, repo, fetch: globalThis.fetch });
  const prNumber = await applyMigration(github, rewrites, { now });
  console.log(`\nOpened PR #${prNumber} (${rewrites.length} content rewrite(s)). NOT auto-merged: review + merge once content-check passes.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('migrate-content-blocks crashed:', e?.message || e); process.exit(1); });
