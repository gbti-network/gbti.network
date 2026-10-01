// The markdown cheatsheet <gbti-content-editor> shows from its toolbar, one entry per content type. The element's
// cheatData() picks the entry for the type being edited. Moved out of the element unchanged when it crossed the
// 900-line limit (owner, 2026-09-30).

// SOW-062 Phase 6: the markdown cheatsheet content, shown by the toolbar's "Markdown Cheatsheet" button per type.
// Ported from the hi-fi mockup's MD_REF, but rewritten to teach GBTI's REAL body syntax from markdown-blocks.mjs
// (fenced ```callout <variant> and ```embed blocks, plus the `<!-- members-only -->` split marker), NOT the mockup's
// invented `:::` directives, so the reference matches what the serializer actually produces.
const _lines = (a) => a.join('\n');
const MEM_MARKER = '<!-- members-only -->';
const MD_CHEAT = {
  article: {
    label: 'Article',
    blurb: 'Long-form posts. The full markdown palette, plus a callout block and a members-only split.',
    directives: [
      ['```callout note', 'aside / highlight (note, tip, warning)'],
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading 1', '## Heading 2', '### Heading 3', '',
      'Paragraph with **bold**, _italic_, `inline code`,', 'and [a link](https://url).', '',
      '- Bulleted item', '- Another item', '',
      '1. Numbered item', '2. Another item', '',
      '> A blockquote.', '',
      '```js', '// fenced code block', 'const x = 1;', '```', '',
      '```callout warning', 'A highlighted aside. Variants: note, tip, warning.', '```', '',
      MEM_MARKER, '', 'Everything below the marker is visible to members only.',
    ]),
  },
  prompt: {
    label: 'Prompt',
    blurb: 'Reusable prompts. A pure markdown body, with an optional members-only split for extra guidance.',
    directives: [
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading', '',
      'Plain markdown body with **bold**, _italic_,', '`inline code`, and [links](https://url).', '',
      '- Bulleted item', '1. Numbered item', '',
      '> A blockquote.', '',
      '```json', '{ "mcpServers": {} }', '```', '',
      MEM_MARKER, '', 'Extra guidance reserved for members.',
    ]),
  },
  project: {
    label: 'Project',
    blurb: 'Software projects. Adds a callout, a video embed, and a members-only split.',
    directives: [
      ['```callout tip', 'aside / highlight (note, tip, warning)'],
      ['```embed', 'video embed (YouTube or Vimeo URL)'],
      [MEM_MARKER, 'everything below is members-only'],
    ],
    body: _lines([
      '# Heading', '',
      'Paragraph with **bold**, _italic_, `inline code`,', 'and [a link](https://url).', '',
      '- Bulleted item', '1. Numbered item', '',
      '> A blockquote.', '',
      '```bash', 'composer require gbti/taxonomy', '```', '',
      '```callout tip', 'A highlighted aside.', '```', '',
      '```embed', 'https://youtube.com/watch?v=...', '```', '',
      MEM_MARKER, '', 'Content only members can read.',
    ]),
  },
};

export { MD_CHEAT };
