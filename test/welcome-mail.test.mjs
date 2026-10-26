// sow-478: the new member's welcome email (membership/welcome-mail.mjs).
//
// Every assertion here reads the RENDERED output, not the fact that the builder returned without throwing. The
// thing this email can get wrong is offering somebody a step they cannot take, and a builder that ran happily is
// exactly what that looks like from the outside.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { welcomeMail, welcomeRecordFromListing, itemUrl, coverUrl, coverRef, greetingName, ITEM_ROUTES } from '../membership/welcome-mail.mjs';
import { PREPARABLE_TYPES, TYPE_IMAGE_FIELDS, isListingImageName } from '../membership/prepared-listings-shared.mjs';
import { ONBOARDING_STEPS, onboardingStepsFor } from '../membership/onboarding.mjs';
import { PUBLISHED_STATUSES } from '../membership/discord-roles.mjs';
import { canPublish } from '../client/src/membership.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MEMBERSHIP = path.join(HERE, '..', 'membership');

const CLAIMER = {
  name: 'Sean B. Alger',
  status: 'paid',
  item: {
    type: 'prompt', title: 'Pedro Monkey Puppet Portrait', slug: 'pedro-monkey-puppet-portrait',
    folder: 'sbalger75', image: './images/result.jpg', creditTo: 'atwellpub',
  },
};
const FREE = { name: 'Dana', status: 'none' };

test('a paid claimer gets the receipt, the Discord block and every step the wizard would show', () => {
  const { subject, text, html } = welcomeMail(CLAIMER);
  assert.equal(subject, 'Your prompt is live on GBTI Network');
  assert.match(html, /Your prompt is live, Sean\./);
  // The receipt, with the item, its credit and a link to the page it actually published to.
  assert.match(html, /PROMPT &#183; PUBLISHED|PROMPT · PUBLISHED/);
  assert.match(html, /Pedro Monkey Puppet Portrait/);
  assert.match(html, /with atwellpub credited as a contributor/);
  assert.match(html, /https:\/\/gbti\.network\/prompts\/pedro-monkey-puppet-portrait\//);
  assert.match(html, /cdn\.jsdelivr\.net\/gh\/gbti-network\/gbti\.network@main\/members\/sbalger75\/prompts\/pedro-monkey-puppet-portrait\/images\/result\.jpg/);
  // Discord is its own block and NOT a numbered row, and the button names the task rather than the first step.
  assert.match(html, /Join the Discord/);
  assert.match(html, /Complete Onboarding/);
  assert.doesNotMatch(html, /01<\/td>/, 'Discord keeps number one and is not listed, so the rows start at 02');
  for (const n of ['02', '03', '04', '05']) assert.match(html, new RegExp(`>${n}</td>`));
  // The step titles are the wizard's own, so the two surfaces cannot word the same step differently.
  for (const s of onboardingStepsFor({ discordAvailable: true, canPublish: true })) {
    if (s.key === 'discord') continue;
    assert.match(html, new RegExp(s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the html lists ${s.key}`);
    assert.match(text, new RegExp(s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `the text lists ${s.key}`);
  }
  assert.match(text, /https:\/\/gbti\.network\/welcome\//, 'the text body carries the same destination');
});

test('a free account gets no receipt, no Discord block and three steps, and is never shown the locked door', () => {
  const { subject, text, html } = welcomeMail(FREE);
  assert.equal(subject, 'Welcome to GBTI Network');
  assert.match(html, /Welcome, Dana\. Here is what you can do\./);
  assert.doesNotMatch(html, /PUBLISHED/, 'nothing was published, so there is no receipt');
  assert.doesNotMatch(html, /Join the Discord/, 'a free account may not join it, so it is never offered');
  assert.doesNotMatch(html, /Add your social handles/, 'publishing is paid, so the handles step is not theirs');
  assert.match(html, /Complete Onboarding/, 'the same label works for both tiers');
  for (const n of ['01', '02', '03']) assert.match(html, new RegExp(`>${n}</td>`));
  assert.doesNotMatch(html, />04</, 'three steps, not five');
  // The membership case is made ONCE, at the foot, as a statement rather than a step.
  assert.match(html, /come with a paid membership/);
  assert.match(text, /come with a paid membership/);
});

test('the step list comes from onboardingStepsFor, and follows it when it changes', async () => {
  // A REAL mutation: a sibling copy of the builder whose onboarding import points at a stub returning a
  // different set. If the email carried its own list, this copy would still render the five real steps.
  const stub = path.join(MEMBERSHIP, '__wm-onboarding-stub.mjs');
  const copy = path.join(MEMBERSHIP, '__wm-mutant.mjs');
  try {
    fs.writeFileSync(stub, 'export function onboardingStepsFor() {\n'
      + "  return [{ key: 'alpha', label: 'Alpha', sub: 'The only one', title: 'Do the alpha thing' }];\n}\n");
    const src = fs.readFileSync(path.join(MEMBERSHIP, 'welcome-mail.mjs'), 'utf8');
    const mutated = src.replace("from './onboarding.mjs'", "from './__wm-onboarding-stub.mjs'");
    assert.notEqual(mutated, src, 'the onboarding import was found and redirected');
    fs.writeFileSync(copy, mutated);
    const { welcomeMail: mutantMail } = await import('../membership/__wm-mutant.mjs');
    const out = mutantMail(CLAIMER).html;
    assert.match(out, /Do the alpha thing/, 'the email renders whatever onboardingStepsFor returns');
    assert.match(out, /The only one/, 'and falls back to the step\'s own sub when it has no why of its own');
    for (const s of ONBOARDING_STEPS) {
      if (s.key === 'discord') continue;
      assert.doesNotMatch(out, new RegExp(s.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${s.key} is not hardcoded`);
    }
  } finally {
    for (const f of [stub, copy]) if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  // And the originals are untouched: the mutation ran on copies, never on the shipped file.
  assert.match(fs.readFileSync(path.join(MEMBERSHIP, 'welcome-mail.mjs'), 'utf8'), /from '\.\/onboarding\.mjs'/);
});

test('an unread membership is offered the whole list, exactly as the wizard does', () => {
  const html = welcomeMail({ name: 'Pat', status: 'unknown' }).html;
  assert.match(html, /Join the Discord/);
  assert.match(html, /Add your social handles/);
  assert.match(html, />05</, 'hiding a step on a failed read is the direction that loses a paying member work');
});

test('every preparable type has a public route, so no invitation can produce a dead link', () => {
  for (const type of PREPARABLE_TYPES) {
    assert.ok(ITEM_ROUTES[type], `${type} has no route`);
    assert.match(itemUrl({ type, slug: 'a-slug' }), new RegExp(`/${ITEM_ROUTES[type]}/a-slug/$`));
  }
});

test('the receipt can only ever show a picture the claim actually commits', () => {
  // Derived from TYPE_IMAGE_FIELDS rather than written out, because the failure this guards is silent: a cover
  // field the collector does not know about produces an address for a file that was never committed, and the
  // email renders a broken image with nothing having errored. The same shape of mistake cost a prompt its hero
  // three weeks before this was written.
  for (const type of Object.keys(TYPE_IMAGE_FIELDS)) {
    const fm = Object.fromEntries(TYPE_IMAGE_FIELDS[type].map((f) => [f, `./images/${f.toLowerCase()}.png`]));
    const ref = coverRef(type, fm);
    assert.ok(ref, `${type} resolves no cover from its own image fields`);
    const field = TYPE_IMAGE_FIELDS[type].find((f) => ref === `./images/${f.toLowerCase()}.png`);
    assert.ok(field, `${type} picked ${ref}, which is not one of the fields the claim collects`);
    assert.ok(isListingImageName(ref.replace('./images/', '')), 'and it is a name the uploader accepts');
  }
  assert.equal(coverRef('post', { image: './images/x.png' }), '', 'a type that cannot be prepared has no cover');
});

test('the paid gate agrees with client/src/membership canPublish on every status', () => {
  // The builder uses PUBLISHED_STATUSES because canPublish reaches js-yaml and cannot enter the Worker bundle.
  // This is what stops the two definitions drifting apart.
  for (const status of ['paid', 'trialing', 'none', 'expired', 'cancelled', 'banned', 'unknown', '', 'PAID']) {
    assert.equal(PUBLISHED_STATUSES.has(status), canPublish(status), `they disagree about ${JSON.stringify(status)}`);
  }
});

test('the links and the cover fail closed rather than guessing', () => {
  assert.equal(itemUrl({ type: 'post', slug: 'x' }), '', 'a type with no route gets no link');
  assert.equal(itemUrl({ type: 'prompt', slug: '../etc' }), '', 'a slug outside the shape gets no link');
  assert.equal(coverUrl({ type: 'prompt', slug: 'x', folder: 'y', image: '../../secret.png' }), '');
  assert.equal(coverUrl({ type: 'prompt', slug: 'x', folder: 'y', image: './images/a.svg' }), '', 'svg is not an email image');
  assert.equal(coverUrl({ type: 'prompt', slug: 'x', folder: 'y', image: '' }), '');
  // And a claimer whose cover cannot be resolved still gets a readable receipt.
  const html = welcomeMail({ ...CLAIMER, item: { ...CLAIMER.item, image: '' } }).html;
  assert.doesNotMatch(html, /cdn\.jsdelivr\.net/);
  assert.match(html, /Pedro Monkey Puppet Portrait/);
  assert.match(html, /View your page/);
});

test('the listing projection carries the cover, and refuses what it cannot address', () => {
  const listing = {
    type: 'prompt', slug: 'pedro-monkey-puppet-portrait', title: 'Pedro Monkey Puppet Portrait',
    recipientName: 'Sean', claimPendingFolder: 'sbalger75', creditPreparer: true, preparedByLogin: 'atwellpub',
    frontmatter: { image: './images/result.jpg' },
  };
  const rec = welcomeRecordFromListing(listing, { githubId: '12345' });
  assert.equal(rec.name, 'Sean');
  assert.equal(rec.status, 'paid');
  assert.equal(rec.item.folder, 'sbalger75', 'the FOLDER, which is not the login');
  assert.equal(rec.item.creditTo, 'atwellpub');
  assert.equal(welcomeRecordFromListing({ ...listing, creditPreparer: false }, { githubId: '1' }).item.creditTo, '');
  assert.equal(welcomeRecordFromListing({ ...listing, type: 'post' }, { githubId: '1' }), null);
  assert.equal(welcomeRecordFromListing(listing, { githubId: 'not-an-id' }), null);
  assert.equal(welcomeRecordFromListing(null, { githubId: '1' }), null);
});

test('no name means no greeting, rather than a fabricated one', () => {
  assert.equal(greetingName(''), '');
  assert.equal(greetingName('Sean B. Alger'), 'Sean');
  assert.match(welcomeMail({ status: 'none' }).html, /Welcome\. Here is what you can do\./);
  assert.doesNotMatch(welcomeMail({ status: 'none' }).html, /Welcome, /);
});

test('a name is escaped rather than rendered', () => {
  const html = welcomeMail({ name: '<script>x</script>', status: 'none' }).html;
  assert.doesNotMatch(html, /<script>/);
});

test('the writing rules hold in what a member actually reads', () => {
  for (const rec of [CLAIMER, FREE]) {
    const { subject, text, html } = welcomeMail(rec);
    for (const [what, s] of [['subject', subject], ['text', text], ['html', html]]) {
      assert.doesNotMatch(s, /[—–]/, `an em or en dash reached the ${what}`);
      assert.doesNotMatch(s, /\b(it's|you're|we're|don't|can't|won't|that's|here's|let's)\b/i, `a contraction reached the ${what}`);
    }
  }
});
