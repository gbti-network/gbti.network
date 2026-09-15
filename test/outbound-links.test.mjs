// sow-289 Phase 3: the outbound partner link store (house/outbound-links.yml), its validator, and the redirect
// generator's reading of it. The generator emits the store's rows in the position the inline rows held, so the
// committed public/_redirects did not change in the migration; the last test here pins that position.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { validateOutboundLinks, redirectRowsOf, linkSummary, linksOf, LINK_STATUSES } from '../membership/outbound-link-edits.mjs';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const store = () => yaml.load(fs.readFileSync(path.join(ROOT, 'house/outbound-links.yml'), 'utf8'));
const good = (over = {}) => ({ path: '/outbound/x', destination: 'https://example.com/?ref=1', partner: 'example', status: 'live', note: 'why', ...over });

test('the committed store is valid, holds the ten paths, and only five sit under /outbound/', () => {
  const parsed = store();
  assert.deepEqual(validateOutboundLinks(parsed), []);
  const paths = linksOf(parsed).map((e) => e.path);
  assert.equal(paths.length, 10);
  assert.equal(paths.filter((p) => p.startsWith('/outbound/')).length, 5, 'a prefix filter would miss half the store');
  assert.equal(new Set(paths).size, 10);
  assert.equal(linksOf(parsed).find((e) => e.path === '/outbound/tailscale').status, 'placeholder');
  for (const e of linksOf(parsed)) assert.ok(e.note && e.note.length > 20, `${e.path} carries its provenance note`);
});

test('validator: a pathless destination is refused (the Cloudways trailing-slash lesson), even though new URL() would accept it', () => {
  const bad = 'https://cloudways.com?id=644779&chan=gbti';
  assert.equal(new URL(bad).pathname, '/', 'the URL parser normalises the shape, which is why the check reads the raw string');
  const problems = validateOutboundLinks({ links: [good({ destination: bad })] });
  assert.equal(problems.length, 1);
  assert.match(problems[0], /explicit path before any query/);
  assert.deepEqual(validateOutboundLinks({ links: [good({ destination: 'https://cloudways.com/?id=644779&chan=gbti' })] }), []);
});

test('validator: duplicate paths, a relative or query-bearing path, a bad status, a bad partner, a non-text note', () => {
  const problems = validateOutboundLinks({ links: [
    good(), good(),
    good({ path: 'outbound/y' }), good({ path: '/outbound/z?x=1' }),
    good({ path: '/a', status: 'dead' }), good({ path: '/b', partner: 'Not A Label' }), good({ path: '/c', note: 5 }),
    good({ path: '/d', destination: 'ftp://x/y' }), good({ path: '/e', destination: '/relative/' }),
  ] });
  assert.equal(problems.filter((p) => /repeats the path/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /invalid path/.test(p)).length, 2);
  assert.equal(problems.filter((p) => /invalid status/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /invalid partner/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /note that is not text/.test(p)).length, 1);
  assert.equal(problems.filter((p) => /invalid destination/.test(p)).length, 2);
  assert.deepEqual(validateOutboundLinks(null), ['outbound-links: the file did not parse to an object']);
  assert.deepEqual(validateOutboundLinks({}), ['outbound-links: `links` must be a list']);
  assert.deepEqual([...LINK_STATUSES], ['live', 'placeholder', 'retired']);
});

test('redirectRowsOf keeps file order; linkSummary defaults an unknown status to live and trims the note', () => {
  const rows = redirectRowsOf({ links: [good({ path: '/b' }), good({ path: '/a' })] });
  assert.deepEqual(rows, [['/b', 'https://example.com/?ref=1'], ['/a', 'https://example.com/?ref=1']]);
  assert.deepEqual(linkSummary({ path: '/x', destination: 'https://e.com/', partner: 'e', status: 'nope', note: '  n  ' }), { path: '/x', destination: 'https://e.com/', partner: 'e', status: 'live', note: 'n' });
});

test('the store reader the generator uses refuses an invalid store, and the rows sit between the utility rows and the moved share', async () => {
  // scripts/gen-redirects.mjs is a top-level script (it writes public/_redirects and reads the local-only legacy
  // map), so the reader it imports is tested here, not the script.
  const { outboundRows } = await import('../scripts/lib/outbound-links-store.mjs');
  const rows = outboundRows(ROOT);
  assert.equal(rows.length, 10);
  assert.deepEqual(rows[0], ['/outbound/codeable', 'https://codeable.io/?ref=MzT91']);
  assert.deepEqual(rows[9], ['/outbound/tailscale', 'https://tailscale.com/']);
  // Position: the committed public/_redirects carries the store rows contiguously, right after the two utility
  // rows and right before the moved-share row, exactly where the inline rows stood before the migration.
  const lines = fs.readFileSync(path.join(ROOT, 'public/_redirects'), 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).map((l) => l.split(/\s+/)[0]);
  const first = lines.indexOf(rows[0][0]);
  assert.ok(first > 0, 'the first store row is in the committed file');
  assert.deepEqual(lines.slice(first, first + 10), rows.map((r) => r[0]), 'the ten rows are contiguous and in file order');
  assert.equal(lines[first - 1], '/products/email-signature-generator/', 'the row before is the last utility row');
  assert.ok(lines[first + 10].startsWith('/shares/atwellpub/'), 'the row after is the moved share');
  // An invalid store refuses generation rather than writing a broken 301.
  const tmp = fs.mkdtempSync(path.join(ROOT, 'node_modules', '.gbti-outbound-'));
  try {
    fs.mkdirSync(path.join(tmp, 'house'));
    fs.writeFileSync(path.join(tmp, 'house/outbound-links.yml'), 'links:\n  - path: /x\n    destination: https://x.com?q=1\n    partner: x\n    status: live\n');
    assert.throws(() => outboundRows(tmp), /explicit path before any query/);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
