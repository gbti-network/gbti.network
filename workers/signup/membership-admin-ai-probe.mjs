// sow-493: POST /membership/admin/ai-probe (superadmin). Runs ONE Workers AI text call against a fixed sample story
// and returns the model's raw reply, the text aiText read from it, and what the real caller would have parsed.
//
// Why it exists. Every AI caller in this Worker fails soft, by design, so a model that answers in a shape we do not
// read, or spends its whole budget reasoning, looks exactly like a model that is down: keyword categories, no
// summary, no tags. The only machine credential on hand cannot call Workers AI or read the Worker's logs, so before
// this route there was no way to see a reply at all. Cloudflare retires models on a schedule (the 2026-11-20 notice
// was the first), and each replacement has to be proven against the real binding before production news uses it.
// This route is that proof, and it touches nothing: no KV write, no stored story, no setting.
//
// Bounds. Superadmin only (the fail-closed mirror gate). The model must look like a Workers AI text model id. The
// token budget is capped, and only the handful of parameters a text call takes are passed through.

import { authorizeSuperadmin } from './membership-admin.mjs';
import { aiText, aiTextInput, AI_TEXT_MODEL } from '../../membership/ai-text.mjs';
import { buildMessages, normalizeLabel, buildAnalysisMessages, parseAnalysis } from './news/src/classify.mjs';
import { buildTagMessages, normalizeSuggestedTags } from './topic-suggest.mjs';

export const PROBE_MAX_TOKENS = 1024;
const RAW_CHARS = 6000;
const MODEL_RE = /^@cf\/[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9._-]*$/i;

// One fixed story, so two probes differ only in the model or the settings under test.
const SAMPLE = {
  title: 'Kubernetes 1.36 ships a new scheduler and drops the legacy in-tree cloud providers',
  summary: 'The release moves cluster autoscaling hints into the scheduler and removes the last in-tree cloud provider code.',
  contentText: 'Kubernetes 1.36 is out. The headline change is a rewritten scheduler that reads autoscaling hints directly, '
    + 'so pods land on nodes the autoscaler is about to add rather than waiting for them. The release also removes '
    + 'the remaining in-tree cloud provider code; clusters must run the external cloud controller managers.',
};

const TASKS = {
  classify: { messages: () => buildMessages(SAMPLE), budget: 64, parse: (text) => ({ label: normalizeLabel(text) }) },
  analyze: { messages: () => buildAnalysisMessages(SAMPLE), budget: 160, parse: (text) => parseAnalysis(text) },
  tags: { messages: () => buildTagMessages(SAMPLE), budget: 96, parse: (text) => ({ tags: normalizeSuggestedTags(text, { max: 4 }) }) },
};

const bad = (message) => ({ status: 400, body: { error: 'bad_request', message } });
const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const intIn = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;

/**
 * Validate a probe request into the exact `env.AI.run` input. Pure. Returns { model, task, input } or { error }.
 * Unknown keys are refused rather than ignored, so a typo in a setting under test cannot read as "no effect".
 */
export function probeInput(body) {
  if (!isPlainObject(body)) return { error: 'A JSON object body is required.' };
  const allowed = new Set(['model', 'task', 'max_tokens', 'max_completion_tokens', 'temperature', 'chat_template_kwargs']);
  const unknown = Object.keys(body).filter((k) => !allowed.has(k));
  if (unknown.length) return { error: `Unknown field: ${unknown.join(', ')}.` };
  const model = body.model === undefined ? AI_TEXT_MODEL : body.model;
  if (typeof model !== 'string' || !MODEL_RE.test(model)) return { error: 'model must be a Workers AI id such as @cf/vendor/name.' };
  const task = body.task === undefined ? 'classify' : body.task;
  if (!Object.hasOwn(TASKS, task)) return { error: "task must be 'classify', 'analyze' or 'tags'." };
  // Production's own input is the starting point (aiTextInput), so a probe with no settings shows what news sends.
  const input = aiTextInput(TASKS[task].messages(), TASKS[task].budget);
  if (body.max_tokens !== undefined || body.max_completion_tokens !== undefined) delete input.max_tokens;
  for (const k of ['max_tokens', 'max_completion_tokens']) {
    if (body[k] === undefined) continue;
    if (!intIn(body[k], 1, PROBE_MAX_TOKENS)) return { error: `${k} must be a whole number from 1 to ${PROBE_MAX_TOKENS}.` };
    input[k] = body[k];
  }
  if (body.temperature !== undefined) {
    if (typeof body.temperature !== 'number' || !(body.temperature >= 0 && body.temperature <= 2)) return { error: 'temperature must be from 0 to 2.' };
    input.temperature = body.temperature;
  }
  if (body.chat_template_kwargs !== undefined) {
    const kw = body.chat_template_kwargs;
    const okValue = (v) => typeof v === 'boolean' || typeof v === 'number' || (typeof v === 'string' && v.length <= 40);
    if (!isPlainObject(kw) || Object.keys(kw).length > 4 || !Object.values(kw).every(okValue)) {
      return { error: 'chat_template_kwargs must be an object of at most 4 plain values.' };
    }
    input.chat_template_kwargs = kw;
  }
  return { model, task, input };
}

/** The raw reply as text a person can read, cut to a size a response can carry. Pure. */
export function rawPreview(out) {
  let s;
  try { s = typeof out === 'string' ? out : JSON.stringify(out); } catch { s = String(out); }
  if (s === undefined) s = String(out);
  return s.length > RAW_CHARS ? `${s.slice(0, RAW_CHARS)}… (${s.length} characters)` : s;
}

/**
 * POST /membership/admin/ai-probe. Injectable: `authorize`, `now` (ms clock). Everything else in `deps` goes to the
 * superadmin gate. Always answers 200 once authorised and valid, with `ok:false` and the error when the call threw,
 * because a failed call is the result being looked for, not a fault in the route.
 */
export async function membershipAdminAiProbe(request, env, { authorize = authorizeSuperadmin, now = () => Date.now(), ...deps } = {}) {
  const auth = await authorize(request, env, deps);
  if (!auth.ok) return { status: auth.status, body: auth.body };
  if (!env?.AI?.run) return { status: 503, body: { error: 'unavailable', message: 'The Workers AI binding is not configured.' } };
  let body;
  try { body = await request.json(); } catch { return bad('A JSON body is required.'); }
  const probe = probeInput(body);
  if (probe.error) return bad(probe.error);
  const { model, task, input } = probe;
  const settings = Object.fromEntries(Object.entries(input).filter(([k]) => k !== 'messages'));
  const started = now();
  try {
    const out = await env.AI.run(model, input);
    const text = aiText(out);
    return { status: 200, body: { ok: true, model, task, settings, ms: now() - started, raw: rawPreview(out), text, parsed: TASKS[task].parse(text) } };
  } catch (err) {
    return { status: 200, body: { ok: false, model, task, settings, ms: now() - started, error: String(err?.message || err).slice(0, 500) } };
  }
}
