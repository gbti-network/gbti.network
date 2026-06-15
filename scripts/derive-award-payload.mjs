#!/usr/bin/env node
// SOW-008: derive the award payload from a merged contribution PR (the step the award workflow was
// missing). Metadata-only, like the gate: it reads the PR event + the changed file PATHS via the API and
// NEVER checks out or runs PR code. It writes payload.json for scripts/award-contribution.mjs and sets the
// workflow output `ready`. The pure deriveAwardPayload is unit-tested; main() is the thin I/O shell.
//
//   GITHUB_EVENT_PATH=... GITHUB_BOT_TOKEN=... GITHUB_CONTENT_REPO=owner/name node scripts/derive-award-payload.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createGitHubClient } from '../clients/github.mjs';
import { loadOverrides } from '../membership/overrides.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');

// NESTED layout: members/<owner>/<sub>/<slug>/index.md (+ the profile.md special case). Matches the actual
// on-disk layout (the SOW-001 migration + validate-content + the Astro glob).
const CONTENT_RE = /^members\/([^/]+)\/(?:(posts|products|prompts)\/([^/]+)\/index\.mdx?|profile\.md)$/;

/** The contribution class from the PR labels (the client sets `contribution:<class>`). Default `correction`. */
export function classFromLabels(labels) {
  for (const l of labels ?? []) {
    const m = /^(?:contribution|class):(grammar|correction|addition)$/.exec(String(l));
    if (m) return m[1];
  }
  // An accepted (merged) contribution is at least a correction by default; the owner can dispute it down.
  return 'correction';
}

/**
 * Pure: turn merged-PR metadata into the award payload, or a not-ready reason.
 * @param {object} a
 * @param {{login:string, id:string|number}} a.prUser   the contributor (PR author).
 * @param {string} a.mergeCommitSha
 * @param {string[]} a.labels
 * @param {string[]} a.changedPaths
 * @param {Map<string,string>} a.membersIndex            github_id -> username (house/members-index.yml).
 * @param {Map<string,object>} a.bans                    banned github_id -> entry.
 * @param {string} a.repo                                "owner/name" (for the commit URL).
 * @returns {{ready:true, payload:object} | {ready:false, reason:string}}
 */
export function deriveAwardPayload({ prUser, mergeCommitSha, labels, changedPaths, membersIndex, bans, repo }) {
  const contentPaths = (changedPaths ?? []).filter((p) => CONTENT_RE.test(p));
  if (contentPaths.length !== 1) {
    return { ready: false, reason: `expected exactly one members/<owner>/ content file, found ${contentPaths.length}` };
  }
  const targetFile = contentPaths[0];
  const m = targetFile.match(CONTENT_RE);
  const ownerUsername = m[1];
  const sub = m[2];
  const slug = m[3] ?? null;
  const type = sub === 'posts' ? 'post' : sub === 'products' ? 'product' : sub === 'prompts' ? 'prompt' : 'profile';

  let ownerGithubId = null;
  for (const [gid, uname] of membersIndex ?? []) {
    if (String(uname).toLowerCase() === ownerUsername.toLowerCase()) { ownerGithubId = String(gid); break; }
  }
  if (!ownerGithubId) return { ready: false, reason: `no github_id mapped for owner "${ownerUsername}" in members-index` };

  const contributorGithubId = String(prUser?.id ?? '');
  if (!contributorGithubId) return { ready: false, reason: 'no contributor github_id on the PR' };
  if (contributorGithubId === ownerGithubId) return { ready: false, reason: 'self-contribution (owner == contributor): no award' };

  const commit = mergeCommitSha || null;
  const url = commit && repo ? `https://github.com/${repo}/commit/${commit}` : null;
  const klass = classFromLabels(labels);
  const banned = Boolean(bans?.has?.(contributorGithubId));

  return {
    ready: true,
    payload: {
      targetFile,
      contributor: { login: prUser.login, commit, url, class: klass },
      contributorGithubId,
      ownerGithubId,
      target: { type, slug, username: ownerUsername },
      banned,
    },
  };
}

function setOutput(key, value) {
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  console.log(`derive-award: ${key}=${value}`);
}

async function main() {
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const pr = event.pull_request;
  if (!pr) throw new Error('derive-award: no pull_request in the event');
  const repo = process.env.GITHUB_CONTENT_REPO;
  const github = createGitHubClient({ token: process.env.GITHUB_BOT_TOKEN, repo });

  const changedPaths = await github.listPullFilePaths(pr.number);
  const overrides = loadOverrides(ROOT);

  const result = deriveAwardPayload({
    prUser: { login: pr.user?.login, id: pr.user?.id },
    mergeCommitSha: pr.merge_commit_sha,
    labels: (pr.labels ?? []).map((l) => l.name),
    changedPaths,
    membersIndex: overrides.membersIndex,
    bans: overrides.bans,
    repo,
  });

  if (!result.ready) {
    console.warn(`derive-award: not ready (${result.reason}); the apply step will no-op.`);
    setOutput('ready', 'false');
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'payload.json'), JSON.stringify(result.payload, null, 2));
  console.log('derive-award: wrote payload.json for ' + result.payload.targetFile);
  setOutput('ready', 'true');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error('derive-award: failed:', err?.message ?? err);
    setOutput('ready', 'false');
    process.exit(1);
  });
}
