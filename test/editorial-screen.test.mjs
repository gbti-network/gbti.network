// sow-323 Phase 4: THE QUEUE ON SCREEN. What a superadmin sees and is asked, where the control appears, and
// what the author is told in the WorkBench.
//
// The view logic lives in client-ui/src/editorial-queue-view.mjs rather than inside the element, for the reason
// share-post-core.mjs records: a decision inside a component is unreachable from `node --test`, so the rules
// that matter most end up being the only ones nobody checks. The element, the pages and the tabs are read from
// source, because what is being asserted about them is that the wiring EXISTS, and a missing hop renders a
// dead control rather than a failure anything reports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  typeLabel, rowDecidable, waitedFor, rowSummary, decidePrompt, decidedMessage, queueSummary,
} from '../client-ui/src/editorial-queue-view.mjs';
import { audienceTag } from '../client-ui/src/workspace-core.mjs';
import { EDITORIAL_STATE } from '../membership/editorial-queue.mjs';

const ROOT = new URL('../', import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
const NOW = new Date('2026-09-15T12:00:00.000Z');
const row = (over = {}) => ({
  path: 'members/ada/posts/hello/index.md', type: 'post', slug: 'hello', login: 'ada', title: 'Hello',
  state: EDITORIAL_STATE.pending, requestedAt: '2026-09-13T12:00:00.000Z', ...over,
});

test('only a genuinely waiting row can be decided', () => {
  assert.equal(rowDecidable(row()), true);
  assert.equal(rowDecidable(row({ state: EDITORIAL_STATE.approved })), false);
  assert.equal(rowDecidable(row({ state: EDITORIAL_STATE.dismissed })), false, 'setting aside twice decides nothing');
  // A corrupt row is SHOWN and not decidable. Approving one would publish whatever identity the broken record
  // happens to carry, and the Worker refuses it too, so this is the second of two rather than the only one.
  assert.equal(rowDecidable(row({ corrupt: true })), false);
  assert.equal(rowDecidable(row({ state: EDITORIAL_STATE.unknown })), false);
  assert.equal(rowDecidable(null), false);
});

test('a row says what it is, who wrote it and how long it has waited', () => {
  assert.equal(rowSummary(row(), NOW), 'Article by ada, published 2 days ago');
  assert.equal(rowSummary(row({ type: 'project', requestedAt: NOW.toISOString() }), NOW), 'Project by ada, published today');
  assert.equal(rowSummary(row({ login: '' }), NOW), 'Article by an unknown member, published 2 days ago');
  // A REVISION is not a new submission, and a screen that reads the same for both invites the same decision
  // twice: the superadmin already set this one aside once.
  assert.match(rowSummary(row({ editedSinceDecision: true }), NOW), /revised since you set it aside/);
  assert.doesNotMatch(rowSummary(row(), NOW), /revised/);
});

test('waiting time degrades to nothing rather than to a wrong number', () => {
  assert.equal(waitedFor(row({ requestedAt: '2026-09-14T12:00:00.000Z' }), NOW), 'yesterday');
  assert.equal(waitedFor(row({ requestedAt: 'not a date' }), NOW), '', 'an unreadable date says nothing at all');
  assert.equal(waitedFor(row({ requestedAt: undefined }), NOW), '');
  assert.equal(waitedFor(row({ requestedAt: '2026-09-16T12:00:00.000Z' }), NOW), 'just now', 'a future stamp is never "-1 days ago"');
});

test('the two confirmations say DIFFERENT things, because the two decisions are not symmetrical', () => {
  const approve = decidePrompt(row(), 'approve');
  const aside = decidePrompt(row(), 'dismiss');
  assert.match(approve, /"Hello"/);
  assert.match(approve, /public site/);
  assert.match(approve, /author is told/, 'approving emails the author, and a superadmin should know that');
  assert.match(aside, /stays members-only/);
  assert.match(aside, /not told/, 'a superadmin who believes a dismissal notifies the author will avoid using it');
  assert.notEqual(approve, aside);
  assert.match(decidePrompt({}, 'approve'), /this item/, 'a missing title degrades to a noun, never to ""');
});

test('the message after a decision matches what actually happened', () => {
  assert.match(decidedMessage(row(), 'approve'), /within a few minutes/, 'the deploy is not instant');
  assert.match(decidedMessage(row(), 'dismiss'), /stays members-only/);
  assert.doesNotMatch(decidedMessage(row(), 'dismiss'), /told|email/i, 'nothing is sent, so nothing may say it was');
});

test('the heading counts what is WAITING, not how many rows there are', () => {
  const rows = [row(), row({ state: EDITORIAL_STATE.approved }), row({ state: EDITORIAL_STATE.dismissed })];
  assert.match(queueSummary(rows), /1 item is waiting/);
  assert.match(queueSummary([row(), row()]), /2 items are waiting/);
  assert.match(queueSummary([row({ state: EDITORIAL_STATE.approved })]), /Nothing is waiting for a decision/);
  assert.match(queueSummary([]), /Nothing is waiting\./);
  // A malformed record is counted separately: it is not work anyone can do, and hiding it in the waiting
  // count would mean a queue that never empties with nothing to explain why.
  assert.match(queueSummary([row(), row({ corrupt: true })]), /1 item is waiting.*One record is malformed/);
});

test('typeLabel covers the retired products folder through its type', () => {
  assert.equal(typeLabel('post'), 'Article');
  assert.equal(typeLabel('project'), 'Project');
  assert.equal(typeLabel('prompt'), 'Prompt');
  assert.equal(typeLabel('share'), 'Item', 'an unexpected type reads as something, never as "undefined"');
});

test('the manager waits to be asked again after a failed load', () => {
  // sow-334: retrying from render() on "not loaded yet" is what made the Channels manager fire 500 reads in
  // two seconds against a failing route. The driven guard (check:load-retry) covers this element automatically
  // because its census reads both admin pages; this is the source-level half.
  const src = read('client-ui/src/elements/gbti-editorial-manager.mjs');
  assert.match(src, /this\._failed = true;/, 'a failure must be recorded as a failure, not as "not loaded"');
  assert.match(src, /data-retry-load/, 'and it must offer Try again rather than retrying on its own');
  const render = src.slice(src.indexOf('  render() {'), src.indexOf('  _rowHtml('));
  assert.ok(render.indexOf('this._failed') < render.indexOf('if (!this._items)'),
    'the failure branch must come FIRST, or a failed load falls into the loading branch and loops');
});

test('the queue is mounted on both admin pages and gated to superadmin on both', () => {
  // The retired applications tab was superadmin on the website and ungated in the extension, so an extension
  // admin saw a lane whose every request the Worker refused. Its replacement must not inherit that.
  const web = read('src/pages/admin.astro');
  assert.match(web, /<gbti-editorial-manager>/, 'the website admin page does not mount the queue');
  assert.match(web, /data-tab="editorial" data-min="superadmin"/, 'the website tab is not superadmin-gated');
  assert.match(web, /gbti-editorial-manager\.mjs/, 'the element module is never imported, so the tag stays inert');

  const ext = read('extension/admin.html');
  assert.match(ext, /<gbti-editorial-manager>/, 'the extension admin does not mount the queue');
  assert.match(ext, /data-tab="editorial" data-min="superadmin"/, 'the extension tab is not superadmin-gated');
  // Read the GATING FUNCTION's own body, not the file: `shouldGateTab` and `.remove()` both still appear in a
  // file whose loop skips every element, which is the difference between a gate and a gate-shaped comment.
  const admin = read('extension/src/admin.mjs');
  const fn = /function gateAdminTabs\(status\) \{([\s\S]*?)\n\}/.exec(admin);
  assert.ok(fn, 'gateAdminTabs was not found: this check is broken, not the subject');
  assert.match(fn[1], /if \(!shouldGateTab\(status, el\.getAttribute\('data-min'\)\)\) continue;/,
    'the loop must decide per element through shouldGateTab, or data-min does nothing');
  assert.match(fn[1], /\.remove\(\)/, 'a gated panel must be REMOVED: a hidden one still loads and takes the 403');
  assert.match(fn[1], /data-panel="\$\{name\}"/, 'removing the tab without its panel leaves the section loading unseen');
});

test('the per-tab gate denies anything it does not recognise', async () => {
  const { shouldGateTab } = await import('../extension/src/shell.mjs');
  const sup = { authenticated: true, identity: { login: 'root' }, role: 'superadmin' };
  const adm = { authenticated: true, identity: { login: 'a' }, role: 'admin' };
  assert.equal(shouldGateTab(sup, 'superadmin'), false);
  assert.equal(shouldGateTab(adm, 'superadmin'), true, 'an admin must not see a superadmin lane');
  assert.equal(shouldGateTab(adm, 'admin'), false, 'and must keep the tabs that are theirs');
  assert.equal(shouldGateTab(sup, 'wizard'), true, 'a floor this build does not know denies, like every other lookup here');
  assert.equal(shouldGateTab({ authenticated: false }, 'superadmin'), true);
  // The page-wide staff gate still runs FIRST. Without it a SIGNED-OUT status carrying a role string would
  // clear its own floor by rank alone, which is how a gate that only compares numbers admits a stranger.
  assert.equal(shouldGateTab({ authenticated: false, role: 'superadmin' }, 'superadmin'), true);
  assert.equal(shouldGateTab({ authenticated: true, role: 'superadmin' }, 'superadmin'), true, 'no identity, no tab');
  assert.equal(shouldGateTab(adm, null), false, 'no floor means the page-wide staff gate, which an admin clears');
});

test('the item page carries an approval control on all three content types', () => {
  for (const [file, type] of [
    ['src/components/blog/ArticleEditorial.astro', 'post'],
    ['src/pages/projects/[slug].astro', 'project'],
    ['src/pages/prompts/[slug].astro', 'prompt'],
  ]) {
    const src = read(file);
    assert.match(src, /ApprovePill/, `${file}: no approval control beside the Edit pill`);
    assert.ok(src.includes(`type="${type}"`), `${file}: the control is not told which content type this is`);
    assert.match(src, /visibility=\{d\.visibility\}/, `${file}: the control cannot tell a members-only item from a public one`);
  }
  const pill = read('src/components/ApprovePill.astro');
  assert.match(pill, /visibility === 'members'/, 'an already-public item has nothing left to approve');
  assert.match(pill, /role === 'superadmin'/, 'the control must be superadmin only');
  assert.match(pill, /gbti_csrf/, 'an extension-only signal carries no web session and cannot make this call');
  assert.match(pill, /within a few minutes/, 'the page is static, so it does not turn public in front of the reader');
});

// ---- the author side ---------------------------------------------------------------------------------------

test('the WorkBench tells the author about APPROVALS, and nothing about a dismissal', () => {
  const pending = audienceTag({ status: 'published', visibility: 'members' });
  const approved = audienceTag({ status: 'published', visibility: 'public' });
  assert.match(pending.label, /in review/);
  assert.match(pending.title, /emailed if it goes public/);
  assert.equal(approved.label, 'public', 'an approved item reads as public, which is how the author is told here');
  // A SET-ASIDE item is a published members-only item, exactly like one nobody has read yet. Saying anything
  // else here would be a decline notice by implication, and the owner ruled there is none (2026-09-15).
  assert.deepEqual(audienceTag({ status: 'published', visibility: 'members', state: 'dismissed' }), pending);
  assert.equal(audienceTag({ status: 'draft', visibility: 'members' }), null, 'nothing is in review until it is published');
  assert.equal(audienceTag(null), null);
});

test('no surface promises the author a message that is never sent', () => {
  // The old copy said an author would be "told either way" and that a decline "comes with a note". There is no
  // decline email: a superadmin sets something aside silently. Promising a message nobody sends leaves an
  // author waiting for one, and reading its absence as the review never having happened.
  for (const file of [
    'src/pages/submit-content/index.astro',
    'client-ui/src/workspace-core.mjs',
    'client-ui/src/one-click-public-core.mjs',
  ]) {
    const code = read(file).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/told either way|comes with a note|decline comes with/.test(code), `${file} still promises a decline notice`);
  }
  const submit = read('src/pages/submit-content/index.astro');
  assert.match(submit, /email saying so/, 'it must still say what the author DOES get');
  assert.match(submit, /stays exactly where it is|stays published for members/, 'and what happens to a piece that is not taken');
});
