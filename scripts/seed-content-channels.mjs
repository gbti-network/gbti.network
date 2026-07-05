#!/usr/bin/env node
// SOW-087: seed/refresh house/content-channels.yml by NAME-MATCHING the live Discord guild's channels against
// the category vocabularies (the flat topic keys in house/topics.yml + the top-level taxonomy keys in
// house/taxonomy.yml). The owner confirmed the gbti guild's category channels are named after the category keys
// (3d-printing, agriculture, ..., writing), so the seed is mechanical; unmatched keys are reported, not invented.
//
// The seed FILLS GAPS ONLY: an existing row in house/content-channels.yml is NEVER overwritten (hand-set rows
// like the ai/blockchain/devops section-general mappings, or a pick between duplicate channel names, are the
// curated truth). Remove a row first if you want the seed to re-match it.
//
//   node scripts/seed-content-channels.mjs            # dry-run: report the matches + the misses
//   node scripts/seed-content-channels.mjs --apply    # add the new matches (header + existing rows preserved)
//
// Requires DISCORD_BOT_TOKEN + DISCORD_GUILD_ID (read-only: one GET /guilds/<id>/channels call).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { createDiscordClient } from '../clients/discord.mjs';
import { topicVocabList } from '../membership/topics-vocab.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAP_PATH = path.join(ROOT, 'house', 'content-channels.yml');

const kebab = (s) => String(s || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

/** Every category key we may route by: the flat topic keys + the top-level taxonomy keys. Deduped, sorted. */
export function candidateKeys({ topicsParsed, taxonomyParsed }) {
  const keys = new Set();
  for (const t of topicVocabList(topicsParsed)) keys.add(t.key);
  const tree = taxonomyParsed?.tree;
  if (tree && typeof tree === 'object' && !Array.isArray(tree)) for (const k of Object.keys(tree)) keys.add(kebab(k));
  keys.delete('');
  return [...keys].sort();
}

/**
 * Name-match category keys to guild channels. A channel matches a key when its kebab-cased name equals the key
 * (Discord text-channel names are already lowercase kebab). Pure. Returns
 * { mapped: [{ category, channelId }], unmatchedKeys, extraChannels }.
 */
export function matchChannels({ keys = [], channels = [] } = {}) {
  const byName = new Map();
  for (const ch of channels) {
    if (!ch || ch.id == null || !ch.name) continue;
    if (ch.type != null && Number(ch.type) !== 0) continue; // text channels only (0); skip voice/categories
    const name = kebab(ch.name);
    if (name && !byName.has(name)) byName.set(name, String(ch.id));
  }
  const mapped = [];
  const unmatchedKeys = [];
  for (const key of keys) {
    const id = byName.get(key);
    if (id) mapped.push({ category: key, channelId: id });
    else unmatchedKeys.push(key);
  }
  const mappedNames = new Set(mapped.map((m) => m.category));
  const extraChannels = [...byName.keys()].filter((n) => !mappedNames.has(n)).sort();
  return { mapped, unmatchedKeys, extraChannels };
}

/** Rewrite the yaml body below the file's leading comment header (yaml.dump drops comments). */
export function renderMapFile(existingRaw, mapped) {
  const header = (String(existingRaw || '').match(/^(?:#[^\n]*\n)+/) || [''])[0];
  return header + yaml.dump({ channels: mapped }, { lineWidth: 120, quotingType: '"', forceQuotes: false });
}

export async function main({ argv = process.argv.slice(2), env = process.env, fetchImpl = globalThis.fetch, discord = null } = {}) {
  const apply = argv.includes('--apply');
  const token = env.DISCORD_BOT_TOKEN;
  const guildId = env.DISCORD_GUILD_ID;
  if (!token || !guildId) {
    console.error('seed-content-channels: DISCORD_BOT_TOKEN + DISCORD_GUILD_ID are required');
    process.exitCode = 1;
    return { mapped: [] };
  }

  const topicsParsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'topics.yml'), 'utf8'));
  const taxonomyParsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house', 'taxonomy.yml'), 'utf8'));
  const keys = candidateKeys({ topicsParsed, taxonomyParsed });

  const client = discord ?? createDiscordClient({ botToken: token, fetch: fetchImpl });
  const channels = (await client.listGuildChannels(guildId)) || [];

  // Existing rows are the curated truth: only keys WITHOUT a row are up for a name match.
  const existingRaw = fs.existsSync(MAP_PATH) ? fs.readFileSync(MAP_PATH, 'utf8') : '';
  let existingRows = [];
  try { existingRows = yaml.load(existingRaw)?.channels ?? []; } catch { existingRows = []; }
  const existingByCat = new Map(existingRows.map((e) => [String(e?.category || '').toLowerCase(), e]).filter(([k]) => k));
  const openKeys = keys.filter((k) => !existingByCat.has(k));

  const { mapped, unmatchedKeys, extraChannels } = matchChannels({ keys: openKeys, channels });
  const merged = [...existingByCat.values(), ...mapped].sort((a, b) => String(a.category).localeCompare(String(b.category)));

  console.log(`seed-content-channels: ${keys.length} category keys, ${existingByCat.size} already mapped (kept), ${channels.length} guild channels, ${mapped.length} new match(es)${apply ? '' : ' (dry-run)'}`);
  for (const m of mapped) console.log(`  + ${m.category} -> ${m.channelId}`);
  if (unmatchedKeys.length) console.log(`\nNo channel found for ${unmatchedKeys.length} unmapped key(s) (these fall back to the featured per-type channel):\n  ${unmatchedKeys.join(', ')}`);
  if (extraChannels.length) console.log(`\nGuild text channels with no category key (ignored):\n  ${extraChannels.join(', ')}`);

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to add the new matches to house/content-channels.yml.');
    return { mapped, merged, unmatchedKeys, extraChannels };
  }
  fs.writeFileSync(MAP_PATH, renderMapFile(existingRaw, merged));
  console.log(`\nWrote ${merged.length} mapping(s) (${mapped.length} new) to house/content-channels.yml. Run a reconcile --apply to mirror it to KV.`);
  return { mapped, merged, unmatchedKeys, extraChannels };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
