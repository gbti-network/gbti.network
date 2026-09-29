// Owner, 2026-09-29: the digest's new header line and its closing message, which reads differently for a paying
// member and for everybody else. See membership/mail-closing.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderIssue } from '../membership/mail-render.mjs';
import { WEEKLY_HEADER_LINE, CLOSING_TARGETS, closingAudience } from '../membership/mail-closing.mjs';
import { FIXED_TARGETS, resolveClick } from '../membership/mail-click.mjs';
import { DIGEST_ENTITLED_KV_KEY } from '../membership/digest-entitlement.mjs';
import { WEB_STORE_URL } from '../src/lib/extension-store.mjs';
import { mailDrainDeps } from '../workers/signup/index.mjs';

const SITE = 'https://gbti.network';
const ISSUE = {
  issueId: 'weekly-2026-09-29',
  layout: [
    { key: 'project', label: 'Projects', items: [{ title: 'SurfacedBy', url: `${SITE}/projects/surfacedby/` }] },
    { key: 'article', label: 'Articles', empty: true, note: 'No new articles since the last issue.', items: [] },
  ],
  generatedAt: '2026-09-29T00:00:00Z',
};
const LEAD = 'Thanks everyone for paying attention! We share a digest like this one every week.';
const GUEST = 'If you are interested in joining and writing for the GBTI Network community';
const MEMBER = 'To contribute to it, visit your';
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

test('the weekly header line is the owner copy, in both halves', () => {
  const r = renderIssue(ISSUE, { siteUrl: SITE });
  assert.ok(r.html.includes(WEEKLY_HEADER_LINE), 'html');
  assert.ok(r.text.includes(WEEKLY_HEADER_LINE), 'text');
  assert.doesNotMatch(r.html + r.text, /Everything new across the network since the last issue/, 'the old line is gone');
  // An explicit header line (the welcome issue's) still wins.
  assert.ok(renderIssue(ISSUE, { siteUrl: SITE, headerLine: 'Custom.' }).html.includes('Custom.'));
});

test('everybody but a member reads the invitation, linking the memberships page', () => {
  for (const audience of [undefined, 'guest', 'free', '', null]) {
    const { html, text } = renderIssue(ISSUE, { siteUrl: SITE, audience });
    assert.ok(html.includes(LEAD) && text.includes(LEAD), `lead (${audience})`);
    assert.ok(html.includes(GUEST) && text.includes(GUEST), `invitation (${audience})`);
    assert.ok(!html.includes(MEMBER) && !text.includes(MEMBER), `no member copy (${audience})`);
    assert.match(html, /href="https:\/\/gbti\.network\/membership\/\?[^"]*utm_content=closing-membership[^"]*"[^>]*>memberships page<\/a>/);
    assert.match(text, /memberships page \(https:\/\/gbti\.network\/membership\//);
  }
  assert.equal(closingAudience('Member'), 'guest', 'only the exact value selects the member copy');
  // Owner, 2026-09-29: the invitation ends at the link; the list of member perks after it was cut.
  const { text } = renderIssue(ISSUE, { siteUrl: SITE });
  assert.doesNotMatch(text, /Members can join our private Discord|see you next week on the GBTI Digest/);
  assert.match(text, /please visit our memberships page \([^)]+\)\.\n/);
});

test('a member reads how to contribute, with the WorkBench and the extension linked', () => {
  const { html, text } = renderIssue(ISSUE, { siteUrl: SITE, audience: 'member' });
  assert.ok(html.includes(LEAD) && text.includes(LEAD));
  assert.ok(html.includes(MEMBER) && text.includes(MEMBER));
  assert.ok(!html.includes(GUEST) && !text.includes(GUEST), 'no invitation to join');
  assert.match(html, /href="https:\/\/gbti\.network\/workbench\/\?[^"]*utm_content=closing-workbench[^"]*"[^>]*>WorkBench<\/a>/);
  // The store listing is off-site, so it is not utm-tagged (only gbti.network links are); without a click base it is plain.
  assert.ok(decode(html).includes(`href="${WEB_STORE_URL}"`), 'the store listing');
  assert.match(text, /WorkBench \(https:\/\/gbti\.network\/workbench\//);
  assert.ok(text.includes(`Chrome extension (${WEB_STORE_URL}`));
  // The closing itself; the separate membership pitch above it is the owner's switch (off in production).
  const closing = html.slice(html.indexOf(LEAD), html.indexOf('<!--social-->'));
  assert.ok(closing.length > LEAD.length, 'the closing block was found');
  assert.doesNotMatch(closing, /\/membership\//, 'a member is not pointed at the membership page');
});

test('the web edition is public, so it carries the invitation', () => {
  const { html } = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' });
  assert.ok(html.includes(GUEST) && !html.includes(MEMBER));
});

test('the closing is the last thing before the social row, after the empty-section line', () => {
  const { html } = renderIssue(ISSUE, { siteUrl: SITE });
  const empty = html.indexOf('Browse the archive');
  const lead = html.indexOf(LEAD);
  const social = html.indexOf('Follow the GBTI Network');
  assert.ok(empty > 0 && lead > empty, 'below "Nothing new in ... Browse the archive"');
  assert.ok(social < 0 || social > lead, 'above the social row');
});

test('an issue with no editorial content carries no closing', () => {
  const { html, text } = renderIssue({ ...ISSUE, layout: [ISSUE.layout[1]] }, { siteUrl: SITE });
  assert.ok(!html.includes(LEAD) && !text.includes(LEAD));
});

test('every closing link resolves through the click counter to its own destination', () => {
  // A tracked link the counter cannot find in its candidate set bounces the reader to the site root.
  for (const [placement, target] of Object.entries(CLOSING_TARGETS)) assert.equal(FIXED_TARGETS[placement], target);
  const clickBase = 'https://signup.gbti.network';
  const want = {
    'closing-membership': `${SITE}/membership/`,
    'closing-workbench': `${SITE}/workbench/`,
    'closing-extension': WEB_STORE_URL,
  };
  for (const audience of ['guest', 'member']) {
    const { html } = renderIssue(ISSUE, { siteUrl: SITE, clickBase, audience });
    const links = [...html.matchAll(/https:\/\/signup\.gbti\.network\/c\/[^/]+\/(closing-[a-z]+)\/([0-9a-f]{8})/g)];
    assert.ok(links.length >= 1, `${audience}: the closing links go through the counter`);
    for (const [, placement, slot] of links) assert.equal(resolveClick(ISSUE, SITE, slot), want[placement], `${audience} ${placement}`);
  }
});

test('the copy follows the writing rules: no em or en dashes, no contractions', () => {
  const all = ['guest', 'member'].map((audience) => renderIssue(ISSUE, { siteUrl: SITE, audience }).text).join('\n') + WEEKLY_HEADER_LINE;
  assert.doesNotMatch(all, /[–—]/);
  assert.doesNotMatch(all, /\b(?:don|can|won|isn|aren|we|you|it|that)['’](?:t|re|ll|s|ve|d)\b/i);
});

// The composition root decides the audience per recipient from the members-edition entitlement list.
const kvWith = (entitled, { throws = false } = {}) => ({
  get: async (key) => {
    if (throws) throw new Error('kv down');
    return key === DIGEST_ENTITLED_KV_KEY ? entitled : null;
  },
});
const ENV = { SITE_URL: SITE, PUBLIC_BASE_URL: 'https://signup.gbti.network' };

test('WIRING: a paying member (on the entitlement list) reads the member closing; nobody else does', async () => {
  const { renderIssue: render } = await mailDrainDeps({ ...ENV, SIGNUP_KV: kvWith({ generatedAt: '2026-09-29T00:00:00Z', ids: ['42'] }) });
  const member = render(ISSUE, { subscriber: { source: 'member', githubId: '42' } }).html;
  const free = render(ISSUE, { subscriber: { source: 'member', githubId: '7' } }).html;
  const anon = render(ISSUE, { subscriber: { source: 'anon' } }).html;
  assert.ok(member.includes(MEMBER) && !member.includes(GUEST), 'the paying member');
  assert.ok(free.includes(GUEST), 'an account that is not paying');
  assert.ok(anon.includes(GUEST), 'an email-only subscriber');
});

test('WIRING: an unreadable or missing list sends everybody the invitation', async () => {
  for (const kv of [kvWith(null), kvWith(null, { throws: true }), kvWith({ ids: 'nope' })]) {
    const { renderIssue: render } = await mailDrainDeps({ ...ENV, SIGNUP_KV: kv });
    assert.ok(render(ISSUE, { subscriber: { source: 'member', githubId: '42' } }).html.includes(GUEST));
  }
});
