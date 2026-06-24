// @gbti/client-ui entry (SOW-006 v2). Importing this DEFINES every GBTI custom element (idempotent, guarded
// for non-DOM envs) and re-exports the host wiring. Both hosts do the same two things:
//   import { setClient, mountApp } from '@gbti/client-ui';  // (or load the bundled file)
//   setClient(theClientForThisHost);                        // fetch adapter (npm) or messaging adapter (extension)
// then either mountApp(target) for the full CMS, or place a <gbti-edit-panel> on the page for inline editing.
//
// The public Astro site embeds the same tags (e.g. <gbti-edit-panel>) WITHOUT importing this module, so they
// stay inert for a visitor; only a host that loads this bundle upgrades + activates them.

import './elements/gbti-auth.mjs';
import './elements/gbti-block-editor.mjs'; // SOW-062 P4: the block body editor (used by the content editor)
import './elements/gbti-content-editor.mjs';
import './elements/gbti-content-list.mjs';
import './elements/gbti-pr-list.mjs';
import './elements/gbti-contrib-inbox.mjs';
import './elements/gbti-contrib-review.mjs';
import './elements/gbti-members-portal.mjs';
import './elements/gbti-settings.mjs';
import './elements/gbti-account.mjs';
import './elements/gbti-admin.mjs';
import './elements/gbti-superadmin-dashboard.mjs';
import './elements/gbti-category-manager.mjs'; // SOW-055: superadmin category manager
import './elements/gbti-syndication-tracker.mjs'; // SOW-058: superadmin syndication tracker
import './elements/gbti-edit-panel.mjs';
import './elements/gbti-locked-content.mjs';
import './elements/gbti-favorite.mjs';
import './elements/gbti-collection.mjs';
import './elements/gbti-subscribe.mjs';
import './elements/gbti-share-composer.mjs';
import './elements/gbti-shares-feed.mjs';
import './elements/gbti-shares.mjs';
import './elements/gbti-lock-gate.mjs';
import './elements/gbti-comment-box.mjs';
import './elements/gbti-onboarding.mjs';
import './elements/gbti-welcome.mjs';
import './elements/gbti-workspace.mjs';
import './elements/gbti-saved.mjs';
import './elements/gbti-subscriptions.mjs';
import './elements/gbti-topic-picker.mjs'; // SOW-054: the followed-topics control (onboarding + settings)
import './elements/gbti-card-list.mjs';
import './elements/gbti-activity-bell.mjs';
import './elements/gbti-news.mjs';
import './elements/gbti-news-reader.mjs'; // SOW-046 G: the in-extension expanded news view (opened from the feed)
import './elements/gbti-discussion.mjs';
import './elements/gbti-reader.mjs';
import './elements/gbti-browse.mjs';
import './elements/gbti-app.mjs';

export { setClient, getClient, getIdentity } from './base.mjs';
export { createHttpClient, GbtiClientError } from './client.mjs';
export { coerceValue, gatherInput } from './form.mjs';
export { readHooks, canEditInPlace, toPublishPayload } from './inline.mjs';

/** Mount the full CMS app into a target element (the npm host's served page). */
export function mountApp(target) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('gbti-app');
  target.replaceChildren(el);
  return el;
}

/** Mount the inline editor on the current page (the extension content script). Returns the panel element. */
export function mountInlineEditor(opts = {}) {
  if (typeof document === 'undefined') return null;
  const el = document.createElement('gbti-edit-panel');
  if (opts.path) el.dataset.gbtiPath = opts.path;
  if (opts.type) el.dataset.gbtiType = opts.type;
  if (opts.slug) el.dataset.gbtiSlug = opts.slug;
  if (opts.owner) el.dataset.gbtiOwner = opts.owner;
  (opts.into || document.body).appendChild(el);
  return el;
}
