// sow-109 Phase 4: a skill in the extension reader. The same install box the website's skill page shows (built by
// src/lib/skill-page.mjs from the same steps), with Copy and Download SKILL.md, for a PUBLIC skill.
//
// Everything here is public: the steps come from /skill-install.json and the file from /prompts/<slug>/SKILL.md, both
// build artifacts, fetched over the extension's gbti.network host permission. A members-only skill has no public
// file, so it gets no box here and keeps its body as the reader already shows it.
import { installTabsFromTools, skillNameFrom } from '../../membership/skill-install.mjs';
import { buildSkillInstallHtml } from '../../src/lib/skill-page.mjs';
import { SKILL_BOX_CSS, skillTokenDecls } from '../../src/lib/skill-box-css.mjs';

/**
 * The website token names the shared rules (SKILL_BOX_CSS) read, mapped onto client-ui's (client-ui/src/tokens.mjs), for
 * a shadow root.
 * --fg and --line-2 already exist there under the same names.
 */
export const READER_TOKEN_ALIASES = '--f-mono: var(--font-mono, ui-monospace, monospace); --f-display: var(--font-display); '
  + '--r-lg: 12px; --fg-soft: var(--muted); --green: var(--brand); --green-600: var(--brand-dark);';

/** The label and box styles for a shadow root: the website's rules, with its tokens mapped onto client-ui's. */
export const SKILL_READER_CSS = `:host { ${READER_TOKEN_ALIASES} ${skillTokenDecls('light')} }\n`
  + `:host-context([data-theme="dark"]) { ${skillTokenDecls('dark')} }\n${SKILL_BOX_CSS}`;

/** The slug in a prompt's site path (/prompts/<slug>/), or ''. */
export function promptSlugOf(url) {
  const m = /^\/prompts\/([a-z0-9][a-z0-9-]*)\/?$/.exec(String(url || ''));
  return m ? m[1] : '';
}

let steps = null; // one fetch of /skill-install.json per page
async function loadSteps(site, fetchImpl) {
  if (steps) return steps;
  const res = await fetchImpl(`${site}/skill-install.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(String(res.status));
  const json = await res.json();
  steps = Array.isArray(json?.tools) ? json.tools : [];
  return steps;
}

/**
 * The install box for one public skill, and its file's text (which Copy SKILL.md copies and Download saves). Null
 * when there is nothing to show: no public file, or a failed fetch. The box is then simply absent and the author's
 * text still reads, which is the same fallback the website uses for a tool with no steps.
 */
export async function loadSkillBox({ site, slug, targets, fileHref, fetchImpl = globalThis.fetch }) {
  if (!slug) return null;
  try {
    const [tools, fileRes] = await Promise.all([
      loadSteps(site, fetchImpl),
      fetchImpl(`${site}/prompts/${slug}/SKILL.md`, { cache: 'no-cache' }),
    ]);
    if (!fileRes.ok) return null;
    const text = await fileRes.text();
    return boxFor({ tools, text, targets, fileHref });
  } catch {
    return null;
  }
}

function boxFor({ tools, text, targets, fileHref }) {
  const { tabs, without } = installTabsFromTools({ tools, targets, name: skillNameFrom(text) });
  return { html: buildSkillInstallHtml({ tabs, without, fileHref: fileHref ? fileHref(text) : '' }), text };
}

/**
 * sow-109 Phase 7: the same box for a MEMBERS-ONLY skill, whose file is decrypted first. `decrypt()` answers the file's
 * text (the host reads the envelope and the Worker decrypts it; the key never reaches the page) and throws for a
 * reader who is not a paid member, which is passed on so the caller can say the box is for members. A failed steps
 * fetch still shows nothing rather than a wrong box.
 */
export async function loadMembersSkillBox({ site, targets, decrypt, fileHref, fetchImpl = globalThis.fetch }) {
  const text = await decrypt();
  if (typeof text !== 'string' || !text) return null;
  let tools;
  try { tools = await loadSteps(site, fetchImpl); } catch { return null; }
  return boxFor({ tools, text, targets, fileHref });
}

/** sow-425: the same box from a skill file the caller already holds (the WorkBench Preview has the draft's file). */
export async function loadSkillBoxFromText({ site, targets, text, fileHref, fetchImpl = globalThis.fetch }) {
  return loadMembersSkillBox({ site, targets, decrypt: async () => text, fileHref, fetchImpl });
}

/** Test seam: forget the cached steps. */
export function _resetSkillSteps() { steps = null; }
