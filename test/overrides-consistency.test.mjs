// Override grants (bans / grandfathered / roles) must reference github_ids consistent with members-index.yml.
// A typo'd or swapped github_id<->login fails CLOSED silently (the wrong id never matches the member -> a comp
// grant or ban quietly does nothing). This unit-tests the pure check AND pins the REAL override files to reality
// (a tripwire for the hand-entered grandfather grants + the roles list).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

import { membersIndexFromParsed, overrideConsistencyErrors } from '../membership/overrides-core.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const idx = (obj) => membersIndexFromParsed({ members: obj });

test('overrideConsistencyErrors: clean when grants match the index', () => {
  const m = idx({ '100': 'alice', '200': 'bob' });
  assert.deepEqual(overrideConsistencyErrors(m, [
    { github_id: '100', login: 'alice', _src: 'grandfathered.yml' },
    { github_id: '200', login: 'BOB', _src: 'bans.yml' }, // case-insensitive
  ]), []);
});

test('overrideConsistencyErrors: flags a wrong github_id for a known login', () => {
  const m = idx({ '100': 'alice', '200': 'bob' });
  const errs = overrideConsistencyErrors(m, [{ github_id: '999', login: 'alice', _src: 'grandfathered.yml' }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /login "alice" is github_id 100 .* but the grant lists github_id 999/);
  assert.match(errs[0], /^grandfathered\.yml:/);
});

test('overrideConsistencyErrors: flags a wrong login for a known github_id', () => {
  const m = idx({ '100': 'alice' });
  const errs = overrideConsistencyErrors(m, [{ github_id: '100', login: 'mallory', _src: 'bans.yml' }]);
  assert.equal(errs.length, 1);
  assert.match(errs[0], /github_id 100 is "alice" .* but the grant lists login "mallory"/);
});

test('overrideConsistencyErrors: allows a grant for an id/login NOT in the index (folderless / bot)', () => {
  const m = idx({ '100': 'alice' });
  // a comp grant before the member has a folder, and the gbtilabs bot in roles.yml -> no contradiction
  assert.deepEqual(overrideConsistencyErrors(m, [
    { github_id: '777', login: 'newcomer', _src: 'grandfathered.yml' },
    { github_id: '125175036', login: 'gbtilabs', _src: 'roles.yml superadmins' },
  ]), []);
});

test('overrideConsistencyErrors: skips entries missing an id or a login', () => {
  const m = idx({ '100': 'alice' });
  assert.deepEqual(overrideConsistencyErrors(m, [{ github_id: '100' }, { login: 'alice' }, {}]), []);
});

// ---- reality tripwire: the committed override files must agree with members-index.yml ----
test('REAL house/*.yml override grants are consistent with members-index.yml', () => {
  const load = (rel) => {
    try { return yaml.load(fs.readFileSync(path.join(ROOT, rel), 'utf8')) ?? {}; } catch { return {}; }
  };
  const m = membersIndexFromParsed(load('house/members-index.yml'));
  assert.ok(m.size > 0, 'expected a populated members-index.yml');
  const gf = load('house/grandfathered.yml');
  const bn = load('house/bans.yml');
  const rl = load('house/roles.yml');
  const tag = (list, src) => (Array.isArray(list) ? list : []).map((e) => ({ ...e, _src: src }));
  const entries = [
    ...tag(gf.grandfathered, 'grandfathered.yml'),
    ...tag(bn.bans, 'bans.yml'),
    ...tag(rl.superadmins, 'roles.yml superadmins'),
    ...tag(rl.admins, 'roles.yml admins'),
    ...tag(rl.moderators, 'roles.yml moderators'),
  ];
  const errs = overrideConsistencyErrors(m, entries);
  assert.deepEqual(errs, [], `override grants drifted from members-index.yml:\n${errs.join('\n')}`);
});
