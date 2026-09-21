// sow-266 Phase 3: the digest reads the owner's pitch copy and can carry a sponsor block.
//
// The two things worth most of these cases:
//   1. **With no settings, the mail is byte for byte what it was.** That is the fail-safe, and it is proved by
//      comparison rather than asserted in a comment.
//   2. **A sponsor's markup is sanitized before it reaches an inbox.** There is no content security policy in
//      an email client, so the sanitizer is the only thing between a supplied snippet and the reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderIssue } from '../membership/mail-render.mjs';
import { sanitizeSponsorHtml, sponsorText } from '../membership/mail-sponsor-sanitize.mjs';
import { resolveDigestConfig, DEFAULT_CTA } from '../membership/digest-config.mjs';
import { TIER, tierLabel } from '../membership/tiers.mjs';
import { mailDrainDeps } from '../workers/signup/index.mjs';
import fs from 'node:fs';
const fsReadRoot = (rel) => fs.readFileSync(new URL('../' + rel, import.meta.url), 'utf8');

const ISSUE = {
  layout: [{ key: 'articles', title: 'Articles', items: [{ title: 'A post', url: 'https://gbti.network/articles/x/' }] }],
  generatedAt: '2026-09-19T00:00:00Z',
};
const render = (ctx = {}) => renderIssue(ISSUE, ctx);
const withSponsor = (html) => ({ digestConfig: resolveDigestConfig({ mirror: { sponsor: { enabled: true, html } } }) });

// ---------------------------------------------------------------------------
// The pitch
// ---------------------------------------------------------------------------

test('sow-266: {plan} is SUBSTITUTED, and never reaches an inbox as a literal', () => {
  // The trap this closes. The stored copy carries the token so a plan rename cannot leave a stale name in the
  // mail, and NOTHING in the repository substituted it: the only other reader measures its length. Wiring the
  // settings in without this step would have sent "A {plan} membership adds..." to every subscriber.
  assert.match(DEFAULT_CTA.body, /\{plan\}/, 'the stored copy really does carry the token');
  const r = render();
  assert.doesNotMatch(r.html, /\{plan\}/, 'html');
  assert.doesNotMatch(r.text, /\{plan\}/, 'text');
  assert.ok(r.html.includes(`A ${tierLabel(TIER.member)} membership`), 'it becomes the plan name');
  assert.ok(r.text.includes(`A ${tierLabel(TIER.member)} membership`), 'in the text half too');
});

test('sow-266: the html and text halves carry the SAME pitch, from one source', () => {
  // They were two independent literals, and the compliance guard checks each against a rule rather than
  // against the other, so replacing one and leaving the other passes every test and sends two different
  // pitches in one mail.
  const body = 'A {plan} membership adds the thing you want.';
  const ctx = { digestConfig: resolveDigestConfig({ mirror: { cta: { body, linkLabel: 'Read more', linkUrl: '/membership/' } } }) };
  const r = render(ctx);
  const bound = `A ${tierLabel(TIER.member)} membership adds the thing you want.`;
  assert.ok(r.html.includes(bound), 'html carries the owner copy');
  assert.ok(r.text.includes(bound), 'text carries the same');
  assert.ok(r.html.includes('Read more'), 'and the owner link label');
  assert.ok(r.text.includes('Read more:'), 'in both halves');
});

test('sow-266: the owner can switch the pitch off, which is distinct from having no copy', () => {
  const off = { digestConfig: resolveDigestConfig({ mirror: { cta: { enabled: false } } }) };
  const r = render(off);
  assert.doesNotMatch(r.html, /membership-cta/, 'the block is gone, sentinel and all');
  assert.doesNotMatch(r.text, /membership/i);
  // And the per-issue suppression still works independently of the standing setting.
  assert.doesNotMatch(render({ membershipCta: false }).html, /membership-cta/);
});

test('sow-266: the pitch copy is ESCAPED, so a stray angle bracket cannot open a tag', () => {
  const ctx = { digestConfig: resolveDigestConfig({ mirror: { cta: { body: 'Plans <b>from</b> us & more', linkLabel: '<x>' } } }) };
  const r = render(ctx);
  assert.ok(r.html.includes('Plans &lt;b&gt;from&lt;/b&gt; us &amp; more'));
  assert.doesNotMatch(r.html, /<b>from<\/b>/);
});

// ---------------------------------------------------------------------------
// The sponsor block
// ---------------------------------------------------------------------------

test('sow-266: a disabled sponsor leaves NO trace, which the shipped guard checks by word', () => {
  const r = render();
  assert.doesNotMatch(r.html, /sponsor/i, 'not even a sentinel: the compliance guard searches for the word');
  assert.doesNotMatch(r.text, /sponsor/i);
  // Enabled with nothing to show is still off: a bare "Sponsored" label over nothing is worse than no block.
  assert.doesNotMatch(render(withSponsor('')).html, /sponsor/i);
  assert.doesNotMatch(render(withSponsor('   ')).html, /sponsor/i);
  // And markup that reduces to nothing after sanitizing is the same case.
  assert.doesNotMatch(render(withSponsor('<script>x()</script>')).html, /sponsor/i);
});

test('sow-266 Phase 5: THE KILL SWITCH. A configured sponsor, switched off, leaves no trace', () => {
  // The acceptance criterion for the whole item, and the case the test above it does NOT cover: that one proves
  // an EMPTY sponsor renders nothing, which is a different thing from a real sponsor being turned off. This is
  // what the owner actually reaches for, and the failure it guards against is markup that survives the switch.
  const MARKUP = '<p>Acme builds <b>things</b>. <a href="https://acme.test/">Visit</a></p>';
  const on = render({ digestConfig: resolveDigestConfig({ mirror: { sponsor: { enabled: true, html: MARKUP } } }) });
  assert.match(on.html, /Sponsored/, 'the control: this markup DOES render when the switch is on');

  const off = render({ digestConfig: resolveDigestConfig({ mirror: { sponsor: { enabled: false, html: MARKUP } } }) });
  assert.doesNotMatch(off.html, /sponsor/i, 'the word itself, in any case, is what the shipped compliance guard searches for');
  assert.doesNotMatch(off.text, /sponsor/i);
  assert.doesNotMatch(off.html, /Acme/, 'and the markup goes with it, not just the label');
  assert.doesNotMatch(off.html, /acme\.test/);
  assert.doesNotMatch(off.text, /Acme/);
});

test('sow-266: an enabled sponsor renders, LABELLED, after the editorial', () => {
  const r = render(withSponsor('<p>Acme builds <b>things</b>. <a href="https://acme.test/">Visit</a></p>'));
  assert.match(r.html, /Sponsored/);
  assert.ok(r.html.includes('Acme builds <b>things</b>'));
  // After the pitch, before the footer: the CAN-SPAM shape the pitch was designed around.
  assert.ok(r.html.indexOf('Sponsored') > r.html.indexOf('<!--/membership-cta-->'), 'after the pitch');
  // The text half gets the line too, with the address of the link.
  assert.match(r.text, /Sponsored: Acme builds things\. Visit https:\/\/acme\.test\//);
});

test('sow-266: a sponsor block needs editorial above it, like the pitch does', () => {
  const empty = { layout: [{ key: 'articles', title: 'Articles', items: [], empty: true }], generatedAt: '2026-09-19T00:00:00Z' };
  const r = renderIssue(empty, withSponsor('<p>Acme</p>'));
  assert.doesNotMatch(r.html, /Sponsored/, 'an all-empty issue carrying only solicitation reads as promotional');
});

// ---------------------------------------------------------------------------
// The sanitizer
// ---------------------------------------------------------------------------

test('sow-266: the elements whose CONTENT is the danger go whole', () => {
  for (const [input, mustNotContain] of [
    ['<script>alert(1)</script>ok', 'alert'],
    ['<script src="https://x.test/t.js"></script>ok', 't.js'],
    ['<style>body{display:none}</style>ok', 'display:none'],
    ['<iframe src="https://x.test/"></iframe>ok', 'iframe'],
    ['<form action="https://x.test/"><input name="e"></form>ok', 'action'],
    ['<noscript>hidden</noscript>ok', 'hidden'],
    ['<svg onload="x()"></svg>ok', 'onload'],
    ['<object data="https://x.test/x"></object>ok', 'x.test'],
  ]) {
    const out = sanitizeSponsorHtml(input);
    assert.ok(!out.includes(mustNotContain), `${input} -> ${out}`);
    assert.ok(out.includes('ok'), `the surrounding text survives: ${input}`);
  }
});

test('sow-266: a re-formed or nested pair cannot survive one pass', () => {
  // The classic: removing <script>...</script> once leaves a new pair behind.
  assert.doesNotMatch(sanitizeSponsorHtml('<scr<script>ipt>alert(1)</script>'), /alert/);
  assert.doesNotMatch(sanitizeSponsorHtml('<script><script>alert(1)</script></script>'), /alert/);
  // An unclosed one leaves no opening tag behind either.
  assert.doesNotMatch(sanitizeSponsorHtml('<script>alert(1)'), /<script/);
});

test('sow-266: every event handler is dropped, however it is written', () => {
  for (const attr of ['onclick="x()"', 'ONCLICK="x()"', "onerror='x()'", 'onload=x()', 'onmouseover = "x()"']) {
    const out = sanitizeSponsorHtml(`<p ${attr}>hi</p>`);
    assert.doesNotMatch(out, /on[a-z]+\s*=/i, attr);
    assert.ok(out.includes('hi'), attr);
  }
});

test('sow-266: only https and mailto survive, and an unsafe link stops being a link', () => {
  assert.ok(sanitizeSponsorHtml('<a href="https://x.test/">go</a>').includes('href="https://x.test/"'));
  assert.ok(sanitizeSponsorHtml('<a href="mailto:a@b.test">mail</a>').includes('href="mailto:a@b.test"'));
  for (const bad of ['http://x.test/', '//x.test/', 'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'data:text/html,<b>x', 'x.test']) {
    const out = sanitizeSponsorHtml(`<a href="${bad}">go</a>`);
    assert.doesNotMatch(out, /<a\b/, bad);
    assert.ok(out.includes('go'), `the text survives: ${bad}`);
  }
  // An image is https-only too, and one without a usable source renders nothing rather than a broken icon.
  assert.ok(sanitizeSponsorHtml('<img src="https://x.test/l.png" alt="Acme" width="80">').includes('src="https://x.test/l.png"'));
  assert.equal(sanitizeSponsorHtml('<img src="http://x.test/l.png">'), '');
  assert.equal(sanitizeSponsorHtml('<img src="data:image/gif;base64,R0lGOD">'), '');
});

test('sow-266: a link always leaves marked as sponsored and opening away', () => {
  const out = sanitizeSponsorHtml('<a href="https://x.test/">go</a>');
  assert.match(out, /rel="noopener nofollow sponsored"/);
  assert.match(out, /target="_blank"/);
});

test('sow-266: presentation attributes a sponsor might send are dropped, text kept', () => {
  const out = sanitizeSponsorHtml('<p style="position:fixed" class="x" id="y" data-track="z">hi</p>');
  assert.equal(out, '<p>hi</p>');
  // A tag nobody listed is UNWRAPPED, so its words survive and the element does not.
  assert.equal(sanitizeSponsorHtml('<marquee>hi</marquee>'), 'hi');
  assert.equal(sanitizeSponsorHtml('<div><h1>Big</h1></div>'), 'Big');
  // Comments go, since some clients act on conditional ones.
  assert.equal(sanitizeSponsorHtml('a<!--[if IE]><script>x()</script><![endif]-->b'), 'ab');
});

test('sow-266: width and height are digits or nothing, and alt is bounded', () => {
  assert.ok(sanitizeSponsorHtml('<img src="https://x.test/a.png" width="80" height="40">').includes('width="80"'));
  assert.doesNotMatch(sanitizeSponsorHtml('<img src="https://x.test/a.png" width="100%">'), /width=/);
  assert.doesNotMatch(sanitizeSponsorHtml('<img src="https://x.test/a.png" width="expression(1)">'), /width=/);
  const long = sanitizeSponsorHtml(`<img src="https://x.test/a.png" alt="${'x'.repeat(500)}">`);
  assert.ok((long.match(/alt="(x*)"/)?.[1].length ?? 0) <= 200);
});

test('sow-266: the attribute allowlist is PER TAG, not one pool', () => {
  // Found by mutation: removing the per-tag check left every case passing, because the value gate refuses a
  // name it does not recognise. That second layer is not the same rule. `title` is legitimate on a link and
  // has no business on an image, and only the per-tag list says so.
  assert.ok(sanitizeSponsorHtml('<a href="https://x.test/" title="Acme">go</a>').includes('title="Acme"'));
  assert.doesNotMatch(sanitizeSponsorHtml('<img src="https://x.test/a.png" title="Acme">'), /title=/);
  assert.doesNotMatch(sanitizeSponsorHtml('<p href="https://x.test/">hi</p>'), /href=/);
  assert.doesNotMatch(sanitizeSponsorHtml('<span width="80">hi</span>'), /width=/);
});

test('sow-266: an UNCLOSED content element takes the rest with it', () => {
  // Found by mutation. Removing only the tag unwraps its body into the mail as visible text, so an unclosed
  // script prints somebody's code as copy inside the sponsor block. Inert, and still wrong. Where the end
  // cannot be located, everything after it is treated as content.
  assert.equal(sanitizeSponsorHtml('<script>alert(1)'), '');
  assert.equal(sanitizeSponsorHtml('keep me <script>bad'), 'keep me ');
  assert.equal(sanitizeSponsorHtml('<style>body{x}'), '');
  assert.doesNotMatch(sanitizeSponsorHtml('<p>ok</p><script>alert(1)'), /alert/);
  assert.ok(sanitizeSponsorHtml('<p>ok</p><script>alert(1)').includes('ok'), 'what came before survives');
});

test('sow-266: the wreckage of a removed element is escaped, not shipped as markup', () => {
  // A truncated tag left behind when a re-formed element was removed around it. Every well formed tag has
  // already been rewritten into a known set, so a `<` that does not begin one of those is text.
  assert.equal(sanitizeSponsorHtml('<scr<script>ipt>alert(1)</script>'), '&lt;scr');
  assert.equal(sanitizeSponsorHtml('<p>a < b</p>'), '<p>a &lt; b</p>');
  assert.equal(sanitizeSponsorHtml('<a href="https://x.test/">go</a>').startsWith('<a '), true, 'a real tag is untouched');
});

test('sow-266: a quote style cannot smuggle an attribute through', () => {
  for (const t of ['<a href=https://x.test/ onclick=x()>go</a>', "<a href='https://x.test/' onclick='x()'>go</a>"]) {
    const out = sanitizeSponsorHtml(t);
    assert.doesNotMatch(out, /onclick/i, t);
    assert.match(out, /href="https:\/\/x\.test\/"/, t);
  }
});

test('sow-266: the text alternative is built from the SANITIZED markup, never the raw input', () => {
  // Or a stripped script reappears in the half nobody looks at.
  assert.doesNotMatch(sponsorText('<script>alert(1)</script>Acme'), /alert/);
  assert.equal(sponsorText('<p>Acme <b>Ltd</b></p>'), 'Acme Ltd');
  assert.equal(sponsorText('<a href="http://x.test/">go</a>'), 'go', 'an unsafe link contributes no address');
  assert.equal(sponsorText(''), '');
  assert.equal(sponsorText('<a href="https://x.test/">A</a><a href="https://x.test/">A</a>'), 'AA https://x.test/', 'one address, not two');
});

test('sow-266: nothing in, nothing out, for every shape of nothing', () => {
  for (const v of [undefined, null, '', '   ', 0, {}, []]) assert.equal(sanitizeSponsorHtml(v), '', JSON.stringify(v));
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

const fakeKv = (value) => ({ get: async (_k, _t) => value });

test('sow-266 WIRING: the composition root READS the setting, or none of this reaches a real mail', () => {
  // The file next door records that the whole suite stayed green when this exact function stopped passing
  // clickBase, because every other test built its own ctx by hand. The same hole applies here: every case
  // above injects digestConfig directly, so without this one, deleting the KV read would change nothing that
  // any test can see and the owner's copy would silently never ship.
  const src = fsReadRoot('workers/signup/index.mjs');
  assert.match(src, /env\.SIGNUP_KV\?\.get\(DIGEST_CONFIG_KV_KEY, 'json'\)/, 'it reads the mirror');
  assert.match(src, /renderMailIssue\(issue, \{ siteUrl, clickBase, webBase: clickBase, digestConfig, \.\.\.ctx \}\)/, 'and hands it to every render');
});

test('sow-266 WIRING: a sponsor in KV reaches the rendered mail', async () => {
  const deps = await mailDrainDeps({
    SITE_URL: 'https://gbti.network', PUBLIC_BASE_URL: 'https://gbti.network',
    SIGNUP_KV: fakeKv({ sponsor: { enabled: true, html: '<p>Acme <a href="https://acme.test/">here</a></p>' } }),
  });
  const { html, text } = deps.renderIssue(ISSUE, {});
  assert.match(html, /Sponsored/);
  assert.ok(html.includes('Acme'));
  assert.match(text, /Sponsored: Acme here https:\/\/acme\.test\//);
});

test('sow-266 WIRING: the owner copy in KV reaches the mail, and an unreadable store falls back', async () => {
  const withCopy = await mailDrainDeps({
    SITE_URL: 'https://gbti.network', PUBLIC_BASE_URL: 'https://gbti.network',
    SIGNUP_KV: fakeKv({ cta: { body: 'A {plan} membership is worth it.', linkLabel: 'Join us' } }),
  });
  const r = withCopy.renderIssue(ISSUE, {});
  assert.ok(r.html.includes(`A ${tierLabel(TIER.member)} membership is worth it.`));
  assert.ok(r.html.includes('Join us'));

  // FAIL-SAFE: a store that throws leaves the pitch reading what the renderer ships, not nothing.
  const broken = await mailDrainDeps({
    SITE_URL: 'https://gbti.network', PUBLIC_BASE_URL: 'https://gbti.network',
    SIGNUP_KV: { get: async () => { throw new Error('kv down'); } },
  });
  const f = broken.renderIssue(ISSUE, {});
  assert.ok(f.html.includes(`A ${tierLabel(TIER.member)} membership adds comments`), 'the shipped copy');
  assert.doesNotMatch(f.html, /sponsor/i, 'and the sponsor stays off, which is the opposite direction on purpose');

  // No store at all is the same: a fixture, a test harness, a fork before the mirror is written.
  const none = await mailDrainDeps({ SITE_URL: 'https://gbti.network', PUBLIC_BASE_URL: 'https://gbti.network' });
  assert.ok(none.renderIssue(ISSUE, {}).html.includes(`A ${tierLabel(TIER.member)} membership adds comments`));
});
