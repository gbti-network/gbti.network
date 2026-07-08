// SOW-055 Phase 2: the category MIGRATION engine. The path-changing taxonomy ops (move / rename-key / remove)
// change a category's PATH, so every content item under it must have its `categories` frontmatter rewritten, or
// it would be orphaned (validate-content would then reject it). This runs in a FULL CLONE (CI Action or locally),
// because that is the only place a COMPLETE content scan (including drafts) is reliable. It opens ONE PR editing
// house/taxonomy.yml + every affected content file. Dry-run by default; --apply commits + auto-merges.
//
// The op is read from env (so the Action can bridge both workflow_dispatch inputs and repository_dispatch payload):
//   MIGRATE_ACTION = move | rename | remove
//   MIGRATE_FROM   = the source category path, slash-joined (e.g. "devops/frameworks")
//   MIGRATE_TO_PARENT = (move) the destination parent path, slash-joined ("" = top level)
//   MIGRATE_NEW_KEY   = (rename) the new kebab key
//   MIGRATE_REASSIGN  = (remove) "true" to reattach affected content to the parent; else a remove that would
//                       orphan content is REFUSED.
//
// Run: node --env-file-if-exists=.env scripts/migrate-category.mjs            # DRY RUN (prints the plan)
//      node --env-file-if-exists=.env scripts/migrate-category.mjs --apply    # commit + open + merge the PR

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { moveCategory, renameKey, removeCategory, mergeCategory, rewriteCategories } from '../membership/taxonomy-edits.mjs';
import { parseContentFile, serializeContentFile } from '../client/src/content-ops.mjs';
import { createGitHubClient } from '../clients/github.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TYPES = ['posts', 'products', 'prompts']; // member-authorable categorized types (shares/comments/profiles are NOT categorized)
const HOUSE_ONLY_TYPES = ['applets']; // SOW-022: applets are categorized (productShape) but house-only, never member-authored
const TAXONOMY_REL = 'house/taxonomy.yml';
const KEY_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/; // a taxonomy key segment (matches the pure core + validate-content)

/** Walk EVERY categorized content item under house/ and members/<user>/, published or draft -> [{ path, categories }]. */
export function scanContent(root) {
  const bases = [...TYPES, ...HOUSE_ONLY_TYPES].map((t) => path.join(root, 'house', t));
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
      let fm;
      try { fm = parseContentFile(fs.readFileSync(idx, 'utf8')).frontmatter || {}; } catch { continue; }
      items.push({ path: path.relative(root, idx).split(path.sep).join('/'), categories: Array.isArray(fm.categories) ? fm.categories : [] });
    }
  }
  return items;
}

/**
 * PURE: compute the full migration plan. `op` = { action, from:[...], toParentPath?, newKey?, reassignToParent?, ctx? }.
 * Returns { changed, pathChange, nextTaxonomy, audit, rewrites:[{path,categories}], orphaned:[path] }. `orphaned`
 * is non-empty only for a remove WITHOUT reassignment that still has references — the caller MUST refuse then.
 */
export function planCategoryMigration(taxonomy, contentItems, op) {
  let result;
  if (op.action === 'move') result = moveCategory(taxonomy, { fromPath: op.from, toParentPath: op.toParentPath ?? [] }, op.ctx);
  else if (op.action === 'rename') result = renameKey(taxonomy, { path: op.from, newKey: op.newKey }, op.ctx);
  else if (op.action === 'remove') result = removeCategory(taxonomy, { path: op.from, reassignToParent: !!op.reassignToParent }, op.ctx);
  else if (op.action === 'merge') result = mergeCategory(taxonomy, { fromPath: op.from, intoPath: op.into ?? [] }, op.ctx);
  else throw new Error(`unknown migration action: ${op.action}`);

  const { next, changed, pathChange, audit } = result;
  const rewrites = [];
  const orphaned = [];
  if (pathChange) {
    for (const it of contentItems || []) {
      const nc = rewriteCategories(it.categories, pathChange);
      if (nc === undefined) continue;
      if (nc === null) orphaned.push(it.path);
      else rewrites.push({ path: it.path, categories: nc });
    }
  }
  return { changed, pathChange, audit, nextTaxonomy: next, rewrites, orphaned };
}

// Preserve taxonomy.yml's documentation header (yaml.dump drops comments).
function leadingComment(raw) {
  const out = [];
  for (const line of String(raw || '').split('\n')) {
    if (/^\s*#/.test(line) || line.trim() === '') out.push(line); else break;
  }
  const block = out.join('\n').replace(/\s+$/, '');
  return block ? `${block}\n` : '';
}
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');

function parseOp(env) {
  const action = env.MIGRATE_ACTION;
  const splitPath = (s) => String(s || '').split('/').map((x) => x.trim()).filter(Boolean);
  const from = splitPath(env.MIGRATE_FROM);
  if (!action || !from.length) throw new Error('MIGRATE_ACTION and MIGRATE_FROM are required');
  const toParentPath = splitPath(env.MIGRATE_TO_PARENT); // "" -> [] (top level)
  const into = splitPath(env.MIGRATE_INTO); // merge destination
  for (const seg of [...from, ...toParentPath, ...into]) if (!KEY_RE.test(seg)) throw new Error(`invalid category path segment "${seg}" (must be kebab-case)`);
  return {
    action,
    from,
    toParentPath,
    into,
    newKey: (env.MIGRATE_NEW_KEY || '').trim(),
    reassignToParent: env.MIGRATE_REASSIGN === 'true',
    ctx: { actor: { login: env.MIGRATE_BY || 'migrate-category' }, now: env.MIGRATE_NOW ? new Date(env.MIGRATE_NOW) : undefined },
  };
}

async function applyMigration(github, { nextTaxonomy, rewrites, audit }, { raw, op, base = 'main', now }) {
  const branch = `gbti/category-${op.action}-${(op.from.join('-') || 'x').replace(/[^a-z0-9-]/gi, '-')}-${now.getTime()}`;
  const baseRef = await github.getRef(`heads/${base}`);
  const baseSha = baseRef?.object?.sha;
  if (!baseSha) throw new Error(`cannot resolve ${base} head sha`);
  await github.createRef(branch, baseSha);

  // 1. taxonomy.yml (header preserved).
  const taxExisting = await github.getContent(TAXONOMY_REL, branch);
  await github.putContent(TAXONOMY_REL, { message: `Category ${op.action}: ${op.from.join('/')}`, content: b64(leadingComment(raw) + yaml.dump(nextTaxonomy, { lineWidth: 100, noRefs: true })), branch, sha: taxExisting?.sha });

  // 2. each affected content file: rewrite ONLY its categories, preserving the rest.
  for (const r of rewrites) {
    const existing = await github.getContent(r.path, branch);
    const text = existing?.content ? Buffer.from(existing.content, 'base64').toString('utf8') : fs.readFileSync(path.join(ROOT, r.path), 'utf8');
    const { frontmatter, body } = parseContentFile(text);
    const updated = { ...(frontmatter ?? {}) };
    if (r.categories.length) updated.categories = r.categories; else delete updated.categories; // [] -> uncategorized
    await github.putContent(r.path, { message: `Category ${op.action}: rewrite ${r.path}`, content: b64(serializeContentFile(updated, body)), branch, sha: existing?.sha });
  }

  const pull = await github.createPull({ title: `Category ${op.action}: ${op.from.join('/')}`, head: branch, base, body: `SOW-055 Phase 2 category migration (${rewrites.length} content rewrite(s)).\n\nReview + merge once content-check is green (it validates that no \`categories\` path is orphaned).\n\n<!-- gbti-audit ${JSON.stringify(audit)} -->` });
  // INTENTIONALLY NOT auto-merged. A category migration rewrites many content files, so the PR is REVIEW-gated:
  // content-check on the PR is the authority that no path is orphaned, and merging only after it (and the branch
  // is up to date with main) closes the scan->merge race a blind auto-merge would leave open. The PR is the audit trail.
  return pull.number;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const env = process.env;
  const now = env.MIGRATE_NOW ? new Date(env.MIGRATE_NOW) : new Date();
  const op = parseOp(env);

  const raw = fs.readFileSync(path.join(ROOT, TAXONOMY_REL), 'utf8');
  const taxonomy = yaml.load(raw) || {};
  const items = scanContent(ROOT);
  const plan = planCategoryMigration(taxonomy, items, op);

  console.log(`migrate-category: ${op.action} ${op.from.join('/')}${op.action === 'move' ? ` -> ${op.toParentPath.join('/') || '(top)'}` : op.action === 'rename' ? ` -> ${op.newKey}` : op.reassignToParent ? ' (reassign to parent)' : ''}`);
  if (!plan.changed) { console.log('No change (already in that state).'); process.exit(0); }

  if (plan.orphaned.length) {
    console.error(`REFUSED: this remove would ORPHAN ${plan.orphaned.length} content item(s) (their category would no longer exist):`);
    for (const p of plan.orphaned) console.error(`  - ${p}`);
    console.error('Re-run with MIGRATE_REASSIGN=true to reattach them to the parent category, or reassign them first.');
    process.exit(2);
  }

  console.log(`Plan: 1 taxonomy edit + ${plan.rewrites.length} content rewrite(s).`);
  for (const r of plan.rewrites) console.log(`  rewrite ${r.path}: categories -> [${r.categories.join(', ')}]`);

  if (!apply) { console.log('\nDRY RUN (no changes). Re-run with --apply to OPEN the migration PR (review + merge it once content-check is green).'); process.exit(0); }

  const token = env.GITHUB_BOT_TOKEN || env.GH_BOT_TOKEN;
  const repo = env.GITHUB_CONTENT_REPO || 'gbti-network/gbti.network';
  if (!token) { console.error('--apply needs GITHUB_BOT_TOKEN (a content-write PAT).'); process.exit(1); }
  const github = createGitHubClient({ token, repo, fetch: globalThis.fetch });
  const prNumber = await applyMigration(github, plan, { raw, op, now });
  console.log(`\nOpened PR #${prNumber} (taxonomy + ${plan.rewrites.length} content rewrite(s)). It is NOT auto-merged: review it + merge once content-check passes, so an orphaned category can never slip in.`);
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('migrate-category crashed:', e?.message || e); process.exit(1); });
