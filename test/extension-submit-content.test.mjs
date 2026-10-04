// sow-396 (owner, 2026-09-24; placement A chosen 2026-10-02): "Submit content" in the extension. A member picks what
// to create: articles, projects and prompts open the website editor in a new tab, a share opens the extension's own
// share box. An account that cannot publish is told why, in the approved wording, and is never offered a button that
// would take money and change nothing. The design of record is the canvas "Extension Submit Content".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { submitDialogKind, submitDialogHtml, SUBMIT_CHOICES, HOW_PUBLISHING_URL } from '../extension/src/submit-content.mjs';
import { lockedAccountCopy } from '../client/src/membership.mjs';
import { parseWorkspaceNew } from '../client-ui/src/workspace-core.mjs';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const count = (s, re) => (s.match(re) || []).length;

test('each membership gets its own dialog', () => {
  assert.equal(submitDialogKind(null), 'loading', 'pressed before the membership check answered');
  assert.equal(submitDialogKind(undefined), 'loading');
  assert.equal(submitDialogKind({ membership: 'paid' }), 'choose');
  assert.equal(submitDialogKind({ membership: 'unknown' }), 'choose', 'a failed check shows the chooser; the website still decides');
  assert.equal(submitDialogKind({}), 'choose', 'a status without a membership is a failed check');
  assert.equal(submitDialogKind({ membership: 'none' }), 'join');
  assert.equal(submitDialogKind({ membership: 'trialing' }), 'join', 'the retired trial tier reads as a free account');
  assert.equal(submitDialogKind({ membership: 'expired' }), 'renew');
  assert.equal(submitDialogKind({ membership: 'cancelled' }), 'renew');
  assert.equal(submitDialogKind({ membership: 'banned' }), 'restricted');
  assert.equal(submitDialogKind({ membership: 'something-new' }), 'restricted', 'an unrecognised locked status offers no button');
});

test('the three website choices open the editor the WorkBench already knows how to start', () => {
  const byKey = Object.fromEntries(SUBMIT_CHOICES.map((c) => [c.key, c]));
  assert.deepEqual(SUBMIT_CHOICES.map((c) => c.title), ['Article', 'Project', 'Prompt & Skill', 'Share'], 'the canvas order');
  for (const type of ['post', 'project', 'prompt']) {
    const url = new URL(byKey[type].href);
    assert.equal(url.origin, 'https://gbti.network');
    assert.equal(url.pathname, '/workbench/');
    assert.equal(parseWorkspaceNew(url.hash), type, `${type} opens a blank ${type} editor`);
  }
  assert.equal(byKey.share.href, null, 'a share is posted from the extension, not the website');
});

test('the chooser: four choices, links that open a new tab, Share as a button, and the explainer link', () => {
  const html = submitDialogHtml('choose', 'paid');
  assert.match(html, /<h2 id="sc-title">What would you like to create\?<\/h2>/);
  for (const type of ['post', 'project', 'prompt']) {
    assert.match(html, new RegExp(`<a class="sc-choice" href="https://gbti\\.network/workbench/#new=${type}" target="_blank" rel="noopener" data-sc-choice="${type}">`));
  }
  assert.match(html, /<button class="sc-choice" type="button" data-sc-choice="share">/);
  assert.equal(count(html, /class="sc-choice"/g), 4);
  assert.equal(count(html, /Opens the website editor/g), 3);
  assert.equal(count(html, /Opens the share box here/g), 1);
  assert.ok(html.includes(`href="${HOW_PUBLISHING_URL}"`), 'How publishing works');
  assert.match(html, /role="dialog" aria-modal="true" aria-labelledby="sc-title"/);
  assert.match(html, /<button class="share-x" type="button" aria-label="Close" data-sc-close>/, 'the round close on the corner');
});

test('a free account: the approved wording, See what membership includes, and How publishing works', () => {
  const copy = lockedAccountCopy('none');
  const html = submitDialogHtml('join', 'none');
  assert.ok(html.includes(`<h2 id="sc-title">${escHtml(copy.heading)}</h2>`));
  assert.ok(html.includes(`<p class="sc-body">${escHtml(copy.body)}</p>`));
  assert.ok(html.includes(`<a class="sc-cta" href="${copy.cta.href}" target="_blank" rel="noopener">${escHtml(copy.cta.label)} `));
  assert.ok(html.includes(`href="${HOW_PUBLISHING_URL}"`));
  assert.equal(count(html, /class="sc-choice"/g), 0, 'no way to start publishing');
  assert.doesNotMatch(html, /class="sc-close"/);
  assert.equal(submitDialogHtml('join', 'trialing'), html, 'the retired trial tier is told the same');
});

test('a lapsed member: Renew, and no explainer, since they have published before', () => {
  const copy = lockedAccountCopy('expired');
  const html = submitDialogHtml('renew', 'expired');
  assert.ok(html.includes(escHtml(copy.heading)));
  assert.ok(html.includes(escHtml(copy.body)));
  assert.ok(html.includes(`${escHtml(copy.cta.label)} `));
  assert.ok(!html.includes(HOW_PUBLISHING_URL));
  assert.doesNotMatch(html, /class="sc-close"/);
});

test('a restricted account: no button that takes money, only Close', () => {
  const copy = lockedAccountCopy('banned');
  assert.equal(copy.cta, null, 'control: the approved copy offers nothing here');
  const html = submitDialogHtml('restricted', 'banned');
  assert.ok(html.includes(escHtml(copy.heading)));
  assert.doesNotMatch(html, /class="sc-cta"/);
  assert.doesNotMatch(html, /gbti\.network\/membership/);
  assert.ok(!html.includes(HOW_PUBLISHING_URL));
  assert.match(html, /<button class="sc-close" type="button" data-sc-close>Close<\/button>/);
});

test('the checking state: a placeholder that says what it is waiting for', () => {
  const html = submitDialogHtml('loading', undefined);
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /<p class="sc-checking" role="status">Checking your membership&hellip;<\/p>/);
  assert.equal(count(html, /class="sc-choice"/g), 0, 'nothing to pick until the answer lands');
});

test('the approved membership wording has one home: the dialog borrows it, it never keeps a copy', () => {
  const src = read('extension/src/submit-content.mjs');
  for (const m of ['none', 'expired', 'banned']) {
    const copy = lockedAccountCopy(m);
    for (const s of [copy.heading, copy.body]) assert.equal(src.includes(s), false, `submit-content.mjs repeats "${s.slice(0, 40)}..."`);
  }
  assert.match(src, /import \{ upgradePromptKind, lockedAccountCopy \} from '\.\.\/\.\.\/client\/src\/membership\.mjs';/);
});

test('every extension page gets the button at the very right of the controls, and Share hands over to the share box', () => {
  const shell = read('extension/src/shell.mjs');
  const controls = /function controlsHtml\([\s\S]*?\n\}/.exec(shell)?.[0] || '';
  assert.ok(controls, 'control: found controlsHtml');
  const btn = controls.indexOf('data-submit-content');
  // Owner, 2026-10-02: moved from beside the bell to the very right. The last control in the row: after the account
  // menu and after the "+" a compose page adds, with nothing but the row's closing tag behind it.
  assert.ok(btn > controls.indexOf('data-me-wrap') && btn > controls.indexOf('data-compose'), 'after the account menu and the "+"');
  assert.match(controls.slice(btn), /^data-submit-content[^\n]*<\/button>\n {2}<\/div>`;/, 'nothing after it in the row');
  assert.match(controls, /<button class="nt-submit" type="button" data-submit-content aria-haspopup="dialog" aria-label="Submit content">/);
  assert.match(controls, /<span class="nt-submit-tx">Submit content<\/span>/);
  assert.match(controls, /<span class="nt-submit-pen" data-ico="pencil" aria-hidden="true"><\/span>/, 'the folded form');
  const composeSwitch = /\$\{compose \?[\s\S]*?: ''\}/.exec(controls)?.[0] || '';
  assert.ok(composeSwitch.includes('data-compose'), 'control: found the compose switch');
  assert.ok(!composeSwitch.includes('data-submit-content'), 'not behind the compose switch: every page');
  assert.match(shell, /const statusReady = loadShellAccount\(root\);\n  wireSubmit\(root, statusReady\);/, 'wired on every page from the one status load');
  assert.match(shell, /openSubmitDialog\(\{ status, statusReady, onShare: openComposeModal, returnFocus: btn \}\)/);
});

test('the dialog closes before Share opens the share box, and lets a link open its tab first', () => {
  const src = read('extension/src/submit-content.mjs');
  assert.match(src, /if \(t\.matches\('\[data-sc-choice="share"\]'\)\) \{ close\(\); onShare\(\); return; \}/, 'the share box refuses to open over another dialog');
  assert.match(src, /setTimeout\(close, 0\); \/\/ a link: let it open its tab first/);
});

test('below 880px the button folds into the pencil (the full label wrapped the bar there), at the end of the stylesheet', () => {
  const css = read('extension/shell.css');
  const at = css.indexOf('/* ============================ sow-396');
  assert.ok(at > 0, 'control: found the block');
  const narrow = css.slice(at).match(/@media \(max-width: 880px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.match(narrow, /\.nt-submit-tx \{ display: none; \}/);
  assert.match(narrow, /\.nt-submit-pen \{ display: flex; \}/);
  // Owner, 2026-10-04: folded, it is round like the bell and theme buttons beside it; the full-label button stays square.
  assert.match(narrow, /\.nt-submit \{[^}]*border-radius: 50%;/, 'the folded pencil is round');
  // Owner, 2026-10-04: no green dot on the folded pencil (in its corner it read as a notification badge).
  assert.match(narrow, /\.nt-submit-dot \{ display: none; \}/, 'the folded pencil has no dot');
  assert.match(css.slice(at), /\n\.nt-submit-dot \{[^}]*background: var\(--green\);/, 'control: the full label keeps its dot');
  assert.match(css, /\.nt-icobtn \{[^}]*border-radius: 50%;/, 'control: the icon buttons it matches are round');
  assert.match(css.slice(at), /\n\.nt-submit \{[^}]*border-radius: 2px;/, 'the full-label button keeps its square corners');
  assert.match(css.slice(at).match(/@media \(max-width: 560px\) \{([\s\S]*?)\n\}/)?.[1] || '', /\.nt-submit \{ width: 36px; height: 36px; \}/, 'phone size matches the icon buttons');
  assert.match(css.slice(at), /\.nt-submit-pen \{ display: none; \}/, 'the pencil is hidden at full width');
  assert.match(css.slice(at), /\.submit-modal \.sc-dialog \{[^}]*border-radius: 2px;/, 'square corners like the share dialog');
});
