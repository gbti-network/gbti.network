// sow-337: the page policies for call-to-action HTML blocks (scripts/lib/cta-headers.mjs, scripts/compose-headers.mjs)
// and the guard that recomputes them (scripts/check-headers.mjs). A card page gets the site policy plus its card's
// outside addresses in five lists and nothing else; every other page keeps the site policy; the Cloudflare limits
// stop the build with a plain message; and the guard catches a stale, missing, extra or loosened rule.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { htmlCardIds, isCardRoutePath, scanHtmlCardPages, cardPolicy, cardRules, composeCardHeaders, siteRule, CARD_POLICY_DIRECTIVES, HEADER_LIMITS } from '../scripts/lib/cta-headers.mjs';
import { main as composeMain } from '../scripts/compose-headers.mjs';
import { checkHeaders, parseHeaders, parseCsp, cspForPath } from '../scripts/check-headers.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const BASE = fs.readFileSync(path.join(ROOT, 'public/_headers'), 'utf8');
const SITE = siteRule(BASE).value;
const WIDGETS = 'https://widgets.example-partner.com';
const CDN = 'https://*.cdn.example.net';
const card = (over = {}) => ({ id: 'partner-reading-list', label: 'Reading', layout: 'html', partner: 'example-partner', html: '<script src="https://widgets.example-partner.com/w.js"></script>', hosts: [WIDGETS, CDN], enabled: true, items: [{ type: 'prompt', ref: 'a-prompt' }], ...over });
// The wrapper CtaCard.astro renders, attribute order as Astro writes it.
const cardDiv = (id, layout = 'html') => `<div class="pcta card pcta-l-${layout}" data-cta="${id}" data-cta-partner="example-partner" data-cta-layout="${layout}"><style>.pcta{}</style>`;

function site({ pages = {}, registry = { ctas: [card()] } } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-cta-headers-'));
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(root, 'house'), { recursive: true });
  fs.writeFileSync(path.join(root, 'public/_headers'), BASE);
  fs.writeFileSync(path.join(root, 'house/ctas.yml'), yaml.dump(registry));
  for (const [url, html] of Object.entries(pages)) {
    fs.mkdirSync(path.join(root, 'dist', url), { recursive: true });
    fs.writeFileSync(path.join(root, 'dist', url, 'index.html'), `<!doctype html><html><body>${html}</body></html>`);
  }
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/_headers'), BASE);
  return root;
}
const quiet = (fn) => { const { log, error } = console; console.log = () => {}; console.error = () => {}; try { return fn(); } finally { console.log = log; console.error = error; process.exitCode = 0; } };

test('the component still stamps the attributes the scan reads', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src/components/CtaCard.astro'), 'utf8');
  assert.match(src, /data-cta=\{cta\.id\}[^>]*data-cta-layout=\{layout\}/);
});

test('a page\'s HTML block cards are found by their wrapper, in any attribute order, and other layouts are not', () => {
  assert.deepEqual(htmlCardIds(`${cardDiv('a')}${cardDiv('b', 'below')}<div data-cta-layout="html" class="x" data-cta="c">${cardDiv('a')}`), ['a', 'c']);
  assert.deepEqual(htmlCardIds('<p data-cta-layout="html">not a div</p>'), []);
});

test('the scan covers the four routes that mount a card, and nothing else', () => {
  const root = site({ pages: {
    'prompts/a-prompt': cardDiv('partner-reading-list'), 'articles/an-article': cardDiv('partner-reading-list'),
    'projects/a-project': cardDiv('x', 'text'), 'shares/atwellpub/abc123': cardDiv('partner-reading-list'),
    'feeds/all': cardDiv('partner-reading-list'), 'prompts/plain': '<main></main>',
  } });
  try {
    assert.deepEqual(scanHtmlCardPages(path.join(root, 'dist')), [
      { path: '/articles/an-article/', ids: ['partner-reading-list'] },
      { path: '/prompts/a-prompt/', ids: ['partner-reading-list'] },
      { path: '/shares/atwellpub/abc123/', ids: ['partner-reading-list'] },
    ]);
    for (const p of scanHtmlCardPages(path.join(root, 'dist'))) assert.equal(isCardRoutePath(p.path), true, p.path);
    for (const p of ['/embed/*', '/tools/email-signature-generator/*', '/feeds/all/', '/*', '/promptsx/a/']) assert.equal(isCardRoutePath(p), false, p);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a card policy is the site policy with the addresses added to exactly the five lists, once each', () => {
  const v = cardPolicy(SITE, [WIDGETS, CDN, 'https://challenges.cloudflare.com']);
  const site = parseCsp(SITE);
  const got = parseCsp(v);
  assert.deepEqual([...got.keys()], [...site.keys()], 'same directives, same order');
  for (const [name, d] of site) {
    const tokens = got.get(name).tokens;
    if (CARD_POLICY_DIRECTIVES.includes(name)) {
      assert.deepEqual(tokens.slice(0, d.tokens.length), d.tokens, `${name} keeps the site sources first`);
      assert.ok(tokens.includes(WIDGETS) && tokens.includes(CDN), name);
      assert.equal(tokens.filter((t) => t === 'https://challenges.cloudflare.com').length, 1, `${name}: added once, and not repeated where the site already lists it`);
    } else {
      assert.deepEqual(tokens, d.tokens, `${name} is untouched`);
    }
  }
  for (const name of ['frame-ancestors', 'object-src', 'base-uri', 'default-src', 'img-src', 'form-action']) assert.deepEqual(got.get(name).tokens, site.get(name).tokens);
});

test('the composed file keeps the committed base and replaces the policy only on card pages', () => {
  const pages = [{ path: '/prompts/a-prompt/', ids: ['partner-reading-list'] }, { path: '/prompts/no-hosts/', ids: ['quiet'] }];
  const registry = { ctas: [card(), card({ id: 'quiet', hosts: undefined })] };
  const { text, rules, problems } = composeCardHeaders(BASE, pages, registry);
  assert.deepEqual(problems, []);
  assert.ok(text.startsWith(BASE.replace(/\s+$/, '')), 'the committed base is kept verbatim');
  assert.deepEqual(rules.map((r) => r.path), ['/prompts/a-prompt/'], 'a card with no outside addresses needs no rule');
  const parsed = parseHeaders(text);
  assert.equal(cspForPath(parsed, '/prompts/a-prompt/'), cardPolicy(SITE, [WIDGETS, CDN]));
  assert.equal(cspForPath(parsed, '/prompts/other/'), SITE, 'every other page keeps the site policy');
  assert.equal(cspForPath(parsed, '/prompts/no-hosts/'), SITE);
  assert.match(text, /\n# partner-reading-list\n\/prompts\/a-prompt\/\n {2}! Content-Security-Policy\n {2}Content-Security-Policy: default-src 'self';/);
  assert.deepEqual(composeCardHeaders(BASE, [], registry), { text: `${BASE.replace(/\s+$/, '')}\n`, rules: [], problems: [] });
});

test('a Report-Only site policy is extended under the same header name', () => {
  const ro = BASE.replace('  Content-Security-Policy: default-src', '  Content-Security-Policy-Report-Only: default-src');
  const { text } = composeCardHeaders(ro, [{ path: '/prompts/a-prompt/', ids: ['partner-reading-list'] }], { ctas: [card()] });
  assert.match(text, /! Content-Security-Policy-Report-Only\n {2}Content-Security-Policy-Report-Only: /);
});

test('Cloudflare\'s limits stop the build with a plain message, holding one rule back for the preview site', () => {
  const at = (n) => Array.from({ length: n }, (_, i) => ({ path: `/prompts/p${i}/`, ids: ['partner-reading-list'] }));
  const baseRules = parseHeaders(BASE).length;
  const fits = HEADER_LIMITS.rules - HEADER_LIMITS.reserved - baseRules;
  assert.deepEqual(composeCardHeaders(BASE, at(fits), { ctas: [card()] }).problems, []);
  const over = composeCardHeaders(BASE, at(fits + 1), { ctas: [card()] });
  assert.equal(over.problems.length, 1);
  assert.match(over.problems[0], new RegExp(`needs ${HEADER_LIMITS.rules} header rules, and Cloudflare allows ${HEADER_LIMITS.rules} \\(one is kept for the preview site's noindex rule\\)`));
  const long = Array.from({ length: 8 }, (_, i) => `https://${'a'.repeat(60)}${i}.example.com`);
  const wide = composeCardHeaders(BASE, at(1), { ctas: [card({ hosts: long })] });
  assert.match(wide.problems[0], /^the policy for \/prompts\/p0\/ is \d+ characters with the addresses of partner-reading-list, and Cloudflare allows 2000 on one line/);
});

test('a page showing a card the registry does not have, or a malformed address, is a problem, not a silent skip', () => {
  const r = cardRules([{ path: '/prompts/x/', ids: ['gone'] }], { ctas: [] }, SITE);
  assert.match(r.problems[0], /shows the call-to-action "gone", which is not in house\/ctas\.yml/);
  const bad = cardRules([{ path: '/prompts/x/', ids: ['partner-reading-list'] }], { ctas: [card({ hosts: ["https://a.com; script-src 'unsafe-eval'"] })] }, SITE);
  assert.match(bad.problems[0], /is not a bare https address/);
  assert.deepEqual(bad.rules, []);
});

test('the build step writes the composed file, and on a problem writes nothing and fails', () => {
  const root = site({ pages: { 'prompts/a-prompt': cardDiv('partner-reading-list') } });
  try {
    const r = quiet(() => composeMain({ root }));
    assert.deepEqual(r.rules.map((x) => x.path), ['/prompts/a-prompt/']);
    assert.match(fs.readFileSync(path.join(root, 'dist/_headers'), 'utf8'), /\/prompts\/a-prompt\/\n {2}! Content-Security-Policy/);
    assert.deepEqual(checkHeaders({ root }).errors, [], 'the guard agrees with what the step wrote');
    fs.writeFileSync(path.join(root, 'dist/_headers'), BASE);
    fs.writeFileSync(path.join(root, 'house/ctas.yml'), yaml.dump({ ctas: [] }));
    let code;
    quiet(() => { composeMain({ root }); code = process.exitCode; });
    assert.equal(code, 1);
    assert.equal(fs.readFileSync(path.join(root, 'dist/_headers'), 'utf8'), BASE, 'nothing written');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the guard fails when the composer did not run, and when a card rule is stale, extra or loosened', () => {
  const root = site({ pages: { 'prompts/a-prompt': cardDiv('partner-reading-list'), 'prompts/plain': '<main></main>' } });
  const headers = path.join(root, 'dist/_headers');
  const errorsWith = (text) => { fs.writeFileSync(headers, text); return checkHeaders({ root }).errors; };
  try {
    assert.match(errorsWith(BASE).join('\n'), /\/prompts\/a-prompt\/ shows the call-to-action HTML block "partner-reading-list" but dist\/_headers does not replace its policy/);
    quiet(() => composeMain({ root }));
    const good = fs.readFileSync(headers, 'utf8');
    const ok = checkHeaders({ root });
    assert.deepEqual(ok.errors, []);
    assert.equal(ok.checked, 4, 'the site policy, the two relay policies and the card page');

    const extraHost = good.replace(`script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com ${WIDGETS}`, `script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://static.cloudflareinsights.com ${WIDGETS} https://evil.example.com`);
    assert.notEqual(extraHost, good);
    assert.match(errorsWith(extraHost).join('\n'), /the policy served for \/prompts\/a-prompt\/ is not the one its card needs/);

    const framed = good.replace(/(\/prompts\/a-prompt\/\n(?:.*\n)*? {2}Content-Security-Policy: [^\n]*?)frame-ancestors 'self'/, "$1frame-ancestors 'self' https://evil.example.com");
    assert.notEqual(framed, good);
    assert.match(errorsWith(framed).join('\n'), /changes frame-ancestors .*must stay 'self'/);

    const evalAdded = good.replace(new RegExp(`(\\n {2}Content-Security-Policy: [^\\n]*script-src [^;]*)${WIDGETS.replace(/[.]/g, '\\.')}`), `$1${WIDGETS} 'unsafe-eval'`);
    assert.notEqual(evalAdded, good);
    assert.match(errorsWith(evalAdded).join('\n'), /adds 'unsafe-eval' to script-src; a card page may add only bare https addresses/);

    const objectOpened = good.replace(/(\n {2}Content-Security-Policy: [^\n]*?)object-src 'none'(?=[^\n]*widgets)/, "$1object-src *");
    assert.notEqual(objectOpened, good);
    assert.match(errorsWith(objectOpened).join('\n'), /changes object-src/);

    const stray = `${good}\n/prompts/plain/\n  ! Content-Security-Policy\n  Content-Security-Policy: ${SITE}\n`;
    assert.match(errorsWith(stray).join('\n'), /`\/prompts\/plain\/` replaces the site policy but shows no call-to-action HTML block/);

    const dropped = `${good}\n/prompts/plain/\n  ! Content-Security-Policy\n`;
    assert.match(errorsWith(dropped).join('\n'), /`\/prompts\/plain\/` removes the site policy and sets none in its place/);

    const notUnset = good.replace(/(\/prompts\/a-prompt\/\n) {2}! Content-Security-Policy\n/, '$1');
    assert.notEqual(notUnset, good);
    assert.match(errorsWith(notUnset).join('\n'), /\/prompts\/a-prompt\/ shows the call-to-action HTML block "partner-reading-list" but dist\/_headers does not replace its policy/, 'a rule that adds a policy without removing the site one is an intersection, so the partner code stays blocked');

    const narrowed = good.replace(/(\n {2}Content-Security-Policy: [^\n]*?script-src 'self' 'unsafe-inline') https:\/\/challenges\.cloudflare\.com(?=[^\n]*widgets)/, '$1');
    assert.notEqual(narrowed, good);
    assert.match(errorsWith(narrowed).join('\n'), /`\/prompts\/a-prompt\/` removes https:\/\/challenges\.cloudflare\.com from script-src/);

    const workers = good.replace(/(\n {2}Content-Security-Policy: [^\n]*widgets[^\n]*)$/m, '$1; worker-src *');
    assert.notEqual(workers, good);
    assert.match(errorsWith(workers).join('\n'), /`\/prompts\/a-prompt\/` adds a worker-src directive the site policy does not have/, 'a new directive can loosen what default-src held');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the guard holds the served file to Cloudflare\'s limits too, with the preview site\'s rule held back', () => {
  const root = site({ pages: { 'prompts/a-prompt': cardDiv('partner-reading-list') } });
  const headers = path.join(root, 'dist/_headers');
  const errorsWith = (text) => { fs.writeFileSync(headers, text); return checkHeaders({ root }).errors.join('\n'); };
  try {
    quiet(() => composeMain({ root }));
    const good = fs.readFileSync(headers, 'utf8');
    const padTo = (n) => `${good}\n${Array.from({ length: n - parseHeaders(good).length }, (_, i) => `/pad-${i}/\n  X-Pad: 1`).join('\n')}\n`;
    assert.equal(parseHeaders(padTo(HEADER_LIMITS.rules)).length, HEADER_LIMITS.rules);
    assert.doesNotMatch(errorsWith(padTo(HEADER_LIMITS.rules - HEADER_LIMITS.reserved)), /rules; Cloudflare allows/);
    assert.match(errorsWith(padTo(HEADER_LIMITS.rules)), /dist\/_headers has 100 rules; Cloudflare allows 100, and one is kept for the preview site's noindex rule/);
    const longLine = `${good}\n/pad-long/\n  X-Pad: ${'a'.repeat(HEADER_LIMITS.line)}\n`;
    assert.match(errorsWith(longLine), /dist\/_headers has 1 line\(s\) over Cloudflare's 2000 characters/);
    assert.doesNotMatch(errorsWith(good), /Cloudflare/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
