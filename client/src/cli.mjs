#!/usr/bin/env node
// `gbti` scriptable CLI (SOW-006): non-interactive subcommands with JSON output + clean exit codes so
// agents/CI can drive the same managed PR flow as the CMS UI and MCP. Thin shell: parse args, build the
// shared context, call cli-commands.mjs, print JSON. Human prompts (device-flow code) go to stderr; the
// machine-readable result goes to stdout.

import { createStore } from './store.mjs';
import { buildContext, UPSTREAM } from './context.mjs';
import { createRepoClient } from './github-repo.mjs';
import { deviceFlowLogin } from './auth-device.mjs';
import { GITHUB_CLIENT_ID } from './signup-base.mjs';
import { cmdLogin, cmdWhoami, cmdNew, cmdPublish, cmdPr } from './cli-commands.mjs';
import {
  banMember, unbanMember, grandfatherMember, ungrandfatherMember, setMemberRole, deplatformContent, removeContent,
} from './admin-ops.mjs';

const RESERVED = new Set(['json', 'body', 'body-file']);

function parseArgs(argv) {
  const positionals = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else { flags[key] = next; i++; }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

/** Collect content-input fields from flags (everything except reserved control flags). */
function inputFromFlags(flags) {
  const input = {};
  for (const [k, v] of Object.entries(flags)) if (!RESERVED.has(k)) input[k] = v;
  return input;
}

function out(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
function die(message, code = 2) {
  process.stderr.write(JSON.stringify({ ok: false, error: message }) + '\n');
  process.exit(code);
}

const HELP = `gbti <command>

  login                       authenticate via GitHub device flow
  whoami                      print identity + auth/membership status
  new <type> --title T [--slug s --category c ...] [--body "..."|--body-file f]
  publish <file>              open/update a PR for a staged content file
  pr [number]                 list your PRs, or one PR's gate status

  Moderation (moderator+):
  deplatform <path>           PR to set a member's content status -> draft
  remove <path>               PR to delete a member's content
  Admin (admin+):
  ban <githubId> [--reason r]    |  unban <githubId>
  grandfather <githubId> [--reason r --until ISO --login l]  |  ungrandfather <githubId>
  Superadmin:
  role <githubId> <role> [--login l]   assign a role (role=member to revoke)
`;

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { positionals, flags } = parseArgs(rest);

  if (!cmd || cmd === 'help' || flags.help) {
    process.stdout.write(HELP);
    return;
  }

  const store = createStore();

  if (cmd === 'login') {
    const clientId = process.env.GBTI_GITHUB_CLIENT_ID || store.get('githubClientId') || GITHUB_CLIENT_ID;
    const result = await cmdLogin({
      store,
      clientId,
      deviceFlowLogin,
      makeRepoClient: (token) => createRepoClient({ token, upstream: UPSTREAM }),
      onPrompt: ({ userCode, verificationUri }) =>
        process.stderr.write(`\nTo authenticate, visit ${verificationUri} and enter code: ${userCode}\n`),
    });
    return out(result);
  }

  const ctx = buildContext(store);

  switch (cmd) {
    case 'whoami':
      return out(cmdWhoami(ctx));
    case 'new': {
      const type = positionals[0];
      if (!type) die('usage: gbti new <type> --title ...');
      const body = flags['body-file'] ? (await import('node:fs')).readFileSync(flags['body-file'], 'utf8') : (flags.body || '');
      return out(cmdNew(ctx, { type, input: inputFromFlags(flags), body }));
    }
    case 'publish':
      return out(await cmdPublish(ctx, { file: positionals[0] }));
    case 'pr':
      return out(await cmdPr(ctx, { number: positionals[0] }));

    // Moderation / admin / superadmin (role-gated; the gate + CODEOWNERS are authoritative).
    case 'deplatform':
      return out(await deplatformContent(ctx, { path: positionals[0] }));
    case 'remove':
      return out(await removeContent(ctx, { path: positionals[0] }));
    case 'ban':
      return out(await banMember(ctx, { githubId: positionals[0], reason: flags.reason }));
    case 'unban':
      return out(await unbanMember(ctx, { githubId: positionals[0] }));
    case 'grandfather':
      return out(await grandfatherMember(ctx, { githubId: positionals[0], reason: flags.reason, until: flags.until || null, login: flags.login }));
    case 'ungrandfather':
      return out(await ungrandfatherMember(ctx, { githubId: positionals[0] }));
    case 'role':
      return out(await setMemberRole(ctx, { githubId: positionals[0], role: positionals[1], login: flags.login }));

    default:
      die(`unknown command: ${cmd}`);
  }
}

main().catch((err) => die(err?.message ?? String(err), 2));
