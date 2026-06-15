#!/usr/bin/env node
// Wire the standalone utility apps (copied into public/tools/) so they load their own CSS/JS when
// served directly. In WordPress these assets were enqueued by each tool's loader.php; served
// standalone, the index.html must reference them itself. Order mirrors each loader.php. Idempotent.
//   node scripts/wire-tools.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(fileURLToPath(import.meta.url), '../..');
const MARK = '<!-- gbti-wired -->';

const TOOLS = {
  'email-signature-generator': {
    css: ['css/common.css', 'css/form.css', 'css/icons.css'],
    // template-selector falls back to relative paths when this is absent/empty.
    headScript: 'window.EmailSignatureGeneratorConfig = { toolBaseUrl: "" };',
    js: [
      'js/debug.js', 'js/svg-utils.js', 'js/config.js', 'js/template-selector.js',
      'js/social-media-repeater.js', 'js/social-icons.js', 'js/dark-mode.js', 'js/image-handlers.js',
      'js/exporting/image-processing.js', 'js/exporting/social-media-handlers.js', 'js/exporting/usage-tracking.js',
      'js/exporting/download-buttons.js', 'js/exporting/export-file-html.js', 'js/exporting/preview-export.js',
      'js/jzip.min.js', 'js/download-utils.js', 'js/reset-handler.js', 'js/controls.js',
      'templates/classic/register.js', 'templates/modern/register.js', 'templates/minimalist/register.js',
      'templates/banner-top/register.js', 'templates/professional/register.js', 'templates/sidebar/register.js',
    ],
  },
  'js-animate-hue': {
    css: ['styles/main.css'],
    headScript: '',
    js: [
      'inline-modules/colorUtils.js', 'inline-modules/imageProcessor.js', 'inline-modules/animator.js',
      'inline-modules/hueSelector.js', 'inline-modules/presets.js', 'inline-modules/animateHueApp.js', 'loader.js',
    ],
  },
};

for (const [tool, cfg] of Object.entries(TOOLS)) {
  const dir = path.join(ROOT, 'public/tools', tool);
  const file = path.join(dir, 'index.html');
  if (!fs.existsSync(file)) { console.log(`! ${tool}: index.html missing, skipped`); continue; }
  let html = fs.readFileSync(file, 'utf8');
  if (html.includes(MARK)) { console.log(`= ${tool}: already wired`); continue; }

  const exists = (rel) => fs.existsSync(path.join(dir, rel));
  const cssTags = cfg.css.filter((c) => exists(c) && !html.includes(`"${c}"`)).map((c) => `    <link rel="stylesheet" href="${c}">`);
  const head = cfg.headScript ? `    <script>${cfg.headScript}</script>` : '';
  const jsTags = cfg.js.filter((j) => exists(j) && !html.includes(`"${j}"`)).map((j) => `    <script src="${j}"></script>`);

  html = html.replace('</head>', `${[...cssTags, head].filter(Boolean).join('\n')}\n    ${MARK}\n</head>`);
  html = html.replace('</body>', `${jsTags.join('\n')}\n</body>`);
  fs.writeFileSync(file, html);
  console.log(`+ ${tool}: wired ${cssTags.length} css, ${jsTags.length} js`);
}
