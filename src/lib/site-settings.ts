// sow-271 Phase 1: THE build-time reader for house/site-settings.yml, the git-native site-wide toggles.
//
// Why git and not KV: CLAUDE.md's storage boundary puts curated configuration in git and reserves KV for
// per-person state, and a site-wide presentation flag is curated configuration. Git is also the only option
// that works cleanly on a prerendered site -- the value is baked into the built HTML, so there is no flash of
// the wrong state, no per-page fetch, and a reader with JavaScript off sees the same thing as everyone else.
// The cost is the deploy delay: a flip goes live on the next Pages build, about three minutes.
//
// Validation is deliberately LOUD. A malformed or unknown-key file fails the build rather than resolving to a
// default, because a setting that silently reads as its default is indistinguishable from one that works, and
// the owner would have every reason to believe they had switched something off when they had not.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';
import { readAllToggles, unknownKeys, TOGGLE_KEYS } from '../../membership/site-settings-edits.mjs';

export type SiteToggles = Record<string, boolean>;

let cached: SiteToggles | null = null;

/** Parse + validate house/site-settings.yml. Cached per build process (the file cannot change mid-build). */
export function loadSiteSettings(): SiteToggles {
  if (cached) return cached;
  const file = path.resolve(process.cwd(), 'house', 'site-settings.yml');
  // A MISSING file is legitimate: every toggle falls back to its pre-toggle behaviour, so a fork that has not
  // created one behaves exactly as the site did before this feature existed. A file that exists but is broken
  // is NOT legitimate and throws below.
  if (!fs.existsSync(file)) {
    cached = readAllToggles({}) as SiteToggles;
    return cached;
  }
  let parsed: unknown;
  try {
    parsed = yaml.load(fs.readFileSync(file, 'utf8')) || {};
  } catch (err) {
    throw new Error(`house/site-settings.yml is not valid YAML: ${(err as Error).message}`);
  }
  const stray = unknownKeys(parsed);
  if (stray.length) {
    throw new Error(
      `house/site-settings.yml carries setting(s) this build does not know about: ${stray.join(', ')}. ` +
      `Known settings are: ${TOGGLE_KEYS.join(', ')}. Add the key to SITE_TOGGLES in ` +
      `membership/site-settings-edits.mjs, or remove it from the file -- an unknown key is read by nothing.`,
    );
  }
  // readAllToggles throws on a non-boolean stored value, which is the other way this file goes quietly wrong.
  cached = readAllToggles(parsed) as SiteToggles;
  return cached;
}

/**
 * Is the Chrome extension ADVERTISING allowed to render? Governs the header nav item, the homepage
 * Add-to-Chrome banner, the sign-in modal footnote, and the archived v1 homepage button.
 *
 * It deliberately does NOT govern the "Extension required" notices that appear after a member clicks a control
 * the extension implements: those explain a control that is currently dead, and hiding them would leave the
 * control dead AND silent. It also does not take /extension/ down; the install page stays reachable.
 */
export function extensionCtaEnabled(): boolean {
  return loadSiteSettings().extension_cta;
}
