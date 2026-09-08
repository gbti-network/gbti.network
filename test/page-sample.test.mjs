// sow-248: the rendering guards sample pages by content shape, deterministically, and coverage is a result
// they can fail on. Runs on a fixture site in a temp directory: the real dist is not a fixture, because the
// guard under test is the thing that would rewrite what the fixture proves.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { SHAPES, TEMPLATES, listPages, detectShapes, samplePages, coverageGaps, describeCoverage } from '../scripts/lib/page-sample.mjs';

const page = (body, chrome = '') => `<!doctype html><html><body><header>${chrome}</header><article>${body}</article><footer><iframe src="x"></iframe></footer></body></html>`;

function fixture() {
  const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'gbti-page-sample-'));
  const put = (rel, html) => { const f = path.join(dist, rel, 'index.html'); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, html); };
  put('articles/aaa-first', page('<p>plain</p>'));
  put('articles/mmm-table', page('<table><tr><td>x</td></tr></table>'));
  put('articles/nnn-table-two', page('<table><tr><td>y</td></tr></table><pre>code</pre>'));
  put('articles/zzz-longcode', page(`<p><code>${'a'.repeat(60)}</code></p>`));
  put('projects/bbb-grid', page('<img src="s.png" width="800">'));
  put('projects/ccc-carousel', page('<div class="pd-frames x"><img src="s.png" width="1600"></div>'));
  put('prompts/only-one', page('<p>one</p>'));
  put('members/alice', page('<p>a</p>'));
  put('shares/alice/abc123', page('<div class="embed-wrap"></div>'));
  put('shares/bob/def456', page('<p>b</p>'));
  return dist;
}

test('listPages walks one level for content templates and two for shares, in sorted order', () => {
  const dist = fixture();
  assert.deepEqual(listPages(dist, 'articles').map((p) => p.url), ['/articles/aaa-first/', '/articles/mmm-table/', '/articles/nnn-table-two/', '/articles/zzz-longcode/']);
  assert.deepEqual(listPages(dist, 'shares').map((p) => p.url), ['/shares/alice/abc123/', '/shares/bob/def456/']);
  assert.deepEqual(listPages(dist, 'nothing-here'), []);
});

test('detectShapes reads the article body, so a footer embed on every page is not a shape every page carries', () => {
  assert.deepEqual([...detectShapes(page('<table></table>'))], ['table']);
  assert.deepEqual([...detectShapes(page('<p>plain</p>'))], [], 'the footer iframe outside <article> does not count');
  assert.deepEqual([...detectShapes(page('<div class="pd-frames"></div><pre>x</pre>'))].sort(), ['carousel', 'code']);
  assert.deepEqual([...detectShapes(page(`<code>${'b'.repeat(40)}</code>`))], ['longcode']);
  assert.deepEqual([...detectShapes(page('<code>short</code>'))], []);
  assert.deepEqual([...detectShapes(page('<img width="1200">'))], ['wideimg']);
  assert.deepEqual([...detectShapes(page('<img width="640">'))], []);
  assert.deepEqual([...detectShapes('<table></table>')], ['table'], 'a page with no <article> is scanned whole');
});

test('samplePages keeps the first page per template and adds the FIRST page carrying each present shape', () => {
  const s = samplePages(fixture());
  assert.ok(s.pages.includes('/articles/aaa-first/'), 'the alphabetical first page is still rendered');
  assert.ok(s.pages.includes('/articles/mmm-table/'), 'the first table article, which the old sampler never reached');
  const code = s.coverage.find((c) => c.template === 'articles' && c.shape === 'code');
  assert.equal(code.picked, '/articles/nnn-table-two/', 'the second table page is sampled for its CODE block, the first page carrying one, not for its table');
  assert.ok(s.pages.includes('/articles/zzz-longcode/'));
  assert.ok(s.pages.includes('/projects/ccc-carousel/'), 'the carousel is rendered');
  assert.ok(s.pages.includes('/shares/alice/abc123/'));
  assert.deepEqual(s.totals, { articles: 4, projects: 2, prompts: 1, members: 1, shares: 2 });
  const row = s.coverage.find((c) => c.template === 'articles' && c.shape === 'table');
  assert.deepEqual(row, { template: 'articles', shape: 'table', present: 2, picked: '/articles/mmm-table/' });
  assert.equal(coverageGaps(s.coverage).length, 0, 'the default sampler leaves no present shape unsampled');
});

test('deterministic: two scans of the same site pick the same pages in the same order', () => {
  const dist = fixture();
  assert.deepEqual(samplePages(dist).pages, samplePages(dist).pages);
});

test('coverage is a result the guard can fail on: a present shape left unsampled is a gap naming template and shape', () => {
  // The sampler always picks when it can; `skip` stands in for any future picker that could not. The point is
  // that the GAP is reported, so a guard cannot print a reassuring count over an unrendered table.
  const s = samplePages(fixture(), { skip: (template, shape) => template === 'articles' && shape === 'table' });
  const gaps = coverageGaps(s.coverage);
  assert.deepEqual(gaps.map((g) => `${g.template}:${g.shape}:${g.present}`), ['articles:table:2']);
  assert.ok(!s.pages.includes('/articles/mmm-table/'));
});

test('the pass line reports coverage against what exists, not a count of effort', () => {
  const line = describeCoverage(samplePages(fixture()));
  assert.match(line, /of 10 template pages sampled across 5 templates/);
  assert.match(line, /table \(articles 2\)/);
  assert.match(line, /carousel \(projects 1\)/);
  assert.match(line, /embed \(shares 1\)/);
  assert.doesNotMatch(line, /checks\)/, 'the old "N page/viewport checks" wording is gone');
});

test('positive control: the shapes and templates the guards rely on are the ones this module exports', () => {
  assert.deepEqual(Object.keys(SHAPES), ['table', 'code', 'carousel', 'embed', 'longcode', 'wideimg']);
  assert.deepEqual([...TEMPLATES], ['articles', 'projects', 'prompts', 'members', 'shares']);
});
