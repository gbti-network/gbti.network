// The article/product/prompt "Join the GBTI Network" invite (src/components/CommunityInvite.astro) is a paid
// page CTA, so its benefit copy is a legal line under the membership-tiers.yml header rule. This guard mirrors
// the membership-FAQ guard at the bottom of test/tiers-display.test.mjs: CommunityInvite is not a *-invite
// lander, so test/invite-lander-parity.test.mjs does not cover it, and it would drift the way the FAQ did
// (it sold "Curate your feed" for eight days after the ruling because the copy was hand-typed).
//
// Two halves, and only the pair is a control. The import assertion is positive and fails honestly if the
// binding goes. The absence assertion is registry-DRIVEN, not a fixed regex: it reads the real benefit labels
// from the yml and asserts the .astro source contains none of them verbatim. Because the source renders
// composed registry values rather than resolved text, a label appears in the source only if someone hand-writes it,
// which is exactly the regression this catches. (Mutation-verified during development: pasting a benefit label
// or the retired "weekly coaching calls" line back into the component turns the matching assertion red.)
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { parseTierDisplay } from '../membership/tiers-display.mjs';

test('CommunityInvite composes tier benefits from the registry instead of typing them', () => {
  const page = fs.readFileSync(new URL('../src/components/CommunityInvite.astro', import.meta.url), 'utf8');

  // Positive/structural half: the invite composes its offer from the registry. sow-459 (option A, picked
  // 2026-10-16) replaced the benefit sentence with the tier's own tagline, so the binding it must keep is
  // taglineFragments (the tagline plus its revenue link) and the registry's tier list, not benefitProse.
  assert.match(page, /import \{[^}]*\btaglineFragments\b[^}]*\} from '\.\.\/lib\/tiers'/, 'CommunityInvite.astro must import taglineFragments from the registry module');
  assert.match(page, /taglineFragments\(paid\[0\]\)/, 'CommunityInvite.astro must compose its sentence with taglineFragments');
  assert.match(page, /offeredTiers\(\)/, 'CommunityInvite.astro must read its plans from offeredTiers');
  // The tagline itself is never typed: the sentence is composed, so the registry tagline text must not appear.
  const tagTiers = parseTierDisplay(yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8')));
  for (const t of tagTiers) {
    if (t.tagline) assert.ok(!page.includes(t.tagline), `CommunityInvite.astro hand-writes the ${t.key} tagline`);
  }

  // Absence half, driven by the registry: the source must not hand-write any member or creator benefit LABEL.
  const tiers = parseTierDisplay(yaml.load(fs.readFileSync(new URL('../house/membership-tiers.yml', import.meta.url), 'utf8')));
  for (const key of ['member', 'creator']) {
    for (const b of tiers.find((t) => t.key === key).benefits) {
      assert.ok(!page.includes(b.label), `CommunityInvite.astro hand-writes the benefit "${b.label}"`);
    }
  }

  // Belt-and-suspenders on the specific positioning claims the owner ruled out (2026-08-18). These are prose,
  // not registry labels, so the loop above would not catch them if they came back as a sentence.
  assert.ok(!/weekly coaching calls/i.test(page), 'CommunityInvite.astro still says "weekly coaching calls"');
  assert.ok(!/share in network profits/i.test(page), 'CommunityInvite.astro still says "share in network profits"');
});
