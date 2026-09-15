// sow-289: the one reader of house/outbound-links.yml for node callers (the redirect generator and the daily click
// rollup). It validates before it answers, so a malformed store fails the generation loudly instead of writing a
// broken 301, and the rollup queries exactly the paths the store lists rather than a prefix (five of the ten paths
// sit outside /outbound/). scripts/gen-redirects.mjs is a top-level script with side effects (it writes
// public/_redirects and reads the local-only legacy map), so this lives in its own module the tests can import.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { validateOutboundLinks, redirectRowsOf, linksOf, linkSummary } from '../../membership/outbound-link-edits.mjs';

export const OUTBOUND_LINKS_PATH = 'house/outbound-links.yml';

/** The parsed, validated store. Throws with every problem listed when the file is malformed. */
export function readOutboundLinks(root) {
  const parsed = yaml.load(fs.readFileSync(path.join(root, OUTBOUND_LINKS_PATH), 'utf8'));
  const problems = validateOutboundLinks(parsed);
  if (problems.length) throw new Error(`${OUTBOUND_LINKS_PATH} is invalid:\n  ${problems.join('\n  ')}`);
  return parsed;
}

/** [path, destination] rows in file order, for the redirect generator. */
export function outboundRows(root) {
  return redirectRowsOf(readOutboundLinks(root));
}

/** The board's view of every entry, in file order, for the rollup and the build artifact. */
export function outboundLinkSummaries(root) {
  return linksOf(readOutboundLinks(root)).map(linkSummary);
}
