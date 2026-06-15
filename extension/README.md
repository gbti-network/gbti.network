# GBTI Network Extension (Chrome)

The Chrome (MV3) delivery of the SOW-006 client. Browse gbti.network as a member and edit your own content in
place; the change opens a pull request through the same SOW-005 gate. The other delivery is the npm server
(`gbti-network`); both run the SAME portable core and the SAME `@gbti/client-ui` web components.

## How it works
- The public Astro build bakes an INERT `<gbti-edit-panel>` (plus `data-gbti-*` hooks) onto each member content
  page (see `src/components/EditHooks.astro`). It does nothing for a normal visitor.
- The **content script** (`dist/content.js`) loads `@gbti/client-ui`, which DEFINES the custom elements, so the
  page's inert tag upgrades and self-activates IF the signed-in member owns the content. Its `GbtiClient` talks
  to the background worker by message passing (no token in the page).
- The **background service worker** (`dist/background.js`) holds the GitHub token in `chrome.storage.local`
  (never exposed to the page), runs the device-flow sign-in, and answers `/api/*` requests by running the
  dispatcher against a GitHub-Contents-API Reader + the shared git client. Editing flows to a fork -> branch ->
  PR, exactly like the npm host.
- There is **no popup**. The toolbar action has no `default_popup`, so clicking the icon fires
  `chrome.action.onClicked` in the background worker, which opens **`onboarding.html`** in a tab (focusing an
  already-open one). A popup closes on focus loss, which discarded the device-flow code the moment the member
  tabbed to GitHub; a tab survives the trip. The page is light, two-column, and mounts the shared
  `<gbti-onboarding>` wizard (sign in -> make your copy -> give access, ONE focused step at a time), plus the
  signed-in identity + a sign-out control.

The SOW-005 gate remains the only authority on what merges; the extension only surfaces what a member may do.

## Build + load
1. `node extension/build.mjs` (bundles `dist/{background,content,onboarding,newtab,shares}.js`; rerun after
   changing the core or client-ui). Also rebuild the UI bundle if it changed: `node client-ui/build.mjs`.
2. Chrome -> Extensions -> Developer mode -> Load unpacked -> select `extension/`.
3. Click the toolbar icon to open the onboarding tab, sign in with GitHub (device flow), then browse a
   gbti.network page you own and click "Edit".

## Distribution (SOW-019)

The site distributes the extension itself, so a visitor can install it without the Chrome Web Store, and the
site can tell whether they already have it.

- **Package:** `npm run build:extension` bundles the extension (it runs `extension/build.mjs` first) and writes
  two committed artifacts under `public/extension/`:
  - `gbti-network-extension.zip`. The loadable file set is DISCOVERED from disk (the manifest, every top-level
    `*.html` page, and every built `dist/*.js` bundle), so a page or bundle added by a later SOW is packaged
    automatically and never hand-listed. The `mcp/` folder is excluded (it is a node bundle, not a browser file).
  - `latest.json` (`{ version, name, zip, webStoreUrl, bytes }`) that the site reads.
  The static build serves both verbatim. The homepage "Add the extension" call to action and the install-aware
  Sign-in modal read the install config from `src/lib/extension.ts` (the Web Store URL when published, else the
  direct zip).
- **Install detection (no extra permission, no extension id):** the content script sets
  `document.documentElement.dataset.gbtiExtension = <manifest version>` and dispatches a `gbti:extension-ready`
  event at `document_idle`. The site reads the attribute; absent means "not installed", which routes the visitor
  to download the extension plus read about member benefits (`/membership/`). Caveat: the content script matches
  the production host only, so detection reads "not installed" on localhost or a preview deploy.
- **Keeping the served zip fresh:** the zip is a committed build artifact, so it can go stale if source changes
  without a repackage. Three guards keep it honest:
  - Run `npm run build:extension` after any change to `extension/src`, `client-ui/src`, or the manifest version,
    and commit `public/extension/`.
  - The deploy command is `npm run build:pages` (`build:extension && astro build && verify:dist`), so production
    rebuilds the zip before every site build and is always current.
  - `npm run check:extension` (a read-only consistency guard, part of `verify:dist`) fails if `latest.json` or
    the zip disagrees with `extension/manifest.json`, and the "Extension build drift" CI job rebuilds from source
    and fails on a stale commit.
- **Web Store:** once the listing is live, set `EXTENSION.webStoreUrl` in `src/lib/extension.ts`. The install
  links and the Sign-in modal then switch from the direct zip to the one-click store install.

## HUMAN-TODO before publishing
- Set `GITHUB_CLIENT_ID` in `src/background.mjs` to the real device-flow OAuth app client id
  (`GBTI_GITHUB_CLIENT_ID`, the same one the npm CLI uses). It is public by design (device flow has no secret).
- Pack + submit to the Chrome Web Store (review + the host-permission justification for gbti.network +
  api.github.com + github.com).
- (Lifecycle hardening, recommended) Consider a GitHub App with fine-grained, auto-expiring installation
  tokens (contents + pull_requests on the one content repo) instead of the classic OAuth device flow. The
  device-flow token is long-lived and cannot be revoked from the extension (no client secret), so sign-out
  clears local storage only. See `human-todo.md`.

## Security model (verified by the SOW-006 P6 adversarial threat-model pass)
- The token lives ONLY in the background worker's `chrome.storage.local`; the page and content script never
  read it (they message the worker). MV3 isolated worlds keep the page's own JS away from the extension. The
  manifest has NO `externally_connectable` and NO `web_accessible_resources`, so a web page cannot message the
  worker or load the bundles. (P6: token-isolation dimension verified clean end to end.)
- Least privilege: the device flow requests only `public_repo read:user` (the content repo is public, so this
  is enough to fork it, push to the member's own fork, and open a PR). It does NOT request account-wide `repo`.
- Privilege is re-derived worker-side from the worker-held identity, never trusted from a message: publish
  forces `author`/`username` to the signed-in user, strips system-managed fields, and rejects out-of-folder /
  traversal paths. The dispatcher exposes NO `/api/admin` route. The SOW-005 gate remains the merge authority.
- Every member/worker-supplied value is `esc()`-escaped before innerHTML (components, onboarding tab); the markdown
  preview HTML-escapes first and only linkifies `https?://`, so no `javascript:`/attribute-breakout XSS.
- Host permissions are scoped to `gbti.network`, `api.github.com`, `github.com` (device flow); content scripts
  match only `https://gbti.network/*`.
- The inert page hooks expose only the content path/type/slug/owner, all already public (the repo is public).

## The `mcp/` folder (SOW-025): a Claude Code MCP server that ships in this folder

`extension/mcp/gbti-network-mcp.mjs` is a self-contained NODE bundle of the GBTI stdio MCP server. It ships in
the extension folder so a member who installs the extension already has it on disk. Key points:

- **Chrome never loads or runs it.** It is NOT in `manifest.json`, NOT in `web_accessible_resources`, and not
  referenced by any extension page. It is inert to the browser, exactly like a README that happens to sit in
  the folder. It adds no browser attack surface.
- **Claude Code runs it from disk**, as a normal local stdio MCP server: `node extension/mcp/gbti-network-mcp.mjs`.
  See the install guide at `/prompts/install-gbti-network-from-extension/`.
- **Auth is the SAME shared GitHub device-flow app** the extension uses (one OAuth app, no second login). The
  `login` + `login_confirm` MCP tools sign in and write the token to the local config store
  (`~/.config/gbti-network/`); the server reads it on every run. So once signed in, the member can publish
  **with Chrome closed** (the MCP does not depend on the extension at runtime; the extension is just the
  delivery vehicle). The token is held by the node process, never by a Chrome surface.
- **No new privilege.** The MCP uses the GitHub REST API (fork -> put file -> open PR), never local `git`. The
  SOW-005 gate stays the merge authority: a directly-held `public_repo` token can only PROPOSE a PR to the
  member's own folder, never merge to the canonical repo. Publishing is paid-only (SOW-011), enforced server
  side. Rebuild it with `node extension/build.mjs` (it is emitted alongside the `dist/*.js` bundles).
