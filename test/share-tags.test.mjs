// sow-303: AI-suggested share tags, the five-hashtag cap, and the #gbti brand tag.
//
// WHY THIS FILE MATTERS. Before it, no test fed a tag through the composer's normalizer or asserted what a
// share's hashtag tail looks like. The one-hashtag defect was invisible to the suite: every syndication test
// passed while 49 of 57 shares emitted a single hashtag.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSuggestedTags, buildTagMessages, suggestTags } from '../workers/signup/topic-suggest.mjs';
import { normalizeTagInput, optimisticShareItem } from '../client-ui/src/share-post-core.mjs';
import { normalizeTag } from '../client/src/schemas.mjs';
import { renderTemplate, HASHTAG_BRAND, HASHTAG_MAX } from '../membership/syndication-format.mjs';

const share = (over = {}) => ({ source: 'share', title: 'T', url: 'https://gbti.network/shares/a/b/', ...over });

// ---------- the normalizers ----------

test('the two normalizers AGREE with the canonical normalizeTag, rather than each inventing a dialect', () => {
  // THE CONTROL THAT MAKES THE REST MEAN ANYTHING. Three separate places now shape a tag: the worker
  // suggester, the composer input, and tagsSchema in client/src/schemas.mjs. The schema's version is
  // canonical, so both of mine must land on the same string for anything it can already handle. Where they
  // deliberately differ (dropping characters the shape forbids, which normalizeTag leaves alone) is asserted
  // separately below, so the difference is recorded rather than hidden.
  for (const raw of ['WireGuard', 'Supply Chain', 'supply_chain', '  Spaced  Out  ', 'Claude-Code', 'node.js', '3D Printing']) {
    const canonical = normalizeTag(raw);
    assert.equal(normalizeTagInput(raw)[0], canonical, `composer disagreed on ${raw}`);
    assert.equal(normalizeSuggestedTags([raw])[0], canonical, `suggester disagreed on ${raw}`);
  }
});

test('a tag the canonical normalizer would leave BROKEN is dropped, not passed on', () => {
  // This is the hazard the whole design turns on. buildShareFile parses against the share schema but
  // serializes the pre-parse object, so tagsSchema's normalization is discarded while its rejection still
  // fires: a non-house-shaped tag does not get repaired, it THROWS and the share fails to publish.
  // normalizeTag alone is not enough, and this proves it rather than asserting it in a comment.
  assert.equal(normalizeTag('C++'), 'c++', 'the canonical normalizer leaves it broken');
  assert.ok(!/^[a-z0-9][a-z0-9.-]*$/.test('c++'), 'and that value would be rejected downstream');
  assert.deepEqual(normalizeTagInput('C++'), [], 'so the composer drops it');
  assert.deepEqual(normalizeSuggestedTags(['C++']), [], 'and so does the suggester');
});

test('PROPERTY: whatever either normalizer emits is publishable, for any input at all', () => {
  // The shape guard inside both normalizers is REDUNDANT: the character strips above it already guarantee
  // the result, and a mutation deleting the guard kills no test, which was measured rather than assumed. So
  // the contract is pinned here as a property over the output instead of as a test of that one line. If a
  // future edit to the strip chain stops being sufficient, this reds even though the guard would not.
  const SHAPE = /^[a-z0-9][a-z0-9.-]*$/;
  const nasty = [
    'C++, C#, .NET, ---, ...', '<script>alert(1)</script>', 'a b\tc\nd', '#####', '   ', '__x__',
    'Ünïcödé, emoji \u{1F600}, 中文', '-leading, trailing-', '..dots.., 1.2.3', 'MiXeD CaSe TAG',
    'a'.repeat(100), '9lives, 3d-printing, 0_queue',
  ];
  for (const input of nasty) {
    for (const [who, out] of [['suggester', normalizeSuggestedTags(input)], ['composer', normalizeTagInput(input)]]) {
      assert.ok(Array.isArray(out), `${who} returned a non-array for ${JSON.stringify(input)}`);
      for (const t of out) {
        assert.match(t, SHAPE, `${who} emitted an unpublishable tag ${JSON.stringify(t)} from ${JSON.stringify(input)}`);
        assert.equal(t, normalizeTag(t), `${who} emitted a tag the canonical normalizer would still change`);
      }
    }
  }
  // The positive control: this whole property passes vacuously against a normalizer that returns nothing.
  assert.deepEqual(normalizeSuggestedTags('9lives, 3d-printing'), ['9lives', '3d-printing'], 'and real tags still get through');
});

test('normalizeSuggestedTags parses a real model reply, including the shapes a model actually returns', () => {
  assert.deepEqual(normalizeSuggestedTags('wireguard, tailscale, nat-traversal'), ['wireguard', 'tailscale', 'nat-traversal']);
  assert.deepEqual(normalizeSuggestedTags('- wireguard\n- tailscale'), ['wireguard', 'tailscale'], 'bullets');
  assert.deepEqual(normalizeSuggestedTags('1. wireguard\n2. tailscale'), ['wireguard', 'tailscale'], 'numbering');
  assert.deepEqual(normalizeSuggestedTags('#WireGuard, #Tailscale'), ['wireguard', 'tailscale'], 'hashes');
  assert.deepEqual(normalizeSuggestedTags('"wireguard", "tailscale"'), ['wireguard', 'tailscale'], 'quotes');
  // A LEADING DIGIT MUST SURVIVE. The bullet stripper is anchored to a marker FOLLOWED BY A SPACE precisely
  // so it cannot eat the 3 in 3d-printing, which is a real entry in house/topics.yml.
  assert.deepEqual(normalizeSuggestedTags('3d-printing, makers'), ['3d-printing', 'makers']);
  assert.deepEqual(normalizeSuggestedTags('- 3d-printing'), ['3d-printing'], 'and a real bullet still goes');
});

test('normalizeSuggestedTags dedupes, caps, and drops the unusable', () => {
  assert.deepEqual(normalizeSuggestedTags('ai, AI, Ai'), ['ai'], 'deduped after normalizing');
  assert.equal(normalizeSuggestedTags('aa, bb, cc, dd, ee, ff', { max: 4 }).length, 4, 'capped');
  assert.deepEqual(normalizeSuggestedTags(''), []);
  assert.deepEqual(normalizeSuggestedTags(null), []);
  assert.deepEqual(normalizeSuggestedTags('x'), [], 'a one-character tag is noise');
  assert.deepEqual(normalizeSuggestedTags(['a'.repeat(40)]), [], 'and an absurdly long one is too');
  // A model that ignores the instruction and writes a sentence must not produce a sentence-shaped tag.
  assert.deepEqual(normalizeSuggestedTags('Sure! Here are the tags you asked for:'), [], 'no tag is better than a bad one');
});

test('buildTagMessages asks for the specific term, which is the whole point of free-form tags', () => {
  const [system, user] = buildTagMessages({ title: 'Tailcat', description: 'WireGuard CLI', tags: ['networking'] });
  assert.equal(system.role, 'system');
  assert.match(system.content, /comma-separated/i);
  assert.match(system.content, /specific/i, 'generic tags are what the topic vocabulary already gives us');
  assert.match(user.content, /Tailcat/);
  assert.match(user.content, /networking/, 'the declared tags are passed as a hint');
});

// ---------- suggestTags: the IO wrapper ----------

const kvWith = (classify) => ({ get: async () => ({ syndication: { classify } }) });

test('suggestTags returns the model reply when the AI answers', async () => {
  const env = { AI: { run: async () => ({ response: 'wireguard, tailscale, derp' }) } };
  const got = await suggestTags(env, { title: 'T', description: 'D', tags: [], kv: kvWith('ai') });
  assert.deepEqual(got, ['wireguard', 'tailscale', 'derp']);
});

test('suggestTags FAILS SOFT to the page declared tags, and never throws', async () => {
  const kv = kvWith('ai');
  const thrower = { AI: { run: async () => { throw new Error('neuron budget'); } } };
  assert.deepEqual(await suggestTags(thrower, { tags: ['Supply Chain'], kv }), ['supply-chain'], 'an AI error');
  const garbage = { AI: { run: async () => ({ response: '!!!' }) } };
  assert.deepEqual(await suggestTags(garbage, { tags: ['Supply Chain'], kv }), ['supply-chain'], 'an unusable reply');
  assert.deepEqual(await suggestTags({}, { tags: ['Supply Chain'], kv }), ['supply-chain'], 'no AI binding at all');
  assert.deepEqual(await suggestTags({}, { tags: [], kv }), [], 'and nothing to fall back to is simply nothing');
});

test('classify: off means OFF, including the free declared-tag fallback', () => {
  // One switch has to silence every suggestion, or "off" is a half-truth the next reader has to discover.
  return suggestTags({ AI: { run: async () => ({ response: 'a, b' }) } }, { tags: ['Supply Chain'], kv: kvWith('off') })
    .then((got) => assert.deepEqual(got, []));
});

test('suggestTags survives an unreadable config and a missing kv', async () => {
  const env = { AI: { run: async () => ({ response: 'a, b' }) } };
  const broken = { get: async () => { throw new Error('kv down'); } };
  assert.deepEqual(await suggestTags(env, { tags: ['Supply Chain'], kv: broken }), ['supply-chain']);
  assert.deepEqual(await suggestTags(env, { tags: ['Supply Chain'], kv: null }), ['supply-chain']);
});

// ---------- the hashtag tail ----------

test('a SHARE carries up to five hashtags and #gbti is always the last of them', () => {
  const out = renderTemplate('{hashtags}', share({ category: 'open-source', tags: ['wireguard', 'tailscale', 'networking', 'nat-traversal', 'derp'] }), { limit: 300 });
  const tags = out.split(' ');
  assert.equal(tags.length, HASHTAG_MAX, 'five, counting the brand');
  assert.equal(tags.at(-1), '#gbti', 'and the brand is last');
  assert.deepEqual(tags, ['#OpenSource', '#wireguard', '#tailscale', '#networking', '#gbti']);
});

test('the brand slot is RESERVED, so the tags that overflow are dropped and #gbti is not', () => {
  // Appending the brand and then slicing to the cap would drop it on exactly the items with the most tags,
  // which is the opposite of "always". This is the mutation that catches that implementation.
  const many = renderTemplate('{hashtags}', share({ category: 'ai', tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6', 'g7'] }), { limit: 300 });
  assert.ok(many.endsWith('#gbti'), 'even with seven tags competing for the slots');
  assert.equal(many.split(' ').length, HASHTAG_MAX);
});

test('an item already tagged gbti does not emit it twice', () => {
  const out = renderTemplate('{hashtags}', share({ category: 'ai', tags: ['gbti', 'wireguard'] }), { limit: 300 });
  assert.equal(out.split(' ').filter((h) => h === `#${HASHTAG_BRAND}`).length, 1);
  assert.ok(out.endsWith('#gbti'), 'and it still lands in the brand position, not wherever it was tagged');
});

test('a share with NO tags still carries its category and the brand', () => {
  assert.equal(renderTemplate('{hashtags}', share({ category: 'open-source', tags: [] }), { limit: 300 }), '#OpenSource #gbti');
  assert.equal(renderTemplate('{hashtags}', share({ tags: [] }), { limit: 300 }), '#gbti', 'and with neither, just the brand');
});

test('the brand is SHARES ONLY, which is the owner scope and not a technical limit', () => {
  // LinkedIn's post, product and prompt templates use the same merged token, so an unscoped brand would put
  // #gbti on article syndication that was never asked about. Two existing prompt tests caught this.
  for (const source of ['post', 'product', 'prompt']) {
    const out = renderTemplate('{hashtags}', { source, category: 'ai', tags: ['prompts'] }, { limit: 300 });
    assert.equal(out, '#ai #prompts', `${source} must not be branded`);
  }
});

test('the split tokens are UNCHANGED: no cap, no brand, so a template writing both cannot double it', () => {
  const item = share({ category: 'open-source', tags: ['a1', 'b2', 'c3', 'd4', 'e5', 'f6'] });
  assert.equal(renderTemplate('{category-hashtag}', item, { limit: 300 }), '#OpenSource');
  const split = renderTemplate('{tags-hashtags}', item, { limit: 300 });
  assert.equal(split.split(' ').length, 6, 'uncapped, as before');
  assert.ok(!split.includes('#gbti'), 'and unbranded');
});

// ---------- the length guard ----------

test('an over-long post sheds WHOLE hashtags rather than letting truncate bisect one', () => {
  const long = share({ title: 'A'.repeat(200), category: 'open-source', tags: ['wireguard', 'tailscale', 'networking'] });
  const out = renderTemplate('Shared on the GBTI Network: "{title}" {url} {hashtags}', long, { limit: 300 });
  assert.ok(out.length <= 300, 'it fits');
  assert.ok(!/#[A-Za-z0-9.-]*…/.test(out), 'and no hashtag was cut in half');
});

test('the REAL Tailcat share fits Bluesky with a full five-hashtag tail', () => {
  // The live item from the report, rendered through the real template. Measured across all 57 shares the
  // worst case is 265, so this pins the actual headline case rather than a synthetic one.
  const item = share({
    title: 'Tailcat: An open-source CLI for Tailscale’s WireGuard®, NAT traversal, and DERP',
    url: 'https://gbti.network/shares/atwellpub/20260831172148-tailcat-an-open-source-cli-for-tailscale-s-wireg/',
    category: 'open-source',
    tags: ['wireguard', 'tailscale', 'nat-traversal'],
  });
  const out = renderTemplate('Shared on the GBTI Network: "{title}" {url} {hashtags}', item, { limit: 300 });
  assert.ok(out.length <= 300, `rendered ${out.length} characters`);
  // NOTE THE CASING, which is pre-existing and deliberate elsewhere: toHashtag CamelCases a multi-word tag
  // and preserves a single word's own casing so an acronym survives, so `nat-traversal` becomes
  // `#NatTraversal` while `wireguard` stays `#wireguard`. Asserted as it actually is rather than as it
  // ideally reads, because changing that rule would turn #AI into #Ai.
  assert.ok(out.endsWith('#OpenSource #wireguard #tailscale #NatTraversal #gbti'), out.slice(-70));
});

// ---------- the optimistic item ----------

test('the just-posted share renders its own tags instead of appearing untagged for three minutes', () => {
  const it = optimisticShareItem({ res: { id: 'x', path: 'members/alice/shares/x.md' }, input: { tags: ['wireguard'] }, body: 'b' });
  assert.deepEqual(it.tags, ['wireguard']);
  assert.deepEqual(optimisticShareItem({ res: { id: 'x', path: 'members/alice/shares/x.md' }, input: {}, body: 'b' }).tags, [],
    'and an untagged share gets an array, never undefined');
});
