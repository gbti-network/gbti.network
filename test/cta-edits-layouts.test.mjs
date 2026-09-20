// sow-337: the new card fields in the shared edit core (membership/cta-edits.mjs): the layout and the parts it
// requires, the image name, the icon, the partner hosts that go into the page policy, and the Amazon rule applied
// to links written in an HTML block. The sow-281 rules for the fields every card already had are in
// cta-edits.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CtaEditError, CTA_LIMITS, CTA_HOST_RE, CTA_FIELDS, addCta, updateCta, validateCta, validateCtas, htmlHrefs, amazonHtmlProblems,
} from '../membership/cta-edits.mjs';

const AMZ = 'https://www.amazon.com/dp/0441788386?tag=jakolorbbookc-20';
const ICON = { name: 'FaAmazon', set: 'Font Awesome 5', viewBox: '0 0 448 512', attrs: { fill: 'currentColor' }, shapes: [{ tag: 'path', attrs: { d: 'M0 0h10v10z' } }] };
const ctx = { actor: { githubId: 1, login: 'atwellpub' }, now: '2026-09-15T00:00:00.000Z' };
const book = (over = {}) => ({ id: 'book', label: 'A book', line: 'One sentence.', button: 'Get the book on Amazon', destination: AMZ, partner: 'amazon', ...over });
const bad = (entry, re) => {
  const p = validateCta(entry);
  assert.ok(p.some((s) => re.test(s)), `${JSON.stringify(entry).slice(0, 160)} -> ${JSON.stringify(p)}`);
};

test('layout: one of the six, and each layout requires exactly its parts', () => {
  bad(book({ layout: 'hero' }), /layout must be one of below, first, compact, image, html, text/);
  bad(book({ layout: 'below' }), /image is required for the below layout/);
  bad(book({ layout: 'compact' }), /image is required for the compact layout/);
  bad(book({ layout: 'image', line: undefined, button: undefined }), /image is required for the image layout/);
  bad(book({ layout: 'html', line: undefined, button: undefined, destination: undefined }), /html is required for the html layout/);
  bad(book({ layout: 'text', line: '' }), /line is required for the text layout/);
  bad(book({ layout: 'first', image: 'book.webp', button: '  ' }), /button is required for the first layout/);
  bad(book({ layout: 'html', html: '<b>x</b>', destination: 'http://x' }), /destination must be an absolute https URL/);
  bad(book({ label: '' , layout: 'image', image: 'book.webp' }), /label is required$/);
  bad(book({ line: 5 }), /line must be text/);
  assert.deepEqual(validateCta(book({ layout: 'image', image: 'book.webp', line: undefined, button: undefined })), [], 'image only needs no sentence or button');
  assert.deepEqual(validateCta(book({ layout: 'html', html: '<b>x</b>', line: undefined, button: undefined, destination: undefined })), [], 'an html block needs no link of its own');
  assert.deepEqual(validateCta(book({ image: 'book.webp', html: '<b>kept</b>' })), [], 'a part the layout does not use may stay stored');
});

test('image, icon, html, showTitle: each refused shape by name', () => {
  for (const name of ['../roles.yml', 'book.png', 'Book.webp', 'a/b.webp', 42]) bad(book({ image: name }), /image must be a WebP file name in house\/images\/ctas\//);
  bad(book({ icon: { ...ICON, shapes: [{ tag: 'script' }] } }), /\.icon\.shapes\[0\]: element "script" is not allowed/);
  bad(book({ icon: 'FaAmazon' }), /\.icon: must be a map/);
  bad(book({ html: 7 }), /html must be text/);
  bad(book({ html: 'x'.repeat(CTA_LIMITS.html + 1) }), /html is too long/);
  bad(book({ showTitle: 'no' }), /showTitle must be true or false/);
  assert.deepEqual(validateCta(book({ icon: ICON, showTitle: false })), []);
});

test('hosts: bare https origins only, because each one is written into the page policy', () => {
  assert.deepEqual(validateCta(book({ hosts: ['https://widgets.example.com', 'https://*.amazon-adsystem.com', 'https://cdn.example.co.uk:8443'] })), []);
  const injections = [
    'https://a.example.com; script-src *', "https://a.example.com'", 'https://a.example.com "x"', 'https://a.example.com/path',
    'http://a.example.com', 'https://A.example.com', 'https://localhost', '*', "'unsafe-eval'", 'https://a.example.com,https://b.example.com',
    'data:', 'https://a.example.com\nscript-src *', ' https://a.example.com',
  ];
  for (const h of injections) {
    assert.equal(CTA_HOST_RE.test(h), false, h);
    bad(book({ hosts: [h] }), /hosts\[0\]: must be a bare https origin/);
  }
  bad(book({ hosts: 'https://a.example.com' }), /hosts must be a list/);
  bad(book({ hosts: ['https://a.example.com', 'https://a.example.com'] }), /listed twice/);
  bad(book({ hosts: Array.from({ length: CTA_LIMITS.hosts + 1 }, (_, i) => `https://h${i}.example.com`) }), /at most 8 hosts/);
});

test('the Amazon rule reaches links written in an html block of an amazon card', () => {
  assert.deepEqual(htmlHrefs(`<a href="${AMZ}">x</a><a href='https://b.example/'>y</a><a HREF=https://c.example/z>z</a><link href = "/s.css">`), [AMZ, 'https://b.example/', 'https://c.example/z', '/s.css']);
  assert.deepEqual(htmlHrefs('<a href="https://www.amazon.com/dp/1?a=1&amp;tag=x-20">'), ['https://www.amazon.com/dp/1?a=1&tag=x-20'], 'an encoded ampersand is read as the browser reads it');
  const html = (href) => book({ layout: 'html', html: `<a href="${href}">Buy</a>`, line: undefined, button: undefined, destination: undefined });
  assert.deepEqual(validateCta(html(AMZ)), []);
  bad(html('https://www.amazon.com/dp/0441788386'), /links to amazon without the Associates tag= parameter/);
  bad(html('/outbound/amazon-book/'), /links through \/outbound\//);
  bad(html('https://gbti.network/outbound/amazon-book/'), /links through \/outbound\//);
  assert.deepEqual(amazonHtmlProblems('<a href="https://example.com/outbound/x">elsewhere</a>'), [], 'another site\'s path is not the site redirect');
  assert.deepEqual(validateCta({ ...html('https://www.amazon.com/dp/1'), partner: 'codeable' }), [], 'only an amazon card is held to the Amazon rule');
  assert.equal(validateCta(book({ html: '<a href="https://www.amazon.com/dp/1">x</a>' })).length, 1, 'the rule reads a stored html part whatever the layout');
});

test('addCta stores the structured parts in the order the file is written in', () => {
  const r = addCta({ ctas: [] }, { id: 'cover', label: 'Cover', layout: 'image', destination: AMZ, partner: 'amazon', image: 'cover.webp', icon: ICON, hosts: [], line: '', note: 'why' }, ctx);
  const e = r.next.ctas[0];
  assert.deepEqual(Object.keys(e), ['id', 'label', 'layout', 'destination', 'partner', 'image', 'icon', 'hosts', 'enabled', 'note', 'items']);
  assert.equal(e.line, undefined, 'an empty optional sentence is left out, not stored empty');
  assert.notEqual(e.icon, ICON, 'the icon is copied, not shared with the caller');
  assert.throws(() => addCta({ ctas: [] }, { id: 'cover', label: 'Cover', layout: 'image', destination: AMZ, partner: 'amazon' }, ctx), (err) => err instanceof CtaEditError && /image is required for the image layout/.test(err.message));
  // sow-359 added trackedPath. This exact-list assertion is the point: a field that is not in CTA_FIELDS is
  // dropped silently on the next save, so growing the list has to be a deliberate edit here too.
  assert.deepEqual(CTA_FIELDS, ['label', 'line', 'button', 'destination', 'partner', 'note', 'layout', 'html', 'trackedPath', 'image', 'icon', 'showTitle', 'hosts']);
});

test('updateCta: sets and clears the new parts, keeps the key order, and is a no-op on identical values', () => {
  const start = { ctas: [{ ...book(), enabled: true, note: 'n', items: [{ type: 'prompt', ref: 'grok' }] }] };
  const r = updateCta(start, { id: 'book', layout: 'below', image: 'book.webp', icon: ICON }, ctx);
  assert.equal(r.changed, true);
  assert.deepEqual(r.audit.detail, { fields: ['layout', 'image', 'icon'] });
  assert.deepEqual(Object.keys(r.next.ctas[0]), ['id', 'label', 'layout', 'line', 'button', 'destination', 'partner', 'image', 'icon', 'enabled', 'note', 'items']);
  assert.deepEqual(validateCtas(r.next), []);
  assert.equal(updateCta(r.next, { id: 'book', layout: 'below', icon: structuredClone(ICON) }, ctx).changed, false, 'an identical icon is no change');
  const toText = updateCta(r.next, { id: 'book', layout: '' }, ctx).next.ctas[0];
  assert.equal(toText.layout, undefined, 'clearing the layout returns the card to text only');
  assert.equal(toText.image, 'book.webp', 'switching layouts keeps the image');
  const noIcon = updateCta(r.next, { id: 'book', icon: null }, ctx);
  assert.equal(noIcon.next.ctas[0].icon, undefined);
  assert.deepEqual(noIcon.audit.detail, { fields: ['icon'] });
  const toImage = updateCta(r.next, { id: 'book', layout: 'image', line: '', button: null }, ctx).next.ctas[0];
  assert.equal(toImage.line, undefined);
  assert.equal(toImage.button, undefined);
  assert.throws(() => updateCta(r.next, { id: 'book', image: null }, ctx), /image is required for the below layout/, 'removing the image of an image layout is refused');
  assert.throws(() => updateCta(r.next, { id: 'book', hosts: ['https://x.example.com;'] }, ctx), /must be a bare https origin/);
  assert.equal(start.ctas[0].layout, undefined, 'the input document is never mutated');
});

// sow-337 part 3: the editor saves a whole card at once, its pages and on/off state included, as one PR.
test('addCta and updateCta take a replacement items list and an enabled state, judged by the registry rules', () => {
  const add = addCta({ ctas: [] }, { ...book(), enabled: true, items: [{ type: 'prompt', ref: ' grok ' }, { type: 'share', ref: 'atwellpub/20260610-x' }] }, ctx);
  assert.deepEqual(add.next.ctas[0].items, [{ type: 'prompt', ref: 'grok' }, { type: 'share', ref: 'atwellpub/20260610-x' }]);
  assert.equal(add.next.ctas[0].enabled, true);
  const start = add.next;
  const r = updateCta(start, { id: 'book', enabled: false, items: [{ type: 'post', ref: 'an-article' }] }, ctx);
  assert.deepEqual(r.audit.detail, { fields: ['enabled', 'items'] });
  assert.deepEqual(r.next.ctas[0].items, [{ type: 'post', ref: 'an-article' }]);
  assert.equal(r.next.ctas[0].enabled, false);
  assert.equal(updateCta(start, { id: 'book', enabled: true, items: [{ type: 'prompt', ref: 'grok' }, { type: 'share', ref: 'atwellpub/20260610-x' }] }, ctx).changed, false, 'the same pages and state are no change');
  assert.equal(updateCta(start, { id: 'book', enabled: 'no' }, ctx).changed, false, 'a non-boolean enabled is ignored by the core (the Worker refuses it)');
  assert.throws(() => updateCta(start, { id: 'book', items: [{ type: 'page', ref: 'x' }] }, ctx), /type must be one of/);
  assert.throws(() => updateCta(start, { id: 'book', items: [{ type: 'post', ref: 'x' }, { type: 'post', ref: 'x' }] }, ctx), /assigned to this CTA twice/);
  assert.deepEqual(updateCta(start, { id: 'book', items: [] }, ctx).next.ctas[0].items, [], 'an empty list takes the card off every page');
});
