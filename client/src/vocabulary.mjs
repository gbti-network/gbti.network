// The controlled vocabularies an author has to get exactly right, readable by an agent before it writes.
//
// WHY THIS EXISTS (sow-454). A member published their first project on 2026-10-13 and could not get it past
// validation, because the editor's link-type picker offered values the schema rejects. Auditing the agent
// surface in the same pass turned up the same defect with nothing to pick from at all: across all 23 MCP
// tools, `house/taxonomy.yml` was referenced ZERO times, the six link types appeared nowhere, and `license`
// carried four examples with no way to see the rest. Three vocabularies the validator enforces exactly were
// pure guesswork, and `validate_content` only reports the guess AFTER it fails.
//
// So this is the discovery call the tool descriptions point at. It reads the same files the build reads, so
// there is no fourth copy of any of it to drift.
//
// Host-portable, following the pattern admin-ops.mjs documents: the npm host's reader.readFile is sync and
// the extension's is async, and `await` handles both. A missing or unparseable file reads as empty rather
// than throwing, because an empty list is the honest answer for a fork that has not written one yet, and
// because this call must never be the reason an author cannot publish.
import yaml from 'js-yaml';
import { CONTENT_LINK_TYPES } from '../../src/lib/content-link-types.mjs';
import { licenseEntries } from '../../membership/licenses.mjs';

const TAXONOMY_PATH = 'house/taxonomy.yml';
const LICENSES_PATH = 'house/licenses.yml';

const readYaml = async (ctx, rel) => {
  try {
    return yaml.load((await ctx?.reader?.readFile?.(rel)) || '') ?? {};
  } catch {
    return {};
  }
};

/**
 * Flatten the category tree to the ordered paths a `categories` value may take, so an agent reads valid
 * values rather than inferring them from a nested shape. Every node is a legal stopping point: `["ai"]` is
 * as valid as `["ai","prompts","entertainment"]`.
 */
export function categoryPaths(tree, prefix = []) {
  const out = [];
  for (const [key, node] of Object.entries(tree && typeof tree === 'object' ? tree : {})) {
    const path = [...prefix, key];
    out.push({ path, label: (node && node.label) || key });
    if (node && node.children) out.push(...categoryPaths(node.children, path));
  }
  return out;
}

/**
 * Every controlled vocabulary at once, because an agent authoring one project needs all three and a
 * round trip per list is three chances to skip one.
 */
export async function listVocabulary(ctx) {
  const [taxDoc, licDoc] = await Promise.all([readYaml(ctx, TAXONOMY_PATH), readYaml(ctx, LICENSES_PATH)]);
  const categories = categoryPaths(taxDoc?.tree || {});
  return {
    linkTypes: CONTENT_LINK_TYPES.map((t) => ({ type: t.key, label: t.label })),
    licenses: licenseEntries(licDoc).map((l) => ({ id: l.id, url: l.url })),
    categories: categories.map((c) => ({ categories: c.path, label: c.label })),
    notes: [
      'A `categories` value is one ordered path from this list, as an array. Every node is a valid stopping point.',
      'A link `type` must be one of linkTypes exactly; nothing else validates.',
      'A `license` must be an id from licenses exactly. Custom also requires licenseUrl.',
    ],
  };
}
