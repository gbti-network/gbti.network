// 2026-09-11 (owner): a comment posted on the website "took several minutes to land" and the author saw nothing
// meanwhile. The SOW-076 echo (the author's own pending comment, instant, read-your-writes) had only ever been
// wired in the npm and extension hosts. These pin the website wiring: the echo write after a post, the merge on
// read, the element that renders pending rows on the static page with a merge-status note, and the pure copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pendingRows, pullOutcome, echoNote, pullsOf } from '../client-ui/src/comment-echo-core.mjs';
import { mergeCommentEchoes } from '../membership/comment-echo.mjs';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

test('pure: pending rows are the merge\'s _pending tags; the pull outcome reads merged/closed/open/unknown; both pull shapes are accepted', () => {
  const { comments } = mergeCommentEchoes({ deployed: [{ id: 'a', createdAt: '2026-09-11T10:00:00Z' }], echoes: [{ id: 'b', author: 'x', targetType: 'share', targetSlug: 's', prNumber: 436, createdAt: '2026-09-11T11:00:00Z' }] });
  assert.deepEqual(pendingRows(comments).map((c) => c.id), ['b']);
  assert.deepEqual(pendingRows(null), []);
  const pulls = [{ number: 436, state: 'closed', merged: true }, { number: 437, state: 'closed', merged: false }, { number: 438, state: 'open' }];
  assert.equal(pullOutcome(pulls, 436), 'merged');
  assert.equal(pullOutcome(pulls, '437'), 'closed');
  assert.equal(pullOutcome(pulls, 438), 'open');
  assert.equal(pullOutcome(pulls, 999), 'unknown');
  assert.deepEqual(pullsOf({ prs: pulls }), pulls, 'the extension client shape');
  assert.deepEqual(pullsOf({ items: pulls }), pulls, 'the Worker read shape');
  assert.deepEqual(pullsOf(null), []);
});

test('pure: the status note names the rebuild as the wait, marks merged and declined as terminal, and never uses a dash', () => {
  const posting = echoNote({ outcome: 'unknown', prNumber: 436 });
  assert.match(posting.text, /^Posting\. Pull request #436 merges automatically; everyone sees this after the site rebuilds, in about 2 to 3 minutes\.$/);
  assert.equal(posting.terminal, false);
  assert.equal(echoNote({ outcome: 'open' }).terminal, false);
  const merged = echoNote({ outcome: 'merged', prNumber: 436 });
  assert.match(merged.text, /^Merged\. Everyone sees this after the next site rebuild/);
  assert.equal(merged.terminal, true);
  const closed = echoNote({ outcome: 'closed' });
  assert.match(closed.text, /declined/);
  assert.equal(closed.terminal, true);
  for (const o of ['unknown', 'open', 'merged', 'closed']) assert.doesNotMatch(echoNote({ outcome: o, prNumber: 1 }).text, /[–—]/);
});

test('website client: postComment writes the echo (awaited, bounded) and names its target; listComments merges the caller\'s echoes and reaps landed ones', () => {
  const src = read('src/lib/workbench-client.ts');
  assert.match(src, /import \{ mergeCommentEchoes \} from '\.\.\/\.\.\/membership\/comment-echo\.mjs';/);
  assert.match(src, /async postComment\(/);
  assert.match(src, /const r = await commitComment\(input, body \?\? ''\);\s*if \(r\?\.prNumber\) await writeCommentEcho\(\{ id, targetType, targetSlug, body: body \?\? '', prNumber: r\.prNumber, createdAt \}\);\s*return \{ \.\.\.r, targetType, targetSlug \};/);
  assert.match(src, /workerPost\('\/membership\/comment-echo', \{ action: 'add', echo \}\)/);
  assert.match(src, /setTimeout\(\(\) => rej\(new Error\('echo timed out'\)\), 4000\)/, 'the write is bounded');
  assert.match(src, /return \{ items: await withCommentEchoes\(targetType, targetSlug, deployed\) \};/);
  assert.match(src, /if \(!readCsrf\(\)\) return deployed;/, 'no web session, no echo read');
  assert.match(src, /workerGet\(`\/membership\/comment-echo\?targetType=\$\{encodeURIComponent\(targetType\)\}&targetSlug=\$\{encodeURIComponent\(targetSlug\)\}`\)/);
  assert.match(src, /const \{ comments, reap \} = mergeCommentEchoes\(\{ deployed, echoes \}\);/);
  assert.match(src, /workerPost\('\/membership\/comment-echo', \{ action: 'reap', targetType, targetSlug, ids: reap \}\)\.catch/);
  assert.match(src, /preview\(\{ body, autoEmbed \}: any\) \{ return \{ html: renderMarkdown\(body \?\? '', \{ autoEmbed: !!autoEmbed \}\) \}; \}/);
});

test('the page: the comment section mounts <gbti-comment-echoes> before the composer and exposes the count + empty-state hooks it updates', () => {
  const page = read('src/components/blog/Comments.astro');
  assert.match(page, /<h2 class="h3"[^>]*data-comments-count=\{thread\.length\}>/);
  assert.match(page, /<div class="card" data-comments-empty /);
  const mount = page.indexOf('<gbti-comment-echoes data-gbti-target-type={targetType} data-gbti-target-slug={targetSlug}></gbti-comment-echoes>');
  const composer = page.indexOf('<CommentBox targetType={targetType} targetSlug={targetSlug} readerPath={itemReaderPath} />');
  assert.ok(mount > 0 && composer > mount, 'the echoes sit between the built thread and the composer');
  assert.match(read('client-ui/src/index.mjs'), /import '\.\/elements\/gbti-comment-echoes\.mjs';/);
  // The website does NOT load the whole registry: its mount script imports the elements it upgrades by name.
  const mountList = page.slice(page.indexOf('await Promise.all(['), page.indexOf(']);', page.indexOf('await Promise.all([')));
  assert.match(mountList, /import\('\.\.\/\.\.\/\.\.\/client-ui\/src\/elements\/gbti-comment-echoes\.mjs'\)/, 'the website mount script defines the element, or the baked tag stays inert');
});

test('the element: reads pending rows through listComments, renders bodies with autoEmbed, syncs the heading and empty card, polls the pull list and stops on a terminal outcome', () => {
  const el = read('client-ui/src/elements/gbti-comment-echoes.mjs');
  assert.match(el, /define\('gbti-comment-echoes', GbtiCommentEchoes\)/);
  assert.match(el, /const pending = pendingRows\(r\?\.items\);/);
  assert.match(el, /this\.client\.preview\(\{ body: body \|\| '', autoEmbed: true \}\)/);
  assert.match(el, /document\.addEventListener\('gbti-comment-posted', this\._onPosted\)/);
  assert.match(el, /root\.querySelector\('\[data-comments-count\]'\)/);
  assert.match(el, /empty\.hidden = pendingCount > 0;/);
  assert.match(el, /if \(!this\.client\) \{ this\.set\(''\); return; \}/, 'inert without a client');
  assert.match(el, /if \(!this\._rows\) \{ if \(!this\._loading\) this\.load\(\); this\.set\(''\); return; \}/, 'a client arriving after connect triggers the load (the load race)');
  assert.match(el, /const pulls = pullsOf\(await this\.client\.listPRs\(\)\);/);
  assert.match(el, /if \(this\._rows\.every\(\(row\) => echoNote\(\{ outcome: row\.outcome \}\)\.terminal\)\) this\._stopPolling\(\);/);
  assert.match(el, /if \(\+\+this\._polls > POLL_MAX\) \{ this\._stopPolling\(\); return; \}/);
  const locked = read('client-ui/src/elements/gbti-locked-content.mjs');
  assert.match(locked, /const autoEmbed = \(this\.dataset\.gbtiKind \|\| this\.getAttribute\('data-gbti-kind'\) \|\| ''\) === 'comment';\s*html = \(await this\.client\.preview\(\{ body: text, autoEmbed \}\)\)/, 'a decrypted members comment (the share default) frames a bare video link');
  const disc = read('client-ui/src/elements/gbti-discussion.mjs');
  assert.match(disc, /preview\(\{ body: c\.body, autoEmbed: true \}\)/, 'the reader frames a bare video link too');
  assert.match(disc, /c\._pending \? `<span class="cbadge">Posting<\/span>` : ''/);
  assert.match(disc, /echoNote\(\{ prNumber: c\.prNumber \}\)\.text/);
});
