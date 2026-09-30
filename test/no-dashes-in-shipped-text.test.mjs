// Owner, 2026-09-30: every em or en dash in text the network ships is rewritten, "and add a check" so none comes back.
// The writing rule covers user-facing strings wherever they live: admin screens, error messages, page titles, the
// text scripts post to pull requests and social channels. It does not cover code comments, and it allows a dash used
// as a SEPARATOR inside a dropdown or picker (the category path separator, PATH_SEP).
//
// How it reads the source, so a comment never trips it and a string never slips past:
//   - .mjs / .js: acorn's tokenizer. Only string and template tokens are checked, by their RAW source text, so a
//     comment or a regular expression is never a subject and an escaped `\u2014` (the entity decoder) is not a dash.
//   - .ts: esbuild strips the types and the comments first, then the same tokenizer.
//   - .astro: the frontmatter and every <script> are code (as .ts); the template is page text with its comments,
//     styles and expressions' comments removed.
//   - extension/*.html: page text, without comments, <style> and <script>.
// CSS or HTML comments written INSIDE a template string (component style sheets do this) are removed before checking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const esbuild = require('esbuild');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DASH = /[\u2013\u2014]/;
const SHIPPED = /^(client-ui\/src|client\/src|extension\/src|membership|workers|scripts\/lib|src)\//;

// A dash that is allowed where it stands: [file, the exact raw token].
const ALLOWED = [
  ['client-ui/src/category-picker-core.mjs', "' \u2014 '"], // PATH_SEP, the dropdown path separator (owner, 2026-09-24)
];

// Comments written inside a template: CSS and HTML comments, and whole-line `//` comments of an inline <script> in a
// page template (a line that STARTS with `//`, so a URL's `https://` is never mistaken for one).
const stripEmbeddedComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/^[ \t]*\/\/.*$/gm, '');

/** Every string and template token in a piece of JavaScript that carries a dash, as { text, line }. */
export function dashedTokens(code) {
  const out = [];
  let tok;
  const tz = acorn.tokenizer(code, { ecmaVersion: 'latest', sourceType: 'module', allowHashBang: true, locations: true });
  while ((tok = tz.getToken()).type !== acorn.tokTypes.eof) {
    const kind = tok.type.label;
    if (kind !== 'string' && kind !== 'template') continue;
    const raw = code.slice(tok.start, tok.end);
    const text = kind === 'template' ? stripEmbeddedComments(raw) : raw;
    if (DASH.test(text)) out.push({ text: raw.trim().slice(0, 120), line: tok.loc.start.line });
  }
  return out;
}

// charset utf8: by default esbuild escapes every non-ASCII character, which would hide the dash from the tokenizer.
const ts = (code) => esbuild.transformSync(code, { loader: 'ts', format: 'esm', target: 'es2022', charset: 'utf8' }).code;

/** The page text of an .astro template or an .html page: markup outside code, comments and styles. */
export function pageText(markup) {
  return markup
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
}

/** The dashes in one file's shipped text, as [{ text, line? }]. */
export function dashesIn(file, src) {
  if (file.endsWith('.mjs') || file.endsWith('.js')) return dashedTokens(src);
  if (file.endsWith('.ts')) return dashedTokens(ts(src)).map(({ text }) => ({ text }));
  if (file.endsWith('.html')) return DASH.test(pageText(src)) ? [{ text: pageText(src).split('\n').find((l) => DASH.test(l)).trim() }] : [];
  if (file.endsWith('.astro')) {
    const found = [];
    const fm = /^---\n([\s\S]*?)\n---/.exec(src);
    if (fm) found.push(...dashedTokens(ts(fm[1])).map(({ text }) => ({ text })));
    const rest = fm ? src.slice(fm[0].length) : src;
    // Scripts in the template only (the frontmatter can mention `<script>` in a comment). A self-closing tag or one
    // filled by set:html (JSON such as speculation rules) carries no code to read.
    for (const m of rest.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      if (/\/\s*$/.test(m[1]) || /set:html|type="(?!module|text\/javascript)/.test(m[1])) continue;
      found.push(...dashedTokens(ts(m[2])).map(({ text }) => ({ text })));
    }
    const body = pageText(rest);
    for (const l of body.split('\n')) if (DASH.test(l)) found.push({ text: l.trim().slice(0, 120) });
    return found;
  }
  return [];
}

function shippedFiles() {
  return execSync("git ls-files '*.mjs' '*.js' '*.ts' '*.astro' 'extension/*.html'", { cwd: ROOT, encoding: 'utf8' })
    .trim().split('\n')
    .filter((f) => f && (SHIPPED.test(f) || /^extension\/[^/]+\.html$/.test(f)));
}

test('no em or en dash in any text the network ships', () => {
  const files = shippedFiles();
  assert.ok(files.length > 500, `the scan found only ${files.length} files, so it proved nothing`);
  const hits = [];
  for (const f of files) {
    for (const h of dashesIn(f, fs.readFileSync(path.join(ROOT, f), 'utf8'))) {
      if (ALLOWED.some(([af, raw]) => af === f && h.text === raw)) continue;
      hits.push(`${f}${h.line ? `:${h.line}` : ''}  ${h.text}`);
    }
  }
  assert.deepEqual(hits, [], `Rewrite with a comma, colon or full stop:\n  ${hits.join('\n  ')}`);
});

test('the reader finds a dash in shipped text and never in a comment or a regular expression', () => {
  assert.equal(dashedTokens("const a = 'one \u2014 two';").length, 1, 'a string');
  assert.equal(dashedTokens('const a = `one ${x} two \u2013 three`;').length, 1, 'a template');
  assert.equal(dashedTokens('// one \u2014 two\n/* three \u2014 four */ const a = 1;').length, 0, 'comments');
  assert.equal(dashedTokens('const r = /[\u2014\u2013]/;').length, 0, 'a regular expression');
  assert.equal(dashedTokens("const e = '\\u2014';").length, 0, 'an escaped dash is not a dash');
  assert.equal(dashedTokens('const css = `.a { color:red; } /* x \u2014 y */`;').length, 0, 'a CSS comment inside a template');
  assert.equal(dashedTokens('const page = `<script>\n  // a \u2014 b\n  go();\n</script><a href="https://x">y</a>`;').length, 0, 'a script comment inside a page template');
  assert.equal(dashedTokens('const page = `<p>see https://x \u2014 now</p>`;').length, 1, 'but text after a URL is still text');
  assert.equal(dashesIn('x.ts', "const a: string = 'one \u2014 two'; // fine \u2014 here").length, 1, '.ts: the string, not the comment');
  assert.equal(dashesIn('x.astro', "---\nconst a = 1; // ok \u2014 here\n---\n<!-- ok \u2014 here -->\n<p>one \u2014 two</p>\n").length, 1, '.astro: the page text only');
  assert.equal(dashesIn('x.html', '<style>/* ok \u2014 */</style><p>fine</p>').length, 0, '.html: a style comment is not text');
});
