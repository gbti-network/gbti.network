// A small fixed palette of chip color schemes. Each distinct tag is mapped to one scheme by a stable
// hash of its name, so a given tag (e.g. "mcp", "design", "playwright") always renders the same color
// and different tags read as visually distinct. Light, low-saturation fills so the chips stay legible
// on both the light and dark page surfaces.
const SCHEMES = [
  { bg: '#eef2ff', fg: '#3730a3', bd: '#c7d2fe' }, // indigo
  { bg: '#ecfdf5', fg: '#065f46', bd: '#a7f3d0' }, // emerald
  { bg: '#fef2f2', fg: '#991b1b', bd: '#fecaca' }, // red
  { bg: '#fffbeb', fg: '#92400e', bd: '#fde68a' }, // amber
  { bg: '#f5f3ff', fg: '#5b21b6', bd: '#ddd6fe' }, // violet
  { bg: '#ecfeff', fg: '#155e75', bd: '#a5f3fc' }, // cyan
  { bg: '#fdf2f8', fg: '#9d174d', bd: '#fbcfe8' }, // pink
  { bg: '#fff7ed', fg: '#9a3412', bd: '#fed7aa' }, // orange
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Inline style string for a tag chip, deterministically colored by the tag name. */
export function tagStyle(tag: string): string {
  const s = SCHEMES[hash(tag.toLowerCase()) % SCHEMES.length];
  return `background:${s.bg};color:${s.fg};border-color:${s.bd}`;
}
