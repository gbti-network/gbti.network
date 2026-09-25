// sow-397 (owner, 2026-09-24): the extension's quick launch. The pure rules (defaults, merge, cap, address checks, the
// daily.dev once rule), the bundled official marks, and the pins that keep it inside the extension's permissions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as si from 'simple-icons';
import {
  QL_CAP, QL_MAX_CUSTOM, QL_NAME_MAX, QL_URL_MAX, QL_SYNC_KEY, DEFAULTS, GROUPS, DAILYDEV_PROBE_URL,
  normalizeUrl, displayHost, cleanName, letterFor, mergeState, toStored, barItems, overflowItems, setOn, move, moveBefore,
  addCustom, updateCustom, removeCustom, restoreDefaults, applyDailydevDetection, shouldProbeDailydev,
} from '../extension/src/quick-launch-core.mjs';
import { SI, BRAND_MARKS } from '../extension/src/quick-launch-marks.mjs';
import { markHtml } from '../extension/src/quick-launch.mjs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const ids = (items) => items.map((it) => it.id);
const onAll = (state, list) => list.reduce((s, id) => setOn(s, id, true), state);

test('the thirteen defaults the owner chose, every one https, and every one starts OFF', () => {
  assert.deepEqual(ids(DEFAULTS), ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'x', 'bluesky', 'linkedin', 'reddit', 'discord', 'devto', 'dailydev', 'substack']);
  assert.deepEqual(DEFAULTS.filter((d) => d.group === 'ai').map((d) => d.name), ['ChatGPT', 'Claude', 'Gemini', 'Grok', 'Perplexity'], 'keep the five');
  for (const d of DEFAULTS) assert.equal(normalizeUrl(d.url), d.url, `${d.id} is a clean https address`);
  const guild = src('workers/signup/wrangler.toml').match(/DISCORD_GUILD_ID = "(\d+)"/)[1];
  assert.equal(DEFAULTS.find((d) => d.id === 'discord').url, `https://discord.com/channels/${guild}`, 'Discord opens the GBTI server');
  const first = mergeState(null);
  assert.equal(first.items.filter((it) => it.on).length, 0, 'nothing is switched on at first run');
  assert.deepEqual(barItems(first), [], 'so the bar starts empty');
  assert.deepEqual(GROUPS.map((g) => g.label), ['Frontier AI', 'Social', 'Your destinations']);
});

test('every default is drawn with its official mark, and the simple-icons ones match the installed package', () => {
  for (const d of DEFAULTS) {
    const m = BRAND_MARKS[d.id];
    assert.ok(m && /^#[0-9a-f]{6}$/i.test(m.hex) && m.paths.length && m.viewBox, `${d.id} has a bundled mark`);
  }
  const key = { claude: 'siClaude', gemini: 'siGooglegemini', perplexity: 'siPerplexity', x: 'siX', bluesky: 'siBluesky', reddit: 'siReddit', discord: 'siDiscord', devto: 'siDevdotto', dailydev: 'siDailydotdev', substack: 'siSubstack' };
  assert.deepEqual(Object.keys(SI).sort(), Object.keys(key).sort());
  for (const [id, k] of Object.entries(key)) {
    assert.equal(SI[id].path, si[k].path, `${id}: the inlined path is simple-icons' current one (copy the new path if this fails)`);
    assert.equal(SI[id].hex, `#${si[k].hex}`, `${id}: brand color`);
  }
  // The three simple-icons lacks, each from the brand's own published icon (sources in quick-launch-marks.mjs).
  assert.equal(si.siOpenai, undefined);
  assert.equal(BRAND_MARKS.chatgpt.viewBox, '0 0 100 100');
  assert.equal(BRAND_MARKS.grok.paths.length, 2);
  const linkedin = src('client-ui/src/social-icons.mjs').match(/const LINKEDIN_PATH =\s*'([^']+)'/)[1];
  assert.ok(linkedin.startsWith(BRAND_MARKS.linkedin.paths[0]), 'LinkedIn is the standard mark the site uses, letters only');
});

test('a destination address is https only, with a real host, and a bare host gets https://', () => {
  assert.equal(normalizeUrl('news.ycombinator.com'), 'https://news.ycombinator.com/');
  assert.equal(normalizeUrl('  https://Example.com/a?b=1  '), 'https://example.com/a?b=1');
  for (const bad of ['', '   ', 'http://example.com', 'javascript:alert(1)', 'data:text/html,hi', 'ftp://example.com',
    'https://user:pw@example.com', 'https://localhost', 'localhost:3000', 'chrome://settings', `https://example.com/${'a'.repeat(QL_URL_MAX)}`]) {
    assert.equal(normalizeUrl(bad), null, JSON.stringify(bad));
  }
  assert.equal(displayHost('https://www.perplexity.ai/'), 'perplexity.ai');
  assert.equal(cleanName(`  Hacker\n  News ${'x'.repeat(60)}`).length, QL_NAME_MAX);
  assert.equal(letterFor('  hacker news'), 'H');
  assert.equal(letterFor('!?'), '?');
});

test('stored state merges over the defaults: order kept, groups kept together, unknown and malformed entries dropped', () => {
  const stored = {
    order: ['x', 'claude', 'c-abc', 'nope', 'claude', 'chatgpt'],
    on: ['x', 'c-abc', 'ghost'],
    custom: [
      { id: 'c-abc', name: 'Hacker News', url: 'https://news.ycombinator.com/' },
      { id: 'bad id', name: 'Bad', url: 'https://ok.example/' },
      { id: 'c-evil', name: 'Evil', url: 'javascript:alert(1)' },
      { id: 'c-abc', name: 'Duplicate', url: 'https://dup.example/' },
    ],
    dailydevAuto: true,
  };
  const st = mergeState(stored);
  assert.deepEqual(ids(st.items).slice(0, 5), ['claude', 'chatgpt', 'gemini', 'grok', 'perplexity'], 'AI first, in stored order, the rest after');
  assert.equal(st.items[5].id, 'x', 'Social after AI even though the stored order put X first');
  assert.deepEqual(ids(st.items.filter((it) => it.custom)), ['c-abc']);
  assert.equal(st.items.at(-1).id, 'c-abc', 'your own sites come last');
  assert.deepEqual(ids(barItems(st)), ['x', 'c-abc']);
  assert.equal(st.dailydevAuto, true);
  for (const junk of [undefined, null, 'x', 7, { order: 'x', on: {}, custom: {} }]) assert.equal(mergeState(junk).items.length, DEFAULTS.length);
});

test('what is written to sync round-trips, and the largest allowed list fits one sync item (8 KB)', () => {
  let st = mergeState(null);
  for (let i = 0; i < QL_MAX_CUSTOM; i++) {
    const r = addCustom(st, { url: `https://site-${i}.example.com/${'p'.repeat(QL_URL_MAX - 40)}`, name: 'N'.repeat(QL_NAME_MAX) }, () => `c-${'z'.repeat(20)}${i}`);
    assert.ok(r.state, `custom ${i} added`);
    st = r.state;
  }
  st = onAll(st, ['claude', 'x', 'dailydev']);
  const stored = toStored(st);
  assert.deepEqual(toStored(mergeState(JSON.parse(JSON.stringify(stored)))), stored, 'round trip');
  const bytes = new TextEncoder().encode(QL_SYNC_KEY + JSON.stringify(stored)).length;
  assert.ok(bytes < 8192, `${bytes} bytes`);
  assert.equal(addCustom(st, { url: 'https://one-more.example/' }).error, 'too-many');
});

test('the bar holds 8: the first 8 switched on, in order; the rest are listed as left out', () => {
  const ten = ['chatgpt', 'claude', 'gemini', 'grok', 'perplexity', 'x', 'bluesky', 'linkedin', 'reddit', 'discord'];
  const st = onAll(mergeState(null), [...ten].reverse());
  assert.equal(QL_CAP, 8);
  assert.deepEqual(ids(barItems(st)), ten.slice(0, 8));
  assert.deepEqual(ids(overflowItems(st)), ['reddit', 'discord']);
  const moved = move(move(st, 'discord', -1), 'discord', -1);
  assert.deepEqual(ids(overflowItems(moved)), ['linkedin', 'reddit'], 'moving one up brings it into the bar');
});

test('reordering stays inside a group, by keyboard step or by drop position', () => {
  const st = mergeState(null);
  assert.equal(move(st, 'chatgpt', -1), st, 'the first row does not move up');
  assert.equal(move(st, 'perplexity', 1), st, 'the last AI row does not move into Social');
  assert.deepEqual(ids(move(st, 'claude', -1).items).slice(0, 2), ['claude', 'chatgpt']);
  assert.deepEqual(ids(moveBefore(st, 'grok', 'chatgpt').items).slice(0, 5), ['grok', 'chatgpt', 'claude', 'gemini', 'perplexity']);
  assert.equal(moveBefore(st, 'grok', 'x'), st, 'a drop on another group is ignored');
  assert.deepEqual(ids(moveBefore(st, 'chatgpt', null).items).slice(0, 5), ['claude', 'gemini', 'grok', 'perplexity', 'chatgpt'], 'null = end of its group');
});

test('your own destinations: added switched on, checked, edited and removed', () => {
  const st = mergeState(null);
  assert.equal(addCustom(st, { url: 'http://insecure.example' }).error, 'invalid-url');
  const a = addCustom(st, { url: 'news.ycombinator.com', name: '' }, () => 'c-hn');
  assert.equal(a.item.name, 'news.ycombinator.com', 'the host stands in for a missing name');
  assert.equal(a.item.on, true, '"Add to your bar" puts it in the bar');
  assert.deepEqual(ids(barItems(a.state)), ['c-hn']);
  assert.equal(addCustom(a.state, { url: 'https://news.ycombinator.com/' }).error, 'duplicate');
  const u = updateCustom(a.state, 'c-hn', { name: 'Hacker News' });
  assert.equal(u.state.items.find((it) => it.id === 'c-hn').name, 'Hacker News');
  assert.equal(updateCustom(a.state, 'c-hn', { url: 'ftp://x.example' }).error, 'invalid-url');
  assert.equal(updateCustom(a.state, 'claude', { name: 'Mine now' }).error, 'not-found', 'a built-in site cannot be renamed');
  assert.deepEqual(ids(removeCustom(a.state, 'c-hn').items), ids(st.items));
  assert.equal(removeCustom(a.state, 'claude').items.length, a.state.items.length, 'a built-in site cannot be removed');
});

test('Restore defaults resets the built-in sites (all off, first order) and keeps your own and the daily.dev record', () => {
  let st = addCustom(onAll(move(mergeState(null), 'claude', -1), ['claude', 'x']), { url: 'https://mine.example/' }, () => 'c-mine').state;
  st = { ...st, dailydevAuto: true };
  const r = restoreDefaults(st);
  assert.deepEqual(ids(r.items), [...ids(DEFAULTS), 'c-mine']);
  assert.deepEqual(ids(barItems(r)), ['c-mine']);
  assert.equal(r.dailydevAuto, true, 'detection will not switch daily.dev back on after a restore');
});

test('daily.dev is switched on the first time it is detected, and never again after that', () => {
  const st = mergeState(null);
  assert.equal(applyDailydevDetection(st, false).changed, false);
  assert.equal(applyDailydevDetection(st, undefined).changed, false);
  const first = applyDailydevDetection(st, true);
  assert.equal(first.changed, true);
  assert.deepEqual(ids(barItems(first.state)), ['dailydev']);
  const off = setOn(first.state, 'dailydev', false);
  const again = applyDailydevDetection(mergeState(toStored(off)), true);
  assert.equal(again.changed, false, 'switched off by the member, it stays off');
  assert.deepEqual(barItems(again.state), []);
  const now = 1_000_000_000_000;
  assert.equal(shouldProbeDailydev({ seen: true, checkedAt: 0, now }), false, 'found once: never probe again');
  assert.equal(shouldProbeDailydev({ seen: false, checkedAt: now - 1000, now }), false, 'at most once a day');
  assert.equal(shouldProbeDailydev({ seen: false, checkedAt: now - 86_400_000, now }), true);
  assert.equal(shouldProbeDailydev({ seen: undefined, checkedAt: undefined, now }), true);
  assert.equal(shouldProbeDailydev({ seen: false, checkedAt: now + 60_000, now }), true, 'a clock set back does not stop it for good');
});

test('no new permission: the manifest asks for exactly what it asked for before', () => {
  const m = JSON.parse(src('extension/manifest.json'));
  assert.deepEqual(m.permissions, ['storage', 'identity']);
  assert.deepEqual(m.host_permissions, ['https://gbti.network/*', 'https://signup.gbti.network/*', 'https://api.github.com/*', 'https://github.com/*']);
  assert.equal(m.optional_permissions, undefined);
  assert.equal(DAILYDEV_PROBE_URL, 'chrome-extension://jlmpjdjjbgclbocgajdjefcidcncaied/css/companion.css');
});

test('the shell mounts the quick launch; the old daily.dev switcher and its management check are gone', () => {
  const shell = src('extension/src/shell.mjs');
  assert.match(shell, /<span class="nt-apps" data-apps><\/span>/);
  assert.match(shell, /mountQuickLaunch\(root\.querySelector\('\[data-apps\]'\)\)/);
  assert.doesNotMatch(shell, /chrome\.management\??\.get\(|data-open-dailydev|app\.daily\.dev\/favicon/);
  const ql = src('extension/src/quick-launch.mjs');
  assert.match(ql, /class="nt-app ql-go" href="\$\{esc\(it\.url\)\}" target="_blank" rel="noopener noreferrer"/, 'a destination opens in a new tab');
  assert.match(ql, /write\('sync', \{ \[QL_SYNC_KEY\]: stored \}\)/, 'the list is saved to Chrome sync');
  assert.match(ql, /write\('local', \{ \[QL_ICONS_KEY\]: ICONS \}\)/, 'icons are saved locally, never to sync');
  const content = src('extension/src/content.mjs');
  assert.match(content, /fetch\(DAILYDEV_PROBE_URL, \{ cache: 'no-store' \}\)/);
  assert.match(content, /\nprobeDailydev\(\);\n/);
  const css = src('extension/shell.css');
  assert.match(css, /\.nt-apps:hover \.ql-more, \.nt-apps:focus-within \.ql-more, \.nt-apps\.is-empty \.ql-more \{ max-width: 48px;/, 'hover, focus, or an empty bar unfolds settings');
  assert.match(css, /\.nt-norail \.nt-apps, \.nt-norail \.nt-apps\.show \{ display: none; \}/, 'still hidden in a narrow window');
});

test('an icon is the bundled mark, a stored image data URL, or a letter; nothing else reaches an img src', () => {
  assert.match(markHtml({ id: 'claude', name: 'Claude' }), /^<span class="ql-ic" style="--ql-c:#D97757" aria-hidden="true"><svg viewBox="0 0 24 24"/);
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  assert.match(markHtml({ id: 'c-a', name: 'A', custom: true }, { 'c-a': png }), new RegExp(`<img src="${png.replace(/[+/=.]/g, (c) => `\\${c}`)}" alt="" />`));
  for (const bad of ['javascript:alert(1)', 'https://evil.example/x.png', 'data:text/html;base64,PHNjcmlwdD4=', 'data:image/png;base64,"><script>']) {
    assert.match(markHtml({ id: 'c-a', name: 'Acme', custom: true }, { 'c-a': bad }), /^<span class="ql-ic ql-letter" aria-hidden="true">A<\/span>$/, bad);
  }
  assert.match(markHtml({ id: 'c-b', name: '<b>', custom: true }), /ql-letter" aria-hidden="true">B</, 'the letter is a letter, never markup');
  assert.match(markHtml({ id: 'claude', name: 'Mine', custom: true }), /ql-letter/, 'a custom site never borrows a brand mark by id');
});
