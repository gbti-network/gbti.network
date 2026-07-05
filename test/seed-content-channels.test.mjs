// SOW-087: the content-channels seed script's pure cores (candidate keys, name matching, header-preserving
// rewrite) + the wired main() with a fake Discord client. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { candidateKeys, matchChannels, renderMapFile, main } from '../scripts/seed-content-channels.mjs';
import { channelForCategory } from '../membership/news-channels.mjs';

const TOPICS = { topics: { ai: { label: 'AI' }, devops: { label: 'DevOps' }, '3d-printing': { label: '3D Printing' } } };
const TAXONOMY = { tree: { devops: { label: 'DevOps' }, minecraft: { label: 'Minecraft' } } };

test('candidateKeys merges topic keys + taxonomy top-level keys, deduped and sorted', () => {
  assert.deepEqual(candidateKeys({ topicsParsed: TOPICS, taxonomyParsed: TAXONOMY }), ['3d-printing', 'ai', 'devops', 'minecraft']);
});

test('matchChannels: kebab name match, text channels only, unmatched keys + extra channels reported', () => {
  const channels = [
    { id: 111, name: 'ai', type: 0 },
    { id: 222, name: '3d-printing', type: 0 },
    { id: 333, name: 'devops', type: 2 }, // a voice channel never matches
    { id: 444, name: 'general', type: 0 },
  ];
  const r = matchChannels({ keys: ['3d-printing', 'ai', 'devops', 'minecraft'], channels });
  assert.deepEqual(r.mapped, [
    { category: '3d-printing', channelId: '222' },
    { category: 'ai', channelId: '111' },
  ]);
  assert.deepEqual(r.unmatchedKeys, ['devops', 'minecraft']);
  assert.deepEqual(r.extraChannels, ['general']);
});

test('renderMapFile keeps the leading comment header and yields a map channelForCategory resolves', () => {
  const existing = '# header line one\n# header line two\nchannels: []\n';
  const out = renderMapFile(existing, [{ category: 'ai', channelId: '111' }]);
  assert.ok(out.startsWith('# header line one\n# header line two\n'));
  const parsed = yaml.load(out);
  assert.equal(channelForCategory(parsed, 'AI'), '111');
});

test('main dry-run: existing rows are the curated truth (never re-matched) and nothing is written', async () => {
  const before = fs.readFileSync(new URL('../house/content-channels.yml', import.meta.url), 'utf8');
  const existing = yaml.load(before).channels;
  const aiRow = existing.find((e) => e.category === 'ai');
  assert.ok(aiRow, 'the ai row is hand-mapped in the repo');
  // a guild channel named after an ALREADY-MAPPED key must not override the curated row
  const discord = { listGuildChannels: async () => [{ id: 999, name: 'ai', type: 0 }] };
  const r = await main({ argv: [], env: { DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: 'g' }, discord });
  assert.ok(!r.mapped.some((m) => m.category === 'ai'), 'no re-match for a mapped key');
  const kept = r.merged.find((m) => m.category === 'ai');
  assert.equal(kept.channelId, aiRow.channelId); // the curated mapping survives
  const after = fs.readFileSync(new URL('../house/content-channels.yml', import.meta.url), 'utf8');
  assert.equal(before, after); // dry-run never writes
});
