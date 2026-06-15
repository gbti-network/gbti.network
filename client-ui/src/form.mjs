// Pure form helpers (SOW-006 v2), shared by the content editor + inline editor. No DOM: the component reads
// raw field values from the DOM and passes a getRaw(key, kind) function; these turn the field descriptors
// (from client.formFields) + raw values into the typed `input` object the core's content-ops expects. Mirrors
// the coercion the old inline UI did, kept pure so it is unit-tested in node without a browser.

/** Coerce one raw field value to its typed value per the field `kind`. Throws on invalid JSON. */
export function coerceValue(kind, raw) {
  switch (kind) {
    case 'boolean':
      return Boolean(raw);
    case 'number': {
      const n = Number(raw);
      return Number.isFinite(n) ? n : undefined;
    }
    case 'array':
      return String(raw ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    case 'json': {
      const t = String(raw ?? '').trim();
      return t ? JSON.parse(t) : undefined;
    }
    default: {
      const t = String(raw ?? '').trim();
      return t === '' ? undefined : t;
    }
  }
}

/**
 * Build the `input` object from field descriptors + a raw-value getter. Empty strings, undefined, and empty
 * arrays are omitted (the content schema defaults fill them in); booleans are always included.
 * @param {{key:string, kind:string}[]} fields  descriptors from client.formFields.
 * @param {(key:string, kind:string)=>any} getRaw  reads the raw DOM value for a field.
 */
export function gatherInput(fields, getRaw) {
  const input = {};
  for (const f of fields ?? []) {
    const raw = getRaw(f.key, f.kind);
    let val;
    try {
      val = coerceValue(f.kind, raw);
    } catch (err) {
      throw new Error(`field "${f.key}": ${err.message}`);
    }
    if (val === undefined) continue;
    if (Array.isArray(val) && val.length === 0) continue;
    input[f.key] = val;
  }
  return input;
}
