#!/usr/bin/env node
// SOW-034 content-publish syndication runner. Given the content files ADDED in a push to main (the workflow
// computes them from the merge diff), announce each newly-published item in its type's Discord channel:
// post/product/prompt + share. Metadata only: a public item posts a link Discord unfurls; a members-only / Mode A
// item posts the TITLE only (the encrypted body is NEVER read). Best-effort, no persistent state (the push diff is
// the source of truth, so the backlog is never touched and there is no double-post bookkeeping).
//   node scripts/syndicate-content.mjs --added members/alice/posts/x/index.md            # dry-run
//   node scripts/syndicate-content.mjs --apply --added <path> [<path> ...]               # post to Discord
// Requires (for --apply): DISCORD_BOT_TOKEN + the per-type channel ids; STRIPE_SECRET_KEY enables @mentions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { parseContentFile } from '../client/src/content-ops.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { createStripeClient } from '../clients/stripe.mjs';
import { buildSyndicationItem, planContentSyndication } from './lib/content-syndication.mjs';
import { reverseMembersIndex, createMentionResolver } from './lib/discord-mention.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const ai = argv.indexOf('--added');
  let added = [];
  if (ai >= 0) {
    added = argv.slice(ai + 1)
      .filter((a) => !a.startsWith('--'))
      .flatMap((t) => String(t).split(/[\s,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { apply, added };
}

/** Load house/members-index.yml into a { github_id: username } map (flat, or under a `members:` key). */
function loadMembersIndex(root) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, 'house/members-index.yml'), 'utf8')) ?? {};
    const map = doc && typeof doc === 'object' && doc.members && typeof doc.members === 'object' ? doc.members : doc;
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function channelMapFromEnv(env) {
  return {
    post: env.DISCORD_CHANNEL_POSTS || null,
    product: env.DISCORD_CHANNEL_PRODUCTS || null,
    prompt: env.DISCORD_CHANNEL_PROMPTS || null,
    share: env.DISCORD_CHANNEL_SHARES || null,
  };
}

function parseOverrides(env) {
  try {
    return env.DISCORD_MENTION_OVERRIDES ? JSON.parse(env.DISCORD_MENTION_OVERRIDES) : {};
  } catch {
    return {};
  }
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch, deps = {} } = {}) {
  const { apply, added: argvAdded } = parseArgs(argv);
  // The workflow passes paths via the SYNDICATE_ADDED env var (NOT argv) so a path can never be shell-interpreted.
  const added = argvAdded.length
    ? argvAdded
    : String(env.SYNDICATE_ADDED || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const readFile = deps.readFile ?? ((rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  });

  // Build a publishable item from each added path (skip drafts / non-content / unparseable).
  const items = [];
  for (const rel of added) {
    const txt = readFile(rel);
    if (txt == null) continue;
    let fm;
    try { fm = parseContentFile(txt).frontmatter; } catch { continue; }
    const item = buildSyndicationItem(rel, fm);
    if (item) items.push(item);
  }
  console.log(`syndicate-content: ${added.length} changed path(s), ${items.length} publishable item(s)${apply ? '' : ' (dry-run)'}`);
  if (!items.length) {
    if (!apply) console.log('Nothing to announce.');
    return { posted: [], planned: [] };
  }

  // Resolve each author's Discord mention (Stripe metadata.discord_user_id, then override, then @login text).
  const reverseIndex = reverseMembersIndex(loadMembersIndex(root));
  const stripe = deps.stripe ?? (env.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null);
  const resolveMention = deps.resolveMention ?? createMentionResolver({ reverseIndex, stripe, overrides: parseOverrides(env) });

  const entries = [];
  for (const item of items) entries.push({ item, mention: await resolveMention(item.author) });

  const channelMap = channelMapFromEnv(env);
  const plan = planContentSyndication(entries, channelMap, { siteOrigin: env.SITE_ORIGIN || 'https://gbti.network' });
  const dropped = entries.length - plan.length;
  for (const p of plan) console.log(`  -> ${p.channelId}: ${p.message.split('\n')[0]}`);
  if (dropped > 0) console.log(`  (${dropped} item(s) have no configured channel for their type; skipped)`);

  if (!apply) {
    if (plan[0]) console.log('\nPreview of the first message:\n' + plan[0].message);
    console.log('\nDry-run only. Re-run with --apply to post to Discord.');
    return { posted: [], planned: plan };
  }
  if (!env.DISCORD_BOT_TOKEN) {
    console.error('✗ --apply needs DISCORD_BOT_TOKEN');
    process.exitCode = 1;
    return { posted: [], planned: plan };
  }
  const discord = deps.discord ?? createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
  const posted = [];
  for (const p of plan) {
    try {
      await discord.postChannelMessage(p.channelId, p.message, { allowedMentions: p.allowedMentions }); // best-effort; only the author may be pinged
      posted.push(p.channelId);
      console.log(`  ✓ posted to ${p.channelId}`);
    } catch (err) {
      console.error(`  ✗ post to ${p.channelId} failed: ${err?.message || err}`);
    }
  }
  console.log(`posted ${posted.length}/${plan.length}`);
  return { posted, planned: plan };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
