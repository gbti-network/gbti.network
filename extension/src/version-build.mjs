// The build number the new tab's version indicator shows beside the installed version. Pure, so it is node-tested.
//
// It is the build of THE INSTALLED VERSION, not the newest build in the changelog. The newest one belongs to whatever
// was released last, so an install that has not updated yet read "v0.5.3 · build 40" when build 40 is 0.6.0. A version
// can carry several builds (0.1.0 does), and the highest of them is the one installed. A version the changelog does
// not list gives 0, and the indicator then shows the version alone.
export function buildForVersion(entries, version) {
  const v = String(version || '');
  if (!v || !Array.isArray(entries)) return 0;
  let best = 0;
  for (const e of entries) {
    const b = Number(e?.build);
    if (e?.version === v && Number.isFinite(b) && b > best) best = b;
  }
  return best;
}
