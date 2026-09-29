// Owner, 2026-09-29: the digest's new header line and its closing message, which reads differently for a paying
// member and for everybody else. See membership/mail-closing.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { renderIssue } from '../membership/mail-render.mjs';
import { WEEKLY_HEADER_LINE, CLOSING_TARGETS, closingAudience, SIGN_OFF } from '../membership/mail-closing.mjs';
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
const MEMBER = 'To contribute to future digests, visit your';
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

test('the member paragraph is italic and the invitation is not (owner, 2026-09-29)', () => {
  const para = (html, marker) => {
    const at = html.indexOf(marker);
    return html.slice(html.lastIndexOf('<div style="', at), at);
  };
  assert.match(para(renderIssue(ISSUE, { siteUrl: SITE, audience: 'member' }).html, MEMBER), /font-style:italic/);
  assert.doesNotMatch(para(renderIssue(ISSUE, { siteUrl: SITE }).html, GUEST), /font-style:italic/);
  assert.doesNotMatch(renderIssue(ISSUE, { siteUrl: SITE, audience: 'member' }).text, /To contribute to it,/);
});

test('the sign-off closes every issue: centred, italic, larger, under the subscribe box, above the social row', () => {
  const email = renderIssue(ISSUE, { siteUrl: SITE });
  const web = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' }).html;
  const member = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web', audience: 'member' }).html;
  for (const [name, html] of [['email', email.html], ['web', web], ['web member view', member]]) {
    const at = html.indexOf(SIGN_OFF);
    assert.ok(at > html.indexOf(LEAD), `${name}: under the closing`);
    assert.ok(at < html.indexOf('<!--social-->'), `${name}: above the social row`);
    const style = html.slice(html.lastIndexOf('<div style="', at), at);
    assert.match(style, /font-size:15px;font-style:italic/, `${name}: larger and italic`);
    assert.match(html.slice(html.lastIndexOf('<td ', at), at), /text-align:center/, `${name}: centred`);
  }
  assert.ok(web.indexOf(SIGN_OFF) > web.indexOf('</form>'), 'web: under the subscribe box');
  assert.ok(!WEEKLY_HEADER_LINE.includes('great week'), 'it left the header line');
  assert.ok(email.text.includes(`\n\n${SIGN_OFF}\n\n`), 'the text part carries it too');
});

test('the member paragraph is a lighter grey that still reads, in both themes', () => {
  const colorOf = (html, marker) => /color:(#[0-9a-f]{6})/i.exec(html.slice(html.lastIndexOf('<div style="', html.indexOf(marker)), html.indexOf(marker)))?.[1];
  assert.equal(colorOf(renderIssue(ISSUE, { siteUrl: SITE, audience: 'member' }).html, MEMBER), '#6c6976', 'light: 5.4:1 on the white card');
  assert.equal(colorOf(renderIssue(ISSUE, { siteUrl: SITE, audience: 'member', theme: 'dark' }).html, MEMBER), '#9a96a1', 'dark: 5.5:1 on the dark card');
  assert.equal(colorOf(renderIssue(ISSUE, { siteUrl: SITE }).html, GUEST), '#4a4653', 'the invitation keeps the standard text colour');
});

test('the web edition\'s social image is the Coffee Ring design, 1200 x 630, served from the site', async () => {
  const { DIGEST_OG_IMAGE } = await import('../membership/mail-render.mjs');
  const html = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' }).html;
  assert.ok(html.includes(`<meta property="og:image" content="${SITE}${DIGEST_OG_IMAGE}">`));
  const { readFileSync } = await import('node:fs');
  const png = readFileSync(new URL(`../public${DIGEST_OG_IMAGE}`, import.meta.url));
  assert.equal(png.toString('ascii', 1, 4), 'PNG');
  assert.deepEqual([png.readUInt32BE(16), png.readUInt32BE(20)], [1200, 630], 'the size link previews expect');
  assert.ok(png.length < 1024 * 1024, 'under the media cap');
});

test('the subject names the day and the week: "GBTI Digest · 16 items · September 29th · Week 40"', async () => {
  const { ordinal } = await import('../membership/mail-render.mjs');
  const issue = { generatedAt: 1790683225069, counts: { article: 0, project: 1, prompt: 0, share: 10, news: 5 }, layout: [] }; // 2026-09-29, the issue that went out
  assert.equal(renderIssue(issue, {}).subject, 'GBTI Digest · 16 items · September 29th · Week 40');
  const want = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 30: '30th', 31: '31st', 111: '111th', 112: '112th' };
  for (const [n, s] of Object.entries(want)) assert.equal(ordinal(Number(n)), s);
});
