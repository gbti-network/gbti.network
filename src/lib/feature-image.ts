// The per-type default feature / share image (the branded 1200x630 banner under /brand/feature/), used as the
// fallback cover for any content type that has no custom image, so unbranded items still read as GBTI in feeds,
// cards, and link previews. See /brand for the set. Rendered from the DesignSync Logo Package.
const TYPE_TO_FEATURE: Record<string, string> = {
  post: 'article', article: 'article',
  product: 'product',
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
