// sow-398 (owner, 2026-09-24): in the extension a share can be favorited and saved to a collection, as on the website
// share page, and the feed cards carry heart + Save, as the website's feed cards do. The server has accepted shares
// since SOW-050 (membership/member-activity.mjs CONTENT_TYPES); the extension's reader had left them out on purpose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { targetSlugFor, SAVABLE_TYPES } from '../client-ui/src/target-slug.mjs';
import { CONTENT_TYPES } from '../membership/member-activity.mjs';
import { GbtiCardList } from '../client-ui/src/elements/gbti-card-list.mjs';

const src = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const READER = src('client-ui/src/elements/gbti-reader.mjs');

test('one key for favorites, collections and comments: a share is <author>/<id>, content its slug', () => {
  assert.equal(targetSlugFor({ type: 'share', author: 'gbtilabs', id: '20260921-poison' }), 'gbtilabs/20260921-poison');
  assert.equal(targetSlugFor({ type: 'share', author: 'gbtilabs' }), '', 'a share without an id has no key');
  assert.equal(targetSlugFor({ type: 'post', slug: 'hello' }), 'hello');
  assert.equal(targetSlugFor({ type: 'prompt', path: 'members/x/prompts/ci-health/index.md' }), 'ci-health');
  assert.equal(targetSlugFor({ type: 'post' }), '');
  assert.equal(targetSlugFor(null), '');
});

test('the savable types are exactly the ones the server stores; news is not one of them', () => {
  assert.deepEqual([...SAVABLE_TYPES].sort(), [...CONTENT_TYPES].sort());
  assert.ok(!SAVABLE_TYPES.has('news'));
});

test('the reader keys a share like any other item, and gives its moderation control the share id', () => {
  assert.match(READER, /import \{ targetSlugFor \} from '\.\.\/target-slug\.mjs';/, 'one shared key function');
  assert.doesNotMatch(READER, /function targetSlugFor/, 'no local copy to drift from');
  assert.doesNotMatch(READER, /it\.type === 'share' \? '' : targetSlugFor\(it\)/, 'the meta line no longer blanks a share');
  assert.doesNotMatch(READER, /if \(!this\.client \|\| it\.type === 'share'\) return;/, 'a deep-link favorite acts on a share too');
  assert.match(READER, /\$\{it\.type === 'share' \? ` data-gbti-id="\$\{esc\(it\.id \|\| ''\)\}"` : ''\}/,
    'modPathFor builds a share path from its id; without it the control targets nothing');
});

const ITEMS = [
  { type: 'share', author: 'gbtilabs', id: '20260921-poison', title: 'A share', createdAt: '2026-09-21' },
  { type: 'post', path: 'members/x/posts/hello/index.md', title: 'An article' },
  { type: 'news', title: 'A news item', openHref: 'https://example.com/a' },
];
const renderAs = (mode) => { const el = Object.create(GbtiCardList.prototype); el._mode = mode; return el[`_${mode}`](ITEMS); };

for (const mode of ['card', 'detailed', 'compact']) {
  test(`${mode} view: heart + Save on content and shares, keyed right, beside the card link and never inside it`, () => {
    const html = renderAs(mode);
    const wrappers = html.split('<div class="it').slice(1);
    assert.equal(wrappers.length, 3, 'every item is wrapped');
    const [share, post, news] = wrappers;
    assert.match(share, /<gbti-favorite data-gbti-target-type="share" data-gbti-target-slug="gbtilabs\/20260921-poison"/);
    assert.match(share, /<gbti-collection data-gbti-target-type="share" data-gbti-target-slug="gbtilabs\/20260921-poison"/);
    assert.match(post, /<gbti-favorite data-gbti-target-type="post" data-gbti-target-slug="hello"/);
    assert.doesNotMatch(news, /gbti-favorite|gbti-collection/, 'news keeps its own hearts, not favorites');
    assert.match(news, /^"><a /, 'a news card is wrapped but carries no controls');
  });
}

test('the controls are a SIBLING after the whole card, so a click on them never opens it', () => {
  const el = Object.create(GbtiCardList.prototype);
  const out = el._wrap(ITEMS[0], '<a class="card-i" href="#">CARD</a>');
  assert.match(out, /^<div class="it has-acts"><a class="card-i" href="#">CARD<\/a><div class="acts"><gbti-favorite [^]*<\/gbti-collection><\/div><\/div>$/);
  assert.equal(el._wrap(ITEMS[2], '<a>N</a>'), '<div class="it"><a>N</a></div>');
  // and every view hands _wrap the WHOLE card, from its opening element to its close
  const cl = src('client-ui/src/elements/gbti-card-list.mjs');
  for (const cls of ['row-c', 'row-d', 'card-i']) {
    const line = cl.split('\n').find((l) => l.includes(`this._wrap(it, \`\${this._open(it, i, '${cls}')}`));
    assert.ok(line, `${cls}: the view wraps its card`);
    assert.ok(line.includes('${this._close(it)}`)).join'), `${cls}: the wrap closes after the card's own close`);
  }
});

test('the card list reserves room for the controls in each view, so they never sit on text', () => {
  const css = src('client-ui/src/elements/gbti-card-list.mjs');
  assert.match(css, /\.detailed \.it\.has-acts > \.row-d \{ padding-bottom:62px; \}/);
  assert.match(css, /\.card \.it\.has-acts \.cbody \{ padding-bottom:54px; \}/);
  assert.match(css, /\.compact \.it\.has-acts > \.row-c \{ padding-right:190px; \}/);
  assert.match(css, /\.it:last-child > \.row-c, \.it:last-child > \.row-d \{ border-bottom:0; \}/,
    'each row is now the last child of its own wrapper, so the last-row rule reads the wrapper');
});
