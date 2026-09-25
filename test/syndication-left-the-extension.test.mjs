// sow-399 (owner, 2026-09-24): "move all the syndication settings out of the extension and make sure their
// functionality is 100% available to superadmin in the public site." Two halves, checked together so neither can
// pass alone: nothing in the extension still mounts a syndication tool, and the website has every one of them.
// (A removal with no replacement, or a replacement with the old copy left behind, is what this exists to catch.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const TOOLS = ['gbti-channel-map-manager', 'gbti-syndication-tracker', 'gbti-social-queue', 'gbti-syndicate-now'];

test('no extension page, script or reader mounts a syndication tool', () => {
  const files = [
    ...readdirSync(new URL('../extension/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `extension/${f}`),
    ...readdirSync(new URL('../extension/src/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `extension/src/${f}`),
    'client-ui/src/elements/gbti-reader.mjs',
  ];
  assert.ok(files.length > 10, `control: expected the extension's pages and scripts, found ${files.length}`);
  for (const f of files) {
    const src = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const tool of TOOLS) {
      assert.ok(!src.includes(`<${tool}`) && !src.includes(`${tool}.mjs'`), `${f} still mounts or imports ${tool}`);
    }
  }
  assert.ok(!/data-social-queue/.test(read('extension/src/shell.mjs')), 'the Social Queue menu item is still in the extension menu');
  assert.ok(!/data-tab="syndication"/.test(read('extension/admin.html')), 'the Syndication tab is still in the extension admin page');
});

test('the activity bell sends a To approve notice to the website Syndication tab', () => {
  const bell = read('client-ui/src/elements/gbti-activity-bell.mjs');
  assert.match(bell, /href: `\$\{SITE\}\/admin\/#tab=syndication&sub=activity`/);
  assert.ok(!bell.includes("'admin.html#tab=syndication'"), 'the bell still links to the extension tab');
});

test('the website carries every syndication tool, each for superadmins', () => {
  const admin = read('src/pages/admin.astro');
  assert.match(admin, /data-tab="syndication" data-min="superadmin"/, 'the website Syndication tab');
  assert.match(admin, /data-panel="syndication"[\s\S]{0,120}<gbti-channel-map-manager>/, 'the Syndication tool in its card');
  assert.match(admin, /channels: 'syndication'/, 'an old #tab=channels link still lands on Syndication');
  assert.match(read('client-ui/src/elements/gbti-channel-map-manager.mjs'), /<gbti-syndication-tracker>/, 'Publishing Activity nests in the tool');

  const header = read('src/components/Header.astro');
  assert.match(header, /data-social-queue hidden>Social Queue</, 'the website avatar menu Social Queue item');
  assert.match(header, /eff\.role === 'superadmin' && !!readCookie\('gbti_csrf'\)/, 'the item shows for a superadmin web session only');
  assert.match(header, /gbti-social-queue\.mjs/, 'the popup loads the Social Queue element');

  for (const page of ['src/pages/articles/[slug].astro', 'src/pages/projects/[slug].astro', 'src/pages/prompts/[slug].astro', 'src/pages/shares/[author]/[id].astro']) {
    assert.match(read(page), /<SyndicateNow /, `${page} has no Manually syndicate button`);
  }
  const btn = read('src/components/SyndicateNow.astro');
  assert.match(btn, /identity\.role === 'superadmin' && readCookie\('gbti_csrf'\)/, 'the button reveals for a superadmin web session only');

  const client = read('src/lib/workbench-client.ts');
  const superOnly = client.slice(client.indexOf('const channelMapMethods'), client.indexOf('} : {};', client.indexOf('const channelMapMethods')));
  for (const m of ['syndicationQueue', 'approveSyndication', 'cancelSyndication', 'socialQueue', 'socialQueueAction', 'getSyndicateNow', 'syndicateNow']) {
    assert.match(superOnly, new RegExp(`\\b${m}\\(`), `the website client has no ${m} in its superadmin-only methods`);
  }
});

// The website tools are handed their OWN superadmin client, because most pages set a shared client without the
// superadmin methods and the last component to set one wins. An element with its own client must keep it through
// a later page-wide setClient, and must not re-render on that broadcast.
test('an element can carry its own client, and a later page-wide client does not replace it', async () => {
  const { GbtiElement, setClient } = await import('../client-ui/src/base.mjs');
  const page = { name: 'page' };
  const own = { name: 'own' };
  const later = { name: 'later' };
  setClient(page);
  const el = new GbtiElement();
  assert.equal(el.client, page, 'control: without its own client an element uses the page client');
  el.client = own;
  assert.equal(el.client, own);
  let renders = 0;
  el.render = () => { renders += 1; };
  Object.defineProperty(el, 'isConnected', { value: true });
  setClient(later); // the broadcast only reaches subscribed (connected) elements; call the handler directly
  el._onClient();
  assert.equal(el.client, own, 'a later page-wide client replaced the element own client');
  assert.equal(renders, 0, 'an element with its own client re-rendered on the page-wide broadcast');
  el.client = null;
  assert.equal(el.client, later, 'clearing the own client falls back to the page client');
  setClient(null);
});
