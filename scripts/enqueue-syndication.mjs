#!/usr/bin/env node
// SOW-058 P4: the content-publish ENQUEUE runner (replaces the immediate Discord post in syndicate-content.mjs).
// Given the content files ADDED in a push to main, it builds a syndication queue item per publishable
// post/product/prompt and ENQUEUES it via the Cloudflare KV REST API. NOTHING posts here: each item is `pending` and
// waits for a superadmin to APPROVE it in the tracker, after which the Worker drain posts it to every enabled
// channel. SHARES are NOT enqueued on publish (they enqueue via the SOW-057 upvote threshold, server-side). Metadata
// only (url + title + blurb + image); a members-only / Mode A body is NEVER read. The author's Discord mention is
// resolved at enqueue time (Stripe) and stored on the item, so the drain stays network-free for identity.
//   node scripts/enqueue-syndication.mjs --added members/alice/posts/x/index.md        # dry-run (no KV write)
//   node scripts/enqueue-syndication.mjs --apply --added <path> [<path> ...]           # enqueue to KV
// Requires (for --apply): CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN; STRIPE_SECRET_KEY enables @mentions.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { parseContentFile } from '../client/src/content-ops.mjs';
import { createStripeClient } from '../clients/stripe.mjs';
import { buildSyndicationItem, publicUrlFor } from './lib/content-syndication.mjs';
import { reverseMembersIndex, createMentionResolver } from './lib/discord-mention.mjs';
import { enqueueViaKvRest } from './lib/syndication-rest.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function parseArgs(argv) {
  const apply = argv.includes('--apply');
  const ai = argv.indexOf('--added');
  let added = [];
  if (ai >= 0) {
    added = argv.slice(ai + 1)
      .filter((a) => !a.startsWith('--'))
      .flatMap((t) => String(t).split(/[\s,]+/))
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return { apply, added };
}

/** Load house/members-index.yml into a { github_id: username } map (flat, or under a `members:` key). */
function loadMembersIndex(root) {
  try {
    const doc = yaml.load(fs.readFileSync(path.join(root, 'house/members-index.yml'), 'utf8')) ?? {};
    const map = doc && typeof doc === 'object' && doc.members && typeof doc.members === 'object' ? doc.members : doc;
    const out = {};
    for (const [k, v] of Object.entries(map || {})) if (v && typeof v === 'string') out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function parseOverrides(env) {
  try { return env.DISCORD_MENTION_OVERRIDES ? JSON.parse(env.DISCORD_MENTION_OVERRIDES) : {}; } catch { return {}; }
}

/** Path-key for the queue dedupe/targetSlug: members/alice/posts/x/index.md -> members/alice/posts/x. */
export function pathKey(rel) {
  return String(rel).replace(/\/index\.md$/, '').replace(/\.md$/, '');
}

/** Map a buildSyndicationItem result + its frontmatter to a buildQueueItem INPUT (metadata only, never the body). */
export function toQueueInput({ item, fm, rel, mention, siteOrigin }) {
  return {
    source: item.type,
    targetType: item.type,
    targetSlug: pathKey(rel),
    author: item.author,
    title: item.title,
    blurb: (fm.shortDescription || fm.excerpt || fm.description || '').toString().trim() || null,
    url: publicUrlFor(item, siteOrigin) || null, // null for a Mode A members-only item (no public page)
    image: fm.coverImage || fm.image || null,
    visibility: item.visibility,
    mention: mention || null,
    trigger: 'publish',
  };
}

export async function main({ argv = process.argv.slice(2), root = ROOT, env = process.env, fetchImpl = globalThis.fetch, deps = {} } = {}) {
  const { apply, added: argvAdded } = parseArgs(argv);
  // The workflow passes paths via the SYNDICATE_ADDED env var (NOT argv) so a path can never be shell-interpreted.
  const added = argvAdded.length
    ? argvAdded
    : String(env.SYNDICATE_ADDED || '').split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
  const readFile = deps.readFile ?? ((rel) => {
    try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return null; }
  });
  const siteOrigin = env.SITE_ORIGIN || 'https://gbti.network';

  // Build a publishable item from each added path; SHARES are excluded (they enqueue via the SOW-057 upvote path).
  const built = [];
  for (const rel of added) {
    const txt = readFile(rel);
    if (txt == null) continue;
    let fm;
    try { fm = parseContentFile(txt).frontmatter; } catch { continue; }
    const item = buildSyndicationItem(rel, fm);
    if (item && item.type !== 'share') built.push({ item, fm, rel });
  }
  console.log(`enqueue-syndication: ${added.length} changed path(s), ${built.length} publishable item(s)${apply ? '' : ' (dry-run)'}`);
  if (!built.length) {
    if (!apply) console.log('Nothing to enqueue.');
    return { enqueued: 0, inputs: [] };
  }

  // Resolve each author's Discord mention at enqueue time (Stripe), so the drain never re-hits Stripe.
  const reverseIndex = reverseMembersIndex(loadMembersIndex(root));
  const stripe = deps.stripe ?? (env.STRIPE_SECRET_KEY ? createStripeClient({ apiKey: env.STRIPE_SECRET_KEY, fetch: fetchImpl }) : null);
  const resolveMention = deps.resolveMention ?? createMentionResolver({ reverseIndex, stripe, overrides: parseOverrides(env) });

  const inputs = [];
  for (const b of built) inputs.push(toQueueInput({ ...b, mention: await resolveMention(b.item.author), siteOrigin }));
  for (const inp of inputs) console.log(`  -> ${inp.source}: ${inp.targetSlug}${inp.url ? '' : ' (members-only, link-less)'}`);

  if (!apply) {
    console.log('\nDry-run only. Re-run with --apply to enqueue to KV (items then wait for superadmin approval).');
    return { enqueued: 0, inputs };
  }
  const r = await enqueueViaKvRest(inputs, { env, fetchImpl: deps.enqueueFetch ?? fetchImpl });
  if (!r.available) {
    console.error(`✗ --apply needs CF_ACCOUNT_ID / CF_KV_NAMESPACE_ID / CF_API_TOKEN (${r.reason})`);
    process.exitCode = 1;
    return { enqueued: 0, inputs };
  }
  console.log(`enqueued ${r.enqueued}/${inputs.length} (pending superadmin approval)`);
  return { enqueued: r.enqueued, inputs, results: r.results };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
