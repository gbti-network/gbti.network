// BaseLayout builds `fullTitle` as `${title} | ${siteName}` and uses it for BOTH <title> and og:title. A
// page that passes a title already carrying the brand therefore double-brands itself, and the visible
// symptom shows up where it does the most damage: og:title is what every share preview renders.
//
// Three pages shipped that way (/codeable-invite/, /brand/, /handbook/) and it was caught by the owner in a
// Slack unfurl of a real Codeable invite on 2026-08-13, reading
//   "Codeable experts: your first year on us · GBTI Network | GBTI Network"
//
// This is a source-level guard rather than a rendered-output one on purpose: it fails at the line that
// causes the problem, which is what someone adding a page will actually read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SITE_NAME = 'GBTI Network';

/** Every .astro page under src/pages, recursively. */
function pageFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) pageFiles(p, out);
    else if (e.name.endsWith('.astro')) out.push(p);
  }
  return out;
}

test('no page passes BaseLayout a title that already carries the site name', () => {
  const offenders = [];
  for (const file of pageFiles(path.join(ROOT, 'src', 'pages'))) {
    const src = fs.readFileSync(file, 'utf8');
    // Only the literal `title="..."` prop form; an expression title is the page's own business.
    for (const m of src.matchAll(/\btitle="([^"]*)"/g)) {
      if (m[1].includes(SITE_NAME)) offenders.push(`${path.relative(ROOT, file)}: title="${m[1]}"`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `BaseLayout appends " | ${SITE_NAME}" itself, so these titles render twice-branded in <title> AND og:title:\n${offenders.join('\n')}`,
  );
});

// The guard above is only correct while BaseLayout still appends the brand. If that changes, the rule
// inverts and every bare title silently loses its branding, so pin the behaviour it depends on.
test('DRIFT: BaseLayout still composes fullTitle by appending the site name', () => {
  // sow-256 changed the operand from `title` to `pageTitle`, the blank-safe form. This assertion used to
  // pin the literal `title === siteName ? title : ...`; it pins the same BEHAVIOUR against the new name,
  // because what the guard above depends on is that the brand is still appended, not which variable holds
  // the title.
  const src = fs.readFileSync(path.join(ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf8');
  assert.match(src, /const fullTitle = pageTitle === siteName \? pageTitle : `\$\{pageTitle\} \| \$\{siteName\}`/);
  assert.match(src, /<title>\{fullTitle\}<\/title>/);
  assert.match(src, /property="og:title" content=\{fullTitle\}/);
});

// ---------------------------------------------------------------------------
// sow-256: a title that is PRESENT but blank. Split out of sow-178, which fixed the MISSING-title case with
// a destructuring default; that default fires only on `undefined`, so `title: ""` sailed past it and the
// page shipped " | GBTI Network" with a dangling separator, in og:title too. Whitespace is included because
// "   " produces the same output and the original report named only the empty string.

test('a blank title falls back to the site name instead of a dangling separator', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'layouts', 'BaseLayout.astro'), 'utf8');
  assert.match(src, /const pageTitle = String\(title \?\? ''\)\.trim\(\) \|\| siteName;/,
    'the layout must neutralise a blank title for the callers no content schema can reach');
  // The composition the line produces, exercised rather than only read.
  const compose = (title) => { const siteName = SITE_NAME; const pageTitle = String(title ?? '').trim() || siteName; return pageTitle === siteName ? pageTitle : `${pageTitle} | ${siteName}`; };
  assert.equal(compose(''), SITE_NAME);
  assert.equal(compose('   '), SITE_NAME);
  assert.equal(compose(undefined), SITE_NAME);
  assert.equal(compose('An article'), `An article | ${SITE_NAME}`);
});

test('every title declaration in the site schema refuses a blank string', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'content.config.ts'), 'utf8');
  assert.match(src, /const titleText = \(\) => z\.string\(\)\.refine\(\(s\) => s\.trim\(\)\.length > 0/,
    'it REFUSES rather than trims, so a validation pass never silently rewrites a committed value');
  const plain = src.match(/^\s*title: z\.string\(\)/gm) || [];
  assert.deepEqual(plain, [], `${plain.length} title field(s) still admit an empty string`);
  const guarded = src.match(/title: titleText\(\)/g) || [];
  assert.ok(guarded.length >= 5, `expected every title declaration to be guarded, found ${guarded.length}`);
});

// The client mirror carries the same rule, or the pre-flight validator in the npm CMS and the MCP passes
// content the site build then rejects. These run the real schema rather than reading it.
test('the client schemas refuse a blank title and still allow an omitted share headline', async () => {
  // The map is keyed `project`, not `product` (the type was renamed; the exported schema object kept the old
  // name), and `share` is not in it at all, so its schema is imported directly.
  const { schemaFor, shareSchema } = await import('../client/src/schemas.mjs');
  const post = (over) => ({ title: 'A real title', slug: 'a-slug', author: 'someone', ...over });
  assert.equal(schemaFor('post').safeParse(post()).success, true, 'a normal post still validates');
  for (const bad of ['', '   ', '\t\n']) {
    const r = schemaFor('post').safeParse(post({ title: bad }));
    assert.equal(r.success, false, `a post titled ${JSON.stringify(bad)} must be rejected`);
    assert.match(JSON.stringify(r.error.issues), /title must not be empty/);
  }
  for (const type of ['post', 'project', 'prompt']) {
    const s = schemaFor(type);
    assert.ok(s, `${type} is not in the schema map, so this loop would silently skip it`);
    assert.equal(s.safeParse(post({ title: '' })).success, false, `${type} must refuse a blank title`);
  }
  // A share headline is OPTIONAL by design (the body carries the note), so omitting it is correct and only
  // a present-but-blank value is an error.
  const share = { id: 'x', author: 'someone', createdAt: '2026-09-12T00:00:00.000Z', url: 'https://example.com' };
  const omitted = shareSchema.safeParse(share);
  assert.equal(omitted.success, true, `omitting a share headline must stay valid: ${JSON.stringify(omitted.error?.issues)}`);
  assert.equal(shareSchema.safeParse({ ...share, title: '' }).success, false, 'a blank share headline is not');
});

test('the standalone validator says WHY, at the earliest gate', () => {
  // The schemas refuse it, but a member meets `npm run check:content` first and a raw zod issue is not an
  // instruction. Driven for real before shipping: a fixture with title: "" failed with this sentence, and
  // the tree passed again once removed.
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'validate-content.mjs'), 'utf8');
  assert.match(src, /function checkTitle\(fm, rel, type\)/);
  assert.match(src, /title must not be blank/);
  // Match the CALLS, with their semicolons. A bare `includes('checkTitle(fm, rel, type)')` is satisfied by
  // the function DEFINITION, so it passed with every call site deleted: caught by mutating the call away
  // and watching this test stay green.
  assert.match(src, /\n\s+checkTitle\(fm, rel, type\);/, 'the post/project/prompt branch must call it');
  assert.match(src, /\n\s+checkTitle\(fmc, rel, type\);/, 'the share/comment branch must call it');
  // It must read the PARSED frontmatter: `field()` needs a non-quote character, so it cannot tell a blank
  // title from a missing one.
  const fn = src.slice(src.indexOf('function checkTitle'), src.indexOf('/** sow-140'));
  assert.ok(!fn.includes('field('), 'checkTitle must not use field(), which is blind to an empty string');
});
