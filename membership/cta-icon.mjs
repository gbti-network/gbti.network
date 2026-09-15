// sow-337: a call-to-action button icon, stored INLINE in house/ctas.yml as plain SVG shapes, so a public page draws
// it with no icon library at all. The shapes come from React Icons (pinned 5.7.0), whose icon files are JSON-shaped
// trees the site reads as data and never runs (reactIconToCta below, used by the icon catalog build).
//
// The registry is superadmin-only, but an icon still reaches every page carrying the card as raw SVG markup, so the
// shape of a stored icon is an ALLOWLIST, not a filter: a handful of shape elements, their geometry and paint
// attributes, and values drawn from a strict character set. No script, no event handler, no style, no href, no
// url(...), no <use>, no <foreignObject>. Anything outside the list is refused, and the same rule runs in the edit
// core (every writer), the content check and the catalog build, so the picker can never offer an icon a save would
// refuse.

export const ICON_TAGS = Object.freeze(['path', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'rect', 'g']);
export const ICON_LIMITS = Object.freeze({ name: 64, set: 40, nodes: 200, depth: 4, value: 20000, total: 60000 });

const NUM = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?$/i;
const LEN = /^-?(\d+\.?\d*|\.\d+)(e-?\d+)?(px|%)?$/i;
const PATH_DATA = /^[0-9eE.,\s+\-MmLlHhVvCcSsQqTtAaZz]*$/;
const POINTS = /^[0-9eE.,\s+\-]*$/;
const PAINT = /^(none|currentColor|inherit|#[0-9a-fA-F]{3,8})$/;
const TRANSFORM = /^(\s*(translate|scale|rotate|matrix|skewX|skewY)\(\s*[0-9eE.,\s+\-]*\)\s*)+$/;
const VIEWBOX = /^\s*-?[\d.]+([\s,]+-?[\d.]+){3}\s*$/;
const NAME_RE = /^[A-Z][A-Za-z0-9]*$/;
const SET_RE = /^[A-Za-z0-9 .\-]+$/;

const ATTRS = Object.freeze({
  d: PATH_DATA, points: POINTS,
  cx: LEN, cy: LEN, r: LEN, rx: LEN, ry: LEN, x: LEN, y: LEN, x1: LEN, y1: LEN, x2: LEN, y2: LEN, width: LEN, height: LEN,
  fill: PAINT, stroke: PAINT, 'stroke-width': LEN,
  'stroke-linecap': /^(butt|round|square)$/, 'stroke-linejoin': /^(miter|round|bevel|arcs|miter-clip)$/, 'stroke-miterlimit': NUM,
  'fill-rule': /^(nonzero|evenodd)$/, 'clip-rule': /^(nonzero|evenodd)$/,
  opacity: NUM, 'fill-opacity': NUM, 'stroke-opacity': NUM,
  transform: TRANSFORM,
});
const ROOT_ATTRS = Object.freeze(['fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-miterlimit', 'fill-rule', 'clip-rule', 'opacity']);

const isMap = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

function attrProblems(attrs, allowed, at, budget) {
  const problems = [];
  if (attrs === undefined) return problems;
  if (!isMap(attrs)) return [`${at}: attrs must be a map`];
  for (const [k, raw] of Object.entries(attrs)) {
    if (!allowed.includes(k)) { problems.push(`${at}: attribute "${k}" is not allowed in an icon`); continue; }
    if (typeof raw !== 'string' && typeof raw !== 'number') { problems.push(`${at}: attribute "${k}" must be a string or number`); continue; }
    const v = String(raw);
    budget.total += v.length;
    if (v.length > ICON_LIMITS.value) problems.push(`${at}: attribute "${k}" is too long`);
    else if (!ATTRS[k].test(v)) problems.push(`${at}: attribute "${k}" has a value an icon may not carry`);
  }
  return problems;
}

function shapeProblems(shapes, at, depth, budget) {
  if (!Array.isArray(shapes)) return [`${at}: shapes must be a list`];
  if (depth > ICON_LIMITS.depth) return [`${at}: shapes are nested too deeply`];
  const problems = [];
  shapes.forEach((s, i) => {
    const here = `${at}[${i}]`;
    budget.nodes += 1;
    if (!isMap(s)) { problems.push(`${here}: must be a map of { tag, attrs }`); return; }
    for (const k of Object.keys(s)) if (!['tag', 'attrs', 'children'].includes(k)) problems.push(`${here}: key "${k}" is not allowed`);
    if (!ICON_TAGS.includes(s.tag)) { problems.push(`${here}: element "${s.tag}" is not allowed in an icon`); return; }
    problems.push(...attrProblems(s.attrs, Object.keys(ATTRS), here, budget));
    if (s.children !== undefined) {
      if (s.tag !== 'g') problems.push(`${here}: only a group (g) may have children`);
      else problems.push(...shapeProblems(s.children, `${here}.children`, depth + 1, budget));
    }
  });
  return problems;
}

/** Every problem with a stored icon ({ name, set, viewBox, attrs?, shapes }), prefixed with `where`. [] means valid. */
export function iconProblems(icon, where = 'icon') {
  if (!isMap(icon)) return [`${where}: must be a map of { name, set, viewBox, shapes }`];
  const problems = [];
  for (const k of Object.keys(icon)) if (!['name', 'set', 'viewBox', 'attrs', 'shapes'].includes(k)) problems.push(`${where}: key "${k}" is not allowed`);
  if (typeof icon.name !== 'string' || !NAME_RE.test(icon.name) || icon.name.length > ICON_LIMITS.name) problems.push(`${where}: name must be a React Icons name like FaAmazon`);
  if (typeof icon.set !== 'string' || !SET_RE.test(icon.set) || icon.set.length > ICON_LIMITS.set) problems.push(`${where}: set must be the icon set's name`);
  if (typeof icon.viewBox !== 'string' || !VIEWBOX.test(icon.viewBox)) problems.push(`${where}: viewBox must be four numbers`);
  const budget = { nodes: 0, total: 0 };
  problems.push(...attrProblems(icon.attrs, ROOT_ATTRS, `${where}.attrs`, budget));
  if (!Array.isArray(icon.shapes) || icon.shapes.length === 0) problems.push(`${where}: shapes must be a non-empty list`);
  else problems.push(...shapeProblems(icon.shapes, `${where}.shapes`, 1, budget));
  if (budget.nodes > ICON_LIMITS.nodes) problems.push(`${where}: too many shapes (max ${ICON_LIMITS.nodes})`);
  if (budget.total > ICON_LIMITS.total) problems.push(`${where}: the icon is too large`);
  return problems;
}

const escAttr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const attrString = (attrs) => Object.entries(isMap(attrs) ? attrs : {}).map(([k, v]) => ` ${k}="${escAttr(v)}"`).join('');

function shapesSvg(shapes) {
  return (Array.isArray(shapes) ? shapes : []).map((s) => {
    if (!isMap(s) || !ICON_TAGS.includes(s.tag)) return '';
    const inner = s.tag === 'g' ? shapesSvg(s.children) : '';
    return `<${s.tag}${attrString(s.attrs)}>${inner}</${s.tag}>`;
  }).join('');
}

/**
 * The icon as SVG markup, or '' when it is not a valid icon. Validates first, so a caller can never emit an icon
 * the rules refuse, and escapes every value anyway.
 */
export function iconSvg(icon, className = '') {
  if (iconProblems(icon).length) return '';
  const cls = className ? ` class="${escAttr(className)}"` : '';
  return `<svg${cls} viewBox="${escAttr(icon.viewBox)}"${attrString(icon.attrs)} aria-hidden="true" focusable="false">${shapesSvg(icon.shapes)}</svg>`;
}

const kebab = (k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

function reactChildren(children) {
  const out = [];
  for (const c of Array.isArray(children) ? children : []) {
    if (!isMap(c) || !ICON_TAGS.includes(c.tag)) return null;
    const attrs = {};
    for (const [k, v] of Object.entries(isMap(c.attr) ? c.attr : {})) attrs[kebab(k)] = v;
    const node = { tag: c.tag, attrs };
    if (Array.isArray(c.child) && c.child.length) {
      if (c.tag !== 'g') return null;
      const kids = reactChildren(c.child);
      if (!kids) return null;
      node.children = kids;
    }
    out.push(node);
  }
  return out;
}

/**
 * Convert one React Icons GenIcon tree ({ tag: 'svg', attr, child }) to a stored icon, or null when the icon uses
 * anything the allowlist refuses. React Icons draws every icon with fill and stroke set to currentColor and a
 * stroke width of 0 unless the tree says otherwise, so those defaults are made explicit here.
 */
export function reactIconToCta(name, set, tree) {
  if (!isMap(tree) || tree.tag !== 'svg') return null;
  const a = isMap(tree.attr) ? tree.attr : {};
  const attrs = { fill: a.fill ?? 'currentColor', stroke: a.stroke ?? 'currentColor', 'stroke-width': String(a.strokeWidth ?? '0') };
  for (const [k, v] of Object.entries(a)) {
    const kk = kebab(k);
    if (ROOT_ATTRS.includes(kk) && !['fill', 'stroke', 'stroke-width'].includes(kk)) attrs[kk] = v;
  }
  const shapes = reactChildren(tree.child);
  if (!shapes || !shapes.length) return null;
  const icon = { name, set, viewBox: String(a.viewBox || '0 0 24 24'), attrs, shapes };
  return iconProblems(icon).length ? null : icon;
}
