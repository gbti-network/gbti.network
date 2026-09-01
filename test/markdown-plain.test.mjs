// sow-300: the markdown -> formatted text conversion, and its wiring into the syndication rails.
//
// WHY THIS FILE IS THE WHOLE GATE. Before it, NOTHING in the suite fed markdown through renderChannelText,
// renderRedditTitle, or a manual task's text. Every syndication test passed with raw asterisks flowing to a
// live channel, so a regression here reds nothing unless it reds something below. The fixtures are taken
// from the LIVE corpus rather than invented, and each one is named with where it came from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mdToPlain, mdToHtml } from '../membership/markdown-plain.mjs';
import { rendersMarkdown, CHANNEL_MARKDOWN } from '../membership/syndication-channels.mjs';
import { renderChannelText, renderRedditTitle, renderRedditComment } from '../membership/syndication-render.mjs';
import { syndicationConfigFromParsed } from '../membership/syndication-config-core.mjs';

// members/atwellpub/shares/20260831172148-tailcat-an-open-source-cli-for-tailscale-s-wireg.md, the share body
// that produced the reported defect. A share's authorNote is its WHOLE body, which is why this is the fixture
// that matters most: it is long, it carries a bare URL, typographic apostrophes and a registered-trademark
// sign, and the only markdown in it is one bold run.
const TAILCAT_BODY = 'Tailscale just open-sourced **Tailcat**, a lightweight way to use the useful parts of Tailscale’s networking stack without the Tailscale control plane. You still get WireGuard® encryption, NAT traversal, and DERP fallback.\n\nThe interesting use cases are ephemeral VMs, homelabs, AI agents. Repo: https://github.com/tailscale/tailcat';

// What {author-note-attributed} (syndication-format.mjs) actually builds around it: an attribution line, then
// the note wrapped in quotes with EVERY line prefixed `> `, and a bare `>` on the blank line between paragraphs.
const REDDIT_COMMENT = `From u/atwellpub:\n\n${`"${TAILCAT_BODY}"`.split('\n').map((l) => (l.trim() ? `> ${l.trim()}` : '>')).join('\n')}`;

// members/atwellpub/comments/intro-scope-of-work-manager-claude-code-skill.md. The heaviest note in the
// corpus and the one that would break a careless stripper: bold wrapping a code span, an angle-bracketed
// placeholder inside a code span, hyphen bullets, and four underscore-bearing identifiers.
const SOW_NOTE = '**`/sow init`** scaffolds the framework in the current project:\n\n- creates the lane folders `0_queue`, `1_progressing`, and `2_waiting_review`, and a `_staging` side-lane\n- creates a `todo.md` when one is missing\n\n**`/sow "<request>"`** authors or updates a SOW from a plain-language request.';

// members/atwellpub/comments/intro-qa-skill-for-claude-code-and-codex.md, hard-wrapped mid-sentence at about
// 95 columns. In markdown those are SOFT breaks; the author did not ask for a line break there.
const WRAPPED_NOTE = 'So I gave myself a way to invoke the pass I wanted, on demand. Typing `/qa` gets the questions asked, in\nplan mode, before anything is written. `/qa continue` does the same and then just builds once I have\nanswered.';

const FIXTURES = [
  ['tailcat share body', TAILCAT_BODY],
  ['reddit first comment', REDDIT_COMMENT],
  ['sow skill note', SOW_NOTE],
  ['hard-wrapped note', WRAPPED_NOTE],
];

// ---------- the live defect ----------

test('the reported defect: the Reddit first comment loses its markdown and gains real formatting', () => {
  const plain = mdToPlain(REDDIT_COMMENT);
  // What a member complained about: literal blockquote markers and literal asterisks in the paste.
  assert.ok(!plain.includes('> '), 'no blockquote prefixes survive');
  assert.ok(!/^>$/m.test(plain), 'and no bare > on the blank line between paragraphs');
  assert.ok(!plain.includes('**'), 'no bold markers survive');
  // The positive control. A strip test that only proves things are GONE passes against a function that
  // returns the empty string, which would silently blank every paste.
  assert.ok(plain.includes('Tailcat'), 'the bolded word itself is kept');
  assert.ok(plain.includes('From u/atwellpub:'), 'the attribution line is kept');
  assert.ok(plain.includes('https://github.com/tailscale/tailcat'), 'and the repo link is kept intact');

  const html = mdToHtml(REDDIT_COMMENT);
  assert.ok(html.includes('<blockquote>'), 'the quote becomes a REAL quote block, which is the point');
  assert.ok(html.includes('<strong>Tailcat</strong>'), 'and the bold becomes real bold');
  assert.ok(!html.includes('&gt; '), 'no blockquote marker leaks into the html flavour as text');
});

test('typographic characters and symbols are never touched', () => {
  const plain = mdToPlain(TAILCAT_BODY);
  assert.ok(plain.includes('Tailscale’s'), 'the curly apostrophe survives');
  assert.ok(plain.includes('WireGuard®'), 'and the registered-trademark sign survives');
});

// ---------- idempotency, which is load-bearing rather than tidy ----------

test('mdToPlain is IDEMPOTENT on every real fixture', () => {
  // Text passes through mdToPlain TWICE in production: once when the drain renders a task, and again when
  // the Social Queue posts the stored text as a textOverride. A second pass that keeps stripping would
  // corrupt content nobody is watching, so this is asserted directly rather than assumed.
  for (const [name, input] of FIXTURES) {
    const once = mdToPlain(input);
    assert.equal(mdToPlain(once), once, `${name} changed on the second pass`);
  }
});

test('mdToPlain keeps a fenced code block fenced, which is WHY it is idempotent there', () => {
  const input = '```js\nconst x = **not markdown**;\n```';
  const once = mdToPlain(input);
  assert.ok(once.includes('**not markdown**'), 'code is not prose: its asterisks are content');
  assert.equal(mdToPlain(once), once, 'and dropping the fence would let a second pass eat them');
});

// ---------- the inputs that would corrupt a real post ----------

test('underscore is NOT emphasis here, matching the dialect the site publishes with', () => {
  // THE DISCRIMINATING ASSERTION IS THIS ONE. An earlier version of this test only checked that identifiers
  // like 0_queue survive, and a mutation adding underscore emphasis back SURVIVED it: a word-boundary rule
  // does not touch a mid-word underscore, so the identifier fixtures passed either way. What actually
  // separates the two dialects is a properly delimited `_word_`, verified against both site renderers
  // (client/src/markdown.mjs and client-ui/src/markdown-blocks.mjs), which leave it literal.
  assert.equal(mdToPlain('a _word_ here'), 'a _word_ here', 'underscores are content, not emphasis');
  assert.equal(mdToPlain('a __word__ here'), 'a __word__ here');
  assert.ok(mdToHtml('a _word_ here').includes('_word_'), 'and the html flavour agrees');
  // Kept as the regression guard for the looser rule, which WOULD eat these.
  const bare = 'creates 0_queue, 1_progressing, and 2_waiting_review, and a _staging side-lane';
  assert.equal(mdToPlain(bare), bare, 'nothing is removed at all');
  assert.equal(mdToPlain('the __init__ and __main__ names'), 'the __init__ and __main__ names');
  assert.ok(mdToHtml(bare).includes('0_queue, 1_progressing'), 'and the html flavour agrees');
  // Member handles admit underscores on both X and Reddit, so this protects a mention too.
  assert.equal(mdToPlain('follow @gbti_network and @some_body'), 'follow @gbti_network and @some_body');
});

test('a hashtag at the start of a line is not a heading', () => {
  // The LinkedIn template ends "\n\n{hashtags}", so after renderTemplate the tags sit at a line start. A
  // heading rule that does not require the space after the hash eats every one of them, silently.
  assert.equal(mdToPlain('Body text here\n\n#AI #Prompts'), 'Body text here\n\n#AI #Prompts');
  assert.ok(mdToHtml('Body\n\n#AI #Prompts').includes('#AI #Prompts'), 'the html flavour keeps them too');
  // The control: a real ATX heading still converts, so the rule above is not just "never touch a hash".
  assert.equal(mdToPlain('# A Real Heading\n\nbody'), 'A Real Heading\n\nbody');
});

test('urls are never rewritten, whatever punctuation they carry', () => {
  for (const url of [
    'https://example.com/a_b_c_d',
    'https://x.com/q?a=*&b=*z',
    'https://en.wikipedia.org/wiki/Foo_(bar)',
  ]) {
    assert.ok(mdToPlain(`See ${url} now`).includes(url), `${url} was altered`);
  }
});

test('ambiguous punctuation is LEFT ALONE rather than guessed at', () => {
  assert.equal(mdToPlain('The area is 2 * 3 * 4 square units'), 'The area is 2 * 3 * 4 square units');
  assert.equal(mdToPlain('This is **not closed properly'), 'This is **not closed properly');
});

test('a link keeps its destination in plain text and becomes a real anchor in html', () => {
  const md = 'reference at [tropes.fyi](https://tropes.fyi/tropes-md). Credit.';
  assert.equal(mdToPlain(md), 'reference at tropes.fyi (https://tropes.fyi/tropes-md). Credit.');
  assert.ok(mdToHtml(md).includes('<a href="https://tropes.fyi/tropes-md">tropes.fyi</a>'));
  // A label that IS the destination must not print twice.
  assert.equal(mdToPlain('see [https://a.io](https://a.io) ok'), 'see https://a.io ok');
});

test('a hard-wrapped paragraph keeps its lines in plain text and collapses them in html', () => {
  // The two flavours differ here ON PURPOSE. Plain text has no reflow, so removing the author's newlines
  // would be a content change. HTML does reflow, and a <br> per source line pastes into Reddit as ragged
  // 95-character lines, which is worse than the markdown it replaced.
  assert.ok(mdToPlain(WRAPPED_NOTE).includes('asked, in\nplan mode'), 'plain keeps the source lines');
  const html = mdToHtml(WRAPPED_NOTE);
  assert.ok(!html.includes('<br>'), 'html treats a single newline as the soft break it is');
  assert.ok(html.includes('asked, in plan mode'), 'so the sentence reads as one line');
});

// ---------- the html flavour cannot be an injection vector ----------

test('mdToHtml escapes author-supplied text, including inside a code span', () => {
  // Member markdown is known to carry raw HTML (sow-158). The clipboard is a distribution channel, so the
  // escape has to happen before anything is wrapped in a tag, not after.
  const html = mdToHtml('<script>alert(1)</script> and <b>hi</b>');
  assert.ok(!html.includes('<script>'), 'no live script tag reaches the clipboard');
  assert.ok(html.includes('&lt;script&gt;'), 'it is shown as text instead');
  // The live corpus contains `/sow "<request>"` inside a code span. Unescaped, the browser parses <request>
  // as an unknown element, Reddit's paste sanitizer drops it, and the member's syntax becomes /sow "".
  const sow = mdToHtml(SOW_NOTE);
  assert.ok(sow.includes('&lt;request&gt;'), 'the angle-bracketed placeholder survives as visible text');
  assert.ok(sow.includes('<strong><code>'), 'and bold-wrapping-a-code-span still renders as both');
});

test('mdToHtml refuses a dangerous href and keeps the label as text', () => {
  const html = mdToHtml('[click](javascript:alert(1))');
  assert.ok(!html.includes('href'), 'no href at all, rather than a sanitized one');
  assert.ok(html.includes('click'), 'and the label is still readable');
  assert.ok(mdToHtml('[ok](https://a.io)').includes('href="https://a.io"'), 'a real link still links');
});

test('mdToHtml strips the anti-mention zero-width space from an href only', () => {
  // sanitizeMentions inserts U+200B after every @ before this module ever runs. In prose that is the guard
  // doing its job; inside a url it produces a dead link.
  const html = mdToHtml('docs at [here](https://x.com/@​user) ok');
  assert.ok(html.includes('href="https://x.com/@user"'), 'the href is clean');
  assert.ok(mdToPlain('hi @​someone').includes('​'), 'but prose keeps its guard');
});

test('a list inside a blockquote becomes a real list, not a literal hyphen', () => {
  const html = mdToHtml('> - one **bold**\n> - two');
  assert.ok(html.includes('<blockquote><ul><li>'), 'quote contents are a document, not a run of lines');
  assert.ok(!html.includes('- one'), 'so no markdown marker leaks through as text');
});

test('empty and absent input are safe', () => {
  for (const v of ['', null, undefined]) {
    assert.equal(mdToPlain(v), '');
    assert.equal(mdToHtml(v), '');
  }
});

// ---------- the wiring ----------

test('rendersMarkdown classifies the DELIVERY SURFACE, and fails closed', () => {
  assert.equal(rendersMarkdown('discord'), true, 'a Discord message renders markdown');
  assert.equal(rendersMarkdown('reddit'), false, 'the manual rail is the rich composer, not the md editor');
  assert.equal(rendersMarkdown('linkedin'), false);
  assert.equal(rendersMarkdown('bluesky'), false);
  // dev.to and Hashnode ARE markdown platforms, and are still false here: the text renderChannelText builds
  // for them is the post TITLE, which is a plain field. Their article bodies never pass through it.
  assert.equal(rendersMarkdown('devto'), false);
  assert.equal(rendersMarkdown('hashnode'), false);
  assert.equal(rendersMarkdown('a-channel-nobody-registered'), false, 'unknown fails to strip, the safe way');
  assert.equal(Object.values(CHANNEL_MARKDOWN).filter(Boolean).length, 2, 'only the two Discord channels');
});

test('renderChannelText strips for a plain channel and leaves Discord alone', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: {
    bluesky: { post: '{short-description}' },
    discord: { post: '{short-description}' },
  } } });
  const item = { source: 'post', title: 'T', url: 'https://gbti.network/x/', blurb: 'A **bold** claim' };
  assert.equal(renderChannelText(cfg, item, 'bluesky'), 'A bold claim');
  assert.equal(renderChannelText(cfg, item, 'discord'), 'A **bold** claim', 'Discord renders it, so it keeps it');
});

test('renderChannelText strips the textOverride branch too, which is the Post now path', () => {
  // The Social Queue posts the STORED task text as an override rather than re-rendering, so a task frozen in
  // KV before this shipped posts exactly the markdown it was stored with. Fixing only the template branch
  // would leave every already-queued task broken, and renderChannelText has TWO returns.
  const cfg = syndicationConfigFromParsed({});
  assert.equal(renderChannelText(cfg, {}, 'bluesky', { textOverride: 'A **bold** claim' }), 'A bold claim');
  assert.equal(renderChannelText(cfg, {}, 'discord', { textOverride: 'A **bold** claim' }), 'A **bold** claim');
});

test('renderRedditTitle strips, and renderRedditComment deliberately does NOT', () => {
  const cfg = syndicationConfigFromParsed({ syndication: { channel_templates: { reddit: {
    post: '**{title}**',
  } } } });
  const item = { source: 'post', title: 'Tailcat', url: 'https://gbti.network/x/', authorNote: TAILCAT_BODY, authorReddit: 'atwellpub' };
  assert.equal(renderRedditTitle(cfg, item), 'Tailcat', 'a title is a plain field, so it is stripped');

  // THE ONE EXCEPTION, pinned so nobody "fixes" it into consistency with the title above. The stored comment
  // stays markdown because it is the SOURCE the copy button converts into the clipboard html flavour. Strip
  // it here and the paste degrades to flat text and the whole feature is gone.
  const comment = renderRedditComment(cfg, item);
  assert.ok(comment.includes('> '), 'the comment keeps its blockquote markers in storage');
  assert.ok(comment.includes('**Tailcat**'), 'and its bold');
  assert.ok(mdToHtml(comment).includes('<strong>Tailcat</strong>'), 'which is what makes the paste work');
});
