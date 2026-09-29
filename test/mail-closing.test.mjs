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

test('the sign-off closes every issue: centred, italic, under the subscribe box, above the social row', () => {
  const email = renderIssue(ISSUE, { siteUrl: SITE });
  const web = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' }).html;
  const member = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web', audience: 'member' }).html;
  const memberMail = renderIssue(ISSUE, { siteUrl: SITE, audience: 'member' }).html;
  // Its face follows the closing: the member panel's sans, the non-member colophon's serif a size up.
  for (const [name, html, face, marker] of [
    ['email', email.html, /font-family:Georgia,'Times New Roman',serif;font-size:16px;font-style:italic/, GUEST],
    ['web', web, /font-family:Georgia,'Times New Roman',serif;font-size:16px;font-style:italic/, GUEST],
    ['email member', memberMail, /font-family:Arial,Helvetica,sans-serif;font-size:15px;font-style:italic/, MEMBER],
    ['web member view', member, /font-family:Arial,Helvetica,sans-serif;font-size:15px;font-style:italic/, MEMBER],
  ]) {
    const at = html.indexOf(SIGN_OFF);
    assert.ok(at > html.indexOf(marker), `${name}: under the closing`);
    assert.ok(at < html.indexOf('<!--social-->'), `${name}: above the social row`);
    assert.match(html.slice(html.lastIndexOf('<div style="', at), at), face, `${name}: its face`);
    assert.match(html.slice(html.lastIndexOf('<td ', at), at), /text-align:center/, `${name}: centred`);
  }
  assert.ok(web.indexOf(SIGN_OFF) > web.indexOf('</form>'), 'web: under the subscribe box');
  assert.ok(!WEEKLY_HEADER_LINE.includes('great week'), 'it left the header line');
  assert.ok(email.text.includes(`\n\n${SIGN_OFF}\n\n`), 'the text part carries it too');
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

// Owner, 2026-09-29, from the footer design canvas: "B · Panel" for members, "C · Colophon" for everybody else,
// and no green rule down the member paragraph.
const cellOf = (html, marker) => html.slice(html.lastIndexOf('<td ', html.indexOf(marker)), html.indexOf(marker));
// The closing block alone: from its table to the sign-off under it.
const closingOf = (html, from) => html.slice(html.lastIndexOf('<table', html.indexOf(from)), html.lastIndexOf('<table', html.indexOf(SIGN_OFF)));

test('a member reads the closing in a warm panel under a "GBTI Digest" label, with no rule down its side', () => {
  for (const [theme, bg, border, label] of [['light', '#f7f5f1', '#e0dbd3', '#187a4b'], ['dark', '#2a2731', '#35313d', '#5fd49a']]) {
    const html = renderIssue(ISSUE, { siteUrl: SITE, audience: 'member', theme }).html;
    assert.ok(html.indexOf('GBTI Digest</div>') < html.indexOf(LEAD) && html.indexOf(LEAD) < html.indexOf(MEMBER), `${theme}: label, lead, paragraph`);
    assert.ok(!html.slice(html.indexOf('GBTI Digest</div>'), html.indexOf(MEMBER)).includes('</td>'), `${theme}: all three in one panel cell`);
    const box = html.slice(html.lastIndexOf('<table', html.indexOf('GBTI Digest</div>')), html.indexOf('GBTI Digest</div>'));
    assert.match(box, new RegExp(`background-color:${bg};border:1px solid ${border};border-radius:8px`), `${theme}: the panel`);
    assert.match(html.slice(html.lastIndexOf('<div style="', html.indexOf('GBTI Digest</div>')), html.indexOf('GBTI Digest</div>')), new RegExp(`text-transform:uppercase;color:${label}`), `${theme}: the label`);
    assert.doesNotMatch(closingOf(html, 'GBTI Digest</div>'), /border-left|font-style:italic;color|#1f9e5f/, `${theme}: no green rule, the paragraph upright`);
  }
});

test('everybody else reads a centred colophon: a short green rule, the first line in a serif', () => {
  const email = renderIssue(ISSUE, { siteUrl: SITE }).html;
  const colophon = closingOf(email, LEAD);
  assert.match(colophon, /<td width="32" height="2" bgcolor="#1f9e5f"/, 'the rule');
  assert.ok(colophon.indexOf('bgcolor="#1f9e5f"') < colophon.indexOf(LEAD), 'the rule sits above the lead');
  assert.match(email.slice(email.lastIndexOf('<div style="', email.indexOf(LEAD)), email.indexOf(LEAD)), /font-family:Georgia,'Times New Roman',serif;font-size:17px/, 'a serif lead');
  assert.match(email.slice(email.lastIndexOf('<td width="536"', email.indexOf(LEAD)), email.indexOf(LEAD)), /align="center" style="width:536px;padding:40px 48px 0;text-align:center"/, 'centred');
  assert.doesNotMatch(colophon, /GBTI Digest<\/div>|border-left/, 'not the member panel');
  // The web edition has no lead in the closing, so the invitation itself takes the serif line.
  const web = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' }).html;
  assert.match(web.slice(web.lastIndexOf('<div style="', web.indexOf(GUEST)), web.indexOf(GUEST)), /font-family:Georgia,'Times New Roman',serif;font-size:17px/);
});

test('on the web edition a non-member reads the lead at the end of the footer line, and only there', () => {
  const web = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web' }).html;
  assert.equal(web.split(LEAD).length - 1, 1, 'once on the page');
  assert.ok(web.includes(`A new issue goes out every Tuesday. ${LEAD}</div>`), 'it ends the footer sentence');
  assert.ok(web.indexOf(LEAD) > web.indexOf('<!--/social-->'), 'in the footer, below the social row');
  // A member's preview keeps it in the panel, and the footer line ends where it did.
  const member = renderIssue(ISSUE, { siteUrl: SITE, edition: 'web', audience: 'member' }).html;
  assert.equal(member.split(LEAD).length - 1, 1);
  assert.ok(member.includes('A new issue goes out every Tuesday.</div>'));
  assert.ok(member.indexOf(LEAD) < member.indexOf('<!--social-->'));
  // The email keeps it in the closing: it has no web footer to move it to.
  const email = renderIssue(ISSUE, { siteUrl: SITE }).html;
  assert.ok(email.indexOf(LEAD) < email.indexOf('<!--social-->'));
});

test('every closing text colour clears the 4.5:1 floor on what it sits on, in both themes', () => {
  const lum = (h) => { const c = h.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  // light: label, lead and paragraph on the panel; dark: the same on the dark panel
  for (const [fg, bg] of [['#187a4b', '#f7f5f1'], ['#232029', '#f7f5f1'], ['#4a4653', '#f7f5f1'], ['#5fd49a', '#2a2731'], ['#f3f2f0', '#2a2731'], ['#bdbac4', '#2a2731']]) {
    assert.ok(ratio(fg, bg) >= 4.5, `${fg} on ${bg}: ${ratio(fg, bg).toFixed(2)}`);
  }
});
