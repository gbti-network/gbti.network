// SOW-006 autostart: the pure per-OS plan (no fs/exec), and the install/remove round-trip on this host.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { autostartPlan, LABEL, install, remove, status } from '../client/src/autostart.mjs';

const paths = { nodePath: '/usr/bin/node', scriptPath: '/home/me/.../index.mjs', home: '/home/me' };

test('autostartPlan: macOS LaunchAgent plist, user-level path', () => {
  const p = autostartPlan({ platform: 'darwin', ...paths });
  assert.equal(p.kind, 'launchd');
  assert.equal(p.path, `/home/me/Library/LaunchAgents/${LABEL}.plist`);
  assert.match(p.content, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(p.content, /\/usr\/bin\/node/);
  assert.equal(p.load[0], 'launchctl');
});

test('autostartPlan: Linux systemd --user unit', () => {
  const p = autostartPlan({ platform: 'linux', ...paths });
  assert.equal(p.kind, 'systemd');
  assert.equal(p.path, '/home/me/.config/systemd/user/gbti-network.service');
  assert.match(p.content, /ExecStart=\/usr\/bin\/node \/home\/me/);
  assert.match(p.content, /WantedBy=default\.target/);
  assert.deepEqual(p.load, ['systemctl', ['--user', 'enable', '--now', 'gbti-network.service']]);
});

test('autostartPlan: Windows user Run key (no admin)', () => {
  const p = autostartPlan({ platform: 'win32', ...paths });
  assert.equal(p.kind, 'registry');
  assert.match(p.reg.key, /^HKCU\\/);
  assert.equal(p.reg.name, 'gbti-network');
  assert.equal(p.load[0], 'reg');
});

test('autostartPlan: unsupported platform degrades gracefully', () => {
  assert.equal(autostartPlan({ platform: 'aix', ...paths }).kind, 'unsupported');
});

test('install/remove: writes then deletes the unit file on a file-based platform', { skip: process.platform === 'win32' }, () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-autostart-'));
  const opts = { home, nodePath: '/usr/bin/node', scriptPath: '/x/index.mjs' };
  const r = install(opts);
  assert.equal(r.ok, true);
  assert.ok(fs.existsSync(r.path));
  assert.equal(status(opts).installed, true);
  remove(opts);
  assert.equal(status(opts).installed, false);
});
