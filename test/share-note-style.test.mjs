// The note a member writes under a share. Owner, 2026-09-22: it is set in ITALIC serif (it was turned upright
// earlier the same day and the owner asked for the italics back), and when the NETWORK wrote it there are no
// quotation marks around it, because the house voice is editorial rather than somebody being quoted.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isNetworkAuthor } from '../src/lib/network-authors.mjs';

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const CSS = read('src/styles/gbti-v3.css');
const rules = (selector) => CSS.split('\n').filter((l) => l.startsWith(selector));

test('the network accounts are recognised, a member is not', () => {
  for (const a of ['gbtilabs', 'GBTILABS', ' gbti ']) assert.equal(isNetworkAuthor(a), true, a);
  for (const a of ['atwellpub', 'gbtilab', '', null, undefined]) assert.equal(isNetworkAuthor(a), false, String(a));
});

test('a share note is set in italic serif', () => {
  const base = rules('.share-member-note .cmt-rich {');
  assert.equal(base.length, 1, 'the note rule must be found, or this checks nothing');
  assert.match(base[0], /font-style:\s*italic/);
  assert.match(base[0], /font-family:\s*Georgia/);
});

test('the house note carries no quotation marks, and a member note still does', () => {
  const memberQuotes = rules('.share-member-note .cmt-rich p:first-child::before').concat(rules('.share-member-note .cmt-rich p:last-child::after'));
  assert.equal(memberQuotes.length, 2, 'a member note is still quoted');
  for (const r of memberQuotes) assert.match(r, /content:\s*'"'/);
  // The house rule must come AFTER the member rule: same specificity class count, so source order decides.
  const houseRule = CSS.indexOf('.share-member-note--house .cmt-rich p:first-child::before');
  assert.ok(houseRule > -1, 'the house rule exists');
  assert.ok(houseRule > CSS.indexOf('.share-member-note .cmt-rich p:first-child::before'), 'and wins on source order');
  assert.match(CSS.slice(houseRule, houseRule + 220), /content:\s*none/);
});

test('the share page marks the network\'s own note as the house voice', () => {
  const page = read('src/pages/shares/[author]/[id].astro');
  assert.match(page, /import \{[^}]*isNetworkAuthor[^}]*\} from '\.\.\/\.\.\/\.\.\/lib\/authors';/);
  assert.match(page, /class:list=\{\['card', 'share-member-note', isNetworkAuthor\(d\.author\) && 'share-member-note--house'\]\}/);
});
