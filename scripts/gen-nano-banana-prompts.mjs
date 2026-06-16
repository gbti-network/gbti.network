// One-off generator: convert the 15 headshot prompts from Naresh's article into prompt content items
// under members/nareshdevineni/prompts/, each carrying its result image (image-gen `image` field) and a
// from-the-author intro comment. Idempotent: rewrites the target folders each run. Not wired into CI.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARTICLE = path.join(ROOT, 'members/nareshdevineni/posts/15-nano-banana-prompts-for-generating-linkedin-headshots/index.md');
const SRC_IMG = path.join(ROOT, 'members/nareshdevineni/posts/15-nano-banana-prompts-for-generating-linkedin-headshots/images');
const PROMPTS = path.join(ROOT, 'members/nareshdevineni/prompts');
const COMMENTS = path.join(ROOT, 'members/nareshdevineni/comments');
const DATE = '2025-10-07';
const SOURCE_URL = 'https://gbti.network/articles/15-nano-banana-prompts-for-generating-linkedin-headshots/';

// Per-prompt metadata (in article order). image = source filename in the article's images/ folder.
const ITEMS = [
  { n: 1, label: 'black-suit-light-blue-shirt-navy-tie', title: 'Black Suit, Light Blue Shirt, Navy Tie', desc: 'a black suit jacket, light blue dress shirt, and dark navy tie against a softly blurred bookshelf', image: 'A-man-inside-a-books-library-1.webp' },
  { n: 2, label: 'beige-blazer-cream-turtleneck', title: 'Beige Blazer and Cream Turtleneck', desc: 'a tan textured blazer over a cream turtleneck on a warm peachy-beige background', image: 'Gemini_Generated_Image_lcu807lcu807lcu8-1-1.webp' },
  { n: 3, label: 'charcoal-blazer-white-open-collar', title: 'Charcoal Blazer, White Open Collar', desc: 'a charcoal blazer over a white open-collar shirt on a clean light gray background', image: 'A-person-wearing-a-charcoal-blazer-over-white-dress-shirt-with-open-collar-1.webp' },
  { n: 4, label: 'cream-blazer-warm-bokeh', title: 'Cream Blazer with Warm Bokeh', desc: 'a beige/cream blazer over a white button-down against warm golden bokeh lights', image: 'A-person-wearing-a-beige-cream-blazer-over-a-white-collared-button-down-shirt-with-buttons-visible-1.webp' },
  { n: 5, label: 'light-gray-blazer-striped-shirt', title: 'Light Gray Blazer, Striped Shirt', desc: 'a light gray blazer over a navy and white horizontal striped shirt on a neutral background', image: 'A-person-wearing-a-light-gray-blazer-over-a-navy-blue-and-white-horizontal-striped-shirt-1.webp' },
  { n: 6, label: 'tan-blazer-arms-crossed', title: 'Tan Blazer, Arms Crossed', desc: 'a tan blazer over a white collared shirt, arms crossed, on a neutral background', image: 'A-person-wearing-a-tan-blazer-over-white-collared-shirt-1.webp' },
  { n: 7, label: 'black-blazer-white-open-collar', title: 'Black Blazer, White Open Collar', desc: 'a black blazer over a white open-collar shirt on a clean white/light gray background', image: 'Gemini_Generated_Image_pf8n7kpf8n7kpf8n-1-1.webp' },
  { n: 8, label: 'burnt-orange-mandarin-collar', title: 'Burnt Orange Mandarin Collar Shirt', desc: 'a rust/burnt orange mandarin-collar shirt on a solid peachy-orange background', image: 'A-person-wearing-a-burnt-orange-button-down-shirt-with-mandarin-collar-and-white-buttons-1.webp' },
  { n: 9, label: 'navy-blazer-dark-background', title: 'Navy Blazer on a Dark Background', desc: 'a dark navy blazer over a blue-gray crew tee with dimensional side lighting on a dark background', image: 'A-person-wearing-a-dark-navy-blue-blazer-over-a-light-blue-gray-crew-neck-t-shirt-1.webp' },
  { n: 10, label: 'light-gray-suit-checkered-tie-greenery', title: 'Light Gray Suit, Checkered Tie, Greenery', desc: 'a light gray suit with a checkered tie against blurred outdoor greenery', image: 'A-person-wearing-a-light-gray-suit-jacket-with-white-dress-shirt-and-gray-and-white-diagonal-checkered-pattern-tie-1.webp' },
  { n: 11, label: 'pale-yellow-button-down', title: 'Pale Yellow Button-Down', desc: 'a pale yellow button-down over a navy tee on a dark slate blue-gray background', image: 'A-person-wearing-a-pale-yellow-button-down-shirt-with-chest-1.webp' },
  { n: 12, label: 'light-blue-suit-anchor-tie-office', title: 'Light Blue Suit, Anchor Tie, Office', desc: 'a light blue suit with an anchor-pattern navy tie in a blurred indoor office', image: 'Gemini_Generated_Image_o0pv5no0pv5no0pv-1-1.webp' },
  { n: 13, label: 'dark-gray-textured-suit-dotted-tie', title: 'Dark Gray Textured Suit, Dotted Tie', desc: 'a dark gray textured suit with a small-dot navy tie against a blurred corporate building', image: 'A-person-wearing-a-dark-gray-textured-suit-with-light-blue-dress-shirt-and-navy-blue-tie-with-small-dot-pattern-1.webp' },
  { n: 14, label: 'mustard-yellow-hoodie', title: 'Mustard Yellow Hoodie', desc: 'a relaxed mustard yellow hoodie on a solid mustard background', image: 'A-person-wearing-a-mustard-yellow-hoodie-with-drawstrings-1.webp' },
  { n: 15, label: 'chartreuse-top-orange-backdrop', title: 'Chartreuse Top, Bright Orange Backdrop', desc: 'a bold chartreuse casual top against a vibrant orange studio backdrop (the highly detailed favorite)', image: 'Professional-Headshot-Generation-1.webp' },
];

const article = fs.readFileSync(ARTICLE, 'utf8');

// Extract each "### Prompt N: ..." section's prompt body (everything up to the expected-result image / trailer).
function extractBody(n) {
  const re = new RegExp(`### Prompt ${n}:[^\\n]*\\n([\\s\\S]*?)(?=\\n### Prompt |\\n## |$)`);
  const m = article.match(re);
  if (!m) throw new Error(`could not find Prompt ${n} in the article`);
  let body = m[1];
  // Cut the trailing "Expected result..." / "This prompt was generated..." prose + result image.
  body = body.split(/\n(?:Expected result from Nano Banana:|This prompt was generated)/)[0];
  // Normalize en/em dashes to commas per writing-ops, collapse extra blank lines, trim.
  body = body.replace(/\s+[–—]\s+/g, ', ').replace(/\n{3,}/g, '\n\n').trim();
  return body;
}

const yamlEsc = (s) => String(s).replace(/"/g, '\\"');

function writePrompt(item) {
  const slug = `nano-banana-headshot-${item.label}`;
  const dir = path.join(PROMPTS, slug);
  fs.mkdirSync(path.join(dir, 'images'), { recursive: true });
  fs.copyFileSync(path.join(SRC_IMG, item.image), path.join(dir, 'images', 'result.webp'));

  const body = extractBody(item.n);
  const shortDescription = `A Nano Banana prompt for a realistic professional LinkedIn headshot: ${item.desc}.`;
  const exampleOutput = `A realistic head-and-chest LinkedIn headshot featuring ${item.desc}, evenly lit and facing the camera.`;
  const fm = [
    '---',
    'type: prompt',
    `title: "Nano Banana Headshot: ${yamlEsc(item.title)}"`,
    `slug: ${slug}`,
    `shortDescription: "${yamlEsc(shortDescription)}"`,
    'author: nareshdevineni',
    'status: published',
    'visibility: public',
    'categories: ["ai"]',
    'tags: ["headshot", "linkedin", "portrait", "nano-banana"]',
    'targets: ["Nano Banana"]',
    'image: "./images/result.webp"',
    `exampleOutput: "${yamlEsc(exampleOutput)}"`,
    `sourceUrl: "${SOURCE_URL}"`,
    `publishedAt: ${DATE}`,
    '---',
    '',
    'Upload a clear, well-lit photo of yourself to Nano Banana (from the chat box of Google Gemini or Google AI Studio), then paste the prompt below.',
    '',
    body,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'index.md'), fm);

  // From-the-author intro comment (required for a published prompt, SOW-014).
  const intro = [
    '---',
    'type: comment',
    `id: intro-${slug}`,
    'author: nareshdevineni',
    'targetType: prompt',
    `targetSlug: ${slug}`,
    'status: published',
    'visibility: public',
    `createdAt: ${DATE}`,
    '---',
    '',
    `This is the ${item.title.toLowerCase()} look from my set of LinkedIn headshot prompts. Upload a clear photo, paste the prompt, and Nano Banana keeps your face while restyling the outfit, lighting, and background into ${item.desc}. If the first result drifts, regenerate once or twice; small tweaks to the background line have the biggest effect.`,
    '',
  ].join('\n');
  fs.writeFileSync(path.join(COMMENTS, `intro-${slug}.md`), intro);
  return slug;
}

// Remove the earlier hand-made sample (now superseded by the uniform set) so there is no stray slug.
const OLD = 'nano-banana-headshot-black-suit-blue-shirt-navy-tie';
fs.rmSync(path.join(PROMPTS, OLD), { recursive: true, force: true });
fs.rmSync(path.join(COMMENTS, `intro-${OLD}.md`), { force: true });

const made = ITEMS.map(writePrompt);
console.log(`Generated ${made.length} prompts:\n  ${made.join('\n  ')}`);
