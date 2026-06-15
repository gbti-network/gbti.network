# gbti-network — local client (CMS + MCP)

Your local authoring node for the git-backed GBTI Network. One command brings up two surfaces over the
same Stripe-gated public-repo PR flow:

- a **local CMS** (browser UI) to author your own content (profile, posts, products, prompts) and track PRs;
- a **local MCP server** so your AI agents author through the exact same flow.

It does not change the backend. It is a friendly, agent-friendly layer over the public-repo PR flow you
could do by hand. The SOW-005 gate remains the only authority on what may merge; this client only surfaces
what you can do.

## Requirements

Node 20+. You author by forking the public content repo and opening PRs, so you need a GitHub account
(membership gates whether a PR merges, not whether you can open one).

## Install

```
npm i -g gbti-network      # or: npx gbti-network
```

## First run

```
gbti login                 # GitHub device flow: visit the URL, enter the code (no secret stored in the client)
# point the client at a local clone of the content repo (Settings pane, or set repoPath):
#   git clone https://github.com/gbti-network/gbti.network
npm run gbti-network        # boots the CMS + local MCP HTTP endpoint; prints a tokenized URL to open
```

`gbti-network` prints something like:

```
Open the CMS:  http://127.0.0.1:4500/?token=<your-per-install-token>
Endpoint token (for agents/MCP):  <your-per-install-token>
```

Open that URL. The CMS tabs: **Author**, **My Content**, **PRs**, **Members-only**, **Settings**,
**Billing**, **Referrals**, and (if you hold a role) **Admin**.

## Run at login (peg-startup)

```
npm run peg-startup         # register a USER-LEVEL autostart (macOS LaunchAgent / Linux systemd --user / Windows Run key)
npm run unpeg-startup       # remove it
```

Never requires sudo/root/UAC. The same toggle lives in the CMS Settings pane.

## Connect an AI agent (MCP)

Two transports, same tools:

- **stdio** (spawn-style clients like Claude Code/Desktop): run `gbti-network-mcp`.
- **HTTP** (always-on server): `POST http://127.0.0.1:<port>/mcp` with `Authorization: Bearer <endpoint-token>`.

Example agent config (stdio):

```json
{ "mcpServers": { "gbti-network": { "command": "npx", "args": ["gbti-network-mcp"] } } }
```

Tools: `whoami`, `list_my_content`, `get_content`, `validate_content`, `publish_content`, `list_prs`,
`pr_status`. Each is scoped to your own folder and forces the gated fields; the gate is still the boundary.

## CLI quickstart

```
gbti login
gbti whoami
gbti new post --title "My First Post" --slug my-first-post --body "Hello"
gbti publish members/<you>/posts/my-first-post.md
gbti pr                      # list your PRs;  gbti pr <number> shows gate status (held vs mergeable)
```

Staff commands (role-gated; each opens the appropriate PR, the gate + CODEOWNERS decide):

```
gbti deplatform <path> | gbti remove <path>                      # moderator+
gbti ban <id> [--reason r] | gbti grandfather <id> [--until ISO] # admin+
gbti role <id> <member|moderator|admin|superadmin>               # superadmin
```

All CLI commands print JSON with clean exit codes, so agents/CI can drive them headless.

## Security

The always-on HTTP server holds your GitHub token, so it is hardened: it binds `127.0.0.1` only, requires
the per-install bearer token on every request, checks Origin/Host (anti DNS-rebinding/CSRF), and falls back
to a free port. The stdio MCP transport is a trusted spawned child and is exempt. Your token + settings live
in a `0600` file in your user config dir. Billing is never handled here: the client deep-links to Stripe's
hosted customer portal.

## Updating

```
npm update -g gbti-network
```

The client imports the canonical content schemas, so it stays in step with the site as they evolve.
