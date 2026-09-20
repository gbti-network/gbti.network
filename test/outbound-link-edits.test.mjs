// sow-359: editing the tracked partner link store. sow-289 shipped readers only and left this to its own plan.
//
// WHY THE FIXTURE IS NOT THE LIVE STORE. Tests built on house/outbound-links.yml would pass by describing
// whatever happens to be committed. Everything here runs on a document made for the case.
//
// The two rules worth guarding are the ones that cost money when they break: a repoint must keep the path
// (or one partner's click history splits across two paths), and a retire must keep answering (or a link in
// an old post starts 404ing). Both are asserted through `redirectRowsOf`, which is what actually serves.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addOutboundLink, updateOutboundLink, setOutboundLinkStatus, OutboundLinkEditError,
  redirectRowsOf, validateOutboundLinks, LINK_STATUSES,
} from '../membership/outbound-link-edits.mjs';

const doc = () => ({
  links: [
    { path: '/outbound/alpha', destination: 'https://alpha.example.com/?ref=A1', partner: 'alpha', status: 'live', note: 'why alpha' },
    { path: '/legacy/beta', destination: 'https://beta.example.com/go?id=7', partner: 'beta', status: 'live' },
  ],
});
const actor = { actor: { githubId: 42, login: 'gbtilabs' }, now: '2026-09-20T00:00:00.000Z' };

test('sow-359: minting a link adds a valid row in the file key order, and never touches the caller document', () => {
  const before = doc();
  const { next, changed, audit } = addOutboundLink(before, {
    path: '/outbound/gamma', destination: 'https://gamma.example.com/join?ref=G9', partner: 'gamma', note: 'why gamma',
  }, actor);
  assert.equal(changed, true);
  assert.equal(before.links.length, 2, 'the input document was mutated');
  assert.deepEqual(validateOutboundLinks(next), []);
  assert.deepEqual(Object.keys(next.links[2]), ['path', 'destination', 'partner', 'status', 'note'], 'key order must match the file');
  assert.equal(next.links[2].status, 'live', 'a new link defaults to live');
  assert.deepEqual(audit.target, { path: '/outbound/gamma' });
  assert.equal(audit.actor.login, 'gbtilabs');
  // A note is optional and is left out entirely rather than written as an empty string.
  const bare = addOutboundLink(doc(), { path: '/outbound/d', destination: 'https://d.example.com/x', partner: 'd' });
  assert.equal('note' in bare.next.links[2], false);
});

test('sow-359: minting refuses a duplicate path, and refuses what the store has always refused', () => {
  assert.throws(() => addOutboundLink(doc(), { path: '/outbound/alpha', destination: 'https://x.example.com/y', partner: 'x' }),
    (e) => e instanceof OutboundLinkEditError && /already exists/.test(e.message));
  assert.throws(() => addOutboundLink(doc(), { destination: 'https://x.example.com/y', partner: 'x' }), /needs a path/);
  // The Cloudways lesson: a destination with no path before its query gets a slash appended by Cloudflare,
  // which lands inside the query and corrupts the last parameter. It happened live.
  assert.throws(() => addOutboundLink(doc(), { path: '/outbound/x', destination: 'https://x.example.com?id=1', partner: 'x' }),
    /explicit path before any query/);
  assert.throws(() => addOutboundLink(doc(), { path: 'no-leading-slash', destination: 'https://x.example.com/y', partner: 'x' }), OutboundLinkEditError);
  assert.throws(() => addOutboundLink(doc(), { path: '/outbound/x', destination: 'https://x.example.com/y', partner: 'NOT A PARTNER' }), OutboundLinkEditError);
});

test('sow-359: A REPOINT KEEPS THE PATH, so one partner keeps one click history', () => {
  const { next, changed, audit } = updateOutboundLink(doc(), { path: '/outbound/alpha', destination: 'https://alpha.example.com/new?ref=A2' }, actor);
  assert.equal(changed, true);
  assert.equal(next.links.length, 2, 'a repoint must not mint a second row');
  assert.equal(next.links[0].path, '/outbound/alpha', 'the path is the key and must survive a repoint');
  assert.equal(next.links[0].destination, 'https://alpha.example.com/new?ref=A2');
  assert.deepEqual(audit.detail.from, 'https://alpha.example.com/?ref=A1');
  assert.deepEqual(audit.detail.to, 'https://alpha.example.com/new?ref=A2');
  // The path cannot be renamed through an update: it is the lookup key, so an unknown one is refused outright
  // rather than quietly creating a row.
  assert.throws(() => updateOutboundLink(doc(), { path: '/outbound/does-not-exist', destination: 'https://x.example.com/y' }),
    (e) => e instanceof OutboundLinkEditError && /no tracked link at/.test(e.message));
});

test('sow-359: a repoint is idempotent, can clear a note, and revalidates before returning', () => {
  const same = updateOutboundLink(doc(), { path: '/outbound/alpha', destination: 'https://alpha.example.com/?ref=A1' });
  assert.equal(same.changed, false);
  assert.equal(same.audit.detail.noop, true);
  const cleared = updateOutboundLink(doc(), { path: '/outbound/alpha', note: '' });
  assert.equal('note' in cleared.next.links[0], false, 'an empty note clears the field rather than writing ""');
  assert.throws(() => updateOutboundLink(doc(), { path: '/outbound/alpha', destination: 'https://broken.example.com?q=1' }), /explicit path/);
  // A refused edit leaves nothing behind: the thrown-away document must not be the caller's.
  const before = doc();
  try { updateOutboundLink(before, { path: '/outbound/alpha', destination: 'https://broken.example.com?q=1' }); } catch { /* expected */ }
  assert.equal(before.links[0].destination, 'https://alpha.example.com/?ref=A1');
});

test('sow-359: A RETIRE KEEPS ANSWERING, because an old post still links to it', () => {
  const { next, changed } = setOutboundLinkStatus(doc(), { path: '/legacy/beta', status: 'retired' }, actor);
  assert.equal(changed, true);
  assert.equal(next.links[1].status, 'retired');
  assert.equal(next.links.length, 2, 'retiring must not remove the row');
  // The load-bearing assertion: what actually serves still carries it, unchanged.
  assert.deepEqual(
    redirectRowsOf(next),
    [['/outbound/alpha', 'https://alpha.example.com/?ref=A1'], ['/legacy/beta', 'https://beta.example.com/go?id=7']],
    'a retired link must still emit its redirect',
  );
});

test('sow-359: status is idempotent, reversible, and closed to the three the store knows', () => {
  const retired = setOutboundLinkStatus(doc(), { path: '/legacy/beta', status: 'retired' }).next;
  assert.equal(setOutboundLinkStatus(retired, { path: '/legacy/beta', status: 'retired' }).changed, false);
  assert.equal(setOutboundLinkStatus(retired, { path: '/legacy/beta', status: 'live' }).next.links[1].status, 'live', 'a retire is reversible');
  for (const bad of ['deleted', '', null, undefined, 'LIVE']) {
    assert.throws(() => setOutboundLinkStatus(doc(), { path: '/legacy/beta', status: bad }),
      (e) => e instanceof OutboundLinkEditError && /status must be one of/.test(e.message), JSON.stringify(bad));
  }
  assert.deepEqual([...LINK_STATUSES], ['live', 'placeholder', 'retired']);
  assert.throws(() => setOutboundLinkStatus(doc(), { path: '/nope', status: 'live' }), /no tracked link at/);
});

test('sow-359: the module exposes no way to delete a row, deliberately', async () => {
  // Removing a row is what turns a live link in an old post into a 404. `retired` exists so a link can be
  // taken out of use while its redirect keeps answering, so there is no delete and adding one should have to
  // argue with this test first. Asserted over the real export list, so it fails if one appears.
  const mod = await import('../membership/outbound-link-edits.mjs');
  const names = Object.keys(mod);
  const deleters = names.filter((n) => /^(delete|remove|drop|purge|destroy)/i.test(n));
  assert.deepEqual(deleters, [], `the store gained a delete operation: ${deleters.join(', ')}`);
  // And the guard is pointed at something: the three operations it is meant to sit beside are all here.
  for (const n of ['addOutboundLink', 'updateOutboundLink', 'setOutboundLinkStatus']) {
    assert.equal(typeof mod[n], 'function', `${n} is missing, so this guard is reading the wrong module`);
  }
});
