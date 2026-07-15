// SOW-121: pure helpers for the Social Queue (the superadmin manual-assist syndication worklist). A task is
// created when a manual-assist channel (e.g. X, after its free API tier was deprecated) would otherwise
// auto-post OR when a superadmin hits "Manually Syndicate" to that channel. The system stores the rendered,
// public-safe message text; a human posts it by hand through the free web composer, then marks it done. No IO
// here (the KV store lives in workers/signup/social-queue-store.mjs); these are node-testable.

/**
 * Build a manual-assist task from a queue item + the rendered channel text. The id is stable per item+channel
 * so a re-enqueue overwrites rather than duplicates. `trigger` records whether the drain (auto-eligible) or a
 * superadmin (manual) created it. Only PUBLIC metadata + the already-rendered text ride along (a members-only
 * item is rendered as its stub upstream), so there is no body-leak risk.
 */
export function buildSocialTask({ item = {}, channel, text, trigger = 'auto', now } = {}) {
  const at = Number(now) || 0;
  const itemId = item.id ? String(item.id) : null;
  return {
    id: `${itemId ?? String(item.targetSlug ?? '')}::${channel}`,
    itemId,
    channel: String(channel || ''),
    source: item.source || null,
    author: item.author || null,
    title: item.title || null,
    url: item.url || null,
    text: String(text || ''),
    trigger: trigger === 'manual' ? 'manual' : 'auto',
    createdAt: at,
    status: 'pending',
    doneAt: null,
    doneBy: null,
  };
}

/**
 * Apply a superadmin action to a task. Returns { task, remove, ok }: `done` stamps doneAt/doneBy and keeps it
 * (it moves into the completed history); `delete` signals the store to remove the key. An unknown action or a
 * missing task is a no-op (ok:false).
 */
export function applyTaskAction(task, action, actor = {}, now = 0) {
  if (!task) return { task: null, remove: false, ok: false };
  const at = Number(now) || 0;
  const who = actor.githubId ? String(actor.githubId) : (actor.login ? String(actor.login) : null);
  if (action === 'delete') return { task: null, remove: true, ok: true };
  if (action === 'done') return { task: { ...task, status: 'done', doneAt: at, doneBy: who }, remove: false, ok: true };
  return { task, remove: false, ok: false };
}

/** Split a task list into { pending (newest created first), done (newest completed first) }. Pure. */
export function splitTasks(tasks) {
  const arr = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  const pending = arr.filter((t) => t.status === 'pending').sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  const done = arr.filter((t) => t.status === 'done').sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  return { pending, done };
}
