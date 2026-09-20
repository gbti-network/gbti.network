// <gbti-digest-manager> (sow-266 Phase 2): the SUPERADMIN screen for what the weekly digest says about
// membership, and who sponsors it. Two blocks over one file, house/digest-config.yml, saved separately.
//
// WHY TWO SAVES OVER ONE FILE. The pitch and the sponsor are edited at different moments for different reasons,
// and one save would put a wording tweak and a paid placement on the same branch, where whichever saved second
// would reset the first. The Worker carries two rows with fixed branch names for exactly this.
//
// WHAT IT SHOWS IN THE BOXES IS WHAT IS STORED, NOT WHAT WOULD RENDER. An empty field means "fall back to the
// copy compiled into the renderer", and pre-filling the box with that copy would invite a save that pins
// today's default into the file and freezes it there the next time the default changes. The fallback is shown
// BESIDE the box instead, as a placeholder and a line underneath.
//
// THE RULES WARN, THEY DO NOT REFUSE (owner, 2026-09-19). Length, a second link, and naming something a free
// account already has are all reported as you type, in the same words the tests use, and saved anyway. The one
// implementation is ctaWarnings, so the warning a superadmin reads is the rule the suite checks.
//
// THE SPONSOR PREVIEW IS THE SANITIZED MARKUP, not the pasted markup. That is the point of it: a sponsor hands
// over a snippet with a tracking script or a style block in good faith, and the preview is where a superadmin
// finds out it will not survive. It renders what the reader will see, so an image in it loads from the
// sponsor's server exactly as it would in an inbox.
//
// Inert in public (no injected client). Host-agnostic: the extension, the npm client and the website all supply
// digestConfig / setDigestCta / setDigestSponsor.
import { GbtiElement, define, esc } from '../base.mjs';
import { houseEditAck } from '../workspace-core.mjs';
import { ctaWarnings, ctaVisibleLength, CTA_RULES } from '../../../membership/digest-config.mjs';
import { sanitizeSponsorHtml, sponsorText } from '../../../membership/mail-sponsor-sanitize.mjs';

const CSS = `
  :host { display:block; }
  .msg { font-size:13px; color:var(--accent); margin:0 0 12px; }
  .busy { opacity:.55; pointer-events:none; }
  .muted { color:var(--muted); }
  .blk { border-top:1px solid var(--line); padding:18px 0 4px; }
  .blk:first-of-type { border-top:0; padding-top:4px; }
  .hd { display:flex; align-items:center; gap:12px; margin:0 0 4px; }
  .hd h3 { margin:0; font-size:15px; font-weight:700; color:var(--fg); flex:1; min-width:0; }
  .state { font-size:12px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; }
  .state.on { color:var(--accent); }
  .state.off { color:var(--muted); }
  .lede { font-size:12.5px; color:var(--muted); margin:0 0 14px; line-height:1.5; }
  .f { margin:0 0 12px; }
  .f label { display:block; font-size:12.5px; font-weight:600; color:var(--fg); margin:0 0 5px; }
  .f input, .f textarea { display:block; width:100%; box-sizing:border-box; font:inherit; font-size:13.5px;
    color:var(--fg); background:var(--paper, transparent); border:1px solid var(--line); border-radius:8px; padding:8px 10px; }
  .f textarea { min-height:78px; resize:vertical; line-height:1.5; }
  .f textarea.code { font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; min-height:120px; }
  .f .note { display:block; font-size:12px; color:var(--muted); margin-top:5px; line-height:1.45; }
  .count { font-variant-numeric:tabular-nums; }
  /* DANGER, NOT ACCENT. The accent is this design system's brand green, which reads as "good", so using it to
     flag a broken rule tells a superadmin the opposite of what it means. These are still only warnings and they
     still save; the colour says which rule, not whether the save will go through. */
  .count.over { color:var(--danger); font-weight:700; }
  .warn { list-style:none; margin:0 0 12px; padding:10px 12px; border:1px solid var(--line); border-left:3px solid var(--danger); border-radius:8px; }
  .warn li { font-size:12.5px; color:var(--fg); line-height:1.5; }
  .warn li + li { margin-top:6px; }
  .prev { border:1px solid var(--line); border-radius:8px; padding:12px 14px; margin:0 0 6px; overflow-wrap:anywhere; }
  .prev img { max-width:100%; height:auto; }
  .prev .lbl { display:block; font-size:10px; font-weight:700; letter-spacing:.1em; text-transform:uppercase; color:var(--muted); margin:0 0 7px; }
  .plain { font-size:12px; color:var(--muted); line-height:1.5; overflow-wrap:anywhere; margin:0 0 14px; }
  .acts { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:4px; }
  button { font:inherit; font-size:13px; font-weight:600; border-radius:8px; padding:7px 14px; cursor:pointer; }
  .save { border:1px solid var(--accent); background:var(--accent); color:var(--paper, #fff); }
  .save:hover { background:var(--accent); filter:brightness(1.08); }
  .save[disabled] { cursor:default; opacity:.5; filter:none; }
  .lk { border:1px solid var(--line); background:var(--paper, transparent); color:var(--fg); }
  .lk:hover { background:var(--paper, transparent); border-color:var(--accent); color:var(--accent); }
  .hint { font-size:12.5px; color:var(--muted); margin:16px 0 0; line-height:1.5; }
  [hidden] { display:none !important; } /* an explicit display beats the UA [hidden] rule inside a shadow root */
`;

const SAVED = 'Saved. It merges on its own and reaches the next issue once the settings sync runs.';

class GbtiDigestManager extends GbtiElement {
  constructor() {
    super();
    this._status = 'idle'; // idle | loading | failed | ready
    this._draft = null;    // what is in the boxes right now
    this._saved = null;    // what was last read from the server, to tell a real change from a re-render
  }

  // The client-ready race (sow-334, and the note on every manager beside this one): the element sits in static
  // admin markup and upgrades BEFORE the client is injected, so the load starts from render() when the client
  // arrives, never from connectedCallback. A FAILED load is its own state with a Try again button and does NOT
  // retry on its own, because a render-triggered retry storms the route.
  connectedCallback() { super.connectedCallback?.(); }

  /** Typing is not saved anywhere, so a client re-render broadcast must not rebuild the boxes under a cursor. */
  skipClientRender() { return this._status === 'ready' && this._dirty(); }

  _dirty() {
    return !!this._draft && !!this._saved && JSON.stringify(this._draft) !== JSON.stringify(this._saved);
  }

  async load() {
    if (!this.client) { this.render(); return; }
    this._status = 'loading';
    this.render();
    try {
      const r = await this.client.digestConfig();
      this._defaults = r?.defaults || {};
      this._limits = r?.limits || {};
      // null means "not set in the file", which is a real third state and is why the switches read from the
      // DEFAULTS when it is null rather than assuming off.
      const cta = r?.cta || {};
      const sponsor = r?.sponsor || {};
      this._saved = {
        cta: {
          enabled: typeof cta.enabled === 'boolean' ? cta.enabled : (this._defaults.cta?.enabled !== false),
          body: String(cta.body ?? ''), linkLabel: String(cta.linkLabel ?? ''), linkUrl: String(cta.linkUrl ?? ''),
        },
        sponsor: {
          enabled: sponsor.enabled === true,
          html: String(sponsor.html ?? ''),
        },
      };
      this._draft = structuredClone(this._saved);
      this._status = 'ready';
    } catch (e) {
      this._status = 'failed';
      this._loadError = e?.message || 'The digest settings could not be read.';
    }
    this.render();
  }

  render() {
    if (!this.client) {
      this.set(this.css(CSS) + `<p class="muted">Open in the GBTI client (superadmin) to manage the digest.</p>`);
      return;
    }
    if (this._status === 'idle') { this.load(); this.set(this.css(CSS) + `<p class="muted">Loading the digest settings...</p>`); return; }
    if (this._status === 'loading') { this.set(this.css(CSS) + `<p class="muted">Loading the digest settings...</p>`); return; }
    if (this._status === 'failed') {
      this.set(this.css(CSS) + `<p class="msg">${esc(this._loadError)}</p><div class="acts"><button class="lk" type="button" data-retry>Try again</button></div>`);
      this.$('[data-retry]')?.addEventListener('click', () => { this._status = 'idle'; this.render(); });
      return;
    }

    this.set(this.css(CSS) + `<div class="${this._busy ? 'busy' : ''}">
      ${this._msg ? `<p class="msg">${esc(this._msg)}</p>` : ''}
      ${this._ctaBlock()}
      ${this._sponsorBlock()}
      <p class="hint">Superadmin only. Each Save opens a pull request against house/digest-config.yml that merges on its own, and the change reaches the mail on the next settings sync rather than immediately. The wording rules above warn and never block: if you mean it, save it.</p>
    </div>`);
    this._wire();
  }

  _ctaBlock() {
    const d = this._draft.cta;
    const fallback = this._defaults.cta || {};
    const warnings = ctaWarnings({ body: d.body || fallback.body, linkLabel: d.linkLabel || fallback.linkLabel, linkUrl: d.linkUrl || fallback.linkUrl });
    // ctaVisibleLength, NOT the raw string length: it counts the plan token as the word it becomes, which is
    // how the warning beside it counts. A count that disagreed with the warning under it would be worse than
    // no count, because the reader would trust the number they can see changing as they type.
    const visible = ctaVisibleLength(d.body || fallback.body) + (d.linkLabel || fallback.linkLabel || '').trim().length;
    const over = visible > CTA_RULES.maxVisibleChars;
    return `<section class="blk">
      <div class="hd">
        <h3>Membership pitch</h3>
        <span class="state ${d.enabled ? 'on' : 'off'}">${d.enabled ? 'On' : 'Off'}</span>
        <button class="lk" type="button" data-cta-toggle>Turn ${d.enabled ? 'off' : 'on'}</button>
      </div>
      <p class="lede">One note about membership, after all the articles and before the footer. It renders only in an issue that has articles in it, so a quiet week carries no pitch.</p>
      <div class="f">
        <label for="dm-body">What it says</label>
        <textarea id="dm-body" data-cta="body" placeholder="${esc(fallback.body || '')}">${esc(d.body)}</textarea>
        <span class="note"><span class="count ${over ? 'over' : ''}">${visible}</span> of ${CTA_RULES.maxVisibleChars} characters, counting the link label. Write {plan} where the plan name goes and it stays right through a rename. Leave this empty to use the wording the renderer ships with.</span>
      </div>
      <div class="f">
        <label for="dm-label">The link</label>
        <input id="dm-label" type="text" data-cta="linkLabel" value="${esc(d.linkLabel)}" placeholder="${esc(fallback.linkLabel || '')}">
      </div>
      <div class="f">
        <label for="dm-url">Where it goes</label>
        <input id="dm-url" type="text" data-cta="linkUrl" value="${esc(d.linkUrl)}" placeholder="${esc(fallback.linkUrl || '')}">
        <span class="note">A path such as /membership/, or a full https address.</span>
      </div>
      ${warnings.length ? `<ul class="warn">${warnings.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <div class="acts"><button class="save" type="button" data-save="cta"${this._clean('cta') ? ' disabled' : ''}>Save the pitch</button>${this._clean('cta') ? '' : '<span class="muted" style="font-size:12.5px">Unsaved</span>'}</div>
    </section>`;
  }

  _sponsorBlock() {
    const d = this._draft.sponsor;
    const safe = sanitizeSponsorHtml(d.html);
    const plain = sponsorText(d.html);
    const stripped = d.html.trim() && !safe;
    return `<section class="blk">
      <div class="hd">
        <h3>Sponsor</h3>
        <span class="state ${d.enabled && safe ? 'on' : 'off'}">${d.enabled && safe ? 'On' : 'Off'}</span>
        <button class="lk" type="button" data-sponsor-toggle>Turn ${d.enabled ? 'off' : 'on'}</button>
      </div>
      <p class="lede">One standing sponsor, in every issue until you change it, under a Sponsored label that cannot be edited away. Switched on with nothing to show, it renders nothing: a label over an empty box is worse than no block.</p>
      <div class="f">
        <label for="dm-html">The sponsor's markup</label>
        <textarea id="dm-html" class="code" data-sponsor="html" placeholder="&lt;a href=&quot;https://example.com&quot;&gt;Their line&lt;/a&gt;">${esc(d.html)}</textarea>
        <span class="note">Links, images and basic text tags survive. Scripts, styles, frames, forms and every event handler are removed. Paste what they sent and check the preview.</span>
      </div>
      ${stripped ? `<ul class="warn"><li>Nothing in this markup survives the allowlist, so no block would render. It is most likely a script or a frame, which no mail client would run anyway.</li></ul>` : ''}
      ${safe ? `<div class="prev"><span class="lbl">Sponsored</span>${safe}</div>
        <p class="plain">Text-only readers see: ${esc(plain)}</p>` : ''}
      <div class="acts"><button class="save" type="button" data-save="sponsor"${this._clean('sponsor') ? ' disabled' : ''}>Save the sponsor</button>${this._clean('sponsor') ? '' : '<span class="muted" style="font-size:12.5px">Unsaved</span>'}</div>
    </section>`;
  }

  _clean(block) {
    return JSON.stringify(this._draft?.[block]) === JSON.stringify(this._saved?.[block]);
  }

  _wire() {
    // Typing updates the draft and re-renders, which is what keeps the warnings, the count and the preview live.
    // The focused field and the caret are restored afterwards, because a re-render on every keystroke otherwise
    // throws the cursor to the end of the box on the second character.
    const retype = (el, block, key) => el.addEventListener('input', () => {
      this._draft[block][key] = el.value;
      const id = el.id; const at = el.selectionStart;
      this.render();
      const next = id ? this.$(`#${id}`) : null;
      if (next) { next.focus(); try { next.setSelectionRange(at, at); } catch { /* an input type without a selection */ } }
    });
    this.$$('[data-cta]').forEach((el) => retype(el, 'cta', el.dataset.cta));
    this.$$('[data-sponsor]').forEach((el) => retype(el, 'sponsor', el.dataset.sponsor));

    // The switches are part of the draft, not their own save: flipping one and then saving sends it with the
    // rest, so a superadmin who turns the pitch off and edits the wording in one sitting gets one pull request.
    this.$('[data-cta-toggle]')?.addEventListener('click', () => { this._draft.cta.enabled = !this._draft.cta.enabled; this.render(); });
    this.$('[data-sponsor-toggle]')?.addEventListener('click', () => { this._draft.sponsor.enabled = !this._draft.sponsor.enabled; this.render(); });

    this.$$('[data-save]').forEach((b) => b.addEventListener('click', () => this._save(b.dataset.save)));
  }

  async _save(block) {
    if (this._clean(block)) return;
    const d = this._draft[block];
    // Every field of the block goes in one call. These writes are patches, so sending only what changed would
    // work, but sending the whole block means the pull request diff is the block as the superadmin left it.
    const send = block === 'cta'
      ? () => this.client.setDigestCta({ enabled: d.enabled === true, body: d.body, linkLabel: d.linkLabel, linkUrl: d.linkUrl })
      : () => this.client.setDigestSponsor({ enabled: d.enabled === true, html: d.html });

    this._busy = true; this._msg = ''; this.render();
    try {
      const r = await send();
      this._msg = r?.noop ? 'No change (it already reads that way).' : (r?.prNumber ? houseEditAck(r) : SAVED);
      // Only the saved block moves to the baseline. The other one may still hold unsaved typing, and marking it
      // clean here would hide that from the person who wrote it.
      this._saved[block] = structuredClone(d);
    } catch (e) {
      this._msg = e?.message || 'That change could not be saved.';
    }
    this._busy = false;
    this.render();
  }
}

define('gbti-digest-manager', GbtiDigestManager);
export { GbtiDigestManager };
