#!/usr/bin/env node
// Autostart (SOW-006 `peg-startup` / `unpeg-startup`): make the local node launch at login, USER-LEVEL ONLY,
// never sudo/root/UAC. Per OS: a macOS LaunchAgent, a Linux `systemd --user` unit, or a Windows logon Run
// key. autostartPlan() is PURE (computes the registration descriptor) so it is unit-testable on any host;
// install/remove/status apply it with fs + child_process. The CMS Settings toggle calls the same functions.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const LABEL = 'network.gbti.localnode';

/**
 * Compute the per-OS autostart registration. Pure: no fs/exec. Returns a descriptor:
 *   { platform, kind: 'launchd'|'systemd'|'registry'|'unsupported', label, path?, content?, load?, unload?, reg? }
 */
export function autostartPlan({ platform = process.platform, home = os.homedir(), nodePath, scriptPath }) {
  if (platform === 'darwin') {
    const file = path.join(home, 'Library', 'LaunchAgents', `${LABEL}.plist`);
    const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${nodePath}</string><string>${scriptPath}</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><false/>
</dict>
</plist>
`;
    return { platform, kind: 'launchd', label: LABEL, path: file, content, load: ['launchctl', ['load', file]], unload: ['launchctl', ['unload', file]] };
  }

  if (platform === 'linux') {
    const file = path.join(home, '.config', 'systemd', 'user', 'gbti-network.service');
    const content = `[Unit]
Description=GBTI Network local node (SOW-006)
After=network.target

[Service]
ExecStart=${nodePath} ${scriptPath}
Restart=on-failure

[Install]
WantedBy=default.target
`;
    return {
      platform, kind: 'systemd', label: 'gbti-network.service', path: file, content,
      load: ['systemctl', ['--user', 'enable', '--now', 'gbti-network.service']],
      unload: ['systemctl', ['--user', 'disable', '--now', 'gbti-network.service']],
      reload: ['systemctl', ['--user', 'daemon-reload']],
    };
  }

  if (platform === 'win32') {
    const command = `"${nodePath}" "${scriptPath}"`;
    return {
      platform, kind: 'registry', label: 'gbti-network',
      reg: {
        key: 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        name: 'gbti-network',
        command,
      },
      load: ['reg', ['add', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'gbti-network', '/t', 'REG_SZ', '/d', command, '/f']],
      unload: ['reg', ['delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run', '/v', 'gbti-network', '/f']],
    };
  }

  return { platform, kind: 'unsupported', label: LABEL };
}

function defaultPaths() {
  return { nodePath: process.execPath, scriptPath: fileURLToPath(new URL('./index.mjs', import.meta.url)) };
}

function tryExec([cmd, args]) {
  try {
    execFileSync(cmd, args, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Register autostart (user-level). Returns { ok, kind, path?, error? }. */
export function install(opts = {}) {
  const plan = autostartPlan({ ...defaultPaths(), ...opts });
  if (plan.kind === 'unsupported') return { ok: false, kind: plan.kind, error: `autostart not supported on ${plan.platform}` };

  if (plan.path) {
    fs.mkdirSync(path.dirname(plan.path), { recursive: true });
    fs.writeFileSync(plan.path, plan.content);
  }
  if (plan.reload) tryExec(plan.reload);
  if (plan.load) tryExec(plan.load);
  return { ok: true, kind: plan.kind, path: plan.path ?? null };
}

/** Remove autostart. Returns { ok, kind }. */
export function remove(opts = {}) {
  const plan = autostartPlan({ ...defaultPaths(), ...opts });
  if (plan.kind === 'unsupported') return { ok: false, kind: plan.kind };
  if (plan.unload) tryExec(plan.unload);
  if (plan.path && fs.existsSync(plan.path)) fs.rmSync(plan.path, { force: true });
  return { ok: true, kind: plan.kind };
}

/** Is autostart currently registered? (file presence for launchd/systemd; best-effort otherwise.) */
export function status(opts = {}) {
  const plan = autostartPlan({ ...defaultPaths(), ...opts });
  if (plan.path) return { installed: fs.existsSync(plan.path), kind: plan.kind, path: plan.path };
  return { installed: null, kind: plan.kind }; // registry/unsupported: not introspected here
}

// CLI: `node autostart.mjs <install|remove|status>` (wired to peg-startup / unpeg-startup npm scripts).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const action = process.argv[2];
  const fn = { install, remove, status }[action];
  if (!fn) {
    process.stderr.write('usage: autostart.mjs <install|remove|status>\n');
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(fn(), null, 2) + '\n');
}
