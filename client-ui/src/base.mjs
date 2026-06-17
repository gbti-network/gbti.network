// Base class + client registry for the GBTI web components (SOW-006 v2). Every component extends GbtiElement
// (Shadow DOM + brand tokens + helpers) and talks ONLY to the injected GbtiClient via getClient(), so the
// same components run under the extension (messaging) and the npm host (fetch). The host calls setClient()
// once before mounting. Guarded so importing this in a non-DOM env (node tests) does not crash: the pure
// helpers live in client.mjs / form.mjs / inline.mjs, which is what node tests import.

import { TOKENS, BASE_CSS } from './tokens.mjs';

const HAS_DOM = typeof HTMLElement !== 'undefined';

// The injected client + a cached identity, set once by the host.
let CLIENT = null;
let IDENTITY = null;
const SUBSCRIBERS = new Set();

export function setClient(client) {
  CLIENT = client;
  IDENTITY = null;
  for (const fn of SUBSCRIBERS) {
    try {
      fn();
    } catch {
      /* a component that failed to re-render must not break the others */
    }
  }
}
export function getClient() {
  return CLIENT;
}
/** Cache + return the signed-in identity (from client.status()). */
export async function getIdentity() {
  if (IDENTITY) return IDENTITY;
  if (!CLIENT) return null;
  try {
    const s = await CLIENT.status();
    IDENTITY = s?.identity ?? null;
    return IDENTITY;
  } catch {
    return null;
  }
}

const Base = HAS_DOM ? HTMLElement : class {};

export class GbtiElement extends Base {
  constructor() {
    super();
    if (HAS_DOM) this.root = this.attachShadow({ mode: 'open' });
    this._onClient = () => this.isConnected && this.render?.();
  }

  connectedCallback() {
    SUBSCRIBERS.add(this._onClient);
    this.render?.();
  }
  disconnectedCallback() {
    SUBSCRIBERS.delete(this._onClient);
  }

  get client() {
    return getClient();
  }

  /** Wrap markup with the tokens + base CSS (+ per-component extra) for the Shadow DOM. */
  css(extra = '') {
    return `<style>${TOKENS}${BASE_CSS}${extra}</style>`;
  }
  set(markup) {
    if (this.root) this.root.innerHTML = markup;
  }
  $(sel) {
    return this.root?.querySelector(sel) ?? null;
  }
  $$(sel) {
    return this.root ? [...this.root.querySelectorAll(sel)] : [];
  }
  on(sel, event, handler) {
    const el = this.$(sel);
    if (el) el.addEventListener(event, handler);
  }
  emit(name, detail) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }
}

/** Define a custom element only in a DOM environment, and only once (idempotent across hosts). NULL-SAFE on
 *  customElements: in some content-script isolated worlds `customElements` is null, and an unguarded
 *  customElements.get() there throws at module load, which (because importing client-ui runs every define())
 *  aborted the whole extension content script BEFORE it could stamp data-gbti-extension / the identity signal
 *  (the site then never detects the extension or the signed-in member). Skipping define() when the registry is
 *  unavailable degrades the in-place editor gracefully but keeps the detection + identity bridge working. */
export function define(tag, ctor) {
  const ce = HAS_DOM ? globalThis.customElements : null;
  if (!ce || ce.get(tag)) return;
  ce.define(tag, ctor);
}

/** Escape text for safe interpolation into innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
