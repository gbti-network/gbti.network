// sow-354: an imported article with an 85 character slug built and served fine and could not be saved or
// published from any surface, because every store keyed by the slug checked its own 80 character cap while
// nothing capped the slug itself. These tests hold every store to the one shared limit, and hold every item
// already in the repo to it, so a content file that exists is always a content file that can be saved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { SLUG_MAX, ITEM_ID_MAX } from '../membership/item-id.mjs';
import { validateHostedRequest, hostedBranchFor, parseHostedRef } from '../membership/hosted-author.mjs';
import { applyDraftPut } from '../membership/member-drafts.mjs';
import { itemTokenOf } from '../membership/draft-images.mjs';
import { hostedItemId } from '../client/src/hosted-publish.mjs';
import { postSchema, productSchema, promptSchema } from '../client/src/schemas.mjs';
import { SLUG_RE as RENAME_SLUG_RE } from '../client/src/operations-publish.mjs';

const ROOT = new URL('..', import.meta.url);
const GITHUB_ID = '125175036';
const TYPE_OF = { posts: 'post', projects: 'project', prompts: 'prompt' };

// Every post, project and prompt in the repo, with the slug its frontmatter declares.
function contentItems() {
  const out = execFileSync('git', ['ls-files', '--', 'members/*/posts/*/index.md', 'members/*/projects/*/index.md',
    'members/*/prompts/*/index.md', 'house/posts/*', 'house/projects/*', 'house/prompts/*'], { cwd: ROOT, encoding: 'utf8' });
  return out.split('\n').filter(Boolean).map((path) => {
    const folder = path.split('/').find((seg) => TYPE_OF[seg]);
    const slug = /^slug:\s*"?([^"\n]*)"?\s*$/m.exec(readFileSync(new URL(path, ROOT), 'utf8'))?.[1] ?? '';
    return { path, type: TYPE_OF[folder], slug };
  }).filter((it) => it.type && it.slug);
}

// Each store's own answer for one slug, so a failure names the store that refused.
function storesAccept(type, slug) {
  const itemId = hostedItemId(type, slug);
  const branch = hostedBranchFor(GITHUB_ID, itemId);
  const publish = validateHostedRequest({
    itemId, folder: 'atwellpub', files: [{ path: `members/atwellpub/${type}s/${slug}/index.md`, content: 'x' }],
  });
  let draft = true;
  try { applyDraftPut({}, { type, slug, frontmatter: {}, body: 'x' }); } catch { draft = false; }
  return {
    publish: publish.ok === true,
    branch: branch !== null && parseHostedRef(branch) === GITHUB_ID,
    draft,
    images: itemTokenOf(`${type}:${slug}`) !== null,
  };
}

test('the limits fit together: the longest type prefix plus the longest slug is the longest item id', () => {
  assert.equal(SLUG_MAX, 120);
  assert.equal(ITEM_ID_MAX, 'project-'.length + SLUG_MAX);
});

test('every post, project and prompt in the repo can be saved, staged and published', () => {
  const items = contentItems();
  // Not vacuous: the repo holds dozens of items, and at least one slug is past the old 80 character cap.
  assert.ok(items.length > 50, `only ${items.length} items found`);
  assert.ok(items.some((it) => it.slug.length > 80), 'no slug over 80 characters, so this test no longer covers the defect');
  const refused = [];
  for (const it of items) {
    assert.ok(it.slug.length <= SLUG_MAX, `${it.path}: slug is ${it.slug.length} characters, over ${SLUG_MAX}`);
    const r = storesAccept(it.type, it.slug);
    const no = Object.entries(r).filter(([, ok]) => !ok).map(([k]) => k);
    if (no.length) refused.push(`${it.path} (${it.slug.length} chars): refused by ${no.join(', ')}`);
  }
  assert.deepEqual(refused, []);
});

test('the Moon article, the item that reported it, is accepted by every store', () => {
  const slug = 'the-moon-is-a-harsh-mistress-revisiting-a-scifi-masterpiece-in-the-age-of-emergent-ai';
  assert.equal(slug.length, 85);
  assert.deepEqual(storesAccept('post', slug), { publish: true, branch: true, draft: true, images: true });
});

test('a slug at the limit fits every store, and one past it is refused where it is written', () => {
  const atLimit = 'a'.repeat(SLUG_MAX);
  assert.deepEqual(storesAccept('project', atLimit), { publish: true, branch: true, draft: true, images: true });
  assert.equal(hostedItemId('project', atLimit).length, ITEM_ID_MAX);

  const over = 'a'.repeat(SLUG_MAX + 1);
  const base = { title: 'T', author: 'atwellpub', publishedAt: '2026-09-16' };
  for (const [name, schema, extra] of [['post', postSchema, {}], ['project', productSchema, {}], ['prompt', promptSchema, { shortDescription: 'd' }]]) {
    const res = schema.safeParse({ ...base, ...extra, slug: over });
    assert.equal(res.success, false, `${name} schema accepted a ${SLUG_MAX + 1} character slug`);
    assert.ok(res.error.issues.some((i) => /at most 120 characters/.test(i.message)), `${name}: ${JSON.stringify(res.error.issues.map((i) => i.message))}`);
    assert.equal(schema.safeParse({ ...base, ...extra, slug: atLimit }).error?.issues.some((i) => i.path[0] === 'slug') ?? false, false);
  }
  assert.throws(() => applyDraftPut({}, { type: 'post', slug: over }), /valid draft slug/);
  assert.equal(itemTokenOf(`post:${over}`), null);
  assert.equal(RENAME_SLUG_RE.test(over), false);
  assert.equal(RENAME_SLUG_RE.test(atLimit), true);
  // An item id past the limit is refused by the branch builder and the gate's parser alike.
  const longId = 'a'.repeat(ITEM_ID_MAX + 1);
  assert.equal(hostedBranchFor(GITHUB_ID, longId), null);
  assert.equal(parseHostedRef(`hosted/${GITHUB_ID}/${longId}`), null);
  assert.equal(validateHostedRequest({ itemId: longId, folder: 'atwellpub', files: [] }).error, `itemId must be lowercase letters, digits, and hyphens (max ${ITEM_ID_MAX})`);
});

test('the site schema and the editor field use the same limit', () => {
  const config = readFileSync(new URL('src/content.config.ts', ROOT), 'utf8');
  assert.match(config, /import \{ SLUG_MAX \} from '\.\.\/membership\/item-id\.mjs';/);
  assert.equal(config.split('slug: z.string().max(SLUG_MAX, SLUG_TOO_LONG)').length - 1, 3, 'post, project and prompt slugs are capped');
  const editor = readFileSync(new URL('client-ui/src/elements/gbti-content-editor.mjs', ROOT), 'utf8');
  assert.match(editor, /<input id="slugfield" type="text" spellcheck="false" maxlength="\$\{SLUG_MAX\}"/);
});
