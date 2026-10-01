// The inline SVG icons <gbti-content-editor> draws in its toolbar, rail section headers, document sections and row
// controls. A shadow root cannot reach the page's sprite, so each one is inlined. Moved out of the element unchanged
// when it crossed the 900-line limit (owner, 2026-09-30). EYE, TAG, COIN and LINK are reached only through
// SECTION_ICON, so they are not exported on their own.

// SOW-062 P6: inline icons for the edhead toolbar + section headers (the design's sprite is not in the shadow root).
const _svg = (p) => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const DOC = _svg('<path d="M7 3h7l4 4v14H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M13.5 3.2V7.5H18M9 12.5h6M9 16h6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>');
const EYE = _svg('<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="12" cy="12" r="2.6" fill="none" stroke="currentColor" stroke-width="1.7"/>');
const SAVE = _svg('<path d="M5 4h10l4 4v12H5z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 4v5h6V4M8 20v-6h8v6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>');
const MERGE = _svg('<circle cx="6" cy="6" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="6" cy="18" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="18" cy="13" r="2.3" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M6 8.3v7.4M6 10.5c.4 3.4 3 5 9.4 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>');
// SOW-062 P6 rail: the design references these by sprite id; the shadow root has no sprite, so inline them.
const S = 'fill="none" stroke="currentColor"';
const GLOBE = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M3.8 12h16.4M12 3.8c2.2 2.3 3.3 5.2 3.3 8.2S14.2 17.9 12 20.2M12 3.8c-2.2 2.3-3.3 5.2-3.3 8.2S9.8 17.9 12 20.2" ${S} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`);
const LOCK = _svg(`<rect x="5" y="11" width="14" height="9" rx="2.2" ${S} stroke-width="1.8"/><path d="M8 11V8a4 4 0 0 1 8 0v3" ${S} stroke-width="1.8"/>`);
const INFO = _svg(`<circle cx="12" cy="12" r="8.2" ${S} stroke-width="1.7"/><path d="M12 11v5" ${S} stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="8" r="1.05" fill="currentColor"/>`);
const X = _svg(`<path d="M6 6l12 12M18 6L6 18" ${S} stroke-width="2" stroke-linecap="round"/>`);
const CHEV = _svg(`<path d="M6 9l6 6 6-6" ${S} stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`);
const GRIP = _svg(`<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>`); // sow-268: gallery drag handle (owner chose drag over up/down buttons)
const TAG = _svg(`<path d="M4 11.5V5a1 1 0 0 1 1-1h6.5l8 8-7.5 7.5-8-8z" ${S} stroke-width="1.7" stroke-linejoin="round"/><circle cx="8.5" cy="8.5" r="1.3" fill="currentColor"/>`);
const COIN = _svg(`<circle cx="12" cy="12" r="8" ${S} stroke-width="1.8"/><path d="M12 7.5v9M14.5 9.3c-.6-.7-1.5-1-2.5-1-1.4 0-2.5.7-2.5 1.9 0 2.6 5 1.4 5 4 0 1.2-1.1 2-2.5 2-1 0-2-.4-2.6-1.1" ${S} stroke-width="1.6" stroke-linecap="round"/>`);
const LINK = _svg(`<path d="M10 14a3.5 3.5 0 0 0 5 0l2.5-2.5a3.5 3.5 0 0 0-5-5L11 8" ${S} stroke-width="1.7" stroke-linecap="round"/><path d="M14 10a3.5 3.5 0 0 0-5 0l-2.5 2.5a3.5 3.5 0 0 0 5 5L13 16" ${S} stroke-width="1.7" stroke-linecap="round"/>`);
const IMG = _svg(`<rect x="4" y="5" width="16" height="14" rx="2.2" ${S} stroke-width="1.8"/><circle cx="9" cy="10" r="1.7" ${S} stroke-width="1.6"/><path d="M5 17.5l4.2-4.2L13 17l2.6-2.6L19 17.8" ${S} stroke-width="1.7" stroke-linejoin="round"/>`);
const BOOK = _svg(`<path d="M7 4h10a1 1 0 0 1 1 1v15l-6-4-6 4V5a1 1 0 0 1 1-1z" ${S} stroke-width="1.8" stroke-linejoin="round"/>`); // SOW-062 P6: markdown cheatsheet
const COPY = _svg(`<rect x="8" y="8" width="11" height="12" rx="2" ${S} stroke-width="1.7"/><path d="M5 15.5V5.5a1.5 1.5 0 0 1 1.5-1.5H15" ${S} stroke-width="1.7" stroke-linecap="round"/>`); // SOW-062 P6: copy content id
const CODE = _svg(`<path d="M9 8l-4 4 4 4M15 8l4 4-4 4" ${S} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: markdown view toggle
const PLUS = _svg(`<path d="M12 5.5v13M5.5 12h13" ${S} stroke-width="2" stroke-linecap="round"/>`); // SOW-062 P6: add link row
const TRASH = _svg(`<path d="M5 7h14M9 7V5h6v2M7 7l1 12h8l1-12" ${S} stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: remove link row
const VIDEO = _svg(`<rect x="3.5" y="6" width="11" height="12" rx="2.2" ${S} stroke-width="1.7"/><path d="M14.5 10l6-2.8v9.6l-6-2.8" ${S} stroke-width="1.7" stroke-linejoin="round"/>`); // SOW-062 P6: project video section
const CHAT = _svg(`<path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H9l-4 4v-4H6.5" ${S} stroke-width="1.8" stroke-linejoin="round"/>`); // SOW-062 P6: from-the-author section
const USERS = _svg(`<circle cx="9" cy="8" r="3.2" ${S} stroke-width="1.8"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0M16 6.5a3 3 0 0 1 0 5.6M16.5 19a5.5 5.5 0 0 0-2.3-4.5" ${S} stroke-width="1.8" stroke-linecap="round"/>`); // SOW-062 P6: discussion section
const CHECK = _svg(`<path d="M5 12.5l4.5 4.5L19 7" ${S} stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`); // SOW-062 P6: save-chip "saved" tick
const SECTION_ICON = { Publishing: EYE, Taxonomy: TAG, Pricing: COIN, Links: LINK, Media: IMG, Details: DOC };

export { DOC, SAVE, MERGE, GLOBE, LOCK, INFO, X, CHEV, GRIP, IMG, BOOK, COPY, CODE, PLUS, TRASH, VIDEO, CHAT, USERS, CHECK, SECTION_ICON };
