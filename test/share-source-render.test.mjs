// sow-222: the source card is hand-mirrored across two surfaces that cannot share a component (an Astro page
// and a shadow-DOM template string), so the decision is shared as a module and this test is what keeps the two
// copies from drifting apart, the same way test/share-feed-cards.test.mjs pins the feed card pair.
//
// What it asserts is narrow on purpose: both copies must READ the model, and neither may carry its own copy of
// the credit sentence, the verb or the host derivation. How each one draws the card, which favicon service it
// uses and how it decorates an outbound link stay each surface's own business.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const astro = readFileSync(new URL('../src/pages/shares/[author]/[id].astro', import.meta.url), 'utf8');
const reader = readFileSync(new URL('../client-ui/src/elements/gbti-reader.mjs', import.meta.url), 'utf8');

test('sow-222: both copies of the source card read the shared model', () => {
  assert.match(astro, /import \{ sourceCardModel \} from '\.\.\/\.\.\/\.\.\/\.\.\/client\/src\/share-source\.mjs'/);
  assert.match(reader, /import \{ sourceCardModel \} from '\.\.\/\.\.\/\.\.\/client\/src\/share-source\.mjs'/);
  assert.match(astro, /sourceCardModel\(\{ url: d\.url/);
  assert.match(reader, /sourceCardModel\(\{ url: it\.url/);
  // Each renders the model's three decisions rather than its own.
  for (const [what, src] of [['the page', astro], ['the reader', reader]]) {
    for (const field of ['name', 'credit', 'action.text', 'action.title']) {
      assert.ok(src.includes(`Card.${field}`), `${what} renders srcCard.${field}`);
    }
  }
});

test('sow-222: neither copy keeps its own credit sentence, verb or host derivation', () => {
  for (const [what, src] of [['the page', astro], ['the reader', reader]]) {
    assert.equal(/The source \$\{|The source \{/.test(src), false, `${what} still writes the credit sentence itself`);
    assert.equal(/>Visit</.test(src), false, `${what} still hardcodes the Visit label`);
    // A verb may appear elsewhere in either file for an unrelated control (the member card's "Subscribe to
    // activity"), so the check is that the SOURCE CARD's action text comes from the model, asserted above.
    const block = what === 'the page'
      ? /<div class="card news-source-card">[\s\S]*?<\/div>\n\s*\)\}/.exec(src)[0]
      : /const sideLink = srcCard[\s\S]*?: '';/.exec(src)[0];
    assert.equal(/Subscribe|Follow|Visit/.test(block), false, `${what} still writes a verb into the card itself`);
  }
  // The reader kept its own favicon and outbound decoration, which is correct and deliberate.
  assert.match(reader, /faviconFor\(it\.url\)/);
  assert.match(reader, /utmLink\(srcCard\.action\.href/);
  assert.match(astro, /utmUrl\(srcCard\.action\.href/);
});

test('sow-222: the share page still declares the creator link as an untrusted outbound link', () => {
  const card = /<div class="card news-source-card">[\s\S]*?<\/div>\n\s*\)\}/.exec(astro);
  assert.ok(card, 'the source card block is still in the page');
  assert.match(card[0], /rel="noopener nofollow"/);
  assert.match(card[0], /target="_blank"/);
  const side = /const sideLink = srcCard[\s\S]*?: '';/.exec(reader);
  assert.ok(side, 'the reader still builds a side-src card');
  assert.match(side[0], /rel="noopener nofollow"/);
  // Every value the reader interpolates into its template is escaped, since a creator name and a derived url
  // are member-reachable data in a shadow root that renders raw HTML.
  for (const expr of ['srcCard.name', 'srcCard.credit', 'srcCard.action.title', 'srcCard.action.text']) {
    assert.ok(side[0].includes(`esc(${expr})`), `the reader escapes ${expr}`);
  }
});
