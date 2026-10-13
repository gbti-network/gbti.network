// THE link types an author may use on a project or a prompt, and the one place they are written down.
//
// WHY THIS EXISTS (sow-454). The same six values were restated in FIVE places and had already drifted. The
// editor's picker offered `download, project, repository, github, website, docs, demo`, of which only
// `download` and `repository` validate, so five of its seven suggestions failed on Publish with
// `links.0.type: Invalid input`, and the four accepted values it never offered had to be typed by hand. A
// member hit this on their first project on 2026-10-13 and could not publish until they guessed. The
// picker was wrong for as long as it existed, and nothing could have caught it: every copy was correct
// on its own terms.
//
// Every consumer reads this list now:
//   - src/content.config.ts          the site build's schema
//   - client/src/schemas.mjs         the client + MCP validation schema (the one that refused him)
//   - src/lib/project-page.mjs       the render-time label map
//   - client-ui/.../editor-rows.mjs  the editor's control, now a select that cannot produce a bad value
//   - client/src/mcp-tools.mjs       the agent tool descriptions, which named none of these values
// test/content-link-types.test.mjs fails when any two of them disagree, because the defect here is DRIFT
// rather than a wrong constant, and a test pinning today's values would not have caught it.
//
// This is the pattern src/lib/banner-presets.mjs sets ("the one place both sides get the values from"),
// and for the same reason.
//
// Adding a type: add it here, and nothing else needs touching except content that wants to use it. REMOVING
// one is not safe on its own: published frontmatter naming it then fails the enum, so migrate the content
// first.

/** @type {ReadonlyArray<{ key: string, label: string }>} */
export const CONTENT_LINK_TYPES = Object.freeze([
  { key: 'homepage', label: 'Homepage' },
  { key: 'repository', label: 'Repository' },
  { key: 'mirror', label: 'Mirror' },
  { key: 'download', label: 'Download' },
  { key: 'documentation', label: 'Documentation' },
  { key: 'support', label: 'Support' },
]);

/** Just the keys, in order, for a z.enum and for the editor's options. */
export const CONTENT_LINK_TYPE_KEYS = Object.freeze(CONTENT_LINK_TYPES.map((t) => t.key));

/** One readable sentence naming every allowed value, for a validation message or a tool description. */
export const CONTENT_LINK_TYPES_SENTENCE = CONTENT_LINK_TYPE_KEYS.join(', ');
