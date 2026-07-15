// SOW-121: KV persistence for the Social Queue manual-assist tasks. Keys in SIGNUP_KV (prefix-namespaced
// like synd:item: / activity:):
//   social:task:<id>   one manual-assist task (JSON). A DONE task gets a ~30-day TTL so history self-prunes;
//                      a PENDING task has NO TTL (it must survive until a superadmin posts it by hand).
// Pure over an injected kv, so it is unit-tested with a fake KV (no network, no secrets).

export const SOCIAL_TASK_KEY = (id) => `social:task:${id}`;
const DONE_TTL_SECONDS = 30 * 24 * 60 * 60;
const PREFIX = 'social:task:';

export async function getTask(kv, id) {
  if (!kv || !id) return null;
  try { return await kv.get(SOCIAL_TASK_KEY(id), 'json'); } catch { return null; }
}

export async function putTask(kv, task) {
  if (!kv || !task?.id) return task;
  const opts = task.status === 'done' ? { expirationTtl: DONE_TTL_SECONDS } : undefined;
  await kv.put(SOCIAL_TASK_KEY(task.id), JSON.stringify(task), opts);
  return task;
}

export async function deleteTask(kv, id) {
  if (!kv || !id) return;
  try { await kv.delete(SOCIAL_TASK_KEY(id)); } catch { /* best-effort */ }
}

/** All tasks (pending + done) via a KV prefix list, capped. */
export async function listTasks(kv, { limit = 500 } = {}) {
  if (!kv?.list) return [];
  const out = [];
  let cursor;
  for (let page = 0; page < 1000 && out.length < limit; page++) {
    const res = await kv.list({ prefix: PREFIX, cursor });
    for (const k of res?.keys ?? []) {
      const t = await getTask(kv, k.name.slice(PREFIX.length));
      if (t) out.push(t);
      if (out.length >= limit) break;
    }
    if (res?.list_complete || !res?.cursor) break;
    cursor = res.cursor;
  }
  return out;
}
