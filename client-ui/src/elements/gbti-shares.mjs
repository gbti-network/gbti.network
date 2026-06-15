// <gbti-shares> (SOW-018): the Shares pane shown in the GBTI client/extension. Stacks the composer (post an
// update, paid-only) over the reading feed (the co-op stream; an active trial may read, a Locked account sees
// a splash). The feed listens for the composer's `gbti-share-posted` event itself, so posting refreshes the
// stream with no wiring here. Extension/client-only: Shares have no public website surface (SOW-018 directive).
import { GbtiElement, define } from '../base.mjs';
import './gbti-share-composer.mjs';
import './gbti-shares-feed.mjs';

const CSS = `
  :host { display:block; }
  .stack { display:flex; flex-direction:column; gap:20px; }
  hr { border:0; border-top:1px solid var(--line); margin:0; }
`;

class GbtiShares extends GbtiElement {
  render() {
    this.set(this.css(CSS) + `<div class="stack">
      <gbti-share-composer></gbti-share-composer>
      <hr />
      <gbti-shares-feed></gbti-shares-feed>
    </div>`);
  }
}

define('gbti-shares', GbtiShares);
export { GbtiShares };
