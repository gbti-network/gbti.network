// sow-266 Phase 1: the digest's editable settings, the pitch copy and the sponsor slot.
//
// Owner decisions this pins (2026-09-19): one standing sponsor rather than one per issue, GBTI sells it, and
// the three pitch rules WARN rather than refuse. That last one is why the warnings are a returned list and
// not a thrown error: the saving path must be able to ignore them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import {
  DIGEST_CONFIG_KV_KEY, DEFAULT_CTA, DEFAULT_SPONSOR, CTA_RULES,
  ctaWarnings, ctaVisibleLength, buildDigestConfigMirror, resolveDigestConfig,
} from '../membership/digest-config.mjs';
import { SUPERADMIN_HOUSE_FILES, rankForPath, ROLE_RANK } from '../membership/path-rank.mjs';

const houseFile = () => yaml.load(fs.readFileSync(new URL('../house/digest-config.yml', import.meta.url), 'utf8'));

// ---------------------------------------------------------------------------
// What ships
// ---------------------------------------------------------------------------

test('sow-266: the file we ship breaks none of its own pitch rules', () => {
  // The rules warn rather than block, so nothing would stop a bad DEFAULT reaching every issue. This is what
  // stops it.
  const cta = houseFile().cta;
  assert.deepEqual(ctaWarnings({ body: cta.body, linkLabel: cta.link_label, linkUrl: cta.link_url }), []);
});

test('sow-266: the shipped file starts with the sponsor OFF', () => {
  // Absent means off, false means off, and the file says false out loud so the state is legible rather than
  // inferred. Rendering an advertisement by accident is not a recoverable mistake.
  const raw = houseFile();
  assert.equal(raw.sponsor.enabled, false);
  assert.equal(raw.sponsor.html, '');
  assert.equal(resolveDigestConfig({ mirror: buildDigestConfigMirror(raw) }).sponsor.enabled, false);
});

test('sow-266: the shipped pitch copy is the copy compiled into the renderer', () => {
  // The fail-safe is only a fail-safe if it matches what ships. If these two drift, a missing mirror silently
  // changes the wording of the mail rather than preserving it.
  const raw = houseFile();
  assert.equal(raw.cta.body.replace(/\s+/g, ' ').trim(), DEFAULT_CTA.body.replace(/\s+/g, ' ').trim());
  assert.equal(raw.cta.link_label, DEFAULT_CTA.linkLabel);
  assert.equal(raw.cta.link_url, DEFAULT_CTA.linkUrl);
});

test('sow-266: the settings file is superadmin-owned, in lockstep', () => {
  assert.ok(SUPERADMIN_HOUSE_FILES.has('house/digest-config.yml'));
  assert.equal(rankForPath('house/digest-config.yml'), ROLE_RANK.superadmin);
  const owners = fs.readFileSync(new URL('../CODEOWNERS', import.meta.url), 'utf8');
  assert.match(owners, /^\/house\/digest-config\.yml\s+@atwellpub @gbtilabs$/m);
});

// ---------------------------------------------------------------------------
// The three rules
// ---------------------------------------------------------------------------

test('sow-266: the plan name is a BINDING, and it is measured as the word it becomes', () => {
  // sow-323 collapsed the two paid plans and the copy binds the name rather than spelling it, so a rename
  // never leaves a stale name in somebody's inbox. A length check that measured "{plan}" instead of the plan
  // would under-count every pitch that uses it.
  assert.equal(ctaVisibleLength('{plan} membership', 'Network Supporter'), 'Network Supporter membership'.length);
  assert.equal(ctaVisibleLength('  padded  '), 'padded'.length);
  assert.equal(ctaVisibleLength(null), 0);
});

test('sow-266: copy that is too long warns, and says by how much', () => {
  const long = { body: 'x'.repeat(CTA_RULES.maxVisibleChars + 1), linkLabel: 'Read more', linkUrl: '/membership/' };
  const w = ctaWarnings(long);
  assert.equal(w.length, 1);
  assert.match(w[0], new RegExp(`${CTA_RULES.maxVisibleChars + 1 + 'Read more'.length} characters`));
  assert.match(w[0], new RegExp(`limit is ${CTA_RULES.maxVisibleChars}`));

  // The LABEL counts toward the length too, because the reader sees both.
  const exact = { body: 'x'.repeat(CTA_RULES.maxVisibleChars - 5), linkLabel: '12345', linkUrl: '/membership/' };
  assert.deepEqual(ctaWarnings(exact), [], 'exactly at the limit is fine');
  assert.equal(ctaWarnings({ ...exact, linkLabel: '123456' }).length, 1, 'one character over is not');
});

test('sow-266: a second link in the body warns, however it is written', () => {
  for (const body of ['Read <a href="/x">this</a> too.', 'See https://example.com for more.', 'http://example.com']) {
    const w = ctaWarnings({ body, linkLabel: 'More', linkUrl: '/membership/' });
    assert.ok(w.some((x) => /carries its own link/.test(x)), body);
  }
  assert.deepEqual(ctaWarnings({ body: 'No links here at all.', linkLabel: 'More', linkUrl: '/membership/' }), []);
});

test('sow-266: naming something a free account already has warns', () => {
  // The design mockup claims saved collections as a membership benefit in TWO places, and a free signed-in
  // account already has them, so a re-derivation from the mockup reintroduces the false claim. This is the
  // same thing the render guard has been asserting, moved to where the copy is now typed.
  for (const claim of CTA_RULES.forbiddenClaims) {
    const w = ctaWarnings({ body: `Membership adds ${claim} and more.`, linkLabel: 'More', linkUrl: '/membership/' });
    assert.ok(w.some((x) => x.includes(claim)), claim);
  }
  // CAPITALISED TOO, which is how a person actually types it: at the start of a sentence, or as a feature
  // name. A case-sensitive check passes every lowercase test above and misses every real edit.
  for (const body of ['Collections are included.', 'Saved COLLECTIONS and more.', 'Favourites, too.']) {
    assert.ok(ctaWarnings({ body, linkLabel: 'More', linkUrl: '/membership/' }).some((x) => /free account already has/.test(x)), body);
  }
  // And in the LINK LABEL, not only the body.
  assert.ok(ctaWarnings({ body: 'Words.', linkLabel: 'See your Collections', linkUrl: '/x/' }).some((x) => /free account already has/.test(x)));

  // Once, not once per word, so the message stays readable.
  const both = ctaWarnings({ body: 'collections and favourites', linkLabel: 'More', linkUrl: '/membership/' });
  assert.equal(both.filter((x) => /free account already has/.test(x)).length, 1);
});

test('sow-266: an empty or broken link warns rather than rendering nothing clickable', () => {
  assert.ok(ctaWarnings({ body: 'Words.', linkLabel: '', linkUrl: '/membership/' }).some((w) => /no label/.test(w)));
  assert.ok(ctaWarnings({ body: 'Words.', linkLabel: 'More', linkUrl: '' }).some((w) => /no destination/.test(w)));
  assert.ok(ctaWarnings({ body: 'Words.', linkLabel: 'More', linkUrl: 'javascript:alert(1)' }).some((w) => /must start with/.test(w)));
  assert.ok(ctaWarnings({ body: 'Words.', linkLabel: 'More', linkUrl: 'http://x.test' }).some((w) => /must start with/.test(w)), 'plain http is not https');
  assert.deepEqual(ctaWarnings({ body: 'Words.', linkLabel: 'More', linkUrl: 'https://x.test' }), []);
  assert.ok(ctaWarnings({ body: '   ', linkLabel: 'More', linkUrl: '/x/' }).some((w) => /no text/.test(w)));
});

test('sow-266: a dash our writing conventions do not use warns, because this copy is now typed', () => {
  assert.ok(ctaWarnings({ body: 'One thing — another.', linkLabel: 'More', linkUrl: '/x/' }).some((w) => /dash/.test(w)));
  assert.ok(ctaWarnings({ body: 'One thing – another.', linkLabel: 'More', linkUrl: '/x/' }).some((w) => /dash/.test(w)));
  assert.deepEqual(ctaWarnings({ body: 'A well-built thing.', linkLabel: 'More', linkUrl: '/x/' }), [], 'a hyphen is fine');
});

// ---------------------------------------------------------------------------
// Getting it to the Worker
// ---------------------------------------------------------------------------

test('sow-266: the mirror carries only what was actually set', () => {
  // Per field, not all or nothing. Setting one thing must never silently reset the others.
  const m = buildDigestConfigMirror({ cta: { body: '  Hello.  ', link_label: '', link_url: null }, sponsor: {} });
  assert.deepEqual(m.cta, { body: 'Hello.' });
  assert.deepEqual(m.sponsor, {});
  assert.match(m.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
});

test('sow-266: a false switch is CARRIED, not omitted, so the off state is legible in the store', () => {
  const m = buildDigestConfigMirror({ cta: { enabled: false }, sponsor: { enabled: false } });
  assert.equal(m.cta.enabled, false);
  assert.equal(m.sponsor.enabled, false);
});

test('sow-266: junk in the file does not become settings', () => {
  for (const raw of [null, undefined, 'nonsense', [], { cta: [], sponsor: 'x' }, { cta: { body: 42, enabled: 'true' } }]) {
    const m = buildDigestConfigMirror(raw);
    assert.deepEqual(m.cta, {}, JSON.stringify(raw));
    assert.deepEqual(m.sponsor, {}, JSON.stringify(raw));
  }
});

test('sow-266: a missing or broken mirror resolves to the copy that ships, NOT to nothing', () => {
  // An issue going out with last month's wording is a smaller failure than one going out with no pitch. This
  // is the whole fail-safe.
  for (const mirror of [null, undefined, {}, 'nonsense', [], { cta: 'nonsense' }]) {
    const r = resolveDigestConfig({ mirror });
    assert.equal(r.cta.enabled, true, JSON.stringify(mirror));
    assert.equal(r.cta.body, DEFAULT_CTA.body);
    assert.equal(r.cta.linkLabel, DEFAULT_CTA.linkLabel);
    assert.equal(r.cta.linkUrl, DEFAULT_CTA.linkUrl);
    assert.equal(r.cta.source, 'default');
    assert.equal(r.sponsor.enabled, DEFAULT_SPONSOR.enabled);
  }
});

test('sow-266: one changed field leaves the others on the shipped copy', () => {
  const r = resolveDigestConfig({ mirror: { cta: { linkLabel: 'See what you get' } } });
  assert.equal(r.cta.linkLabel, 'See what you get');
  assert.equal(r.cta.body, DEFAULT_CTA.body, 'the body was not touched, so it keeps the shipped wording');
  assert.equal(r.cta.linkUrl, DEFAULT_CTA.linkUrl);
  assert.equal(r.cta.source, 'config');
});

test('sow-266: the sponsor FAILS CLOSED, so an empty slot never renders a bare Sponsored label', () => {
  assert.equal(resolveDigestConfig({ mirror: { sponsor: { enabled: true, html: '' } } }).sponsor.enabled, false);
  assert.equal(resolveDigestConfig({ mirror: { sponsor: { enabled: true, html: '   ' } } }).sponsor.enabled, false);
  assert.equal(resolveDigestConfig({ mirror: { sponsor: { html: '<p>Anyone</p>' } } }).sponsor.enabled, false, 'markup alone does not turn it on');
  const on = resolveDigestConfig({ mirror: { sponsor: { enabled: true, html: '<p>A sponsor</p>' } } });
  assert.equal(on.sponsor.enabled, true);
  assert.equal(on.sponsor.html, '<p>A sponsor</p>');
});

test('sow-266: the pitch can be switched off, which is different from having no copy', () => {
  const off = resolveDigestConfig({ mirror: { cta: { enabled: false } } });
  assert.equal(off.cta.enabled, false);
  assert.equal(off.cta.body, DEFAULT_CTA.body, 'the copy survives being switched off, so switching it back on restores it');
});

test('sow-266: what the file holds survives the round trip to the store and back', () => {
  const raw = houseFile();
  const r = resolveDigestConfig({ mirror: buildDigestConfigMirror(raw) });
  assert.equal(r.cta.body.replace(/\s+/g, ' ').trim(), DEFAULT_CTA.body.replace(/\s+/g, ' ').trim());
  assert.equal(r.cta.linkLabel, DEFAULT_CTA.linkLabel);
  assert.equal(r.sponsor.enabled, false);
  assert.equal(DIGEST_CONFIG_KV_KEY, 'digest:config');
});
