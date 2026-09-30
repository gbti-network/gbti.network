// The WorkBench preview as ONE text: the page, then its script modules in the order they run. The page script moved
// out of src/pages/workbench/preview.astro into src/lib/preview-page.ts (the render) and src/lib/preview-edit.ts (edit
// in place) at the 900-line limit (owner, 2026-09-30), and a test that read only the page would quietly stop seeing
// every line that moved: a check that something is ABSENT would pass on nothing. Read the preview through this
// instead of by path.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** The preview's files, in the order the script runs through them. */
export const PREVIEW_FILES = ['src/pages/workbench/preview.astro', 'src/lib/preview-page.ts', 'src/lib/preview-edit.ts'];

/** Every preview file, joined in order. Throws if the chain between them is broken, so no guard reads a stale file. */
export function previewSource() {
  const [page, render, edit] = PREVIEW_FILES.map((f) => fs.readFileSync(new URL(f, ROOT), 'utf8'));
  if (!page.includes("import { initWorkbenchPreview } from '../../lib/preview-page';") || !/^\s*initWorkbenchPreview\(\);/m.test(page)) {
    throw new Error('preview-source: preview.astro no longer runs initWorkbenchPreview, so the modules read here may not be what the page ships');
  }
  if (!render.includes("from './preview-edit';") || !/^\s*await initPreviewEdit\(\{/m.test(render)) {
    throw new Error('preview-source: preview-page.ts no longer hands over to initPreviewEdit, so preview-edit.ts may not be what the page ships');
  }
  return [page, render, edit].join('\n');
}
