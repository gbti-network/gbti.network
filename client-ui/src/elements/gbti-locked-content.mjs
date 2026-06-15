// <gbti-locked-content> (SOW-016): upgrades the inert member-only placeholder baked by LockedBody.astro. The
// public static build ships `<gbti-locked-content data-gbti-enc="<repo .enc path>">` with a visible locked
// notice in its light DOM. When a host loads @gbti/client-ui (the extension content script or the npm shell),
// this element upgrades: it asks the host's client to DECRYPT the asset (the host reads the ciphertext and
// calls the Worker; the AES key NEVER reaches the page), renders the returned markdown, and shows it in the
// component's Shadow DOM (which hides the light-DOM notice). A non-paid member, or any failure, shows a
// locked / upgrade message. Read-only: it never holds the key or the ciphertext beyond this call.

import { GbtiElement, define } from '../base.mjs';

// A long code block in a comment (e.g. a shared prompt) is clipped to CLIP_LINES with a fade + a Show
// more / Show less toggle, so a member can scan the note without scrolling past the whole block.
const CLIP_LINES = 8;

const PROSE = `
  .state, .locked { color: var(--muted); font-size: 14px; padding: 10px 0; }
  .locked a { color: var(--accent); font-weight: 600; }
  .unlocked :is(h1,h2,h3,h4) { font-weight: 700; margin: 1em 0 .4em; line-height: 1.25; }
  .unlocked p { margin: 0 0 1em; line-height: 1.6; }
  .unlocked ul, .unlocked ol { margin: 0 0 1em 1.2em; }
  .unlocked a { color: var(--accent); }
  .unlocked pre { background: var(--panel); padding: 12px; border-radius: 8px; overflow:auto; }
  .unlocked code { font-family: ui-monospace, monospace; }
  /* clip/reveal for a long code block */
  .codeclip { position: relative; margin: 0 0 1em; }
  .codeclip pre { margin: 0; }
  .codeclip-inner { position: relative; }
  .codeclip.collapsed .codeclip-inner pre { max-height: calc(${CLIP_LINES} * 1.5em + 24px); overflow: hidden; }
  .codeclip.collapsed .codeclip-inner::after {
    content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3.2em;
    background: linear-gradient(to bottom, transparent, var(--panel)); pointer-events: none; border-radius: 0 0 8px 8px;
  }
  .codeclip-toggle {
    display: inline-flex; align-items: center; gap: 5px; margin-top: 8px; padding: 4px 11px;
    font: inherit; font-size: 13px; font-weight: 600; line-height: 1.2;
    background: transparent; color: var(--accent); border: 1px solid var(--line, rgba(127,127,127,.32));
    border-radius: 6px; cursor: pointer;
  }
  .codeclip-toggle:hover { background: var(--panel); }
`;

class GbtiLockedContent extends GbtiElement {
  async render() {
    const encPath = this.dataset?.gbtiEnc || this.getAttribute?.('data-gbti-enc');
    if (!this.client || !encPath) return; // inert: no host yet -> the baked light-DOM notice stays visible
    this.set(this.css(PROSE) + `<div class="state">Unlocking member content…</div>`);
    let text;
    try {
      ({ text } = await this.client.decrypt({ encPath }));
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      this.set(this.css(PROSE) + `<div class="locked">${locked
        ? 'This content is for members. <a href="/membership/">Become a member</a> to unlock.'
        : 'This content could not be unlocked right now.'}</div>`);
      return;
    }
    let html = '';
    try {
      html = (await this.client.preview({ body: text }))?.html ?? ''; // renderMarkdown escapes raw HTML, so this is safe
    } catch {
      html = '';
    }
    this.set(this.css(PROSE) + `<div class="unlocked">${html}</div>`);
    this.clipLongCode();
    this.emit('gbti-unlocked', { encPath });
  }

  /** Clip any long <pre> in the rendered body to CLIP_LINES with a Show more / Show less toggle. */
  clipLongCode() {
    const doc = this.root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    for (const pre of this.$$('.unlocked pre')) {
      const lines = (pre.textContent || '').replace(/\n$/, '').split('\n').length;
      if (lines <= CLIP_LINES + 1) continue; // short enough: leave it inline
      const clip = doc.createElement('div');
      clip.className = 'codeclip collapsed';
      const inner = doc.createElement('div');
      inner.className = 'codeclip-inner';
      pre.replaceWith(clip);
      inner.appendChild(pre);
      clip.appendChild(inner);
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'codeclip-toggle';
      btn.textContent = `Show more (${lines} lines)`;
      btn.addEventListener('click', () => {
        const collapsed = clip.classList.toggle('collapsed');
        btn.textContent = collapsed ? `Show more (${lines} lines)` : 'Show less';
      });
      clip.appendChild(btn);
    }
  }
}

define('gbti-locked-content', GbtiLockedContent);
export { GbtiLockedContent };
