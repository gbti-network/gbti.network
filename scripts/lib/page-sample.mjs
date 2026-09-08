// sow-248: which built pages a rendering guard visits, chosen by CONTENT SHAPE rather than by alphabet.
//
// Both Playwright guards (check-overflow, check-csp) used to render the alphabetically-first page under each
// content template and call that "the article template". The sample was stable, so its blindness was stable:
// five articles carry a table, two of them overflowed a phone by 213px and 136px, and the guard never rendered
// any of them because the first article alphabetically has no table. The tolerance comment in check-overflow
// was written about carousels the guard had never seen.
//
// This module scans the built site once and returns, per template, the first page (what the guards always
// checked, kept) plus one page for every SHAPE present on that template: a table, a code block, a gallery
// carousel, an embed, a long unbreakable inline code run, a wide image. Deterministic (sorted order), so a red
// reproduces on re-run; covering by shape, so the next table on the next article is rendered without anyone
// remembering to add it. A shape nobody has named yet is still a blind spot; add it to SHAPES when it appears.
//
// Coverage is a RESULT, not a log line: `coverageGaps` returns every (template, shape) that exists on the site
// and was not sampled, and the guards fail on any. Pure apart from reading files; the fs is injectable so the
// tests run on a fixture site in a temp directory.
import fs from 'node:fs';
import path from 'node:path';

/** The shapes a wide block can take, by the markup each leaves in the built page. Order is the report order. */
export const SHAPES = Object.freeze({
  table: /<table\b/,
  code: /<pre\b/,
  carousel: /class="[^"]*\bpd-frames\b/,
  embed: /<iframe\b|class="[^"]*\bembed-wrap\b/,
  longcode: /<code>[^<\s]{40,}<\/code>/,
  wideimg: /<img\b[^>]*\bwidth="(?:1\d{3}|[2-9]\d{3})"/,
});

/** The content templates: one directory of pages each. Shares nest one level deeper (author, then id). */
export const TEMPLATES = Object.freeze(['articles', 'projects', 'prompts', 'members', 'shares']);

/** Every page under a template directory, as clean URLs, in a stable order. */
export function listPages(dist, template, { fs: fsx = fs } = {}) {
  const dir = path.join(dist, template);
  if (!fsx.existsSync(dir)) return [];
  const out = [];
  const walk = (d, url, depth) => {
    for (const name of fsx.readdirSync(d).sort()) {
      const p = path.join(d, name);
      let isDir = false;
      try { isDir = fsx.statSync(p).isDirectory(); } catch { continue; }
      if (!isDir) continue;
      if (fsx.existsSync(path.join(p, 'index.html'))) out.push({ url: `${url}/${name}/`, file: path.join(p, 'index.html') });
      else if (depth < 1) walk(p, `${url}/${name}`, depth + 1); // shares: /shares/<author>/<id>/
    }
  };
  walk(dir, `/${template}`, 0);
  return out;
}

/** The shapes a page carries. Scans the article body when the page has one, so chrome shared by every page
 *  (a footer embed, a header image) does not make every page "carry" every shape. */
export function detectShapes(html, shapes = SHAPES) {
  const i = html.indexOf('<article');
  const j = i >= 0 ? html.indexOf('</article>', i) : -1;
  const body = i >= 0 ? html.slice(i, j >= 0 ? j : undefined) : html;
  const found = new Set();
  for (const [name, re] of Object.entries(shapes)) if (re.test(body)) found.add(name);
  return found;
}

/**
 * Sample the built site: per template, the first page plus the first page carrying each shape.
 * @returns {{ pages: string[], coverage: Array<{template, shape, present, picked}>, totals: Record<string, number> }}
 *   `pages` is the deduped URL list to render; `coverage` has one row per (template, shape) with how many pages
 *   carry it and which one was picked (null when none does, or when `skip` excluded it, which only tests do).
 */
export function samplePages(dist, { templates = TEMPLATES, shapes = SHAPES, fs: fsx = fs, skip = () => false } = {}) {
  const pages = [];
  const coverage = [];
  const totals = {};
  const add = (url) => { if (url && !pages.includes(url)) pages.push(url); };
  for (const template of templates) {
    const all = listPages(dist, template, { fs: fsx });
    totals[template] = all.length;
    if (!all.length) continue;
    add(all[0].url); // the first page, which is what the guards always rendered
    const shapesOf = all.map((p) => ({ url: p.url, shapes: detectShapes(fsx.readFileSync(p.file, 'utf8'), shapes) }));
    for (const shape of Object.keys(shapes)) {
      const carrying = shapesOf.filter((p) => p.shapes.has(shape));
      const pick = carrying.find((p) => !skip(template, shape, p.url)) || null;
      coverage.push({ template, shape, present: carrying.length, picked: pick ? pick.url : null });
      if (pick) add(pick.url);
    }
  }
  return { pages, coverage, totals };
}

/** Every (template, shape) present on the site that no sampled page exercises. Empty means covered. */
export function coverageGaps(coverage) {
  return coverage.filter((c) => c.present > 0 && !c.picked);
}

/** The pass line: what was rendered against what exists, so "45 checks" can never again read as "covered". */
export function describeCoverage({ pages, coverage, totals }) {
  const total = Object.values(totals).reduce((a, b) => a + b, 0);
  const present = coverage.filter((c) => c.present > 0);
  const byShape = {};
  for (const c of present) (byShape[c.shape] ||= []).push(`${c.template} ${c.present}`);
  const shapes = Object.entries(byShape).map(([s, t]) => `${s} (${t.join(', ')})`).join('; ');
  return `${pages.length} of ${total} template pages sampled across ${Object.keys(totals).filter((t) => totals[t]).length} templates; `
    + `every shape present was rendered: ${shapes || 'none found'}`;
}
