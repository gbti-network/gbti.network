// sow-316: every heart and collection pill on the site is upgraded for a website session from ONE place.
//
// A first version wired the upgrade per surface (the feed, then the content pages), and an audit of the built
// site found five surfaces still inert: the prompt and project directories, member profiles, share pages and
// two utilities. A signed-in member clicked a heart there and met the sign-in dialog. The wiring now runs from
// BaseLayout, which every page but the iframe embed uses. These tests pin the decision (pure), the order of the
// browser half, that no surface keeps a private copy, and that the layout covers every page that could render
// a control.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { shouldUpgradeSaveControls, websiteClientArgs, cookieValue } from '../src/lib/save-controls-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // strip comments before matching

const SIGNAL = { login: 'stefanoginella', githubId: 123 };
const BASE = { signal: SIGNAL, csrf: 'tok', extension: undefined, hasControls: true, wired: false };

test('the decision: upgrade exactly when a website session can write, controls exist, and nothing else owns them', () => {
  assert.equal(shouldUpgradeSaveControls(BASE), true);
  assert.equal(shouldUpgradeSaveControls({ ...BASE, signal: null }), false, 'signed out keeps the sign-in dialog');
  assert.equal(shouldUpgradeSaveControls({ ...BASE, signal: { githubId: 1 } }), false, 'a signal with no login is not a session');
  assert.equal(shouldUpgradeSaveControls({ ...BASE, csrf: null }), false, 'no CSRF cookie: the control would fail on every press');
  assert.equal(shouldUpgradeSaveControls({ ...BASE, extension: '1' }), false, 'the extension owns the controls');
  assert.equal(shouldUpgradeSaveControls({ ...BASE, hasControls: false }), false, 'nothing to upgrade');
  assert.equal(shouldUpgradeSaveControls({ ...BASE, wired: true }), false, 'once per page');
});

test('the client is built from the same three fields whoever asks for it', () => {
  assert.deepEqual(websiteClientArgs(SIGNAL, 'https://signup.gbti.network'), { signupBase: 'https://signup.gbti.network', login: 'stefanoginella', githubId: '123' });
  assert.deepEqual(websiteClientArgs({ login: 'x' }, undefined), { signupBase: '', login: 'x', githubId: null });
});

test('cookieValue reads one cookie and nothing else', () => {
  assert.equal(cookieValue('a=1; gbti_csrf=abc; b=2', 'gbti_csrf'), 'abc');
  assert.equal(cookieValue('gbti_csrf=; b=2', 'gbti_csrf'), null, 'an empty value is no cookie');
  assert.equal(cookieValue('gbti_csrf_other=zzz', 'gbti_csrf'), null, 'a prefix is not the name');
  assert.equal(cookieValue('', 'gbti_csrf'), null);
});

test('the layout every page uses runs the upgrade at parse time and on every later signal', () => {
  const layout = code(read('src/layouts/BaseLayout.astro'));
  assert.match(layout, /import \{ upgradeSaveControls \} from '\.\.\/lib\/save-controls'/);
  assert.match(layout, /upgradeSaveControls\(currentIdentity\(readMemberSignal\(\)\)\);/, 'the first paint, when the cookie session is already known');
  assert.match(layout, /onMemberSignal\(upgradeSaveControls\);/, 'and the hydrated signal that arrives later');
});

test('the browser half sets the client BEFORE loading either element, and yields on the pure decision', () => {
  const src = code(read('src/lib/save-controls.ts'));
  assert.match(src, /shouldUpgradeSaveControls\(\{/, 'the decision is the shared one, not a local copy');
  const setAt = src.indexOf('setClient(client)');
  const favAt = src.indexOf("elements/gbti-favorite.mjs");
  const colAt = src.indexOf("elements/gbti-collection.mjs");
  assert.ok(setAt > 0 && favAt > 0 && colAt > 0, 'client set + both element imports must be present');
  assert.ok(setAt < favAt && setAt < colAt, 'an element upgraded before the client exists renders as signed out and sticks');
});

test('no surface keeps a private copy of the upgrade; the feed takes the page client for its follow pills', () => {
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (/\.(astro|ts|mjs)$/.test(n)) out.push(p); } return out; };
  const importers = walk(join(ROOT, 'src')).filter((p) => /elements\/gbti-(favorite|collection)\.mjs/.test(code(readFileSync(p, 'utf8')))).map((p) => p.replace(ROOT, ''));
  assert.deepEqual(importers, ['src/lib/save-controls.ts'], 'exactly one importer of the two element modules');
  const feed = code(read('src/components/feeds/FeedList.astro'));
  assert.match(feed, /websiteClient\(signal\)/, 'the feed uses the shared page client');
  assert.doesNotMatch(feed, /createWorkbenchClient\(/, 'and no longer builds its own');
  const ca = code(read('src/components/ContentActions.astro'));
  assert.doesNotMatch(ca, /upgradeForWebsiteSession|createWorkbenchClient\(/, 'the content page has no private upgrade either');
});

test('the extension deep-link path on content pages is untouched', () => {
  const ca = code(read('src/components/ContentActions.astro'));
  assert.match(ca, /if \(!installed\(\)\) return;/, 'the capture-phase handler still yields without the extension');
  assert.match(ca, /openInExtension\(signin\.closest\('gbti-collection'\) \? 'collect' : 'favorite'\)/);
});

test('coverage: every page that could render a save control goes through BaseLayout', () => {
  const walk = (dir, out = []) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) walk(p, out); else if (n.endsWith('.astro')) out.push(p); } return out; };
  const pages = walk(join(ROOT, 'src/pages'));
  // A known-subject control rather than a numeric floor: the walk must have found the homepage and the embed.
  const names = pages.map((p) => p.replace(ROOT, ''));
  assert.ok(names.includes('src/pages/index.astro') && names.includes('src/pages/embed.astro'), `the walk missed known pages: ${names.length} found`);
  // A page is inside the layout when its own source names BaseLayout, or when a component it imports from
  // src/components does (the three invite landers render through one shared InviteLander since sow-243). The
  // indirection is followed ONE level and only into files that exist, so a page cannot satisfy this by naming
  // a layout in a comment or importing a component that never mounts one.
  const layoutBearingImport = (p) => {
    const src = readFileSync(p, 'utf8');
    for (const m of src.matchAll(/import \w+ from '((?:\.\.\/)+components\/[^']+\.astro)'/g)) {
      const dep = join(p, '..', m[1]);
      if (existsSync(dep) && /BaseLayout/.test(readFileSync(dep, 'utf8'))) return true;
    }
    return false;
  };
  const outside = pages.filter((p) => !/BaseLayout/.test(readFileSync(p, 'utf8')) && !layoutBearingImport(p)).map((p) => p.replace(ROOT, ''));
  assert.deepEqual(outside, ['src/pages/embed.astro'], 'the iframe embed is the only page outside the layout');
  const viaComponent = pages.filter((p) => !/BaseLayout/.test(readFileSync(p, 'utf8')) && layoutBearingImport(p)).map((p) => p.replace(ROOT, '')).sort();
  assert.deepEqual(viaComponent, ['src/pages/codeable-invite/index.astro', 'src/pages/curator-invite/index.astro', 'src/pages/member-invite/index.astro'], 'the pages that reach the layout through a component are exactly the three invite landers');
  const embed = readFileSync(join(ROOT, 'src/pages/embed.astro'), 'utf8');
  assert.doesNotMatch(embed, /FavoriteButton|CollectionButton|gbti-favorite|gbti-collection/, 'and it renders no save control');
});
