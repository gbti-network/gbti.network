// sow-323: one paid plan. The owner collapsed Network Member and Curator into a single Network Supporter tier
// on 2026-09-12, opened publishing to every paid supporter, and made the AUDIENCE the thing a superadmin
// decides. This suite guards the parts of that which are data and pure decisions; the gates live in
// test/membership.test.mjs, test/content-audience-gate.test.mjs and test/membership-author-audience.test.mjs.
//
// The census at the foot is the one that will catch drift. Every other assertion here tests a function; that
// one tests the SITE, and it is the only thing standing between a rename and a page still selling a plan
// nobody can buy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { parseTierDisplay, offeredTiers, revenueFragments } from '../membership/tiers-display.mjs';
import { TIER, TIER_LABEL, tierLabel } from '../membership/tiers.mjs';
import { tierCta } from '../src/lib/tier-cta.mjs';
import { audienceControl, AUDIENCE_MODES } from '../client-ui/src/one-click-public-core.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const TIERS = parseTierDisplay(yaml.load(read('house/membership-tiers.yml')));

/**
 * Remove comments so the census reads what SHIPS. Deliberately crude: it may also blank a `//` inside a
 * string literal, which for this census is the safe direction (it can only cause a missed hit in a file that
 * also contains the phrase outside a comment, and every real offender here is plain prose or markup).
 */
const stripComments = (src, rel) => {
  let s = src;
  if (/\.(yml|yaml)$/.test(rel)) return s.replace(/^\s*#.*$/gm, '');
  if (/\.md$/.test(rel)) return s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/\/\*[\s\S]*?\*\//g, '');   // block comments, and Astro's {/* */} loses its body with them
  s = s.replace(/<!--[\s\S]*?-->/g, '');      // html comments in markup
  s = s.replace(/^\s*\/\/.*$/gm, '');         // whole-line // comments
  s = s.replace(/\s\/\/[^\n'"`]*$/gm, '');   // trailing // comments, stopping at a quote to spare real strings
  return s;
};


test('the registry offers Free and Network Supporter, and not Curator', () => {
  assert.deepEqual(offeredTiers(TIERS).map((t) => t.key), ['none', 'member']);
  const member = TIERS.find((t) => t.key === 'member');
  assert.equal(member.label, 'Network Supporter');
  assert.equal(member.priceAnnual, 50, 'the price did not change with the name');
  // Curator STAYS in the file: the axis needs all three keys, existing grants carry the label, staff resolve
  // to it, and the legacy Stripe price maps to it. It just is not for sale.
  const creator = TIERS.find((t) => t.key === 'creator');
  assert.equal(creator.offered, false);
  assert.equal(creator.label, 'Curator');
  assert.equal(TIER_LABEL[TIER.member], 'Network Supporter', 'the bound label moved with the registry');
});

test('the offered flag survives normalisation, which is the only way it does anything', () => {
  // normalizeTier builds a frozen record from a fixed field list, so a key it does not know about is dropped
  // in silence. That would leave the cards selling a retired plan while the yaml said otherwise.
  const raw = yaml.load(read('house/membership-tiers.yml'));
  assert.ok(raw.tiers.some((t) => t.offered === false), 'the yaml really carries the flag');
  assert.equal(TIERS.find((t) => t.key === 'creator').offered, false, 'and the parser really reads it');
  // default true, so every existing entry and every future one is offered unless it says otherwise
  const twoTier = parseTierDisplay({ tiers: raw.tiers.map(({ offered, ...rest }) => rest) });
  assert.deepEqual(twoTier.map((t) => t.offered), [true, true, true]);
});

test('at least one paid tier must be offered, or the pricing section would render nothing to buy', () => {
  const raw = yaml.load(read('house/membership-tiers.yml'));
  const noneOffered = raw.tiers.map((t) => (t.priceAnnual > 0 || t.priceMonthly > 0 ? { ...t, offered: false } : t));
  assert.throws(() => offeredTiers(parseTierDisplay({ tiers: noneOffered })), /no paid tier is offered/);
});

test('a revenue line renders as a real link, on BOTH card surfaces, through one function', () => {
  // The homepage accordion rendered the registry string as plain text while the membership page had its own
  // splitter, so the live homepage showed `[revenue program](/revenue-model/)` to every visitor, brackets and
  // URL. One function now, imported by both.
  assert.deepEqual(revenueFragments('Supporters share in the [revenue program](/revenue-model/).'), [
    { text: 'Supporters share in the ' },
    { text: 'revenue program', href: '/revenue-model/' },
    { text: '.' },
  ]);
  assert.deepEqual(revenueFragments('No link at all.'), [{ text: 'No link at all.' }]);
  assert.deepEqual(revenueFragments(''), []);
  const accordion = read('src/components/home/PricingAccordion.astro');
  const card = read('src/components/membership/MembershipTiers.astro');
  for (const [name, src] of [['the homepage accordion', accordion], ['the membership card', card]]) {
    assert.match(src, /revenueFragments\(/, `${name} must render the revenue line through revenueFragments`);
    assert.match(src, /offeredTiers\(\)/, `${name} must render the OFFERED tiers only`);
    assert.doesNotMatch(src, /function revenueFragments/, `${name} must not keep a local copy to drift from`);
  }
});

test('no call to action offers the retired plan, and the labels come from the registry', () => {
  const raw = read('src/components/home/PricingAccordion.astro');
  const accordion = stripComments(raw, 'PricingAccordion.astro');
  assert.doesNotMatch(accordion, /Become a creator/, 'the retired plan must not be offered');
  assert.doesNotMatch(accordion, /Become a member['"`]/, 'the plan name must come from the registry, not a literal');
  assert.match(accordion, /Become a \$\{t\.label\}/, 'bound to the registry label');
  // and the stripper is not vacuous: it must still be reading the file
  assert.ok(accordion.includes('offeredTiers()'), 'the stripper must not have blanked the code it scans');
});

test('tierCta has no apply-only branch left, and still answers for every offered card', () => {
  assert.equal(tierCta({ key: 'none' }).href, '/login/');
  const signedOut = tierCta({ key: 'member', label: 'Network Supporter' });
  assert.match(signedOut.text, /Network Supporter/);
  assert.equal(signedOut.checkout, false, 'signed out goes through login first');
  const signedIn = tierCta({ key: 'member', label: 'Network Supporter', signedIn: true });
  assert.equal(signedIn.checkout, true, 'a signed-in visitor checks out');
  // the apply-only branch is gone: nothing routes a pricing card to the application page any more
  assert.doesNotMatch(read('src/lib/tier-cta.mjs'), /if \(key === 'creator'\)/);
  // holding the plan still outranks being sold it
  const holder = tierCta({ key: 'member', label: 'Network Supporter', signedIn: true, myTier: 'member' });
  assert.equal(holder.disabled, true);
  // and a viewer whose grant OUTRANKS every offered card gets a truthful answer, not an upsell
  const trusted = tierCta({ key: 'member', label: 'Network Supporter', signedIn: true, myTier: 'creator', myTierLabel: 'Curator' });
  assert.equal(trusted.checkout, false);
  assert.equal(trusted.disabled, true);
});

test('the audience control: a trusted author chooses, a supporter does not, and an approved item STAYS public', () => {
  assert.equal(audienceControl({ paidTier: 'creator' }).mode, 'switch');
  assert.equal(audienceControl({ isSuperadmin: true }).mode, 'switch');
  const supporter = audienceControl({ paidTier: 'member' });
  assert.equal(supporter.mode, 'locked-members');
  assert.equal(supporter.value, 'members');
  // THE CASE THAT LOSES A PAGE IF IT IS WRONG. The editor submits the whole frontmatter on every save, so an
  // already-public item must keep submitting public or its author's typo fix takes the live page down.
  const approved = audienceControl({ paidTier: 'member', currentVisibility: 'public', existing: true });
  assert.equal(approved.mode, 'locked-public');
  assert.equal(approved.value, 'public');
  // a NEW item claiming public is not grandfathered by claiming it
  assert.equal(audienceControl({ paidTier: 'member', currentVisibility: 'public', existing: false }).value, 'members');
  // an absent or unresolvable tier locks rather than unlocking: the safe direction for an affordance
  for (const tier of [null, undefined, '', 'none', 'nonsense']) {
    assert.equal(audienceControl({ paidTier: tier }).mode, 'locked-members', JSON.stringify(tier));
  }
  assert.deepEqual(AUDIENCE_MODES, ['switch', 'locked-public', 'locked-members']);
});

test('the Submit content page exists, is linked from the footer, and binds its numbers', () => {
  const page = read('src/pages/submit-content/index.astro');
  assert.match(read('src/components/Footer.astro'), /\['Submit content', '\/submit-content\/'\]/);
  assert.match(page, /\/revenue-model\//, 'it must link the full revenue breakdown, which the owner asked for');
  // A page about money must not hardcode a rate: the member dashboard states the same numbers and disagreeing
  // with it in public is worse than saying nothing.
  for (const sym of ['FIRST_TOUCH_PCT', 'LAST_TOUCH_PCT', 'COLLAB_POOL_PCT', 'INVITE_PCT', 'HOLD_DAYS']) {
    assert.match(page, new RegExp(`\\{${sym}\\}`), `${sym} must be bound, not written`);
  }
  assert.doesNotMatch(page, /\b(30|10|5|55|90)\s?%/, 'no percentage may be spelled out on this page');
  assert.match(page, /tierDisplay\('member'\)/, 'the plan name comes from the registry');
});

test('CENSUS: the retired plan is not offered anywhere a visitor or ordinary member reads', () => {
  // The assertion that catches drift a function test cannot. Scoped to SHIPPED copy: generated bundles carry
  // whatever their sources say, member-authored content under members/ is never rewritten by us, and a
  // superadmin surface may still name the internal trust level.
  // extension/mcp is a BUILD ARTIFACT, like extension/dist: npm run build:extension regenerates it from
  // client/src, so scanning it reports its sources twice and fails on a stale bundle rather than on real copy.
  const skip = /^(node_modules|\.git|dist|members|\.astro|\.data|\.product|\.snapshots|test|public\/extension|client-ui\/dist|extension\/dist|extension\/mcp)/;
  const allowed = new Set([
    'client-ui/src/elements/gbti-admin.mjs',              // superadmin grant control
    'client-ui/src/elements/gbti-applications-manager.mjs', // the retired application lane, superadmin only
    'src/pages/creator-application.astro',               // retired in a later phase, unlinked
    'membership/creator-application-notify.mjs',         // inert, owner email
  ]);
  const offenders = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(path.join(ROOT, dir || '.'))) {
      const rel = dir ? `${dir}/${name}` : name;
      if (skip.test(rel)) continue;
      const full = path.join(ROOT, rel);
      if (fs.statSync(full).isDirectory()) { walk(rel); continue; }
      if (!/\.(astro|ts|mjs|js|yml|md)$/.test(rel)) continue;
      if (allowed.has(rel)) continue;
      // COMMENTS ARE STRIPPED FIRST, and the first run of this census is why. It flagged eleven files, and
      // most of the hits were the explanatory comments written in the very same change, each of which quotes
      // the old copy in order to record what it replaced. A census that cannot tell a comment from a string
      // reports the author's own footnotes as regressions, which trains the next reader to skip it. Naming
      // what something USED to say is exactly the record we want to keep.
      const txt = stripComments(fs.readFileSync(full, 'utf8'), rel);
      for (const needle of ['Become a creator', 'Apply to become a']) {
        if (txt.includes(needle)) offenders.push(`${rel}: ${needle}`);
      }
      // "Network Member" as SHIPPED COPY: a quoted string or markup text, never an identifier.
      if (/(>|["'`])[^"'`<>]*Network Member/.test(txt)) offenders.push(`${rel}: Network Member in copy`);
    }
  };
  walk('');
  assert.deepEqual(offenders, [], `the retired plan or the old name still appears in shipped copy:\n${offenders.join('\n')}`);
});
