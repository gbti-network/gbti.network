// A published share must carry a category (owner, 2026-09-21: "Shares should not make it into being published
// without a category"). A share's category is ONE flat key from house/topics.yml (SOW-087); it is what the feeds
// file the share under, what the digest shows beside the author, and what routes its Discord post.
//
// WHY THE RULE LIVES IN EVERY LAYER. main has no required status checks, so the content check in CI only
// complains after an uncategorized share has already merged and deployed. The rule therefore runs where a share
// is built (client/src/content-ops.mjs buildShareFile, which the extension, the website and the agent tools all
// pass through), where it is accepted (the signup Worker's author route, so a direct call cannot skip the
// client), and in scripts/validate-content.mjs as the backstop for anything committed by hand.
//
// Only a PUBLISHED share needs one. A draft is not on the site, and the share schema defaults an absent status
// to draft (src/content.config.ts), so an absent status is a draft here too.
//
// Node-free and pure, so the Worker, the client bundles and node tests share one definition.

export const SHARE_CATEGORY_REQUIRED = 'A published share needs a category. Choose the topic it belongs to, then publish.';

const hasText = (v) => typeof v === 'string' && v.trim() !== '';

/**
 * Why this share's frontmatter cannot be published, or null when it can. `topicKeys` is optional: when the caller
 * holds the vocabulary, an unknown key is refused too; without it only presence is checked, and
 * validate-content still checks the key in CI.
 */
export function shareCategoryProblem(frontmatter, { topicKeys = null } = {}) {
  const fm = frontmatter && typeof frontmatter === 'object' ? frontmatter : {};
  if (fm.status !== 'published') return null;
  if (!hasText(fm.category)) return SHARE_CATEGORY_REQUIRED;
  const keys = topicKeys instanceof Set ? topicKeys : Array.isArray(topicKeys) ? new Set(topicKeys) : null;
  if (keys && keys.size > 0 && !keys.has(fm.category.trim())) {
    return `"${fm.category.trim()}" is not one of the network's topics. Choose a category from the list, then publish.`;
  }
  return null;
}

// The two frontmatter fields this needs, read from a serialized file. ONLY the frontmatter block is read, for the
// reason statedVisibility gives in hosted-author.mjs: a body line reading `category: x` must not count.
const SCALAR = (name) => new RegExp(`^${name}:[ \\t]*(?:"([^"\\n]*)"|'([^'\\n]*)'|([^\\s#][^\\n#]*?))?[ \\t]*(?:#.*)?$`, 'm');
function scalar(block, name) {
  const m = SCALAR(name).exec(block);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3] ?? '';
}

/** The `status` and `category` a serialized share file states. A file with no frontmatter block states neither. */
export function shareFrontmatterFields(content) {
  if (typeof content !== 'string') return {};
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(content);
  if (!fm) return {};
  return { status: scalar(fm[1], 'status'), category: scalar(fm[1], 'category') };
}

const SHARE_FILE_RE = /^(?:members\/[a-z0-9][a-z0-9-]*|house)\/shares\/[^/]+\.md$/i;

/**
 * The first reason a request's share files cannot be published, or null. Deletes and binary entries publish
 * nothing and are skipped. A share file whose content cannot be read is left to the path and size rules that run
 * before this, which already refuse it.
 */
export function shareFilesCategoryProblem(files, { topicKeys = null } = {}) {
  if (!Array.isArray(files)) return null;
  for (const f of files) {
    if (!f || typeof f.path !== 'string' || !SHARE_FILE_RE.test(f.path)) continue;
    if (typeof f.content !== 'string') continue;
    const problem = shareCategoryProblem(shareFrontmatterFields(f.content), { topicKeys });
    if (problem) return problem;
  }
  return null;
}
