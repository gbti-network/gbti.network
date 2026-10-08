// sow-445: the news source pool as the build reads it, for the share page's link card (link-card.mjs names a share of
// arstechnica.com "Ars Technica" from it). Read once per build. A missing or unreadable file is an empty list, which
// only means a share's card falls back to the platform or the domain.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

let cached = null;
export function readNewsSourceList(root = process.cwd()) {
  if (cached) return cached;
  try {
    const parsed = yaml.load(fs.readFileSync(path.resolve(root, 'house', 'news-sources.yml'), 'utf8'));
    cached = Array.isArray(parsed?.sources) ? parsed.sources : [];
  } catch { cached = []; }
  return cached;
}
