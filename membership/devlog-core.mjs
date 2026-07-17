// SOW-124: the pure, host-agnostic devlog core. A production-INERT structured logger the extension, the shared
// web-components UI, the npm client, and the Worker all reuse. It has three jobs: no-op when disabled (so call
// sites can live in the code permanently), REDACT any secret before it is ever written (never a token, key, or
// bearer value), and keep a bounded in-memory ring the superadmin Debug panel reads back. Pure over an injected
// `sink` + `now`, so it is unit-tested with fakes. No chrome, no fs, no network here.

// Keys whose VALUES must never be logged. Matched case-insensitively against a data key; the value becomes
// "<redacted>". This is the hard secret boundary (the commit secret-scan is only the backstop).
const SECRET_KEY = /token|secret|authorization|bearer|password|refresh|api[_-]?key|cookie|credential|client[_-]?secret/i;
// A long string in a logged value is truncated so a body/token fragment never sprawls into a line.
const MAX_STRING = 200;
// Redaction is shallow by design (diagnostics log shapes, not trees); anything deeper collapses to a marker.
const MAX_DEPTH = 3;

/** Truncate a string for logging, marking that it was cut. */
function clip(s) {
  const str = String(s);
  return str.length > MAX_STRING ? `${str.slice(0, MAX_STRING)}…(${str.length})` : str;
}

/**
 * Redact + shrink a value for logging: secret-named keys become "<redacted>", long strings are clipped, and the
 * structure stays shallow. Pure, returns a NEW value (never mutates the input). A logging call must be safe to
 * make with any object; this guarantees no secret and no giant blob reaches the sink.
 */
export function redactDeep(value, depth = 0) {
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string') return clip(value);
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return `${value}n`;
  if (t === 'function') return `[fn ${value.name || 'anonymous'}]`;
  if (t !== 'object') return String(value);
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[array(${value.length})]` : '[object]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => redactDeep(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) { out[k] = v == null || v === '' ? '<empty>' : '<redacted>'; continue; }
    out[k] = redactDeep(v, depth + 1);
  }
  return out;
}

/** Coerce the `enabled` option (a boolean or a thunk) to a fresh boolean each call, fail-closed on a throw. */
function isOn(enabled) {
  try { return typeof enabled === 'function' ? !!enabled() : !!enabled; }
  catch { return false; }
}

/**
 * Build a devlog. Returns a callable `devlog(area, msg, data?)` with `.recent()`, `.clear()`, `.setEnabled()`,
 * and `.enabled()`. When disabled the call returns immediately (a strict no-op) and NOTHING is ringed or sunk,
 * so a superadmin-off session pays nothing. A failure in the sink can never throw into the caller.
 *
 * @param {object} [opts]
 * @param {boolean|(()=>boolean)} [opts.enabled=false] gate; a thunk is re-evaluated on every call.
 * @param {{log?:Function}|Function} [opts.sink=console] where a formatted line goes; console by default. A bare
 *   function is treated as the log method. Pass a no-op / a collector in tests.
 * @param {()=>number} [opts.now=Date.now] the clock (injected in tests).
 * @param {number} [opts.ringSize=200] the bounded ring length.
 */
export function createDevlog({ enabled = false, sink = console, now = Date.now, ringSize = 200 } = {}) {
  let gate = enabled;
  const ring = [];
  const emit = typeof sink === 'function' ? sink : (sink && typeof sink.log === 'function' ? (...a) => sink.log(...a) : () => {});

  const devlog = (area, msg, data) => {
    if (!isOn(gate)) return;
    const t = now();
    const safe = data === undefined ? undefined : redactDeep(data);
    const entry = { t, area: String(area || 'app'), msg: String(msg == null ? '' : msg) };
    if (safe !== undefined) entry.data = safe;
    ring.push(entry);
    if (ring.length > ringSize) ring.splice(0, ring.length - ringSize);
    try { safe === undefined ? emit(`[gbti:${entry.area}] ${entry.msg}`) : emit(`[gbti:${entry.area}] ${entry.msg}`, safe); }
    catch { /* a broken sink must never break a real code path */ }
  };

  // The bounded ring, oldest-first (newest last), a shallow copy so a reader cannot mutate it.
  devlog.recent = () => ring.slice();
  devlog.clear = () => { ring.length = 0; };
  devlog.setEnabled = (next) => { gate = next; };
  devlog.enabled = () => isOn(gate);
  return devlog;
}
