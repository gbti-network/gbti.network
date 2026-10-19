// A list item whose text wraps onto an indented line stays ONE item through an editor load and save (2026-10-17).
// The editor used to end the list at the wrapped line, and since it rewrites the whole body on every save, the file
// gained a blank line mid-sentence: "...HTTP audio, and" / "compatible broadcast endpoints." on gbti.network and in the
// dev.to draft. It happened unnoticed three times (2026-07-06, 2026-08-23, 2026-10-14). The same pass keeps a
// horizontal rule like `* * *` a rule (read as a list, a save turned it into a bullet showing "* *"), and keeps a
// numbered list written with blank lines between its items counting 1, 2, 3 instead of 1, 1, 1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { parseBlocks, serializeBlocks } from '../client-ui/src/markdown-blocks.mjs';
import { takeListRun, isListLine, isThematicBreak } from '../client/src/list-items.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';

const save = (md) => serializeBlocks(parseBlocks(md)); // exactly what the editor's value setter and getter do
const ROOT = new URL('..', import.meta.url).pathname;

// The site's own reading of every list item: its text, with a hard break shown as " / " and nested lists left out.
function liTexts(md) {
  const out = [];
  const visit = (n) => {
    if (n.type === 'listItem') {
      const t = [];
      const txt = (x) => { if (x.type === 'text' || x.type === 'inlineCode') t.push(x.value); if (x.type === 'break') t.push(' / '); (x.children || []).filter((c) => c.type !== 'list').forEach(txt); };
      txt(n);
      out.push(t.join(' ').replace(/\s+/g, ' ').trim());
    }
    (n.children || []).forEach(visit);
  };
  visit(unified().use(remarkParse).parse(md));
  return out;
}

// The Jockey Radio list exactly as it was before the damaging save (commit e9c70bd6).
const JOCKEY = `Each radio disc plays one source:

- **HLS and internet radio:** HLS playlists, SavePoint station streams, Icecast streams, HTTP audio, and
  compatible broadcast endpoints.
- **RTMP receive:** the Minecraft server becomes an RTMP ingest endpoint, so you can broadcast directly from
  OBS, SavePoint, or other broadcasting software or relays.
- **Direct URLs and local audio:** play a direct audio URL or loop a file kept on the server.
- **SavePoint:** connect a SavePoint station over HLS, or push a live SavePoint broadcast into Minecraft over
  RTMP. The [Now Playing API](https://savepoint.fm/docs/api/now-playing-api) shows the current track in the
  boss bar.

## The /jockey disc manager`;

test('a wrapped list item survives a save byte for byte, and reads as one item', () => {
  assert.equal(save(JOCKEY), JOCKEY);
  assert.deepEqual(liTexts(save(JOCKEY)), liTexts(JOCKEY));
  assert.equal(liTexts(JOCKEY)[0], 'HLS and internet radio: HLS playlists, SavePoint station streams, Icecast streams, HTTP audio, and compatible broadcast endpoints.');
  const items = takeListRun(JOCKEY.split('\n'), 2).items;
  assert.equal(items.length, 4);
  assert.equal(items[3].text.split('\n').length, 3, 'two wrapped lines stay with the SavePoint item');
});

test('a numbered list keeps its numbers when its items wrap', () => {
  const md = '1. **Overflow fix:** set a max width.\n   Use when a row scrolls sideways.\n2. **Tap target fix:** make it 44 pixels.\n   Use when buttons are too small.\n3. **Font fix:** raise the base size.';
  assert.equal(save(md), md, 'not five lists of "1."');
});

test('a numbered list written with blank lines between its items keeps counting through a save', () => {
  // The prompt's own shape (2026-07-06 it was saved as five "1." items).
  const md = '1. Compression fix:\n   Use when the structure works.\n\n2. Layout preservation fix:\n   Use when it should keep its shape.\n\n3. Structural redesign fix:\n   Use only when nothing else works.';
  assert.equal(save(md), md);
  const html = renderMarkdown(md);
  assert.match(html, /<ol start="2"><li>Layout preservation fix: Use when it should keep its shape\.<\/li><\/ol>/, html);
  assert.match(html, /<ol start="3">/);
  // Lists that are not consecutive still start at 1.
  assert.equal(save('1. a\n2. b\n\nA paragraph.\n\n1. c'), '1. a\n2. b\n\nA paragraph.\n\n1. c');
});

test('a hard break inside an item is kept, and the reading view shows it as a line break', () => {
  const md = '1. **"Silent Light"**  \n   _Used in eerie or mysterious locations._\n2. **"Ruined World"**  \n   _Reflecting the desolation of a post-apocalyptic future._';
  assert.equal(save(md), md);
  assert.deepEqual(liTexts(md), ['"Silent Light" / Used in eerie or mysterious locations.', '"Ruined World" / Reflecting the desolation of a post-apocalyptic future.']);
  const html = renderMarkdown(md);
  assert.match(html, /<li><strong>&quot;Silent Light&quot;<\/strong><br \/><em[^>]*>Used in eerie or mysterious locations\.<\/em><\/li>/, html);
});

test('the reading view keeps a soft-wrapped item in one <li> with a space, not a second paragraph', () => {
  const html = renderMarkdown(JOCKEY);
  assert.match(html, /HTTP audio, and compatible broadcast endpoints\.<\/li>/, html);
  assert.doesNotMatch(html, /<p>\s*compatible broadcast endpoints/);
});

test('a line that opens its own block under an item is not swallowed into it', () => {
  for (const [opener, label] of [['```js', 'a code fence'], ['> a quote', 'a quote'], ['## A heading', 'a heading'], ['| a | b |', 'a table'], ['<div>x</div>', 'raw HTML']]) {
    const items = takeListRun(['- an item', `  ${opener}`], 0).items;
    assert.deepEqual(items.map((x) => x.text), ['an item'], label);
  }
  assert.deepEqual(takeListRun(['- an item', '', '  after a blank'], 0).items.map((x) => x.text), ['an item'], 'a blank line ends the item');
  assert.deepEqual(takeListRun(['- an item', 'not indented'], 0).items.map((x) => x.text), ['an item'], 'an unindented line is not taken');
});

test('a horizontal rule is a rule, not a list item, and survives a save', () => {
  for (const r of ['* * *', '***', '- - -', '---', '___']) {
    assert.equal(isThematicBreak(r), true, r);
    assert.equal(isListLine(r), false, r);
  }
  assert.equal(isListLine('- item'), true);
  assert.equal(isListLine('* a * b'), true, 'a starred item is still an item');
  const md = 'Before.\n\n* * *\n\n- [X](https://x.com/gbti_network)\n- [GitHub](https://github.com/gbti-network)';
  assert.equal(save(md), md);
  assert.match(renderMarkdown(md), /<hr \/>/);
  assert.doesNotMatch(renderMarkdown(md), /<li>\* \*<\/li>/);
});

// Every member file, loaded and saved through the editor, must read the same afterwards, list item for list item. This
// would have caught all three past incidents. Two files are known to differ for older reasons outside this fix:
const KNOWN = new Map([
  // A code fence indented inside a numbered item: the editor has never understood a fence inside a list item.
  ['members/atwellpub/prompts/farley-file-skill-for-claude-code/SKILL.md', 'fence inside a list item'],
  // A WordPress import with three spaces after each marker inside a backslash-escaped pseudo-fence; the editor's
  // marker-spacing tidy shifts that nesting. Visible only in this one imported post.
  ['members/gbtilabs/posts/what-is-markdown/index.md', 'marker spacing in an escaped pseudo-fence'],
]);

test('no member file\'s list items change when it is saved through the editor', () => {
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name.endsWith('.md')) files.push(p); } };
  walk(path.join(ROOT, 'members'));
  walk(path.join(ROOT, 'house'));
  assert.ok(files.length > 150, `the corpus was found (${files.length} files)`);
  const changed = [];
  let withLists = 0;
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const raw = fs.readFileSync(f, 'utf8');
    const fm = /^---\n[\s\S]*?\n---\n?/.exec(raw);
    const body = fm ? raw.slice(fm[0].length) : raw;
    if (!/^\s*([-*]|\d+\.)\s/m.test(body)) continue;
    withLists++;
    if (JSON.stringify(liTexts(body)) !== JSON.stringify(liTexts(save(body)))) changed.push(rel);
  }
  assert.ok(withLists > 50, `files with lists were checked (${withLists})`);
  const unexpected = changed.filter((f) => !KNOWN.has(f));
  assert.deepEqual(unexpected, [], 'a save would change how these files read');
});
