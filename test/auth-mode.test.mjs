// sow-274 Part 2: NOTHING CAN CHOOSE THE OLD PUBLISHING PATH, because nothing chooses at all.
//
// SOW-157 kept a per-member mode (authModeFor, isHostedCtx, decideAuthMode) that picked between publishing
// through the network and publishing from the member's own copy of the repository. Part 2 deleted the chooser
// instead of pinning it to one answer, and this file is the guard on that decision.
//
// WHY THE SELECTOR AND NOT THE CALL SITE. A happy-path test of publish() passes just as well against a code base
// where the old arm is still there and simply not selected today. The failure this prevents is a later change
// that restores a chooser, reads the stored value again, or adds a fork write to a new operation, and every one
// of those would leave the publish tests green. So this asserts on the absence of the machinery.
//
// The trial invariant is restated here too, because its MECHANISM changed: it used to hold because a trial
// member's draft went to their fork, and now it holds because a draft goes to the private store.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import * as signupBase from '../client/src/signup-base.mjs';
import { saveDraft, publish, publishShare, publishComment, getOnboardingStatus } from '../client/src/operations.mjs';
import { buildContext } from '../client/src/context.mjs';
import { buildExtContext } from '../extension/src/ext-context.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/**
 * Source with its comments removed, so a guard reads what a module DOES rather than what it says about itself.
 *
 * A small scanner, not a pair of regular expressions. The regex version this replaced treated `house/**` inside a
 * LINE comment as the start of a block comment and deleted about 12,000 characters of real code up to the next
 * `*` + `/`, which is exactly the code these guards exist to look at, so they passed while blind. The scanner
 * tracks strings, template literals and regular expression literals, so a comment marker inside any of them is
 * left alone, and a line comment is removed before it can open anything.
 */
function codeOf(src) {
  let out = '';
  let i = 0;
  let prev = ''; // the last significant character emitted, to tell a regex literal from a division
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      prev = c;
      i = j + 1;
      continue;
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? src.length : end + 2; continue; }
    if (c === '/' && (prev === '' || '(,=:[!&|?{};+-*%<>~^'.includes(prev))) {
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      out += src.slice(i, j + 1);
      prev = '/';
      i = j + 1;
      continue;
    }
    out += c;
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out;
}

test('the comment stripper keeps code and removes only comments', () => {
  // A line comment naming a glob must not open a block comment and swallow the code after it (it did).
  const sample = "const a = 1; // house/** x\nconst b = 'x // y /* z'; /* gone */ const r = /[/'\"]+/g;\nconst t = `${a} // kept`;\nopenPull(a);";
  const out = codeOf(sample);
  assert.match(out, /openPull\(a\)/, 'code after a comment was removed');
  assert.match(out, /'x \/\/ y \/\* z'/, 'a string was treated as a comment');
  assert.match(out, /`\$\{a\} \/\/ kept`/, 'a template literal was treated as a comment');
  assert.doesNotMatch(out, /house|gone/, 'a comment survived');
});

test('the mode chooser is gone, not merely pinned', () => {
  for (const name of ['authModeFor', 'isHostedCtx', 'decideAuthMode']) {
    assert.equal(name in signupBase, false, `signup-base exports ${name} again, so something can choose a publishing path`);
  }
});

test('no client module reads a stored publishing mode or branches on one', () => {
  const dirs = ['client/src', 'client-ui/src', 'extension/src'];
  const offenders = [];
  for (const dir of dirs) {
    const walk = (rel) => {
      for (const ent of readdirSync(join(ROOT, rel), { withFileTypes: true })) {
        const child = `${rel}/${ent.name}`;
        if (ent.isDirectory()) { walk(child); continue; }
        if (!/\.m?js$/.test(ent.name)) continue;
        const code = codeOf(read(child));
        // A read of the stored value, in either store shape, or a call to any of the deleted choosers.
        if (/get\??\.?\(\s*['"]authMode['"]\s*\)/.test(code)) offenders.push(`${child}: reads the stored mode`);
        if (/\b(authModeFor|isHostedCtx|decideAuthMode)\s*\(/.test(code)) offenders.push(`${child}: asks a mode chooser`);
      }
    };
    walk(dir);
  }
  assert.deepEqual(offenders, []);
});

test('no publishing operation can reach a fork writer', () => {
  const FORK_WRITERS = /\b(publishFiles|publishContent|commitToBranchOnFork|ensureFork|syncForkIfCreatingBranch|workerSyncFork|forceBranch|deleteBranch|openPull)\b/;
  for (const rel of ['client/src/operations-drafts.mjs', 'client/src/operations-publish.mjs', 'client/src/operations-social.mjs']) {
    const hit = codeOf(read(rel)).split('\n').find((line) => FORK_WRITERS.test(line));
    assert.equal(hit, undefined, `${rel} can reach a fork writer again: ${hit}`);
  }
});

// ---- behaviour: a context that still carries a stored fork mode publishes through the network anyway ----

/**
 * A context whose store says 'app' (an old fork-mode session) and whose repo client would record any fork
 * write. The network fake answers the drafts and author routes and records what reached it.
 */
function legacyForkContext({ membership = 'paid' } = {}) {
  const forkWrites = [];
  const network = [];
  const repo = new Proxy({ upstream: 'gbti-network/gbti.network' }, {
    get(target, key) {
      if (key in target) return target[key];
      if (key === 'getFileContent') return async () => null;
      return async (...args) => { forkWrites.push(String(key)); return {}; };
    },
  });
  const ctx = {
    identity: () => ({ login: 'alice', githubId: '7', username: 'alice' }),
    store: { get: (k) => ({ githubToken: 'tok', authMode: 'app' })[k], set() {} },
    getRepoClient: () => repo,
    membership: async () => membership,
    reader: { readFile: async () => null, get: async () => null },
    now: () => '2026-09-16T12:00:00.000Z',
    fetch: async (url, init = {}) => {
      const u = String(url);
      const body = init.body ? JSON.parse(init.body) : null;
      network.push({ path: new URL(u).pathname, body });
      if (u.endsWith('/membership/author')) return { ok: true, status: 200, json: async () => ({ ok: true, branch: 'hosted/7/x', number: 9, html_url: 'u' }) };
      if (u.endsWith('/membership/drafts')) return { ok: true, status: 200, json: async () => ({ ok: true, drafts: [] }) };
      if (u.endsWith('/membership/encrypt')) return { ok: true, status: 200, json: async () => ({ ok: true, envelope: { v: 1 } }) };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  };
  return { ctx, forkWrites, network };
}

test('a session still marked for fork mode publishes an article through the network', async () => {
  const { ctx, forkWrites, network } = legacyForkContext();
  const r = await publish(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello', excerpt: 'e', categories: ['devops'] }, body: 'Body' });
  assert.equal(r.prNumber, 9);
  assert.deepEqual(forkWrites, [], 'a fork writer was called');
  const authored = network.filter((n) => n.path === '/membership/author');
  assert.equal(authored.length, 1);
  assert.ok(authored[0].body.files.some((f) => f.path === 'members/alice/posts/hello/index.md'));
});

test('shares and comments from that session go through the network too', async () => {
  const share = legacyForkContext();
  await publishShare(share.ctx, { input: { url: 'https://example.com/a', title: 'A link', visibility: 'public' }, body: '' });
  assert.deepEqual(share.forkWrites, []);
  assert.equal(share.network.filter((n) => n.path === '/membership/author').length, 1);

  const comment = legacyForkContext();
  await publishComment(comment.ctx, { targetType: 'post', targetSlug: 'hello', body: 'Nice', visibility: 'public' });
  assert.deepEqual(comment.forkWrites, []);
  assert.equal(comment.network.filter((n) => n.path === '/membership/author').length, 1);
});

test('the trial invariant: a trial member\'s draft lands in the private store and nowhere near the canonical repo', async () => {
  const { ctx, forkWrites, network } = legacyForkContext({ membership: 'trialing' });
  const r = await saveDraft(ctx, { type: 'post', input: { title: 'Draft', slug: 'draft', excerpt: 'e', categories: ['devops'] }, body: 'Unpublished' });
  assert.equal(r.state, 'staged');
  assert.deepEqual(forkWrites, [], 'a trial draft touched a repository');
  // Exactly one write, and it is the private store. Not the author route, which is the only way to the repo.
  assert.deepEqual(network.map((n) => n.path), ['/membership/drafts']);
  assert.equal(network[0].body.op, 'put');
  assert.equal(network[0].body.draft.body, 'Unpublished');
});

test('and a trial member still cannot publish, before anything is sent', async () => {
  const { ctx, forkWrites, network } = legacyForkContext({ membership: 'trialing' });
  await assert.rejects(
    publish(ctx, { type: 'post', input: { title: 'Hello', slug: 'hello', excerpt: 'e', categories: ['devops'] }, body: 'Body' }),
    (e) => e.code === 'membership-required',
  );
  assert.deepEqual(forkWrites, []);
  assert.deepEqual(network, []);
});

// ---- reads: a member's pull requests are listed by the network, on both hosts ----
//
// Publishing through the network means GBTI's App opens the pull request, so a direct GitHub search by the
// member as author finds nothing. The command line tool used to search that way whenever its session said
// 'classic'. Both hosts must now ask the network, whatever an old session has stored.

test('both hosts list a member\'s pull requests through the network, even for a session stored as classic', async () => {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    return { ok: true, status: 200, text: async () => JSON.stringify({ items: [] }), json: async () => ({ items: [] }) };
  };
  try {
    const store = { get: (k) => ({ githubToken: 'tok', authMode: 'classic' })[k], set() {} };
    await buildContext(store).getRepoClient().listMyPulls('alice');
    await buildExtContext(store).getRepoClient().listMyPulls('alice');
  } finally {
    globalThis.fetch = original;
  }
  assert.equal(calls.length, 2);
  for (const url of calls) {
    assert.match(url, /\/membership\/my-pulls$/, `a host searched GitHub directly: ${url}`);
  }
});

test('onboarding has one step left, signing in, whatever an old session has stored', async () => {
  const signedIn = await getOnboardingStatus({ store: { get: (k) => ({ githubToken: 'tok', authMode: 'app' })[k] } });
  assert.equal(signedIn.ready, true);
  assert.equal(signedIn.activeStep, 'ready');
  assert.equal(signedIn.mode, 'hosted');
  // Nothing to wait on: a fork or an install step can never hold a member back again.
  assert.equal(signedIn.forkReady, true);
  assert.equal(signedIn.installReady, true);

  const signedOut = await getOnboardingStatus({ store: { get: () => null } });
  assert.equal(signedOut.ready, false);
  assert.equal(signedOut.activeStep, 'signin');
});
