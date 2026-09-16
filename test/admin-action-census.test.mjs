// sow-274: THE ADMIN ACTION CENSUS. Every admin action a screen can send must be one the network serves, and
// nothing may write to GitHub with the acting member's own token any more.
//
// WHY A CENSUS RATHER THAN A HAPPY-PATH TEST. Before this change, an admin action the Worker did not know still
// worked: the client had its own writer and quietly used it. That fallback is gone, so an unregistered action is
// now a dead button, and it fails at the click rather than at the build. The two halves of the mapping also live
// in different files by design (the client decides what it can send, the Worker decides what it serves), which is
// exactly the arrangement where one side gets edited and the other does not.
//
// So this walks the real screens for the action names they send, rather than restating a list. A new manager
// button that nobody registered reds a test here instead of failing in front of a superadmin.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { WORKER_ADMIN_ACTIONS, isWorkerAdminAction, toWorkerRequest } from '../client/src/admin-worker-actions.mjs';
import { ADMIN_ACTIONS_SERVED } from '../workers/signup/membership-admin-author.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/**
 * The same source with its comments removed.
 *
 * A guard that greps a file matches the file's own prose, so a comment explaining that the fork writer is gone
 * reads as the fork writer being present. That happened while writing this file, which is the best argument for
 * the helper: the check has to look at what the module DOES, not at what it says about itself. `//` is left
 * alone when it follows a colon, so a URL in a string survives the strip.
 */
const codeOf = (src) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
  .join('\n');

/**
 * Every admin action name the shipped screens can send, gathered from the source of each surface.
 *
 * The four idioms are the four ways a surface reaches the admin route, and each is read where it actually
 * appears rather than from a list someone maintains by hand.
 */
function actionsTheScreensSend() {
  const found = new Map(); // action -> the surface that sends it, for a legible failure

  const add = (action, where) => { if (action && !found.has(action)) found.set(action, where); };

  // 1. The shared client's named admin methods: request('POST', '/api/admin', { action: 'quote-add', ... }).
  const client = read('client-ui/src/client.mjs');
  for (const m of client.matchAll(/'\/api\/admin',\s*\{\s*action:\s*'([a-z0-9-]+)'/g)) add(m[1], 'client-ui/src/client.mjs');

  // 2. The generic escape hatch, client.admin('category-batch', {...}), used by the workspace elements.
  for (const rel of [
    'client-ui/src/elements/gbti-discussion.mjs',
    'client-ui/src/elements/gbti-categories-workspace.mjs',
    'client-ui/src/elements/gbti-tag-explorer.mjs',
    'client-ui/src/elements/gbti-admin.mjs',
    'client-ui/src/elements/gbti-superadmin-dashboard.mjs',
  ]) {
    for (const m of read(rel).matchAll(/\.admin\('([a-z0-9-]+)'/g)) add(m[1], rel);
    for (const m of read(rel).matchAll(/\brun\('([a-z0-9-]+)'/g)) add(m[1], rel);
  }

  // 3. The moderation pills, which map a button name to an action through one table.
  const mod = read('client-ui/src/elements/gbti-mod-actions.mjs');
  const table = mod.match(/const ACTION_API = \{([^}]*)\}/);
  assert.ok(table, 'gbti-mod-actions.mjs no longer declares ACTION_API; this census cannot see what it sends');
  for (const m of table[1].matchAll(/:\s*'([a-z0-9-]+)'/g)) add(m[1], 'client-ui/src/elements/gbti-mod-actions.mjs');

  // 4. The command line tool's own admin panel, whose actions are the values of a select.
  const ui = read('client/src/ui.mjs');
  const select = ui.match(/<select id="admAction">([\s\S]*?)<\/select>/);
  assert.ok(select, 'client/src/ui.mjs no longer declares the admin action select; this census cannot see what it sends');
  for (const m of select[1].matchAll(/value="([a-z0-9-]+)"/g)) add(m[1], 'client/src/ui.mjs');

  return found;
}

test('every admin action the screens send is one the network serves', () => {
  const sent = actionsTheScreensSend();
  // A census that found nothing would pass silently, which is the failure this whole file exists to catch.
  assert.ok(sent.size >= 25, `the census read only ${sent.size} actions from the screens, so it is no longer reading them`);

  const served = new Set(ADMIN_ACTIONS_SERVED);
  const unreachable = [];
  for (const [action, where] of sent) {
    const req = toWorkerRequest({ action });
    if (!req) { unreachable.push(`${action} (${where}): the client refuses to send it`); continue; }
    if (!served.has(req.action)) unreachable.push(`${action} (${where}) -> ${req.action}: the Worker does not serve it`);
  }
  assert.deepEqual(unreachable, [], `admin actions with nowhere to go:\n  ${unreachable.join('\n  ')}`);
});

test('every action the client can send is one the Worker serves', () => {
  const served = new Set(ADMIN_ACTIONS_SERVED);
  const orphans = [...WORKER_ADMIN_ACTIONS].filter((a) => !served.has(a));
  assert.deepEqual(orphans, [], 'the client would forward these unchanged, but the Worker has no entry for them');
});

test('an action the tables do not name is refused, never sent somewhere else', () => {
  // The whole point of the retirement is that there is no second path. An unknown action has to be a refusal
  // rather than a fallback, or the old path survives inside the new one.
  assert.equal(toWorkerRequest({ action: 'quote-delete' }), null);
  assert.equal(toWorkerRequest({ action: '' }), null);
  assert.equal(toWorkerRequest({}), null);
  assert.equal(toWorkerRequest(null), null);
  assert.equal(isWorkerAdminAction('publish'), false);
});

test('a translated action reaches the Worker under the name the Worker knows', () => {
  const batch = toWorkerRequest({ action: 'category-add', parentPath: ['ai'], key: 'agents', label: 'Agents' });
  assert.equal(batch.action, 'category-batch');
  assert.deepEqual(batch.payload.ops, [{ kind: 'add', args: { parentPath: ['ai'], key: 'agents', label: 'Agents' } }]);

  const channel = toWorkerRequest({ action: 'content-channel-set', category: 'ai', channelId: '123' });
  assert.equal(channel.action, 'category-batch');
  assert.deepEqual(channel.payload.ops, [{ kind: 'channel-set', args: { category: 'ai', channelId: '123' } }]);

  const tpl = toWorkerRequest({ action: 'syndication-template-set', type: 'post', template: 'x', channel: 'discord' });
  assert.equal(tpl.action, 'syndication-templates-set');
  assert.deepEqual(tpl.payload.edits, [{ type: 'post', template: 'x', channel: 'discord', stub: false }]);
});

test('the settings module writes nothing at all', () => {
  const src = codeOf(read('client/src/admin-ops.mjs'));
  // The three things that made it a writer. Each is checked by name because each is how the old path came back
  // in a previous retirement: an import kept "for one last caller", a helper kept because it was harmless.
  assert.ok(!/publishFiles/.test(src), 'admin-ops.mjs imports the publisher again, so it can open a pull request from a fork');
  assert.ok(!/adminPublish/.test(src), 'admin-ops.mjs has an adminPublish helper again');
  assert.ok(!/syncForkIfCreatingBranch/.test(src), 'admin-ops.mjs syncs a fork branch again, which only a fork write needs');

  // And no export may be a writer. Reads answer a screen; anything else is a write that bypasses the network.
  const exported = [...src.matchAll(/^export (?:async )?function (\w+)/gm)].map((m) => m[1]);
  const notARead = exported.filter((name) => !/^get[A-Z]/.test(name));
  assert.deepEqual(notARead, [], 'admin-ops.mjs exports something that is not a read');
  assert.ok(exported.length >= 10, 'the manager reads have gone missing from admin-ops.mjs');
});

test('no surface imports a writer from the settings module', () => {
  for (const rel of ['client/src/api.mjs', 'extension/src/ext-dispatch.mjs', 'client/src/cli.mjs']) {
    const src = codeOf(read(rel));
    const imports = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'[^']*admin-ops\.mjs'/g)]
      .flatMap((m) => m[1].split(',').map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean));
    const writers = imports.filter((name) => !/^get[A-Z]/.test(name));
    assert.deepEqual(writers, [], `${rel} imports a non-read from admin-ops.mjs`);
  }
});

test('the command line tool sends its admin commands to the network', () => {
  const src = read('client/src/cli.mjs');
  // Its three moderation and role commands were the last direct calls to a local writer anywhere in the tool.
  for (const action of ['deplatform', 'remove', 'role']) {
    const re = new RegExp(`case '${action}':\\s*\\n\\s*return out\\(await governanceAdminOp\\(ctx, \\{ action: '${action}'`);
    assert.match(src, re, `the ${action} command no longer goes through the network`);
  }
});
