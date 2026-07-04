// SOW-058: the node-side entry for the syndication configuration. All the pure logic lives in
// syndication-config-core.mjs (node-free, safe for the Worker + the MV3 extension bundle); this module adds
// only the fs-based repo-root loader for node callers (reconcile, scripts).

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { syndicationConfigFromParsed } from './syndication-config-core.mjs';

export * from './syndication-config-core.mjs';

/** Read + normalize house/syndication-config.yml from a repo root. Missing/unparseable file = safe defaults. */
export function loadSyndicationConfig(root) {
  const file = path.join(root, 'house', 'syndication-config.yml');
  if (!fs.existsSync(file)) return syndicationConfigFromParsed({});
  try {
    return syndicationConfigFromParsed(yaml.load(fs.readFileSync(file, 'utf8')) ?? {});
  } catch {
    return syndicationConfigFromParsed({}); // an unparseable config must never enable syndication
  }
}
