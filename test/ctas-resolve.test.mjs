// sow-281: the read side of the CTA registry: ctaFor, resolveAssignments, itemUrl, the file store, the on-disk
// item check the content check uses, and the rel=sponsored rehype rule for partner redirect links.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ctaFor, resolveAssignments, itemUrl, assignmentsOf, itemKey } from '../src/lib/ctas.mjs';
import { readCtas, ctaItemExists, CTAS_PATH } from '../scripts/lib/ctas-store.mjs';
import { rehypeSponsoredLinks, sitePathOf } from '../src/lib/rehype-sponsored-links.mjs';
import { outboundRows } from '../scripts/lib/outbound-links-store.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const cta = (over = {}) => ({ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get the book on Amazon', destination: AMZ, partner: 'amazon', enabled: true, items: [{ type: 'prompt', ref: 'grok' }], ...over });

test('ctaFor: the enabled CTA assigned to the item; null for unassigned, disabled, or a wrong type', () => {
  const reg = { ctas: [cta()] };
  assert.equal(ctaFor(reg, 'prompt', 'grok')?.id, 'book');
  assert.equal(ctaFor(reg, 'prompt', 'other'), null, 'unassigned');
  assert.equal(ctaFor(reg, 'post', 'grok'), null, 'same slug, different type');
  assert.equal(ctaFor({ ctas: [cta({ enabled: false })] }, 'prompt', 'grok'), null, 'a disabled CTA never renders');
  assert.equal(ctaFor({ ctas: [cta({ enabled: 'true' })] }, 'prompt', 'grok'), null, 'enabled must be the boolean true');
  assert.equal(ctaFor({}, 'prompt', 'grok'), null);
  assert.equal(ctaFor(null, 'prompt', 'grok'), null);
  // A share is addressed by author/id.
  const share = { ctas: [cta({ items: [{ type: 'share', ref: 'atwellpub/20260610-astro-content-layer' }] })] };
  assert.equal(ctaFor(share, 'share', 'atwellpub/20260610-astro-content-layer')?.id, 'book');
  // Two enabled CTAs on one item: registry order decides, deterministically.
  const two = { ctas: [cta({ id: 'first', enabled: false }), cta({ id: 'second' }), cta({ id: 'third' })] };
  assert.equal(ctaFor(two, 'prompt', 'grok').id, 'second');
});

test('resolveAssignments: marks an assignment that names nothing resolved:false and NEVER drops it', () => {
  const reg = { ctas: [cta({ enabled: false, note: 'n', items: [{ type: 'prompt', ref: 'grok' }, { type: 'post', ref: 'gone' }, { type: 'project', ref: 'draft-one' }] })] };
  const items = [
    { type: 'prompt', ref: 'grok', title: 'Grok', live: true },
    { type: 'project', ref: 'draft-one', title: 'Draft', live: false },
  ];
  const out = resolveAssignments(reg, items);
  assert.equal(out.length, 1);
  assert.equal(out[0].enabled, false);
  assert.equal(out[0].note, 'n');
  assert.equal(out[0].items.length, 3, 'the unresolved assignment is kept');
  assert.deepEqual(out[0].items[0], { type: 'prompt', ref: 'grok', resolved: true, live: true, title: 'Grok', url: '/prompts/grok/' });
  assert.deepEqual(out[0].items[1], { type: 'post', ref: 'gone', resolved: false, live: false, title: null, url: null });
  assert.deepEqual(out[0].items[2], { type: 'project', ref: 'draft-one', resolved: true, live: false, title: 'Draft', url: null }, 'a draft resolves but has no live url');
  assert.deepEqual(resolveAssignments({}, items), []);
});

test('itemUrl / itemKey / assignmentsOf', () => {
  assert.equal(itemUrl('prompt', 'grok'), '/prompts/grok/');
  assert.equal(itemUrl('post', 'a-post'), '/articles/a-post/');
  assert.equal(itemUrl('project', 'p'), '/projects/p/');
  assert.equal(itemUrl('share', 'atwellpub/20260610-x'), '/shares/atwellpub/20260610-x/');
  assert.equal(itemUrl('share', 'nope'), null);
  assert.equal(itemUrl('page', 'x'), null);
  assert.equal(itemUrl('post', '../x'), null);
  assert.equal(itemKey('post', ' x '), 'post:x');
  assert.deepEqual(assignmentsOf({ ctas: [cta(), cta({ id: 'b', enabled: false, items: [{ type: 'post', ref: 'p' }] })] }), [
    { ctaId: 'book', type: 'prompt', ref: 'grok', enabled: true },
    { ctaId: 'b', type: 'post', ref: 'p', enabled: false },
  ]);
});

test('the store: the committed registry reads; a malformed one throws with the problem named; a missing file is empty', () => {
  const reg = readCtas(ROOT, { fresh: true });
  assert.ok(Array.isArray(reg.ctas) && reg.ctas.length >= 1);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ctas-'));
  assert.deepEqual(readCtas(tmp), { ctas: [] }, 'no file, no CTAs');
  fs.mkdirSync(path.join(tmp, 'house'));
  fs.writeFileSync(path.join(tmp, CTAS_PATH), 'ctas:\n  - id: x\n    label: L\n    line: l\n    button: b\n    destination: https://www.amazon.com/dp/1\n    partner: amazon\n');
  assert.throws(() => readCtas(tmp, { fresh: true }), /tag= parameter/);
  fs.writeFileSync(path.join(tmp, CTAS_PATH), '');
  assert.deepEqual(readCtas(tmp, { fresh: true }), { ctas: [] }, 'an empty file is an empty registry');
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('ctaItemExists: finds member and house items by type, a share by author/id, and refuses a traversal ref', () => {
  assert.equal(ctaItemExists(ROOT, 'prompt', 'grok-skill-for-claude-code'), true);
  assert.equal(ctaItemExists(ROOT, 'post', 'grok-skill-for-claude-code'), false, 'type matters');
  assert.equal(ctaItemExists(ROOT, 'prompt', 'no-such-prompt-anywhere'), false);
  assert.equal(ctaItemExists(ROOT, 'share', 'atwellpub/20260610-astro-content-layer'), true);
  assert.equal(ctaItemExists(ROOT, 'share', 'atwellpub/nope'), false);
  assert.equal(ctaItemExists(ROOT, 'post', '../profile'), false);
  assert.equal(ctaItemExists(ROOT, 'page', 'about'), false);
  // A house item and a product (the project type spans projects/ and products/).
  const houseProject = fs.existsSync(path.join(ROOT, 'house/projects')) ? fs.readdirSync(path.join(ROOT, 'house/projects'))[0] : null;
  if (houseProject) assert.equal(ctaItemExists(ROOT, 'project', houseProject), true);
  // Every assignment in the committed registry resolves (the content check's rule, run here too).
  for (const a of assignmentsOf(readCtas(ROOT))) assert.equal(ctaItemExists(ROOT, a.type, a.ref), true, `${a.ctaId} -> ${a.type}:${a.ref}`);
});

test('rehypeSponsoredLinks: exactly the partner redirect paths get rel=sponsored, relative or on this origin', () => {
  const paths = outboundRows(ROOT).map(([p]) => p);
  assert.ok(paths.includes('/outbound/codeable') && paths.includes('/codeable'), 'the sow-289 store paths');
  const a = (href, rel) => ({ type: 'element', tagName: 'a', properties: { href, ...(rel ? { rel } : {}) }, children: [] });
  const tree = { type: 'root', children: [
    { type: 'element', tagName: 'p', properties: {}, children: [
      a('/outbound/codeable', ['noopener']),
      a('https://gbti.network/codeable/', ['noopener']),
      a('https://www.gbti.network/outbound/bugherd?x=1'),
      a('/outbound/nope'),
      a('https://codeable.io/outbound/codeable'),
      a('/articles/x/'),
      a('mailto:x@y.z'),
    ] },
  ] };
  rehypeSponsoredLinks({ paths })(tree);
  const links = tree.children[0].children.map((n) => n.properties.rel ?? null);
  assert.deepEqual(links, [
    ['sponsored', 'nofollow', 'noopener'],
    ['sponsored', 'nofollow', 'noopener'],
    ['sponsored', 'nofollow', 'noopener'],
    null,
    null,
    null,
    null,
  ]);
  assert.equal(sitePathOf('//evil.example/outbound/codeable'), null, 'a protocol-relative href is not a site path');
  assert.equal(sitePathOf('/outbound/codeable#frag'), '/outbound/codeable');
});
