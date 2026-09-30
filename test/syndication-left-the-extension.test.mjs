// sow-399 (owner, 2026-09-24): "move all the syndication settings out of the extension and make sure their
// functionality is 100% available to superadmin in the public site." Two halves, checked together so neither can
// pass alone: nothing in the extension still mounts a syndication tool, and the website has every one of them.
// (A removal with no replacement, or a replacement with the old copy left behind, is what this exists to catch.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const TOOLS = ['gbti-channel-map-manager', 'gbti-syndication-tracker', 'gbti-social-queue', 'gbti-syndicate-now'];
// sow-419 (owner, 2026-09-28: "I want to add social queue support back into the extension for superadmins. I miss
// it."): the ONE exception. The Social Queue popup is back in the extension's avatar menu, mounted by the shell and
// nowhere else. The other three tools stay on the website only.
const ALLOWED = { 'gbti-social-queue': ['extension/src/shell.mjs'] };

test('no extension page, script or reader mounts a syndication tool, except the Social Queue from the shell', () => {
  const files = [
    ...readdirSync(new URL('../extension/', import.meta.url)).filter((f) => f.endsWith('.html')).map((f) => `extension/${f}`),
    ...readdirSync(new URL('../extension/src/', import.meta.url)).filter((f) => f.endsWith('.mjs')).map((f) => `extension/src/${f}`),
    'client-ui/src/elements/gbti-reader.mjs',
  ];
  assert.ok(files.length > 10, `control: expected the extension's pages and scripts, found ${files.length}`);
  for (const f of files) {
    const src = read(f).replace(/<!--[\s\S]*?-->/g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const tool of TOOLS) {
      if ((ALLOWED[tool] || []).includes(f)) continue;
      assert.ok(!src.includes(`<${tool}`) && !src.includes(`${tool}.mjs'`), `${f} still mounts or imports ${tool}`);
    }
  }
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

  // The superadmin-only block moved to workbench-client-admin.ts at the 900-line split; read the client and it together.
  const client = read('src/lib/workbench-client.ts') + '\n' + read('src/lib/workbench-client-admin.ts');
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

test('sow-419: the extension Social Queue is back, for superadmins only, and alone', () => {
  const shell = read('extension/src/shell.mjs');
  assert.match(shell, /import '\.\.\/\.\.\/client-ui\/src\/elements\/gbti-social-queue\.mjs';/, 'the shell loads the element');
  assert.match(shell, /<button class="mi" role="menuitem" type="button" data-social-queue data-super-only hidden>Social Queue<\/button>/,
    'the avatar menu item, hidden until the superadmin gate reveals it');
  assert.match(shell, /root\.querySelectorAll\('\[data-super-only\]'\)\.forEach\(\(el\) => \{ el\.hidden = !showSuper; \}\)/, 'the gate that reveals it');
  assert.match(shell, /const showSuper = \(RANK\[status\.role\] \?\? 0\) >= RANK\.superadmin;/);
  assert.match(shell, /querySelector\('\[data-social-queue\]'\)\?\.addEventListener\('click', \(\) => \{ close\(\); openSocialQueueModal\(\); \}\)/);
  assert.match(shell, /overlay\.innerHTML = `<gbti-social-queue><\/gbti-social-queue>`;/, 'the popup mounts the queue');
  assert.match(shell, /addEventListener\('gbti-social-close', close\)/, 'its X closes it');
  assert.match(read('extension/src/ext-dispatch.mjs'), /case '\/api\/social-queue':/, 'the relay it calls');
});
