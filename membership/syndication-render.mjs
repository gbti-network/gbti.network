// SOW-121: the shared per-channel text builder. Produces the exact message a channel would post or queue:
// an already-sanitized manual override wins, else the configured channel template (stub-aware for a
// members-only item), else the generic "{title} {url}", rendered over the item and truncated to the channel
// cap. It is reused by the X adapter (SOW-120) AND the manual-assist enqueue paths (the drain + the manual
// Publish, SOW-121), so a Social Queue task carries the SAME text that would have auto-posted. Pure (no IO).
import { templateFor } from './syndication-config-core.mjs';
import { renderTemplate, buildChannelText } from './syndication-format.mjs';
import { channelLimit } from './syndication-channels.mjs';

export function renderChannelText(cfg, item = {}, channel, { textOverride } = {}) {
  const limit = channelLimit(channel);
  if (typeof textOverride === 'string' && textOverride.trim()) return textOverride.slice(0, limit);
  const stubish = item.membersOnly === true || String(item.visibility || '') === 'members';
  const text = cfg
    ? renderTemplate(templateFor(cfg, item.source, channel, { stub: stubish, channelOnly: true }) || '{title} {url}', item, { limit })
    : buildChannelText(item, { limit });
  return String(text || '').slice(0, limit);
}
