import { splitMemberMarkdown } from '../../client/src/member-content.mjs';

/**
 * Project an authored draft body into the audience selected by Preview.
 * The authoring source keeps the marker; neither read-only projection may render it.
 */
export function previewMemberProjection(body, { visibility = 'public', asMember = false, editing = false } = {}) {
  const source = String(body ?? '');
  if (editing) return { markdown: source, gate: null };

  const { publicPart, memberPart } = splitMemberMarkdown(source);
  if (memberPart !== null) {
    // Publishing treats a non-empty marker tail as an authored public teaser,
    // even when the item's overall visibility is set to members.
    if (memberPart.trim()) {
      if (!asMember) return { markdown: publicPart, gate: 'tail' };
      return { markdown: [publicPart, memberPart].filter(Boolean).join('\n\n'), gate: null };
    }

    // An empty marker is removed. A members-visible item still falls back to
    // whole-item gating; a public item remains ordinary public content.
    if (visibility === 'members' && !asMember) return { markdown: '', gate: 'whole' };
    return { markdown: publicPart, gate: null };
  }

  if (visibility === 'members' && !asMember) return { markdown: '', gate: 'whole' };
  return { markdown: source, gate: null };
}
