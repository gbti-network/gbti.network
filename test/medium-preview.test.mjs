// The Medium RSS preview fallback (workers/lib/medium-preview.mjs). Pure, no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mediumFeedUrlFor, mediumArticleId, previewFromMediumFeed } from '../workers/lib/medium-preview.mjs';

const ARTICLE = 'https://medium.com/@writer/react-folder-structure-38fe32e27a2e';

test('mediumFeedUrlFor maps author, publication, and subdomain links; rejects non-Medium', () => {
  assert.equal(mediumFeedUrlFor(ARTICLE), 'https://medium.com/feed/@writer');
  assert.equal(mediumFeedUrlFor('https://medium.com/some-pub/a-post-1234abcd5678'), 'https://medium.com/feed/some-pub');
  assert.equal(mediumFeedUrlFor('https://writer.medium.com/a-post-1234abcd5678'), 'https://writer.medium.com/feed');
  assert.equal(mediumFeedUrlFor('https://medium.com/@writer'), null); // a profile, not an article
  assert.equal(mediumFeedUrlFor('https://example.com/@writer/post-38fe32e27a2e'), null);
  assert.equal(mediumFeedUrlFor('https://medium.com/m/global-identity'), null);
});

test('mediumArticleId pulls the trailing hex id', () => {
  assert.equal(mediumArticleId(ARTICLE), '38fe32e27a2e');
  assert.equal(mediumArticleId('https://medium.com/@w/no-id-here'), '');
});

const FEED = `<?xml version="1.0" encoding="UTF-8"?><rss><channel>
<item>
  <title><![CDATA[Some other post]]></title>
  <guid isPermaLink="false">https://medium.com/p/aaaabbbbcccc</guid>
  <content:encoded><![CDATA[<p>Other</p>]]></content:encoded>
</item>
<item>
  <title><![CDATA[React Folder Structure for Beginners]]></title>
  <guid isPermaLink="false">https://medium.com/p/38fe32e27a2e</guid>
  <category><![CDATA[react]]></category>
  <category><![CDATA[frontend]]></category>
  <content:encoded><![CDATA[<figure><img alt="cover" src="https://cdn-images-1.medium.com/max/1024/1*abc.png" /></figure><p>The folder <b>organization</b> that finally made sense.</p>]]></content:encoded>
</item>
</channel></rss>`;

test('previewFromMediumFeed matches the item by id and extracts title, image, description, tags', () => {
  const p = previewFromMediumFeed(FEED, ARTICLE);
  assert.equal(p.title, 'React Folder Structure for Beginners');
  assert.equal(p.image, 'https://cdn-images-1.medium.com/max/1024/1*abc.png');
  assert.equal(p.description, 'The folder organization that finally made sense.');
  assert.deepEqual(p.tags, ['react', 'frontend']);
});

test('previewFromMediumFeed fails closed on a missing item or junk feed', () => {
  assert.equal(previewFromMediumFeed(FEED, 'https://medium.com/@writer/unknown-ffffffffffff'), null);
  assert.equal(previewFromMediumFeed('<not really xml', ARTICLE), null);
  assert.equal(previewFromMediumFeed(null, ARTICLE), null);
});
