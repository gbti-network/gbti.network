// sow-441 (owner, 2026-10-03): the extension reader's project view follows the website's project page. Before it, a
// project showed the content index's thumbnail as a full-width cover, which for a project is the icon (stretched), and a
// page opened from a link showed no picture at all; its links, price, platforms and screenshots never appeared. These
// pins hold the model (client-ui/src/project-view.mjs), the markup (client-ui/src/elements/reader-project.mjs) and the
// reader's wiring (client-ui/src/elements/gbti-reader.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';

import { projectViewModel, linkView, toDate, categoryLabelsFrom } from '../client-ui/src/project-view.mjs';
import { railDate } from '../src/lib/project-page.mjs';
import {
  projectHeroHtml, projectBarHtml, projectInstallHtml, projectGalleryHtml, projectFactsHtml, projectButtonHtml, loadTaxonomy,
} from '../client-ui/src/elements/reader-project.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const DEVOTE = 'members/robrochford/projects/devote/index.md';
const CDN = 'https://cdn.jsdelivr.net/gh/gbti-network/gbti.network@main/members/robrochford/projects/devote/images/';
const devoteFm = () => yaml.load(read(DEVOTE).split('---')[1]);
const devote = (extra = {}) => projectViewModel({ item: { type: 'project', path: DEVOTE, categoryLabels: ['Education'] }, frontmatter: devoteFm(), ...extra });

test('Devote, from its real frontmatter: the icon, the category, the price, the platforms, both buttons', () => {
  const m = devote();
  assert.equal(m.icon, `${CDN}devote-icon-256.webp`, 'the large icon, from the repo');
  assert.equal(m.eyebrow, 'Education');
  assert.equal(m.title, 'Devote: A Distraction-Free Daily Devotional');
  assert.match(m.pitch, /^A full-screen daily devotional/);
  assert.equal(m.pricing, 'Free');
  assert.deepEqual(m.platforms, ['Windows', 'macOS', 'Android']);
  assert.deepEqual(m.repo, { label: 'Source on GitHub', href: 'https://github.com/robrochford/Devote', locked: false, hint: '', kind: 'github' });
  assert.deepEqual(m.primary, { label: 'Download for Windows and macOS', href: 'https://github.com/robrochford/Devote/releases/latest', locked: false, hint: '', kind: 'download' });
  assert.deepEqual(m.install, { sub: 'Free' });
  assert.deepEqual(m.facts.map((f) => f.k), ['Works with', 'Price', 'Category', 'Published']);
  assert.equal(m.facts.find((f) => f.k === 'Published').v, '3 Oct 2026');
  assert.deepEqual(m.tags, ['devotional', 'bible', 'electron', 'capacitor', 'react', 'android']);
  assert.equal(m.gallery.length, 4);
  assert.equal(m.gallery[0].src, `${CDN}devote-choose-a-plan.webp`);
  assert.match(m.gallery[1].caption, /^The day's reading in the ESV/);
  assert.equal(m.galleryCaptions, true);
});

test('the icon: the large one, then the small one, then the index copy; never the cover field', () => {
  const at = (fm, item = {}) => projectViewModel({ item: { type: 'project', path: DEVOTE, ...item }, frontmatter: fm }).icon;
  assert.equal(at({ iconLarge: './images/big.webp', icon: './images/small.webp', featuredImage: './images/feat.webp' }), `${CDN}big.webp`);
  assert.equal(at({ icon: './images/small.webp', featuredImage: './images/feat.webp' }), `${CDN}small.webp`);
  assert.equal(at(null, { thumbCard: '/_astro/devote-icon.x.webp' }), 'https://gbti.network/_astro/devote-icon.x.webp', 'before the read lands');
  assert.equal(at({ featuredImage: './images/feat.webp' }), '', 'the featured image is not an icon');
});

test('a page opened from a link (no index fields) builds the same view once its frontmatter arrives', () => {
  const before = projectViewModel({ item: { type: 'project', path: DEVOTE } });
  assert.equal(before.icon, '');
  assert.equal(before.hasBar, false);
  assert.equal(before.install, null);
  const after = projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: devoteFm() });
  assert.equal(after.icon, `${CDN}devote-icon-256.webp`);
  assert.equal(after.title, 'Devote: A Distraction-Free Daily Devotional');
  assert.equal(after.primary.href, 'https://github.com/robrochford/Devote/releases/latest');
  assert.equal(after.eyebrow, '', 'no category label without the index entry');
});

test('members-only links: live only for a paying member; an encrypted one always locked; fail closed', () => {
  const plain = { type: 'download', url: 'https://example.com/members.zip', label: 'Members download', visibility: 'members' };
  const enc = { ...plain, encrypted: true, url: 'https://example.com/x.enc' };
  for (const paid of [false, undefined, null, 'paid', 1]) {
    const v = linkView(plain, { paid });
    assert.equal(v.locked, true, `paid=${JSON.stringify(paid)} is not a paying member`);
    assert.equal(v.href, null, 'a locked link carries no address');
    assert.equal(v.hint, 'Members only. Open in the GBTI client to unlock.');
  }
  assert.deepEqual(linkView(plain, { paid: true }), { label: 'Members download', href: 'https://example.com/members.zip', locked: false, hint: '', kind: 'download' });
  const e = linkView(enc, { paid: true });
  assert.equal(e.locked, true);
  assert.equal(e.href, null);
  assert.equal(e.hint, 'Encrypted member content. Open in the GBTI client to unlock.');
  // The source button prefers a public repository; a members-only one shows only when it is all there is.
  const fm = { links: [{ type: 'repository', url: 'https://github.com/a/private', visibility: 'members' }, { type: 'repository', url: 'https://github.com/a/public' }] };
  assert.equal(projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: fm }).repo.href, 'https://github.com/a/public');
  const only = projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: { links: [fm.links[0]] } });
  assert.equal(only.repo.locked, true);
  assert.equal(projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: { links: [fm.links[0]] }, paid: true }).repo.href, 'https://github.com/a/private');
});

test('only safe http(s) addresses become links', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,x', '//evil.example', '/relative', 'ftp://x', ' ']) {
    assert.equal(linkView({ type: 'homepage', url }), null, `${url} is dropped, not drawn`);
  }
  assert.equal(linkView({ type: 'homepage', url: 'https://ok.example/x' }).href, 'https://ok.example/x');
  assert.equal(linkView({ type: 'repository', url: 'https://github.com/a/b' }, { repository: true }).label, 'View on GitHub', 'an unlabelled GitHub repository reads as on the website');
});

test('dates: a YAML Date, a string or epoch ms; Updated only when it differs', () => {
  assert.equal(toDate(new Date('2025-09-27')).toISOString().slice(0, 10), '2025-09-27');
  assert.equal(toDate('2026-10-03T14:23:40.428Z').toISOString().slice(0, 10), '2026-10-03');
  assert.equal(toDate(Date.UTC(2026, 0, 2)).toISOString().slice(0, 10), '2026-01-02');
  assert.equal(toDate('not a date'), null);
  assert.equal(toDate(''), null);
  const facts = (fm) => projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: fm }).facts;
  assert.deepEqual(facts({ publishedAt: new Date('2025-09-27'), updatedAt: new Date('2025-09-27') }), [{ k: 'Published', v: railDate(new Date('2025-09-27')) }], 'the same day is not repeated as Updated');
  assert.equal(facts({ publishedAt: '2025-09-27', updatedAt: '2026-01-02' }).length, 2);
});

test('nothing to show means nothing drawn: no links, no gallery, no facts', () => {
  const m = projectViewModel({ item: { type: 'project', path: DEVOTE, title: 'Bare' }, frontmatter: { title: 'Bare', icon: './images/i.webp' } });
  assert.equal(m.hasBar, false);
  assert.equal(projectBarHtml(m), '');
  assert.equal(projectInstallHtml(m), '');
  assert.equal(projectGalleryHtml(m), '');
  assert.equal(projectFactsHtml(m), '');
  assert.match(projectHeroHtml(m), /<img class="pv-icon" src="[^"]+\/images\/i\.webp"/);
  // A gallery of bare paths (the older projects' form) still renders, without captions.
  const bare = projectViewModel({ item: { type: 'project', path: DEVOTE }, frontmatter: { gallery: ['./images/a.webp', './images/b.webp'] } });
  assert.deepEqual(bare.gallery.map((g) => g.caption), ['', '']);
  assert.equal(bare.galleryCaptions, false);
  assert.doesNotMatch(projectGalleryHtml(bare), /<figcaption>/);
});

test('the markup: escaped, locked buttons carry no address, the install box leaves out a locked main button', () => {
  const m = projectViewModel({
    item: { type: 'project', path: DEVOTE, categoryLabels: ['<b>Cat</b>'] },
    frontmatter: { title: 'A <script>x</script>', shortDescription: '"quoted" & more', links: [{ type: 'download', url: 'https://example.com/m.zip', visibility: 'members' }, { type: 'repository', url: 'https://github.com/a/b' }], gallery: [{ src: './images/a.webp', caption: '<img src=x onerror=alert(1)>' }] },
  });
  const html = projectHeroHtml(m) + projectBarHtml(m) + projectInstallHtml(m) + projectGalleryHtml(m) + projectFactsHtml(m);
  assert.doesNotMatch(html, /<script>|<b>Cat|<img src=x/, 'no member text reaches the page as markup');
  assert.match(projectBarHtml(m), /<span class="pv-btn primary locked" title="Members only\. Open in the GBTI client to unlock\." aria-disabled="true">/);
  assert.doesNotMatch(projectBarHtml(m), /m\.zip/, 'the locked address is never written');
  assert.doesNotMatch(projectInstallHtml(m), /primary/, 'a locked main button is left out of the install box');
  assert.match(projectInstallHtml(m), /href="https:\/\/github\.com\/a\/b"/);
  assert.match(projectButtonHtml(m.repo), /target="_blank" rel="noopener nofollow"/);
});

test('the reader: a project gets the project layout and no cover; every other type keeps its template', () => {
  const r = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(r, /const proj = it\.type === 'project' \? projectViewModel\(\{ item: it, frontmatter: this\._fm, itemPath: it\.path, paid: this\._paid === true \}\) : null;/);
  assert.match(r, /const cover = proj \? '' : shareEmbed/, 'no cover on a project');
  assert.match(r, /<div class="wrap">\$\{top\}<div class="cols"><article>\$\{title\}\$\{meta\}\$\{cover\}\$\{skillBox\}\$\{body\}\$\{tweet\}\$\{tail\}/); // sow-261: an X share's tweet sits between
  assert.match(r, /const title = proj \? '' : `<h1>\$\{esc\(it\.title \|\| ''\)\}<\/h1>`;/, 'other types keep the title in the article');
  assert.match(r, /this\._metaHtml\(proj \? \{ \.\.\.it, categoryLabels: \[\] \} : it, when\)/, 'the category moves to the hero');
  assert.match(r, /<aside class="side">\$\{facts\}\$\{this\._authorCardHtml\(it\)\}/);
  // The viewer's membership is asked only when a project has a members-only link, and fails closed.
  assert.match(r, /if \(it\?\.type !== 'project' \|\| !links\.some\(\(l\) => l && l\.visibility === 'members'\) \|\| !this\.client\?\.status\) return false;/);
  assert.match(r, /try \{ return \(await this\.client\.status\(\)\)\?\.membership === 'paid'; \} catch \{ return false; \}/);
});

test('the discussion draws the pinned author note as the green card', () => {
  const d = read('client-ui/src/elements/gbti-discussion.mjs');
  assert.match(d, /const noteCard = c\.authorNote \? ' note' : '';/);
  assert.match(d, /<div class="comment\$\{reply\}\$\{noteCard\}">/);
  assert.match(d, /\.comment\.note \{ border:1px solid [^}]*background:var\(--green-tint\)/);
});

test('the screenshot buttons override the base button paint, hover included', () => {
  const css = read('client-ui/src/elements/reader-project.mjs');
  assert.match(css, /\.pv-shot \{[^}]*background:#0b0b0d;/);
  assert.match(css, /\.pv-shot:hover, \.pv-shot:focus-visible \{ background:#0b0b0d;/, 'button:hover would otherwise paint it green');
});

test('a page opened from a link reads its category from the public tree, so it matches the list', async () => {
  const tree = { tree: { education: { label: 'Education' }, devops: { label: 'DevOps', children: { frameworks: { label: 'Frameworks', children: { wordpress: { label: 'WordPress' } } } } } } };
  assert.deepEqual(categoryLabelsFrom(tree, ['education']), ['Education']);
  assert.deepEqual(categoryLabelsFrom(tree, ['devops', 'frameworks', 'wordpress']), ['DevOps', 'Frameworks', 'WordPress']);
  assert.deepEqual(categoryLabelsFrom(tree, ['nope']), [], 'an unknown path shows no category rather than a raw key');
  assert.deepEqual(categoryLabelsFrom(null, ['education']), [], 'no tree, no category');
  assert.deepEqual(categoryLabelsFrom(tree, []), []);
  // Fetched once per page; a failure is remembered as "no tree", not retried on every open.
  let calls = 0;
  const failing = async () => { calls += 1; throw new Error('offline'); };
  assert.equal(await loadTaxonomy(failing), null);
  assert.equal(await loadTaxonomy(failing), null);
  assert.equal(calls, 1);
  const r = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(r, /if \(cur\.type !== 'project' \|\| \(Array\.isArray\(cur\.categoryLabels\) && cur\.categoryLabels\.length\)\) return;/, 'only a project without labels asks');
  assert.match(r, /const labels = categoryLabelsFrom\(await loadTaxonomy\(\), this\._fm\.categories\);/);
  assert.match(r, /this\._paid = await this\._resolvePaid\(this\._item \|\| it\);\n    await this\._backfillCategoryLabels\(\);\n    this\.render\(\);/, 'run before the resolved render');
});
