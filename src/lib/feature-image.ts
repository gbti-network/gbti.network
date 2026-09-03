// The per-type default feature / share image (the branded 1200x630 banner under /brand/feature/), used as the
// fallback cover for any content type that has no custom image, so unbranded items still read as GBTI in feeds,
// cards, and link previews. See /brand for the set. Rendered from the DesignSync Logo Package.
// sow-196: feature-product.png is KEPT beside feature-project.png rather than replaced by it. Its URL is
// already baked into the og:image of every product announcement syndicated to X, LinkedIn, Discord and
// dev.to, and those posts cannot be edited; deleting the file turns each of their link previews blank.
const TYPE_TO_FEATURE: Record<string, string> = {
  post: 'article', article: 'article',
  project: 'project', product: 'project', // sow-196: the retired type name resolves to the same banner
  prompt: 'prompt',
  share: 'share',
  profile: 'profile',
  tag: 'tag',
  category: 'category',
  search: 'search',
};

/** Root-relative path to the default feature image for a content type (falls back to the article banner). */
export function defaultFeatureImage(type: string): string {
  const key = TYPE_TO_FEATURE[type] ?? 'article';
  return `/brand/feature/feature-${key}.png`;
}
