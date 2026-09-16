// <gbti-onboarding-progress> (sow-343 Phase 3): the WorkBench card that keeps asking a member to finish the welcome
// steps. It sits in the overview's banner slot, stays while any step is outstanding (a skipped step included, owner
// ruling 2026-09-16), and has no dismiss control. It renders nothing when every step is done or when anything it
// needs could not be read. Data and markup live in onboarding-card-core.mjs; this element only loads and paints.
//
// The overview re-renders by replacing its HTML, which recreates this element each time, so the view is kept per
// account for a minute (onboarding-card-core CACHE) and a recreated card paints from it at once.
import { GbtiElement, define, getIdentity } from '../base.mjs';
import { loadProgress, onboardingCardHtml, cachedProgress, rememberProgress, WELCOME_SITE_URL } from '../onboarding-card-core.mjs';

const CSS = `
  :host { display:block; }
  .ob { border:1px solid var(--accent); border-radius:var(--radius); padding:13px 16px; margin:0 0 16px;
    background:color-mix(in srgb, var(--accent) 7%, var(--panel)); -webkit-backdrop-filter: var(--glass-blur); backdrop-filter: var(--glass-blur); }
  .ob-head { display:flex; align-items:baseline; justify-content:space-between; gap:12px; flex-wrap:wrap; }
  .ob-head b { font-size:13.5px; }
  .ob-count { font-size:12px; color:var(--muted); white-space:nowrap; }
  .ob-sub { font-size:12.5px; color:var(--muted); margin:3px 0 9px; }
  .ob-steps { list-style:none; margin:0; padding:0; display:grid; grid-template-columns:repeat(auto-fill, minmax(220px, 1fr)); gap:6px 16px; }
  .st { display:flex; align-items:center; gap:8px; font-size:13px; min-width:0; }
  .st a { color:var(--accent); font-weight:600; text-decoration:none; }
  .st a:hover { text-decoration:underline; }
  .mk { flex:none; width:16px; height:16px; border-radius:50%; border:1.5px solid var(--line); box-sizing:border-box;
    display:inline-flex; align-items:center; justify-content:center; font-size:10px; }
  .st.done { color:var(--muted); }
  .st.done .mk { background:var(--accent); border-color:var(--accent); color:#fff; }
  .st.skipped a { color:var(--muted); font-weight:500; }
  .st.skipped .mk { border-style:dashed; }
  .tag { font-size:10.5px; font-weight:600; color:var(--muted); border:1px solid var(--line); border-radius:999px; padding:1px 7px; }
`;

class GbtiOnboardingProgress extends GbtiElement {
  render() {
    const hit = cachedProgress();
    this._paint(hit?.progress);
    if (!hit?.fresh && this.client && !this._loading) this._load();
  }

  async _load() {
    this._loading = true;
    try {
      const me = await getIdentity();
      const who = me?.username || me?.login || '';
      const progress = await loadProgress(this.client);
      if (who) rememberProgress(who, progress);
      this._paint(progress);
    } finally {
      this._loading = false;
    }
  }

  _paint(progress) {
    const external = typeof location !== 'undefined' && location.protocol === 'chrome-extension:';
    const html = onboardingCardHtml(progress, { welcomeUrl: external ? WELCOME_SITE_URL : '/welcome/', external });
    this.set(html ? this.css(CSS) + html : '');
  }
}

define('gbti-onboarding-progress', GbtiOnboardingProgress);
export { GbtiOnboardingProgress };
