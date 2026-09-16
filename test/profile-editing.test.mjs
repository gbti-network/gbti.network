// sow-346: members edit their profile in the WorkBench (a Profile tab), on the website as well as the npm CMS.
//
// Owner decision 2026-09-16: editing lives in the WorkBench, plus an "Edit profile" link on the member's own
// profile page. The defect this closes was measured before the build: the profile editor loaded through a
// listing the website does not have and turned every failure into "no profile", so on the website it opened
// BLANK for a member who has one, and Save would have replaced the real profile.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { setClient } from '../client-ui/src/base.mjs';
import { accountKey } from '../client-ui/src/welcome-core.mjs';
import { GbtiProfileEditor } from '../client-ui/src/elements/gbti-profile-editor.mjs';
import { GbtiWorkspace } from '../client-ui/src/elements/gbti-workspace.mjs';
import { profileStrip, isProfilePath, parseWorkspaceTab, parseWorkspaceEdit, resolveTab } from '../client-ui/src/workspace-core.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const notFound = () => Object.assign(new Error('could not load that item'), { code: 'not-found' });
const REAL = { displayName: 'Alice A', headline: 'Builder', status: 'published', pronouns: 'they/them', links: { github: 'https://github.com/alice' }, skills: ['go'] };

/** The website host: no profile listing, identity from status, a cookie-session read by path. */
function website(over = {}) {
  const calls = { publish: [], saveDraft: [], setPrefs: [] };
  return {
    calls,
    status: async () => ({ authenticated: true, membership: 'paid', identity: { login: 'alice', username: 'alice' } }),
    listContent: async () => ({ items: [] }),
    getContentItem: async () => ({ frontmatter: structuredClone(REAL), body: 'My bio' }),
    getPrefs: async () => ({ onboarding: null }),
    setPrefs: async (p) => { calls.setPrefs.push(p); return {}; },
    publish: async (a) => { calls.publish.push(a); return {}; },
    saveDraft: async (a) => { calls.saveDraft.push(a); return { state: 'staged' }; },
    ...over,
  };
}

/** A DOM-free editor with a stand-in shadow root, so render() output can be read. */
function fakeRoot() {
  return { innerHTML: '', firstChild: null, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
}
async function editor(client) {
  setClient(client);
  const el = new GbtiProfileEditor();
  el.root = fakeRoot();
  el.events = [];
  el.dispatchEvent = (e) => el.events.push(e);
  await el._load();
  return el;
}

// ---- loading ----

test('THE DEFECT: on the website the editor opens the member\'s real profile, not a blank one', async () => {
  const el = await editor(website());
  assert.equal(el._readState, 'found');
  assert.equal(el._path, 'members/alice/profile.md');
  assert.equal(el._model.displayName, 'Alice A');
  assert.equal(el._model.headline, 'Builder');
  assert.equal(el._model.body, 'My bio');
  assert.match(el.root.innerHTML, /data-save/, 'the form is shown');
});

test('a read that did not answer shows a message and no Save, and a save attempt writes nothing', async () => {
  // Handles typed in this browser during welcome are left in place for a read that works.
  const key = accountKey('gbti-welcome-socials', { login: 'alice', username: 'alice' });
  const store = new Map([[key, JSON.stringify({ x: '@alice' })]]);
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const failures = {
    'a network error': website({ getContentItem: async () => { throw Object.assign(new Error('http-502'), { code: 'http-502' }); } }),
    'a host that answered nothing': website({ getContentItem: async () => null }),
  };
  for (const [name, client] of Object.entries(failures)) {
    const el = await editor(client);
    assert.equal(el._readState, 'failed', name);
    assert.match(el.root.innerHTML, /Your profile could not be read just now/, name);
    assert.doesNotMatch(el.root.innerHTML, /data-save/, `${name}: no Save button`);
    el._model.displayName = 'Blank';
    await el._save();
    assert.equal(client.calls.publish.length + client.calls.saveDraft.length, 0, `${name}: nothing written`);
    assert.ok(store.has(key), `${name}: the browser's handles are kept`);
  }
  const ok = await editor(website());
  assert.equal(ok._model.links.x, '@alice', 'control: a read that works offers them');
  assert.equal(store.has(key), false);
  delete globalThis.localStorage;
});

test('only a read that answered "not found" starts a new profile, named after the login', async () => {
  const client = website({ getContentItem: async () => { throw notFound(); } });
  const el = await editor(client);
  assert.equal(el._readState, 'absent');
  assert.equal(el._model.displayName, 'alice');
  await el._save();
  assert.equal(client.calls.publish.length, 1);
  assert.equal(client.calls.publish[0].path, undefined, 'a new profile takes the member\'s own path');
  assert.equal(client.calls.publish[0].input.displayName, 'alice');
});

test('signed out, or no client: a host-neutral sign-in note', async () => {
  const el = await editor(website({ status: async () => ({ authenticated: false }) }));
  assert.match(el.root.innerHTML, /Sign in to edit your profile\./);
  setClient(null);
  const bare = new GbtiProfileEditor();
  bare.root = fakeRoot();
  bare.render();
  assert.match(bare.root.innerHTML, /Sign in to edit your profile\./);
  assert.doesNotMatch(read('client-ui/src/elements/gbti-profile-editor.mjs'), /GBTI client or extension|Sign in with the GBTI client/);
});

// ---- saving ----

test('a save keeps the fields the editor does not manage, and clearing a managed field removes it', async () => {
  const client = website();
  const el = await editor(client);
  el._model.headline = '';
  el._model.links.x = '@alice';
  await el._save();
  const { input, body, path } = client.calls.publish[0];
  assert.equal(path, 'members/alice/profile.md');
  assert.equal(body, 'My bio');
  assert.equal(input.status, 'published', 'status survives');
  assert.equal(input.pronouns, 'they/them', 'a field the editor does not know survives');
  assert.equal('headline' in input, false, 'a cleared headline is removed, not kept');
  assert.deepEqual(input.skills, ['go']);
  assert.deepEqual(input.links, { github: 'https://github.com/alice', x: 'https://x.com/alice' }, 'handles become links the profile page shows');
});

test('a publish carrying links finishes the socials step and tells the WorkBench', async () => {
  const client = website();
  const el = await editor(client);
  await el._save();
  assert.deepEqual(client.calls.setPrefs, [{ onboardingSocialsSaved: true }]);
  assert.equal(el.events.length, 1);
  assert.equal(el.events[0].type, 'gbti-profile-saved');
  assert.equal(el.events[0].detail.frontmatter.displayName, 'Alice A');
  assert.equal(el._msgKind, 'ok');
});

test('no links, a trial member\'s private save, or a failed publish: the socials step is left alone', async () => {
  const bare = website({ getContentItem: async () => ({ frontmatter: { displayName: 'Alice A' }, body: '' }) });
  const a = await editor(bare);
  await a._save();
  assert.equal(bare.calls.publish.length, 1);
  assert.deepEqual(bare.calls.setPrefs, []);

  const trial = website({ status: async () => ({ authenticated: true, membership: 'trial', identity: { login: 'alice', username: 'alice' } }) });
  const b = await editor(trial);
  await b._save();
  assert.equal(trial.calls.saveDraft.length, 1);
  assert.equal(trial.calls.publish.length, 0);
  assert.deepEqual(trial.calls.setPrefs, []);
  assert.equal(b.events.length, 0);

  const broken = website({ publish: async () => { throw new Error('the gate is down'); } });
  const c = await editor(broken);
  await c._save();
  assert.deepEqual(broken.calls.setPrefs, []);
  assert.equal(c.events.length, 0);
  assert.equal(c._msgKind, 'err');
  assert.match(c._msg, /the gate is down/);
});

test('handles a trial member kept on the account fill only the empty links', async () => {
  const client = website({ getPrefs: async () => ({ onboarding: { socials: { x: '@alice', github: 'someone-else' } } }) });
  const el = await editor(client);
  assert.equal(el._model.links.x, '@alice');
  assert.equal(el._model.links.github, 'https://github.com/alice', 'a saved link wins');
  const unread = await editor(website({ getPrefs: async () => { throw new Error('offline'); } }));
  assert.equal(unread._readState, 'found', 'an unread account record changes nothing');
});

// ---- the WorkBench keeps one editor ----

test('a client broadcast never rebuilds a form that may hold edits; a view without a form loads again', async () => {
  const el = await editor(website());
  assert.equal(el.skipClientRender(), true);
  const failed = await editor(website({ getContentItem: async () => null }));
  assert.equal(failed.skipClientRender(), false);
  assert.equal(failed._loaded, false, 'the next render reads again');
});

test('moving the kept editor back into the page does not rebuild it', async () => {
  const el = await editor(website());
  el.root.firstChild = {};
  el.root.innerHTML = 'TYPED';
  el.connectedCallback();
  assert.equal(el.root.innerHTML, 'TYPED');
  el.disconnectedCallback();
});

test('a first connect renders', () => {
  const fresh = new GbtiProfileEditor();
  fresh.root = fakeRoot();
  setClient(null);
  fresh.connectedCallback();
  assert.match(fresh.root.innerHTML, /Sign in/);
  fresh.disconnectedCallback();
});

// ---- the WorkBench tab and strip ----

test('the strip: Edit for a profile, Create when there is none, nothing when the read failed or on the tab itself', () => {
  assert.deepEqual(profileStrip({ state: 'found', item: { frontmatter: { displayName: 'Alice A' } } }, 'overview'), { name: 'Alice A', action: 'Edit profile' });
  assert.deepEqual(profileStrip({ state: 'absent', item: null }, 'post'), { name: 'You have no public profile yet', action: 'Create your profile' });
  assert.equal(profileStrip({ state: 'failed' }, 'overview'), null);
  assert.equal(profileStrip(null, 'overview'), null);
  assert.equal(profileStrip({ state: 'found', item: {} }, 'profile'), null);
  assert.equal(profileStrip({ state: 'found', item: {} }, 'saved').name, 'Your profile');
});

test('the WorkBench reads the profile the safe way, and a failed read shows no strip', async () => {
  const strip = async (client) => {
    setClient(client);
    const el = new GbtiWorkspace();
    Object.assign(el, { _tab: 'prs', _prs: [], _editing: null, _cache: {} });
    await el._loadProfile();
    return el._profileHtml();
  };
  assert.match(await strip(website()), /<b>Alice A<\/b><button class="btn" data-profile type="button">Edit profile<\/button>/);
  assert.match(await strip(website({ getContentItem: async () => { throw notFound(); } })), /Create your profile/);
  assert.equal(await strip(website({ getContentItem: async () => { throw new Error('offline'); } })), '');
  setClient(null);
  const early = new GbtiWorkspace();
  await early._loadProfile();
  assert.equal(early._ownProfileAsked, undefined, 'no client yet: asked again when it arrives');
});

test('the Profile tab is a real tab, and a profile edit link opens it', () => {
  assert.equal(parseWorkspaceTab('#tab=profile'), 'profile');
  assert.equal(isProfilePath(parseWorkspaceEdit('#tab=overview&edit=members%2Falice%2Fprofile.md')), true);
  assert.equal(isProfilePath('members/alice/posts/x/index.md'), false);
  assert.equal(isProfilePath('members/../profile.md'), false);
  const tabs = [{ id: 'overview' }, { id: 'profile', authoring: true }];
  assert.equal(resolveTab('profile', tabs, true), 'profile');
  assert.equal(resolveTab('profile', tabs, false), 'overview', 'the extension shows no Profile tab');
});

test('the element wiring: the tab mounts one kept editor, the strip opens the tab, the extension opens the website tab', () => {
  const src = read('client-ui/src/elements/gbti-workspace.mjs');
  assert.match(src, /\{ id: 'profile', label: 'Profile', authoring: true \}/);
  assert.match(src, /if \(isProfilePath\(path\)\) \{ this\._tab = 'profile'; return null; \}/);
  assert.match(src, /if \(this\._tab === 'profile'\) return '<div data-profile-slot><\/div>';/);
  assert.match(src, /this\.\$\('\[data-profile-slot\]'\)\?\.append\(this\._profileEd \|\|= document\.createElement\('gbti-profile-editor'\)\)/);
  assert.match(src, /window\.open\('https:\/\/gbti\.network\/workbench\/#tab=profile', '_blank', 'noopener'\)/);
  assert.match(src, /this\._tab = 'profile'; this\._writeHash\('#tab=profile'\); this\.render\(\);/);
  assert.match(src, /if \(this\.client && !this\._ownProfileAsked\) this\._loadProfile\(\);/);
  assert.match(src, /import '\.\/gbti-profile-editor\.mjs';/);
  assert.equal(src.split('\n').length - 1, 1117, 'the WorkBench element does not grow past its size');
});

test('the copy follows the writing rules', () => {
  const src = read('client-ui/src/elements/gbti-profile-editor.mjs');
  for (const s of ['Your profile could not be read just now, so it cannot be edited safely. Reload the page to try again.', 'Sign in to edit your profile.']) {
    assert.ok(src.includes(s));
    assert.doesNotMatch(s, /[–—]|\b\w+'(s|t|re|ll|ve|d)\b/);
  }
  const strip = [profileStrip({ state: 'absent' }, 'x'), profileStrip({ state: 'found', item: {} }, 'x')].flatMap((p) => [p.name, p.action]).join(' ');
  assert.doesNotMatch(strip, /[–—]|\b\w+'(s|t|re|ll|ve|d)\b/);
});

// ---- the profile page link and the handbook ----

test('the profile page carries a hidden Edit profile link that only its member is shown', () => {
  const page = read('src/pages/members/[username].astro');
  assert.match(page, /<a class="btn btn-ghost" data-profile-edit data-profile-owner=\{d\.username\} href="\/workbench\/#tab=profile" hidden>Edit profile<\/a>/);
  assert.match(page, /wireEditAffordance\('\[data-profile-edit\]', 'data-profile-owner', isOwnProfile\);/);
  assert.match(page, /import \{ isOwnProfile \} from '\.\.\/\.\.\/lib\/content-edit\.mjs';/);
  const lib = read('src/lib/content.ts');
  assert.match(lib, /allow: \(identity: MemberSignal \| null, owner: string\) => boolean = canEditItem\)/, 'every other page keeps the owner-or-superadmin rule');
  assert.match(lib, /btn\.hidden = !allow\(identity, owner\);/);
  assert.equal(parseWorkspaceTab('#tab=profile'), 'profile', 'the link names a tab the WorkBench opens');
});

test('the handbook says where profile editing lives', () => {
  const hb = read('src/pages/handbook/index.astro');
  const sec = hb.slice(hb.indexOf('<section class="hb-sec" id="profile"'), hb.indexOf('</section>', hb.indexOf('id="profile"')));
  assert.match(sec, /Profile tab of the\s+<a href="\/workbench\/#tab=profile">WorkBench<\/a>/);
  assert.match(sec, /Edit profile link on your own profile\s+page/);
  assert.doesNotMatch(sec, /Edit it from\s+<a href="\/account\/">/, 'the account page never edited profiles');
  assert.doesNotMatch(sec, /location/, 'the editor keeps location but does not offer it');
  assert.doesNotMatch(sec.replace(/<[^>]+>/g, ' '), /[–—]|\b\w+'(s|t|re|ll|ve|d)\b/);
});
