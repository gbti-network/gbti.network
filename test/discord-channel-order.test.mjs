// The Discord channel pickers follow the guild's categories, in Discord's own sidebar order (owner, 2026-10-08: "can
// we make the discord channel select respect category group hierarchy in the dropdown?"). The Share to our channels
// picker on a news story listed every channel flat, in API order; Syndicate now grouped them but in API order too.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderDiscordChannels, discordChannelOptionsHtml } from '../client-ui/src/discord-channel-order.mjs';
import { readGuildChannels } from '../workers/signup/membership-discord-channels.mjs';
import { GbtiNewsShare } from '../client-ui/src/elements/gbti-news-share.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

// The shape of the GBTI guild in the owner's screenshot, shuffled the way an API list can arrive. Ids are snowflakes,
// and on purpose they DISAGREE with the positions in each list (welcome, agriculture, and the gbti category are older
// than their neighbours but sit below them), so an order that ignored position would fail here.
const COMMUNITY = '900000000000000005';
const GBTI = '900000000000000003';
const GUILD = [
  { id: '900000000000000031', name: 'energy', type: 0, parentId: GBTI, position: 9 },
  { id: COMMUNITY, name: 'Community', type: 4, parentId: null, position: 1 },
  { id: '900000000000000012', name: 'rules', type: 0, parentId: null, position: 1 },
  { id: '900000000000000021', name: 'general-chat', type: 0, parentId: COMMUNITY, position: 0 },
  { id: '900000000000000030', name: '3d-printing', type: 0, parentId: GBTI, position: 0 },
  { id: GBTI, name: 'gbti', type: 4, parentId: null, position: 2 },
  { id: '900000000000000011', name: 'announcements', type: 5, parentId: null, position: 0 },
  { id: '900000000000000010', name: 'welcome', type: 0, parentId: null, position: 2 },
  { id: '900000000000000022', name: 'articles', type: 0, parentId: COMMUNITY, position: 1 },
  { id: '900000000000000029', name: 'agriculture', type: 0, parentId: GBTI, position: 1 },
  { id: '900000000000000023', name: 'citizens-band-1', type: 2, parentId: COMMUNITY, position: 5 }, // voice
  { id: '900000000000000004', name: 'Empty', type: 4, parentId: null, position: 3 },
];

test('channels come out in the sidebar order: uncategorized first, then each category with its channels', () => {
  const out = orderDiscordChannels(GUILD);
  assert.deepEqual(out.map((c) => `${c.category ?? '-'}/${c.name}`), [
    '-/announcements', '-/rules', '-/welcome',
    'Community/general-chat', 'Community/articles',
    'gbti/3d-printing', 'gbti/agriculture', 'gbti/energy',
  ]);
  assert.ok(!out.some((c) => c.type === 2 || c.type === 4), 'no voice channels and no category rows are pickable');
  assert.equal(GUILD[0].category, undefined, 'the input is not mutated');
});

test('the markup puts uncategorized channels first, then one group per category, and marks the choice', () => {
  const html = discordChannelOptionsHtml(orderDiscordChannels(GUILD), '900000000000000031');
  assert.equal(html,
    '<option value="900000000000000011">#announcements</option><option value="900000000000000012">#rules</option><option value="900000000000000010">#welcome</option>'
    + '<optgroup label="Community"><option value="900000000000000021">#general-chat</option><option value="900000000000000022">#articles</option></optgroup>'
    + '<optgroup label="gbti"><option value="900000000000000030">#3d-printing</option><option value="900000000000000029">#agriculture</option><option value="900000000000000031" selected>#energy</option></optgroup>');
  assert.doesNotMatch(html, /label="Empty"/, 'a category with nothing pickable gets no heading');
});

test('names and labels are escaped', () => {
  const html = discordChannelOptionsHtml([{ id: '1', name: '<b>x</b>', category: 'A "quoted" & <cat>' }]);
  assert.equal(html, '<optgroup label="A &quot;quoted&quot; &amp; &lt;cat&gt;"><option value="1">#&lt;b&gt;x&lt;/b&gt;</option></optgroup>');
});

test('a list cached before positions existed falls back to id order, which is creation order', () => {
  const noPos = GUILD.map(({ position, ...c }) => c);
  const out = orderDiscordChannels(noPos);
  assert.deepEqual(out.map((c) => `${c.category ?? '-'}/${c.name}`), [
    '-/welcome', '-/announcements', '-/rules',
    'gbti/agriculture', 'gbti/3d-printing', 'gbti/energy',
    'Community/general-chat', 'Community/articles',
  ]);
  // A newer snowflake can be one digit longer, and is still the larger number: compared as text it would sort first.
  const ids = orderDiscordChannels([
    { id: '1000000000000000000', name: 'new19', type: 0 },
    { id: '999999999999999999', name: 'old18', type: 0 },
  ]);
  assert.deepEqual(ids.map((c) => c.name), ['old18', 'new19']);
});

test('a channel whose category is not in the list stays pickable with the uncategorized ones', () => {
  const out = orderDiscordChannels([{ id: '5', name: 'orphan', type: 0, parentId: '404', position: 0 }]);
  assert.deepEqual(out.map((c) => [c.name, c.category]), [['orphan', null]]);
  assert.deepEqual(orderDiscordChannels(null), []);
  assert.equal(discordChannelOptionsHtml(null), '');
});

test('the news share picker renders the groups', () => {
  const el = Object.create(GbtiNewsShare.prototype);
  el.html = '';
  el.set = (m) => { el.html = m; };
  el.css = () => '';
  el.$ = () => null;
  el.$$ = () => [];
  Object.defineProperty(el, 'client', { value: null, configurable: true });
  el._story = { guid: 'g', title: 't', link: 'https://e.com/a', source: 's', category: 'Energy' };
  el._publisher = 'S';
  el._reset();
  el._status = { discord: { posted: false, mappedChannelId: null }, channels: {} };
  el._channels = orderDiscordChannels(GUILD);
  el._target = 'discord';
  el.render();
  assert.match(el.html, /<select id="ns-dc" data-dc ><option value="" selected>Pick a channel<\/option><option value="900000000000000011">#announcements<\/option>/);
  assert.match(el.html, /<optgroup label="gbti"><option value="900000000000000030">#3d-printing<\/option><option value="900000000000000029">#agriculture<\/option><option value="900000000000000031">#energy<\/option><\/optgroup><\/select>/);
});

test('both pickers load and render through the shared ordering', () => {
  const ns = read('client-ui/src/elements/gbti-news-share.mjs');
  assert.match(ns, /this\._channels = orderDiscordChannels\(r\?\.channels \|\| \[\]\)/);
  assert.match(ns, /discordChannelOptionsHtml\(this\._channels \|\| \[\], chosen\)/);
  const sn = read('client-ui/src/elements/gbti-syndicate-now.mjs');
  assert.match(sn, /this\._channels = orderDiscordChannels\(r\?\.channels \?\? \[\]\)/);
  assert.equal((sn.match(/discordChannelOptionsHtml\(this\._channels \|\| \[\], /g) || []).length, 2, 'the channel and the forward pickers');
  assert.doesNotMatch(sn, /\.section\b/, 'the old API-order grouping is gone');
});

test('the Worker passes Discord\'s position through, under a new cache key', async () => {
  const puts = [];
  const kv = { get: async () => null, put: async (k, v) => { puts.push([k, JSON.parse(v)]); } };
  const raw = [
    { id: '2', name: 'Community', type: 4, position: 1 },
    { id: '21', name: 'general-chat', type: 0, parent_id: '2', position: 3 },
    { id: '22', name: 'voice', type: 2, parent_id: '2', position: 0 },
    { id: '23', name: 'no-position', type: 0, parent_id: '2' },
  ];
  const fetchImpl = async () => ({ ok: true, json: async () => raw });
  const r = await readGuildChannels({ DISCORD_BOT_TOKEN: 't', DISCORD_GUILD_ID: 'g', SIGNUP_KV: kv }, { fetchImpl, now: () => 1 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.channels, [
    { id: '2', name: 'Community', type: 4, parentId: null, position: 1 },
    { id: '21', name: 'general-chat', type: 0, parentId: '2', position: 3 },
    { id: '23', name: 'no-position', type: 0, parentId: '2', position: 0 },
  ]);
  assert.equal(puts[0][0], 'discord:channels:v2', 'a list cached without positions is not served after the deploy');
});
