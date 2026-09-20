// sow-270 Phase 4: the double opt-in confirmation email.
//
// This is the message that decides whether any other message is ever sent, and until now it was the only one
// that skipped every template we have. The tests below are about the two things that make it work at all: the
// link has to be present and safe in both alternatives, and the promise it makes about the window has to match
// the record that actually expires.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderConfirmationEmail, CONFIRM_WINDOW_HOURS } from '../membership/mail-transactional-render.mjs';
import { OPTIN_TTL_SECONDS } from '../membership/mail-optin.mjs';

const URL_OK = 'https://signup.gbti.network/mail/confirm?h=abc123&t=nonce456';

test('the confirm link reaches BOTH alternatives, because a text-only reader has to be able to confirm', () => {
  const r = renderConfirmationEmail({ confirmUrl: URL_OK });
  assert.ok(r, 'a good url must render');
  assert.ok(r.html.includes(URL_OK.replace(/&/g, '&amp;')), 'the html must carry the link, escaped');
  assert.ok(r.text.includes(URL_OK), 'the text alternative must carry the link verbatim');
  // On its own line and unwrapped: a url broken across two lines is a url nobody can click or paste.
  assert.ok(r.text.split('\n').some((l) => l.trim() === URL_OK), 'the url must stand on its own line in the text part');
  // It appears as the button AND as pasteable text, because a mail client that strips the button leaves nothing.
  assert.ok((r.html.match(/href="https:\/\/signup\.gbti\.network/g) || []).length >= 2,
    'the link must be both the button and the pasteable address');
});

test('a url the renderer cannot vouch for produces NO email rather than a broken one', () => {
  for (const bad of [undefined, null, '', '   ', 'javascript:alert(1)', 'data:text/html,<script>', 'vbscript:x']) {
    assert.equal(renderConfirmationEmail({ confirmUrl: bad }), null,
      `${JSON.stringify(bad)} must not produce a message: its entire purpose is a link it would not have`);
  }
});

test('a hostile url cannot break out of the attribute or the anchor', () => {
  const r = renderConfirmationEmail({ confirmUrl: 'https://gbti.network/mail/confirm?h="><script>alert(1)</script>' });
  if (r) {
    assert.doesNotMatch(r.html, /<script/i, 'no script tag may survive into the body');
    // Read the href VALUE, not the surrounding markup. The first version of this check looked for the string
    // `"><` anywhere in the document and failed on `style="padding-top:18px"><a`, which is ordinary markup: the
    // instrument was wrong, not the subject.
    for (const m of r.html.matchAll(/href="([^"]*)"/g)) {
      assert.doesNotMatch(m[1], /[<>]/, 'an href value must carry no raw angle bracket');
    }
    assert.ok(!r.html.includes('<script>alert(1)</script>'), 'the payload must not survive verbatim');
  }
});

test('the stated window is the window that actually expires', () => {
  assert.equal(CONFIRM_WINDOW_HOURS * 3600, OPTIN_TTL_SECONDS,
    'the body promises a window; if the record expires sooner the promise is a lie');
  const r = renderConfirmationEmail({ confirmUrl: URL_OK });
  assert.ok(r.html.includes(`${CONFIRM_WINDOW_HOURS} hours`));
  assert.ok(r.text.includes(`${CONFIRM_WINDOW_HOURS} hours`));
});

test('there is no unsubscribe link, because nothing is subscribed yet', () => {
  const r = renderConfirmationEmail({ confirmUrl: URL_OK });
  assert.doesNotMatch(r.html, /unsubscribe/i,
    'an unsubscribe here would offer to cancel a subscription that does not exist, and would suppress an address that never consented');
  assert.doesNotMatch(r.text, /unsubscribe/i);
  // Doing nothing is the opt-out, and the body has to SAY so or the reader cannot know it.
  assert.match(r.text, /ignore this email/);
  assert.match(r.html, /ignore this email/);
});

test('no street address is rendered, defaulted or otherwise', () => {
  const r = renderConfirmationEmail({ confirmUrl: URL_OK });
  assert.doesNotMatch(r.html, /\b\d{2,6}\s+[A-Z][a-z]+\s+(Street|St|Road|Rd|Avenue|Ave|Drive|Dr|Lane|Ln)\b/);
});

test('the shipped copy follows the house rules on dashes and contractions', () => {
  const r = renderConfirmationEmail({ confirmUrl: URL_OK });
  for (const [what, s] of [['html', r.html], ['text', r.text], ['subject', r.subject]]) {
    assert.ok(!s.includes('—'), `an em dash reached the ${what}`);
    assert.ok(!s.includes('–'), `an en dash reached the ${what}`);
    assert.doesNotMatch(s, /\b(don't|doesn't|didn't|you're|we're|it's|can't|won't|isn't|that's)\b/i,
      `a contraction reached the ${what}`);
  }
});

test('it stays a lean shell of its own and does not reach into the digest renderer', () => {
  const src = fs.readFileSync(fileURLToPath(new URL('../membership/mail-transactional-render.mjs', import.meta.url)), 'utf8');
  // The one permitted import is the escaping, which IS the guard. Importing the issue renderer or its palette
  // would be the hoist that mail-notify-render.mjs records as forbidden.
  const imports = [...src.matchAll(/^import .*?from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['./mail-render.mjs'], 'exactly one import, and it is the escaping module');
  assert.match(src, /import \{ escapeHtml, safeUrl \}/, 'and it takes only the escaping from it');
  // Comments stripped first. The header of that module NAMES renderIssue and PALETTES while explaining why it
  // does not call them, so a raw scan matches the explanation and reports a coupling that is not there.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  assert.ok(code.includes('escapeHtml'), 'the comment stripper must leave the code behind');
  assert.doesNotMatch(code, /renderIssue|PALETTES/, 'the issue renderer and its palette structure stay untouched');
});
