// The daily.dev squad moved from /squads/gbti_network to /squads/gbti on 2026-10-08. Every surface that links to it
// must use the new address, and a click on the daily.dev icon in an email sent BEFORE the move must still resolve,
// because the click route rebuilds an issue's allowed destinations from the social row as it is now.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DIGEST_SOCIAL, RETIRED_SOCIAL_HREFS } from '../membership/mail-social.mjs';
import { candidateTargets, resolveClick, clickSlot } from '../membership/mail-click.mjs';
import { composeUrl } from '../client-ui/src/social-composer.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const NEW = /daily\.dev\/squads\/gbti\/?(?=['"\s]|$)/m;
const OLD = /squads\/gbti_network/;

// Each surface that names the squad, read as source so the .ts and the profile are covered without a build.
const SURFACES = [
  'src/lib/social.ts', // the site footer
  'client-ui/src/elements/gbti-welcome.mjs', // the welcome follow tile
  'client-ui/src/social-composer.mjs', // the Social Queue Assist button
  'members/gbtilabs/profile.md', // the GBTI profile's links
];

test('every surface that links the daily.dev squad uses the new address', () => {
  for (const p of SURFACES) {
    const src = read(p);
    assert.match(src, NEW, `${p} should link daily.dev/squads/gbti`);
    assert.doesNotMatch(src, OLD, `${p} still links the old squad`);
  }
});

test('the email social row links the new squad', () => {
  const dd = DIGEST_SOCIAL.find((s) => s.key === 'dailydev');
  assert.equal(dd.href, 'https://daily.dev/squads/gbti/');
});

test('the Social Queue Assist opens the new squad', () => {
  assert.equal(composeUrl({ channel: 'dailydev', text: 'x' }), 'https://app.daily.dev/squads/gbti');
});

test('a daily.dev click in an issue sent before the move still resolves, and so does one sent after', () => {
  const site = 'https://gbti.network';
  const old = 'https://daily.dev/squads/gbti_network/';
  assert.ok(RETIRED_SOCIAL_HREFS.includes(old));
  const targets = candidateTargets({}, site);
  assert.ok(targets.has(old), 'the retired squad address must stay a click destination');
  assert.ok(targets.has('https://daily.dev/squads/gbti/'));
  assert.equal(resolveClick({}, site, clickSlot(old)), old);
  assert.equal(resolveClick({}, site, clickSlot('https://daily.dev/squads/gbti/')), 'https://daily.dev/squads/gbti/');
});

test('a retired address is not also a live one, so the email never shows it', () => {
  const live = new Set(DIGEST_SOCIAL.map((s) => s.href));
  for (const h of RETIRED_SOCIAL_HREFS) assert.ok(!live.has(h), `${h} is retired but still in the social row`);
});
