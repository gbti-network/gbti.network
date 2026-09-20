// sow-359: a partner card may point at a tracked /outbound/ link instead of straight at the partner.
//
// THE FIXTURE IS NOT THE LIVE REGISTRY, DELIBERATELY. All four committed cards are partner: amazon and stay
// direct by the owner's ruling, so tests built on house/ctas.yml would exercise the refusal path only and
// pass while the feature itself did nothing.
//
// Three things are worth guarding and only one of them is the validation:
//   1. The field survives a save. A field missing from the editable whitelist is dropped silently on the next
//      update, which has cost this project three fields historically. That is a round-trip test, not a
//      validation test, and nothing else catches it.
//   2. The card falls back rather than rendering a link that does not resolve.
//   3. An amazon card is refused, in both the places that can decide it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCta, updateCta, validateCta, trackedPathProblem, CTA_FIELDS, CTA_LIMITS } from '../membership/cta-edits.mjs';
import { renderCtaCard } from '../membership/cta-card-render.mjs';
import { trackedHrefFor } from '../src/lib/ctas.mjs';
import { ctaAddInput, ctaUpdateInput } from '../workers/signup/membership-admin-ctas.mjs';

const card = (o = {}) => ({ id: 'acme', label: 'Acme', line: 'One sentence.', button: 'Try Acme', destination: 'https://acme.example.com/start?ref=A1', partner: 'acme', enabled: true, items: [], ...o });
const problemsFor = (o) => validateCta(card(o)).filter((p) => /trackedPath|tracked link/.test(p));

test('sow-359: a tracked path must be an /outbound/ site path and nothing else', () => {
  assert.equal(trackedPathProblem('/outbound/acme'), null);
  assert.equal(trackedPathProblem(''), null, 'absent is not a problem: masking is opt-in');
  assert.equal(trackedPathProblem(undefined), null);
  assert.deepEqual(problemsFor({ trackedPath: '/outbound/acme' }), []);
  for (const [bad, why] of [
    ['/about/', 'not under /outbound/'],
    ['/outbound/', 'the bare prefix names no link'],
    ['/outbound/a?b=1', 'a query'],
    ['/outbound/a#x', 'a fragment'],
    ['/outbound/a b', 'whitespace'],
    ['https://evil.example.com/x', 'an absolute url on another host'],
    ['//evil.example.com/x', 'a protocol-relative url'],
    ['outbound/acme', 'no leading slash'],
    [`/outbound/${'a'.repeat(CTA_LIMITS.trackedPath)}`, 'over the cap'],
  ]) {
    assert.ok(trackedPathProblem(bad), `${why} must be refused: ${bad}`);
    assert.equal(problemsFor({ trackedPath: bad }).length > 0, true, `${why} must be refused by validateCta too`);
  }
});

test('sow-359: an amazon card cannot be masked, and the refusal says why', () => {
  const problems = problemsFor({ partner: 'amazon', destination: 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20', trackedPath: '/outbound/book' });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /Associates Program Policies/, 'a bare rejection leaves the next person guessing');
  assert.match(problems[0], /house\/ctas\.yml/, 'it should point at the rule it is enforcing');
  // And the same card without the tracked path is fine, so the refusal is about masking, not about the card.
  assert.deepEqual(problemsFor({ partner: 'amazon', destination: 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20' }), []);
});

test('sow-359: THE WHITELIST. The field survives an add, and survives editing a different field', () => {
  assert.ok(CTA_FIELDS.includes('trackedPath'), 'trackedPath is not an editable field, so every save drops it');
  const added = addCta({ ctas: [] }, { ...card(), trackedPath: '/outbound/acme' }).next;
  assert.equal(added.ctas[0].trackedPath, '/outbound/acme', 'the field did not survive the add');
  // The real trap: editing something else must not quietly drop it.
  const edited = updateCta(added, { id: 'acme', line: 'A different sentence.' }).next;
  assert.equal(edited.ctas[0].trackedPath, '/outbound/acme', 'editing another field dropped the tracked path');
  assert.equal(edited.ctas[0].line, 'A different sentence.');
  // Clearing it is how a card is unmasked, and it removes the key rather than writing an empty string.
  const cleared = updateCta(added, { id: 'acme', trackedPath: '' }).next;
  assert.equal('trackedPath' in cleared.ctas[0], false);
  // And the wire carries it, or the core never sees it.
  assert.equal(ctaAddInput({ id: 'acme', label: 'Acme', partner: 'acme', trackedPath: '/outbound/acme' }).args.trackedPath, '/outbound/acme');
  assert.equal(ctaUpdateInput({ id: 'acme', trackedPath: '/outbound/acme' }).args.trackedPath, '/outbound/acme');
});

test('sow-359: the card FALLS BACK rather than rendering a link that does not resolve', () => {
  const links = [{ path: '/outbound/acme', status: 'live' }, { path: '/outbound/old', status: 'retired' }, { path: '/outbound/soon', status: 'placeholder' }];
  assert.equal(trackedHrefFor(card({ trackedPath: '/outbound/acme' }), links), '/outbound/acme');
  assert.equal(trackedHrefFor(card({ trackedPath: '/outbound/old' }), links), null, 'retiring a link must unmask the cards using it');
  assert.equal(trackedHrefFor(card({ trackedPath: '/outbound/soon' }), links), null, 'a placeholder credits nobody, so a card should not be sent through it');
  assert.equal(trackedHrefFor(card({ trackedPath: '/outbound/never-minted' }), links), null, 'a path this build does not carry would 404');
  assert.equal(trackedHrefFor(card({}), links), null);
  assert.equal(trackedHrefFor(card({ trackedPath: '/outbound/acme' }), []), null, 'an empty store masks nothing');
  // Second line of defence: a hand-edited registry does not pass through the edit core, so the render-time
  // resolution refuses an amazon card as well.
  assert.equal(trackedHrefFor(card({ partner: 'amazon', trackedPath: '/outbound/acme' }), links), null);
});

test('sow-359: the renderer uses the resolved href and is unchanged without one', () => {
  const c = card({ layout: 'below', trackedPath: '/outbound/acme' });
  const direct = renderCtaCard(c);
  const masked = renderCtaCard(c, { href: '/outbound/acme' });
  assert.match(direct, /href="https:\/\/acme\.example\.com\/start\?ref=A1"/, 'no resolved href means the card is unchanged');
  assert.equal(direct.includes('/outbound/acme'), false, 'the renderer must not read trackedPath itself: only the caller can see the store');
  assert.match(masked, /href="\/outbound\/acme"/);
  assert.match(masked, /rel="sponsored nofollow noopener"/, 'a masked link is still a paid placement');
  assert.match(masked, /target="_blank"/);
  // The admin preview stays inert either way, so partner links never fire inside the manager.
  assert.equal(/<a /.test(renderCtaCard(c, { preview: true, href: '/outbound/acme' })), false);
});
