// sow-415: what the news source manager shows while a saved edit is still on its way to main. Pure; node-testable.
//
// WHY THIS EXISTS. A blocked word or a source weight is saved as a pull request that merges on its own, about half a
// minute later, and the manager's list is read back from main. So the reload straight after a save returned the list
// WITHOUT the change, and a word the superadmin had just blocked looked as if it had never been added. That was the
// symptom the owner reported (2026-09-26), sitting on top of a Worker fault that also stopped the save itself.
//
// A saved edit is held here and laid over what main returns until main agrees with it, so the list shows the change
// the moment it is submitted. It is held in memory only: a page reload drops it, and by then the pull request has
// merged or failed where the owner can see it.

/** Held edits: a word maps to true (blocked) or false (unblocked), a source id maps to the weight it was given. */
export function pendingEdits() {
  return { words: new Map(), weights: new Map() };
}

/**
 * The blocked words to show: main's list with each held edit applied, sorted like the stored file. A held edit main
 * already agrees with is dropped from `pending`, so it cannot mask a later change made somewhere else.
 */
export function overlayWords(loaded, pending) {
  const shown = new Set(Array.isArray(loaded) ? loaded : []);
  const onMain = new Set(shown);
  for (const [word, blocked] of [...(pending?.words ?? new Map())]) {
    if (onMain.has(word) === blocked) { pending.words.delete(word); continue; }
    if (blocked) shown.add(word); else shown.delete(word);
  }
  return [...shown].sort();
}

/**
 * The source weights to show, in the stored convention where neutral (0) is absence. Same settling rule as the words.
 */
export function overlayWeights(loaded, pending) {
  const shown = { ...((loaded && typeof loaded === 'object') ? loaded : {}) };
  for (const [id, weight] of [...(pending?.weights ?? new Map())]) {
    if ((Number(shown[id]) || 0) === weight) { pending.weights.delete(id); continue; }
    if (weight === 0) delete shown[id]; else shown[id] = weight;
  }
  return shown;
}
