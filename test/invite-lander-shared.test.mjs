// sow-243: the three invite landers are ONE page rendered three times. These pin the consolidation so the
// chrome cannot quietly come back into a page: each page imports the shared component and holds none of the
// mechanism (the Turnstile widget, the coupon chip, the CTA callbacks), the component is the only file that
// does, every lander stays noindex and out of the sitemap, and no page carries a tier superlative outside its
// own campaign data. test/invite-lander-parity.test.mjs keeps guarding the tier binding; this file guards the
// shape.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const PAGES = ['src/pages/codeable-invite/index.astro', 'src/pages/member-invite/index.astro', 'src/pages/curator-invite/index.astro'];
const COMPONENT = 'src/components/invite/InviteLander.astro';
const MECHANISM = ['cf-turnstile', 'data-coupon-chip', 'gbtiTurnstileOk', "'/signup/start'", 'data-faq', 'challenges.cloudflare.com/turnstile'];

test('every lander imports the shared component and passes its tier binding and benefits through it', () => {
  for (const p of PAGES) {
    const src = read(p);
    assert.match(src, /import InviteLander from '\.\.\/\.\.\/components\/invite\/InviteLander\.astro'/, p);
    assert.match(src, /<InviteLander/, p);
    assert.match(src, /tierDisplay\('(member|creator)'\)/, `${p} binds its tier through tierDisplay`);
    assert.match(src, /benefits=\{\w+Benefits\}/, `${p} hands the registry benefits to the component`);
  }
});

test('no lander page carries the mechanism itself; the component is the one place it lives', () => {
  for (const p of PAGES) {
    const src = read(p);
    for (const lit of MECHANISM) assert.ok(!src.includes(lit), `${p} must not contain ${lit}`);
  }
  const comp = read(COMPONENT);
  for (const lit of MECHANISM) assert.ok(comp.includes(lit), `the component carries ${lit}`);
});

test('the component holds no tier claim of its own: no tier name, no price, no superlative', () => {
  const comp = read(COMPONENT);
  for (const lit of ['Network Member', 'Curator', 'Content Creator', '$50', '$150', 'top tier', 'publish under your own name', 'tierDisplay(']) {
    assert.ok(!comp.includes(lit), `the shared template must not say "${lit}"; that belongs in a page's campaign data`);
  }
});

test('the archived v1 page and the retired linkedin route are untouched by the consolidation', () => {
  assert.ok(fs.existsSync(path.join(root, 'src/pages/codeable-invite/v1.astro')), 'v1 stays');
  assert.ok(!read('src/pages/codeable-invite/v1.astro').includes('InviteLander'), 'the archive is not rewritten');
  assert.ok(!fs.existsSync(path.join(root, 'src/pages/linkedin-invite')), '/linkedin-invite/ stays a redirect, not a page');
});

test('every lander is noindex through the component and excluded from the sitemap', () => {
  assert.match(read(COMPONENT), /<BaseLayout [^>]*\bnoindex\b/, 'the component sets noindex for every page it renders');
  const cfg = read('astro.config.mjs');
  for (const route of ['codeable-invite', 'member-invite', 'curator-invite']) {
    assert.ok(cfg.includes(route), `astro.config.mjs must still name ${route} in the sitemap exclusion`);
  }
});

test('a story section a page passes through a slot is styled: the component styles are global and .ci-prefixed', () => {
  const comp = read(COMPONENT);
  assert.match(comp, /<style is:global>/);
  const css = comp.slice(comp.indexOf('<style is:global>'), comp.indexOf('</style>'));
  const bare = [...css.matchAll(/^ {2}([^\s@/}][^{\n]*)\{/gm)].map((m) => m[1].trim()).filter((sel) => !/^(\.ci\b|html\[data-theme)/.test(sel));
  assert.deepEqual(bare, [], 'every top-level rule starts with .ci or html[data-theme]');
  assert.match(comp, /<slot name="before-benefits" \/>/);
  assert.match(comp, /<slot name="after-faq" \/>/);
});
