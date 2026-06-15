// Git-native overrides I/O: read + parse the house/*.yml files. The PURE logic (roles, bans, grandfather,
// effective-status precedence ban > staff > grandfather > Stripe) lives in node-free overrides-core.mjs so it
// can also run in the Cloudflare Worker (SOW-015 GET /membership/key). This file re-exports all of it and adds
// the node:fs load helpers, so every existing importer of overrides.mjs is unchanged.

import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import {
  rolesFromParsed, bansFromParsed, grandfathersFromParsed, membersIndexFromParsed,
} from './overrides-core.mjs';

export * from './overrides-core.mjs';

// ---- I/O wrappers (read + parse the house/*.yml files) ----

function readYaml(file) {
  if (!fs.existsSync(file)) return {};
  return yaml.load(fs.readFileSync(file, 'utf8')) ?? {};
}

/** Load all overrides from a repo root. Returns { roles, bans, grandfathers, membersIndex } as Maps. */
export function loadOverrides(root) {
  const house = path.join(root, 'house');
  return {
    roles: rolesFromParsed(readYaml(path.join(house, 'roles.yml'))),
    bans: bansFromParsed(readYaml(path.join(house, 'bans.yml'))),
    grandfathers: grandfathersFromParsed(readYaml(path.join(house, 'grandfathered.yml'))),
    membersIndex: membersIndexFromParsed(readYaml(path.join(house, 'members-index.yml'))),
  };
}

/**
 * SOW-015: load the RAW parsed YAML objects (not Maps) for the `roles`, `bans`, and `grandfathered` files, to
 * mirror into SIGNUP_KV for the Worker's GET /membership/key endpoint. The Worker rebuilds Maps with the
 * *FromParsed helpers and applies effectiveStatus server-side. members-index is intentionally excluded (the
 * key endpoint resolves identity from the GitHub token, not the folder map).
 */
export function loadOverridesRaw(root) {
  const house = path.join(root, 'house');
  return {
    roles: readYaml(path.join(house, 'roles.yml')),
    bans: readYaml(path.join(house, 'bans.yml')),
    grandfathered: readYaml(path.join(house, 'grandfathered.yml')),
  };
}
