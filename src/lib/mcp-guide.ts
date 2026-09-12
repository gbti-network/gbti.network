// sow-225: the MCP install story, single-sourced for the extension page and the WorkBench guide page. Every
// claim here was performed on 2026-09-09 against the bundled server (extension/mcp/gbti-network-mcp.mjs): it
// answered the initialize handshake as gbti-network 0.1.0 on protocol 2024-11-05 and listed its tools. The
// server ships INSIDE the extension package under mcp/ (extension/package.mjs); there is no npm package.
import fs from 'node:fs';
import path from 'node:path';

/** Where the server sits inside the unzipped extension package. Mirrors extension/package.mjs MCP_FILE. */
export const MCP_FILE_IN_PACKAGE = 'mcp/gbti-network-mcp.mjs';

/** The one-line Claude Code registration, with the path a member fills in. */
export const claudeCodeAddCommand = `claude mcp add gbti-network -- node <path-to-the-unzipped-extension>/${MCP_FILE_IN_PACKAGE}`;

/** The generic agent config (Claude Desktop, Cursor, and the rest read this shape). */
export const agentConfigJson = JSON.stringify({ mcpServers: { 'gbti-network': { command: 'node', args: [`<path-to-the-unzipped-extension>/${MCP_FILE_IN_PACKAGE}`] } } }, null, 2);

/** The prompt a member pastes into Claude Code. A line array so the placeholders read cleanly. */
export const mcpPrompt = [
  'Set up the GBTI Network MCP server in Claude Code so you can publish and maintain my GBTI content.',
  '',
  '1. Register it as an MCP server. The server ships inside the GBTI extension package; from the unzipped folder run:',
  `     ${claudeCodeAddCommand}`,
  '',
  '2. Sign me in: call the login tool, give me the GitHub device URL and code, and after I authorize, call login_confirm. Confirm with whoami.',
  '',
  '3. Show what I can work on with list_my_content, then use publish_content to publish or update a post, project, or prompt.',
  '',
  // sow-323: this used to say publishing was a Curator feature requiring the Curator role. The two paid plans
  // collapsed into one on 2026-09-12, so the rule an agent needs is the membership, plus what happens after it
  // publishes: every member item starts members-only and a superadmin approves what becomes public.
  'Important: publishing needs an active paid GBTI membership. publish_content only works when my GitHub account holds one, and without it the gate declines the pull request, so check whoami first.',
  'What I publish reaches members first. It becomes public after editorial review, so do not tell me an item is live on the public site the moment the pull request merges.',
].join('\n');

/**
 * The tool names, read from the server's own definitions at build time so the guide can never list a tool the
 * server does not have. A regex over the source rather than an import, so the site build does not pull the
 * whole client into itself.
 */
export function mcpToolNames(root = process.cwd()): string[] {
  try {
    const src = fs.readFileSync(path.join(root, 'client/src/mcp-tools.mjs'), 'utf8');
    const names = [...src.matchAll(/^\s*name: '([a-z_]+)',/gm)].map((m) => m[1]);
    return [...new Set(names)];
  } catch { return []; }
}

/** The tools grouped for a reader, in the order a first session meets them. Names not in a group land in "More". */
export function mcpToolGroups(names: string[]): { title: string; tools: string[] }[] {
  const groups: [string, string[]][] = [
    ['Sign in', ['login', 'login_confirm', 'whoami', 'logout']],
    ['Your content', ['list_my_content', 'get_content', 'validate_content', 'publish_content', 'add_post', 'add_prompt', 'add_product', 'preview_link']],
    ['Drafts', ['list_drafts', 'read_draft', 'publish_draft', 'discard_draft']],
    ['Pull requests and contributions', ['list_prs', 'pr_status', 'list_contributions', 'get_contribution', 'review_contribution']],
    ['Discussion and shares', ['list_comments', 'post_comment', 'edit_comment', 'add_share']],
  ];
  const seen = new Set<string>();
  const out = groups.map(([title, list]) => ({ title, tools: list.filter((t) => names.includes(t) && !seen.has(t) && seen.add(t)) })).filter((g) => g.tools.length);
  const rest = names.filter((n) => !seen.has(n));
  if (rest.length) out.push({ title: 'More', tools: rest });
  return out;
}
