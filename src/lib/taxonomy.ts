// Canonical taxonomy access (SOW-012). Loads house/taxonomy.yml once and exposes label/path helpers
// shared by every content type (posts, products, prompts). The same tree validates `categories` in
// scripts/validate-content.mjs, so the site and CI never disagree on what a valid category is.
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

interface TaxNode {
  label: string;
  children?: Record<string, TaxNode>;
}
interface TaxFile {
  tree: Record<string, TaxNode>;
}

const file = path.resolve(process.cwd(), 'house/taxonomy.yml');
const TREE: Record<string, TaxNode> = (yaml.load(fs.readFileSync(file, 'utf8')) as TaxFile)?.tree ?? {};

// Flat key -> label map (keys are unique across the tree).
const LABELS: Record<string, string> = {};
(function walk(nodes: Record<string, TaxNode>) {
  for (const [key, node] of Object.entries(nodes)) {
    LABELS[key] = node.label ?? key;
    if (node.children) walk(node.children);
  }
})(TREE);

/** Display label for a single category key (falls back to the key). */
export function categoryLabel(key: string): string {
  return LABELS[key] ?? key;
}

/** The most specific (leaf) label for a category path, e.g. ["devops","accessibility"] -> "Accessibility". */
export function leafLabel(pathArr: string[] | undefined): string {
  if (!pathArr?.length) return '';
  return categoryLabel(pathArr[pathArr.length - 1]);
}

/** Breadcrumb labels for a path, e.g. ["devops","frameworks","wordpress"] -> ["DevOps","Frameworks","WordPress"]. */
export function breadcrumb(pathArr: string[] | undefined): string[] {
  return (pathArr ?? []).map(categoryLabel);
}

/** The top-level key of a path (used for grouping + directory filters), or '' if uncategorized. */
export function topKey(pathArr: string[] | undefined): string {
  return pathArr?.[0] ?? '';
}

/** Distinct top-level categories present across a set of paths, as {key,label}, sorted by label. */
export function topLevelCategories(paths: (string[] | undefined)[]): { key: string; label: string }[] {
  const keys = [...new Set(paths.map((p) => p?.[0]).filter((k): k is string => !!k))];
  return keys.map((k) => ({ key: k, label: categoryLabel(k) })).sort((a, b) => a.label.localeCompare(b.label));
}

/** True if a category path exists in the tree (each segment a child of the previous). Empty = allowed. */
export function isValidPath(pathArr: string[] | undefined): boolean {
  if (!pathArr?.length) return true;
  let level: Record<string, TaxNode> | undefined = TREE;
  for (const seg of pathArr) {
    if (!level || !level[seg]) return false;
    level = level[seg].children;
  }
  return true;
}

export const TAXONOMY_TREE = TREE;
