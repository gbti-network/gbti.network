// The podcast card (owner, 2026-10-26, option B on the article podcast canvas): a green play button beside the label
// and length, then, once it plays, a progress line and the time. The ```audio block with `style: card` renders a
// working browser player inside the card (client/src/content-blocks.mjs); enhanceAudioCards() hides its controls and
// draws the card's own, driving the same audio element. Nothing downloads until play, and a page where this never
// runs still has a player. The article page, the WorkBench preview and the extension reader all call it.
//
// The progress line is a range input, so it can be clicked or dragged and a screen reader announces it; the arrow
// keys skip 10 seconds (owner, 2026-10-26: "Jump by click or drag").

export const SKIP_SECONDS = 10;
const ARROWS = ['ArrowRight', 'ArrowUp', 'ArrowLeft', 'ArrowDown'];

/** 372 -> "6:12", 3723 -> "1:02:03"; anything not a positive finite number -> "0:00". */
export function formatTime(sec) {
  const n = Number.isFinite(sec) && sec > 0 ? Math.floor(sec) : 0;
  const h = Math.floor(n / 3600);
  const m = Math.floor((n % 3600) / 60);
  const ss = String(n % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** The position after an arrow key: 10 seconds back or forward, never before 0 or past the end; other keys stay. */
export function skipTo(current, key, duration) {
  const step = { ArrowRight: SKIP_SECONDS, ArrowUp: SKIP_SECONDS, ArrowLeft: -SKIP_SECONDS, ArrowDown: -SKIP_SECONDS }[key] ?? 0;
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  return Math.min(end, Math.max(0, (Number(current) || 0) + step));
}

/** What a screen reader hears for the progress line: "6:12 of 21:56". */
export const positionText = (current, duration) => `${formatTime(current)} of ${formatTime(duration)}`;

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.5v11l9-5.5z" fill="currentColor"/></svg>';
const PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor"/></svg>';

/** Upgrade every ```audio card under root (a document, an element or a shadow root). Safe to call again. */
export function enhanceAudioCards(root) {
  if (!root?.querySelectorAll) return;
  root.querySelectorAll('.gbti-audio-card').forEach((card) => {
    const audio = card.querySelector('audio');
    const head = card.querySelector('.gbti-audio-head');
    if (!audio || !head || card.dataset.enhanced) return;
    card.dataset.enhanced = '1';
    const label = card.querySelector('.gbti-audio-label')?.textContent || 'the recording';
    const doc = card.ownerDocument;
    const el = (tag, cls) => Object.assign(doc.createElement(tag), { className: cls });

    const row = el('div', 'gbti-audio-row');
    const btn = el('button', 'gbti-audio-play');
    btn.type = 'button';
    card.insertBefore(row, head);
    row.append(btn, head);
    const link = card.querySelector('.gbti-audio-link'); // sow-483: the link out sits at the end of the row
    if (link) row.append(link);

    const progress = el('div', 'gbti-audio-progress');
    progress.hidden = true; // as on the board: the line and the time appear once it plays
    const seek = el('input', 'gbti-audio-seek');
    Object.assign(seek, { type: 'range', min: '0', max: '0', step: 'any', value: '0' });
    seek.setAttribute('aria-label', 'Playback position');
    const time = el('span', 'gbti-audio-time');
    progress.append(seek, time);
    card.insertBefore(progress, audio);
    audio.removeAttribute('controls');

    let dragging = false;
    const show = (pos) => {
      const d = audio.duration;
      const known = Number.isFinite(d) && d > 0;
      seek.style.setProperty('--p', `${known ? Math.min(100, (pos / d) * 100) : 0}%`);
      seek.setAttribute('aria-valuetext', positionText(pos, d));
      time.textContent = `${formatTime(pos)} / ${formatTime(d)}`;
    };
    const sync = () => {
      const d = audio.duration;
      if (Number.isFinite(d) && d > 0) seek.max = String(d);
      if (dragging) return;
      seek.value = String(audio.currentTime);
      show(audio.currentTime);
    };
    const paint = () => {
      const playing = !audio.paused && !audio.ended;
      btn.innerHTML = playing ? PAUSE : PLAY;
      btn.setAttribute('aria-label', `${playing ? 'Pause' : 'Play'}: ${label}`);
    };

    btn.addEventListener('click', () => {
      if (audio.paused || audio.ended) audio.play()?.catch?.(() => {});
      else audio.pause();
    });
    audio.addEventListener('play', () => { progress.hidden = false; paint(); sync(); });
    audio.addEventListener('pause', paint);
    audio.addEventListener('ended', paint);
    for (const ev of ['timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) audio.addEventListener(ev, sync);
    // A drag moves the line and the time as it goes and seeks once, on release; a click is a one-step drag.
    seek.addEventListener('input', () => { dragging = true; show(Number(seek.value)); });
    seek.addEventListener('change', () => { dragging = false; audio.currentTime = Number(seek.value); });
    seek.addEventListener('keydown', (e) => {
      if (!ARROWS.includes(e.key)) return; // Home and End keep the slider's own behaviour
      e.preventDefault();
      audio.currentTime = skipTo(audio.currentTime, e.key, audio.duration);
    });
    paint();
  });
}
