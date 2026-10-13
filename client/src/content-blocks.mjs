// sow-453: the article component library's data blocks: ```tags, ```bar, ```facts and ```button. Owner, 2026-10-13,
// picking option B (chips and share bar) and liking D (fact table) on the design canvas. Every renderer goes through
// this one module (the site's remark pass, the WorkBench preview and the extension reader through markdown.mjs, the
// dev.to and Hashnode bodies), so a block cannot look one way on the site and another in the reader.
//
// A block body is plain lines, so a writer, the doc editor and an agent through the MCP server all write the same
// thing. Output HTML uses only the classes the site sanitizer admits (src/lib/markdown-sanitize.mjs); a bar's length
// is a class (gbti-bar-w-<0..100>) because the sanitizer does not admit an inline width.

export const DATA_BLOCKS = ['tags', 'bar', 'facts', 'button', 'stats']; // stats: option A, picked 2026-10-13

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const lines = (body) => String(body ?? '').split('\n').map((l) => l.trim()).filter(Boolean);

/** "60%" -> 60, "7 %" -> 7; anything else (or outside 0..100) -> null. */
export function parsePercent(v) {
  const m = String(v ?? '').trim().match(/^(\d{1,3})\s*%$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 0 && n <= 100 ? n : null;
}

const safeUrl = (u) => (/^https?:\/\/[^\s<>"']+$/i.test(String(u ?? '').trim()) ? String(u).trim() : null);

/** Split "Key: value" on the FIRST colon; a line with no colon has key null. */
function keyValue(line) {
  const i = line.indexOf(':');
  if (i <= 0) return { k: null, v: line };
  return { k: line.slice(0, i).trim(), v: line.slice(i + 1).trim() };
}

export function parseTags(body) {
  return { tags: lines(body) };
}

export function parseBar(body) {
  const out = { label: '', value: null, raw: '', note: '', unknown: [] };
  for (const l of lines(body)) {
    const { k, v } = keyValue(l);
    const key = (k || '').toLowerCase();
    if (key === 'label') out.label = v;
    else if (key === 'value') { out.raw = v; out.value = parsePercent(v); }
    else if (key === 'note') out.note = v;
    else out.unknown.push(l);
  }
  return out;
}

export function parseFacts(body) {
  const rows = [];
  const bad = [];
  for (const l of lines(body)) {
    const { k, v } = keyValue(l);
    if (!k) { bad.push(l); continue; }
    const m = v.match(/^(.*?)\s*\{bar\}\s*$/);
    const value = m ? m[1].trim() : v;
    rows.push({ k, v: value, bar: m ? parsePercent(value) : null, barAsked: !!m });
  }
  return { rows, bad };
}

/** Option A's stat strip: an optional "caption:" line, then "value: label" lines (118K: subscribers). */
export function parseStats(body) {
  let caption = '';
  const stats = [];
  const bad = [];
  for (const l of lines(body)) {
    const { k, v } = keyValue(l);
    if (k && k.toLowerCase() === 'caption') { caption = v; continue; }
    if (!k || !v) { bad.push(l); continue; }
    stats.push({ value: k, label: v });
  }
  return { caption, stats, bad };
}

/** Line 1 the label, line 2 the URL; also accepts "label | url" on one line. */
export function parseButton(body) {
  const ls = lines(body);
  let label = ls[0] ?? '';
  let url = ls[1] ?? '';
  if (ls.length === 1 && label.includes('|')) [label, url] = label.split('|').map((s) => s.trim());
  return { label, url: safeUrl(url), rawUrl: url };
}

/** The HTML for a data block, or null when the fence is not one of them (or the block is empty). */
export function renderDataBlock(name, body, meta = '') {
  if (name === 'tags') {
    const { tags } = parseTags(body);
    if (!tags.length) return null;
    return `<div class="gbti-tags">${tags.map((t, i) => `<span class="gbti-tag${i === 0 ? ' gbti-tag-primary' : ''}">${esc(t)}</span>`).join('')}</div>`;
  }
  if (name === 'bar') {
    const b = parseBar(body);
    if (b.value == null) return b.label || b.note ? `<p>${esc([b.label, b.raw, b.note].filter(Boolean).join(' · '))}</p>` : null;
    return `<div class="gbti-bar"><div class="gbti-bar-head"><span class="gbti-bar-label">${esc(b.label)}</span><span class="gbti-bar-value">${b.value}%</span></div>`
      + `<span class="gbti-bar-track"><span class="gbti-bar-fill gbti-bar-w-${b.value}"></span></span>`
      + (b.note ? `<div class="gbti-bar-note">${esc(b.note)}</div>` : '') + '</div>';
  }
  if (name === 'facts') {
    const { rows } = parseFacts(body);
    if (!rows.length) return null;
    return `<dl class="gbti-facts">${rows.map((r) => `<div class="gbti-fact"><dt>${esc(r.k)}</dt><dd><span>${esc(r.v)}</span>`
      + (r.bar != null ? `<span class="gbti-bar-track gbti-bar-mini"><span class="gbti-bar-fill gbti-bar-w-${r.bar}"></span></span>` : '')
      + '</dd></div>').join('')}</dl>`;
  }
  if (name === 'button') {
    const b = parseButton(body);
    if (!b.label) return null;
    const cls = String(meta).trim() === 'primary' ? 'gbti-button gbti-button-primary' : 'gbti-button';
    return b.url ? `<div class="gbti-button-row"><a class="${cls}" href="${esc(b.url)}">${esc(b.label)}</a></div>` : `<p>${esc(b.label)}</p>`;
  }
  if (name === 'stats') {
    const s = parseStats(body);
    if (!s.stats.length) return null;
    return '<div class="gbti-stats">' + (s.caption ? `<div class="gbti-stats-caption">${esc(s.caption)}</div>` : '')
      + `<div class="gbti-stats-row">${s.stats.map((x) => `<div class="gbti-stat"><span class="gbti-stat-value">${esc(x.value)}</span> <span class="gbti-stat-label">${esc(x.label)}</span></div>`).join(' ')}</div></div>`; // ' ' keeps each cell's text apart for readers and the sort
  }
  return null;
}

/** Plain markdown for places that cannot run the site's blocks (dev.to, Hashnode). */
export function dataBlockToMarkdown(name, body) {
  if (name === 'tags') return parseTags(body).tags.map((t) => `_${t}_`).join(' · ');
  if (name === 'bar') {
    const b = parseBar(body);
    return [`**${b.value != null ? `${b.value}%` : b.raw}** ${b.label}`.trim(), b.note ? `(${b.note})` : ''].filter(Boolean).join(' ');
  }
  if (name === 'facts') return parseFacts(body).rows.map((r) => `- **${r.k}:** ${r.v}`).join('\n');
  if (name === 'button') {
    const b = parseButton(body);
    return b.url ? `[${b.label}](${b.url})` : b.label;
  }
  if (name === 'stats') {
    const s = parseStats(body);
    return [s.caption ? `_${s.caption}_` : '', s.stats.map((x) => `**${x.value}** ${x.label}`).join(' · ')].filter(Boolean).join('\n\n');
  }
  return null;
}

/** The 101 width classes, for a stylesheet (the site's Prose CSS and the reader's shadow CSS). */
export function barWidthCss(scope = '') {
  let css = '';
  for (let i = 0; i <= 100; i++) css += `${scope} .gbti-bar-w-${i}{width:${i}%}`;
  return css;
}

/** Fence names the renderers know. The catalogue (components-catalog.mjs) must describe each one. */
export const KNOWN_FENCES = ['callout', 'embed', 'directory', ...DATA_BLOCKS];

/**
 * Warnings for component blocks in a markdown body (validate_content). Never errors: an existing article stays
 * valid. Each warning: { line, block, message }. A plain code fence (```js, ```bash, none) is not a component and is
 * never warned about; only the component names are checked.
 */
export function checkComponentBlocks(md) {
  const out = [];
  const src = String(md ?? '').split('\n');
  for (let i = 0; i < src.length; i++) {
    const open = src[i].match(/^```(\w+)(?:[ \t]+(.*))?$/);
    if (!open) continue;
    const name = open[1];
    const meta = (open[2] || '').trim();
    let j = i + 1;
    const body = [];
    while (j < src.length && !/^```\s*$/.test(src[j])) body.push(src[j++]);
    const at = i + 1;
    const warn = (message) => out.push({ line: at, block: name, message });
    if (j >= src.length) { if (KNOWN_FENCES.includes(name)) warn('the block is never closed with ```'); break; }
    const text = body.join('\n');
    if (name === 'callout' && meta && !['info', 'note', 'warning', 'tip'].includes(meta)) warn(`callout variant "${meta}" is not one of info, note, warning, tip; it shows as note`);
    if (name === 'embed') {
      if (meta && meta !== 'lightbox') warn(`embed option "${meta}" is not known; only "lightbox" is`);
      if (!/^https?:\/\//.test(text.trim())) warn('embed needs one video URL on its own line');
    }
    if (name === 'tags' && !lines(text).length) warn('tags is empty; put one tag per line');
    if (name === 'bar') {
      const b = parseBar(text);
      if (b.value == null) warn(`bar needs "value:" as a whole percentage from 0% to 100% (got "${b.raw}")`);
      if (!b.label) warn('bar needs a "label:" line');
      for (const u of b.unknown) warn(`bar line "${u}" is not label:, value: or note:`);
    }
    if (name === 'facts') {
      const f = parseFacts(text);
      if (!f.rows.length) warn('facts is empty; write one "Label: value" per line');
      for (const l of f.bad) warn(`facts line "${l}" has no "Label:" before its value`);
      for (const r of f.rows) if (r.barAsked && r.bar == null) warn(`facts row "${r.k}" asks for {bar} but "${r.v}" is not a percentage`);
    }
    if (name === 'stats') {
      const st = parseStats(text);
      if (!st.stats.length) warn('stats needs at least one "value: label" line, such as "118K: subscribers"');
      for (const l of st.bad) warn(`stats line "${l}" is not "value: label"`);
    }
    if (name === 'button' && meta && meta !== 'primary') warn(`button option "${meta}" is not known; only "primary" is`);
    if (name === 'button') {
      const b = parseButton(text);
      if (!b.label) warn('button needs its label on the first line');
      if (!b.url) warn(`button needs an http or https URL on the second line (got "${b.rawUrl}")`);
    }
    i = j;
  }
  return out;
}

/**
 * The blocks' stylesheet, one source for the site (Prose.astro, V3 tokens) and the extension reader (its own
 * variables). Option B on the sow-453 canvas: chips, a labelled bar with a note, an outlined button; option D: the
 * fact table. `t` names the colour for each role in the host's own variables.
 */
export function dataBlocksCss(scope, t) {
  const s = scope;
  return `${s} .gbti-tags{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 .9em}
${s} .gbti-tag{display:inline-flex;align-items:center;min-height:26px;padding:0 10px;border-radius:999px;border:1px solid ${t.line2};color:${t.soft};font-family:${t.mono};font-size:12px;font-weight:500;line-height:1.2}
${s} .gbti-tag-primary{background:${t.greenTint};color:${t.green700};border-color:${t.greenBorder}}
${s} .gbti-bar{margin:1.1em 0 .9em}
${s} .gbti-bar-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px}
${s} .gbti-bar-label{font-size:14px;color:${t.soft}}
${s} .gbti-bar-value{font-family:${t.mono};font-weight:600;font-size:16px;color:${t.fg}}
${s} .gbti-bar-track{display:block;height:10px;margin-top:6px;border-radius:4px;overflow:hidden;background:${t.rest}}
${s} .gbti-bar-fill{display:block;height:100%;background:${t.green};box-shadow:2px 0 0 ${t.surface}}
${s} .gbti-bar-note{margin-top:10px;font-family:${t.mono};font-size:13px;line-height:1.5;color:${t.mute}}
${s} .gbti-facts{margin:1em 0;border-top:1px solid ${t.line}}
${s} .gbti-fact{display:grid;grid-template-columns:minmax(90px,30%) minmax(0,1fr);gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid ${t.line}}
${s} .gbti-fact dt{font-family:${t.mono};font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${t.mute};margin:0}
${s} .gbti-fact dd{margin:0;display:flex;align-items:center;gap:10px;font-size:15px;color:${t.fg}}
${s} .gbti-bar-mini{flex:1;max-width:220px;height:8px;margin:0}
${s} .gbti-button-row{margin:1em 0}
${s} a.gbti-button{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:8px;border:1.5px solid ${t.green700};color:${t.green700};text-decoration:none;font-weight:600;font-size:15px;line-height:1.2}
${s} a.gbti-button:hover{background:${t.greenTint}}
${s} a.gbti-button-primary{gap:8px;background:${t.green700Solid};border-color:${t.green700Solid};color:#fff}
${s} a.gbti-button-primary::before{content:"";width:0;height:0;border-style:solid;border-width:6px 0 6px 10px;border-color:transparent transparent transparent currentColor}
${s} a.gbti-button-primary:hover{background:#0b5a34;border-color:#0b5a34;color:#fff}
${s} .gbti-stats{margin:1em 0}
${s} .gbti-stats-caption{font-family:${t.mono};font-size:12px;letter-spacing:.04em;text-transform:uppercase;color:${t.mute}}
${s} .gbti-stats-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(72px,1fr));margin-top:10px;border-top:1px solid ${t.line};border-bottom:1px solid ${t.line}}
${s} .gbti-stat{display:flex;flex-direction:column;gap:2px;padding:12px 12px 12px 0}
${s} .gbti-stat-value{font-family:${t.mono};font-weight:600;font-size:clamp(20px,4.5vw,24px);line-height:1.1;color:${t.fg}}
${s} .gbti-stat-label{font-size:13px;line-height:1.35;color:${t.mute}}
${s} a.gbti-button:focus-visible{outline:2px solid ${t.green};outline-offset:2px}
${barWidthCss(s)}`;
}
