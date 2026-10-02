// The free web composers a superadmin posts through by hand. sow-171 moved this out of <gbti-social-queue> so the
// news reader's "Share to our channels" panel opens exactly the same addresses as the Social Queue. Pure.
// The free web composer for a manual-assist channel (X opens the intent composer, pre-filled).
// SOW-121/127: the free web composer for a manual-assist channel, pre-filled with the rendered text. X uses
// its intent composer; LinkedIn opens the feed share composer with the text (LinkedIn no longer guarantees a
// text prefill, so the "Copy" button is the reliable fallback: copy, then paste into the composer).
// sow-260: takes the whole TASK rather than (channel, text), because Reddit is the first channel whose
// composer prefill needs more than the rendered text: a submission is a title AND a url.
export const REDDIT_SUB = 'GBTI_network'; // hardcoded, as daily.dev hardcodes its squad; the Worker holds REDDIT_SUBREDDIT
export const composeUrl = (task) => {
  const channel = task?.channel;
  const text = String(task?.text || '');
  const t = encodeURIComponent(text);
  if (channel === 'x') return `https://twitter.com/intent/tweet?text=${t}`;
  if (channel === 'linkedin') return `https://www.linkedin.com/feed/?shareActive=true&text=${t}`;
  // sow-405: Bluesky is assisted now. Its intent link opens the web composer with the text filled in, and Bluesky
  // turns the link, the hashtags and any @handle in that text into a link card, tags and a mention itself.
  if (channel === 'bluesky') return `https://bsky.app/intent/compose?text=${t}`;
  if (channel === 'dailydev') return 'https://app.daily.dev/squads/gbti_network'; // SOW-135: no text prefill; Assist opens the squad, the Copy button supplies the link
  if (channel === 'hashnode') return 'https://hashnode.com/draft'; // RETAINED for already-queued tasks, see below
  // sow-260: unlike X and LinkedIn, Reddit's submit form takes a REAL prefill, so Assist lands on a form with
  // the title and link already filled and only the body left to paste. `text` is the title here (the drain
  // renders it newline-stripped, since a Reddit title cannot hold one).
  if (channel === 'reddit') {
    const u = String(task?.url || '');
    return `https://www.reddit.com/r/${REDDIT_SUB}/submit?title=${t}${u ? `&url=${encodeURIComponent(u)}` : ''}`;
  }
  return null;
};
