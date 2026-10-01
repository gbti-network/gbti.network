// The WorkBench element as ONE text: gbti-workspace.mjs, then the two modules it was split into at the 900-line
// limit (owner, 2026-09-30), workspace-css.mjs (the stylesheet) and workspace-data.mjs (the loaders, the caches, the
// scope helpers and the pull request status poll). A test that read only the element would quietly stop seeing every
// line that moved: a check that something is ABSENT would pass on nothing. Read the workspace through this instead
// of by path. The size ratchet in test/profile-editing.test.mjs still measures the element file alone.
//
// Not a test file (no .test. in the name), so the test runner never runs it on its own.
import fs from 'node:fs';

const ROOT = new URL('../../', import.meta.url);

/** The workspace's files: the element first, then its two modules in the order it imports them. */
export const WORKSPACE_FILES = [
  'client-ui/src/elements/gbti-workspace.mjs',
  'client-ui/src/elements/workspace-css.mjs',
  'client-ui/src/elements/workspace-data.mjs',
];

/** Every workspace file, joined in order. Throws if the chain between them is broken, so no guard reads a stale file. */
export function workspaceSource() {
  const [el, css, data] = WORKSPACE_FILES.map((f) => fs.readFileSync(new URL(f, ROOT), 'utf8'));
  if (!el.includes("import { WORKSPACE_CSS as CSS } from './workspace-css.mjs';") || !el.includes('this.set(this.css(CSS) + ')) {
    throw new Error('workspace-source: gbti-workspace.mjs no longer paints workspace-css.mjs, so the stylesheet read here may not be what it ships');
  }
  if (!el.includes("import { withWorkspaceData } from './workspace-data.mjs';") || !el.includes('class GbtiWorkspace extends withWorkspaceData(GbtiElement) {')) {
    throw new Error('workspace-source: gbti-workspace.mjs no longer extends withWorkspaceData, so workspace-data.mjs may not be what it runs');
  }
  if (!css.includes('export const WORKSPACE_CSS = `') || !data.includes('export const withWorkspaceData = (Base) => class extends Base {')) {
    throw new Error('workspace-source: a split module no longer exports what the element imports');
  }
  return [el, css, data].join('\n');
}
