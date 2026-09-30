// sow-109 Phase 4: the All / Prompts / Skills switch on the extension's Prompts & Skills tab, the same choice the
// website's prompt directory offers. Pure, so the counts, the filter and the markup are node-tested; newtab.mjs owns
// the element, the click and the remembered choice.

/** Where the reader's choice is remembered, per browser. */
export const PROMPT_KIND_KEY = 'gbti-prompt-kind';

/** 'all', 'prompt' or 'skill'. Anything else is 'all', so a stale or hand-edited stored value never hides the tab. */
export const normalizePromptKind = (v) => (v === 'prompt' || v === 'skill' ? v : 'all');

// An item the indexes carry without a kind (an older build) is a prompt, the kind every item had before.
const kindOf = (row) => (row?.kind === 'skill' ? 'skill' : 'prompt');

/** How many prompt items of each kind are in `rows`. Other types are not counted. */
export function promptKindCounts(rows) {
  let prompt = 0;
  let skill = 0;
  for (const r of Array.isArray(rows) ? rows : []) {
    if (r?.type !== 'prompt') continue;
    if (kindOf(r) === 'skill') skill += 1; else prompt += 1;
  }
  return { all: prompt + skill, prompt, skill };
}

/** `rows` narrowed to one kind. Items of other types pass through, so the filter can never empty a mixed list. */
export function filterPromptKind(rows, kind) {
  const k = normalizePromptKind(kind);
  const list = Array.isArray(rows) ? rows : [];
  return k === 'all' ? list : list.filter((r) => r?.type !== 'prompt' || kindOf(r) === k);
}

const ICON = {
  prompt: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 6h16M4 12h11M4 18h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  skill: '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M4 17l6-5-6-5M12 19h8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/** The switch's buttons, the chosen one pressed. Counts are numbers, so nothing here needs escaping. */
export function promptKindSwitchHtml(kind, counts) {
  const k = normalizePromptKind(kind);
  const c = counts || { all: 0, prompt: 0, skill: 0 };
  const btn = (val, label) => `<button type="button" class="ks-btn${val === k ? ' on' : ''}" aria-pressed="${val === k}" data-kind-val="${val}">`
    + `${ICON[val] || ''}<span>${label}</span><span class="ks-n">${Number(c[val]) || 0}</span></button>`;
  return btn('all', 'All') + btn('prompt', 'Prompts') + btn('skill', 'Skills');
}
