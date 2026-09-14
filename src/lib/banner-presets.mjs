// sow-174: curated banner-color presets, an alternative to uploading a banner image. Eight options only, no
// free color input: every value here already exists as a design token elsewhere (the brand green/amber/ink,
// plus the project family colors in src/lib/project-categories.mjs), so a choice
// can never land on a public page with poor contrast under the hero's white title or a color that clashes
// with the rest of the site.
//
// Every project family has a preset keyed by its taxonomy leaf, and its `from` is that family's `cb`
// (sow-269 added utilities and chrome-extensions, which the family list had and this list did not). This file
// is the one place both sides (the schema's enum and the editor's swatch picker) get the values from;
// gbti-v3.css's `.pd-hero[data-preset]` rules restate them as literal hex because a stylesheet cannot import a
// module. This list is NOT generated from the family list on purpose: removing a family must never remove a
// preset, or published frontmatter naming it fails the enum. test/project-categories.test.mjs holds all three
// in agreement, so a key added here without its CSS rule fails the suite instead of rendering as ink.
export const BANNER_PRESETS = [
  { key: 'green', label: 'Green', from: '#1f9e5f', to: '#25232b' },
  { key: 'amber', label: 'Amber', from: '#b57616', to: '#25232b' },
  { key: 'ink', label: 'Ink', from: '#393542', to: '#25232b' }, // today's existing default hero, unchanged
  { key: 'wordpress', label: 'WordPress', from: '#5a8de0', to: '#25232b' },
  { key: 'ide-plugins', label: 'IDE Plugins', from: '#9277d4', to: '#25232b' },
  { key: 'mods', label: 'Mods', from: '#d8a847', to: '#25232b' },
  { key: 'utilities', label: 'Utilities', from: '#3bb0a4', to: '#25232b' },
  { key: 'chrome-extensions', label: 'Chrome Extensions', from: '#e0584a', to: '#25232b' },
];

export const BANNER_PRESET_KEYS = BANNER_PRESETS.map((p) => p.key);
