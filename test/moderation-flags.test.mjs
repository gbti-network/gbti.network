// SOW-087: the moderation word-list gate. Pure parsing + whole-word/phrase matching; the real
// house/moderation-flags.yml parses and yields the two seed lists. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import yaml from 'js-yaml';
import { moderationFlagsFromParsed, flagText } from '../membership/moderation-flags.mjs';

const DOC = { lists: { political: ['election', 'white house'], profanity: ['shit', 'fuck'] } };

test('moderationFlagsFromParsed cleans lists: drops empties, dedupes, accepts a bare map', () => {
  const m = moderationFlagsFromParsed({ lists: { a: ['x', ' x ', '', null, 'y'], bad: 'not-a-list', '': ['z'] } });
  assert.deepEqual(m, { a: ['x', 'y'] });
  assert.deepEqual(moderationFlagsFromParsed({ a: ['x'] }), { a: ['x'] }); // bare map
  assert.deepEqual(moderationFlagsFromParsed(null), {});
  assert.deepEqual(moderationFlagsFromParsed([]), {});
});

test('flagText: whole-word, case-insensitive, phrase-capable; sorted list names', () => {
  assert.deepEqual(flagText(DOC, 'The ELECTION was...'), ['political']);
  assert.deepEqual(flagText(DOC, 'holy shit, an election'), ['political', 'profanity']);
  assert.deepEqual(flagText(DOC, 'visiting the White  House today'), ['political']); // phrase, flexible spacing
  assert.deepEqual(flagText(DOC, 'electioneering is not a hit'), []); // whole word only
  assert.deepEqual(flagText(DOC, 'shitake mushrooms'), []); // no partial-word hit
  assert.deepEqual(flagText(DOC, ''), []);
  assert.deepEqual(flagText(null, 'election'), []);
});

test('a term is never a regex: metacharacters are escaped', () => {
  const doc = { lists: { odd: ['a+b', 'c(d)'] } };
  assert.deepEqual(flagText(doc, 'we saw a+b here'), ['odd']);
  assert.deepEqual(flagText(doc, 'aab does not match'), []);
});

test('the real house/moderation-flags.yml parses with political + profanity lists', () => {
  const parsed = yaml.load(fs.readFileSync(new URL('../house/moderation-flags.yml', import.meta.url), 'utf8'));
  const m = moderationFlagsFromParsed(parsed);
  assert.ok(m.political.length >= 10);
  assert.ok(m.profanity.length >= 10);
  assert.deepEqual(flagText(parsed, 'My take on the election'), ['political']);
});
