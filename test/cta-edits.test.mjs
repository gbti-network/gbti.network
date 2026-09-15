// sow-281: the pure CTA edit core (membership/cta-edits.mjs) and the rules every reader of house/ctas.yml shares.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  CtaEditError, CTA_ITEM_TYPES, CTA_LIMITS, addCta, updateCta, setCtaEnabled, assignCta, unassignCta,
  validateCtas, validRef, amazonDestinationProblem,
} from '../membership/cta-edits.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const ctx = { actor: { githubId: 1, login: 'atwellpub' }, now: '2026-09-15T00:00:00.000Z' };
const book = (over = {}) => ({ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get the book on Amazon', destination: AMZ, partner: 'amazon', ...over });
const doc = (...ctas) => ({ ctas });

test('the committed registry is valid and its first CTA follows the Amazon rule', () => {
  const parsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house/ctas.yml'), 'utf8'));
  assert.deepEqual(validateCtas(parsed), []);
  const first = parsed.ctas.find((c) => c.id === 'stranger-in-a-strange-land');
  assert.ok(first, 'the first CTA is registered');
  assert.equal(first.partner, 'amazon');
  assert.equal(new URL(first.destination).searchParams.get('tag'), 'jakolorbbookc-20');
  assert.match(new URL(first.destination).hostname, /amazon\.com$/);
  assert.deepEqual(first.items, [{ type: 'prompt', ref: 'grok-skill-for-claude-code' }]);
});

test('validateCtas: the shapes it refuses, each by name', () => {
  assert.deepEqual(validateCtas({ ctas: [] }), []);
  assert.deepEqual(validateCtas({}), []);
  assert.equal(validateCtas(null).length, 1);
  assert.equal(validateCtas([]).length, 1);
  assert.equal(validateCtas({ ctas: 'x' }).length, 1);
  const bad = (over, re) => {
    const p = validateCtas(doc(book(over)));
    assert.ok(p.some((s) => re.test(s)), `${JSON.stringify(over)} -> ${JSON.stringify(p)}`);
  };
  bad({ id: 'Not Kebab' }, /id must be kebab-case/);
  bad({ id: 'a'.repeat(65) }, /id must be kebab-case/);
  bad({ label: '' }, /label is required/);
  bad({ line: 'x'.repeat(CTA_LIMITS.line + 1) }, /line is too long/);
  bad({ button: '' }, /button is required/);
  bad({ destination: 'http://www.amazon.com/dp/1?tag=x-20' }, /destination must be an absolute https URL/);
  bad({ destination: '/outbound/codeable' }, /destination must be an absolute https URL/);
  bad({ partner: 'Amazon Inc' }, /partner must be a short kebab label/);
  bad({ enabled: 'yes' }, /enabled must be true or false/);
  bad({ note: 42 }, /note must be a string/);
  bad({ items: 'prompt:x' }, /items must be a list/);
  bad({ items: [{ type: 'page', ref: 'x' }] }, /type must be one of prompt, post, project, share/);
  bad({ items: [{ type: 'prompt', ref: 'Bad Slug' }] }, /ref must be a slug/);
  bad({ items: [{ type: 'share', ref: 'no-author' }] }, /ref must be a author\/id pair/);
  bad({ items: [{ type: 'prompt', ref: 'x' }, { type: 'prompt', ref: 'x' }] }, /assigned to this CTA twice/);
  const dup = validateCtas(doc(book(), book({ destination: AMZ })));
  assert.ok(dup.some((s) => /duplicate id "book"/.test(s)), dup.join('; '));
});

test('the Amazon rule: a tag is required and the link must be direct (no /outbound/, no other intermediate site)', () => {
  assert.equal(amazonDestinationProblem(AMZ), null);
  assert.equal(amazonDestinationProblem('https://amazon.co.uk/dp/0441788386?tag=x-21'), null);
  assert.match(amazonDestinationProblem('https://www.amazon.com/dp/0441788386'), /tag= parameter/);
  assert.match(amazonDestinationProblem('https://gbti.network/outbound/book?tag=x'), /straight to an amazon domain/);
  assert.match(amazonDestinationProblem('https://amzn.to/abc?tag=x'), /straight to an amazon domain/);
  assert.match(amazonDestinationProblem('https://notamazon.com/dp/1?tag=x'), /straight to an amazon domain/);
  // The rule is scoped to partner: amazon. Another partner may link anywhere https.
  assert.deepEqual(validateCtas(doc(book({ partner: 'codeable', destination: 'https://gbti.network/outbound/codeable' }))), []);
  assert.ok(validateCtas(doc(book({ destination: 'https://www.amazon.com/dp/0441788386' }))).some((s) => /tag=/.test(s)));
  assert.ok(validateCtas(doc(book({ destination: 'https://gbti.network/outbound/book?tag=x' }))).some((s) => /straight to an amazon domain/.test(s)));
});

test('validRef: slugs for prompt/post/project, author/id for a share, and the real share ids pass', () => {
  assert.equal(validRef('prompt', 'grok-skill-for-claude-code'), true);
  assert.equal(validRef('post', 'Nope'), false);
  assert.equal(validRef('share', 'atwellpub/20260701192642-github-juliusbrussee-caveman-why-use-many-token-'), true);
  assert.equal(validRef('share', 'atwellpub'), false);
  assert.equal(validRef('share', 'a/b/c'), false);
  assert.equal(validRef('prompt', ''), false);
  assert.deepEqual([...CTA_ITEM_TYPES], ['prompt', 'post', 'project', 'share']);
});

test('addCta: validates the new entry, defaults to disabled with no items, refuses a duplicate id', () => {
  const r = addCta({}, book({ note: ' from the owner ' }), ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.next.ctas[0], { ...book(), note: 'from the owner', enabled: false, items: [] });
  assert.equal(r.audit.action, 'cta.add');
  assert.deepEqual(r.audit.actor, { github_id: '1', login: 'atwellpub' });
  assert.equal(r.audit.target.id, 'book');
  assert.throws(() => addCta(r.next, book(), ctx), /already exists/);
  assert.throws(() => addCta({}, book({ id: '' }), ctx), CtaEditError);
  assert.throws(() => addCta({}, book({ destination: 'https://www.amazon.com/dp/1' }), ctx), /tag= parameter/);
  assert.throws(() => addCta({}, book({ destination: 'https://gbti.network/outbound/book?tag=x' }), ctx), /straight to an amazon domain/);
  assert.throws(() => addCta({}, book({ label: '' }), ctx), /label is required/);
  // enabled: true is honoured when asked for explicitly; anything else is false.
  assert.equal(addCta({}, book({ enabled: true }), ctx).next.ctas[0].enabled, true);
  assert.equal(addCta({}, book({ enabled: 'true' }), ctx).next.ctas[0].enabled, false);
});

test('updateCta: patches only the given fields, no-ops on identical values, validates the result', () => {
  const base = doc({ ...book(), enabled: true, items: [{ type: 'prompt', ref: 'x' }], note: 'n' });
  const r = updateCta(base, { id: 'book', line: 'A new line.' }, ctx);
  assert.equal(r.changed, true);
  assert.equal(r.next.ctas[0].line, 'A new line.');
  assert.equal(r.next.ctas[0].enabled, true, 'enabled is not an editable field here');
  assert.deepEqual(r.next.ctas[0].items, [{ type: 'prompt', ref: 'x' }], 'items are untouched');
  assert.deepEqual(r.audit.detail, { fields: ['line'] });
  assert.equal(updateCta(base, { id: 'book', line: 'One sentence.' }, ctx).changed, false);
  assert.equal(updateCta(base, { id: 'book' }, ctx).changed, false);
  assert.equal(updateCta(base, { id: 'book', note: '' }, ctx).next.ctas[0].note, undefined, 'an empty note clears it');
  assert.throws(() => updateCta(base, { id: 'book', destination: 'https://www.amazon.com/dp/1' }, ctx), /tag= parameter/);
  assert.throws(() => updateCta(base, { id: 'book', partner: 'x y' }, ctx), /partner must be/);
  assert.throws(() => updateCta(base, { id: 'nope', line: 'x' }, ctx), /no CTA with id "nope"/);
  // Changing the partner to amazon re-checks the destination under the Amazon rule.
  const other = doc(book({ partner: 'codeable', destination: 'https://gbti.network/outbound/codeable' }));
  assert.throws(() => updateCta(other, { id: 'book', partner: 'amazon' }, ctx), /straight to an amazon domain/);
});

test('setCtaEnabled: flips, idempotent, unknown id refused', () => {
  const base = doc(book());
  const on = setCtaEnabled(base, { id: 'book', enabled: true }, ctx);
  assert.equal(on.changed, true);
  assert.equal(on.next.ctas[0].enabled, true);
  assert.equal(setCtaEnabled(on.next, { id: 'book', enabled: true }, ctx).changed, false);
  assert.equal(setCtaEnabled(on.next, { id: 'book', enabled: 'true' }, ctx).changed, true, 'a non-boolean means off');
  assert.equal(setCtaEnabled(base, { id: 'book', enabled: false }, ctx).changed, false, 'absent enabled reads as off');
  assert.throws(() => setCtaEnabled(base, { id: 'x', enabled: true }, ctx), CtaEditError);
});

test('assignCta / unassignCta: idempotent, typed, refuse a bad type or ref', () => {
  const base = doc(book());
  const a = assignCta(base, { id: 'book', type: 'prompt', ref: ' grok-skill-for-claude-code ' }, ctx);
  assert.equal(a.changed, true);
  assert.deepEqual(a.next.ctas[0].items, [{ type: 'prompt', ref: 'grok-skill-for-claude-code' }]);
  assert.deepEqual(a.audit.detail, { type: 'prompt', ref: 'grok-skill-for-claude-code' });
  assert.equal(assignCta(a.next, { id: 'book', type: 'prompt', ref: 'grok-skill-for-claude-code' }, ctx).changed, false);
  const s = assignCta(a.next, { id: 'book', type: 'share', ref: 'atwellpub/20260610-astro-content-layer' }, ctx);
  assert.equal(s.next.ctas[0].items.length, 2);
  assert.throws(() => assignCta(base, { id: 'book', type: 'page', ref: 'x' }, ctx), /type must be one of/);
  assert.throws(() => assignCta(base, { id: 'book', type: 'post', ref: '../x' }, ctx), /ref must be a slug/);
  assert.throws(() => assignCta(base, { id: 'book', type: 'share', ref: 'x' }, ctx), /author\/id pair/);
  assert.throws(() => assignCta(base, { id: 'nope', type: 'post', ref: 'x' }, ctx), /no CTA with id/);
  const u = unassignCta(s.next, { id: 'book', type: 'prompt', ref: 'grok-skill-for-claude-code' }, ctx);
  assert.equal(u.changed, true);
  assert.deepEqual(u.next.ctas[0].items, [{ type: 'share', ref: 'atwellpub/20260610-astro-content-layer' }]);
  assert.equal(unassignCta(u.next, { id: 'book', type: 'prompt', ref: 'grok-skill-for-claude-code' }, ctx).changed, false);
  assert.throws(() => unassignCta(base, { id: 'nope', type: 'post', ref: 'x' }, ctx), /no CTA with id/);
});

test('the core never mutates its input', () => {
  const base = doc(book());
  const snapshot = JSON.stringify(base);
  addCta(base, book({ id: 'two' }), ctx);
  assignCta(base, { id: 'book', type: 'post', ref: 'x' }, ctx);
  setCtaEnabled(base, { id: 'book', enabled: true }, ctx);
  updateCta(base, { id: 'book', line: 'z' }, ctx);
  assert.equal(JSON.stringify(base), snapshot);
});
