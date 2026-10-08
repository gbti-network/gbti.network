// The Discord channel pickers (Share to our channels on a news story, Syndicate now on member content), in the order
// Discord's own sidebar shows the guild: channels with no category first, then each category in turn, its channels
// under it. A superadmin looking for #energy finds it where they would in Discord, under its category, instead of in
// one long list in whatever order the API returned. Pure, so it is node-tested.
//
// The order is Discord's: `position` within each list, ties broken by id (a snowflake, so older first). The Worker
// passes `position` through; a list cached before it did has none, and then every position counts as equal and the
// id decides, which is creation order. Only text and announcement channels are pickable; a category is a heading.
const TEXT = new Set([0, 5]);
const CATEGORY = 4;
const pos = (c) => (Number.isFinite(c?.position) ? c.position : 0);
// Snowflakes are numeric strings longer than a safe integer, so compare by length, then by text.
const byId = (a, b) => {
  const x = String(a?.id ?? ''); const y = String(b?.id ?? '');
  return x.length - y.length || (x < y ? -1 : x > y ? 1 : 0);
};
const byOrder = (a, b) => pos(a) - pos(b) || byId(a, b);
const escHtml = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * The guild's pickable channels in sidebar order, each carrying `category` (its category's name, or null). A channel
 * whose category is missing from the list goes with the uncategorized ones rather than vanishing. A category with no
 * pickable channel produces nothing. Does not mutate the input.
 */
export function orderDiscordChannels(channels) {
  const all = Array.isArray(channels) ? channels.filter(Boolean) : [];
  const cats = all.filter((c) => c.type === CATEGORY).sort(byOrder);
  const text = all.filter((c) => TEXT.has(c.type)).sort(byOrder);
  const catIds = new Set(cats.map((c) => String(c.id)));
  const out = text.filter((c) => !c.parentId || !catIds.has(String(c.parentId))).map((c) => ({ ...c, category: null }));
  for (const cat of cats) {
    const name = String(cat.name || '');
    for (const c of text) if (c.parentId && String(c.parentId) === String(cat.id)) out.push({ ...c, category: name });
  }
  return out;
}

/**
 * The <option> markup for an ordered list: uncategorized channels as plain options at the top (Discord gives them no
 * heading either), then one <optgroup> per category. Consecutive channels of one category share a group, so pass the
 * list orderDiscordChannels returned. A channel with no `category` field is uncategorized, which is how a plain list
 * of channels renders as before.
 */
export function discordChannelOptionsHtml(list, selected = '') {
  const opt = (c) => `<option value="${escHtml(c.id)}"${String(c.id) === String(selected) ? ' selected' : ''}>#${escHtml(c.name)}</option>`;
  let html = '';
  let open = null;
  for (const c of Array.isArray(list) ? list : []) {
    const cat = c?.category || null;
    if (cat !== open) {
      if (open !== null) html += '</optgroup>';
      if (cat !== null) html += `<optgroup label="${escHtml(cat)}">`;
      open = cat;
    }
    html += opt(c);
  }
  if (open !== null) html += '</optgroup>';
  return html;
}
