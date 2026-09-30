// sow-109: what a prompt item IS. A prompt is text a reader copies into an AI tool; a skill is a SKILL.md file a
// reader installs once, so their agent gains a new command. Owner, 2026-09-22: "Members are not going to know how
// to intuitively differentiate skills from prompts."
//
// Node-free and pure over already-parsed frontmatter, like membership/ai-tools.mjs beside it, so the build
// validator, the editor and the tests all read the rule the same way.
//
// THE KIND IS REQUIRED ON EVERY ITEM (owner, 2026-09-29). A missing kind is an error, never a quiet "prompt":
// a skill saved without it would otherwise show as a prompt and nothing anywhere would report it.

export const PROMPT_KINDS = Object.freeze(['prompt', 'skill']);

/** What a reader sees for each kind. */
export const KIND_LABEL = Object.freeze({ prompt: 'Prompt', skill: 'Skill' });

/**
 * What is wrong with a prompt item's kind, as plain sentences. Empty means nothing is wrong.
 * A skill must also say which tools it is made for (its `targets`), because its page shows install steps per tool.
 */
export function promptKindProblems(fm) {
  const kind = fm?.kind;
  if (kind === undefined || kind === null || kind === '') {
    return ['kind is missing. Every prompt item says what it is: kind: prompt (text a reader copies into an AI tool) or kind: skill (a SKILL.md file a reader installs).'];
  }
  if (!PROMPT_KINDS.includes(kind)) return [`kind "${kind}" is not one of: ${PROMPT_KINDS.join(', ')}.`];
  if (kind === 'skill' && !(Array.isArray(fm.targets) && fm.targets.length)) {
    return ['a skill must name the tools it is made for in targets (for example targets: [Claude Code]), because its page shows install steps for each one.'];
  }
  return [];
}
