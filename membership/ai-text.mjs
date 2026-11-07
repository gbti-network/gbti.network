// sow-493 (Cloudflare notice, 2026-11-07): Workers AI retires models on a schedule. The Llama 3.2 3B model every caller used
// stops answering on 2026-11-20 (HTTP 410, error 5028), and every caller here falls back quietly on an error, so the
// retirement would have shown as nothing more than news losing its AI categories and summaries.
//
// THE ONE MODEL SETTING. Every Workers AI text call defaults to AI_TEXT_MODEL; the Worker's `AI_MODEL` variable
// (workers/signup/wrangler.toml) overrides it. Change both together when Cloudflare retires this one, after proving
// the replacement with POST /membership/admin/ai-probe (workers/signup/membership-admin-ai-probe.mjs).
//
// THE ONE REPLY READER. Models differ in what they return: the older ones put the text in `response`, the newer ones
// reply OpenAI-style with `choices[0].message.content`. A caller that read only `response` got nothing from a newer
// model and fell back without a word, which is exactly the failure a model swap would have caused. aiText reads every
// shape, and strips a reasoning model's <think> notes so they never reach a label or a summary. Pure, no IO.

// History, 2026-11-07. Gemma went live at 16:11 UTC WITHOUT the reasoning switch below, and the 17:00 news run stored
// every story with no AI category or summary, so production went back to the old model for an hour. The probe
// (POST /membership/admin/ai-probe) then showed why: Gemma reasons by default, and spent the whole budget on it.
// With the switch it answered every task correctly. Prove any future candidate with the probe before setting it here.
export const AI_TEXT_MODEL = '@cf/google/gemma-4-26b-a4b-it';

/**
 * The input every text call sends: the messages, a token budget, temperature 0, and REASONING OFF.
 *
 * Gemma reasons by default. Live, with a 64-token budget, it returned `content: ''` with its notes in
 * `reasoning_content` and `finish_reason: 'length'`, so every caller fell back. `chat_template_kwargs:
 * { enable_thinking: false }` is the switch: proven with the probe, where an unknown key or `true` left reasoning on.
 * The old model accepts the same input, so a rollback before its retirement is a change of model id only. Pure.
 */
export function aiTextInput(messages, maxTokens) {
  return { messages, max_tokens: maxTokens, temperature: 0, chat_template_kwargs: { enable_thinking: false } };
}

const THINK_RE = /<think>[\s\S]*?(?:<\/think>|$)/gi;

function partsText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map((p) => (typeof p === 'string' ? p : (typeof p?.text === 'string' ? p.text : ''))).join('');
  return '';
}

/** The model's text from a Workers AI reply of any known shape, with reasoning notes removed; '' when there is none. */
export function aiText(out) {
  if (out == null) return '';
  let text = '';
  if (typeof out === 'string') text = out;
  else if (typeof out.response === 'string') text = out.response;
  else if (Array.isArray(out.choices) && out.choices[0]) text = partsText(out.choices[0].message?.content ?? out.choices[0].text);
  else if (typeof out.result === 'string') text = out.result;
  else if (out.result && typeof out.result === 'object') return aiText(out.result); // the REST API wraps the reply in `result`
  return text.replace(THINK_RE, '').trim();
}
