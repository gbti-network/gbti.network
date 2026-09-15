// sow-337: the one card drawing (membership/cta-card-render.mjs), shared by the public page and the superadmin
// preview. Each layout is checked for the ORDER of its parts (the owner specified the first card's order), the
// Amazon rule's visible destination on an image-only card, text escaping, the inert preview, and that every class
// the markup uses has a rule in the stylesheet, so a renamed class cannot ship an unstyled card.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { renderCtaCard, CTA_CARD_CSS, CTA_LAYOUTS, CTA_LAYOUT_NAMES, CTA_TOKENS, ctaLayoutOf, layoutUses, destinationHost } from '../membership/cta-card-render.mjs';
import { validateCta } from '../membership/cta-edits.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const ICON = { name: 'FaBook', set: 'Font Awesome 5', viewBox: '0 0 24 24', shapes: [{ tag: 'path', attrs: { d: 'M0 0h24v24z' } }] };
const IMG = { url: '/media/ctas/book.webp', width: 480, height: 792 };
const card = (over = {}) => ({ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get the book on Amazon', destination: AMZ, partner: 'amazon', image: 'book.webp', icon: ICON, html: '<div id="partner-widget"><script src="https://widgets.example.com/w.js"></script></div>', hosts: ['https://widgets.example.com'], ...over });
/** The position of each marker in the markup, in the order given; -1 for a missing one. */
const order = (html, ...markers) => markers.map((m) => html.indexOf(m));
const ascending = (xs) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

test('below: title, sentence, image, button, in that order (the first card, as the owner specified it)', () => {
  const h = renderCtaCard(card({ layout: 'below' }), { image: IMG });
  assert.ok(ascending(order(h, 'pcta-eyebrow', 'pcta-line', '<div class="pcta-media">', '<img ', 'pcta-btn')), h);
  assert.match(h, /<img src="\/media\/ctas\/book\.webp" alt="" width="480" height="792" loading="lazy" decoding="async">/);
  assert.doesNotMatch(h, /partner-widget/, 'an unused html part is never drawn');
});

test('first, compact and text: each layout draws only its parts, in its order', () => {
  const first = renderCtaCard(card({ layout: 'first' }), { image: IMG });
  assert.ok(ascending(order(first, 'pcta-media pcta-top', '<img ', 'pcta-eyebrow', 'pcta-line', 'pcta-btn')), first);
  const compact = renderCtaCard(card({ layout: 'compact' }), { image: IMG });
  assert.ok(ascending(order(compact, 'pcta-cmp', 'pcta-cmp-img', '<img ', 'pcta-eyebrow', 'pcta-line', 'pcta-btn')), compact);
  assert.equal((compact.match(/pcta-eyebrow/g) || []).length, 1, 'the title is drawn once, beside the image');
  const text = renderCtaCard(card({ layout: 'text' }), { image: IMG });
  assert.ok(ascending(order(text, 'pcta-eyebrow', 'pcta-line', 'pcta-btn')), text);
  assert.doesNotMatch(text, /<img |pcta-media/);
  assert.equal(renderCtaCard(card({ layout: undefined }), { image: IMG }), text, 'no layout is text only, the shape of every older card');
  assert.equal(ctaLayoutOf({ layout: 'bogus' }), 'text');
});

test('image only: the whole card is the link, the title is the alt text, and a footer names the destination', () => {
  const h = renderCtaCard(card({ layout: 'image' }), { image: IMG });
  assert.match(h, /^<a class="pcta-io" href="https:\/\/www\.amazon\.com\/dp\/0441788386\?tag=jakolorbbookc-20" target="_blank" rel="sponsored nofollow noopener" aria-label="A book">/);
  assert.match(h, /alt="A book"/);
  assert.match(h, /<span class="pcta-io-foot"><span>amazon\.com<\/span>/, 'the Amazon rule: the link stays visibly an Amazon link');
  assert.doesNotMatch(h, /pcta-btn|pcta-eyebrow|pcta-line/);
  assert.equal(destinationHost('https://www.amazon.co.uk/dp/1?tag=x'), 'amazon.co.uk');
  assert.equal(destinationHost('not a url'), 'not a url');
});

test('html block: the title unless turned off, then the partner code as written; no button and no icon', () => {
  const h = renderCtaCard(card({ layout: 'html' }));
  assert.ok(ascending(order(h, 'pcta-eyebrow', '<div class="pcta-html"><div id="partner-widget"><script src="https://widgets.example.com/w.js"></script></div></div>')), h);
  assert.doesNotMatch(h, /pcta-btn|<svg|pcta-line/);
  const flush = renderCtaCard(card({ layout: 'html', showTitle: false }));
  assert.doesNotMatch(flush, /pcta-eyebrow/);
  assert.match(flush, /^<div class="pcta-html pcta-flush">/);
});

test('the button: icon on the left, text, arrow on the right; a direct sponsored link in a new tab', () => {
  const h = renderCtaCard(card({ layout: 'text' }));
  assert.match(h, /<a class="pcta-btn" href="https:\/\/www\.amazon\.com\/dp\/0441788386\?tag=jakolorbbookc-20" target="_blank" rel="sponsored nofollow noopener"><svg class="pcta-ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M0 0h24v24z"><\/path><\/svg><span>Get the book on Amazon<\/span><svg class="pcta-ar"/);
  assert.doesNotMatch(renderCtaCard(card({ layout: 'text', icon: undefined })), /pcta-ic/);
  assert.doesNotMatch(renderCtaCard(card({ layout: 'text', icon: { ...ICON, shapes: [{ tag: 'script' }] } })), /pcta-ic|script/, 'an icon the rules refuse is dropped, never drawn');
});

test('every text value is escaped; only the html part is raw', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const h = renderCtaCard(card({ layout: 'image', label: evil, destination: `https://x.example/"><script>` }), { image: { url: '/m/"x.webp', width: '1"', height: 2 } });
  assert.doesNotMatch(h, /<img src=x|"><script>|src="\/m\/"x/);
  assert.match(h, /aria-label="&lt;img src=x onerror=alert\(1\)&gt;&quot;&#39;&amp;"/);
  assert.doesNotMatch(h, / width=/, 'a dimension that is not a whole number is left off, never written as NaN');
  assert.match(h, / height="2"/);
  for (const layout of ['below', 'first', 'compact', 'text', 'html']) {
    const t = renderCtaCard(card({ layout, label: evil, line: evil, button: evil }), { image: IMG });
    assert.doesNotMatch(t, /<img src=x/, layout);
  }
});

test('the preview is inert: no links, no partner code, a notice naming the hosts, and a placeholder for a missing image', () => {
  for (const layout of CTA_LAYOUTS) {
    const h = renderCtaCard(card({ layout }), { image: null, preview: true });
    assert.doesNotMatch(h, /<a |href=|<script/, layout);
    if (layoutUses(layout).image) assert.match(h, /pcta-ph">No image yet/, layout);
  }
  const html = renderCtaCard(card({ layout: 'html' }), { preview: true });
  assert.match(html, /Partner code runs on the live page<\/strong><span>Scripts do not run in this preview\.<\/span><span class="pcta-host">loads from https:\/\/widgets\.example\.com<\/span>/);
});

test('layoutUses is the table the edit core enforces: a missing used part is refused, a missing unused part is not', () => {
  assert.deepEqual(Object.keys(CTA_LAYOUT_NAMES), CTA_LAYOUTS);
  // The table itself, written out, because the loop below reads the same table on both sides and cannot see it change.
  const words = { line: true, button: true, icon: true, link: true, html: false };
  assert.deepEqual(Object.fromEntries(CTA_LAYOUTS.map((l) => [l, layoutUses(l)])), {
    below: { ...words, image: true }, first: { ...words, image: true }, compact: { ...words, image: true },
    image: { line: false, button: false, icon: false, link: true, image: true, html: false },
    html: { line: false, button: false, icon: false, link: false, image: false, html: true },
    text: { ...words, image: false },
  });
  for (const layout of CTA_LAYOUTS) {
    const uses = layoutUses(layout);
    const full = card({ layout, partner: 'example' });
    assert.deepEqual(validateCta(full), [], layout);
    for (const [part, key] of [['line', 'line'], ['button', 'button'], ['image', 'image'], ['html', 'html'], ['link', 'destination']]) {
      const p = validateCta({ ...full, [key]: undefined });
      assert.equal(p.length > 0, uses[part], `${layout} without ${key}: ${JSON.stringify(p)}`);
    }
  }
});

test('every class the markup uses has a rule in the stylesheet, and both token sets name the same tokens', () => {
  const used = new Set();
  for (const layout of CTA_LAYOUTS) {
    for (const opts of [{ image: IMG }, { image: null, preview: true }]) {
      const h = renderCtaCard(card({ layout, showTitle: layout === 'html' ? false : undefined }), opts);
      for (const m of h.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.startsWith('pcta')) used.add(c);
    }
  }
  const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(CTA_CARD_CSS));
  assert.deepEqual(missing, [], `classes with no rule: ${missing.join(', ')}`);
  assert.ok(used.size >= 15, `a census of ${used.size} classes`);
  const names = (s) => s.split(';').map((d) => d.split(':')[0]).sort();
  assert.deepEqual(names(CTA_TOKENS.dark), names(CTA_TOKENS.light));
});

test('the committed Stranger card draws title, sentence, cover, then the Amazon button with its icon', () => {
  const parsed = yaml.load(fs.readFileSync(path.join(ROOT, 'house/ctas.yml'), 'utf8'));
  const c = parsed.ctas.find((x) => x.id === 'stranger-in-a-strange-land');
  assert.equal(c.layout, 'below');
  assert.equal(c.image, 'stranger-in-a-strange-land.webp');
  const h = renderCtaCard(c, { image: { url: '/media/ctas/stranger-in-a-strange-land.webp', width: 480, height: 792 } });
  assert.ok(ascending(order(h, '>Stranger in a Strange Land<', ">Have you read Robert Heinlein&#39;s Stranger in a Strange Land?<", 'stranger-in-a-strange-land.webp', 'class="pcta-ic" viewBox="0 0 448 512"', '<span>Get the book on Amazon</span>')), h);
});
