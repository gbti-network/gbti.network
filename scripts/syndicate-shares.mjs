#!/usr/bin/env node
// SOW-018 Share syndication runner. Broadcasts PUBLIC published member Shares to the co-op's Discord Shares
// channel, best-effort + idempotent (each Share posts at most once, tracked by id in house/shares-syndicated.yml).
// Members-only Shares are NEVER syndicated (their body is encrypted; no plaintext goes to Discord). This is the
// BATCHED mechanism (run on a schedule / by the owner), not a real-time webhook, matching the launch model.
//   node scripts/syndicate-shares.mjs              # dry-run: print what would be posted
//   node scripts/syndicate-shares.mjs --apply      # post to Discord + record the syndicated ids
// Requires (for --apply): DISCORD_BOT_TOKEN + DISCORD_SHARES_CHANNEL_ID.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { createReader } from '../client/src/repo-fs.mjs';
import { createDiscordClient } from '../clients/discord.mjs';
import { planShareSyndication, formatShareMessage } from './lib/share-syndication.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STATE_REL = 'house/shares-syndicated.yml';

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const li = argv.indexOf('--limit');
  const limit = li >= 0 ? Number(argv[li + 1]) : 50;
  return { apply, limit: Number.isInteger(limit) && limit > 0 ? limit : 50 };
}

/** Read the syndicated-id state list (missing/unparseable -> empty, so a first run posts the backlog). */
export function readState(root = ROOT) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, STATE_REL), 'utf8')) ?? {};
    return Array.isArray(doc.syndicated) ? doc.syndicated.map(String) : [];
  } catch {
    return [];
  }
}

function writeState(syndicated, root = ROOT) {
  fs.writeFileSync(path.join(root, STATE_REL), yaml.dump({ syndicated }, { lineWidth: 100, noRefs: true }));
}

// Resolve a member handle to a display name from their profile (best-effort; falls back to the handle).
function buildNameOf(root = ROOT) {
  const byUser = new Map();
  const membersDir = path.join(root, 'members');
  try {
    for (const u of fs.readdirSync(membersDir)) {
      try {
        const txt = fs.readFileSync(path.join(membersDir, u, 'profile.md'), 'utf8');
        const m = /^displayName:\s*"?([^"\n]+?)"?\s*$/m.exec(txt);
        if (m) byUser.set(u, m[1].trim());
      } catch { /* no profile */ }
    }
  } catch { /* no members dir */ }
  return (a) => (a === 'gbti' ? 'GBTI Network' : byUser.get(a) || a);
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const { apply, limit } = parseArgs(argv);
  const reader = createReader(root);
  const shares = reader.listShares(500); // a generous window to catch any backlog
  const syndicatedBefore = readState(root);
  const { toPost } = planShareSyndication({ shares, syndicated: syndicatedBefore, limit });
  const nameOf = buildNameOf(root);

  console.log(`shares: ${shares.length} total, ${syndicatedBefore.length} already syndicated, ${toPost.length} to post${apply ? '' : ' (dry-run)'}`);
  for (const s of toPost) console.log(`  - ${s.id} (${s.author})`);

  if (!apply) {
    if (toPost.length) console.log('\nPreview of the first message:\n' + formatShareMessage(toPost[0], nameOf));
    console.log('\nDry-run only. Re-run with --apply to post to Discord.');
    return { posted: [], planned: toPost.map((s) => s.id) };
  }

  const channelId = env.DISCORD_SHARES_CHANNEL_ID;
  if (!env.DISCORD_BOT_TOKEN || !channelId) {
    console.error('✗ --apply needs DISCORD_BOT_TOKEN + DISCORD_SHARES_CHANNEL_ID');
    process.exitCode = 1;
    return { posted: [], planned: toPost.map((s) => s.id) };
  }
  const discord = createDiscordClient({ botToken: env.DISCORD_BOT_TOKEN, fetch: fetchImpl });
  const posted = [];
  for (const s of toPost) {
    try {
      await discord.postChannelMessage(channelId, formatShareMessage(s, nameOf)); // best-effort
      posted.push(String(s.id));
      console.log(`  ✓ posted ${s.id}`);
    } catch (err) {
      console.error(`  ✗ failed to post ${s.id}: ${err?.message || err} (will retry next run)`);
    }
  }
  // Record ONLY the ids we actually posted, so a failed post is retried (idempotent, no double-post).
  if (posted.length) writeState([...syndicatedBefore, ...posted], root);
  console.log(`posted ${posted.length}/${toPost.length}`);
  return { posted, planned: toPost.map((s) => s.id) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
