// sow-191: publish the Shop Talk weekly call as an .ics file at /shoptalk.ics.
//
// WHY AN .ICS RATHER THAN A GOOGLE LINK. The homepage button used to point at
// calendar.google.com/calendar/render?action=TEMPLATE, which creates a PRIVATE COPY on the clicker's own
// calendar instead of adding them to the real recurring event, and which only works for Google users. An
// Apple or Outlook member got nothing usable. An .ics is understood by every calendar client, so this both
// fixes the behaviour and widens who it works for.
//
// WHY NO WORKER ROUTE AND NO GOOGLE CALENDAR API. The site is `output: static`, and this is the same
// build-time artifact pattern as the twelve existing src/pages/*.json.ts endpoints. The Google Calendar API
// exists to manage ATTENDEES on an event we own; adding an event to someone else's calendar does not need it,
// and taking it on would mean an OAuth client, a stored refresh token and a standing rotation obligation for
// the sake of one button.
//
// THIS FILE IS PUBLIC BY CONSTRUCTION AND CANNOT BE GATED. It is a plain file on a CDN, so membership cannot
// be checked before it is served. That is exactly why house/shoptalk.yml keeps `publish_join_url` fail-closed:
// while it is false the join URL is never written here at all. The homepage button's member-awareness is a
// presentation affordance over the untrusted SOW-030 identity signal, not an access control, and nothing in
// this path should be described as gating.

import type { APIRoute } from 'astro';
import { shoptalkIcs } from '../lib/shoptalk';

export const prerender = true;

export const GET: APIRoute = async () => {
  return new Response(shoptalkIcs(), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      // Name the file for the member's download rather than letting the browser call it "shoptalk.ics" or,
      // worse, render it as text in a tab. Several clients only offer "add to calendar" on a real download.
      'Content-Disposition': 'attachment; filename="gbti-shop-talk.ics"',
      // Public metadata about a public community call. CORS is open for the same reason quotes.json.ts is:
      // the extension and any member tool may want to read it without a token.
      'Access-Control-Allow-Origin': '*',
    },
  });
};
