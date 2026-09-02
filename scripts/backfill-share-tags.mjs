#!/usr/bin/env node
// sow-303: one-off backfill of `tags:` onto the shares that have none.
//
// WHY. 49 of 57 shares carry no tags, because the composer never had a tags field. Their social posts have
// already been sent and cannot be changed, so this does NOT fix any past syndication. What it fixes is the
// site's own surfaces: /feeds/?tag=..., the tag links on every share page, and the tag filtering in the
// extension, all of which currently see nothing for those 49.
//
// Usage:
//   node scripts/backfill-share-tags.mjs              # dry run, prints the plan, writes nothing
//   node scripts/backfill-share-tags.mjs --apply      # writes the frontmatter
//   node scripts/backfill-share-tags.mjs --limit 5    # bound the run while checking the output quality
//
// Needs CF_ACCOUNT_ID + CF_API_TOKEN for the Workers AI REST endpoint. WITHOUT them it still runs and still
// prints a plan, using each share's declared/derived text only, so the shape of the change is reviewable
// before any credential is involved.
//
// IT DOES NOT OPEN A PR, deliberately. This edits member-owned content across dozens of files, and a diff the
// owner reads in their own working tree before committing is more reviewable than a bot PR they would have to
// reconstruct. Superadmin auto-merge (sow-108) makes the commit itself a one-step action afterwards.
//
// THE EDIT IS SURGICAL, not a re-serialization. It splices a `tags:` block into the existing frontmatter text
// and leaves every other byte alone. Round-tripping these files through a YAML dump would reorder keys,
// restyle block scalars and rewrite quoting across 49 files the owner then has to read, turning a small
// reviewable change into an unreviewable one.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeSuggestedTags, buildTagMessages } from '../workers/signup/topic-suggest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const LIMIT = (() => {
  const i = argv.indexOf('--limit');
  const n = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();
const MODEL = process.env.AI_MODEL || '@cf/meta/llama-3.2-3b-instruct';

/** Every share file on disk, as repo-relative paths. */
function shareFiles() {
  const base = path.join(ROOT, 'members');
  if (!fs.existsSync(base)) return [];
  const out = [];
  for (const user of fs.readdirSync(base)) {
    const dir = path.join(base, user, 'shares');
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) if (f.endsWith('.md')) out.push(path.join('members', user, 'shares', f));
  }
  return out.sort();
}

/** Split a content file into its raw frontmatter text and body. Null when it is not a frontmatter file. */
function split(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  return m ? { fm: m[1], body: m[2] } : null;
}

/** A single scalar field's value, read from the RAW frontmatter without a YAML parse. */
function field(fm, name) {
  const m = new RegExp(`^${name}: *(.*)$`, 'm').exec(fm);
  if (!m) return '';
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * Splice a `tags:` block into raw frontmatter. Placed just before `createdAt:` when present (matching where
 * the schema and the already-tagged shares put it), otherwise appended. Returns the new frontmatter text.
 */
function withTags(fm, tags) {
  const block = `tags:\n${tags.map((t) => `  - ${t}`).join('\n')}`;
  if (/^createdAt:/m.test(fm)) return fm.replace(/^createdAt:/m, `${block}\ncreatedAt:`);
  return `${fm}\n${block}`;
}

/** One Workers AI call over the REST API. Returns '' on any failure, so the caller degrades to no suggestion. */
async function runAi(messages) {
  const accountId = process.env.CF_ACCOUNT_ID;
  const token = process.env.CF_API_TOKEN;
  if (!accountId || !token) return '';
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${MODEL}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ messages, max_tokens: 40, temperature: 0 }),
    });
    if (!res.ok) return '';
    const json = await res.json();
    return String(json?.result?.response ?? '');
  } catch {
    return '';
  }
}

async function main() {
  const files = shareFiles();
  const untagged = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(ROOT, rel), 'utf8');
    const parts = split(text);
    if (!parts) continue;
    if (/^tags:/m.test(parts.fm)) continue; // already tagged, never touched
    untagged.push({ rel, text, ...parts });
  }

  const haveCreds = Boolean(process.env.CF_ACCOUNT_ID && process.env.CF_API_TOKEN);
  console.log(`shares: ${files.length}, untagged: ${untagged.length}, ${APPLY ? 'APPLYING' : 'dry run'}`);
  if (!haveCreds) console.log('note: CF_ACCOUNT_ID / CF_API_TOKEN not set, so no suggestions will be produced.');

  let changed = 0;
  let empty = 0;
  for (const item of untagged.slice(0, LIMIT === Infinity ? undefined : LIMIT)) {
    const title = field(item.fm, 'title');
    const description = field(item.fm, 'shortDescription');
    // The share's own body is the strongest local signal and it costs nothing to include; bounded so a long
    // body cannot dominate the prompt.
    const reply = await runAi(buildTagMessages({ title, description: `${description} ${item.body.slice(0, 400)}`.trim(), tags: [] }));
    const tags = normalizeSuggestedTags(reply, { max: 4 });
    if (!tags.length) {
      empty++;
      console.log(`  --  ${item.rel}  (no suggestion)`);
      continue;
    }
    console.log(`  ${APPLY ? '++' : '  '}  ${item.rel}  ->  ${tags.join(', ')}`);
    if (APPLY) {
      fs.writeFileSync(path.join(ROOT, item.rel), `---\n${withTags(item.fm, tags)}\n---\n${item.body}`);
      changed++;
    }
  }
  console.log(`\n${APPLY ? `wrote ${changed} file(s)` : 'dry run, nothing written'}; ${empty} had no suggestion.`);
  if (!APPLY && untagged.length) console.log('re-run with --apply once the suggestions above read correctly.');
}

main().catch((e) => { console.error(e?.message || e); process.exitCode = 1; });
