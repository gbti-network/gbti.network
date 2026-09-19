// sow-190: the tracking-parameter normalizer (client/src/url-normalize.mjs). Pure, node-testable. Verifies the
// denylist strips only UNAMBIGUOUS trackers, PRESERVES functional/ambiguous params (a blanket strip would break
// the 9 committed YouTube ?v= shares), that embedUrl still matches every normalized form (no share loses its
// SOW-092 player), and that running the normalizer over every committed share url changes NOTHING (the denylist
// is safe on the real corpus). No network, no secrets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { stripTrackingParams } from '../client/src/url-normalize.mjs';
import { embedUrl } from '../client/src/video-embed.mjs';

test('sow-190: strips the reported YouTube ?si= attribution token', () => {
  assert.equal(stripTrackingParams('https://youtu.be/c5uI80Nevhk?si=DRaS_MVa_-5tu4xA'), 'https://youtu.be/c5uI80Nevhk');
});

test('sow-190: strips utm_* and the common click ids, keeps the rest', () => {
  assert.equal(stripTrackingParams('https://ex.com/a?utm_source=x&utm_medium=y&id=7'), 'https://ex.com/a?id=7');
  assert.equal(stripTrackingParams('https://ex.com/a?fbclid=abc'), 'https://ex.com/a');
  assert.equal(stripTrackingParams('https://ex.com/a?gclid=abc&q=hi'), 'https://ex.com/a?q=hi');
  assert.equal(stripTrackingParams('https://ex.com/a?igshid=z&mc_cid=1&mc_eid=2&ab_channel=Foo'), 'https://ex.com/a');
});

test('sow-190: PRESERVES functional YouTube params (v, t, list, start_radio)', () => {
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=c5uI80Nevhk'), 'https://www.youtube.com/watch?v=c5uI80Nevhk');
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=abcdefghijk&t=42'), 'https://www.youtube.com/watch?v=abcdefghijk&t=42');
  // the one existing playlist share shape survives intact
  assert.equal(stripTrackingParams('https://www.youtube.com/watch?v=abcdefghijk&list=PL123&start_radio=1'), 'https://www.youtube.com/watch?v=abcdefghijk&list=PL123&start_radio=1');
});

test('sow-190: a mix keeps functional and drops only the tracker', () => {
  assert.equal(stripTrackingParams('https://youtu.be/abcdefghijk?si=TOKEN&t=90'), 'https://youtu.be/abcdefghijk?t=90');
});

test('sow-190: leaves ambiguous short params UNTOUCHED (owner aggressiveness call is deferred)', () => {
  // s (X), ref, feature, pp, is, spm, share_id are NOT in the phase-1 denylist.
  assert.equal(stripTrackingParams('https://x.com/u/status/1?s=20'), 'https://x.com/u/status/1?s=20');
  assert.equal(stripTrackingParams('https://ex.com/a?ref=hn&feature=share'), 'https://ex.com/a?ref=hn&feature=share');
  // The owner's pasted string had `?is=` (a typo for YouTube's `si=`). Only `si` is in the denylist, so the
  // literal `is` param is an UNKNOWN token and is correctly left alone by the conservative rule.
  assert.equal(stripTrackingParams('https://youtu.be/c5uI80Nevhk?is=DRaS_MVa_-5tu4xA'), 'https://youtu.be/c5uI80Nevhk?is=DRaS_MVa_-5tu4xA');
});

test('sow-190: fails OPEN on a non-URL / non-http(s) input (never blocks a share)', () => {
  assert.equal(stripTrackingParams('not a url'), 'not a url');
  assert.equal(stripTrackingParams(''), '');
  assert.equal(stripTrackingParams(null), '');
  assert.equal(stripTrackingParams('mailto:x@y.com?utm_source=z'), 'mailto:x@y.com?utm_source=z'); // not http(s)
});

test('sow-190: a clean url is returned byte-for-byte (no gratuitous re-encoding)', () => {
  const clean = 'https://example.com/path/to/thing?keep=1&also=two';
  assert.equal(stripTrackingParams(clean), clean);
});

test('sow-190: embedUrl still matches every normalized YouTube form (no share loses its player)', () => {
  const cases = [
    'https://youtu.be/c5uI80Nevhk?si=DRaS_MVa_-5tu4xA',
    'https://www.youtube.com/watch?v=c5uI80Nevhk&ab_channel=Foo',
    'https://www.youtube.com/watch?v=c5uI80Nevhk&list=PL1&start_radio=1',
  ];
  for (const raw of cases) {
    const before = embedUrl(raw);
    assert.ok(before, `expected embedUrl to match the raw form: ${raw}`);
    assert.equal(embedUrl(stripTrackingParams(raw)), before, `embedUrl must still match after normalize: ${raw}`);
  }
});

test('sow-190: the normalizer changes NONE of the committed share urls (denylist safe on the real corpus)', () => {
  const membersRoot = new URL('../members/', import.meta.url);
  const users = fs.existsSync(membersRoot) ? fs.readdirSync(membersRoot, { withFileTypes: true }) : [];
  let checked = 0;
  for (const u of users) {
    if (!u.isDirectory()) continue;
    const sharesDir = new URL(`../members/${u.name}/shares/`, import.meta.url);
    if (!fs.existsSync(sharesDir)) continue;
    for (const f of fs.readdirSync(sharesDir)) {
      if (!f.endsWith('.md')) continue;
      const text = fs.readFileSync(new URL(`../members/${u.name}/shares/${f}`, import.meta.url), 'utf8');
      const m = text.match(/^---\n([\s\S]*?)\n---/);
      if (!m) continue;
      let fm;
      try { fm = yaml.load(m[1]); } catch { continue; }
      const url = fm && typeof fm.url === 'string' ? fm.url : null;
      if (!url) continue;
      checked++;
      assert.equal(stripTrackingParams(url), url, `phase-1 denylist must not alter a committed share url: ${url}`);
    }
  }
  assert.ok(checked > 0, 'expected to check at least one committed share url');
});

// sow-364: the same denylist over a BODY. An assistant tags every citation it hands back
// (?utm_source=chatgpt.com, and the same shape from gemini, grok, claude and perplexity), so a note pasted out
// of one published with a tracking parameter on every link. The denylist already covered utm_*; nothing ran it
// on text. These pin the three markdown shapes the damage arrives in, what is deliberately left alone, and the
// two builders every host publishes through.
import { stripTrackingParamsInText } from '../client/src/url-normalize.mjs';
import { buildShareFile, buildCommentFile } from '../client/src/content-ops.mjs';
import { planMemberFiles } from '../client/src/operations-publish.mjs';

test('sow-364: the three markdown link shapes are cleaned, and the text around them is untouched', () => {
  // inline, as the Jacob Collier note carried them
  assert.equal(
    stripTrackingParamsInText('1. Cite. ([Asia Pillars](https://asiapillars.com/p/warit/?utm_source=chatgpt.com)) ([PGVIM](https://www.pgvis.com/s/warit?utm_source=chatgpt.com))'),
    '1. Cite. ([Asia Pillars](https://asiapillars.com/p/warit/)) ([PGVIM](https://www.pgvis.com/s/warit))',
  );
  // a reference definition with a quoted title, as the ScienceAlert note carried it
  assert.equal(
    stripTrackingParamsInText('[1]: https://www.sciencealert.com/page/0?utm_source=chatgpt.com "Michelle Starr"'),
    '[1]: https://www.sciencealert.com/page/0 "Michelle Starr"',
  );
  // an autolink and a bare url, where the sentence punctuation must survive
  assert.equal(stripTrackingParamsInText('<https://ex.com/a?utm_source=perplexity.ai>'), '<https://ex.com/a>');
  assert.equal(stripTrackingParamsInText('see https://ex.com/a?utm_source=grok. Next one.'), 'see https://ex.com/a. Next one.');
  // every assistant the owner named, plus a functional param beside a tracking one
  for (const v of ['chatgpt.com', 'gemini', 'grok', 'claude', 'perplexity']) {
    assert.equal(stripTrackingParamsInText(`x https://ex.com/a?utm_source=${v}&id=7 y`), 'x https://ex.com/a?id=7 y');
  }
});

test('sow-364: code is left exactly as written, and a clean body comes back byte for byte', () => {
  const span = 'run `curl https://ex.com/a?utm_source=chatgpt.com` first';
  assert.equal(stripTrackingParamsInText(span), span, 'an inline code span may be documenting the url');
  const fence = '```\nhttps://ex.com/a?utm_source=chatgpt.com\n```\nand after: https://ex.com/b?utm_source=chatgpt.com';
  assert.equal(stripTrackingParamsInText(fence), '```\nhttps://ex.com/a?utm_source=chatgpt.com\n```\nand after: https://ex.com/b');
  const clean = 'A note with [a link](https://youtu.be/abcdefghijk?t=42) and nothing to strip.\n\nSecond line.\n';
  assert.equal(stripTrackingParamsInText(clean), clean);
  assert.equal(stripTrackingParamsInText(''), '');
  assert.equal(stripTrackingParamsInText(null), '');
  assert.equal(stripTrackingParamsInText('no urls at all'), 'no urls at all');
});

test('sow-364: buildShareFile cleans the note as well as the shared link', () => {
  const built = buildShareFile({
    username: 'alice',
    input: { id: '20260918000000-x', visibility: 'public', createdAt: '2026-09-18T00:00:00Z', url: 'https://youtu.be/abcdefghijk?si=TOKEN' },
    body: 'My take, citing ([source](https://ex.com/a?utm_source=chatgpt.com)).',
  });
  assert.equal(built.frontmatter.url, 'https://youtu.be/abcdefghijk', 'the shared link, as before');
  assert.match(built.markdown, /\(\[source\]\(https:\/\/ex\.com\/a\)\)/, 'and now the note');
  assert.equal(/utm_source/.test(built.markdown), false);
});

test('sow-364: buildCommentFile cleans an author note the same way', () => {
  const built = buildCommentFile({
    username: 'alice',
    input: { id: '20260918000000-c', targetType: 'project', targetSlug: 'thing', authorNote: true, createdAt: '2026-09-18T00:00:00Z' },
    body: 'Why I built it, after reading https://ex.com/a?utm_source=claude and https://ex.com/b?utm_source=gemini.',
  });
  assert.match(built.markdown, /reading https:\/\/ex\.com\/a and https:\/\/ex\.com\/b\./);
  assert.equal(/utm_source/.test(built.markdown), false);
});

test('sow-364: a members share is cleaned before it is ENCRYPTED, not only in the stub', async () => {
  const built = buildShareFile({
    username: 'alice',
    input: { id: '20260918000001-m', visibility: 'members', createdAt: '2026-09-18T00:00:01Z', url: 'https://ex.com/x' },
    body: 'Members only, citing https://ex.com/a?utm_source=chatgpt.com.',
  });
  let plaintext = null;
  const plan = await planMemberFiles({
    built,
    body: 'Members only, citing https://ex.com/a?utm_source=chatgpt.com.',
    encrypt: async (text) => { plaintext = text; return { v: 1, ct: 'x' }; },
  });
  assert.ok(plan, 'a members share encrypts its note');
  assert.equal(plaintext, 'Members only, citing https://ex.com/a.', 'the ciphertext carries the cleaned note');
  for (const f of plan.files) if (typeof f.content === 'string') assert.equal(/utm_source/.test(f.content), false);
});

test('sow-364: no committed share or comment body carries a tracking parameter', () => {
  const roots = ['members', 'house'];
  const bodies = [];
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = `${dir}/${e.name}`;
      if (e.isDirectory()) { if (e.name === 'shares' || e.name === 'comments' || dir.endsWith('/members') || p.endsWith('/house')) walk(p); continue; }
      if (!e.name.endsWith('.md')) continue;
      if (!/\/(shares|comments)\/[^/]+\.md$/.test(p)) continue;
      bodies.push([p, fs.readFileSync(p, 'utf8').replace(/^---\n[\s\S]*?\n---\n?/, '')]);
    }
  };
  for (const r of roots) walk(new URL(`../${r}`, import.meta.url).pathname);
  for (const [p, body] of bodies) {
    assert.equal(stripTrackingParamsInText(body), body, `${p}: a link in this body still carries a tracking parameter`);
  }
  assert.ok(bodies.length > 50, `expected the sweep to read the real corpus (read ${bodies.length})`);
});
