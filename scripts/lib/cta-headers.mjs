// sow-337: the page policies a call-to-action HTML block needs, shared by the build step that writes them
// (scripts/compose-headers.mjs) and the guard that checks them (scripts/check-headers.mjs).
//
// WHY A RULE PER PAGE. The site policy (public/_headers `/*`) lets scripts, frames, connections, styles and fonts
// load only from the site and a few named services, so a partner's widget script is blocked everywhere. Cloudflare
// joins two matching header rules into an intersection, so a page can never be loosened by ADDING a rule; it can only
// `! ` remove the policy and set a new one in the same block (the /embed relay does the same). So each page that
// shows an HTML block card gets a rule whose policy is the site policy plus that card's outside addresses in exactly
// those five lists, and every other page keeps the site policy.
//
// WHICH PAGES. The build is the authority: a page gets a rule when its built HTML carries an HTML block card
// (CtaCard.astro stamps data-cta and data-cta-layout on the card), and the addresses come from the card in
// house/ctas.yml. A card on no page, a disabled card and a card with no addresses make no rule.
import fs from 'node:fs';
import path from 'node:path';
import { ctasOf, CTA_HOST_RE } from '../../membership/cta-edits.mjs';

/** The only lists a card's addresses are added to. Every other directive stays exactly the site's. */
export const CARD_POLICY_DIRECTIVES = Object.freeze(['script-src', 'frame-src', 'connect-src', 'style-src', 'font-src']);
/**
 * Cloudflare Pages limits for a _headers file: rules in total and characters on one line. One rule is held back for
 * the noindex rule a preview deploy appends after the build (scripts/deploy-target.mjs).
 */
export const HEADER_LIMITS = Object.freeze({ rules: 100, reserved: 1, line: 2000 });
/** The built routes that mount a call-to-action card (src/pages/{articles,projects,prompts}/[slug], shares/[author]/[id]). */
const CARD_ROUTES = Object.freeze([['articles', 1], ['projects', 1], ['prompts', 1], ['shares', 2]]);

/** True for a URL path under a route that mounts a card, the only pages that may carry a card page policy. */
export const isCardRoutePath = (urlPath) => CARD_ROUTES.some(([section]) => String(urlPath || '').startsWith(`/${section}/`));

const subdirs = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return []; } };

/** The HTML block card ids a built page's markup shows, in order, once each. */
export function htmlCardIds(html) {
  const ids = [];
  for (const m of String(html || '').matchAll(/<div\b[^>]*\bdata-cta-layout="html"[^>]*>/g)) {
    const id = /\bdata-cta="([a-z0-9-]+)"/.exec(m[0])?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

/** Every built page that shows an HTML block card: [{ path: '/prompts/slug/', ids: ['card-id'] }], sorted by path. */
export function scanHtmlCardPages(distDir) {
  const pages = [];
  const visit = (rel, depth) => {
    const abs = path.join(distDir, ...rel);
    if (depth === 0) {
      let html;
      try { html = fs.readFileSync(path.join(abs, 'index.html'), 'utf8'); } catch { return; }
      const ids = htmlCardIds(html);
      if (ids.length) pages.push({ path: `/${rel.join('/')}/`, ids });
      return;
    }
    for (const name of subdirs(abs)) visit([...rel, name], depth - 1);
  };
  for (const [section, depth] of CARD_ROUTES) visit([section], depth);
  return pages.sort((a, b) => a.path.localeCompare(b.path));
}

/** Split a policy into [name, tokens[]] pairs, in order. */
const directivesOf = (value) => String(value || '').split(';').map((s) => s.trim()).filter(Boolean).map((s) => {
  const [name, ...tokens] = s.split(/\s+/);
  return [name.toLowerCase(), tokens];
});

/** The site policy with `hosts` added to the five card lists (each once, after the site's own sources). */
export function cardPolicy(siteValue, hosts) {
  return directivesOf(siteValue).map(([name, tokens]) => {
    if (!CARD_POLICY_DIRECTIVES.includes(name)) return [name, ...tokens].join(' ');
    return [name, ...tokens, ...hosts.filter((h) => !tokens.includes(h))].join(' ');
  }).join('; ');
}

/**
 * The rule each card page needs: [{ path, ids, hosts, value }] for the pages whose cards list outside addresses, plus
 * any problem with the cards themselves. `siteValue` is the site policy the rules extend.
 */
export function cardRules(pages, registry, siteValue) {
  const problems = [];
  const cards = new Map(ctasOf(registry).filter((c) => c && typeof c === 'object').map((c) => [c.id, c]));
  const rules = [];
  for (const page of pages) {
    const hosts = [];
    const ids = [];
    for (const id of page.ids) {
      const card = cards.get(id);
      if (!card) { problems.push(`${page.path} shows the call-to-action "${id}", which is not in house/ctas.yml.`); continue; }
      for (const h of Array.isArray(card.hosts) ? card.hosts : []) {
        if (typeof h !== 'string' || !CTA_HOST_RE.test(h)) { problems.push(`the call-to-action "${id}" lists ${JSON.stringify(h)}, which is not a bare https address.`); continue; }
        if (!hosts.includes(h)) hosts.push(h);
      }
      ids.push(id);
    }
    if (hosts.length) rules.push({ path: page.path, ids, hosts, value: cardPolicy(siteValue, hosts) });
  }
  return { rules, problems };
}

/**
 * The served _headers text: the committed file, then one rule per page that shows an HTML block card with outside
 * addresses. Returns { text, rules, problems } and writes nothing; a non-empty `problems` means the build must stop,
 * because a missing rule blocks the partner code and a line Cloudflare will not take leaves the page without the
 * policy it was meant to have.
 */
export function composeCardHeaders(baseText, pages, registry) {
  const base = String(baseText || '').replace(/\s+$/, '');
  const global = siteRule(base);
  if (!global) return { text: `${base}\n`, rules: [], problems: ['public/_headers has no `/*` rule with a Content-Security-Policy, so there is no site policy to extend.'] };
  const problems = [];
  const missing = CARD_POLICY_DIRECTIVES.filter((d) => !directivesOf(global.value).some(([n]) => n === d));
  if (missing.length) problems.push(`the site policy has no ${missing.join(', ')} list, so a card's addresses have nowhere to go.`);
  const { rules, problems: cardProblems } = cardRules(pages, registry, global.value);
  problems.push(...cardProblems);
  const blocks = rules.map((r) => `# ${r.ids.join(', ')}\n${r.path}\n  ! ${global.name}\n  ${global.name}: ${r.value}`);
  const text = blocks.length
    ? `${base}\n\n# sow-337: pages showing a call-to-action HTML block. Each replaces the site policy with the site policy plus\n# that card's outside addresses in script-src, frame-src, connect-src, style-src and font-src. Composed at build by\n# scripts/compose-headers.mjs from house/ctas.yml and the built pages; not edited by hand.\n\n${blocks.join('\n\n')}\n`
    : `${base}\n`;
  const ruleCount = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#') && !/^\s/.test(l)).length;
  if (ruleCount > HEADER_LIMITS.rules - HEADER_LIMITS.reserved) {
    problems.push(`the site needs ${ruleCount} header rules, and Cloudflare allows ${HEADER_LIMITS.rules} (one is kept for the preview site's noindex rule). ${rules.length} of them are pages showing an HTML block card: take a card off some pages, or give fewer pages partner code.`);
  }
  for (const r of rules) {
    const len = `  ${global.name}: ${r.value}`.length;
    if (len > HEADER_LIMITS.line) problems.push(`the policy for ${r.path} is ${len} characters with the addresses of ${r.ids.join(', ')}, and Cloudflare allows ${HEADER_LIMITS.line} on one line: remove an outside address from that card.`);
  }
  const long = base.split('\n').filter((l) => l.length > HEADER_LIMITS.line).length;
  if (long) problems.push(`public/_headers has ${long} line(s) over Cloudflare's ${HEADER_LIMITS.line} characters.`);
  return { text, rules, problems };
}

/** The committed `/*` rule's policy header: { name, value } or null. Kept tiny so this module needs no guard import. */
export function siteRule(text) {
  let inGlobal = false;
  for (const raw of String(text || '').split('\n')) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue;
    if (!/^\s/.test(raw)) { inGlobal = raw.trim() === '/*'; continue; }
    const m = inGlobal && /^\s+(Content-Security-Policy(?:-Report-Only)?):\s*(.+)$/i.exec(raw);
    if (m) return { name: m[1], value: m[2].trim() };
  }
  return null;
}
