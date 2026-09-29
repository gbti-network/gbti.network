// sow-423 (owner, 2026-09-29): "the news cards in our grid need to have the category label/pill to the right of
// News". A news item's category is already a readable name ("AI/ML", "Hardware", "Other"); the owner chose to show
// "Other" too. Member content keeps its taxonomy leaf label.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GbtiCardList } from '../client-ui/src/elements/gbti-card-list.mjs';
import { newsToItem } from '../client-ui/src/news.mjs';

const list = (mode = 'card') => { const l = Object.create(GbtiCardList.prototype); l._mode = mode; return l; };
const news = (category) => newsToItem({ guid: 'g1', source: 'the-register', title: 'A story', link: 'https://example.com/a', category, publishedAt: 1759100000 });

test('sow-423: a news card shows its category pill right after the NEWS chip', () => {
  const html = list()._card([news('AI/ML')]);
  assert.match(html, /<span class="tcluster"><span class="chip k-news">News<\/span><span class="catchip">AI\/ML<\/span><\/span>/);
});

test('sow-423: "Other" gets a pill, no category gets none, and markup is escaped', () => {
  const l = list();
  assert.equal(l._categoryChip(news('Other')), '<span class="catchip">Other</span>');
  assert.equal(l._categoryChip(news(null)), '');
  assert.equal(l._categoryChip(news('   ')), '');
  assert.equal(l._categoryChip(news('<b>x</b>')), '<span class="catchip">&lt;b&gt;x&lt;/b&gt;</span>');
});

test('sow-423: member content still takes its taxonomy leaf, and the detailed row shows the news pill too', () => {
  const l = list();
  assert.equal(l._categoryChip({ type: 'post', categoryLabels: ['DevOps', 'Tooling'], category: 'ignored' }), '<span class="catchip">Tooling</span>');
  assert.match(list('detailed')._detailed([news('Hardware')]), /<span class="chip k-news">News<\/span><span class="catchip">Hardware<\/span>/);
  assert.doesNotMatch(list('compact')._compact([news('Hardware')]), /catchip/, 'compact rows stay one line, as for every type');
});
