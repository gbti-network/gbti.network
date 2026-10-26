// sow-453: the article component library, as one list a writer (or a writer's agent, through the MCP tool
// list_components) can read. Owner, 2026-10-13: "expand our MCP server to list all available library components for
// use for our writers submitting content through the MCP srver." Every block the renderers know is here; a test
// fails when a renderer learns a fence this list does not describe (KNOWN_FENCES in content-blocks.mjs).
import { IMAGE_LAYOUT_WORDS } from './image-attrs.mjs';
import { LIST_STYLE_WORDS } from './list-attrs.mjs';

const F = '```';

export const COMPONENTS = Object.freeze([
  {
    name: 'callout',
    kind: 'fence',
    purpose: 'A highlighted box for a tip, a warning, a note or extra information.',
    syntax: `${F}callout <info|note|warning|tip>\nText of the callout. **Bold**, *italic*, \`code\` and [links](https://example.com) work.\n${F}`,
    example: `${F}callout tip\nSave your work before you update a plugin.\n${F}`,
    renders: 'Site, preview and extension reader: a coloured box. Cross-posts: a code block.',
  },
  {
    name: 'embed',
    kind: 'fence',
    purpose: 'A video player (YouTube, Vimeo, TikTok, Rumble). Add the word lightbox to show a full-width poster that opens the player in the page lightbox, which loads nothing until the reader clicks.',
    syntax: `${F}embed [lightbox]\n<one video URL>\n${F}`,
    example: `${F}embed lightbox\nhttps://www.youtube.com/watch?v=n-ETaiZvHns\n${F}`,
    renders: 'Site: the player, or with lightbox a poster that opens the lightbox. Preview and reader: the same. Cross-posts: the video thumbnail linking to it.',
  },
  {
    name: 'directory',
    kind: 'fence',
    purpose: 'A sortable list. Put it just before a run of entries; each entry is a "### #N. Name" heading and what follows it, up to the next "##" heading. Readers sort by score (the order written), category (the first tag of each entry) or subscribers. Add the word youtube for YouTube-style chips, the chosen one in YouTube red.',
    syntax: `${F}directory [youtube]\n${F}`,
    example: `${F}directory\n${F}\n\n### #2. Second channel\n...\n\n### #1. First channel\n...`,
    renders: 'Site and preview: a sort bar over the entries. Reader and cross-posts: nothing; the entries stay in the order written.',
  },
  {
    name: 'tags',
    kind: 'fence',
    purpose: 'A row of tags. The first tag is the primary one (green); the rest are outlined. In a directory, the first tag is the entry\'s category.',
    syntax: `${F}tags\n<primary tag>\n<more tags, one per line>\n${F}`,
    example: `${F}tags\nOfficial and community\nAlways included\n${F}`,
    renders: 'Site, preview and reader: chips. Cross-posts: an italic line.',
  },
  {
    name: 'bar',
    kind: 'fence',
    purpose: 'One measure as a labelled bar from 0% to 100%, with an optional note under it.',
    syntax: `${F}bar\nlabel: <what is measured>\nvalue: <whole percentage, 0% to 100%>\nnote: <optional line under the bar>\n${F}`,
    example: `${F}bar\nlabel: 2026 videos about WordPress\nvalue: 60%\nnote: 118K subscribers · 240 WordPress videos in 2026\n${F}`,
    renders: 'Site, preview and reader: the label and value over a bar. Cross-posts: "**60%** label (note)".',
  },
  {
    name: 'facts',
    kind: 'fence',
    purpose: 'A labelled fact table, one "Label: value" per line. Add {bar} after a percentage to draw a small bar in that row.',
    syntax: `${F}facts\n<Label>: <value>\n<Label>: <percentage> {bar}\n${F}`,
    example: `${F}facts\nType: Official and community\nSubscribers: 118K\nAbout WordPress: 60% {bar}\n${F}`,
    renders: 'Site, preview and reader: a two-column table. Cross-posts: a bulleted list with bold labels.',
  },
  {
    name: 'stats',
    kind: 'fence',
    purpose: 'A strip of big numbers with labels, with an optional small caption above. In a directory, the first part of the caption (before a ·) is the entry\'s category.',
    syntax: `${F}stats\ncaption: <optional small line above>\n<value>: <label>\n<value>: <label>\n${F}`,
    example: `${F}stats\ncaption: Official and community · Always included\n118K: subscribers\n60%: of 2026 videos about WordPress\n240: WordPress videos in 2026\n${F}`,
    renders: 'Site, preview and reader: the number strip. Cross-posts: an italic caption and a line of bold figures.',
  },
  {
    name: 'button',
    kind: 'fence',
    purpose: 'A link shown as a button. The label on the first line, an http or https URL on the second. Add the word primary for a filled green button.',
    syntax: `${F}button [primary]\n<label>\n<https URL>\n${F}`,
    example: `${F}button\nSubscribe to @WordPress\nhttps://www.youtube.com/@WordPress?sub_confirmation=1\n${F}`,
    renders: 'Site, preview and reader: an outlined button, or filled with primary. Cross-posts: a plain link.',
  },
  {
    name: 'reveal',
    kind: 'fence',
    purpose: 'A section readers can skip or open. A short summary always shows (an optional weight bar with a legend, and an optional note); the part after --- stays closed until the reader clicks the label. Weights must add up to 100, at most 6 parts. The part after --- takes paragraphs, "- " lists, **bold**, *italic*, `code` and links.',
    syntax: `${F}reveal <label, such as Show the full formula>\nweights: <Name> <number>, <Name> <number>\nnote: <optional line under the bar>\n---\n<what opens on request>\n${F}`,
    example: `${F}reveal Show the full formula\nweights: Focus 40, Volume 20, Reach 20, Engagement 20\nnote: Then **× 0.75** for channels run by plugin or theme companies.\n---\n**Score = 100 × (0.4 × Focus + 0.2 × Volume + 0.2 × Reach + 0.2 × Engagement) × Seller**\n\n- **Focus:** share of 2026 videos about WordPress\n${F}`,
    renders: 'Site, preview and reader: the summary, then a Show and Hide toggle, closed at first. Cross-posts: everything written out open.',
  },
  {
    name: 'audio',
    kind: 'fence',
    purpose: 'Play a recording, such as the podcast version of an article, with the browser\'s own player under a label and its length. The files live on gbti.network under /media/podcasts/ (Opus in an .ogg file first, then an MP3 copy for the browsers that cannot play Opus). Nothing downloads until the reader presses play.',
    syntax: `${F}audio <label...>\nlength: <how long>\nsrc: /media/podcasts/<name>.ogg\nsrc: /media/podcasts/<name>.mp3\n${F}`,
    example: `${F}audio Listen to the podcast version\nlength: 22 minutes\nsrc: /media/podcasts/how-ai-agents-replace-web-dashboards.ogg\nsrc: /media/podcasts/how-ai-agents-replace-web-dashboards.mp3\n${F}`,
    renders: 'Site, preview and reader: the label, the length, then the player. Cross-posts: the label as a link to the MP3 file, with the length.',
  },
  {
    name: 'image layout',
    kind: 'suffix',
    purpose: `Place an image. Add words in braces after the image line: ${IMAGE_LAYOUT_WORDS.join(', ')} (wrap goes with left or right).`,
    syntax: '![alt text](./images/name.webp){<words>}',
    example: '![A dashboard screenshot](./images/dashboard.webp){full}',
    renders: 'Site, preview and reader: the layout. Cross-posts: the image, with the brace words shown as text after it.',
  },
  {
    name: 'list style',
    kind: 'suffix',
    purpose: `Change a list's markers. Add one word in braces to the FIRST item: ${LIST_STYLE_WORDS.join(', ')}.`,
    syntax: '- First item {<word>}',
    example: '1. First step {lower-alpha}\n2. Second step',
    renders: 'Site, preview and reader: the marker style. Cross-posts: a plain list, with the brace word shown as text.',
  },
]);

/** What the MCP tool list_components returns. */
export function listComponents() {
  return {
    components: COMPONENTS.map((c) => ({ ...c })),
    notes: 'Blocks go in the markdown body. A fence is three backticks, the block name, the lines, then three backticks. validate_content warns about a malformed block before you publish.',
  };
}
