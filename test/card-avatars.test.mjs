// SOW-049: the content-card meta avatar helpers. A member-authored card shows the author's github avatar (name on
// a hover tooltip); a news card shows the publisher favicon (source on the tooltip) and NO left icon. Pure helpers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { faviconFor, avatarFor, relTime } from '../client-ui/src/elements/gbti-card-list.mjs';

const NOW = Date.parse('2026-06-18T12:00:00Z');
test('relTime: a TODAY item reads N hours/minutes ago, not "today" (OS-local elapsed)', () => {
  assert.equal(relTime(NOW - 30 * 1000, NOW), 'just now');
  assert.equal(relTime(NOW - 1 * 60000, NOW), '1 minute ago');
  assert.equal(relTime(NOW - 45 * 60000, NOW), '45 minutes ago');
  assert.equal(relTime(NOW - 1 * 3600000, NOW), '1 hour ago');
  assert.equal(relTime(NOW - 5 * 3600000, NOW), '5 hours ago');
  assert.equal(relTime(NOW - 23 * 3600000, NOW), '23 hours ago'); // still "today" worth of hours
  assert.equal(relTime(NOW - 25 * 3600000, NOW), '1 day ago');
  assert.equal(relTime(NOW - 40 * 86400000, NOW), '1 month ago');
  assert.equal(relTime(0, NOW), ''); // no timestamp
});

test('faviconFor derives a favicon URL from a news article link or bare host', () => {
  const f = faviconFor('https://www.bleepingcomputer.com/news/article-1');
  assert.match(f, /google\.com\/s2\/favicons/);
  assert.match(f, /domain=www\.bleepingcomputer\.com/);
  assert.match(faviconFor('example.com'), /domain=example\.com/); // bare host
  assert.equal(faviconFor(''), '');
  assert.equal(faviconFor(null), '');
  assert.equal(faviconFor(undefined), '');
});

test('avatarFor: a member item -> github avatar + the name as the tooltip', () => {
  const m = avatarFor({ type: 'post', author: 'alice' });
  assert.match(m.src, /github\.com\/alice\.png/);
  assert.equal(m.title, 'alice');
});

test('avatarFor: a gbti/house item -> the GBTI org avatar + "GBTI Network" tooltip', () => {
  for (const author of ['gbti', 'house', 'GBTI']) {
    const h = avatarFor({ type: 'product', author });
    assert.match(h.src, /github\.com\/gbti-network\.png/);
    assert.equal(h.title, 'GBTI Network');
  }
});

test('avatarFor: a news item -> the publisher favicon + the source as the tooltip', () => {
  const n = avatarFor({ type: 'news', source: 'BleepingComputer', link: 'https://www.bleepingcomputer.com/x' });
  assert.match(n.src, /s2\/favicons/);
  assert.match(n.src, /bleepingcomputer\.com/);
  assert.equal(n.title, 'BleepingComputer');
  // falls back to the openHref domain + a default title when source/link are sparse
  const n2 = avatarFor({ type: 'news', openHref: 'https://news.example.org/a?utm_source=x' });
  assert.match(n2.src, /domain=news\.example\.org/);
  assert.equal(n2.title, 'News');
});
