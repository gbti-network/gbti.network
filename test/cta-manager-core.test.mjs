// sow-337: the pure half of the redesigned call-to-action manager (client-ui/src/cta-manager-core.mjs): the draft,
// the field messages from the approved design, the shared registry rules behind them, the save payload an edit
// becomes, and the helpers behind "found in the code" and page search.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  draftFromCta, blankDraft, cardFromDraft, validateDraft, savePayload, normalizeHost, foundHosts, pagesFromBuilt,
  pageCandidates, rowSummary, previewNote, plural,
} from '../client-ui/src/cta-manager-core.mjs';
import { validateCta } from '../membership/cta-edits.mjs';

const ICON = { name: 'FaAmazon', set: 'Font Awesome 5', viewBox: '0 0 448 512', attrs: { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '0' }, shapes: [{ tag: 'path', attrs: { d: 'M0 0h10v10H0z' } }] };
const STRANGER = {
  id: 'stranger-in-a-strange-land', label: 'Stranger in a Strange Land', layout: 'below', line: "Have you read Robert Heinlein's Stranger in a Strange Land?",
  button: 'Get the book on Amazon', destination: 'https://www.amazon.com/dp/B00005QTH2?tag=jakolorbbookc-20', partner: 'amazon',
  image: 'stranger-in-a-strange-land.webp', icon: ICON, enabled: true, note: 'The Ace paperback.',
  items: [{ type: 'prompt', ref: 'grok-skill-for-claude-code' }],
};
const draft = (over = {}) => ({ ...draftFromCta(STRANGER, { imageUrl: 'https://gbti.network/media/ctas/stranger-in-a-strange-land.webp' }), ...over });

test('a registry card becomes an editable draft and saves back to the same card', () => {
  const d = draft();
  assert.equal(d.image.kind, 'stored');
  assert.equal(d.image.file, 'stranger-in-a-strange-land.webp');
  assert.notEqual(d.icon, STRANGER.icon, 'the icon is a copy, so editing the draft never edits the loaded list');
  assert.deepEqual(cardFromDraft(d), STRANGER);
  assert.deepEqual(validateCta(cardFromDraft(d), 'card'), []);
});

test('an older card with no layout opens as text only, and a new card opens on Image below, enabled', () => {
  assert.equal(draftFromCta({ id: 'x', label: 'X', partner: 'p' }).layout, 'text');
  const b = blankDraft();
  assert.equal(b.layout, 'below');
  assert.equal(b.enabled, true);
  assert.deepEqual(b.image, { kind: 'none' });
});

test('the design messages appear per field, for exactly the parts the layout uses', () => {
  const empty = { ...blankDraft(), layout: 'below' };
  const v = validateDraft(empty, { isNew: true });
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors, {
    id: 'Use lowercase words joined by hyphens.', label: 'A title is required.', partner: 'Name the partner in one lowercase word, like amazon.',
    line: 'Add the sentence the card shows.', button: 'Add the button text, naming the partner.', destination: 'Use a full link starting with https://.',
    image: 'This layout needs an image.',
  });
  assert.deepEqual(v.live, {}, 'an empty form shows nothing before the first save');
  const html = validateDraft({ ...empty, layout: 'html' }, { isNew: false });
  assert.deepEqual(Object.keys(html.errors).sort(), ['html', 'label', 'partner']);
  assert.equal(validateDraft({ ...empty, layout: 'image' }).errors.label, 'A title is required. It becomes the image description.');
  assert.deepEqual(Object.keys(validateDraft({ ...empty, layout: 'text' }).errors).sort(), ['button', 'destination', 'label', 'line', 'partner']);
});

test('a new card cannot take an id already in the registry; an existing card id is not checked', () => {
  const d = draft();
  assert.equal(validateDraft(d, { isNew: true, taken: new Set([STRANGER.id]) }).errors.id, 'Another call-to-action already uses this id.');
  assert.equal(validateDraft(d, { isNew: false, taken: new Set([STRANGER.id]) }).ok, true);
});

test('an Amazon link through a redirect, or with no tag, is refused at once, as the purchase would earn nothing', () => {
  const redirect = validateDraft(draft({ destination: 'https://gbti.network/outbound/amazon-stranger/' }));
  assert.match(redirect.errors.destination, /must go straight to amazon\.com/);
  assert.equal(redirect.live.destination, true);
  const untagged = validateDraft(draft({ destination: 'https://www.amazon.com/dp/B00005QTH2' }));
  assert.equal(untagged.errors.destination, 'This Amazon link has no tag=, so a purchase through it earns nothing.');
  assert.equal(untagged.live.destination, true);
  assert.equal(validateDraft(draft({ destination: 'http://example.com' })).live.destination, true, 'a typed link that is not https shows at once');
  assert.equal(validateDraft(draft({ partner: 'codeable', destination: 'https://gbti.network/outbound/x/' })).ok, true, 'the rule is for Amazon cards');
});

test('a refusal no field covers becomes the banner, so the editor never lets through a save the server refuses', () => {
  const v = validateDraft(draft({ layout: 'html', html: '<a href="https://www.amazon.com/dp/B00005QTH2">Buy</a>' }));
  assert.deepEqual(v.errors, {});
  assert.equal(v.ok, false);
  assert.match(v.banner, /^The HTML links to amazon without the Associates tag=/);
  const hosts = validateDraft(draft({ hosts: ['https://a.example.com', 'https://a.example.com'] }));
  assert.match(hosts.banner, /listed twice/);
  const covered = validateDraft(draft({ label: '' }));
  assert.equal(covered.banner, '', 'a refusal a field message already explains is not repeated as the banner');
});

test('a new card sends every part it has, with the image as the re-encoded bytes', () => {
  const d = { ...blankDraft(), id: 'new-one', label: 'New', partner: 'codeable', line: 'A line.', button: 'Go', destination: 'https://codeable.io/',
    image: { kind: 'upload', base64: 'UklGRg==', url: 'data:image/webp;base64,UklGRg==' } };
  const { fields, changed } = savePayload(d, null, { isNew: true });
  assert.equal(fields.imageBase64, 'UklGRg==');
  assert.equal('image' in fields, false, 'the server names the file from the id, never the caller');
  assert.equal(fields.enabled, true);
  assert.deepEqual(fields.items, []);
  assert.deepEqual(changed.sort(), Object.keys(fields).sort());
});

test('an edit sends only what changed, and an untouched card sends nothing', () => {
  assert.deepEqual(savePayload(draft(), STRANGER), { fields: { id: STRANGER.id }, changed: [] });
  const r = savePayload(draft({ line: 'A new sentence.', enabled: false }), STRANGER);
  assert.deepEqual(r.fields, { id: STRANGER.id, line: 'A new sentence.', enabled: false });
});

test('an edit clears a part by sending null or removeImage, and a new upload replaces the stored image', () => {
  const r = savePayload(draft({ icon: null, image: { kind: 'none' }, layout: 'text' }), STRANGER);
  assert.deepEqual(r.fields, { id: STRANGER.id, layout: 'text', icon: null, removeImage: true });
  const up = savePayload(draft({ image: { kind: 'upload', base64: 'QUJD' } }), STRANGER);
  assert.deepEqual(up.fields, { id: STRANGER.id, imageBase64: 'QUJD' });
  const html = { ...STRANGER, layout: 'html', html: '<b>x</b>', showTitle: false, hosts: ['https://a.example.com'] };
  const back = savePayload({ ...draftFromCta(html), showTitle: true, hosts: [] }, html);
  assert.deepEqual(back.fields, { id: STRANGER.id, showTitle: null, hosts: null });
  const hidden = savePayload({ ...draftFromCta({ ...html, showTitle: true }), showTitle: false }, { ...html, showTitle: true });
  assert.deepEqual(hidden.fields, { id: STRANGER.id, showTitle: false });
});

test('the pages a card is on travel in the same save as its words', () => {
  const items = [...STRANGER.items, { type: 'post', ref: 'proxmoxbox' }];
  assert.deepEqual(savePayload(draft({ items }), STRANGER).fields, { id: STRANGER.id, items });
  assert.deepEqual(savePayload(draft({ items: [] }), STRANGER).fields, { id: STRANGER.id, items: [] });
});

test('an outside address is a bare https origin; a path, a semicolon or plain http is refused', () => {
  assert.deepEqual(normalizeHost(' https://Widgets.Partner.com/ '), { ok: true, host: 'https://widgets.partner.com' });
  assert.deepEqual(normalizeHost('https://widgets.partner.com:8443'), { ok: true, host: 'https://widgets.partner.com:8443' });
  for (const bad of ['http://widgets.partner.com', 'https://widgets.partner.com/embed.js', "https://a.com; script-src 'unsafe-eval'", 'widgets.partner.com', '']) {
    assert.equal(normalizeHost(bad).ok, false, bad);
  }
});

test('"found in the code" lists the https origins the code loads from, once each, leaving out ones already allowed', () => {
  const html = `<div data-x></div><script async src="https://widgets.example-partner.com/v2/embed.js"></script>
    <a href='https://www.example.com/a?b'>x</a><img src=https://cdn.example.com/i.png><script src="https://widgets.example-partner.com/other.js"></script>
    <script src="http://insecure.example.com/x.js"></script>`;
  assert.deepEqual(foundHosts(html), ['https://widgets.example-partner.com', 'https://www.example.com', 'https://cdn.example.com']);
  assert.deepEqual(foundHosts(html, ['https://www.example.com']), ['https://widgets.example-partner.com', 'https://cdn.example.com']);
});

test('page search reads the built list, matches title or reference, and leaves out pages the card is already on', () => {
  const pages = pagesFromBuilt({ pages: [
    { type: 'prompt', ref: 'grok-skill-for-claude-code', title: 'Grok skill for Claude Code' },
    { type: 'post', ref: 'proxmoxbox', title: 'Migrating my home server' },
    { type: 'share', ref: 'atwellpub/abc123', title: '' },
    { type: 'nonsense', ref: 'x', title: 'X' },
  ] });
  assert.deepEqual(pages.map((p) => `${p.type}:${p.ref}`), ['prompt:grok-skill-for-claude-code', 'post:proxmoxbox', 'share:atwellpub/abc123']);
  assert.equal(pages[2].title, 'atwellpub/abc123', 'an untitled share shows its reference');
  assert.deepEqual(pageCandidates(pages, 'SERVER').map((p) => p.ref), ['proxmoxbox']);
  assert.deepEqual(pageCandidates(pages, 'grok', STRANGER.items), []);
  assert.deepEqual(pageCandidates(pages, '   '), []);
  assert.deepEqual(pagesFromBuilt({}), [], 'a site built before the list existed gives no pages, not a failure');
});

test('the list line and the preview note say what the design says', () => {
  assert.equal(rowSummary(STRANGER), STRANGER.line);
  assert.equal(rowSummary({ layout: 'html', hosts: ['https://widgets.example-partner.com'] }), 'Partner code, loads from widgets.example-partner.com');
  assert.equal(rowSummary({ layout: 'html' }), 'Partner code');
  assert.equal(previewNote(draft()), 'Shows on 1 page once saved.');
  assert.equal(previewNote(draft({ items: [] })), 'Not on any page yet.');
  assert.equal(previewNote(draft({ enabled: false })), 'Disabled: this card shows on no page.');
  assert.equal(plural(0), '0 pages');
});
