// Owner, 2026-09-29: clicking Assist (or Copy, Mark done, Delete) at the bottom of the Social Queue threw the reader
// back to the top, on the website and in the extension. Every action re-renders the whole panel, which replaces the
// scrolling body. The element now reads the body's position before a render and puts it back after, and only a new
// list (another tab, filter or page) starts at the top. Measured in a browser against the real element; this guard
// keeps the three parts from being dropped in a later edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-social-queue.mjs', import.meta.url), 'utf8');
const render = src.slice(src.indexOf('  render() {'), src.indexOf('  _shell('));

test('a re-render keeps the body where the reader left it', () => {
  const read = render.indexOf("this.$('.body')?.scrollTop");
  const set = render.indexOf('this.set(this.css(CSS) + this._shell(`\n      <div class="tabs">');
  const restore = render.indexOf('body.scrollTop = keepScroll');
  assert.ok(read > -1 && set > read, 'the position is read before the new markup replaces the body');
  assert.ok(restore > set, 'and put back after it');
});

test('a new list starts at the top: tab, filter and page each ask for it', () => {
  for (const [what, marker] of [['tab', "this._tab = b.dataset.tab;"], ['filter', "if (el.dataset.f === 'type')"], ['page', "this._page += b.dataset.pg === 'next'"]]) {
    const at = render.indexOf(marker);
    assert.ok(at > -1, `${what} handler found`);
    assert.match(render.slice(at, render.indexOf('this.render()', at)), /this\._resetScroll = true/, `${what} resets the scroll`);
  }
});

test('the action message sits outside the scrolling body, so a kept position never hides it', () => {
  const shell = src.slice(src.indexOf('  _shell('), src.indexOf('  _wire()'));
  assert.ok(shell.indexOf('msgbar') > -1 && shell.indexOf('msgbar') < shell.indexOf('<div class="body">'));
  assert.ok(!render.includes('<p class="msg">${esc(this._msg)}</p>'), 'no second copy inside the body');
  assert.match(render, /`, this\._msg\)\);/, 'the main view hands its message to the strip');
});
