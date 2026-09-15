// sow-337: the markup of the redesigned call-to-action manager (client-ui/src/cta-manager-view.mjs). What a superadmin
// types is escaped everywhere it is shown, the partner code never runs in the admin, each layout shows exactly its
// fields, messages wait for a save attempt, and every class the markup uses has a rule, so a renamed class cannot ship
// an unstyled editor.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listView, editorView, iconResults, candidateList, foundLine, previewCard, failedView, loadingView } from '../client-ui/src/cta-manager-view.mjs';
import { draftFromCta, blankDraft, validateDraft, foundHosts } from '../client-ui/src/cta-manager-core.mjs';
import { CTA_MANAGER_CSS } from '../client-ui/src/elements/cta-manager-css.mjs';
import { CTA_CARD_CSS, CTA_LAYOUTS } from '../membership/cta-card-render.mjs';

const HOSTILE = '"><img src=x onerror=alert(1)>';
const HTML_CARD = { id: 'partner-list', label: 'Reading', layout: 'html', partner: 'example', enabled: true,
  html: '</textarea><script>window.pwned=1</script>', hosts: ['https://widgets.example.com'], items: [] };
const ICON = { name: 'FaAmazon', set: 'Font Awesome 5', viewBox: '0 0 24 24', attrs: { fill: 'currentColor', stroke: 'currentColor', 'stroke-width': '0' }, shapes: [{ tag: 'path', attrs: { d: 'M0 0h24v24z' } }] };

function state(d, over = {}) {
  const st = { d, isNew: false, tried: false, saving: false, msg: '', msgKind: '', pickerOpen: false, iconQuery: '', iconSet: '',
    icons: { status: 'idle', total: 0, results: [], sets: [] }, hostDraft: '', hostErr: '', pageQuery: '', cands: [], drag: false,
    imageMsg: '', imageWork: false, pvDark: false, pvPhone: false, titleOf: (it) => it.ref, ...over };
  st.v = validateDraft(st.d, { isNew: st.isNew });
  return st;
}

test('the list escapes what a superadmin typed and draws the partner code as the inert notice', () => {
  const h = listView({ rows: [{ cta: { ...HTML_CARD, label: HOSTILE, partner: HOSTILE } }, { cta: { id: 'off', label: 'Off', layout: 'text', enabled: false, items: [{ type: 'post', ref: 'a' }] } }] });
  assert.equal(h.includes('<img src=x'), false);
  assert.equal(h.includes('<script>'), false, 'the partner code never reaches the admin page');
  assert.match(h, /Partner code runs on the live page/);
  assert.match(h, /<span class="badge on">Enabled<\/span><span class="badge">HTML block<\/span>/);
  assert.match(h, /data-act="toggle" data-id="off">Enable<\/button>/);
  assert.match(h, /· on 1 page<\/p>/);
  assert.match(listView({ rows: [] }), /No call-to-actions yet\./);
  assert.match(listView({ rows: [], msg: 'Nope', msgBad: true }), /<p class="msg bad">Nope<\/p>/);
});

test('loading and a failed load are their own states, the failure with Try again', () => {
  assert.match(loadingView(), /Loading call-to-actions/);
  const f = failedView('http-503 <b>');
  assert.match(f, /Could not load the call-to-actions \(http-503 &lt;b&gt;\)\./);
  assert.match(f, /data-act="retry">Try again<\/button>/);
});

test('each layout shows exactly its sections and fields', () => {
  const sections = (h) => [...h.matchAll(/<h4>([^<]+)<\/h4>/g)].map((m) => m[1]).filter((s) => s !== 'Preview' && s !== 'Outside addresses');
  const fields = (h) => [...h.matchAll(/data-f="([a-zA-Z]+)"/g)].map((m) => m[1]);
  const at = (layout) => editorView(state({ ...blankDraft(), layout }));
  assert.deepEqual(sections(at('below')), ['Layout', 'Words and link', 'Image', 'Button icon', 'Pages showing this card']);
  assert.deepEqual(sections(at('image')), ['Layout', 'Words and link', 'Image', 'Pages showing this card']);
  assert.deepEqual(sections(at('text')), ['Layout', 'Words and link', 'Button icon', 'Pages showing this card']);
  assert.deepEqual(sections(at('html')), ['Layout', 'Words and link', 'HTML block', 'Pages showing this card']);
  assert.deepEqual(fields(at('compact')), ['label', 'partner', 'line', 'button', 'destination', 'note', 'enabled']);
  assert.deepEqual(fields(at('image')), ['label', 'partner', 'destination', 'note', 'enabled']);
  assert.deepEqual(fields(at('html')), ['label', 'partner', 'note', 'enabled', 'showTitle', 'html']);
  assert.deepEqual(fields(editorView(state(blankDraft(), { isNew: true }))).slice(0, 1), ['id'], 'only a new card asks for the id');
  for (const L of CTA_LAYOUTS) assert.match(at(L), new RegExp(`class="tile on" type="button" data-act="layout" data-layout="${L}" aria-pressed="true"`));
});

test('the partner code is escaped inside its box and never drawn as code in the preview', () => {
  const st = state(draftFromCta(HTML_CARD));
  const h = editorView(st, foundHosts(st.d.html, st.d.hosts));
  assert.equal(h.includes('<script>'), false);
  assert.match(h, /&lt;\/textarea&gt;&lt;script&gt;window\.pwned=1&lt;\/script&gt;<\/textarea>/);
  assert.match(h, /This code runs on every page this card is on \(<span data-count>0 pages<\/span>\)/);
  assert.match(h, /<li class="host"><span class="mono">https:\/\/widgets\.example\.com<\/span>/);
  const words = editorView(state({ ...draftFromCta(HTML_CARD), layout: 'text', line: '</textarea><script>x()</script>', note: '</textarea><i data-leak>' }));
  assert.equal(words.includes('<script>') || words.includes('<i data-leak'), false, 'the sentence and the note are escaped inside their boxes too');
});

test('field messages wait for a save attempt, then show on their fields; a live one shows at once', () => {
  const d = { ...blankDraft(), label: '', destination: 'https://gbti.network/outbound/x/', partner: 'amazon' };
  const before = editorView(state(d));
  assert.match(before, /<label class="fld" data-fld="label">Title<input[^>]*><span class="et" data-err="label" hidden><\/span>/);
  assert.match(before, /<label class="fld err" data-fld="destination">/, 'an Amazon redirect is refused at once');
  const after = editorView(state(d, { tried: true, msg: 'Fix the highlighted fields to save.', msgKind: 'err' }));
  assert.match(after, /<label class="fld err" data-fld="label">Title<input[^>]*><span class="et" data-err="label">A title is required\.<\/span>/);
  assert.match(after, /<p class="msg bad" data-region="banner">Fix the highlighted fields to save\.<\/p>/);
});

test('the save button names the action and is disabled while saving', () => {
  assert.match(editorView(state(blankDraft(), { isNew: true })), /data-act="save">Add call-to-action<\/button>/);
  assert.match(editorView(state(blankDraft())), /data-act="save">Save<\/button>/);
  assert.match(editorView(state(blankDraft(), { saving: true })), /data-act="save" disabled>Saving…<\/button>/);
  assert.match(editorView(state({ ...blankDraft(), label: 'A <b>' })), /<h3 class="ed-title" data-region="title">Edit: A &lt;b&gt;<\/h3>/);
});

test('the preview fills empty words with placeholders, follows the theme and width, and draws no icon where the layout has no button', () => {
  const d = { ...blankDraft(), layout: 'text', icon: ICON };
  const light = previewCard(state(d));
  assert.match(light, /^<div class="pcta pv-card" style="--paper:#ffffff;/);
  assert.match(light, /<p class="pcta-eyebrow">Title<\/p><p class="pcta-line">The sentence the card shows\.<\/p><span class="pcta-btn" role="link"><svg class="pcta-ic"/);
  assert.match(previewCard(state(d, { pvDark: true, pvPhone: true })), /^<div class="pcta pv-card phone" style="--paper:#2d2a34;/);
  assert.equal(previewCard(state({ ...d, layout: 'html', html: '<b>x</b>' })).includes('pcta-ic'), false);
  assert.match(previewCard(state({ ...d, layout: 'image' })), /^<div class="pcta pv-card io"/);
});

test('the icon count, the empty and failed searches, and the chosen icon', () => {
  const ready = (over) => state({ ...blankDraft(), icon: ICON }, { pickerOpen: true, icons: { status: 'ready', total: 50903, results: [ICON, { ...ICON, set: 'Other' }], sets: [] }, ...over });
  assert.match(iconResults(ready()), /<p class="ip-count">50,903 icons<\/p>/);
  assert.match(iconResults(ready({ iconQuery: 'amazon', icons: { status: 'ready', total: 1, results: [ICON], sets: [] } })), /1 icon matches/);
  assert.match(iconResults(ready({ iconQuery: 'zzz', icons: { status: 'ready', total: 0, results: [], sets: [] } })), /No icons match\./);
  const cells = iconResults(ready({ iconQuery: 'amazon' }));
  assert.match(cells, /<button class="ic-cell on" type="button" data-act="icon" data-i="0" title="FaAmazon, Font Awesome 5">/);
  assert.match(cells, /<button class="ic-cell" type="button" data-act="icon" data-i="1"/, 'the same name in another set is not the chosen icon');
  assert.match(iconResults(ready({ icons: { status: 'failed', problem: 'the icon library returned 503' } })), /Could not load the icon library \(the icon library returned 503\)\.<\/p><button class="lk" type="button" data-act="icons-retry">Try again/);
  assert.match(editorView(ready()), /placeholder="Search about 50,000 icons, for example amazon"/);
});

test('page search results and "found in the code" escape what they show', () => {
  const st = state(blankDraft(), { pageQuery: 'x', cands: [{ type: 'post', ref: 'a', title: HOSTILE }] });
  assert.equal(candidateList(st).includes('<img'), false);
  assert.match(candidateList(st), /<span class="ty">Article<\/span>/);
  assert.match(candidateList(state(blankDraft(), { pageQuery: 'x' })), /No pages match\./);
  assert.equal(candidateList(state(blankDraft())), '');
  assert.match(foundLine(['https://a.example.com']), /Found in the code: <span class="mono">https:\/\/a\.example\.com<\/span><button class="lk" type="button" data-act="host-allow" data-host="https:\/\/a\.example\.com">Allow<\/button>/);
});

test('every class the manager markup uses has a rule in its stylesheet', () => {
  const css = CTA_MANAGER_CSS + CTA_CARD_CSS;
  const used = new Set();
  const collect = (h) => { for (const m of h.matchAll(/class="([^"]+)"/g)) for (const c of m[1].split(/\s+/)) used.add(c); };
  collect(listView({ rows: [{ cta: { ...HTML_CARD } }, { cta: { id: 'b', label: 'B', layout: 'below', enabled: false, image: 'b.webp' }, image: { url: '/b.webp' } }], msg: 'm', msgBad: true }));
  collect(failedView('x'));
  for (const L of CTA_LAYOUTS) {
    const d = { ...draftFromCta({ ...HTML_CARD, layout: L, icon: ICON, items: [{ type: 'post', ref: 'a' }] }), hosts: [] };
    collect(editorView(state(d, { tried: true, msg: 'm', msgKind: 'err', pickerOpen: true, icons: { status: 'ready', total: 1, results: [ICON], sets: [{ id: 'fa', name: 'Font Awesome 5' }] }, imageWork: true, imageMsg: 'x', drag: true }), ['https://a.example.com']));
    collect(editorView(state({ ...d, image: { kind: 'upload', url: 'data:image/webp;base64,', width: 1, height: 1, bytes: 1 } }, { pvDark: true, pvPhone: true, pageQuery: 'x', cands: [{ type: 'post', ref: 'a', title: 'A' }] })));
  }
  const missing = [...used].filter((c) => !new RegExp(`\\.${c.replace(/[-]/g, '\\-')}(?![\\w-])`).test(css));
  assert.deepEqual(missing, [], `classes with no rule: ${missing.join(', ')}`);
});
