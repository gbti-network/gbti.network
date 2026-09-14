// SOW-019: Chrome extension distribution config, single-sourced for the site. sow-244: the Chrome Web Store is the
// ONLY public install (owner, 2026-08-16), so there is no fallback path and no "is it listed yet" switch. The
// package zip built by `npm run build:extension` is still served, for one reason: it carries the MCP server, and the
// WorkBench MCP guide (/workbench/mcp/) offers it for that. The site detects an installed extension via the
// content-script marker (document.documentElement.dataset.gbtiExtension); see SOW-019.
import { WEB_STORE_URL } from './extension-store.mjs';

export const EXTENSION = {
  name: 'GBTI Network',
  /** Mirrors public/extension/latest.json (written by `npm run build:extension`). */
  version: '0.4.0',
  /** The Chrome Web Store listing, from src/lib/extension-store.mjs (shared with the packager). */
  webStoreUrl: WEB_STORE_URL,
  /** The install page: what the extension does, and the store button. */
  pageUrl: '/extension/',
  /** The extension PACKAGE, offered only by the MCP guide, for the MCP server inside it. Not an install path. */
  zipUrl: '/extension/gbti-network-extension.zip',
} as const;

/** The "get the extension" link: the Chrome Web Store listing. */
export const extensionInstallUrl: string = EXTENSION.webStoreUrl;
/** The package zip, for the MCP guide's "download the extension package" step (the MCP server ships inside it). */
export const extensionZipUrl: string = EXTENSION.zipUrl;
