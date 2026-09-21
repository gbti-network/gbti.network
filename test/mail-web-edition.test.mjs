// sow-383: the approved digest design. The category pill beside each byline, "View this issue on the web" in the
// email masthead, the "Follow the GBTI Network" row above the footer, and the web edition the Worker serves at
// /digest/<issueId>. The web edition is the SAME render as the email (ctx.edition 'web'), so these tests pin what
// differs between the two and that the items do not.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as si from 'simple-icons';
import { digestCategory, normalizeContent } from '../membership/mail-compile-core.mjs';
import { composeIssue } from '../membership/mail-digest.mjs';
import { renderIssue } from '../membership/mail-render.mjs';
import { resolveDigestConfig } from '../membership/digest-config.mjs';
import { resolveClick, parseClickPath } from '../membership/mail-click.mjs';
import { DIGEST_SOCIAL } from '../membership/mail-social.mjs';
import { webEditionUrl, TURNSTILE_SITE_KEY } from '../membership/mail-render-parts.mjs';
import { statsKey } from '../membership/mail-stats.mjs';
import { handleDigestWeb } from '../workers/signup/mail-web-route.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SITE = 'https://gbti.network';
const WORKER = 'https://signup.gbti.network';

function fixtureIssue(issueId = 'weekly-2026-09-21') {
  const items = normalizeContent([
    { type: 'prompt', title: 'Farley', url: '/prompts/farley/', author: 'atwellpub', publishedAt: 3, visibility: 'public', categoryLabels: ['AI', 'Prompts', 'Skill'] },
    { type: 'share', title: 'Making Days Longer', url: '/shares/gbtilabs/x/', author: 'gbtilabs', publishedAt: 2, visibility: 'public', categoryLabels: ['Music'] },
    { type: 'share', title: 'No topic here', url: '/shares/gbtilabs/y/', author: 'gbtilabs', publishedAt: 1, visibility: 'public', categoryLabels: [] },
  ]);
  return composeIssue({ issueId, items, news: [], now: () => Date.parse('2026-09-21T12:00:00Z') }, {});
}
const PITCH_OFF = resolveDigestConfig({ mirror: { cta: { enabled: false } } });
const emailOf = (issue = fixtureIssue(), extra = {}) => renderIssue(issue, {
  siteUrl: SITE, clickBase: WORKER, webBase: WORKER, digestConfig: PITCH_OFF, unsubscribeUrl: `${WORKER}/mail/unsubscribe?t=x`, ...extra,
});
const webOf = (issue = fixtureIssue()) => renderIssue(issue, {
  edition: 'web', siteUrl: SITE, digestConfig: PITCH_OFF, canonicalUrl: webEditionUrl(WORKER, issue.issueId),
});
const pills = (html) => [...html.matchAll(/border-radius:3px;padding:1px 6px;white-space:nowrap">([^<]*)<\/span>/g)].map((m) => m[1]);

// ---------- the category ----------

test('the category label is the top level and the leaf, one label as itself, none as null', () => {
  assert.equal(digestCategory(['AI', 'Prompts', 'Skill']), 'AI › Skill');
  assert.equal(digestCategory(['Education']), 'Education');
  assert.equal(digestCategory(['DevOps', 'DevOps']), 'DevOps', 'a leaf that repeats the top is not doubled');
  assert.equal(digestCategory([]), null);
  assert.equal(digestCategory(undefined), null);
  assert.equal(digestCategory(['x'.repeat(90)]).length, 40, 'a runaway label is capped');
});

test('each item with a category shows it as the pill beside the byline, uppercased; an item without one shows none', () => {
  const { html, text } = emailOf();
  assert.deepEqual(pills(html), ['AI › SKILL', 'MUSIC'], 'one pill per categorised item, none for the item with no topic');
  const row = html.slice(html.indexOf('by atwellpub'), html.indexOf('by atwellpub') + 400);
  assert.ok(row.includes('AI › SKILL'), 'the pill sits in the byline row');
  assert.match(text, /- Farley \(by atwellpub · AI › Skill\)/, 'the text alternative carries the category too');
  assert.match(text, /- No topic here \(by gbtilabs\)/);
});

// ---------- the web link ----------

test('the email masthead links to the web edition, for a public weekly issue only', () => {
  const url = `${WORKER}/digest/weekly-2026-09-21`;
  const { html, text } = emailOf();
  assert.ok(html.includes(`href="${url}"`) && html.includes('View this issue on the web'));
  assert.match(text, new RegExp(`View this issue on the web: ${url.replace(/[.]/g, '\\.')}`));
  for (const id of ['members-2026-09-21', 'welcome-2026-09-21', 'test-2026-09-21']) {
    assert.ok(!emailOf(fixtureIssue(id)).html.includes('View this issue on the web'), `${id} has no web edition to link to`);
  }
  assert.ok(!emailOf(fixtureIssue(), { webBase: '' }).html.includes('View this issue on the web'), 'no base, no link');
});

// ---------- the social row ----------

test('the email carries the social row: every account as a black PNG with its name as alt text', () => {
  const { html, text } = emailOf();
  const block = html.slice(html.indexOf('<!--social-->'), html.indexOf('<!--/social-->'));
  assert.ok(block.includes('Follow the GBTI Network'));
  for (const s of DIGEST_SOCIAL) {
    assert.ok(block.includes(`src="${SITE}/brand/social/${s.key}.png"`), `${s.key} icon`);
    assert.ok(block.includes(`alt="${s.label}"`), `${s.key} alt text`);
    assert.ok(text.includes(`${s.label}: `), `${s.key} in the text alternative`);
  }
  assert.ok(html.indexOf('<!--/social-->') < html.indexOf('You get this digest every week'), 'the row sits above the footer');
  assert.ok(!block.includes('<svg'), 'no inline SVG in the email: Gmail strips it');
  const dark = emailOf(fixtureIssue(), { theme: 'dark' }).html;
  assert.ok(dark.includes(`${SITE}/brand/social/x-white.png`), 'the dark card gets white icons');
});

test('every social click goes through the counter and RESOLVES back to that account', () => {
  const issue = fixtureIssue();
  const block = emailOf(issue).html.split('<!--social-->')[1].split('<!--/social-->')[0];
  const hrefs = [...block.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(hrefs.length, DIGEST_SOCIAL.length);
  hrefs.forEach((href, i) => {
    const parsed = parseClickPath(new URL(href).pathname);
    assert.ok(parsed, `a counter link: ${href}`);
    // The route rebuilds candidates from the frozen issue; an unregistered target would bounce to the homepage.
    assert.equal(resolveClick(issue, SITE, parsed.slot), DIGEST_SOCIAL[i].href);
  });
});

test('every icon the email names exists, in both colours', () => {
  for (const s of DIGEST_SOCIAL) {
    for (const f of [`${s.key}.png`, `${s.key}-white.png`]) assert.ok(fs.existsSync(new URL(`../public/brand/social/${f}`, import.meta.url)), f);
  }
});

test('the accounts and icons are the site footer\'s own, so the two cannot drift', () => {
  const social = read('src/lib/social.ts');
  const linkedin = /const LINKEDIN_PATH =\s*'([^']+)'/.exec(social)[1];
  const SI = { x: 'siX', bluesky: 'siBluesky', youtube: 'siYoutube', github: 'siGithub', reddit: 'siReddit', devto: 'siDevdotto', dailydev: 'siDailydotdev' };
  for (const s of DIGEST_SOCIAL) {
    assert.ok(social.includes(`href: '${s.href}'`), `${s.key}: the site footer links ${s.href}`);
    const expected = s.key === 'linkedin' ? linkedin : si[SI[s.key]]?.path;
    assert.ok(expected, `${s.key} has a known icon source`);
    assert.equal(s.path, expected, `${s.key}: the icon path matches the site's`);
  }
  assert.ok(!DIGEST_SOCIAL.some((s) => /membership/.test(s.href)), 'no social link doubles as a membership link');
});

// ---------- the web edition ----------

test('the web edition renders the same items as the email', () => {
  const titles = (html) => [...html.matchAll(/font-weight:700;color:#232029;text-decoration:none;[^"]*">([^<]+)<\/a>/g)].map((m) => m[1]);
  assert.deepEqual(titles(webOf().html), titles(emailOf().html));
  assert.ok(titles(webOf().html).length >= 3);
  assert.deepEqual(pills(webOf().html), pills(emailOf().html));
});

test('the web edition adds a subscribe box and a page head, and drops everything that belongs to a mailing', () => {
  const { html } = webOf();
  assert.match(html, /<form action="\/mail\/subscribe" method="post"/);
  assert.match(html, /<input id="dg-email" name="email" type="email" required/);
  assert.ok(html.includes(`data-sitekey="${TURNSTILE_SITE_KEY}"`));
  assert.ok(html.indexOf('<form') > html.indexOf('Everything new across the network') && html.indexOf('<form') < html.indexOf('Latest '),
    'the box sits right under the intro, above the first section');
  assert.ok(html.includes(`<link rel="canonical" href="${WORKER}/digest/weekly-2026-09-21">`));
  assert.match(html, /<meta property="og:title" content="GBTI Digest/);
  assert.ok(html.includes('This is the web edition of the GBTI Network weekly digest.'));
  assert.equal((html.match(/<svg /g) || []).length, DIGEST_SOCIAL.length, 'the web edition draws the SVG icons');
  for (const [absent, why] of [
    [`${WORKER}/c/`, 'no click counter: a web visitor is not an email reader'],
    [`${WORKER}/o/`, 'no open pixel'],
    ['Unsubscribe</a>', 'no unsubscribe: nothing was mailed'],
    ['You get this digest every week', 'not the mailing footer'],
    ['View this issue on the web', 'no link to itself'],
  ]) assert.ok(!html.includes(absent), why);
  assert.ok(html.includes(`href="${SITE}/prompts/farley/?utm_source=digest`), 'items still link to the site');
  const handed = renderIssue(fixtureIssue(), { edition: 'web', siteUrl: SITE, clickBase: WORKER, digestConfig: PITCH_OFF }).html;
  assert.ok(!handed.includes(`${WORKER}/c/`) && !handed.includes(`${WORKER}/o/`), 'even a caller that passes a click base gets no counter');
});

test('the Turnstile key is the site\'s public key', () => {
  assert.ok(read('src/lib/membership.ts').includes(`TURNSTILE_SITE_KEY = '${TURNSTILE_SITE_KEY}'`));
});

// ---------- the route ----------

function kvWith(entries = {}) {
  const m = new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
  return {
    async get(k, t) { const v = m.get(k); if (v == null) return null; return t === 'json' ? JSON.parse(v) : v; },
    async list({ prefix = '' } = {}) { return { keys: [...m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }; },
  };
}
const ENV = { PUBLIC_BASE_URL: WORKER, SITE_URL: SITE };
const get = (path, kv, method = 'GET') => handleDigestWeb(new Request(`${WORKER}${path}`, { method }), ENV, { kv });
const ID = 'weekly-2026-09-21';

test('the route serves a sent public weekly issue, from the snapshot or from one delivered record', async () => {
  const issue = fixtureIssue();
  const finished = kvWith({ [`mail:issue:${ID}`]: issue, [statsKey(ID)]: { sent: 12 } });
  const res = await get(`/digest/${ID}`, finished);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  const html = await res.text();
  assert.ok(html.includes('Get the weekly digest') && html.includes('Farley'));
  const sending = kvWith({ [`mail:issue:${ID}`]: issue, [`mail:send:${ID}:h1`]: { status: 'pending' }, [`mail:send:${ID}:h2`]: { status: 'sent' } });
  assert.equal((await get(`/digest/${ID}/`, sending)).status, 200, 'still going out, one reader has it');
  const head = await get(`/digest/${ID}`, finished, 'HEAD');
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('the route publishes nothing that was not sent, and no edition that is not the public weekly', async () => {
  const issue = fixtureIssue();
  const composedOnly = kvWith({ [`mail:issue:${ID}`]: issue, [`mail:send:${ID}:h1`]: { status: 'pending' } });
  assert.equal((await get(`/digest/${ID}`, composedOnly)).status, 404, 'composed but delivered to nobody');
  assert.equal((await get('/digest/weekly-2026-09-14', composedOnly)).status, 404, 'no such issue');
  const members = kvWith({ 'mail:issue:members-2026-09-21': fixtureIssue('members-2026-09-21'), [statsKey('members-2026-09-21')]: { sent: 3 } });
  assert.equal((await get('/digest/members-2026-09-21', members)).status, 404, 'the members edition is never public');
  for (const bad of ['/digest/', '/digest/..%2Fmail:issue', '/digest/weekly-2026-9-1', '/digest/%E0%A4%A']) {
    assert.equal((await get(bad, composedOnly)).status, 404, bad);
  }
  assert.equal((await get(`/digest/${ID}`, composedOnly, 'POST')).status, 405);
});
