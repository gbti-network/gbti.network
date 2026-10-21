// The canonical-URL rule for cross-posted articles.
//
// The field this guards (`canonicalUrl`) sat in both content schemas and in the editor form with NO consumer
// at all: a member could fill it in and the published page still declared itself the original. These tests
// pin the consumer, and the companion dist check (scripts/check-canonical.mjs) pins the wiring, because a
// green resolver proves nothing if the layout stops calling it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveCanonical } from '../src/lib/canonical.mjs';

const OWN = 'https://gbti.network/articles/a-post/';

test('no override: the page is its own canonical', () => {
  for (const override of [undefined, null, '', '   ', 42, {}, []]) {
    assert.equal(resolveCanonical({ override, pageUrl: OWN }), OWN, `override=${JSON.stringify(override)}`);
  }
});

test('an absolute http(s) override wins', () => {
  assert.equal(
    resolveCanonical({ override: 'https://namedaemon.com/blog/top-dns-providers/', pageUrl: OWN }),
    'https://namedaemon.com/blog/top-dns-providers/',
  );
  assert.equal(resolveCanonical({ override: 'http://example.com/x', pageUrl: OWN }), 'http://example.com/x');
});

test('surrounding whitespace is trimmed, because the editor field is free text', () => {
  assert.equal(resolveCanonical({ override: '  https://example.com/x  ', pageUrl: OWN }), 'https://example.com/x');
});

test('a value that is not an absolute web URL never reaches the head', () => {
  // The field is member-supplied and lands in an href. Each of these parses or fails in a different way,
  // and every one of them must fall back to our own URL rather than being written out.
  for (const bad of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'mailto:someone@example.com',
    'ftp://example.com/x',
    '/articles/elsewhere/',
    'example.com/no-scheme',
    'not a url at all',
  ]) {
    assert.equal(resolveCanonical({ override: bad, pageUrl: OWN }), OWN, `should have been refused: ${bad}`);
  }
});

test('a URL object for pageUrl is accepted, since the layout passes one', () => {
  assert.equal(resolveCanonical({ override: '', pageUrl: new URL(OWN) }), OWN);
});

test('BaseLayout moves rel=canonical only, and leaves og:url on this page', () => {
  // Pointing og:url at someone else's site would send shares, comments and referral attribution away from
  // the page that carries them. This is the half of the rule that cannot be unit tested through the module.
  const layout = readFileSync(new URL('../src/layouts/BaseLayout.astro', import.meta.url), 'utf8');
  assert.match(layout, /<link rel="canonical" href=\{canonicalHref\} \/>/, 'rel=canonical must use the resolved value');
  assert.match(layout, /<meta property="og:url" content=\{pageUrl\} \/>/, 'og:url must stay on this page');
  assert.match(layout, /resolveCanonical\(/, 'BaseLayout must call the shared resolver');
});

test('the article page hands the frontmatter field to the layout', () => {
  // Without this the resolver is dead code and the field silently does nothing again, which is the exact
  // state this work was fixing.
  const page = readFileSync(new URL('../src/pages/articles/[slug].astro', import.meta.url), 'utf8');
  assert.match(page, /<BaseLayout[^>]*\bcanonical=\{d\.canonicalUrl\}/, 'articles/[slug].astro must pass canonical={d.canonicalUrl}');
});
