// <gbti-locked-content> (SOW-016): upgrades the inert member-only placeholder baked by LockedBody.astro. The
// public static build ships `<gbti-locked-content data-gbti-enc="<repo .enc path>">` with a visible locked
// notice in its light DOM. When a host loads @gbti/client-ui (the extension content script or the npm shell),
// this element upgrades: it asks the host's client to DECRYPT the asset (the host reads the ciphertext and
// calls the Worker; the AES key NEVER reaches the page), renders the returned markdown, and shows it in the
// component's Shadow DOM (which hides the light-DOM notice). A non-paid member, or any failure, shows a
// locked / upgrade message. Read-only: it never holds the key or the ciphertext beyond this call.

import { GbtiElement, define, esc } from '../base.mjs';
import { imageLayoutProseCss } from '../image-layout-ui.mjs'; // {full} / {left wrap} image layout classes
import { listStyleProseCss } from '../list-style-ui.mjs'; // sow-322: {square} / {lower-alpha} list marker styles
import { EMBED_POSTER_CSS, wireEmbedPosters } from '../embed-lightbox.mjs'; // a comment's video poster opens the lightbox
import { loadMembersSkillBox, SKILL_READER_CSS } from '../skill-reader.mjs'; // sow-109 Phase 7: a members-only skill's install box
import { wireSkillPage } from '../../../src/lib/skill-page.mjs';

/** The tools a locked skill file is made for, from the attribute LockedBody bakes; [] for anything malformed. */
export function lockedTargets(raw) {
  try { const v = JSON.parse(String(raw || '[]')); return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : []; } catch { return []; }
}

// A long code block in a comment (e.g. a shared prompt) is clipped to CLIP_LINES with a fade + a Show
// more / Show less toggle, so a member can scan the note without scrolling past the whole block.
const CLIP_LINES = 8;

/**
 * Decide how one decrypted code block is presented, given its line count. Pure so it can be pinned in node;
 * the DOM wiring around it needs a browser and is verified there.
 *
 * EVERY block gets a Copy button, not only the clipped ones. sow-016 gating moved a prompt's payload behind
 * the wall, and the page's own Copy button is suppressed on a stub, so without this a paying member could
 * read the file they joined for and had no way to take it.
 */
export function codeBlockPlan(lineCount) {
  const lines = Number.isFinite(lineCount) ? lineCount : 0;
  const clip = lines > CLIP_LINES + 1;
  return { clip, copy: true, moreLabel: clip ? `Show more (${lines} lines)` : null, lessLabel: clip ? 'Show less' : null };
}

const PROSE = `
  ${EMBED_POSTER_CSS}
  .state, .locked { color: var(--muted); font-size: 14px; padding: 10px 0; }
  .locked a { color: var(--accent); font-weight: 600; }
  .unlocked :is(h1,h2,h3,h4) { font-weight: 700; margin: 1em 0 .4em; line-height: 1.25; }
  .unlocked p { margin: 0 0 1em; line-height: 1.6; }
  .unlocked ul, .unlocked ol { margin: 0 0 1em 1.2em; }
  .unlocked li > ul, .unlocked li > ol { margin: .25em 0 0 1.2em; }
  ${listStyleProseCss('.unlocked')}
  .unlocked a { color: var(--accent); }
  .unlocked img { max-width: 100%; height: auto; border-radius: 10px; }
  ${imageLayoutProseCss('.unlocked')}
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
  .codeclip-controls { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
  .codeclip-toggle {
    display: inline-flex; align-items: center; gap: 5px; padding: 4px 11px;
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
    if ((this.dataset?.gbtiKind || this.getAttribute?.('data-gbti-kind')) === 'skillfile') return this.renderSkill(encPath);
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
      // autoEmbed for a COMMENT body: a bare video link frames the player, as the built public comment does.
      // Share comments are members-only, so this decrypted path is the one most comments actually render through.
      const autoEmbed = (this.dataset.gbtiKind || this.getAttribute('data-gbti-kind') || '') === 'comment';
      html = (await this.client.preview({ body: text, autoEmbed }))?.html ?? ''; // renderMarkdown escapes raw HTML, so this is safe
    } catch {
      html = '';
    }
    this.set(this.css(PROSE) + `<div class="unlocked">${html}</div>`);
    this.decorateCode();
    wireEmbedPosters(this.root);
    this.emit('gbti-unlocked', { encPath });
  }

  /**
   * sow-109 Phase 7: a members-only skill's own file. Decrypted like a body, but shown as the skill page's install box
   * (the steps from /skill-install.json, the name from the file) with Copy SKILL.md and a Download of a local copy,
   * rather than rendered as markdown, which would turn its frontmatter into rules and headings.
   */
  async renderSkill(encPath) {
    const css = this.css(PROSE + SKILL_READER_CSS + '\n[data-skill-raw][hidden] { display:none !important; }');
    this.set(css + `<div class="state">Unlocking the skill file…</div>`);
    if (this._skillUrl) { try { URL.revokeObjectURL(this._skillUrl); } catch { /* already gone */ } this._skillUrl = null; }
    const site = typeof location !== 'undefined' && /^https?:$/.test(location.protocol) ? location.origin : 'https://gbti.network';
    let box = null;
    try {
      box = await loadMembersSkillBox({
        site,
        targets: lockedTargets(this.dataset?.gbtiTargets || this.getAttribute?.('data-gbti-targets')),
        decrypt: async () => (await this.client.decrypt({ encPath }))?.text,
        fileHref: (text) => {
          try { this._skillUrl = URL.createObjectURL(new Blob([text], { type: 'text/markdown' })); } catch { this._skillUrl = null; }
          return this._skillUrl || '';
        },
      });
    } catch (err) {
      const locked = err?.code === 'membership-required' || err?.code === 'not-authenticated';
      this.set(css + `<div class="locked">${locked
        ? 'The skill file and its install steps are for members. <a href="/membership/">Become a member</a> to unlock them.'
        : 'The skill file could not be unlocked right now.'}</div>`);
      return;
    }
    if (!box?.html) {
      this.set(css + '<div class="state">The install steps could not be loaded right now.</div>');
      return;
    }
    this.set(css + `${box.html}<pre data-skill-raw hidden>${esc(box.text)}</pre>`);
    wireSkillPage(this.root);
    this.emit('gbti-unlocked', { encPath });
  }

  /** Give every decrypted <pre> a Copy button, and clip the long ones behind a Show more / Show less toggle. */
  decorateCode() {
    const doc = this.root?.ownerDocument || (typeof document !== 'undefined' ? document : null);
    if (!doc) return;
    for (const pre of this.$$('.unlocked pre')) {
      const lines = (pre.textContent || '').replace(/\n$/, '').split('\n').length;
      const plan = codeBlockPlan(lines);

      const clip = doc.createElement('div');
      clip.className = plan.clip ? 'codeclip collapsed' : 'codeclip';
      const inner = doc.createElement('div');
      inner.className = 'codeclip-inner';
      pre.replaceWith(clip);
      inner.appendChild(pre);
      clip.appendChild(inner);

      const controls = doc.createElement('div');
      controls.className = 'codeclip-controls';
      clip.appendChild(controls);

      // Copy first: on a gated prompt this IS the payload, and the page's own Copy button is suppressed
      // for a stub, so this button is the only way a member takes away what they joined for.
      const copy = doc.createElement('button');
      copy.type = 'button';
      copy.className = 'codeclip-toggle';
      copy.textContent = 'Copy';
      copy.addEventListener('click', async () => {
        const text = (pre.textContent || '').replace(/\n$/, '');
        try {
          await navigator.clipboard.writeText(text);
          copy.textContent = 'Copied';
          setTimeout(() => { copy.textContent = 'Copy'; }, 1500);
        } catch {
          copy.textContent = 'Copy failed'; // clipboard denied: say so rather than looking like it worked
        }
      });
      controls.appendChild(copy);

      if (!plan.clip) continue;
      const btn = doc.createElement('button');
      btn.type = 'button';
      btn.className = 'codeclip-toggle';
      btn.textContent = plan.moreLabel;
      btn.addEventListener('click', () => {
        const collapsed = clip.classList.toggle('collapsed');
        btn.textContent = collapsed ? plan.moreLabel : plan.lessLabel;
      });
      controls.appendChild(btn);
    }
  }
}

define('gbti-locked-content', GbtiLockedContent);
export { GbtiLockedContent };
