// sow-359: the pure half of the superadmin's tracked-link board, and a drift check that the element uses it.
//
// The board is a shadow-DOM element, so its logic is only testable in Node if it stays out of the element.
// These are the decisions worth pinning: what the form refuses to send, what a save sends (only what changed),
// and what the superadmin is told afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  suggestPath, draftFromLink, addPayload, updatePayload, statusPayload, savedMessage, applyLocally,
  LINK_STATUSES, STATUS_LABELS, cardClicksLine, windowFor, WINDOWS,
} from '../client-ui/src/outbound-manager-core.mjs';

const link = () => ({ path: '/outbound/acme', destination: 'https://acme.example.com/?ref=A1', partner: 'acme', note: 'why acme', status: 'live' });
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('sow-359: a partner label suggests a path, and anything unusable suggests nothing', () => {
  assert.equal(suggestPath('acme'), '/outbound/acme');
  assert.equal(suggestPath('Acme Corp!'), '/outbound/acme-corp');
  assert.equal(suggestPath('  --Acme--  '), '/outbound/acme');
  for (const v of ['', '   ', '!!!', null, undefined, 42]) assert.equal(suggestPath(v), '', JSON.stringify(v));
});

test('sow-359: the add form refuses the obvious emptiness before a round trip', () => {
  assert.equal(addPayload({}).problem, 'A site path is needed, for example /outbound/acme.');
  assert.match(addPayload({ path: 'acme' }).problem, /must start with a slash/);
  assert.match(addPayload({ path: '/outbound/a' }).problem, /destination is needed/);
  assert.match(addPayload({ path: '/outbound/a', destination: 'https://a.example.com/x' }).problem, /partner label is needed/);
  const ok = addPayload({ path: ' /outbound/a ', destination: ' https://a.example.com/x ', partner: ' a ', note: ' n ' });
  assert.deepEqual(ok.payload, { path: '/outbound/a', destination: 'https://a.example.com/x', partner: 'a', note: 'n' }, 'values are trimmed');
  // A note is optional and is left out rather than sent empty.
  assert.equal('note' in addPayload({ path: '/outbound/a', destination: 'https://a.example.com/x', partner: 'a' }).payload, false);
  // What a destination may LOOK like is deliberately not decided here: the core owns that, and this must not
  // grow a second, weaker copy of the rule.
  assert.ok(addPayload({ path: '/outbound/a', destination: 'https://a.example.com?q=1', partner: 'a' }).payload, 'the shape rule belongs to the core, not the form');
});

test('sow-359: a save sends only what changed, so a no-op never becomes a pull request', () => {
  const l = link();
  assert.deepEqual(updatePayload(l, draftFromLink(l)), { noop: true });
  assert.deepEqual(updatePayload(l, { ...draftFromLink(l), destination: 'https://acme.example.com/new?ref=A1' }).payload,
    { path: '/outbound/acme', destination: 'https://acme.example.com/new?ref=A1' }, 'only the changed field travels');
  assert.deepEqual(updatePayload(l, { ...draftFromLink(l), note: '' }).payload, { path: '/outbound/acme', note: '' }, 'a note can be cleared');
  // The two fields a link cannot lose.
  assert.match(updatePayload(l, { ...draftFromLink(l), destination: '' }).problem, /destination cannot be emptied/i);
  assert.match(updatePayload(l, { ...draftFromLink(l), partner: '' }).problem, /partner label cannot be emptied/i);
  // The path is never sent as a change, only as the key, because a repoint keeps it.
  const p = updatePayload(l, { ...draftFromLink(l), path: '/outbound/renamed', partner: 'other' }).payload;
  assert.equal(p.path, '/outbound/acme', 'the board must not offer to rename a path');
});

test('sow-359: the status buttons are the three the store knows, and a no-op is a no-op', () => {
  assert.deepEqual([...LINK_STATUSES], ['live', 'placeholder', 'retired']);
  assert.deepEqual(Object.keys(STATUS_LABELS).sort(), ['live', 'placeholder', 'retired']);
  assert.deepEqual(statusPayload(link(), 'live'), { noop: true });
  assert.deepEqual(statusPayload(link(), 'retired').payload, { path: '/outbound/acme', status: 'retired' });
  assert.match(statusPayload(link(), 'deleted').problem, /Unknown status/);
  // There is no delete button, because removing a row 404s an old post's link.
  assert.equal(LINK_STATUSES.includes('deleted'), false);
});

test('sow-359: the superadmin is told the change is not live yet', () => {
  // Saying "saved" alone invites a refresh, which shows the OLD value (the board reads a build artifact) and
  // reads as a failure. The message has to name the deploy.
  const m = savedMessage('Link repointed', { prNumber: 12 });
  assert.match(m, /pull request #12/);
  assert.match(m, /next deploy/);
  assert.match(savedMessage('Link minted', null), /next deploy/, 'still says it when there is no PR number');
  assert.equal(/—|–/.test(m), false, 'house writing rules: no long dashes in shipped copy');
});

test('sow-359: the list updates optimistically, so the board shows what was just done', () => {
  const links = [link()];
  assert.equal(applyLocally(links, 'status', { path: '/outbound/acme', status: 'retired' })[0].status, 'retired');
  assert.equal(applyLocally(links, 'update', { path: '/outbound/acme', destination: 'https://x.example.com/y' })[0].destination, 'https://x.example.com/y');
  assert.equal(applyLocally(links, 'add', { path: '/outbound/new', destination: 'https://n.example.com/x', partner: 'n' }).length, 2);
  assert.equal(applyLocally(links, 'status', { path: '/outbound/unknown', status: 'retired' }).length, 1, 'an unknown path changes nothing');
  assert.equal(links[0].status, 'live', 'the caller list is never mutated');
});

test('sow-359: the element uses this core rather than carrying its own copy', () => {
  const el = read('client-ui/src/elements/gbti-outbound-link-manager.mjs');
  assert.match(el, /from '\.\.\/outbound-manager-core\.mjs'/, 'the element stopped importing the core');
  for (const fn of ['addPayload', 'updatePayload', 'statusPayload', 'savedMessage', 'applyLocally']) {
    assert.ok(el.includes(fn), `${fn} is imported but unused, or the element grew its own copy`);
  }
  // The board must not offer a delete: removing a row turns a live link in an old post into a 404.
  assert.equal(/data-delete|data-remove/.test(el), false, 'the board grew a delete control');
  // Write controls appear only with a client. The Worker re-checks superadmin, but a read-only host should not
  // render buttons that cannot work.
  assert.match(el, /_canWrite\(\)/);
  // A DEFECT FOUND BY DRIVING THE FORM, not by reading it. The suggested path was computed and SENT but the
  // field rendered empty, because state was updated without touching the input and re-rendering on a keystroke
  // would take the caret with it. So the suggestion must be written straight into the field.
  assert.match(el, /pathInput\.value = this\._new\.path/, 'the suggested path is no longer written into the field, so it is submitted unseen');
  assert.equal(/'partner'.*this\.render\(\)/.test(el), false, 'a re-render on a partner keystroke would steal the caret');
});

test('sow-359: a tracked CARD shows its clicks, and a day nobody measured is never a zero', () => {
  const now = new Date('2026-09-20T00:00:00Z');
  const clicks = {
    coverage: ['2026-09-19', '2026-09-18'],
    clicks: { '/outbound/acme': { '2026-09-19': { clicks: 4, crawlers: 1, other: 0 }, '2026-09-18': { clicks: 2, crawlers: 0, other: 1 } } },
  };
  assert.equal(cardClicksLine({ trackedPath: '/outbound/acme' }, clicks, now), '/outbound/acme · 6 clicks in 30 days, 28 of 30 days not measured');
  // A path with no rows inside a window that WAS measured is a real zero, and says so plainly.
  assert.match(cardClicksLine({ trackedPath: '/outbound/quiet' }, clicks, now), /0 clicks in 30 days/);
  // THE RULE THIS INHERITS: nothing measured at all is not "0 clicks". "0 clicks in 30 days" about a link
  // nobody counted is a false statement that reads exactly like a true one.
  assert.equal(cardClicksLine({ trackedPath: '/outbound/acme' }, { coverage: [], clicks: {} }, now), '/outbound/acme · not measured yet');
  // An untracked card gets no line at all rather than an empty or zeroed one.
  assert.equal(cardClicksLine({}, clicks, now), null);
  assert.equal(cardClicksLine({ trackedPath: '   ' }, clicks, now), null);
  assert.equal(cardClicksLine({ trackedPath: '/outbound/acme' }, null, now), '/outbound/acme · not measured yet', 'a missing artifact is not a zero either');
  assert.match(cardClicksLine({ trackedPath: '/outbound/acme' }, { coverage: ['2026-09-19'], clicks: { '/outbound/acme': { '2026-09-19': { clicks: 1 } } } }, now), /1 click in/, 'one click is singular');
});

test('sow-359: windowFor moved into the core and the element still re-exports it', async () => {
  // test/outbound-clicks.test.mjs imports these from the element, and that binding is worth keeping: it is
  // what proves the board's own window reduction, not a copy of it.
  assert.equal(typeof windowFor, 'function');
  assert.deepEqual([...WINDOWS], [7, 30]);
  const el = await import('../client-ui/src/elements/gbti-outbound-link-manager.mjs');
  assert.equal(el.windowFor, windowFor, 'the element re-exports the core function, not a second copy');
  assert.equal(el.WINDOWS, WINDOWS);
});
