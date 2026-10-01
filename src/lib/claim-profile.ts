// sow-434: the browser half of the example profile page (src/pages/claim/profile/index.astro). Every decision lives in
// claim-profile-core.mjs, which node --test covers; this file reads the Worker and fills the markup.
//
// THE ORDER A VISIT RUNS IN.
//   1. The code from the address, checked before any request (a malformed code is the inactive panel, no fetch).
//   2. The signed-out read, GET /invite/listing: a plain fetch with no credentials (wildcard CORS), the same read the
//      invitation page makes. Anything but a readable listing is a panel, and the panel says nothing about the listing.
//   3. The example: the name and its initial where the picture goes (the claimed profile has no picture until the
//      person adds one), the GitHub link when the invitation is tied, and the project card with the author's blobatar.
//      Then the project's icon, from the listing's own image route (also signed out).
//   4. When the viewer is signed in as the person the listing is for, their own photo over the card's blobatar.
//
// SAFETY RULES THIS FILE KEEPS. No innerHTML anywhere: every listing string goes to textContent. Every href is built
// by the core (a normalized code, a checked login, safeHref) or is a site path from claimView. Nothing here logs, and
// the tab title is never touched, so the person's name and the project title stay out of the tab strip and history.
import {
  parseProfileQuery, readOutcome, panelView, profileName, profileInitial, projectsHeading, projectCard, viewerPicture,
  cardAuthor, invitationHref, exampleProfileHref, githubProfileUrl,
} from './claim-profile-core.mjs';
import { listingReadUrl, listingImageUrl, safeImagePayload, imageDataUrl, safeHref } from './claim-core.mjs';
import { memberBlob } from '../../membership/member-blob.mjs';
import { readMemberSignal, onMemberSignal, currentIdentity, type MemberSignal } from './member-signal';

type Panel = ReturnType<typeof panelView>;

async function readJson(res: Response): Promise<any> {
  try { return await res.json(); } catch { return null; }
}

export function startClaimProfile(doc: Document): void {
  const rootEl = doc.querySelector('[data-cp-root]') as HTMLElement | null;
  if (!rootEl) return;
  const root: HTMLElement = rootEl;
  const $ = <T extends Element = HTMLElement>(sel: string) => root.querySelector(sel) as T | null;
  const $$ = (sel: string) => Array.from(root.querySelectorAll(sel)) as HTMLElement[];

  const base = root.dataset.signupBase || '';
  const { code } = parseProfileQuery(location.search);
  let labels: Record<string, string> = {};
  try { labels = JSON.parse(root.dataset.labels || '{}') || {}; } catch { labels = {}; }

  const panel = $('[data-cp-panel]');
  const page = $('[data-cp-page]');
  const setText = (el: Element | null, text: string) => { if (el) el.textContent = text; };
  const show = (el: HTMLElement | null, on: boolean) => { if (el) el.hidden = !on; };

  // ---- the panel: loading, and every answer that is not a listing ---------------------------------------------
  const actionNode = (a: Panel['actions'][number]): HTMLElement => {
    const cls = `btn ${a.primary ? 'btn-primary' : 'btn-ghost'}`;
    if (a.kind === 'link') {
      const el = doc.createElement('a');
      el.className = cls;
      el.textContent = a.label;
      // Site paths are ours; any absolute address must pass safeHref, and an address that fails renders nothing.
      const href = typeof a.href === 'string' && /^\/(?!\/)/.test(a.href) ? a.href : safeHref(a.href);
      if (href) el.href = href;
      return el;
    }
    const b = doc.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = a.label;
    b.addEventListener('click', () => { location.reload(); });
    return b;
  };
  const showPanel = (state: string) => {
    const v = panelView(state);
    show(page, false);
    show(panel, true);
    setText($('[data-cp-panel-title]'), v.title);
    setText($('[data-cp-panel-text]'), v.text);
    show($('[data-cp-panel-busy]'), v.busy);
    $('[data-cp-panel-actions]')?.replaceChildren(...v.actions.map(actionNode));
  };

  // ---- the card's picture: the blobatar of the name, and the viewer's own photo when they are the person invited ----
  // (The profile header draws the initial instead, as the published header does for a profile with no picture.)
  let listing: any = null;
  let name = '';
  const photoImgs = () => $$('[data-cp-photo]') as HTMLImageElement[];
  const setBlob = (seed: string) => {
    const src = memberBlob(seed);
    for (const img of $$('[data-cp-blob]') as HTMLImageElement[]) img.src = src;
  };
  /** Each photo in turn; one that fails to load hands over to the next, and the last failure leaves the blobatar. */
  const setPhotos = (photos: string[]) => {
    for (const img of photoImgs()) {
      let i = 0;
      const next = () => {
        if (i >= photos.length) { img.hidden = true; img.removeAttribute('src'); return; }
        img.src = photos[i];
        i += 1;
      };
      img.onerror = next;
      img.onload = () => { img.hidden = false; };
      next();
    }
  };
  let pictured = false;
  const applyViewer = (signal: MemberSignal | null) => {
    if (!listing || pictured) return;
    const pic = viewerPicture(signal, listing);
    if (!pic) return;
    pictured = true;
    if (pic.seed) {
      setBlob(pic.seed);
      for (const el of $$('[data-cp-card-name]')) el.textContent = cardAuthor(listing, pic.seed);
    }
    setPhotos(pic.photos);
  };

  // ---- the example ------------------------------------------------------------------------------------------------
  function fill(l: any): void {
    name = profileName(l);
    setText($('[data-example-name]'), name);
    setText($('[data-example-initial]'), profileInitial(name));
    setBlob(name);

    // Their real GitHub page, when the invitation is tied to an account. Without one there is no link to show.
    const gh = $<HTMLAnchorElement>('[data-example-github]');
    const ghUrl = githubProfileUrl(l.githubLogin);
    if (gh && ghUrl) { gh.href = ghUrl; gh.hidden = false; }

    // Back to the invitation, from the banner and from the card.
    const back = invitationHref(code);
    for (const a of $$('[data-cp-back]') as HTMLAnchorElement[]) if (back) a.href = back;
    const self = exampleProfileHref(code);
    for (const a of $$('[data-cp-self]') as HTMLAnchorElement[]) if (self) a.href = self;

    setText($('[data-cp-projects-title]'), projectsHeading(name));
    const card = projectCard(l, labels);
    setText($('[data-cp-card-title]'), card.title);
    setText($('[data-cp-card-desc]'), card.description);
    const cat = $('[data-cp-card-cat]');
    setText(cat, card.category);
    show(cat, Boolean(card.category));
    show($('[data-cp-card-paid]'), card.paid);
    show($('[data-cp-card-members]'), card.membersLinks);
    for (const el of $$('[data-cp-card-name]')) el.textContent = cardAuthor(l);
    for (const el of $$('[data-cp-card-person]')) { el.setAttribute('data-tooltip', name); el.setAttribute('aria-label', name); }
    const repo = $<HTMLAnchorElement>('[data-cp-card-repo]');
    if (repo && card.repo) { repo.href = card.repo; repo.hidden = false; }
    const icon = $<HTMLImageElement>('[data-cp-card-icon]');
    if (icon) icon.alt = `${card.title} icon`;

    show(panel, false);
    show(page, true);
    if (card.iconName) void loadIcon(card.iconName);
  }

  async function loadIcon(fileName: string): Promise<void> {
    const url = listingImageUrl(base, code, fileName);
    const icon = $<HTMLImageElement>('[data-cp-card-icon]');
    if (!url || !icon) return;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) return;
      const src = imageDataUrl(safeImagePayload(await readJson(res), fileName));
      if (src) icon.src = src;
    } catch { /* a missing icon leaves its tile empty; the card still reads */ }
  }

  // ---- the visit ----------------------------------------------------------------------------------------------------
  async function boot(): Promise<void> {
    showPanel('loading');
    const url = listingReadUrl(base, code);
    if (!code || !url) { showPanel('inactive'); return; }
    let outcome: ReturnType<typeof readOutcome>;
    try {
      const res = await fetch(url, { cache: 'no-store' });
      outcome = readOutcome(res.status, await readJson(res));
    } catch {
      outcome = readOutcome(0, null);
    }
    if (!('listing' in outcome)) {
      showPanel('rateLimited' in outcome ? 'rate_limited' : 'error' in outcome ? 'error' : 'inactive');
      return;
    }
    listing = outcome.listing;
    fill(listing);
    applyViewer(currentIdentity(readMemberSignal()));
  }

  onMemberSignal(applyViewer);
  void boot();
}
