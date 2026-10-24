// sow-477 (owner, 2026-10-24): "When we change the author and then try and save the article again we get uploaded
// image issues." The banner read "the image crystal-ball.webp is no longer staged; choose it again before publishing".
//
// A change of author (or of permalink) moves the item and its pictures to a new folder, and the move takes about 25
// seconds to land on main. Every publish works out its file set against main, so a second publish inside that window
// found neither the item nor its picture at the new path and refused. Reproduced with the website's real publish code
// against a fake network: the second save fails before the move lands and succeeds after it.
//
// The refusal was also the only thing protecting the site: the Worker rebuilds an open publish's branch from main
// using the newest request alone (hosted-commit.mjs), so a second save that got through would undo the move and leave
// two copies. The fix is therefore a WAIT in the editor, never a looser check in publish.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { landingPath, waitForLanding, LANDING_INTERVAL_MS, LANDING_LIMIT_MS } from '../client-ui/src/editor-core.mjs';
import { followPublishedItem } from '../client-ui/src/workspace-core.mjs';

const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const A = 'members/atwellpub/posts/crystal-ball-for-the-next-digital-agency/index.md';
const G = 'members/gbtilabs/posts/crystal-ball-for-the-next-digital-agency/index.md';
const notFound = () => Object.assign(new Error('could not load that item'), { code: 'not-found' });

// ---------------------------------------------------------------- landingPath

test('landingPath names the new path after a change of author or of permalink, and nothing otherwise', () => {
  assert.equal(landingPath({ path: A, reassigned: { from: { username: 'gbtilabs' }, to: { username: 'atwellpub' } } }), A);
  assert.equal(landingPath({ path: A, renamed: { from: 'old', to: 'crystal-ball-for-the-next-digital-agency' } }), A);
  assert.equal(landingPath({ path: A }), null, 'a plain edit moved nothing, so the next publish must not wait');
  assert.equal(landingPath({ reassigned: {} }), null, 'a move with no path to wait on');
  assert.equal(landingPath(null), null);
});

// ---------------------------------------------------------------- waitForLanding

function harness(answers) {
  const reads = [];
  const sleeps = [];
  const read = async (path) => {
    reads.push(path);
    const a = answers.length > 1 ? answers.shift() : answers[0];
    if (a instanceof Error) throw a;
    return a;
  };
  const sleep = async (ms) => { sleeps.push(ms); };
  return { read, sleep, reads, sleeps };
}

test('an item already at its new path is landed at once, with no wait', async () => {
  const h = harness([{ path: A }]);
  assert.equal(await waitForLanding({ read: h.read, path: A, sleep: h.sleep }), 'landed');
  assert.deepEqual(h.reads, [A]);
  assert.deepEqual(h.sleeps, []);
});

test('two not-found reads, then the item: landed after two waits', async () => {
  const h = harness([notFound(), notFound(), { path: A }]);
  assert.equal(await waitForLanding({ read: h.read, path: A, sleep: h.sleep, intervalMs: 3000, limitMs: 90000 }), 'landed');
  assert.equal(h.reads.length, 3);
  assert.deepEqual(h.sleeps, [3000, 3000]);
});

test('a read that answers nothing counts as not landed yet, not as landed', async () => {
  const h = harness([null, { path: A }]);
  assert.equal(await waitForLanding({ read: h.read, path: A, sleep: h.sleep }), 'landed');
  assert.equal(h.reads.length, 2);
});

test('still not found at the limit: a timeout, and no read past the limit', async () => {
  const h = harness([notFound()]);
  assert.equal(await waitForLanding({ read: h.read, path: A, sleep: h.sleep, intervalMs: 3000, limitMs: 9000 }), 'timeout');
  assert.equal(h.reads.length, 4, 'reads at 0, 3, 6 and 9 seconds');
  assert.equal(h.sleeps.reduce((a, b) => a + b, 0), 9000, 'the waits add up to the limit and no more');
});

test('any other read failure stops the wait at once, so the publish reports the real problem', async () => {
  const h = harness([Object.assign(new Error('locked'), { code: 'locked' })]);
  assert.equal(await waitForLanding({ read: h.read, path: A, sleep: h.sleep }), 'unknown');
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.sleeps, []);
});

test('the defaults cover the measured landing time with room to spare', () => {
  assert.equal(LANDING_INTERVAL_MS, 3000);
  assert.equal(LANDING_LIMIT_MS, 90000, 'the move measured 23 to 27 seconds from open to merge');
});

// ---------------------------------------------------------------- followPublishedItem

test('followPublishedItem takes the new path, drops the used author move and the staged flag', () => {
  const editing = { type: 'post', path: G, staged: true, authorTarget: { scope: 'member', username: 'atwellpub' }, frontmatter: { title: 't' } };
  const next = followPublishedItem(editing, { path: A, reassigned: {} });
  assert.deepEqual(next, { type: 'post', path: A, staged: false, authorTarget: null, frontmatter: { title: 't' } });
  assert.equal(editing.path, G, 'the input is not changed');
  assert.equal(editing.staged, true);
  assert.deepEqual(editing.authorTarget, { scope: 'member', username: 'atwellpub' });
});

test('followPublishedItem keeps the path when the publish returned none, or the same one', () => {
  const editing = { type: 'post', path: A, staged: false, authorTarget: null };
  assert.equal(followPublishedItem(editing, {}).path, A);
  assert.equal(followPublishedItem(editing, null).path, A);
  assert.equal(followPublishedItem(editing, { path: A }).path, A);
  assert.equal(followPublishedItem(null, { path: A }), null, 'no editing state, nothing to follow');
});

// ---------------------------------------------------------------- the wiring

const doPublish = () => {
  const s = src('client-ui/src/elements/editor-actions.mjs');
  const at = s.indexOf('async doPublish()');
  return s.slice(at, s.indexOf('} catch (err) {', at));
};

test('publish waits for a landing move BEFORE it calls client.publish, and a timeout publishes nothing', () => {
  const pub = doPublish();
  const wait = pub.indexOf('await waitForLanding({ read: (path) => this.client.getContentItem({ path }), path: this._landingPath })');
  const call = pub.indexOf('await this.client.publish(');
  assert.ok(wait > 0, 'the editor no longer waits for its own move to land');
  assert.ok(call > wait, 'the wait must come before the publish call, or it protects nothing');
  assert.match(pub, /if \(landed === 'timeout'\) \{[\s\S]{0,400}?return;\s*\}/, 'a timeout must stop without publishing');
  assert.match(pub, /if \(this\._landingPath\) \{/, 'the wait runs only when a move is landing');
});

test('a successful publish records the move it made and refreshes the ID readout', () => {
  const pub = doPublish();
  const record = pub.indexOf('this._landingPath = landingPath(res);');
  const emit = pub.indexOf("this.emit('gbti-published', res);");
  assert.ok(record > 0 && emit > record, 'the move must be recorded before the event, on the success path');
  assert.match(pub, /if \(res\?\.path\) \{ const id = this\.\$\('#mcpid'\); if \(id\) id\.textContent = res\.path; \}/,
    'the readout kept showing the old folder after a move, which is what the owner\'s screenshot showed');
});

test('loading another item forgets a move that belongs to the previous one', () => {
  const s = src('client-ui/src/elements/gbti-content-editor.mjs');
  const load = s.slice(s.indexOf('  load(type, input, body, path,'), s.indexOf('  load(type, input, body, path,') + 3000);
  assert.match(load, /if \(this\._landingPath !== path\) this\._landingPath = null;/);
});

test('the WorkBench follows the item and points the page address at its new path', () => {
  const s = src('client-ui/src/elements/gbti-workspace.mjs');
  const at = s.indexOf("addEventListener('gbti-published'");
  const block = s.slice(at, s.indexOf('\n      });', at));
  const follow = block.indexOf('this._editing = followPublishedItem(this._editing, ev?.detail);');
  const hash = block.indexOf('this._writeHash(`#tab=${encodeURIComponent(this._tab)}&edit=${encodeURIComponent(this._editing.path)}`)');
  const refresh = block.indexOf('this._onPublished(e.type);');
  assert.ok(follow > 0, 'the editing state no longer follows the published item');
  assert.ok(hash > follow, 'the page address must name the new path, or a reload opens the old one and fails');
  assert.match(block, /this\._editing\.path !== before\) this\._writeHash/, 'the address is rewritten only when the path changed');
  assert.ok(refresh > hash, 'the refresh still runs after the state is updated');
});

test('the retired rename listener stays retired: the publish listener is the one place the item is followed', () => {
  // Nothing emits 'gbti-renamed'. A listener for it is dead code that reads as if renames were handled elsewhere.
  assert.ok(!src('client-ui/src/elements/gbti-workspace.mjs').includes("addEventListener?.('gbti-renamed'"));
});
