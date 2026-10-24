// 2026-10-24, owner: "when creating a new article the permalink needs to autogenerate based on the title." Nothing
// derived one before (eb618032 said so), so an author typed it by hand or met "Add a permalink first". The permalink
// now follows the title on an item that has never been published, until the author types their own; clearing the box
// hands it back; a published item's permalink never moves by itself. Pins the shared rule and the editor's real
// handlers, driven through a bare editor with fake page parts (the pattern editor-held-images.test.mjs uses).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { slugFromTitle, SLUG_PATTERN, TITLE_SLUG_MAX } from '../membership/item-id.mjs';
import { GbtiContentEditor } from '../client-ui/src/elements/gbti-content-editor.mjs';

const SLUG_RE = new RegExp(`^${SLUG_PATTERN}$`);

// ---- the rule ------------------------------------------------------------------------------------------------------

test('slugFromTitle: the reported title, accents, apostrophes, punctuation, emoji and spacing', () => {
  assert.equal(slugFromTitle('A Crystal Ball for the Next Digital Agency'), 'a-crystal-ball-for-the-next-digital-agency');
  assert.equal(slugFromTitle('Don’t Panic: Café Résumé 2026!'), 'dont-panic-cafe-resume-2026');
  assert.equal(slugFromTitle("It's the Fourth"), 'its-the-fourth');
  assert.equal(slugFromTitle('  🚀  Rockets &   roads  '), 'rockets-roads');
  assert.equal(slugFromTitle('Who Runs the .com Internet? Top DNS Providers'), 'who-runs-the-com-internet-top-dns-providers');
  assert.equal(slugFromTitle('!!!'), '');
  assert.equal(slugFromTitle(''), '');
  assert.equal(slugFromTitle(null), '');
});

test('slugFromTitle: a long title is cut at a hyphen within the limit, and every result fits the slug pattern', () => {
  const long = slugFromTitle(`A ${'wordy '.repeat(30)}end`);
  assert.ok(long.length <= TITLE_SLUG_MAX, `${long.length} characters`);
  assert.ok(!long.endsWith('-'));
  assert.ok(/^a(-wordy)+$/.test(long), 'no word was split');
  assert.equal(slugFromTitle('x'.repeat(100)).length, TITLE_SLUG_MAX, 'one giant word is cut hard');
  for (const t of ['A Crystal Ball', 'Ünïcödé Tïtle', '2026: the year', '--lead and trail--', 'é', 'C++ & C#', long]) {
    const s = slugFromTitle(t);
    assert.ok(s === '' || SLUG_RE.test(s), `${JSON.stringify(t)} -> ${JSON.stringify(s)}`);
  }
});

// ---- the editor ----------------------------------------------------------------------------------------------------

function element(props = {}) {
  const listeners = {};
  return {
    ...props,
    addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    fire(type) { for (const fn of listeners[type] || []) fn({ target: this }); },
    closest: () => null,
  };
}

function editor({ slug = '', title = '', itemPath = null } = {}) {
  const el = Object.create(GbtiContentEditor.prototype);
  const titleEl = element({ textContent: title });
  const slugField = element({ value: slug });
  const mirror = { value: slug };
  const inline = { textContent: slug };
  el.type = 'post';
  el.itemPath = itemPath;
  el.preset = { input: { slug, title } };
  el._slugVal = null;
  el._slugOwned = null;
  el.$ = (sel) => ({ '#slugfield': slugField, '[data-key="slug"]': mirror })[sel] ?? null;
  el.root = { querySelector: (sel) => ({ '[data-header="title"]': titleEl, '.doc-slug .slug-val': inline })[sel] ?? null };
  el._wirePermalinkField();
  const typeTitle = (t) => { titleEl.textContent = t; titleEl.fire('input'); };
  const typeSlug = (s) => { slugField.value = s; slugField.fire('input'); };
  const shown = () => ({ field: slugField.value, gathered: mirror.value, inline: inline.textContent });
  return { el, typeTitle, typeSlug, shown };
}

const all = (v) => ({ field: v, gathered: v, inline: v });

test('a new item: typing the title fills the permalink box, the gathered value and the inline display', () => {
  const { typeTitle, shown } = editor();
  typeTitle('A Crystal');
  assert.deepEqual(shown(), all('a-crystal'));
  typeTitle('A Crystal Ball for the Next Digital Agency');
  assert.deepEqual(shown(), all('a-crystal-ball-for-the-next-digital-agency'));
});

test('typing in the permalink box takes it over; clearing the box hands it back to the title', () => {
  const { typeTitle, typeSlug, shown } = editor();
  typeTitle('First title');
  typeSlug('my-own-link');
  typeTitle('A different title');
  assert.deepEqual(shown(), all('my-own-link'), 'the title no longer changes it');
  typeSlug('');
  typeTitle('A different title again');
  assert.deepEqual(shown(), all('a-different-title-again'), 'cleared, it follows the title again');
});

test('a published item never follows its title, even when its permalink still matches the title', () => {
  // The permalink matches its title on purpose: only the published rule stands between it and following.
  const { el, typeTitle, shown } = editor({ slug: 'old-title', title: 'Old title', itemPath: 'members/a/posts/old-title/index.md' });
  typeTitle('A brand new title');
  assert.deepEqual(shown(), all('old-title'));
  assert.equal(el._followTitleSlug(), false);
});

test('a draft opened with no permalink takes one from its title, once; a hand-chosen one is kept', () => {
  const empty = editor({ title: 'Hello World' });
  assert.equal(empty.el._followTitleSlug(), true, 'filled, so the editor marks the draft changed');
  assert.deepEqual(empty.shown(), all('hello-world'));
  assert.equal(empty.el._followTitleSlug(), true, 'still an unsaved change on the next render');
  assert.deepEqual(empty.shown(), all('hello-world'));

  const chosen = editor({ slug: 'my-pick', title: 'Hello World' });
  assert.equal(chosen.el._followTitleSlug(), false);
  chosen.typeTitle('Hello Again');
  assert.deepEqual(chosen.shown(), all('my-pick'), 'a loaded permalink that is not the title\'s was chosen by hand');

  const matching = editor({ slug: 'hello-world', title: 'Hello World' });
  matching.typeTitle('Hello Again');
  assert.deepEqual(matching.shown(), all('hello-again'), 'one that still matches its title keeps following');
});

test('a later render that draws the loaded empty permalink is put back, box and hidden input alike', () => {
  // Found driving the real editor: it renders more than once while it loads, and each render draws the box and the
  // hidden input Save reads from the LOADED permalink. The first render filled them; the next drew them empty again.
  const { el, shown } = editor({ title: 'Hello World' });
  el._followTitleSlug();
  el.$('#slugfield').value = '';
  el.$('[data-key="slug"]').value = '';
  el.root.querySelector('.doc-slug .slug-val').textContent = '';
  assert.equal(el._followTitleSlug(), true);
  assert.deepEqual(shown(), all('hello-world'), 'what Save reads matches the box again');
});

test('a render that draws the box right but the hidden input Save reads from the loaded value is caught', () => {
  // The likeliest real redraw: the box is drawn from the editor's own value, the hidden input from the loaded one.
  const { el, shown } = editor({ title: 'Hello World' });
  el._followTitleSlug();
  el.$('[data-key="slug"]').value = '';
  assert.equal(el._followTitleSlug(), true);
  assert.deepEqual(shown(), all('hello-world'));
});

test('a permalink the author typed survives a later render too', () => {
  const { el, typeSlug, shown } = editor({ title: 'Hello World' });
  typeSlug('my-pick');
  el.$('#slugfield').value = '';
  el.$('[data-key="slug"]').value = '';
  assert.equal(el._followTitleSlug(), true);
  assert.deepEqual(shown(), all('my-pick'));
});

test('the editor fills on open after it resets its unsaved flag, and decides ownership afresh per item', () => {
  const src = fs.readFileSync(new URL('../client-ui/src/elements/gbti-content-editor.mjs', import.meta.url), 'utf8');
  // Each pin matches a LIVE line (leading spaces, then code), so a commented-out line does not satisfy it.
  const at = (re) => { const m = re.exec(src); return m ? m.index : -1; };
  const reset = at(/^\s+this\._dirty = false;/m);
  const bind = at(/^\s+this\._bindHeader\(\);/m);
  const fill = at(/^\s+if \(this\._followTitleSlug\(\)\) this\._markDirty\(\);/m);
  assert.ok(reset > -1 && bind > reset && fill > bind, 'after the reset and the title binding, so it counts as a change');
  const load = at(/^\s+this\._slugVal = null;/m);
  const owned = at(/^\s+this\._slugOwned = null;/m);
  assert.ok(load > -1 && owned > load && owned - load < 200, 'reset beside the per-load permalink value');
});
