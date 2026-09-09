// sow-189: the build-time reader of house/content-flags.yml, the superadmin registry of stale and unindexed
// items. Read once per build, like favorites.ts; the reading itself is the pure core in membership/, shared
// with the admin write path, the sitemap filter and the tests.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { contentFlagsFromParsed, flagsFor } from '../../membership/content-flags.mjs';

type Flags = Record<string, { stale?: true; unindexed?: true }>;
let cache: Flags | null = null;

function load(): Flags {
  if (cache) return cache;
  let parsed: unknown = null;
  try { parsed = yaml.load(fs.readFileSync(path.resolve(process.cwd(), 'house', 'content-flags.yml'), 'utf8')); } catch { /* no file or bad YAML: nothing is flagged */ }
  cache = contentFlagsFromParsed(parsed) as Flags;
  return cache;
}

/** `{ stale, unindexed }` for one item. Both false when unflagged. */
export function contentFlagsOf(type: 'post' | 'project' | 'prompt', slug: string): { stale: boolean; unindexed: boolean } {
  return flagsFor(load(), type, slug);
}
