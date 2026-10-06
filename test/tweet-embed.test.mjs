// sow-261 (owner rulings 2026-09-22 and 2026-10-06): a comment line that is only a tweet link embeds the tweet, and an X
// share shows the live tweet, in the extension and on the website. These pin the shared tweet reader, both comment
// renderers and the sanitizer, the relay, the frame wiring's pure parts, and where each surface mounts it. The frames'
// live behaviour (X's size messages, the link swap, the missing-tweet fallback) is driven in a real browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tweetId, bareTweetLine, tweetFrameUrl, tweetBlockHtml, parseTweetMessage, tweetTheme, TWEET_FRAME_ORIGIN } from '../client/src/tweet-embed.mjs';
import { renderMarkdown } from '../client/src/markdown.mjs';
import { remarkContentBlocks, tweetBlockBuildHtml } from '../src/lib/remark-content-blocks.mjs';
import { sanitizeSchema, rehypeIframeHostAllowlist, rehypeStyleAllowlist, rehypeIdSafety } from '../src/lib/markdown-sanitize.mjs';
import { usesRelay, tweetFrameSrc, TWEET_RELAY, TWEET_RELAY_ORIGIN, TWEET_CSS } from '../client-ui/src/tweet-frames.mjs';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import rehypeStringify from 'rehype-stringify';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const ID = '2107396191969562653';
const URL1 = `https://x.com/KatieKeithBarn2/status/${ID}`;

test('tweetId reads every tweet link shape and refuses everything else', () => {
  for (const u of [
    URL1, `https://twitter.com/jack/status/${ID}`, `https://www.x.com/jack/status/${ID}`, `https://mobile.twitter.com/jack/status/${ID}`,
    `http://x.com/jack/status/${ID}`, `https://x.com/jack/status/${ID}/photo/1`, `https://x.com/jack/status/${ID}?s=20&t=abc`,
    `https://x.com/i/web/status/${ID}`, `https://twitter.com/jack/statuses/${ID}`, `  ${URL1}  `,
  ]) assert.equal(tweetId(u), ID, u);
  for (const u of [
    'https://x.com/jack', 'https://x.com/jack/likes', `https://x.com.evil.example/jack/status/${ID}`, `https://evil.example/x.com/jack/status/${ID}`,
    `https://notx.com/jack/status/${ID}`, `https://x.com/jack/status/abc`, `https://x.com/way_too_long_handle_here/status/${ID}`,
    `javascript:alert(1)//x.com/jack/status/${ID}`, `see ${URL1}`, '', null, undefined,
  ]) assert.equal(tweetId(u), null, String(u));
});

test('bareTweetLine: only a line that is nothing but a tweet link', () => {
  assert.equal(bareTweetLine(`  ${URL1} `), URL1);
  assert.equal(bareTweetLine(`look ${URL1}`), null, 'words around it');
  assert.equal(bareTweetLine(`[a post](${URL1})`), null, 'a titled link');
  assert.equal(bareTweetLine('https://www.youtube.com/watch?v=abc123DEF45'), null, 'a video is not a tweet');
});

test('the frame URL is X\'s own tweet page, themed, do-not-track, from an id or a link', () => {
  assert.equal(tweetFrameUrl(URL1, { theme: 'dark' }), `${TWEET_FRAME_ORIGIN}/embed/Tweet.html?id=${ID}&theme=dark&dnt=true`);
  assert.equal(tweetFrameUrl(ID), `${TWEET_FRAME_ORIGIN}/embed/Tweet.html?id=${ID}&theme=light&dnt=true`);
  assert.equal(tweetFrameUrl(URL1, { theme: '"><script>' }), `${TWEET_FRAME_ORIGIN}/embed/Tweet.html?id=${ID}&theme=light&dnt=true`, 'only light or dark');
  assert.equal(tweetFrameUrl('https://example.com/'), null);
  assert.equal(tweetTheme('dark'), 'dark');
  assert.equal(tweetTheme('anything'), 'light');
});

test('the tweet block is the escaped link inside a box the wiring finds, and carries the URL for the editor', () => {
  assert.equal(tweetBlockHtml(URL1), `<div class="md-tweet" data-tweet-url="${URL1}" data-embed-url="${URL1}"><a href="${URL1}" target="_blank" rel="noopener nofollow">${URL1}</a></div>`);
  assert.equal(tweetBlockHtml('https://example.com/'), '', 'nothing for a non-tweet');
  assert.doesNotMatch(tweetBlockHtml(`${URL1}?q="><b>`), /"><b>/, 'escaped');
});

test('parseTweetMessage reads X\'s three messages and the relay\'s forwarded form, and nothing else', () => {
  const rpc = (method, params) => JSON.stringify({ 'twttr.embed': { jsonrpc: '2.0', method, id: 'embed-0', params } });
  assert.deepEqual(parseTweetMessage(rpc('twttr.private.resize', [{ width: 420, height: 626.4 }])), { method: 'resize', height: 627 });
  assert.deepEqual(parseTweetMessage(rpc('twttr.private.rendered', [{}])), { method: 'rendered' });
  assert.deepEqual(parseTweetMessage(rpc('twttr.private.no_results', [{}])), { method: 'no_results' });
  assert.deepEqual(parseTweetMessage({ 'twttr.embed': { method: 'twttr.private.resize', params: [{ height: 300 }] } }), { method: 'resize', height: 300 }, 'an object too');
  assert.deepEqual(parseTweetMessage({ gbtiTweet: { method: 'resize', height: 512 } }), { method: 'resize', height: 512 });
  assert.deepEqual(parseTweetMessage({ gbtiTweet: { method: 'no_results' } }), { method: 'no_results' });
  for (const bad of [
    rpc('twttr.private.initialized', [{}]), rpc('twttr.private.results', [{}]), rpc('twttr.private.resize', [{ height: -5 }]),
    rpc('twttr.private.resize', [{ height: 99999 }]), rpc('twttr.private.resize', [{ height: 'tall' }]), '{not json', 'hello',
    { gbtiTweet: { method: 'navigate', url: 'https://evil.example' } }, null, 42, 'x'.repeat(30000),
  ]) assert.equal(parseTweetMessage(bad), null, String(bad).slice(0, 60));
});

test('the client renderer: a comment\'s bare tweet line is the tweet block; words, articles and inline links stay as they were', () => {
  const md = `Look at this\n${URL1}\nand after`;
  const html = renderMarkdown(md, { autoEmbed: true });
  assert.match(html, /<p>Look at this<\/p>\n<div class="md-tweet" data-tweet-url="https:\/\/x\.com\/KatieKeithBarn2\/status\/2107396191969562653"/, 'the paragraph stops before the tweet line');
  assert.match(html, /<\/div>\n<p>and after<\/p>/);
  assert.doesNotMatch(renderMarkdown(md), /md-tweet/, 'no autoEmbed (an article): no tweet block');
  assert.doesNotMatch(renderMarkdown(`see ${URL1} now`, { autoEmbed: true }), /md-tweet/, 'a link inside a sentence stays text');
  assert.match(renderMarkdown('https://www.youtube.com/watch?v=abc123DEF45', { autoEmbed: true }), /md-embed-poster/, 'video lines are unchanged');
});

const build = (md, path) => unified()
  .use(remarkParse).use(remarkGfm).use(remarkContentBlocks)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw).use(rehypeSanitize, sanitizeSchema)
  .use(rehypeIframeHostAllowlist).use(rehypeStyleAllowlist).use(rehypeIdSafety)
  .use(rehypeStringify).process({ value: md, path }).then(String);

test('the site build: a comment\'s bare tweet line survives the sanitizer as the tweet block; an article keeps the link', async () => {
  const md = `Worth a read\n${URL1}\n\nAnd **bold** after.`;
  const asComment = await build(md, '/repo/members/atwellpub/comments/20261006153536-vyhnmg.md');
  assert.match(asComment, /<p>Worth a read<\/p>\s*<div class="md-tweet"><a href="https:\/\/x\.com\/KatieKeithBarn2\/status\/2107396191969562653">https:\/\/x\.com\/KatieKeithBarn2\/status\/2107396191969562653<\/a><\/div>/);
  assert.match(asComment, /<p>And <strong>bold<\/strong> after\.<\/p>/);
  const owner = await build(URL1, '/repo/members/atwellpub/comments/20261006153536-vyhnmg.md');
  assert.match(owner, /^<div class="md-tweet">/, 'the owner\'s own comment, a lone tweet link');
  const asPost = await build(md, '/repo/members/atwellpub/posts/x/index.md');
  assert.doesNotMatch(asPost, /md-tweet/, 'an article body keeps the plain link');
  assert.equal(tweetBlockBuildHtml('a"b'), '<div class="md-tweet"><a href="a&quot;b">a&quot;b</a></div>', 'escaped');
});

test('the sanitizer admits exactly the tweet block class, and a raw iframe to a look-alike host still goes', async () => {
  const kept = await build('<div class="md-tweet"><a href="https://x.com/a/status/12345">x</a></div>', '/repo/members/a/posts/p/index.md');
  assert.match(kept, /<div class="md-tweet">/);
  const other = await build('<div class="md-tweetx">a</div><div class="xmd-tweet">b</div>', '/repo/members/a/posts/p/index.md');
  assert.doesNotMatch(other, /class="[^"]+"/, 'only the exact class (a refused one is emptied, the sanitizer\'s usual way)');
  const frame = await build('<iframe src="https://platform.twitter.com.evil.example/embed/Tweet.html?id=1"></iframe>', '/repo/members/a/posts/p/index.md');
  assert.doesNotMatch(frame, /<iframe/);
});

test('the frame wiring: X directly on the website, the https relay on an extension page, themed', () => {
  assert.equal(usesRelay('auto', 'chrome-extension:'), true);
  assert.equal(usesRelay('auto', 'https:'), false);
  assert.equal(usesRelay('direct', 'chrome-extension:'), false);
  assert.equal(usesRelay('relay', 'https:'), true);
  assert.equal(tweetFrameSrc(URL1, { relay: true, theme: 'dark' }), `${TWEET_RELAY}?u=${encodeURIComponent(URL1)}&theme=dark`);
  assert.equal(tweetFrameSrc(URL1, { relay: false, theme: 'dark' }), tweetFrameUrl(URL1, { theme: 'dark' }));
  assert.equal(TWEET_RELAY_ORIGIN, new URL(TWEET_RELAY).origin);
  assert.match(TWEET_CSS, /\.md-tweet\.is-ready > a \{ display:none; \}/, 'the link hides once the tweet shows');
  assert.match(TWEET_CSS, /\.md-tweet > iframe \{[^}]*height:0;/, 'and the frame takes no room until then');
});

test('the wiring trusts only its own frame\'s origin and window, drops a frame only on "no_results", and waits out a slow one', () => {
  const s = read('client-ui/src/tweet-frames.mjs');
  assert.match(s, /const rec = FRAMES\.get\(e\.source\);\s*\n\s*if \(!rec \|\| e\.origin !== rec\.origin\) return;/);
  assert.match(s, /if \(m\.method === 'no_results'\) \{ drop\(rec, 'no_results'\); return; \}/);
  assert.match(s, /rec\.timer = setTimeout\(\(\) => \{ if \(!rec\.ready\) el\.setAttribute\('data-tweet-why', 'slow'\); \}, slowMs\);/, 'a slow tweet is only marked');
  assert.doesNotMatch(s, /drop\(rec, '(timeout|slow)'\)/, 'never dropped for being slow: it swaps in whenever X answers');
  assert.match(s, /rec\.el\.classList\.add\('is-missing'\);\n\s*rec\.el\.setAttribute\('data-tweet-why', why\);/, 'the reason is kept on the block');
  assert.match(s, /const origin = relay \? TWEET_RELAY_ORIGIN : TWEET_FRAME_ORIGIN;/);
});

test('the relay frames a tweet only through the shared validator and forwards only X\'s messages from that frame', () => {
  const s = read('src/pages/embed.astro');
  assert.match(s, /if \(tweetId\(u\)\) \{/);
  assert.match(s, /f\.src = tweetFrameUrl\(u, \{ theme: params\.get\('theme'\) \|\| 'light' \}\);/);
  assert.match(s, /if \(e\.origin !== TWEET_FRAME_ORIGIN \|\| e\.source !== f\.contentWindow\) return;/);
  assert.match(s, /parent\.postMessage\(\{ gbtiTweet: m \}, '\*'\);/, 'the parsed, reduced message only');
  const meta = s.match(/http-equiv="Content-Security-Policy"\s*\n\s*content="([^"]+)"/)[1];
  assert.match(meta, /frame-src [^;]*https:\/\/platform\.twitter\.com/, 'the meta fail-safe frames X too');
  for (const rule of read('public/_headers').match(/^\/embed(?:\/\*)?\n(?:  .*\n)+/gm)) {
    assert.match(rule, /frame-src [^;]*https:\/\/platform\.twitter\.com/, 'and both header rules');
  }
});

test('every comment surface wires its tweet blocks, and the share views mount the tweet', () => {
  for (const p of ['client-ui/src/elements/gbti-discussion.mjs', 'client-ui/src/elements/gbti-comment-echoes.mjs', 'client-ui/src/elements/gbti-locked-content.mjs']) {
    const s = read(p);
    assert.match(s, /wireEmbedPosters\(this\.root\);\n\s*wireTweets\(this\.root\);/, `${p}: wired after every render`);
    assert.match(s, /\$\{TWEET_CSS\}/, `${p}: styled`);
  }
  const comments = read('src/components/blog/Comments.astro');
  assert.match(comments, /if \(thread\) wireTweets\(thread, \{ via: 'direct' \}\);/);
  assert.match(comments, /\.cmt-rich \.md-tweet\.is-ready > a \{ display: none; \}/);
  const reader = read('client-ui/src/elements/gbti-reader.mjs');
  assert.match(reader, /const tweet = it\.type === 'share' && tweetId\(it\.url\) \? `<div class="md-tweet md-tweet-share" data-tweet-url="\$\{esc\(it\.url\)\}"><\/div>` : '';/);
  assert.match(reader, /\$\{body\}\$\{tweet\}\$\{tail\}/, 'under the member\'s comment block');
  assert.match(reader, /if \(tweet\) wireTweets\(this\.root, \{ onReady: \(\) => \{ const c = this\.\$\('img\.cover'\); if \(c\) c\.style\.display = 'none'; \} \}\);/);
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /const tweetUrl = !videoSrc && d\.url && tweetId\(d\.url\) \? d\.url : null;/);
  assert.match(page, /\{tweetUrl && <div class="share-tweet" data-share-tweet><div class="md-tweet md-tweet-share" data-tweet-url=\{tweetUrl\}><\/div><\/div>\}\n\n\s*<div class="share-actions">/);
  assert.match(page, /if \(box\) wireTweets\(box, \{ via: 'direct', onReady: \(\) => \{ const hero = document\.querySelector<HTMLElement>\('\.share-hero'\); if \(hero\) hero\.style\.display = 'none'; \} \}\);/);
  assert.doesNotMatch(page, /\.share-tweet[^{]*\{[^}]*display: none/, 'never display:none while loading (X would have no width)');
});
