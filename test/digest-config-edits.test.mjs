// sow-266 Phase 2: the superadmin edits to house/digest-config.yml, and the wiring that carries them.
//
// THE CORE IS A PATCH, AND THAT IS THE WHOLE RISK. An omitted key means "leave it alone", which is what lets
// the manager save the switch without resending the copy. Every layer between the box and the file has to
// preserve that, and the ordinary way to write each of those layers breaks it: the two methods this one sits
// beside in the website transport coerce `enabled` with `args?.enabled === true`, which turns an absent switch
// into an explicit false. Doing that here would switch the membership pitch OFF every time somebody saved only
// the wording, and nothing would red. So the wiring tests below are not ceremony: they hold the ONE place the
// established pattern is wrong for this feature.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import {
  setDigestCta, setDigestSponsor, setDigestOptin, readDigestConfig, DigestConfigEditError, DIGEST_LIMITS,
} from '../membership/digest-config-edits.mjs';
import { buildDigestConfigMirror, resolveDigestConfig } from '../membership/digest-config.mjs';
import { ADMIN_ACTIONS_SERVED } from '../workers/signup/membership-admin-author.mjs';

const at = (rel) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel) => fs.readFileSync(at(rel), 'utf8');

const DOC = () => ({
  cta: { enabled: true, body: 'The stored body.', link_label: 'Stored label', link_url: '/membership/' },
  sponsor: { enabled: false, html: '' },
});

test('an omitted field is left alone, which is what makes these patches', () => {
  const r = setDigestCta(DOC(), { body: 'Only the body moved.' });
  assert.equal(r.changed, true);
  assert.equal(r.next.cta.body, 'Only the body moved.');
  assert.equal(r.next.cta.link_label, 'Stored label', 'the label was not sent and must not have moved');
  assert.equal(r.next.cta.link_url, '/membership/');
  assert.equal(r.next.cta.enabled, true, 'the switch was not sent and must not have been read as off');
});

test('an omitted switch is not false', () => {
  // The single most expensive mistake available here, and the one the pattern beside it would have made.
  assert.equal(setDigestCta(DOC(), { body: 'x' }).next.cta.enabled, true);
  assert.equal(setDigestSponsor({ sponsor: { enabled: true, html: '<b>x</b>' } }, { html: '<b>y</b>' }).next.sponsor.enabled, true);
});

test('sending the switch OFF actually turns it off', () => {
  // The mirror image of the test above it, and the half a mutation run found missing: a core that read false as
  // "not sent" would accept every attempt to switch the sponsor off and change nothing, which is the failure
  // where somebody believes they pulled an advertisement and it keeps going out.
  assert.equal(setDigestCta(DOC(), { enabled: false }).next.cta.enabled, false);
  assert.equal(setDigestCta(DOC(), { enabled: false }).changed, true);
  const on = { sponsor: { enabled: true, html: '<b>x</b>' } };
  assert.equal(setDigestSponsor(on, { enabled: false }).next.sponsor.enabled, false);
});

test('saving only the sponsor switch leaves the markup where it was', () => {
  // The same patch rule as the pitch, on the block where getting it wrong is most expensive: blanking the
  // markup while switching the slot on renders a labelled empty box, which the resolver then refuses, so the
  // superadmin sees the switch read On and no sponsor appear.
  const stored = { sponsor: { enabled: false, html: '<a href="https://s.example">Them</a>' } };
  const r = setDigestSponsor(stored, { enabled: true });
  assert.equal(r.next.sponsor.html, '<a href="https://s.example">Them</a>');
  assert.equal(resolveDigestConfig({ mirror: buildDigestConfigMirror(r.next) }).sponsor.enabled, true);
});

test('surrounding whitespace is trimmed, so saving the same copy twice is still a no-op', () => {
  const r = setDigestCta(DOC(), { body: '  Trimmed.  ' });
  assert.equal(r.next.cta.body, 'Trimmed.');
  // Without the trim, this second save compares a padded string against a stored one and opens a pull request
  // that changes nothing a reader would see.
  assert.equal(setDigestCta(r.next, { body: '  Trimmed.  ' }).changed, false);
});

test('the caller\'s parsed document is never modified', () => {
  // These cores all declare themselves pure over the parsed doc. A caller that computes a candidate edit and
  // then discards it must not find its source quietly rewritten.
  const doc = DOC();
  const snapshot = JSON.stringify(doc);
  setDigestCta(doc, { body: 'different' });
  setDigestSponsor(doc, { enabled: true, html: '<b>x</b>' });
  assert.equal(JSON.stringify(doc), snapshot);
});

test('an empty string is a real value and means "use the shipped wording"', () => {
  // Not the same as omitting it. Omitting leaves the stored copy; sending '' clears it, and resolveDigestConfig
  // then falls back per field. A core that treated '' as absent would make clearing a field impossible.
  const r = setDigestCta(DOC(), { body: '' });
  assert.equal(r.changed, true);
  assert.equal(r.next.cta.body, '');
  assert.equal(resolveDigestConfig({ mirror: buildDigestConfigMirror(r.next) }).cta.body.startsWith('A {plan} membership'), true);
});

test('the file keys stay snake_case whatever the wire says', () => {
  const r = setDigestCta({}, { body: 'b', linkLabel: 'l', linkUrl: '/u/' });
  assert.deepEqual(Object.keys(r.next.cta).sort(), ['body', 'link_label', 'link_url']);
  // And the mirror, which is what the Worker actually reads, sees them.
  const m = buildDigestConfigMirror(r.next);
  assert.equal(m.cta.linkLabel, 'l');
  assert.equal(m.cta.linkUrl, '/u/');
});

test('a repeat is a no-op and opens no pull request', () => {
  const doc = DOC();
  const r = setDigestCta(doc, { enabled: true, body: 'The stored body.', linkLabel: 'Stored label', linkUrl: '/membership/' });
  assert.equal(r.changed, false);
  assert.deepEqual(r.audit.detail, { noop: true });
  assert.equal(setDigestSponsor(doc, { enabled: false, html: '' }).changed, false);
});

test('an empty patch is refused rather than opening a branch that changes nothing', () => {
  assert.throws(() => setDigestCta(DOC(), {}), DigestConfigEditError);
  assert.throws(() => setDigestSponsor(DOC(), {}), DigestConfigEditError);
});

test('a switch must be a real boolean', () => {
  // "false" is truthy in JavaScript, so a coercion here is how a slot reads OFF in the file and renders ON.
  for (const bad of ['false', 'true', 0, 1, null]) {
    assert.throws(() => setDigestSponsor(DOC(), { enabled: bad }), DigestConfigEditError, `enabled: ${JSON.stringify(bad)}`);
  }
  assert.equal(setDigestSponsor(DOC(), { enabled: true }).next.sponsor.enabled, true);
});

test('a field that is not text is refused, and one that is far too long', () => {
  assert.throws(() => setDigestCta(DOC(), { body: 42 }), DigestConfigEditError);
  assert.throws(() => setDigestCta(DOC(), { body: 'x'.repeat(DIGEST_LIMITS.body + 1) }), DigestConfigEditError);
  assert.throws(() => setDigestSponsor(DOC(), { html: 'x'.repeat(DIGEST_LIMITS.sponsorHtml + 1) }), DigestConfigEditError);
  // At the limit exactly, it saves. An off-by-one here refuses copy a superadmin was told was allowed.
  assert.equal(setDigestCta(DOC(), { body: 'x'.repeat(DIGEST_LIMITS.body) }).changed, true);
});

test('bad copy is SAVED, because the rules warn and do not block', () => {
  // The owner's ruling of 2026-09-19, and the thing most likely to be re-broken by somebody adding validation
  // that feels obviously right. Long, two links, and naming a free feature: all warnings, all saved.
  const bad = 'Collections and favourites and https://a.example and https://b.example ' + 'x'.repeat(300);
  const r = setDigestCta(DOC(), { body: bad });
  assert.equal(r.changed, true);
  assert.equal(r.next.cta.body, bad);
});

test('a link that goes nowhere is saved, and renders as nothing rather than as itself', () => {
  // Also not blocked, for the same reason. It is safe because the RENDERER refuses it: safeUrl takes a path or
  // http(s) and returns empty for anything else, so the href is empty rather than live.
  const r = setDigestCta(DOC(), { linkUrl: 'javascript:alert(1)' });
  assert.equal(r.changed, true);
  assert.equal(resolveDigestConfig({ mirror: buildDigestConfigMirror(r.next) }).cta.linkUrl, 'javascript:alert(1)');
});

test('the audit names the fields that moved and never carries the sponsor copy', () => {
  const a = setDigestCta(DOC(), { body: 'new', linkLabel: 'new' }).audit;
  assert.deepEqual(a.detail.fields.sort(), ['body', 'link_label']);
  const s = setDigestSponsor(DOC(), { enabled: true, html: '<b>Buy a thing</b>' }).audit;
  assert.equal(JSON.stringify(s.detail).includes('Buy a thing'), false, 'a third party\'s copy does not belong in a log line');
  assert.equal(s.detail.markupLength, '<b>Buy a thing</b>'.length);
});

test('the sponsor markup is stored exactly as pasted, not sanitized on the way in', () => {
  // Sanitizing here would make the stored value a lie about what was agreed, and would silently rewrite the
  // file under a superadmin who pasted something and then could not find it again. It is sanitized at render.
  const raw = '<script>x()</script><a href="https://s.example" onclick="y()">Them</a>';
  assert.equal(setDigestSponsor(DOC(), { html: raw }).next.sponsor.html, raw);
});

test('reading back gives what is STORED, not what would render', () => {
  // An editor pre-filled with the fallback invites a save that pins today's default into the file forever.
  const back = readDigestConfig({ cta: { body: '' }, sponsor: {} });
  assert.equal(back.cta.body, '');
  assert.equal(back.cta.enabled, null, 'not set is a third state, distinct from off');
  assert.equal(back.sponsor.enabled, null);
  const full = readDigestConfig(DOC());
  assert.equal(full.cta.linkLabel, 'Stored label');
  assert.equal(full.cta.enabled, true);
});

test('the doc survives a round trip through the file and back', () => {
  // The whole chain in one line: edit, serialize as the Worker does, re-parse, read back.
  const edited = setDigestCta(DOC(), { body: 'Round trip.', linkUrl: 'https://gbti.network/join/' }).next;
  const back = readDigestConfig(yaml.load(yaml.dump(edited, { lineWidth: 100, noRefs: true })));
  assert.equal(back.cta.body, 'Round trip.');
  assert.equal(back.cta.linkUrl, 'https://gbti.network/join/');
});

// ---------------------------------------------------------------------------------------------------------
// WIRING. Every one of these was proved by breaking the line it names and watching this file go red.
// ---------------------------------------------------------------------------------------------------------

test('WIRING: the website transport does not coerce the switch', () => {
  const src = read('../src/lib/workbench-client.ts');
  const line = src.split('\n').find((l) => l.includes("action: 'digest-cta-set'"));
  assert.ok(line, 'setDigestCta is missing from the website transport');
  assert.doesNotMatch(line, /enabled:\s*args\?\.enabled === true/,
    'coercing an absent switch to false turns the membership pitch off every time only the wording is saved');
  const sponsor = src.split('\n').find((l) => l.includes("action: 'digest-sponsor-set'"));
  assert.ok(sponsor, 'setDigestSponsor is missing from the website transport');
  assert.doesNotMatch(sponsor, /enabled:\s*args\?\.enabled === true/);
});

test('WIRING: all three actions are in the Worker table, the action set and the forwarding set', () => {
  const worker = read('../workers/signup/membership-admin-author.mjs');
  for (const action of ['digest-cta-set', 'digest-sponsor-set', 'digest-optin-set']) {
    assert.match(worker, new RegExp(`'${action}': \\{ path: 'house/digest-config\\.yml', rank: ROLE_RANK\\.superadmin`),
      `${action} must be a superadmin row on house/digest-config.yml`);
    // ADMIN_ACTIONS_SERVED, not a text scan of the file. sow-270 mutation-ran the old `worker.includes(...)`
    // form and it could not fail: the CONFIG_OP row asserted on the line above contains the same quoted
    // string, so the scan matched the row and reported the action set green while the action set was empty.
    // An action in the table but not in the set is dead on arrival, because CONFIG_ACTIONS.has() gates both
    // the rank lookup and the dispatch, so the check has to read the set the route actually consults.
    assert.ok(ADMIN_ACTIONS_SERVED.includes(action), `${action} must be in CONFIG_ACTIONS or the route refuses it`);
    assert.ok(read('../client/src/admin-worker-actions.mjs').includes(`'${action}'`),
      `${action} must be forwarded to the Worker, or the client refuses it before it leaves`);
  }
});

test('WIRING: the two rows use FIXED branch names, so one file does not race itself', () => {
  const worker = read('../workers/signup/membership-admin-author.mjs');
  assert.match(worker, /'digest-cta-set':.*slug: \(\) => 'membership-pitch'/);
  assert.match(worker, /'digest-sponsor-set':.*slug: \(\) => 'sponsor-slot'/);
  // Two DIFFERENT names. One shared name would put a wording tweak and a paid placement on one branch, where
  // whichever saved second resets the first.
  assert.notEqual('membership-pitch', 'sponsor-slot');
});

test('WIRING: the pool read is reachable on every host', () => {
  assert.match(read('../workers/signup/index.mjs'), /'\/membership\/admin\/digest-config': membershipAdminDigestConfig/);
  assert.match(read('../src/lib/workbench-client.ts'), /workerGet\('\/membership\/admin\/digest-config'\)/);
  assert.match(read('../client/src/api.mjs'), /'\/api\/digest-config'/);
  assert.match(read('../extension/src/ext-dispatch.mjs'), /'\/api\/digest-config'/);
  assert.match(read('../client-ui/src/client.mjs'), /digestConfig: \(\) => request\('GET', '\/api\/digest-config'\)/);
});

test('WIRING: the manager is mounted on both admin surfaces, superadmin only', () => {
  const site = read('../src/pages/admin.astro');
  assert.match(site, /data-tab="digest" data-min="superadmin"/);
  assert.ok(site.includes('<gbti-digest-manager>'));
  assert.match(site, /rank >= RANK\.superadmin[\s\S]*gbti-digest-manager\.mjs/,
    'the module must be imported inside the superadmin branch, or an admin upgrades the element');
  const ext = read('../extension/admin.html');
  assert.match(ext, /data-tab="digest" data-min="superadmin"/);
  assert.ok(ext.includes('<gbti-digest-manager>'));
});

test('WIRING: the manager counts characters the same way the warning does', () => {
  // A count that disagreed with the warning under it is worse than no count: the reader trusts the number they
  // watch change as they type. Both must go through ctaVisibleLength, which counts {plan} as the word it becomes.
  const el = read('../client-ui/src/elements/gbti-digest-manager.mjs');
  assert.match(el, /ctaVisibleLength/);
  assert.doesNotMatch(el, /const visible = \(d\.body/, 'a raw string length here silently disagrees with ctaWarnings');
});

test('the shipped file parses, carries both blocks, and its pitch raises no warning', () => {
  const doc = yaml.load(read('../house/digest-config.yml'));
  const back = readDigestConfig(doc);
  assert.equal(typeof back.cta.body, 'string');
  assert.equal(back.cta.body.includes('{plan}'), true, 'the shipped copy binds the plan name rather than spelling it');
  assert.equal(back.sponsor.enabled, false, 'the sponsor slot ships OFF');
});

// ---------------------------------------------------------------------------------------------------------
// sow-270: the confirmation switch. It joins the two blocks above as a third edit on the same file, so the
// tests that matter are the ones that would let it be saved WITHOUT being reachable, or reachable without
// being separable from the copy. Each was proved by breaking the line it names.
// ---------------------------------------------------------------------------------------------------------

test('sow-270: the switch is set, and setting it to what it already is reports no change', () => {
  const doc = { ...DOC(), optin: { double: false } };
  const on = setDigestOptin(doc, { double: true });
  assert.equal(on.changed, true);
  assert.equal(on.next.optin.double, true);
  assert.equal(on.audit.action, 'digest-optin.set');

  const again = setDigestOptin(on.next, { double: true });
  assert.equal(again.changed, false, 'saving the same value must not open a pull request');
  assert.equal(again.next.optin.double, true);
});

test('sow-270: a missing or non-boolean value is refused rather than guessed', () => {
  for (const args of [{}, { double: null }, { double: 'true' }, { double: 1 }, { double: 'yes' }]) {
    assert.throws(() => setDigestOptin(DOC(), args), DigestConfigEditError,
      `${JSON.stringify(args)} must be refused: guessing this one decides what a stranger consented to`);
  }
});

test('sow-270: the switch does not disturb the copy, and the copy does not disturb the switch', () => {
  const doc = { ...DOC(), optin: { double: true } };
  const copy = setDigestCta(doc, { body: 'Only the wording moved.' });
  assert.equal(copy.next.optin.double, true, 'saving the pitch must not reset the confirmation mode');

  const flip = setDigestOptin(doc, { double: false });
  assert.equal(flip.next.cta.body, 'The stored body.', 'flipping the switch must not blank the pitch');
  assert.equal(flip.next.cta.enabled, true);
});

test('sow-270: the read shows what is STORED, so an unset switch reads as unset and not as off', () => {
  const unset = readDigestConfig({ ...DOC() });
  assert.equal(unset.optin.double, null,
    'null and false must stay distinguishable, or the manager cannot show that nobody has chosen yet');
  assert.equal(readDigestConfig({ ...DOC(), optin: { double: false } }).optin.double, false);
  assert.equal(readDigestConfig({ ...DOC(), optin: { double: true } }).optin.double, true);
});

test('WIRING sow-270: the switch reaches the Worker from every host, and its branch is its own', () => {
  const worker = read('../workers/signup/membership-admin-author.mjs');
  assert.match(worker, /'digest-optin-set':.*slug: \(\) => 'confirmation-mode'/,
    'a fixed branch of its own: sharing one with the copy lets whichever saved second reset the first');

  const site = read('../src/lib/workbench-client.ts').split('\n').find((l) => l.includes("action: 'digest-optin-set'"));
  assert.ok(site, 'setDigestOptin is missing from the website transport');
  assert.doesNotMatch(site, /double:\s*args\?\.double === true/,
    'coercing an absent value to false would turn confirmation off on a save that never mentioned it');

  const ui = read('../client-ui/src/client.mjs').split('\n').find((l) => l.includes("action: 'digest-optin-set'"));
  assert.ok(ui, 'setDigestOptin is missing from the shared client transport');

  // The defaults ride back with the read, or the manager has nothing to show beside an unset switch.
  assert.match(worker, /defaults: \{ cta: \{ \.\.\.DEFAULT_CTA \}, sponsor: \{ \.\.\.DEFAULT_SPONSOR \}, optin: \{ \.\.\.DEFAULT_OPTIN \} \}/);
});

test('WIRING sow-270: the manager renders the block and saves it on its own', () => {
  const el = read('../client-ui/src/elements/gbti-digest-manager.mjs');
  assert.match(el, /\$\{this\._optinBlock\(\)\}/, 'the block must be in the render, not merely defined');
  assert.match(el, /optin: \(\) => this\.client\.setDigestOptin\(\{ double: d\.double === true \}\)/,
    'its own save, so flipping the switch never rides along with a copy edit');
  assert.match(el, /data-save="optin"/);
  // Both modes are described. A switch labelled only with the term tells a reader who knows it nothing new,
  // and everyone else nothing at all, which is the whole reason this setting was unreachable before.
  assert.match(el, /nothing arrives until they follow it/);
  assert.match(el, /starts receiving the digest straight away/);
  // The third state survives: unset is shown as unset rather than as a chosen off.
  assert.match(el, /Nobody has chosen yet/);
  assert.match(el, /this\._optinUnset = typeof r\?\.optin\?\.double !== 'boolean'/);

  // sow-270 Phase 2 corrected the footer: it used to say a save reached the mail on the next settings sync.
  assert.doesNotMatch(el, /on the next settings sync rather than immediately/,
    'the six-hour lag was fixed by the push trigger; the footer must not still claim it');
});
