// sow-271: the website upgrades <gbti-edit-panel>, so a member signed in ON THE WEBSITE can edit their own
// published item in place instead of meeting a control that can never appear.
//
// This suite exists because of a defect that would have shipped SILENTLY. The element was already rendered on
// every member-owned article, project and prompt page, and the fix looked like one import. But the panel's
// own gate is:
//
//     canEditInPlace(hooks, identity)  ->  identity?.username && path.startsWith(`members/${username}/`)
//
// and the website client returned `identity: { login, githubId }` with NO `username`. So the gate returned
// false for EVERYONE, the folder owner included, and it returned false quietly: no error, no console warning,
// no failed request. The feature would have been "shipped", the suite would have stayed green, and the
// control would have stayed invisible exactly as before.
//
// So these tests bind the website host's identity SHAPE to the real gate rather than asserting a string.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import { readHooks, canEditInPlace } from '../client-ui/src/inline.mjs';

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const CLIENT = read('../src/lib/workbench-client.ts');
const HOOKS = read('../src/components/EditHooks.astro');
const LOCKED = read('../src/components/LockedBody.astro');

/** The identity literal the website client's status() promises, parsed from the source. */
function websiteIdentityKeys() {
  const m = /identity:\s*\{([^}]*)\}/.exec(CLIENT);
  assert.ok(m, 'workbench-client.ts no longer returns an `identity` object literal from status()');
  return m[1].split(',').map((s) => s.split(':')[0].trim()).filter(Boolean);
}

test('the website identity satisfies the in-place edit gate for the OWNER, and only the owner', () => {
  const keys = websiteIdentityKeys();
  assert.ok(keys.includes('username'), `website identity is missing \`username\`: got [${keys.join(', ')}]`);

  // Bind the promised shape to the REAL gate. A missing key fails here for the right reason.
  const identity = Object.fromEntries(keys.map((k) => [k, k === 'githubId' ? '123' : 'alice']));
  const mine = readHooks({ gbtiPath: 'members/alice/posts/x/index.md', gbtiType: 'post' });
  const theirs = readHooks({ gbtiPath: 'members/bob/posts/y/index.md', gbtiType: 'post' });

  assert.equal(canEditInPlace(mine, identity), true, 'the folder OWNER must be able to edit in place');
  assert.equal(canEditInPlace(theirs, identity), false, 'a member must NOT edit another member folder');
  assert.equal(canEditInPlace(mine, null), false, 'a signed-out visitor must never pass the gate');
});

test('EditHooks actually imports the element, so the panel can exist on the website at all', () => {
  // The element is rendered by this component unconditionally for member-owned content. Rendering it without
  // defining it anywhere is the state this SOW is fixing, so assert the import, not just the markup.
  assert.match(HOOKS, /<gbti-edit-panel/, 'EditHooks no longer renders the element');
  assert.match(HOOKS, /elements\/gbti-edit-panel\.mjs/, 'EditHooks renders the element but never imports it');
});

test('the upgrade is gated on a real WEB session, not merely on a member signal', () => {
  // An extension-only signal carries no cookie session, so it cannot authenticate the publish call. Upgrading
  // on the signal alone would hand a member an Edit button whose save fails at the Worker.
  assert.match(HOOKS, /readCookie\('gbti_csrf'\)/, 'the upgrade must require the web session cookie');
  // And nothing is imported for a visitor: the dynamic imports must sit behind the guard, never at top level.
  const topLevelElementImport = /^\s*import\s+['"][^'"]*gbti-edit-panel\.mjs['"]/m.test(HOOKS);
  assert.equal(topLevelElementImport, false, 'the element must be imported lazily, not on every page load');
});

test('LockedBody upgrades the decrypt element ITSELF, not via whichever sibling happens to be present', () => {
  // The coupling this closes: <gbti-locked-content> was imported in exactly ONE file, Comments.astro, while
  // LockedBody renders it in eleven places. Decryption worked only because every page that can render a
  // LockedBody also renders ContentFooter, which renders Comments. Nothing stated the dependency and no test
  // held it, so making Comments conditional for any reason would have stopped member-only bodies unlocking
  // on the website SILENTLY: the reader keeps seeing the padlock and a paid perk fails with no error.
  assert.match(LOCKED, /<gbti-locked-content/, 'LockedBody no longer renders the element');
  assert.match(LOCKED, /elements\/gbti-locked-content\.mjs/,
    'LockedBody renders the element but does not import it: decryption is back to depending on Comments.astro');
  assert.match(LOCKED, /lbCookie\('gbti_csrf'\)/, 'the upgrade must require a real web session, since the Worker authorizes the decrypt');
  // And it must stay lazy: a visitor with no session should fetch none of it.
  assert.equal(/^\s*import\s+['"][^'"]*gbti-locked-content\.mjs['"]/m.test(LOCKED), false,
    'the element must be imported lazily inside the guard, not at top level');
});

test('the gated-content notice no longer tells a member to go to a client to unlock', () => {
  assert.ok(!LOCKED.includes('open it in the GBTI client to unlock'),
    'the website decrypts member content itself (workbench-client posts to /membership/decrypt)');
});

// sow-271: the MCP tools are a PUBLISHED INTERFACE. Members' AI agents were written against these names and
// this enum, so the product -> project rename is a compatibility surface, not just an internal one.
test('the MCP tools still accept the retired type name, at the schema AND in the handler', () => {
  const MCP = read('../client/src/mcp-tools.mjs');

  // The enum IS the schema. Drop `product` and an existing agent's call is rejected by validation before any
  // canonicalization can run, with a schema error rather than a useful message.
  const m = /const TYPE_ENUM = \{[^}]*enum: \[([^\]]*)\]/.exec(MCP);
  assert.ok(m, 'TYPE_ENUM is no longer a literal enum: re-check this guard');
  const values = m[1].split(',').map((s) => s.trim().replace(/^'|'$/g, ''));
  assert.ok(values.includes('project'), 'TYPE_ENUM must offer the current name');
  assert.ok(values.includes('product'), 'TYPE_ENUM dropped the retired name: existing agents break on validation');

  // Accepting it is only half. Every handler that forwards a caller-supplied type must canonicalize, because
  // the SUBDIR maps carry an alias but the TYPES allow-lists in github-reader/repo-fs do not.
  for (const fn of ['listContent', 'validateContent', 'listDrafts']) {
    // Anchor on the HANDLER line. Matching any line that mentions the function picks up internal helper
    // calls too, which made the first version of this assertion fail against correct code.
    const line = MCP.split('\n').find((l) => l.includes('handler:') && l.includes(`${fn}(ctx,`));
    assert.ok(line, `handler line for ${fn} not found`);
    assert.match(line, /canonicalType\(/, `${fn} forwards a raw type: a legacy value reaches an allow-list that rejects it`);
  }
  const pub = MCP.split('\n').find((l) => l.includes('authorContent(ctx, {'));
  assert.match(pub, /canonicalType\(/, 'publish_content forwards args whole, so it must canonicalize the type itself');
});

test('add_product keeps its NAME (agents call it) while creating a project', () => {
  const MCP = read('../client/src/mcp-tools.mjs');
  assert.match(MCP, /name: 'add_product'/, 'renaming the tool breaks every agent already calling it');
  const from = MCP.indexOf("name: 'add_product'");
  const end = MCP.indexOf("\n  },", from);           // the close of this tool object, not a guessed width
  assert.ok(end > from, 'could not find the end of the add_product tool object');
  assert.match(MCP.slice(from, end), /type: 'project'/, 'add_product must create a project, whatever it is called');
});

// sow-271 Phase 5: the NEWS discussion composer. Same dead-element family as the two cases above, and it had
// gone unnoticed longest: /news/item/ already RENDERED the discussion (it reads /comments-index.json and shows
// public bodies plus locked member rows) and had no way to add to it. The page's own empty state said members
// comment "from the GBTI extension", which was true only because nothing here had ever been connected.
//
// Nothing needed building. `news` has been in COMMENT_TARGET_TYPES since SOW-046, workbench-client.postComment
// accepts it, and the Worker gates it server-side. It was a mount.
const NEWS = read('../src/pages/news/item.astro');

test('the news page mounts a composer AND defines it, so a member can answer the discussion it renders', () => {
  // The element is created in script rather than baked by CommentBox.astro because the page is client-rendered:
  // the target slug comes from ?g=<guid> at runtime, so there is no build-time slug to bake.
  assert.match(NEWS, /createElement\('gbti-comment-box'\)/, 'the news page renders a discussion with no composer');
  assert.match(NEWS, /'data-gbti-target-type', 'news'/, 'the composer must target the news thread');
  assert.match(NEWS, /'data-gbti-target-slug', slug/, 'the composer must carry the item slug, or it posts nowhere');
  // Mounting without defining is the whole failure this suite exists for.
  assert.match(NEWS, /elements\/gbti-comment-box\.mjs/, 'the news page mounts the element but never imports it');
});

test('the news composer upgrade is session-gated and lazy, like every other website upgrade', () => {
  // The CALL, not the bare string: an earlier version of this line matched the explanatory comment sitting
  // above the guard, so deleting the guard outright left the test green. Mutation testing caught it.
  assert.match(NEWS, /readCookie\('gbti_csrf'\)/, 'the upgrade must require a real web session, not merely a member signal');
  assert.equal(/^\s*import\s+['"][^'"]*gbti-comment-box\.mjs['"]/m.test(NEWS), false,
    'the element must be imported lazily inside the guard: a visitor should fetch none of it');
});

test('the mount is attempted from BOTH sides of the race, and the fetch side runs after the append', () => {
  // The composer does not exist when the script runs; it arrives with the news fetch. And onMemberSignal does
  // NOT replay, so a member whose status came from the sessionStorage cache is fanned out synchronously in the
  // header's script, BEFORE this page's listener registers. Only the post-fetch call catches that member, and
  // only if it runs once the composer is actually in the document.
  // Anchored to the start of a line, so a COMMENTED-OUT registration does not satisfy it. This is the third
  // assertion in this file that matched prose rather than code (the two csrf guards were the others), which is
  // the whole argument for mutation-testing a source-reading guard rather than eyeballing it.
  assert.match(NEWS, /^\s*onMemberSignal\(mountNewsComposer\);/m, 'the signal side of the race is not wired');
  const append = NEWS.indexOf('target.append(disc)');
  assert.ok(append > 0, 'the discussion append was not found: this check is broken, not the subject');
  // EXACTLY ONE call site, and it is after the append. The first version of this asserted only that a call
  // existed somewhere after the append, which an ADDED too-early call survives untouched: the later one is
  // still there and still found. Counting is what makes the ordering claim real.
  const calls = [...NEWS.matchAll(/upgradeComposer\(\);/g)].map((m) => m.index);
  assert.equal(calls.length, 1, `upgradeComposer is called ${calls.length} times; a call before the append finds no composer`);
  assert.ok(calls[0] > append, 'upgradeComposer must run AFTER the section is in the document, or it finds nothing');

  // And the guard order inside the mount matters: the "is it on the page yet" check must come BEFORE the flag
  // is latched, or the first (too-early) attempt permanently disables the second.
  const fn = /async function mountNewsComposer\(signal: any\) \{([\s\S]*?)\n    \}/.exec(NEWS);
  assert.ok(fn, 'mountNewsComposer was not found: this check is broken, not the subject');
  const q = fn[1].indexOf("querySelector('gbti-comment-box')");
  const latch = fn[1].indexOf('composerMounted = true');
  assert.ok(q > 0 && latch > 0, 'the presence guard or the latch is missing');
  assert.ok(q < latch, 'the presence check must precede the latch, or an early attempt locks out the real one');
});

test('the empty state no longer sends a reader to the extension to do what this page now does', () => {
  assert.ok(!NEWS.includes('Members comment from the GBTI extension'),
    'the page mounts a composer now, so the copy telling readers to use the extension is false');
});
