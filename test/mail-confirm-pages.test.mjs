// sow-270 Phases 6 and 7: the two pages at the end of the double opt-in journey.
//
// Phase 6 is the FULL STOP page a reader lands on after confirming, built to the reference the owner supplied
// on 2026-08-23: mark alone above a tinted panel, one large icon in the brand colour, a warm oversized
// headline, then lines that do real work rather than confirming twice.
//
// Phase 7 is ONE CLICK: following the link from the email is the whole of it. The page submits itself, and the
// button is the fallback for a reader with no scripting.
//
// WHAT THE GUARD IS AND IS NOT. The GET still mutates nothing. The activation is the POST, and a script in a
// real browser issues it, so a mail client prefetching the link cannot confirm on the reader's behalf. A
// scripted scanner still could, which narrows the hole rather than closing it (owner decision, 2026-09-20).
// The test below proves the first half by driving a GET and asserting the store is untouched.

import test from 'node:test';
import assert from 'node:assert/strict';
import { handleConfirm } from '../workers/signup/mail-subscribe.mjs';
import { optinKey, buildPendingOptIn } from '../membership/mail-optin.mjs';
import { panelPage } from '../workers/signup/mail-pages.mjs';

const HASH = 'a'.repeat(64);
const NONCE = 'testnonce_abc123';

function kvWithPending() {
  const store = new Map([[optinKey(HASH), JSON.stringify(
    buildPendingOptIn({ hash: HASH, emailEnc: JSON.stringify({ v: 1, ct: 'x' }), nonce: NONCE }, { now: () => Date.now() }),
  )]]);
  return {
    store,
    // The real binding takes a type argument, and a fake that ignores it silently returns a string where the
    // caller expects an object. That cost a debugging round when this file was written.
    get: async (k, type) => { const v = store.get(k); if (v == null) return null; return type === 'json' ? JSON.parse(v) : v; },
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  };
}

const confirmUrl = `https://signup.gbti.network/mail/confirm?h=${HASH}&t=${NONCE}`;
const getPage = async (kv) => (await handleConfirm(new Request(confirmUrl, { method: 'GET' }), {}, { kv })).text();

test('the confirm page posts back to its own address, so the nonce rides the POST', async () => {
  const html = await getPage(kvWithPending());
  const action = /action="([^"]+)"/.exec(html)?.[1];
  assert.ok(action, 'the page must carry a form');
  assert.ok(action.includes(HASH), 'the hash must be in the action');
  assert.ok(action.includes(NONCE), 'and so must the nonce, or the POST cannot authorize itself');
  assert.match(html, /method="POST"/);
});

test('it submits itself, and arms the fallback BEFORE it tries', async () => {
  const html = await getPage(kvWithPending());
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1];
  assert.ok(script, 'no script means no one click');
  assert.ok(script.includes('.submit()'), 'the form must submit itself');
  // Order is the whole point. A reader who can neither confirm nor see a button has no way forward, so the
  // timer that reveals the button has to be set before anything that might throw.
  //
  // PRESENCE IS ASSERTED FIRST, and that is not ceremony: an ordering check on indexOf PASSES when the thing
  // is missing, because indexOf returns -1 and -1 is less than any real position. Deleting the timer outright
  // left this test green until the assertion below was added, which a mutation run caught.
  const at = script.indexOf('setTimeout');
  assert.ok(at >= 0, 'the reveal timer must exist at all');
  assert.ok(at < script.indexOf('.submit()'), 'the reveal timer must be armed before the submit is attempted');
  assert.match(script, /catch/, 'and a throwing submit must reveal the button too');
});

test('the button is hidden by default and revealed when scripting is off', async () => {
  const html = await getPage(kvWithPending());
  assert.match(html, /<form id="cf"[^>]*style="display:none"/, 'hidden by default, or every reader sees it flash');
  assert.match(html, /<noscript><style>#cf\{display:block!important\}<\/style><\/noscript>/,
    'the no-script reveal must beat the inline style, which needs !important');
});

test('the copy on that page is true whether or not the button is used', async () => {
  const html = await getPage(kvWithPending());
  // The first version said "one moment while we add this address" above a button that had to be pressed.
  assert.doesNotMatch(html, /One moment while we add/,
    'a no-script reader must not be told something is happening while nothing is');
  assert.match(html, /<h1>Confirm your subscription<\/h1>/, 'a heading that holds in both states');
  // The sentence that assumes a press lives inside the block that only appears when there is a press to make.
  const form = /<form id="cf"[\s\S]*?<\/form>/.exec(html)[0];
  assert.match(form, /Press the button/);
});

test('a GET mutates nothing, which is what stops a prefetch confirming for the reader', async () => {
  const kv = kvWithPending();
  const before = new Map(kv.store);
  await getPage(kv);
  await getPage(kv);
  assert.deepEqual([...kv.store.entries()], [...before.entries()], 'the store must be untouched after two GETs');
  assert.ok(![...kv.store.keys()].some((k) => k.startsWith('mail:subscriber:')), 'and no subscriber may exist yet');
});

test('the POST is what activates, and it lands on the full stop page', async () => {
  const kv = kvWithPending();
  const res = await handleConfirm(new Request(confirmUrl, { method: 'POST' }), {}, { kv, sendAdminAlert: async () => true });
  const html = await res.text();
  assert.equal(res.status, 200);
  assert.match(html, /Thank you, and welcome/);
  assert.ok([...kv.store.keys()].some((k) => k.startsWith('mail:subscriber:')), 'the subscriber must now exist');
  assert.ok(!kv.store.has(optinKey(HASH)), 'and the pending record must be gone');
});

test('the full stop page tells the reader the two things it is for', async () => {
  const kv = kvWithPending();
  const html = await (await handleConfirm(new Request(confirmUrl, { method: 'POST' }), {}, { kv, sendAdminAlert: async () => true })).text();
  // When it comes, and what to do when it does not appear. Without these it merely confirms twice.
  assert.match(html, /Tuesday mornings/);
  assert.match(html, /spam folder/);
});

test('the panel page is an ending: no navigation, no footer, no links out', () => {
  const html = panelPage('t', { heading: 'Thank you, and welcome', lines: ['One.', 'Two.'] });
  assert.doesNotMatch(html, /<a\s/i, 'a link here is an invitation to leave before reading the lines that matter');
  assert.doesNotMatch(html, /<nav|<footer/i);
  assert.match(html, /GBTI <span>Network<\/span>/, 'the mark sits above the panel');
  assert.match(html, /<svg/, 'and one icon inside it');
});

test('the panel escapes what it is given, since a heading is still interpolated', () => {
  const html = panelPage('t', { heading: '<script>alert(1)</script>', lines: ['<img onerror=x>'] });
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img onerror/);
});
