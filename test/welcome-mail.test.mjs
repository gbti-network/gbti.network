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
  assert.equal(subject, 'Your prompt is live on GBTI Network \u2022 COMPLETE ONBOARDING');
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
  assert.doesNotMatch(html, />1<\/td>/, 'Discord keeps number one and is not listed, so the rows start at 2');
  for (const n of ['2', '3', '4', '5']) assert.match(html, new RegExp(`>${n}</td>`));
  for (const n of ['2', '3', '4', '5']) assert.match(text, new RegExp(`^${n}\\. `, 'm'), `the text body numbers step ${n} the same way`);
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
  assert.equal(subject, 'Welcome to GBTI Network \u2022 COMPLETE ONBOARDING');
  assert.match(html, /Welcome, Dana\. Here is what you can do\./);
  assert.doesNotMatch(html, /PUBLISHED/, 'nothing was published, so there is no receipt');
  assert.doesNotMatch(html, /Join the Discord/, 'a free account may not join it, so it is never offered');
  assert.doesNotMatch(html, /Add your social handles/, 'publishing is paid, so the handles step is not theirs');
  assert.match(html, /Complete Onboarding/, 'the same label works for both tiers');
  for (const n of ['1', '2', '3']) assert.match(html, new RegExp(`>${n}</td>`));
  assert.doesNotMatch(html, />4</, 'three steps, not five');
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
  assert.match(html, />5</, 'hiding a step on a failed read is the direction that loses a paying member work');
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

test('there is no masthead: no GBTI NETWORK eyebrow, the mark sits top right of the heading row, and the email opens on the heading (owner, 2026-10-27)', () => {
  for (const [label, rec] of [['claimer', CLAIMER], ['free account', FREE], ['dark', { ...CLAIMER, theme: 'dark' }]]) {
    const { html } = welcomeMail(rec);
    assert.doesNotMatch(html, /GBTI NETWORK/, `${label}: no eyebrow (the footer's "joined GBTI Network" is mixed case)`);
    // The mark follows the heading in the heading's own row, in a right-aligned cell, both cells top aligned.
    const row = html.slice(html.lastIndexOf('<tr>', html.indexOf('<h1')), html.indexOf('</table>', html.indexOf('<h1')));
    const mark = rec.theme === 'dark' ? 'white' : 'ink';
    assert.match(row, /^<tr><td valign="top"[^>]*><h1/, `${label}: the heading cell comes first, top aligned`);
    assert.match(row, new RegExp(`</h1></td><td width="34" valign="top" align="right"[^>]*><img src="https://gbti\\.network/brand/logo/mark-${mark}-96\\.png" width="34" height="34" alt="GBTI Network"`),
      `${label}: the ${mark} mark, top right of the heading`);
    assert.equal((html.slice(0, html.indexOf('<h1')).match(/<img /g) || []).length, 0, `${label}: no image above or before the heading`);
    assert.match(html, /You are receiving this because you joined GBTI Network\./, `${label}: the footer still names the network`);
    // Everything before the heading, less the hidden preheader, must be markup with no visible text in it.
    const before = html.slice(html.indexOf('<body'), html.indexOf('<h1')).replace(/<div style="display:none[^"]*">[^<]*<\/div>/, '');
    assert.ok(html.indexOf('<h1') > 0, `${label}: the heading moved; this assertion measures nothing`);
    assert.equal(before.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim(), '', `${label}: the heading is the first thing read`);
  }
});


// ---- the 2026-10-27 revision: the owner's notes on the first test email -----------------------------------------

test('the step numbers are single large digits, never the old zero-padded 02', () => {
  const { html } = welcomeMail(CLAIMER);
  assert.doesNotMatch(html, />0[1-9]</, 'no zero-padded number anywhere');
  const step = html.match(/<td width="40" valign="middle" style="([^"]*)">2<\/td>/);
  assert.ok(step, 'step 2 has its own number cell');
  assert.match(step[1], /font-size:32px/, 'large');
  const rows = html.match(/<tr><td style="padding:[^"]*"><table[^>]*><tr><td width="40" valign="middle"/g) || [];
  assert.ok(rows.length >= 3, `${rows.length} step rows; this measures nothing below three`);
  for (const r of rows) assert.match(r, /padding:18px 26px 0/, '18px between steps (owner, 2026-10-27: "even more spacing")');
});

test('the step numbers step down in shade and weight, black and bold first (owner, 2026-10-27)', () => {
  const cells = (html) => [...html.matchAll(/<td width="40" valign="middle" style="([^"]*)">(\d)<\/td>/g)]
    .map(([, style, n]) => ({ n: Number(n), color: style.match(/color:(#[0-9a-f]{6})/)[1], weight: Number(style.match(/font-weight:(\d+)/)[1]) }));
  const light = cells(welcomeMail(CLAIMER).html);
  assert.ok(light.length >= 3, `${light.length} numbered steps; this measures nothing below three`);
  assert.equal(light[0].n, 2, 'a paid email lists from 2, Discord having its own block, so this is the case that matters');
  assert.deepEqual([light[0].color, light[0].weight], ['#000000', 700], 'the first LISTED number is black and bold, whatever its digit');
  assert.deepEqual(cells(welcomeMail(FREE).html)[0], { n: 1, color: '#000000', weight: 700 }, 'and a free email from 1 the same');
  assert.equal(new Set(light.map((c) => c.color)).size, light.length, 'every number has its own shade');
  assert.ok(light.some((c) => c.weight === 400), 'the later numbers are regular weight');
  for (const c of light) assert.ok([400, 700].includes(c.weight), `step ${c.n}: Trebuchet has only 400 and 700, got ${c.weight}`);
  const dark = cells(welcomeMail({ ...CLAIMER, theme: 'dark' }).html);
  assert.equal(dark[0].color, '#ffffff', 'the dark variant starts at white');
  assert.ok(!dark.some((c) => c.color === '#000000'), 'no black number on the dark card');
});

test('the Discord block carries the Discord tile to the left of its words, and only where Discord is offered', () => {
  const { html } = welcomeMail(CLAIMER);
  const block = html.slice(html.lastIndexOf('<table', html.indexOf('Join the Discord')), html.indexOf('Join the Discord'));
  assert.match(block, /<img src="https:\/\/gbti\.network\/brand\/social\/discord-tile\.png" width="40" height="40" alt="Discord"/, 'the tile comes before the heading, in the same block');
  assert.doesNotMatch(welcomeMail(FREE).html, /discord-tile/, 'a free account is not offered Discord, so no tile');
  assert.match(html, /Come join us inside the private Discord for all GBTI Network members\. Complete onboarding below to claim your invite\./);
  assert.doesNotMatch(html, /actual product|open to you now|The community is the product/, 'the owner\'s 2026-10-27 wording replaced it');
  const tile = fs.readFileSync(path.join(HERE, '..', 'public/brand/social/discord-tile.png'));
  assert.equal(tile.subarray(1, 4).toString(), 'PNG', 'the tile the email names is a PNG the site serves');
  assert.equal(tile.readUInt32BE(16), 96, '96 wide, for a 40px slot');
  assert.equal(tile.readUInt32BE(20), 96);
});

test('the cover fills the receipt card top to bottom, with a fallback for each client that ignores the style', () => {
  const { html } = welcomeMail(CLAIMER);
  const url = 'https://cdn.jsdelivr.net/gh/gbti-network/gbti.network@main/members/sbalger75/prompts/pedro-monkey-puppet-portrait/images/result.jpg';
  const cell = html.match(/<td width="(\d+)" height="(\d+)" valign="top" background="([^"]+)"[^>]*style="([^"]*)">/);
  assert.ok(cell, 'the cover is the background of the first cell, so the row gives it the card height');
  assert.equal(cell[3], url, 'the background attribute, for a Gmail that drops the style');
  assert.match(cell[4], new RegExp(`background-image:url\\('${url.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}'\\)`));
  assert.match(cell[4], /background-size:cover/, 'cropped to fill, never squashed');
  assert.match(cell[4], /border-radius:7px 0 0 7px/, 'flush with the card on its left');
  assert.match(html, /<!--\[if mso\]><img src="[^"]+result\.jpg"/, 'Outlook on Windows draws no CSS background, so it gets the image');
  assert.doesNotMatch(html, /<img src="https:\/\/cdn\.jsdelivr[^>]*height:auto/, 'the old shrunken thumbnail is gone');
});

test('a folder that could break out of url() never becomes a cover address (coverUrl refuses it; COVER_URL_RE is a second gate)', () => {
  const html = welcomeMail({ ...CLAIMER, item: { ...CLAIMER.item, folder: "x'),url(evil" } }).html;
  assert.doesNotMatch(html, /evil/, 'coverUrl already refuses that folder');
  assert.doesNotMatch(html, /background-image/, 'no cover, no background');
  assert.match(html, /Pedro Monkey Puppet Portrait/, 'the card still reads without its picture');
});

test('the Complete Onboarding button is black with a 6px radius, and inverts on the dark card (owner, 2026-10-27)', () => {
  const cellOf = (html) => html.match(/<td align="center" bgcolor="([^"]+)" style="([^"]*)"><a href="[^"]+\/welcome\/" style="([^"]*)">Complete Onboarding<\/a>/);
  const light = cellOf(welcomeMail(CLAIMER).html);
  assert.ok(light, 'the button cell is where it was');
  assert.equal(light[1], '#000000');
  assert.match(light[2], /background-color:#000000;border-radius:6px/);
  assert.match(light[3], /padding:18px 20px/, 'taller than the first 14px');
  assert.match(light[3], /color:#ffffff/);
  const dark = cellOf(welcomeMail({ ...CLAIMER, theme: 'dark' }).html);
  assert.notEqual(dark[1], '#000000', 'a black button would vanish on the dark card');
  assert.match(dark[3], /color:#000000/);
  assert.match(cellOf(welcomeMail(FREE).html)[2], /border-radius:6px/, 'the free account gets the same button');
});
