// sow-385: the notification-settings pill markup and copy, pinned in node. The two settings surfaces are custom
// elements that need a browser (verified there, with a real mouse, in both themes), so what CAN be pinned here is
// the shared pill function they both render through and the copy the owner asked to change.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { notifyPillHtml, BLOCKED_PILL_CSS } from '../client-ui/src/elements/notify-pill.mjs';

const TIP = 'Email Notifications Disabled at this time';

test('sow-385: the Email pill is blocked: focusable, inert, never pressed, carrying the owner\'s tooltip wording', () => {
  for (const on of [false, true]) { // a member who stored email ON still gets an unpressed, blocked pill
    const html = notifyPillHtml({ rowKey: 'article', channel: 'email', label: 'Email', on });
    assert.match(html, /class="pill blocked"/);
    assert.match(html, /aria-disabled="true"/);
    assert.match(html, /aria-pressed="false"/);
    assert.ok(html.includes(`data-tip="${TIP}"`), 'the tooltip is the owner\'s exact wording');
    assert.ok(html.includes(`aria-label="Email. ${TIP}"`), 'and a screen reader hears it too');
    assert.doesNotMatch(html, /\sdisabled[\s>]/, 'aria-disabled, never the disabled attribute, so hover and focus still work');
    assert.doesNotMatch(html, /pill on/);
  }
});

test('sow-385: the In app pill is unchanged: pressed state, the disabled attribute when prefs are unreadable', () => {
  assert.equal(notifyPillHtml({ rowKey: 'share', channel: 'api', label: 'In app', on: true }),
    '<button type="button" class="pill on" data-cell="share:api" aria-pressed="true">In app</button>');
  assert.equal(notifyPillHtml({ rowKey: 'share', channel: 'api', label: 'In app', on: false, disabled: true }),
    '<button type="button" class="pill" data-cell="share:api" aria-pressed="false" disabled>In app</button>');
  assert.match(notifyPillHtml({ rowKey: 'x', channel: 'api', label: '<b>' }), /&lt;b&gt;/, 'the label is escaped');
});

test('sow-385: the blocked styles carry the three measured decisions', () => {
  assert.match(BLOCKED_PILL_CSS, /cursor:not-allowed/, 'the blocked cursor');
  // The EXACT rule, not any occurrence: `.pill.blocked:hover::after` (the tooltip) would satisfy a looser match.
  assert.match(BLOCKED_PILL_CSS, /\.pill\.blocked, \.pill\.blocked:hover, \.pill\.blocked:focus-visible \{/, 'the blocked look holds on hover and focus');
  assert.match(BLOCKED_PILL_CSS, /\.grid\[data-locked\] \.pill\.blocked \{ cursor:not-allowed; \}/, 'the modal read-only grid case');
  assert.match(BLOCKED_PILL_CSS, /right:calc\(100% \+ 8px\)/, 'the tooltip opens to the left, inside clipped containers');
  assert.doesNotMatch(BLOCKED_PILL_CSS.split('::after')[0], /opacity/, 'no opacity on the pill itself, which would dim its tooltip');
});

test('sow-385: the settings copy no longer promises email', () => {
  const settings = readFileSync(new URL('../client-ui/src/elements/gbti-notifications-settings.mjs', import.meta.url), 'utf8');
  const modal = readFileSync(new URL('../client-ui/src/elements/gbti-notify-modal.mjs', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../client-ui/src/notify-matrix-core.mjs', import.meta.url), 'utf8');
  for (const [name, src] of [['settings', settings], ['modal', modal]]) {
    assert.ok(!src.includes('one digest each morning'), `${name}: the morning-digest sentence is gone`);
    assert.ok(!/email is a single morning digest/i.test(src), `${name}: the intro no longer promises email`);
  }
  assert.ok(settings.includes('What arrives in the header bell when someone you follow publishes.'));
  assert.ok(!core.includes("label: 'News they curate'"), 'the row reads News');
  // The modal's read-only grid dims its parts, not the whole grid (which dimmed the tooltip to about 3.7:1).
  assert.ok(!modal.includes('.grid[data-locked] { opacity:.55; }'));
});
