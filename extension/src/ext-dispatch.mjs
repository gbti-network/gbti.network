// The extension's request dispatcher (SOW-006 v2 P4). The content script's GbtiClient is just
// createHttpClient with a MESSAGING fetch, so it produces the same /api/* requests the npm host serves; this
// dispatcher answers them in the background worker. It mirrors client/src/api.mjs's routes, but is
// async-reader-aware (the extension reads content over the GitHub Contents API, which is async, whereas the
// npm reader is sync fs). Reader-free operations (validate, publish) are reused from the core UNCHANGED; the
// reader-dependent reads (status' role, content, content/item, members) call the async reader directly. Pure
// over the injected ctx, so it is unit-tested in node with a fake ctx.

import { OperationError, validateContent, publish, publishShare, listShares, listShareComments, readContent, publishComment, editComment, getComment, decryptMemberAsset, getMemberActivity, mutateMemberActivity, getFollows, setFollow, getDiscordInvite, getOnboardingStatus } from '../../client/src/operations.mjs';
import { fieldsFor } from '../../client/src/form-fields.mjs';
import { renderMarkdown } from '../../client/src/markdown.mjs';
import { roleOf, rolesFromText } from '../../client/src/roles.mjs';

const CODE_STATUS = Object.freeze({
  'no-identity': 409,
  'not-authenticated': 401,
  'not-found': 404,
  'bad-request': 400,
  'invalid-content': 400,
  'membership-required': 402, // SOW-011: publishing is paid-only
  forbidden: 403,
});

const ok = (json) => ({ status: 200, json });

async function computeRole(ctx) {
  const id = ctx.identity?.();
  if (!id?.githubId) return 'member';
  const text = await ctx.reader.readFile('house/roles.yml');
  return roleOf(id.githubId, rolesFromText(text));
}

function requireRepo(ctx) {
  const repo = ctx.getRepoClient?.();
  if (!repo) throw new OperationError('not-authenticated', 'sign in first');
  return repo;
}

/** Answer one /api/* request. @returns {Promise<{status:number, json:any}>} */
export async function dispatch(ctx, { method = 'GET', pathname, query = {}, body } = {}) {
  try {
    const id = ctx.identity?.();
    if (pathname === '/api/status') {
      const membership = ctx.membership?.() ?? 'unknown'; // SOW-011: cached at login; drives the publish notice
      return ok({
        version: '0.1.0',
        identity: id ?? null,
        role: await computeRole(ctx),
        authenticated: Boolean(ctx.store?.get('githubToken')),
        membership,
        canPublish: membership === 'paid',
      });
    }
    // SOW-026: first-run readiness must work BEFORE sign-in: it is the route that DRIVES the sign-in step (it
    // tells the wizard "you are not signed in yet, here is step 1"). So it is a PRE-AUTH route like /api/status,
    // handled before the requires-identity gate below. (Previously it sat inside the switch after the gate, so a
    // not-signed-in member got a 409, the wizard's onboardingStatus() threw, and it showed a dead-end
    // "could not reach GitHub" with no sign-in prompt instead of step 1.)
    if (pathname === '/api/onboarding-status') return ok(await getOnboardingStatus(ctx));

    const username = id?.username;
    if (!username) throw new OperationError('no-identity', 'no signed-in identity; sign in first');

    switch (pathname) {
      case '/api/content':
        return ok({ items: await ctx.reader.list(username, query.type || undefined) });
      case '/api/content/item': {
        const item = await ctx.reader.get(username, query.path);
        if (!item) throw new OperationError('not-found', 'no such item in your folder');
        return ok(item);
      }
      case '/api/read': // SOW-031: read ANY published content index.md (allowlist-gated) for the in-extension reader
        return ok(await readContent(ctx, { path: query.path })); // shared op (parity with the npm host /api/read)
      case '/api/members-content':
        return ok({ items: await ctx.reader.listMembersOnly() });
      case '/api/form-fields':
        return ok({ fields: fieldsFor(query.type) ?? [] });
      case '/api/preview':
        return ok({ html: renderMarkdown(body?.body ?? '') });
      case '/api/validate':
        return ok(validateContent(ctx, body)); // reader-free
      case '/api/publish':
        return ok(await publish(ctx, body)); // reader-free (uses content-ops + the repo client)
      case '/api/share':
        return ok(await publishShare(ctx, body)); // SOW-018: reader-free; members Share encrypts via the Worker
      case '/api/shares':
        return ok(await listShares(ctx, { limit: Number(query.limit) || undefined })); // SOW-018 feed (Git Trees enumerate)
      case '/api/share-comments':
        return ok(await listShareComments(ctx, { targetSlug: query.targetSlug, limit: Number(query.limit) || undefined })); // SOW-032 discussion (Git Trees enumerate)
      case '/api/comment': // SOW-027: publish a comment (POST) or read one's own for an edit prefill (GET)
        return ok(method === 'POST' ? await publishComment(ctx, body) : await getComment(ctx, { id: query.id }));
      case '/api/comment/edit':
        return ok(await editComment(ctx, body)); // SOW-027: re-publish with updatedAt set
      case '/api/member-decrypt':
        return ok(await decryptMemberAsset(ctx, body)); // SOW-016: reads the .enc via the reader, decrypts via the Worker
      case '/api/activity': // SOW-024: member activity (favorites + collections) in the deletable edge store, via the Worker
        return ok(method === 'POST' ? await mutateMemberActivity(ctx, body) : await getMemberActivity(ctx));
      case '/api/follows': // SOW-023: the follow graph (subscriptions) in the deletable edge store, via the Worker (paid-only)
        return ok(method === 'POST' ? await setFollow(ctx, body) : await getFollows(ctx));
      case '/api/discord-invite': // on-demand Discord guild invite, minted + cached by the Worker
        return ok(await getDiscordInvite(ctx));
      case '/api/prs':
        return ok({ prs: await requireRepo(ctx).listMyPulls(id.login) });
      case '/api/pr-status': {
        // Mirror operations.prStatus's guard: the npm host validates the PR number before hitting GitHub, so
        // the extension must too (else NaN/0/negative numbers reach GET /pulls/<n> under the member's token).
        const n = Number(query.number);
        if (!Number.isInteger(n) || n <= 0) throw new OperationError('bad-request', 'a positive PR number is required');
        return ok(await requireRepo(ctx).gateStatus(n));
      }
      default:
        return { status: 404, json: { error: 'not_found' } };
    }
  } catch (err) {
    if (err instanceof OperationError) return { status: CODE_STATUS[err.code] ?? 400, json: { error: err.code, message: err.message } };
    return { status: 500, json: { error: 'internal', message: err?.message } };
  }
}
